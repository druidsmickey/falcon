const test = require('node:test');
const assert = require('node:assert/strict');
const { pickParamUpdate } = require('../lib/params');

test('a winner can be set on one horse', () => {
  assert.deepEqual(pickParamUpdate({ winner: true }), { update: { winner: true } });
});

test('only known fields are taken for a single-horse update', () => {
  const r = pickParamUpdate({ winner: false, raceNum: 9, meetingName: 'OTHER', _id: 'x' });
  assert.deepEqual(r, { update: { winner: false } });
});

test('Rule 4 and Special times and the deduction can be set or cleared', () => {
  const r = pickParamUpdate({ rule4: '2026-10-24T11:00:00Z', rule4deduct: 10, special: null });
  assert.equal(r.update.rule4.toISOString(), '2026-10-24T11:00:00.000Z');
  assert.equal(r.update.rule4deduct, 10);
  assert.equal(r.update.special, null);
});

test('wrong types are rejected for a single-horse update', () => {
  assert.ok(pickParamUpdate({ winner: 'yes' }).error);
  assert.ok(pickParamUpdate({ rule4: 'tomorrow' }).error);
  assert.ok(pickParamUpdate({ rule4deduct: 150 }).error);
  assert.ok(pickParamUpdate({ rule4deduct: '10' }).error);
  assert.ok(pickParamUpdate({ horseName: 5 }).error);
});

test('an empty single-horse update is rejected', () => {
  assert.ok(pickParamUpdate({}).error);
  assert.ok(pickParamUpdate({ raceNum: 3 }).error);
  assert.ok(pickParamUpdate(null).error);
});
