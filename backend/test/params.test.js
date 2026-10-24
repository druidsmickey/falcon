const test = require('node:test');
const assert = require('node:assert/strict');
const { keepWinners, pickParamUpdate } = require('../lib/params');

const rows = [
  { meetingName: 'M', raceNum: 1, horseNum: 1, horseName: 'ONE' },
  { meetingName: 'M', raceNum: 1, horseNum: 2, horseName: 'TWO' },
  { meetingName: 'M', raceNum: 2, horseNum: 1, horseName: 'THREE' },
];

test('a saved winner stays a winner after the params are saved again', () => {
  const result = keepWinners(rows, [{ raceNum: 1, horseNum: 2 }]);
  assert.equal(result.find(r => r.horseName === 'TWO').winner, true);
});

test('horses that were not winners stay without a winner flag', () => {
  const result = keepWinners(rows, [{ raceNum: 1, horseNum: 2 }]);
  assert.equal(result.find(r => r.horseName === 'ONE').winner, undefined);
  assert.equal(result.find(r => r.horseName === 'THREE').winner, undefined);
});

test('the same horse number in another race is not affected', () => {
  const result = keepWinners(rows, [{ raceNum: 1, horseNum: 1 }]);
  assert.equal(result.find(r => r.horseName === 'ONE').winner, true);
  assert.equal(result.find(r => r.horseName === 'THREE').winner, undefined);
});

test('a winner flag sent in the request is respected', () => {
  const sent = [{ ...rows[1], winner: false }];
  const result = keepWinners(sent, [{ raceNum: 1, horseNum: 2 }]);
  assert.equal(result[0].winner, false);
});

test('no existing winners leaves the rows unchanged', () => {
  assert.deepEqual(keepWinners(rows, []), rows);
});

test('does not change the rows it was given', () => {
  const before = JSON.stringify(rows);
  keepWinners(rows, [{ raceNum: 1, horseNum: 1 }]);
  assert.equal(JSON.stringify(rows), before);
});

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
