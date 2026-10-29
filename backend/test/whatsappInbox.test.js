// The WhatsApp inbox against a real (in-memory) MongoDB: who is listened to, odds lists setting the race,
// bets arriving once, and confirming or dismissing them.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const WhatsappContact = require('../models/whatsappContact');
const WhatsappInbox = require('../models/whatsappInbox');
const WhatsappOdds = require('../models/whatsappOdds');
const Init = require('../models/init');
const Params = require('../models/params');
const inbox = require('../lib/whatsappInbox');

let mongod;
let counter = 0;
const message = (body, over = {}) => ({ id: { _serialized: 'msg-' + ++counter }, body, from: '4477001@c.us', fromMe: false, timestamp: 1790000000 + counter, ...over });
const ownList = body => message(body, { fromMe: true, from: 'me@c.us', to: '123@broadcast' });

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri() + 'inboxtest');
  await WhatsappInbox.init();
  await WhatsappOdds.init();
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test.beforeEach(async () => {
  await Promise.all([WhatsappContact.deleteMany({}), WhatsappInbox.deleteMany({}), WhatsappOdds.deleteMany({}), Init.deleteMany({}), Params.deleteMany({})]);
  await WhatsappContact.create([
    { name: 'Ann Smith', number: '4477001@c.us', nickname: 'Annie', listen: true },
    { name: 'Bob Jones', number: '4477002@c.us', listen: true },
    { name: 'Cat Silent', number: '4477003@c.us', listen: false },
  ]);
});

test('a bet from a listened contact waits in the inbox under the nickname', async () => {
  await inbox.handleOwn(ownList('r1\n1 1500\n2 500\n3 700\n5 800'));
  assert.equal(await inbox.handleIncoming(message('11 500x90')), 1);

  const { items, odds } = await inbox.listPending();
  assert.equal(items.length, 1);
  assert.equal(items[0].clientName, 'ANNIE');
  assert.deepEqual([items[0].raceNum, items[0].horseNum, items[0].mode, items[0].books, items[0].f500], [1, 1, 'f500', 500, 90]);
  assert.equal(items[0].text, '11 500x90');
  assert.match(items[0].clientRequestId, /^wa-[0-9a-f]{24}$/);
  assert.deepEqual([odds.raceNum, odds.runners], [1, 5]);
});

test('without a nickname the contact name is used', async () => {
  await inbox.handleIncoming(message('1 5k', { from: '4477002@c.us' }));
  assert.equal((await inbox.listPending()).items[0].clientName, 'BOB JONES');
});

test('contacts that are not listened to, and strangers, are ignored', async () => {
  assert.equal(await inbox.handleIncoming(message('1 5k', { from: '4477003@c.us' })), 0);
  assert.equal(await inbox.handleIncoming(message('1 5k', { from: '9999999@c.us' })), 0);
  assert.equal((await inbox.listPending()).items.length, 0);
});

test('a message sent from the account itself is never read as a bet, and group messages use the sender', async () => {
  assert.equal(await inbox.handleIncoming(message('1 5k', { fromMe: true })), 0);
  assert.equal(await inbox.handleIncoming(message('1 5k', { from: 'group@g.us', author: '4477001@c.us' })), 1);
  assert.equal(await inbox.handleIncoming(message('1 5k', { from: 'status@broadcast' })), 0);
});

test('the same message arriving twice is stored once', async () => {
  const m = message('1 500x90\n2 5k');
  assert.equal(await inbox.handleIncoming(m), 2);
  assert.equal(await inbox.handleIncoming(m), 0);
  assert.equal((await inbox.listPending()).items.length, 2);
});

test('one message with several lines gives several bets, and a sentence with a figure keeps its amount', async () => {
  await inbox.handleIncoming(message('1 500x90\nput 500 on the grey\nthanks'));
  const { items } = await inbox.listPending();
  assert.equal(items.length, 2);
  assert.deepEqual([items[1].unreadable, items[1].unsure, items[1].amountKind, items[1].amount, items[1].horseNum], [false, true, '?', 500, null]);
});

