// Turns what contacts write in WhatsApp into pending bets for a person to confirm (see lib/betMessage.js
// for how a message is read). Only the contacts that were chosen are listened to, and nothing becomes a
// bet here: the app confirms each one through the normal bet entry.
const crypto = require('crypto');
const WhatsappContact = require('../models/whatsappContact');
const WhatsappInbox = require('../models/whatsappInbox');
const WhatsappOdds = require('../models/whatsappOdds');
const Init = require('../models/init');
const Params = require('../models/params');
const { parseBetMessage, parseOddsList, emptyContext, isDoubtful } = require('./betMessage');
const WhatsappAi = require('../models/whatsappAi');
const { AiReader, PRESETS, MAX_LINES } = require('./aiReader');
const WhatsappCorrection = require('../models/whatsappCorrection');
const { learn } = require('./corrections');

/**
 * A name for a message that is the same every time the message is announced. WhatsApp's own id is used when the
 * message has one (in its serialized form, or built from its parts); some messages arrive without, and then the
 * name is made from who sent it, when, and what it says, so that no message is dropped for lacking an id.
 */
function messageIdOf(message) {
  if (!message || typeof message !== 'object') return null;
  const id = message.id;
  if (typeof id === 'string' && id) return id;
  if (id && typeof id === 'object') {
    if (id._serialized) return String(id._serialized);
    if (id.id) return [id.fromMe ? 'true' : 'false', id.remote || message.from || '', id.id, id.participant || ''].join('_');
  }
  const basis = [message.from || '', message.author || '', message.timestamp || '', message.body || '', message.type || ''].join('|');
  return 'made-' + crypto.createHash('sha1').update(basis).digest('hex').slice(0, 32);
}

const requestIdFor = key => 'wa-' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 24);
const digitsOf = id => String(id || '').split('@')[0].replace(/\D/g, '');

/** The horses of the selected meeting, so that a bet can name its horse. */
async function selectedHorses() {
  const race = await Init.findOne({ selected: true }).lean();
  if (!race) return [];
  const rows = await Params.find({ meetingName: race.meetingName }).select('raceNum horseNum horseName').lean();
  return rows.map(r => ({ raceNum: r.raceNum, horseNum: r.horseNum, horseName: r.horseName || '' }));
}

// ---------------------------------------------------------------- the AI that gives a second opinion

/** The settings of the AI: what was saved in the app, else the server's environment (AI_API_KEY, AI_BASE_URL, AI_MODEL, AI_ENABLED). */
async function loadAiSettings() {
  const doc = await WhatsappAi.findOne({ key: 'main' }).lean();
  const env = process.env;
  const preset = (doc && doc.preset) || 'gemini';
  const base = PRESETS[preset] || PRESETS.custom;
  return {
    enabled: doc ? !!doc.enabled : String(env.AI_ENABLED || '').toLowerCase() === 'true',
    readAll: doc ? !!doc.readAll : String(env.AI_READ_ALL || '').toLowerCase() === 'true',
    baseUrl: (doc && doc.baseUrl) || env.AI_BASE_URL || base.baseUrl,
    model: (doc && doc.model) || env.AI_MODEL || base.model,
    fallbackModel: doc ? doc.fallbackModel || '' : env.AI_FALLBACK_MODEL || base.fallbackModel || '',
    apiKey: (doc && doc.apiKey) || env.AI_API_KEY || '',
  };
}

/** The corrections people made, newest first: the AI is shown the ones that look like the line it reads. */
const loadCorrections = () => WhatsappCorrection.find().sort({ createdAt: -1 }).limit(60).lean();

let ai = new AiReader({ loadSettings: loadAiSettings, loadExamples: loadCorrections });
/** For tests: the reader that is used. */
const setAiReader = reader => { ai = reader; };

/** What the app may see of the AI settings: never the key itself. */
async function getAiSettings() {
  const doc = await WhatsappAi.findOne({ key: 'main' }).lean();
  const settings = await loadAiSettings();
  return {
    enabled: settings.enabled,
    readAll: settings.readAll,
    preset: (doc && doc.preset) || 'gemini',
    baseUrl: settings.baseUrl,
    model: settings.model,
    fallbackModel: settings.fallbackModel,
    hasKey: !!settings.apiKey,
    stats: ai.getStats(),
    corrections: await WhatsappCorrection.countDocuments(),
    presets: PRESETS,
  };
}

