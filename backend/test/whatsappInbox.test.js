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

test('one message with several lines gives several bets, and unreadable lines are kept for a person', async () => {
  await inbox.handleIncoming(message('1 500x90\nput 500 on the grey\nthanks'));
  const { items } = await inbox.listPending();
  assert.equal(items.length, 2);
  assert.equal(items[1].unreadable, true);
  assert.equal(items[1].unsure, true);
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
  assert.equal(await inbox.createDemo(), 6);
  const { items } = await inbox.listPending();
  assert.equal(items.length, 6);
  assert.ok(items.every(i => i.demo && i.clientName === 'DEMO'));
  assert.equal(items[4].text, 'cap mag 500x90');
  assert.deepEqual([items[4].horseNum, items[4].books], [2, 500]);
  assert.equal(items[5].unreadable, true);
  assert.equal(new Set(items.map(i => i.clientRequestId)).size, 6);

  // trying it twice never collides, and no real contact or odds list is created
  assert.equal(await inbox.createDemo(), 6);
  assert.equal(await WhatsappOdds.countDocuments(), 0);
  assert.equal(await inbox.clearDemo(), 12);
  assert.equal((await inbox.listPending()).items.length, 0);
});

test('the demo works before any meeting exists', async () => {
  assert.equal(await inbox.createDemo(), 5);
  assert.equal((await inbox.listPending()).items.length, 5);
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
