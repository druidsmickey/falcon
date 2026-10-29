// Turns what contacts write in WhatsApp into pending bets for a person to confirm (see lib/betMessage.js
// for how a message is read). Only the contacts that were chosen are listened to, and nothing becomes a
// bet here: the app confirms each one through the normal bet entry.
const crypto = require('crypto');
const WhatsappContact = require('../models/whatsappContact');
const WhatsappInbox = require('../models/whatsappInbox');
const WhatsappOdds = require('../models/whatsappOdds');
const Init = require('../models/init');
const Params = require('../models/params');
const { parseBetMessage, parseOddsList, emptyContext } = require('./betMessage');

const requestIdFor = key => 'wa-' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 24);
const digitsOf = id => String(id || '').split('@')[0].replace(/\D/g, '');

/** The horses of the selected meeting, so that a bet can name its horse. */
async function selectedHorses() {
  const race = await Init.findOne({ selected: true }).lean();
  if (!race) return [];
  const rows = await Params.find({ meetingName: race.meetingName }).select('raceNum horseNum horseName').lean();
  return rows.map(r => ({ raceNum: r.raceNum, horseNum: r.horseNum, horseName: r.horseName || '' }));
}

/** The race that is running (from the latest odds list) and the horses of the meeting. */
async function currentContext() {
  const [latest, horses] = await Promise.all([WhatsappOdds.findOne().sort({ sentAt: -1 }).lean(), selectedHorses()]);
  return { raceNum: latest ? latest.raceNum : null, runners: latest ? latest.runners : null, horses };
}

/**
 * The ids a message can be matched on. WhatsApp sometimes names the sender with a hidden id ("...@lid") that is
 * not the phone number, so the contact the message belongs to is asked for as well.
 */
async function senderCandidates(message) {
  const ids = [message.author, message.from];

  // a hidden id ("...@lid") is turned into the phone number by WhatsApp itself
  const client = message.client;
  if (client && typeof client.getContactLidAndPhone === 'function') {
    const hidden = ids.filter(id => /@lid$/.test(id || ''));
    if (hidden.length > 0) {
      try {
        for (const pair of (await client.getContactLidAndPhone(hidden)) || []) ids.push(pair && pair.pn);
      } catch {
        // the other ids are still tried
      }
    }
  }
  if (typeof message.getContact === 'function') {
    try {
      const contact = await message.getContact();
      if (contact) {
        ids.push(contact.id && contact.id._serialized);
        if (contact.number) ids.push(contact.number + '@c.us');
        if (contact.id && contact.id.user) ids.push(contact.id.user + '@c.us');
      }
    } catch {
      // the other ids are still tried
    }
  }
  return [...new Set(ids.filter(Boolean))];
}

/** The saved contact that one of the ids belongs to (listened to or not), or null. */
async function findContact(candidates) {
  if (candidates.length === 0) return null;
  const exact = await WhatsappContact.findOne({ number: { $in: candidates } });
  if (exact) return exact;
  // the same person written another way (with or without the @c.us part)
  const digits = candidates.map(digitsOf).filter(d => d.length >= 6);
  if (digits.length === 0) return null;
  const all = await WhatsappContact.find();
  return all.find(c => digits.includes(digitsOf(c.number))) || null;
}

// What the server did with the latest messages, so that a message that did not arrive can be explained
// (shown in the WhatsApp tab). Kept in memory only; the text is only kept for contacts that are listened to.
const activity = [];
const ACTIVITY_LIMIT = 30;

function record(entry) {
  activity.unshift({ at: new Date().toISOString(), ...entry });
  if (activity.length > ACTIVITY_LIMIT) activity.length = ACTIVITY_LIMIT;
}