test('the latest odds list decides how 11 is read', async () => {
  await inbox.handleOwn(ownList('r1\n1 1500\n2 500\n3 700\n6 800'));
  await inbox.handleIncoming(message('11 500x90'));
  await inbox.handleOwn(ownList('r2\n' + Array.from({ length: 14 }, (_, i) => `${i + 1} ${1000 + i}`).join('\n')));
  await inbox.handleIncoming(message('11 500x90'));
  const { items } = await inbox.listPending();
  assert.deepEqual([items[0].raceNum, items[0].horseNum, items[0].unsure], [1, 1, false]);
  assert.deepEqual([items[1].raceNum, items[1].horseNum, items[1].unsure], [2, 11, true]);
});

test('odds lists are only taken from the account itself, and only once', async () => {
  assert.equal(await inbox.handleOwn(message('r1\n1 1500\n2 500')), false); // from a contact
  const list = ownList('r1\n1 1500\n2 500');
  assert.equal(await inbox.handleOwn(list), true);
  assert.equal(await inbox.handleOwn(list), false);
  assert.equal(await inbox.handleOwn(ownList('see you tomorrow')), false);
  assert.equal(await WhatsappOdds.countDocuments(), 1);
});

test('confirming or dismissing takes a bet out of the inbox, once', async () => {
  await inbox.handleIncoming(message('1 500x90\n2 5k'));
  const { items } = await inbox.listPending();
  assert.equal(await inbox.decide(items[0].id, 'confirmed'), true);
  assert.equal(await inbox.decide(items[0].id, 'confirmed'), false);
  assert.equal(await inbox.decide(items[0].id, 'dismissed'), false);
  assert.equal(await inbox.decide(items[1].id, 'dismissed'), true);
  assert.equal((await inbox.listPending()).items.length, 0);
  assert.equal(await inbox.countPending(), 0);
  assert.equal(await WhatsappInbox.countDocuments({ status: 'confirmed' }), 1);
});

test('changing a nickname renames the bets still waiting, and the settings are checked', async () => {
  await inbox.handleIncoming(message('1 5k'));
  const ann = await WhatsappContact.findOne({ name: 'Ann Smith' });
  await inbox.updateContact(ann._id, { nickname: ' Big Ann ' });
  assert.equal((await inbox.listPending()).items[0].clientName, 'BIG ANN');

  await inbox.updateContact(ann._id, { nickname: '' });
  assert.equal((await inbox.listPending()).items[0].clientName, 'ANN SMITH');

  await assert.rejects(() => inbox.updateContact(ann._id, { listen: 'yes' }));
  await assert.rejects(() => inbox.updateContact(ann._id, { nickname: 'x'.repeat(101) }));
  assert.equal(await inbox.updateContact(new mongoose.Types.ObjectId(), { listen: true }), null);

  await inbox.updateContact(ann._id, { listen: false });
  assert.equal(await inbox.handleIncoming(message('1 5k')), 0);
});

test('a bet that names its horse is matched against the horses of the selected meeting', async () => {
  await Init.create({ meetingName: 'ASCOT', raceNum: 1, numHorse: 3, raceName: 'R1', selected: true });
  await Init.create({ meetingName: 'OLD', raceNum: 1, numHorse: 3, raceName: 'R1', selected: false });
  await Params.create([
    { meetingName: 'ASCOT', raceNum: 1, horseNum: 1, horseName: 'Dambuster' },
    { meetingName: 'ASCOT', raceNum: 1, horseNum: 2, horseName: 'Captain Magpie' },
    { meetingName: 'ASCOT', raceNum: 1, horseNum: 3, horseName: 'Lux Star' },
    { meetingName: 'OLD', raceNum: 1, horseNum: 1, horseName: 'Magic Man' },
  ]);
  await inbox.handleOwn(ownList('r1\n1 1500\n2 500\n3 700'));

  assert.equal(await inbox.handleIncoming(message('cap mag 500x90\nlux 5k\nmagic 500x90')), 3);
  const { items } = await inbox.listPending();
  assert.deepEqual([items[0].raceNum, items[0].horseNum, items[0].books, items[0].unsure], [1, 2, 500, false]);
  assert.deepEqual([items[1].horseNum, items[1].stake], [3, 5000]);
  // a horse of an earlier meeting is not in the list
  assert.equal(items[2].horseNum, null);
  assert.equal(items[2].unsure, true);
});

