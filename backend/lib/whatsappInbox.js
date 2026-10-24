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

async function findListenedContact(sender) {
  if (!sender) return null;
  const exact = await WhatsappContact.findOne({ number: sender, listen: true });
  if (exact) return exact;
  // the same person written another way (with or without the @c.us part)
  const digits = digitsOf(sender);
  if (digits.length < 6) return null;
  const candidates = await WhatsappContact.find({ listen: true });
  return candidates.find(c => digitsOf(c.number) === digits) || null;
}

const sentAtOf = message => new Date((Number(message.timestamp) || Date.now() / 1000) * 1000);

/** A message from a contact that is listened to: every bet in it goes to the inbox. Returns how many were added. */
async function handleIncoming(message) {
  if (!message || message.fromMe || message.isStatus || !message.body) return 0;
  if (/@broadcast$/.test(message.from || '')) return 0;

  const messageId = message.id && message.id._serialized;
  if (!messageId) return 0;

  const sender = message.author || message.from;
  const contact = await findListenedContact(sender);
  if (!contact) return 0;

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

/** Starts listening on a WhatsApp client. Errors are logged, never thrown into the client. */
function attach(client) {
  const guard = (name, handler) => message => {
    handler(message).catch(error => console.error(`WhatsApp inbox (${name}):`, error.message));
  };
  client.on('message', guard('incoming', handleIncoming));
  client.on('message_create', guard('own', handleOwn));
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
    '2 5000@2000',
    '3 5k',
    '1 500',
    ...(named ? [shorten(named.horseName) + ' 500x90'] : []),
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
        amount: entry.amountKind === '?' ? entry.amount : null, books: entry.books, f500: entry.f500, stake: entry.stake, odds100: entry.odds100,
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

module.exports = { createDemo, clearDemo, handleIncoming, handleOwn, attach, listPending, decide, updateContact, currentContext, requestIdFor };
