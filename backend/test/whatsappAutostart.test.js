const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sessionExists, autostartEnabled, shouldReconnect, SESSION_FOLDER } = require('../lib/whatsappAutostart');

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