test('the demo adds sample bets that the real parser read, and they can be removed', async () => {
  await Init.create({ meetingName: 'ASCOT', raceNum: 1, numHorse: 3, raceName: 'R1', selected: true });
  await Params.create([
    { meetingName: 'ASCOT', raceNum: 1, horseNum: 1, horseName: 'Dambuster' },
    { meetingName: 'ASCOT', raceNum: 1, horseNum: 2, horseName: 'Captain Magpie' },
    { meetingName: 'ASCOT', raceNum: 1, horseNum: 3, horseName: 'Lux Star' },
  ]);
  assert.equal(await inbox.createDemo(), 7);
  const { items } = await inbox.listPending();
  assert.equal(items.length, 7);
  assert.ok(items.every(i => i.demo && i.clientName === 'DEMO'));
  assert.equal(items[5].text, 'cap mag 500 on 120');
  assert.deepEqual([items[5].horseNum, items[5].books, items[5].f500], [2, 500, 120]);
  assert.deepEqual([items[1].stake, items[1].odds100], [5000, 420]);
  assert.deepEqual([items[4].amountKind, items[4].amount, items[4].rate], ['?', 500, 200]);
  assert.deepEqual([items[6].amountKind, items[6].amount, items[6].horseNum, items[6].unsure], ['?', 500, null, true]);
  assert.equal(new Set(items.map(i => i.clientRequestId)).size, 7);

  // trying it twice never collides, and no real contact or odds list is created
  assert.equal(await inbox.createDemo(), 7);
  assert.equal(await WhatsappOdds.countDocuments(), 0);
  assert.equal(await inbox.clearDemo(), 14);
  assert.equal((await inbox.listPending()).items.length, 0);
});

test('the demo works before any meeting exists', async () => {
  assert.equal(await inbox.createDemo(), 6);
  assert.equal((await inbox.listPending()).items.length, 6);
});

test('the number of bets waiting for approval follows what arrives and what is decided', async () => {
  assert.equal(await inbox.countPending(), 0);
  await inbox.handleIncoming(message('1 500x90'));
  await inbox.handleIncoming(message('2 5k\n3 500x80'));
  assert.equal(await inbox.countPending(), 3);
  const { items } = await inbox.listPending();
  await inbox.decide(items[0].id, 'confirmed');
  await inbox.decide(items[1].id, 'dismissed');
  assert.equal(await inbox.countPending(), 1);
});

// ---------------------------------------------------------------- copying the contacts of the phone

const { usableContacts, syncContacts } = require('../lib/contactSync');
const phone = (name, number, over = {}) => ({ name, id: { _serialized: number }, isUser: true, isMe: false, ...over });

test('only named people are taken from the phone, once each', () => {
  const list = usableContacts([
    phone('Ann Smith', '1@c.us'),
    phone('Ann Smith again', '1@c.us'),
    phone('A Group', '2@g.us', { isUser: false }),
    phone('Me', '3@c.us', { isMe: true }),
    phone('', '4@c.us'),
    phone(undefined, '5@c.us'),
    { name: 'No id', isUser: true },
    phone('  Bob Jones ', '6@c.us'),
    null,
  ]);
  assert.deepEqual(list, [{ number: '1@c.us', name: 'Ann Smith' }, { number: '6@c.us', name: 'Bob Jones' }]);
  assert.deepEqual(usableContacts(undefined), []);
});

test('syncing adds new contacts and keeps the nickname and listen choice of saved ones', async () => {
  // beforeEach saved Ann (nickname Annie, listening), Bob and Cat
  const result = await syncContacts([
    { number: '4477001@c.us', name: 'Ann Smith-Jones' },
    { number: '4477002@c.us', name: 'Bob Jones' },
    { number: '9@c.us', name: 'Dan New' },
  ]);
  assert.deepEqual(result, { total: 3, added: 1, renamed: 1 });

  const ann = await WhatsappContact.findOne({ number: '4477001@c.us' });
  assert.deepEqual([ann.name, ann.nickname, ann.listen], ['Ann Smith-Jones', 'Annie', true]);
  const dan = await WhatsappContact.findOne({ number: '9@c.us' });
  assert.deepEqual([dan.name, dan.nickname, dan.listen], ['Dan New', '', false]);
  assert.equal(await WhatsappContact.countDocuments(), 4);

  // a second sync changes nothing
  assert.deepEqual(await syncContacts([{ number: '9@c.us', name: 'Dan New' }]), { total: 1, added: 0, renamed: 0 });
});

