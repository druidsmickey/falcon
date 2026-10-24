const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createLoginLimiters } = require('../lib/ratelimit');

// A tiny login route: the password "right" works, anything else is a 401
function startServer(options) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.post('/login', ...createLoginLimiters(options), (req, res) => {
    if (req.body.password === 'right') return res.json({ message: 'ok' });
    res.status(401).json({ message: 'Invalid credentials' });
  });
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/login` }));
  });
}

const post = (url, username, password, ip = '1.1.1.1') =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ username, password }),
  }).then(r => r.status);

test('after too many wrong passwords for one user the next attempt is blocked', async () => {
  const { server, url } = await startServer({ perUser: 3, perAddress: 100 });
  try {
    for (let i = 0; i < 3; i++) assert.equal(await post(url, 'admin', 'wrong'), 401);
    assert.equal(await post(url, 'admin', 'wrong'), 429);
    // even the right password is refused while blocked
    assert.equal(await post(url, 'admin', 'right'), 429);
  } finally {
    server.close();
  }
});

test('another user name from the same address is not blocked by that', async () => {
  const { server, url } = await startServer({ perUser: 2, perAddress: 100 });
  try {
    for (let i = 0; i < 3; i++) await post(url, 'admin', 'wrong');
    assert.equal(await post(url, 'someone', 'wrong'), 401);
  } finally {
    server.close();
  }
});

test('the same user name from another address is not blocked', async () => {
  const { server, url } = await startServer({ perUser: 2, perAddress: 100 });
  try {
    for (let i = 0; i < 3; i++) await post(url, 'admin', 'wrong', '1.1.1.1');
    assert.equal(await post(url, 'admin', 'right', '2.2.2.2'), 200);
  } finally {
    server.close();
  }
});

test('successful logins are not counted', async () => {
  const { server, url } = await startServer({ perUser: 2, perAddress: 100 });
  try {
    for (let i = 0; i < 10; i++) assert.equal(await post(url, 'admin', 'right'), 200);
  } finally {
    server.close();
  }
});

test('one address trying many user names is blocked by the address limit', async () => {
  const { server, url } = await startServer({ perUser: 100, perAddress: 4 });
  try {
    for (let i = 0; i < 4; i++) assert.equal(await post(url, `user${i}`, 'wrong'), 401);
    assert.equal(await post(url, 'user99', 'wrong'), 429);
    // a different address is unaffected
    assert.equal(await post(url, 'user99', 'wrong', '9.9.9.9'), 401);
  } finally {
    server.close();
  }
});
