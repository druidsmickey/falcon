const test = require('node:test');
const assert = require('node:assert/strict');
const { keepWinners } = require('../lib/params');

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
