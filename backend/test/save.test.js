const test = require('node:test');
const assert = require('node:assert/strict');
const { buildParamSave, buildRaceSave, paramPreference, newestFirst, splitDuplicates } = require('../lib/save');

const row = (n, extra = {}) => ({ meetingName: 'M', raceNum: 1, horseNum: n, horseName: 'H' + n, special: null, rule4: null, rule4deduct: null, ...extra });

test('each horse becomes one write, found by meeting, race and horse number', () => {
  const r = buildParamSave([row(1), row(2)]);
  assert.equal(r.error, undefined);
  assert.equal(r.meetingName, 'M');
  assert.equal(r.ops.length, 2);
  assert.deepEqual(r.ops[0].updateOne.filter, { meetingName: 'M', raceNum: 1, horseNum: 1 });
  assert.equal(r.ops[0].updateOne.upsert, true);
  assert.deepEqual(r.keys, [{ raceNum: 1, horseNum: 1 }, { raceNum: 1, horseNum: 2 }]);
});

test('the winner flag is not written unless the page sends it', () => {
  const r = buildParamSave([row(1)]);
  assert.equal('winner' in r.ops[0].updateOne.update.$set, false);
  const withWinner = buildParamSave([row(1, { winner: true })]);
  assert.equal(withWinner.ops[0].updateOne.update.$set.winner, true);
});

test('times and the deduction are written, and cleared when empty', () => {
  const r = buildParamSave([row(1, { rule4: '2026-10-24T11:00:00Z', rule4deduct: 10 }), row(2)]);
  assert.equal(r.ops[0].updateOne.update.$set.rule4.toISOString(), '2026-10-24T11:00:00.000Z');
  assert.equal(r.ops[0].updateOne.update.$set.rule4deduct, 10);
  assert.equal(r.ops[1].updateOne.update.$set.rule4, null);
  assert.equal(r.ops[1].updateOne.update.$set.rule4deduct, null);
});

test('missing optional fields count as empty', () => {
  const r = buildParamSave([{ meetingName: 'M', raceNum: 1, horseNum: 1 }]);
  assert.deepEqual(r.ops[0].updateOne.update.$set, { horseName: '', special: null, rule4: null, rule4deduct: null });
});

test('a horse sent twice is written once, the last one winning', () => {
  const r = buildParamSave([row(1, { horseName: 'FIRST' }), row(1, { horseName: 'LAST' })]);
  assert.equal(r.ops.length, 1);
  assert.equal(r.ops[0].updateOne.update.$set.horseName, 'LAST');
});

test('no rows is fine and writes nothing', () => {
  assert.deepEqual(buildParamSave([]), { meetingName: null, ops: [], keys: [] });
});

test('bad rows are refused', () => {
  assert.ok(buildParamSave('x').error);
  assert.ok(buildParamSave([row(1), { ...row(2), meetingName: 'OTHER' }]).error);
  assert.ok(buildParamSave([{ ...row(1), meetingName: '' }]).error);
  assert.ok(buildParamSave([{ ...row(1), raceNum: 0 }]).error);
  assert.ok(buildParamSave([{ ...row(1), horseNum: 1.5 }]).error);
  assert.ok(buildParamSave([{ ...row(1), horseName: 42 }]).error);
  assert.ok(buildParamSave([{ ...row(1), rule4: 'tomorrow' }]).error);
  assert.ok(buildParamSave([{ ...row(1), rule4deduct: 150 }]).error);
  assert.ok(buildParamSave([{ ...row(1), rule4deduct: '10' }]).error);
  assert.ok(buildParamSave([{ ...row(1), winner: 'yes' }]).error);
  assert.ok(buildParamSave([null]).error);
});

test('unknown fields in a row are ignored', () => {
  const r = buildParamSave([row(1, { _id: 'x', createdAt: '2000-01-01', isAdmin: true })]);
  assert.deepEqual(Object.keys(r.ops[0].updateOne.update.$set).sort(), ['horseName', 'rule4', 'rule4deduct', 'special']);
});

test('races are written in place, found by meeting and race number', () => {
  const r = buildRaceSave('M', [{ raceNum: 1, raceName: ' R1 ', numHorse: 8 }, { raceNum: 2, raceName: 'R2', numHorse: 6 }], true);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.ops[0].updateOne.filter, { meetingName: 'M', raceNum: 1 });
  assert.deepEqual(r.ops[0].updateOne.update.$set, { raceName: 'R1', numHorse: 8, selected: true });
  assert.deepEqual(r.keys, [{ raceNum: 1 }, { raceNum: 2 }]);
});

test('bad races are refused', () => {
  assert.ok(buildRaceSave('M', [], false).error);
  assert.ok(buildRaceSave('M', 'x', false).error);
  assert.ok(buildRaceSave('M', [{ raceNum: 0, raceName: 'R', numHorse: 5 }], false).error);
  assert.ok(buildRaceSave('M', [{ raceNum: 1, raceName: '  ', numHorse: 5 }], false).error);
  assert.ok(buildRaceSave('M', [{ raceNum: 1, raceName: 'R', numHorse: 0 }], false).error);
  assert.ok(buildRaceSave('M', [{ raceNum: 1, raceName: 'R', numHorse: '5' }], false).error);
});

test('of duplicate horses a winner is kept, then the newest', () => {
  const docs = [
    { _id: 'a', winner: false, updatedAt: '2026-10-24T10:00:00Z' },
    { _id: 'b', winner: true, updatedAt: '2026-10-24T08:00:00Z' },
    { _id: 'c', winner: false, updatedAt: '2026-10-24T12:00:00Z' },
  ];
  const { keep, remove } = splitDuplicates(docs, paramPreference);
  assert.equal(keep._id, 'b');
  assert.deepEqual(remove.sort(), ['a', 'c']);

  const noWinner = splitDuplicates(docs.map(d => ({ ...d, winner: false })), paramPreference);
  assert.equal(noWinner.keep._id, 'c');
});

test('of duplicate races the newest is kept', () => {
  const { keep, remove } = splitDuplicates([
    { _id: 'a', updatedAt: '2026-10-24T10:00:00Z' },
    { _id: 'b', updatedAt: '2026-10-24T11:00:00Z' },
  ], newestFirst);
  assert.equal(keep._id, 'b');
  assert.deepEqual(remove, ['a']);
});