const safeAddress = value => {
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return url.protocol === 'https:' || (url.protocol === 'http:' && local);
  } catch {
    return false;
  }
};

/** Saves the settings. A key is only changed when one is given; clearKey removes it. */
async function saveAiSettings(body) {
  const input = body && typeof body === 'object' ? body : {};
  const changes = {};
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') throw new Error('enabled must be true or false');
    changes.enabled = input.enabled;
  }
  if (input.readAll !== undefined) {
    if (typeof input.readAll !== 'boolean') throw new Error('readAll must be true or false');
    changes.readAll = input.readAll;
  }
  if (input.preset !== undefined) {
    if (!['gemini', 'groq', 'claude', 'custom'].includes(input.preset)) throw new Error('unknown preset');
    changes.preset = input.preset;
    // choosing a ready-made service also sets its address and model, unless the person gives their own
    if (input.preset !== 'custom') {
      if (input.baseUrl === undefined) changes.baseUrl = PRESETS[input.preset].baseUrl;
      if (input.model === undefined) changes.model = PRESETS[input.preset].model;
      if (input.fallbackModel === undefined) changes.fallbackModel = PRESETS[input.preset].fallbackModel;
    }
  }
  if (input.baseUrl !== undefined) {
    const address = String(input.baseUrl).trim();
    if (address && !safeAddress(address)) throw new Error('the address must start with https:// (http:// only for localhost)');
    changes.baseUrl = address;
  }
  if (input.model !== undefined) {
    const model = String(input.model).trim();
    if (model.length > 100) throw new Error('the model name is too long');
    changes.model = model;
  }
  if (input.fallbackModel !== undefined) {
    const backup = String(input.fallbackModel).trim();
    if (backup.length > 100) throw new Error('the backup model name is too long');
    changes.fallbackModel = backup;
  }
  if (typeof input.apiKey === 'string' && input.apiKey.trim()) changes.apiKey = input.apiKey.trim().slice(0, 500);
  if (input.clearKey === true) changes.apiKey = '';
  await WhatsappAi.updateOne({ key: 'main' }, { $set: changes, $setOnInsert: { key: 'main' } }, { upsert: true });
  return getAiSettings();
}

