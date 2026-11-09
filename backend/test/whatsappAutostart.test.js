const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sessionExists, autostartEnabled, shouldReconnect, restartHour, nextRestartAt, SESSION_FOLDER } = require('../lib/whatsappAutostart');

test('a saved session is found only when the folder has something in it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-'));
  assert.equal(sessionExists(dir), false);
  fs.mkdirSync(path.join(dir, SESSION_FOLDER));
  assert.equal(sessionExists(dir), false); // empty
  fs.writeFileSync(path.join(dir, SESSION_FOLDER, 'Default'), 'x');
  assert.equal(sessionExists(dir), true);
  assert.equal(sessionExists(path.join(dir, 'missing')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('connecting by itself can be switched off, and never happens in tests', () => {
  assert.equal(autostartEnabled({}), true);
  assert.equal(autostartEnabled({ WHATSAPP_AUTOSTART: 'false' }), false);
  assert.equal(autostartEnabled({ WHATSAPP_AUTOSTART: 'FALSE' }), false);
  assert.equal(autostartEnabled({ WHATSAPP_AUTOSTART: 'true' }), true);
  assert.equal(autostartEnabled({ NODE_ENV: 'test' }), false);
});

test('a lost connection is taken up again, but not after the phone logged the device out', () => {
  assert.equal(shouldReconnect('NAVIGATION'), true);
  assert.equal(shouldReconnect('CONFLICT'), true);
  assert.equal(shouldReconnect(undefined), true);
  assert.equal(shouldReconnect('LOGOUT'), false);
  assert.equal(shouldReconnect('logout'), false);
});

test('stale Chrome lock files are removed from the saved session, and the session itself is kept', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { removeStaleLocks, sessionExists, SESSION_FOLDER } = require('../lib/whatsappAutostart');
  const auth = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-'));
  const folder = path.join(auth, SESSION_FOLDER);
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'SingletonLock'), 'x');
  fs.writeFileSync(path.join(folder, 'SingletonCookie'), 'x');
  fs.writeFileSync(path.join(folder, 'Cookies'), 'keep');
  removeStaleLocks(auth);
  assert.deepEqual(fs.readdirSync(folder), ['Cookies']);
  assert.equal(sessionExists(auth), true);
  fs.rmSync(auth, { recursive: true, force: true });
});

test('the nightly restart hour: 23 by default, set or switched off in .env', () => {
  assert.equal(restartHour({}), 23);
  assert.equal(restartHour({ WHATSAPP_RESTART_HOUR: '3' }), 3);
  assert.equal(restartHour({ WHATSAPP_RESTART_HOUR: 'off' }), null);
  assert.equal(restartHour({ WHATSAPP_RESTART_HOUR: '99' }), 23); // nonsense: the default
  assert.equal(restartHour({ NODE_ENV: 'test' }), null);
});

test('the next restart is always in the future, today or tomorrow', () => {
  const before = new Date(2026, 10, 9, 10, 30);
  const after = new Date(2026, 10, 9, 23, 30);
  assert.deepEqual([nextRestartAt(23, before).getDate(), nextRestartAt(23, before).getHours()], [9, 23]);
  assert.deepEqual([nextRestartAt(23, after).getDate(), nextRestartAt(23, after).getHours()], [10, 23]);
  assert.ok(nextRestartAt(23, new Date(2026, 10, 9, 23, 0, 0, 0)).getTime() > new Date(2026, 10, 9, 23, 0, 0, 0).getTime());
});