const recentIds = new Set();
// How many times WhatsApp announced something, whatever was done with it: tells "WhatsApp sends nothing" from
// "WhatsApp sends it and the server ignores it".
const counters = { events: 0, fromOthers: 0, errors: 0, lastError: null, lastEventAt: null, ignored: { fromMe: 0, status: 0, broadcast: 0 }, results: { added: 0, notSaved: 0, notListened: 0, nothingToRead: 0, noText: 0 }, polled: 0, lastPollAt: null };
// WhatsApp announces a message with two events; it is counted once
const countedIds = new Set();
const getCounters = () => ({ ...counters, ignored: { ...counters.ignored }, results: { ...counters.results } });
function noteEvent(message) {
  const id = message && message.id && message.id._serialized;
  if (id) {
    if (countedIds.has(id)) return;
    countedIds.add(id);
    if (countedIds.size > 2000) countedIds.delete(countedIds.values().next().value);
  }
  counters.events += 1;
  counters.lastEventAt = new Date().toISOString();
  if (message && message.fromMe) counters.ignored.fromMe += 1;
  else if (message && message.isStatus) counters.ignored.status += 1;
  else if (message && /@broadcast$/.test(message.from || '')) counters.ignored.broadcast += 1;
  else counters.fromOthers += 1;
}
const getActivity = () => activity.map(a => ({ ...a }));
const clearActivity = () => {
  activity.length = 0;
  recentIds.clear();
  countedIds.clear();
  Object.assign(counters, { events: 0, fromOthers: 0, errors: 0, lastError: null, lastEventAt: null, polled: 0, lastPollAt: null, ignored: { fromMe: 0, status: 0, broadcast: 0 }, results: { added: 0, notSaved: 0, notListened: 0, nothingToRead: 0, noText: 0 } });
};

const sentAtOf = message => new Date((Number(message.timestamp) || Date.now() / 1000) * 1000);
const preview = text => String(text).replace(/\s+/g, ' ').trim().slice(0, 60);

/** A message from a contact that is listened to: every bet in it goes to the inbox. Returns how many were added. */
async function handleIncoming(message) {
  if (!message || message.fromMe || message.isStatus) return 0;
  if (/@broadcast$/.test(message.from || '')) return 0;

  const messageId = message.id && message.id._serialized;
  if (!messageId) return 0;

  // WhatsApp can announce a message twice (both events are listened to), but it is read once
  if (recentIds.has(messageId)) return 0;
  recentIds.add(messageId);
  if (recentIds.size > 500) recentIds.delete(recentIds.values().next().value);
  console.log('WhatsApp inbox: message received from', digitsOf(message.author || message.from) || 'unknown');

  if (!message.body) {
    counters.results.noText += 1;
    record({ from: message.author || message.from || 'unknown', name: null, text: null, result: 'no text in it (photo, voice note or similar)' });
    return 0;
  }

  const candidates = await senderCandidates(message);
  const contact = await findContact(candidates);
  const who = [message.author, message.from].filter(Boolean).join(' / ') || 'unknown';
  if (!contact) {
    counters.results.notSaved += 1;
    record({ from: who, name: null, text: null, result: 'not a saved contact: press "Sync contacts from the phone"' });
    return 0;
  }
  if (!contact.listen) {
    counters.results.notListened += 1;
    record({ from: who, name: contact.name, text: null, result: 'contact is saved but not ticked to listen to' });
    return 0;
  }

  const parsed = parseBetMessage(message.body, await currentContext());
  let added = 0;
  for (const [index, entry] of parsed.entries()) {
    const key = `${messageId}:${index}`;
    const doc = {
      key,
      messageId,
      contactNumber: contact.number,
      contactName: contact.name,
      clientName: (contact.nickname || contact.name).toUpperCase(),
      text: entry.text,
      sentAt: sentAtOf(message),
      clientRequestId: requestIdFor(key),
      unreadable: !!entry.unreadable,
      issues: entry.issues || [],
      unsure: !!entry.unreadable || !!entry.unsure,
    };
    if (!entry.unreadable) {
      Object.assign(doc, {
        raceNum: entry.raceNum,
        horseNum: entry.horseNum,
        mode: entry.mode,
        amountKind: entry.amountKind,
        amount: entry.amountKind === '?' ? entry.amount : null,
        rate: entry.amountKind === '?' ? entry.rate : null,
        books: entry.books,
        f500: entry.f500,
        stake: entry.stake,
        odds100: entry.odds100,
      });
    }
    // a message that arrives twice (reconnects) is only added once
    const result = await WhatsappInbox.updateOne({ key }, { $setOnInsert: doc }, { upsert: true });
    if (result.upsertedCount) added += 1;
  }

  if (parsed.length === 0) counters.results.nothingToRead += 1;
  else counters.results.added += added > 0 ? 1 : 0;
  let result;
  if (parsed.length === 0) result = 'nothing to read in it (no bet, or only numbers)';
  else if (added === 0) result = 'already in the inbox';
  else result = added === 1 ? 'added 1 bet to the inbox' : `added ${added} bets to the inbox`;
  record({ from: who, name: contact.name, text: preview(message.body), result });
  return added;
}

