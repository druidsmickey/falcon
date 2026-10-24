// Runs the real server against a real (throwaway, in-memory) MongoDB and checks the behaviour that
// protects the data: simultaneous saves, duplicate clean-up, bet checks, the 6 day clean-up and the
// network settings.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../model/user');

const backendDir = path.join(__dirname, '..');
const DAY = 24 * 3600 * 1000;
const SECRET = 'integration-test-secret';

let mongod, child, port, base, token;
const log = [];

const freePort = () => new Promise(resolve => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

async function call(method, url, body, headers = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

const horses = (meeting, n, tag = 'H') => Array.from({ length: n }, (_, i) => ({ meetingName: meeting, raceNum: 1, horseNum: i + 1, horseName: `${tag}${i + 1}` }));
const col = name => mongoose.connection.collection(name);

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri() + 'itbtest';
  await mongoose.connect(uri);

  // what the old way of saving left behind: duplicate rows, one of them a winner, and the old plain index
  const t = new Date('2026-10-20T10:00:00Z');
  await col('params').createIndex({ meetingName: 1, raceNum: 1, horseNum: 1 });
  await col('params').insertMany([
    { meetingName: 'DUP', raceNum: 1, horseNum: 1, horseName: 'A', winner: false, createdAt: t, updatedAt: new Date('2026-10-20T12:00:00Z') },
    { meetingName: 'DUP', raceNum: 1, horseNum: 1, horseName: 'B', winner: true, createdAt: new Date('2026-10-19T10:00:00Z'), updatedAt: new Date('2026-10-20T11:00:00Z') },
    { meetingName: 'DUP', raceNum: 1, horseNum: 1, horseName: 'C', winner: false, createdAt: t, updatedAt: new Date('2026-10-20T13:00:00Z') },
    { meetingName: 'DUP', raceNum: 1, horseNum: 2, horseName: 'D', createdAt: t, updatedAt: t },
  ]);
  await col('inits').insertMany([
    { meetingName: 'DUP', raceNum: 1, raceName: 'OLD', numHorse: 2, selected: false, createdAt: new Date('2026-10-18T10:00:00Z'), updatedAt: new Date('2026-10-20T10:00:00Z') },
    { meetingName: 'DUP', raceNum: 1, raceName: 'NEW', numHorse: 2, selected: false, createdAt: new Date('2026-10-20T10:00:00Z'), updatedAt: new Date('2026-10-20T12:00:00Z') },
  ]);

  // meetings older than 6 days, one of them the selected one
  const old = new Date(Date.now() - 10 * DAY);
  for (const [name, selected] of [['OLD UNSELECTED', false], ['OLD SELECTED', true]]) {
    await col('inits').insertOne({ meetingName: name, raceNum: 1, raceName: 'R1', numHorse: 2, selected, createdAt: old, updatedAt: old });
    await col('params').insertOne({ meetingName: name, raceNum: 1, horseNum: 1, horseName: 'X', createdAt: old, updatedAt: old });
    await col('bets').insertOne({ meetingName: name, raceNum: 1, horseNum: 1, horseName: 'X', clientName: 'C', betTime: old, stake: 1, payout: 1, tax: 0, createdAt: old, updatedAt: old });
  }
  const user = new User({ username: 'tester', password: 'secret123', appScope: 'default' });
  await user.save();
  token = jwt.sign({ userId: String(user._id), username: 'tester', appScope: 'default' }, SECRET, { expiresIn: '1h' });

  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: backendDir,
    env: { ...process.env, PORT: String(port), MONGODB_URI: uri, JWT_SECRET: SECRET, CORS_ORIGINS: 'http://allowed.example' },
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not finish starting: ' + log.join(''))), 30000);
    const onData = chunk => { log.push(String(chunk)); if (/Rows checked|Could not make the rows unique/.test(String(chunk))) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
  });
  await ready;
});