/** When the model name is refused, asks the service which models it has, so that one can be copied into the Model box. */
async function availableModelsText() {
  try {
    const settings = await loadAiSettings();
    if (!settings || !settings.apiKey || !settings.baseUrl) return '';
    const response = await fetch(settings.baseUrl.replace(/\/+$/, '') + '/models', { headers: { Authorization: 'Bearer ' + settings.apiKey }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return '';
    const data = await response.json();
    const names = (data.data || data.models || []).map(m => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean)
      .filter(n => !/whisper|tts|guard|embed|image|audio|vision-preview|orpheus/i.test(n)).slice(0, 25);
    return names.length ? ' | Models this key can use (copy one into the Model box): ' + names.join(', ') : '';
  } catch {
    return '';
  }
}

/** Tries the AI with a sample line, to see that the key and the model work. */
async function testAi(text) {
  const sample = String(text || '').trim().slice(0, 200) || 'put 5k on the grey at 650';
  const context = await currentContext();
  const before = ai.getStats();
  const entries = await ai.read([sample], context);
  const stats = ai.getStats();
  if (entries === null) {
    let error = stats.lastError && stats.failed > before.failed ? stats.lastError : 'the AI is switched off, has no key, or the limit was reached';
    if (/ 404/.test(error)) error += await availableModelsText();
    return { ok: false, error, sample };
  }
  return {
    ok: true,
    sample,
    bets: entries.map(e => ({ race: e.raceNum, horse: e.horseNum, kind: e.amountKind, amount: e.amount ?? e.books ?? e.stake, second: e.f500 ?? e.odds100 ?? e.rate ?? null, notes: e.issues })),
  };
}

/**
 * The lines the rules were not sure about go to the AI (every line with a figure, when the AI is set to read all).
 * What it finds for a line replaces what the rules read for it (always marked unsure and read by AI); when it finds
 * no bet in a line the rules could not read at all, that line is dropped as chat. When the AI cannot be used,
 * nothing changes.
 */
async function withAiSecondOpinion(parsed, context) {
  let readAll = false;
  try {
    readAll = !!(await loadAiSettings()).readAll;
  } catch {
    readAll = false;
  }
  const targets = parsed.map((entry, i) => i).filter(i => readAll || isDoubtful(parsed[i])).slice(0, MAX_LINES);
  if (targets.length === 0) return parsed;

  const lines = targets.map(i => parsed[i].text);
  let found = null;
  try {
    found = await ai.read(lines, context);
  } catch {
    found = null;
  }
  if (found === null) return parsed;
  if (found.length === 0) return parsed.filter(e => !e.unreadable);

  const targetSet = new Set(targets);
  const withLine = e => Number.isInteger(e.aiLine) && e.aiLine >= 1 && e.aiLine <= lines.length;
  const clean = ({ aiLine, ...entry }) => entry;
  const result = [];

  if (found.every(withLine)) {
    // the AI says which line each bet comes from: a line it found nothing in keeps what the rules read, unless that was unreadable
    const byLine = new Map();
    for (const e of found) byLine.set(e.aiLine - 1, [...(byLine.get(e.aiLine - 1) || []), clean(e)]);
    parsed.forEach((entry, i) => {
      if (!targetSet.has(i)) return result.push(entry);
      const k = targets.indexOf(i);
      if (byLine.has(k)) result.push(...byLine.get(k).map(e => ({ ...e, text: lines[k] })));
      else if (!entry.unreadable) result.push(entry);
    });
    return result;
  }

  const text = lines.join(' | ');
  let inserted = false;
  parsed.forEach((entry, i) => {
    if (!targetSet.has(i)) result.push(entry);
    else if (!inserted) {
      result.push(...found.map(e => ({ ...clean(e), text })));
      inserted = true;
    }
  });
  return result;
}

/** The race that is running (from the latest odds list) and the horses of the meeting. */
async function currentContext() {
  const [latest, horses] = await Promise.all([WhatsappOdds.findOne().sort({ sentAt: -1 }).lean(), selectedHorses()]);
  return { raceNum: latest ? latest.raceNum : null, runners: latest ? latest.runners : null, horses };
}

// Asking WhatsApp for more about a sender goes through its web page and can take long or never answer, so
// every such question has a time limit and a message is never held up by it.
let lookupTimeoutMs = 4000;
const setLookupTimeout = ms => { lookupTimeoutMs = ms; };

function withTimeout(promise, ms, what) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} took more than ${Math.round(ms / 1000)} seconds`)), ms);
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

/** The ids the message itself names: the sender, and the group when it came from one. */
const knownIds = message => [...new Set([message.author, message.from].filter(Boolean))];

/**
 * More ids for the same sender, asked of WhatsApp: a hidden id ("...@lid") has a phone number, and the contact
 * of the message knows its own. Returns what was found; `timedOut` says if WhatsApp did not answer in time.
 */
async function moreIds(message) {
  const ids = [];
  let timedOut = false;
  const ask = async (promise, what, use) => {
    try {
      use(await withTimeout(promise, lookupTimeoutMs, what));
    } catch (error) {
      if (/took more than/.test(String(error && error.message))) timedOut = true;
    }
  };

  const client = message.client;
  const hidden = knownIds(message).filter(id => /@lid$/.test(id));
  if (hidden.length > 0 && client && typeof client.getContactLidAndPhone === 'function') {
    await ask(client.getContactLidAndPhone(hidden), 'finding the phone number of a hidden id', pairs => {
      for (const pair of pairs || []) ids.push(pair && pair.pn);
    });
  }
  if (typeof message.getContact === 'function') {
    await ask(message.getContact(), 'asking for the contact of a message', contact => {
      if (!contact) return;
      ids.push(contact.id && contact.id._serialized);
      if (contact.number) ids.push(contact.number + '@c.us');
      if (contact.id && contact.id.user) ids.push(contact.id.user + '@c.us');
    });
  }
  return { ids: ids.filter(Boolean), timedOut };
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
const startedAt = new Date().toISOString();
const counters = { events: 0, fromOthers: 0, errors: 0, lastError: null, lastEventAt: null, ignored: { fromMe: 0, status: 0, broadcast: 0, groups: 0 }, results: { added: 0, notSaved: 0, notListened: 0, nothingToRead: 0, noText: 0 }, polled: 0, lastPollAt: null };
// WhatsApp announces a message with two events; it is counted once
const countedIds = new Set();
const getCounters = () => ({ startedAt, ...counters, ignored: { ...counters.ignored }, results: { ...counters.results } });
function noteEvent(message) {
  const id = messageIdOf(message);
  if (id) {
    if (countedIds.has(id)) return;
    countedIds.add(id);
    if (countedIds.size > 2000) countedIds.delete(countedIds.values().next().value);
  }
  counters.events += 1;
  traceStart(message);
  counters.lastEventAt = new Date().toISOString();
  if (message && message.fromMe) counters.ignored.fromMe += 1;
  else if (message && message.isStatus) counters.ignored.status += 1;
  else if (message && /@broadcast$/.test(message.from || '')) counters.ignored.broadcast += 1;
  else if (isGroupLike(message)) counters.ignored.groups += 1;
  else counters.fromOthers += 1;
}
// A trace of the latest announcements, whatever happened to them: what each one was and the last thing the server did
// with it. It is what shows where a message that never reached the inbox was dropped.
const trace = [];
const TRACE_LIMIT = 20;
const traces = new WeakMap();
const traceOf = message => (message && typeof message === 'object' ? traces.get(message) : undefined);
function traceStart(message) {
  if (!message || typeof message !== 'object') return;
  try {
    traceEntry(message);
  } catch {
    // the trace is only a help; a message it cannot describe is still read
  }
}

function traceEntry(message) {
  const entry = {
    at: new Date().toISOString(),
    type: String(message.type || '?'),
    from: message.from || null,
    author: message.author || null,
    fromMe: !!message.fromMe,
    isStatus: !!message.isStatus,
    hasBody: !!message.body,
    hasId: !!(message.id && (typeof message.id === 'string' || message.id._serialized || message.id.id)),
    branch: 'announced',
  };
  trace.unshift(entry);
  if (trace.length > TRACE_LIMIT) trace.length = TRACE_LIMIT;
  traces.set(message, entry);
}
function mark(message, branch) {
  const entry = traceOf(message);
  if (entry) entry.branch = branch;
}
const getTrace = () => trace.map(t => ({ ...t }));

const getActivity = () => activity.map(a => ({ ...a }));
const clearActivity = () => {
  activity.length = 0;
  recentIds.clear();
  countedIds.clear();
  trace.length = 0;
  Object.assign(counters, { events: 0, fromOthers: 0, errors: 0, lastError: null, lastEventAt: null, polled: 0, lastPollAt: null, ignored: { fromMe: 0, status: 0, broadcast: 0, groups: 0 }, results: { added: 0, notSaved: 0, notListened: 0, nothingToRead: 0, noText: 0 } });
};

// groups, communities (their announcement group too) and channels are not read: bets come from a person's own chat
const isGroupLike = message => /@(g\.us|newsletter)$/.test((message && message.from) || '');

const sentAtOf = message => new Date((Number(message.timestamp) || Date.now() / 1000) * 1000);
const preview = text => String(text).replace(/\s+/g, ' ').trim().slice(0, 60);

/** A message from a contact that is listened to: every bet in it goes to the inbox. Returns how many were added. */
async function handleIncoming(message) {
  if (!message) return 0;
  if (message.fromMe || message.isStatus) { mark(message, 'ignored: sent by you, or a status'); return 0; }
  if (/@broadcast$/.test(message.from || '')) { mark(message, 'ignored: broadcast'); return 0; }
  if (isGroupLike(message)) { mark(message, 'ignored: a group, community announcement or channel'); return 0; }

  const messageId = messageIdOf(message);
  if (!messageId) { mark(message, 'dropped: the message has no id'); return 0; }

  // WhatsApp can announce a message twice (both events are listened to), but it is read once
  if (recentIds.has(messageId)) { mark(message, 'second announcement of a message that is already being read'); return 0; }
  recentIds.add(messageId);
  if (recentIds.size > 500) recentIds.delete(recentIds.values().next().value);
  console.log('WhatsApp inbox: message received from', digitsOf(message.author || message.from) || 'unknown');

  if (!message.body) {
    mark(message, 'done: no text in it');
    counters.results.noText += 1;
    record({ from: message.author || message.from || 'unknown', name: null, text: null, result: 'no text in it (photo, voice note or similar)' });
    return 0;
  }

  mark(message, 'looking for the sender among the saved contacts');
  // the ids in the message first, which costs nothing; WhatsApp is only asked when they are not enough
  const known = knownIds(message);
  let contact = await findContact(known);
  let timedOut = false;
  if (!contact) {
    mark(message, 'asking WhatsApp who the sender is');
    const more = await moreIds(message);
    timedOut = more.timedOut;
    contact = await findContact([...known, ...more.ids]);
  }
  const who = known.join(' / ') || 'unknown';
  if (!contact) {
    mark(message, 'done: not a saved contact');
    counters.results.notSaved += 1;
    record({
      from: who,
      name: null,
      text: null,
      result: timedOut
        ? 'sender not found: WhatsApp did not say who it is in time (press "Sync contacts from the phone" and try again)'
        : 'not a saved contact: press "Sync contacts from the phone"',
    });
    return 0;
  }
  if (!contact.listen) {
    mark(message, 'done: contact not ticked');
    counters.results.notListened += 1;
    record({ from: who, name: contact.name, text: null, result: 'contact is saved but not ticked to listen to' });
    return 0;
  }

  // a message that is already in the inbox (the fallback finds it again after a restart) is not read, or paid for, twice
  if (await WhatsappInbox.exists({ messageId })) {
    mark(message, 'done: already in the inbox');
    return 0;
  }

  mark(message, 'reading the message');
  const context = await currentContext();
  const read = parseBetMessage(message.body, context);
  const parsed = await withAiSecondOpinion(read, context);
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
      ai: !!entry.ai,
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
  else result = (added === 1 ? 'added 1 bet to the inbox' : `added ${added} bets to the inbox`) + (parsed.some(e => e.ai) ? ' (read with AI)' : '');
  record({ from: who, name: contact.name, text: preview(message.body), result });
  mark(message, 'done: ' + result);
  return added;
}

/** A message sent from the account itself: an odds list sets the race that is running. */
async function handleOwn(message) {
  if (!message || !message.fromMe || !message.body) return false;
  const list = parseOddsList(message.body);
  const messageId = messageIdOf(message);
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
const POLL_EVERY_MS = 60 * 1000;
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
  replyClient = client;
  const guard = (name, handler) => message => {
    withTimeout(handler(message), 30000, 'reading a message').catch(error => {
      mark(message, 'FAILED: ' + String(error && error.message || error).slice(0, 100));
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
  ai: !!doc.ai,
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

// the WhatsApp client of the moment, to answer the person whose bet was saved
let replyClient = null;

/**
 * Tells the player that the bet was saved: "OK", or "OK" and the line when the message held several bets (so that
 * the answers can be told apart). Never makes saving fail. Switched off with WHATSAPP_REPLY_OK=false.
 */
async function replyOk(item) {
  try {
    if (!replyClient || String(process.env.WHATSAPP_REPLY_OK || '').toLowerCase() === 'false') return;
    const several = (await WhatsappInbox.countDocuments({ messageId: item.messageId })) > 1;
    await replyClient.sendMessage(item.contactNumber, several ? `OK ${item.text}` : 'OK');
  } catch (error) {
    console.log('WhatsApp inbox: the OK reply was not sent:', error.message);
  }
}

/**
 * Marks a pending item confirmed or dismissed. Returns false if it was not pending (already decided). When the bet
 * was saved with figures other than the ones read, the change is kept as an example for the AI.
 */
async function decide(id, status, saved) {
  if (!['confirmed', 'dismissed'].includes(status)) throw new Error('bad status');
  const before = await WhatsappInbox.findOneAndUpdate({ _id: id, status: 'pending' }, { $set: { status, decidedAt: new Date() } }, { new: false }).lean();
  if (before && status === 'confirmed' && !before.demo) replyOk(before);
  if (before && status === 'confirmed' && saved && !before.demo) {
    try {
      await learn(WhatsappCorrection, before, saved);
    } catch {
      // learning is a bonus: the bet is decided either way
    }
  }
  return !!before;
}

/** Forgets all the corrections. */
async function forgetCorrections() {
  const result = await WhatsappCorrection.deleteMany({});
  return result.deletedCount;
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

module.exports = { getAiSettings, saveAiSettings, testAi, setAiReader, messageIdOf, getTrace, setLookupTimeout, getCounters, pollListened, getActivity, clearActivity, countPending, createDemo, clearDemo, handleIncoming, handleOwn, attach, listPending, decide, forgetCorrections, updateContact, currentContext, requestIdFor };