// ---------------------------------------------------------------- hidden ids, and explaining what happened to a message

test('a sender named by a hidden id is found through its contact', async () => {
  const hidden = message('11 500x90', { from: '55501234567890@lid', getContact: async () => ({ id: { _serialized: '4477001@c.us' }, number: '4477001' }) });
  assert.equal(await inbox.handleIncoming(hidden), 1);
  assert.equal((await inbox.listPending()).items[0].clientName, 'ANNIE');

  // when the contact cannot be asked, the phone number inside the contact is enough
  const byNumber = message('2 5k', { from: '999@lid', getContact: async () => ({ id: { _serialized: '999@lid' }, number: '4477002' }) });
  assert.equal(await inbox.handleIncoming(byNumber), 1);

  const failing = message('3 5k', { from: '4477001@c.us', getContact: async () => { throw new Error('gone'); } });
  assert.equal(await inbox.handleIncoming(failing), 1);
});

test('the server says what it did with each message', async () => {
  inbox.clearActivity();
  await inbox.handleIncoming(message('11 500x90')); // Ann, listened to
  await inbox.handleIncoming(message('hello', { from: '4477001@c.us' })); // nothing to read
  await inbox.handleIncoming(message('1 5k', { from: '4477003@c.us' })); // Cat, saved but not listened to
  await inbox.handleIncoming(message('1 5k', { from: '9999999@c.us' })); // not saved
  const m = message('1 5k\n2 5k', { from: '4477002@c.us' });
  await inbox.handleIncoming(m);
  assert.equal(await inbox.handleIncoming(m), 0); // the same message announced again is read once

  const log = inbox.getActivity();
  const results = log.map(a => a.result).reverse();
  assert.deepEqual(results, [
    'added 1 bet to the inbox',
    'nothing to read in it (no bet, or only numbers)',
    'contact is saved but not ticked to listen to',
    'not a saved contact: press "Sync contacts from the phone"',
    'added 2 bets to the inbox',
  ]);
  // the text is only kept for contacts that are listened to
  assert.equal(log.find(a => a.name === 'Cat Silent').text, null);
  assert.equal(log.find(a => a.from.startsWith('9999999')).text, null);
  assert.equal(log[log.length - 1].text, '11 500x90');
  assert.equal(log.length <= 30, true);
});

test('a message without text is noted, and a message announced twice is read once', async () => {
  inbox.clearActivity();
  const photo = message('', { from: '4477001@c.us', body: '' });
  assert.equal(await inbox.handleIncoming(photo), 0);
  assert.equal(inbox.getActivity()[0].result, 'no text in it (photo, voice note or similar)');

  const m = message('1 500x90');
  assert.equal(await inbox.handleIncoming(m), 1);
  assert.equal(await inbox.handleIncoming({ ...m }), 0);
  assert.equal(await WhatsappInbox.countDocuments(), 1);
});

test('both message events of the client feed the inbox', async () => {
  const handlers = {};
  inbox.attach({ on: (name, handler) => { handlers[name] = handler; } });
  assert.deepEqual(Object.keys(handlers).sort(), ['message', 'message_create']);

  const m = message('2 5k');
  handlers.message_create(m); // an incoming message announced only by message_create
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(await WhatsappInbox.countDocuments(), 1);

  handlers.message(m); // announced again by message: not read twice
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(await WhatsappInbox.countDocuments(), 1);

  const own = message('r1\n1 1500\n2 500', { fromMe: true, from: 'me@c.us' });
  handlers.message_create(own);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(await WhatsappOdds.countDocuments(), 1);
});

// ---------------------------------------------------------------- the fallback: asking the chats for their latest messages