test.after(async () => {
  if (child) child.kill();
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

test('start-up removes duplicate rows, keeping a winner, and builds the unique indexes', async () => {
  const horse1 = await col('params').find({ meetingName: 'DUP', horseNum: 1 }).toArray();
  assert.equal(horse1.length, 1, 'one row left for horse 1');
  assert.equal(horse1[0].winner, true, 'the winner row was kept');
  assert.equal(horse1[0].createdAt.toISOString(), '2026-10-19T10:00:00.000Z', 'the earliest creation time was kept');

  const races = await col('inits').find({ meetingName: 'DUP', raceNum: 1 }).toArray();
  assert.equal(races.length, 1);
  assert.equal(races[0].raceName, 'NEW', 'the newest race row was kept');
  assert.equal(races[0].createdAt.toISOString(), '2026-10-18T10:00:00.000Z');

  const paramIndexes = await col('params').indexes();
  const init = await col('inits').indexes();
  assert.ok(paramIndexes.some(i => i.unique && JSON.stringify(i.key) === JSON.stringify({ meetingName: 1, raceNum: 1, horseNum: 1 })), 'unique index on params');
  assert.ok(init.some(i => i.unique && JSON.stringify(i.key) === JSON.stringify({ meetingName: 1, raceNum: 1 })), 'unique index on races');
  assert.equal(paramIndexes.filter(i => JSON.stringify(i.key) === JSON.stringify({ meetingName: 1, raceNum: 1, horseNum: 1 })).length, 1, 'the old plain index was replaced');
});

test('several saves of the Params page at the same time leave one row per horse', async () => {
  const results = await Promise.all(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(tag => call('POST', '/api/params', { params: horses('CONC', 5, tag) })));
  assert.ok(results.every(r => r.status === 200), results.map(r => r.status).join(' '));
  const rows = await col('params').find({ meetingName: 'CONC' }).toArray();
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(r => r.horseNum).sort(), [1, 2, 3, 4, 5]);
});

test('a winner survives saves, also simultaneous ones, and the row ids stay the same', async () => {
  const before = (await call('GET', '/api/params?meetingName=CONC')).data;
  const horse2 = before.find(p => p.horseNum === 2);
  const marked = await call('PATCH', '/api/params/' + horse2._id, { winner: true });
  assert.equal(marked.status, 200);

  await Promise.all(['X', 'Y', 'Z', 'W'].map(tag => call('POST', '/api/params', { params: horses('CONC', 5, tag) })));
  const after = (await call('GET', '/api/params?meetingName=CONC')).data;
  assert.equal(after.length, 5);
  assert.deepEqual(after.filter(p => p.winner).map(p => p.horseNum), [2], 'exactly one winner');
  assert.equal(after.find(p => p.horseNum === 2)._id, horse2._id, 'same row id as before');
});

test('a Params save returns the saved rows and removes horses that are no longer listed', async () => {
  const saved = await call('POST', '/api/params', { params: horses('CONC', 3, 'S') });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.params.map(p => p.horseNum), [1, 2, 3]);
  assert.equal((await col('params').countDocuments({ meetingName: 'CONC' })), 3);
  assert.equal(saved.data.params.find(p => p.horseNum === 2).winner, true, 'the winner is still there');
});

test('an invalid Params save is refused and changes nothing', async () => {
  const bad = await call('POST', '/api/params', { params: [...horses('CONC', 2, 'Q'), { meetingName: 'CONC', raceNum: 1, horseNum: 3, rule4deduct: 500 }] });
  assert.equal(bad.status, 400);
  assert.equal((await col('params').find({ meetingName: 'CONC', horseNum: 1 }).next()).horseName, 'S1');
});

test('several saves of the Init page at the same time leave one row per race', async () => {
  const save = tag => call('POST', '/api/meetings/races', { meetingName: 'RACES', races: [{ raceNum: 1, raceName: 'R' + tag, numHorse: 5 }, { raceNum: 2, raceName: 'S' + tag, numHorse: 6 }], selected: false });
  const results = await Promise.all(['A', 'B', 'C', 'D', 'E', 'F'].map(save));
  assert.ok(results.every(r => r.status === 200), results.map(r => r.status).join(' '));
  assert.equal(await col('inits').countDocuments({ meetingName: 'RACES' }), 2);
});

test('a meeting keeps the time it was first input when its races are saved again', async () => {
  const first = (await col('inits').find({ meetingName: 'RACES' }).sort({ createdAt: 1 }).next()).createdAt.getTime();
  await new Promise(r => setTimeout(r, 1200));
  await call('POST', '/api/meetings/races', { meetingName: 'RACES', races: [{ raceNum: 1, raceName: 'EDIT', numHorse: 5 }, { raceNum: 2, raceName: 'EDIT2', numHorse: 6 }], selected: false });
  const rows = await col('inits').find({ meetingName: 'RACES' }).toArray();
  assert.ok(rows.every(r => r.createdAt.getTime() === first || r.createdAt.getTime() <= first + 5000), 'creation time was not restarted');
  assert.equal(rows.find(r => r.raceNum === 1).raceName, 'EDIT');
});