/** A message sent from the account itself: an odds list sets the race that is running. */
async function handleOwn(message) {
  if (!message || !message.fromMe || !message.body) return false;
  const list = parseOddsList(message.body);
  const messageId = message.id && message.id._serialized;
  if (!list || !messageId) return false;

  const result = await WhatsappOdds.updateOne(
    { messageId },
    { $setOnInsert: { messageId, raceNum: list.raceNum, runners: list.runners, odds: list.odds, style: list.style, sentAt: sentAtOf(message) } },
    { upsert: true }
  );
  return !!result.upsertedCount;
}

/** Messages older than this are not taken up by the fallback below (it is for what the live events missed). */
const POLL_WINDOW_MS = 3 * 60 * 60 * 1000;
const POLL_EVERY_MS = 20 * 1000;
const POLL_MESSAGES_PER_CHAT = 15;

/**
 * The live events can fail (WhatsApp changes its web page, a hidden id, a lost event). So the chats of the
 * contacts that are listened to are also asked for their latest messages now and then; what is new goes the same
 * way as a live message, and a message seen both ways is read once. This also picks up bets sent while the
 * connection was down, once it is back. Returns how many bets were added.
 */
async function pollListened(client, now = Date.now()) {
  const contacts = await WhatsappContact.find({ listen: true });
  let added = 0;
  for (const contact of contacts) {
    let chat;
    try {
      chat = await client.getChatById(contact.number);
    } catch {
      continue; // not ready yet, or no chat with this contact
    }
    if (!chat || typeof chat.fetchMessages !== 'function') continue;
    let messages = [];
    try {
      messages = await chat.fetchMessages({ limit: POLL_MESSAGES_PER_CHAT });
    } catch {
      continue;
    }
    // oldest first, so that bets come in the order they were sent
    for (const message of [...messages].sort((x, y) => (x.timestamp || 0) - (y.timestamp || 0))) {
      if (!message || message.fromMe || (Number(message.timestamp) || 0) * 1000 < now - POLL_WINDOW_MS) continue;
      added += await handleIncoming(message);
    }
  }
  counters.polled += 1;
  counters.lastPollAt = new Date().toISOString();
  return added;
}

/** Starts listening on a WhatsApp client. Errors are logged, never thrown into the client. */
function attach(client, { pollEveryMs = POLL_EVERY_MS } = {}) {
  const guard = (name, handler) => message => {
    handler(message).catch(error => {
      counters.errors += 1;
      counters.lastError = String(error && error.message || error).slice(0, 160);
      console.error(`WhatsApp inbox (${name}):`, error && error.message);
    });
  };
  // some versions of the library only announce a message with one of the two events, so both are used
  client.on('message', guard('incoming', async message => { noteEvent(message); return handleIncoming(message); }));
  client.on('message_create', guard('created', async message => {
    noteEvent(message);
    return message && message.fromMe ? handleOwn(message) : handleIncoming(message);
  }));

  // the fallback, while this client lives
  if (pollEveryMs > 0 && typeof client.once === 'function') {
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      pollListened(client)
        .catch(error => console.error('WhatsApp inbox (poll):', error.message))
        .finally(() => { running = false; });
    }, pollEveryMs);
    if (typeof timer.unref === 'function') timer.unref();
    client.once('disconnected', () => clearInterval(timer));
  }
}

// ---------------------------------------------------------------- what the app asks for

const toItem = doc => ({
  id: doc._id.toString(),
  text: doc.text,
  contactName: doc.contactName,
  clientName: doc.clientName,
  sentAt: doc.sentAt,
  unreadable: doc.unreadable,
  demo: !!doc.demo,
  raceNum: doc.raceNum,
  horseNum: doc.horseNum,
  mode: doc.mode,
  amountKind: doc.amountKind,
  amount: doc.amount,
  rate: doc.rate,
  books: doc.books,
  f500: doc.f500,
  stake: doc.stake,
  odds100: doc.odds100,
  unsure: doc.unsure,
  issues: doc.issues,
  clientRequestId: doc.clientRequestId,
});

async function listPending() {
  const [items, context] = await Promise.all([
    WhatsappInbox.find({ status: 'pending' }).sort({ sentAt: 1 }).limit(500),
    WhatsappOdds.findOne().sort({ sentAt: -1 }).lean(),
  ]);
  return {
    items: items.map(toItem),
    odds: context ? { raceNum: context.raceNum, runners: context.runners, sentAt: context.sentAt, odds: context.odds } : null,
  };
}