const fakeClient = chats => ({
  getChatById: async id => {
    if (!chats[id]) throw new Error('no chat');
    return { fetchMessages: async () => chats[id] };
  },
});
const sent = (body, ago = 60, over = {}) => message(body, { timestamp: Math.floor(Date.now() / 1000) - ago, ...over });

test('messages the live events missed are taken from the chats of the listened contacts', async () => {
  inbox.clearActivity();
  const missed = sent('11 500x90', 120);
  const older = sent('2 5k', 5 * 3600); // too old: from before the connection came back
  const mine = sent('3 5k', 30, { fromMe: true });
  const client = fakeClient({ '4477001@c.us': [missed, older, mine], '4477003@c.us': [sent('4 5k')] }); // Cat is not listened to
  assert.equal(await inbox.pollListened(client), 1);
  const { items } = await inbox.listPending();
  assert.deepEqual(items.map(i => i.text), ['11 500x90']);
  assert.equal(items[0].clientName, 'ANNIE');
  assert.equal(inbox.getCounters().polled, 1);
});

test('a message seen by an event and by the fallback is read once, and bets come in the order they were sent', async () => {
  inbox.clearActivity();
  const first = sent('1 500x90', 300);
  const second = sent('2 500x90', 100);
  await inbox.handleIncoming(second); // the live event for the second one
  const client = fakeClient({ '4477001@c.us': [second, first] });
  assert.equal(await inbox.pollListened(client), 1); // only the first is new
  const { items } = await inbox.listPending();
  assert.equal(items.length, 2);
  assert.equal(await inbox.pollListened(client), 0);
});

test('the fallback copes with chats that cannot be opened', async () => {
  const client = fakeClient({}); // no chats at all
  assert.equal(await inbox.pollListened(client), 0);
  const broken = { getChatById: async () => ({ fetchMessages: async () => { throw new Error('page closed'); } }) };
  assert.equal(await inbox.pollListened(broken), 0);
});

test('what WhatsApp announced is counted, also when it is ignored', async () => {
  inbox.clearActivity();
  const handlers = {};
  inbox.attach({ on: (name, h) => { handlers[name] = h; } }, { pollEveryMs: 0 });
  handlers.message(message('1 5k'));
  handlers.message_create(message('x', { fromMe: true, from: 'me@c.us' }));
  handlers.message_create(message('y', { isStatus: true, from: 'status@broadcast' }));
  await new Promise(resolve => setTimeout(resolve, 300));
  const c = inbox.getCounters();
  assert.equal(c.events, 3);
  assert.equal(c.ignored.fromMe, 1);
  assert.equal(c.ignored.status, 1);
  assert.ok(c.lastEventAt);
});

test('a hidden sender id is turned into the phone number by WhatsApp', async () => {
  inbox.clearActivity();
  const client = { getContactLidAndPhone: async ids => ids.map(lid => ({ lid, pn: '4477001@c.us' })) };
  const m = message('41 20k @ 1000', { from: '123456789@lid', client });
  assert.equal(await inbox.handleIncoming(m), 1);
  const [bet] = (await inbox.listPending()).items;
  assert.deepEqual([bet.clientName, bet.raceNum, bet.horseNum, bet.stake, bet.odds100], ['ANNIE', 4, 1, 20000, 1000]);
});

test('each message is counted once although WhatsApp announces it twice, and what happened to the others is tallied', async () => {
  inbox.clearActivity();
  const handlers = {};
  inbox.attach({ on: (name, h) => { handlers[name] = h; } }, { pollEveryMs: 0 });
  const mine = message('hello', { fromMe: true, from: 'me@c.us' });
  handlers.message(mine);
  handlers.message_create(mine);
  const ann = message('41 20k @ 1000');
  handlers.message(ann);
  handlers.message_create(ann);
  const cat = message('1 5k', { from: '4477003@c.us' });
  handlers.message(cat);
  const stranger = message('1 5k', { from: '9999999@c.us' });
  handlers.message(stranger);
  await new Promise(resolve => setTimeout(resolve, 400));

  const c = inbox.getCounters();
  assert.equal(c.events, 4);
  assert.equal(c.ignored.fromMe, 1);
  assert.deepEqual(c.results, { added: 1, notSaved: 1, notListened: 1, nothingToRead: 0, noText: 0 });
});