test('a race that is removed from the list is deleted, and selecting a meeting unselects the others', async () => {
  await call('POST', '/api/meetings/races', { meetingName: 'RACES', races: [{ raceNum: 1, raceName: 'ONLY', numHorse: 5 }], selected: true });
  assert.equal(await col('inits').countDocuments({ meetingName: 'RACES' }), 1);
  await call('POST', '/api/meetings/races', { meetingName: 'OTHER', races: [{ raceNum: 1, raceName: 'R', numHorse: 5 }], selected: true });
  const selected = await col('inits').distinct('meetingName', { selected: true });
  assert.deepEqual(selected, ['OTHER']);
});

test('invalid races are refused', async () => {
  const bad = await call('POST', '/api/meetings/races', { meetingName: 'BAD', races: [{ raceNum: 1, raceName: '', numHorse: 5 }] });
  assert.equal(bad.status, 400);
  assert.equal(await col('inits').countDocuments({ meetingName: 'BAD' }), 0);
});

test('bets: wrong figures are refused, correct ones are saved once, extra fields are ignored', async () => {
  const bet = { meetingName: 'CONC', raceNum: 1, horseNum: 1, horseName: 'S1', clientName: 'ANN', tax: 5, betTime: new Date().toISOString(), f500: 100, books: 10, stake: 1000, payout: 5000, clientRequestId: 'int-1' };
  assert.equal((await call('POST', '/api/bets', { ...bet, payout: 999999, clientRequestId: 'int-bad' })).status, 400);
  const ok = await call('POST', '/api/bets', { ...bet, cancelled: true });
  assert.equal(ok.status, 200);
  const again = await call('POST', '/api/bets', bet);
  assert.equal(again.data.duplicate, true);
  const stored = await col('bets').find({ clientRequestId: 'int-1' }).toArray();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].cancelled, false);
});

test('a login removes every meeting older than 6 days, selected or not, with their data', async () => {
  const login = await call('POST', '/auth/login', { username: 'tester', password: 'secret123' });
  assert.equal(login.status, 200);
  await new Promise(r => setTimeout(r, 1500));
  for (const name of ['OLD UNSELECTED', 'OLD SELECTED']) {
    assert.equal(await col('inits').countDocuments({ meetingName: name }), 0, name + ' races');
    assert.equal(await col('params').countDocuments({ meetingName: name }), 0, name + ' params');
    assert.equal(await col('bets').countDocuments({ meetingName: name }), 0, name + ' bets');
  }
  assert.ok(await col('inits').countDocuments({ meetingName: 'OTHER' }) > 0, 'a recent meeting is kept');
});

test('too many wrong passwords are blocked', async () => {
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await call('POST', '/auth/login', { username: 'nobody', password: 'wrong' })).status);
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(401));
  assert.equal(codes[10], 429);
  assert.equal((await call('POST', '/auth/login', { username: 'tester', password: 'secret123' })).status, 200, 'the real user is not affected');
});

test('headers: no X-Powered-By, and other websites get no CORS permission', async () => {
  const res = await call('GET', '/health', undefined, { Origin: 'https://evil.example' });
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  const allowed = await call('GET', '/health', undefined, { Origin: 'http://allowed.example' });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://allowed.example');
});

test('the server answers only on the loopback address, not on the network address of the machine', async t => {
  const other = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal);
  if (!other) return t.skip('this machine has no other IPv4 address');
  const reachable = await new Promise(resolve => {
    const socket = net.connect({ host: other.address, port, timeout: 2000 });
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
  assert.equal(reachable, false, `${other.address}:${port} must not accept connections`);
});

test('the server refuses to start without a JWT secret', async () => {
  const code = await new Promise(resolve => {
    const p = spawn(process.execPath, ['server.js'], { cwd: backendDir, env: { ...process.env, JWT_SECRET: '', PORT: '0', MONGODB_URI: 'mongodb://127.0.0.1:1/x' } });
    p.on('exit', resolve);
  });
  assert.equal(code, 1);
});