/** How many bets wait for a person to approve them. */
async function countPending() {
  return WhatsappInbox.countDocuments({ status: 'pending' });
}

/** Marks a pending item confirmed or dismissed. Returns false if it was not pending (already decided). */
async function decide(id, status) {
  if (!['confirmed', 'dismissed'].includes(status)) throw new Error('bad status');
  const result = await WhatsappInbox.updateOne({ _id: id, status: 'pending' }, { $set: { status, decidedAt: new Date() } });
  return result.modifiedCount === 1;
}

/** Sets who to listen to and the nickname bets from a contact are entered under. */
async function updateContact(id, { nickname, listen }) {
  const changes = {};
  if (nickname !== undefined) {
    if (typeof nickname !== 'string' || nickname.trim().length > 100) throw new Error('nickname must be text of up to 100 characters');
    changes.nickname = nickname.trim();
  }
  if (listen !== undefined) {
    if (typeof listen !== 'boolean') throw new Error('listen must be true or false');
    changes.listen = listen;
  }
  const contact = await WhatsappContact.findByIdAndUpdate(id, { $set: changes }, { new: true });
  if (!contact) return null;

  if (changes.nickname !== undefined) {
    // bets still waiting are entered under the new name
    await WhatsappInbox.updateMany(
      { contactNumber: contact.number, status: 'pending' },
      { $set: { clientName: (contact.nickname || contact.name).toUpperCase() } }
    );
  }
  return contact;
}

/** A word shortened the way people type it: "captain magpie" becomes "cap mag". */
const shorten = name => String(name).trim().split(/\s+/).map(w => w.slice(0, 3)).join(' ').toLowerCase();

/**
 * Puts a few sample messages in the inbox so that the screen can be tried. They are read by the real parser,
 * come from a made-up contact, and confirming them saves nothing. Uses the horses of the selected meeting
 * when there are any, so that the names match.
 */
async function createDemo() {
  const horses = await selectedHorses();
  const race = horses.length > 0 ? Math.min(...horses.map(h => h.raceNum)) : 1;
  const inRace = horses.filter(h => h.raceNum === race).sort((a, b) => a.horseNum - b.horseNum);
  const runners = inRace.length > 0 ? Math.max(...inRace.map(h => h.horseNum)) : 6;
  const context = { raceNum: race, runners, horses };

  const named = inRace[1] || inRace[0];
  const lines = [
    '11 500x90',
    '2 5000 420',
    '3 5k',
    '1 500',
    '11 500 200',
    ...(named ? [shorten(named.horseName) + ' 500 on 120'] : []),
    'put 500 on the grey one',
  ];

  const stamp = Date.now();
  const sentAt = new Date();
  let added = 0;
  for (const [index, text] of lines.entries()) {
    const entry = parseBetMessage(text, context)[0];
    const key = `demo-${stamp}:${index}`;
    const doc = {
      key, messageId: `demo-${stamp}-${index}`, contactNumber: 'demo', contactName: 'Demo contact', clientName: 'DEMO',
      text, sentAt: new Date(sentAt.getTime() + index * 1000), clientRequestId: requestIdFor(key), demo: true,
      unreadable: !!entry.unreadable, issues: entry.issues || [], unsure: !!entry.unreadable || !!entry.unsure,
    };
    if (!entry.unreadable) {
      Object.assign(doc, {
        raceNum: entry.raceNum, horseNum: entry.horseNum, mode: entry.mode, amountKind: entry.amountKind,
        amount: entry.amountKind === '?' ? entry.amount : null, rate: entry.amountKind === '?' ? entry.rate : null, books: entry.books, f500: entry.f500, stake: entry.stake, odds100: entry.odds100,
      });
    }
    await WhatsappInbox.create(doc);
    added += 1;
  }
  return added;
}

/** Removes the sample bets that are still waiting. */
async function clearDemo() {
  const result = await WhatsappInbox.deleteMany({ demo: true });
  return result.deletedCount;
}

module.exports = { getCounters, pollListened, getActivity, clearActivity, countPending, createDemo, clearDemo, handleIncoming, handleOwn, attach, listPending, decide, updateContact, currentContext, requestIdFor };
