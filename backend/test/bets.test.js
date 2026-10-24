const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBet } = require('../lib/bets');

const NOW = new Date('2026-10-24T10:00:00Z').getTime();
const base = {
  meetingName: 'TEST MEETING',
  raceNum: 1,
  horseNum: 3,
  horseName: 'DAMBUSTER',
  clientName: 'JOHN',
  tax: 5,
  betTime: '2026-10-24T09:30:00Z',
  clientRequestId: 'abc-123',
};

// What the app sends for 10 books at F500 = 100
const f500Bet = { ...base, f500: 100, books: 10, stake: 1000, payout: 5000 };
// What the app sends for a stake of 2000 at odds 550
const oddsBet = { ...base, odds100: 550, stake: 2000, books: (2000 * 550) / 50000, payout: (550 * 2000) / 100 };

test('a correct F500 bet is accepted', () => {
  const r = validateBet(f500Bet, NOW);
  assert.equal(r.error, undefined);
  assert.equal(r.value.stake, 1000);
  assert.equal(r.value.payout, 5000);
  assert.equal(r.value.f500, 100);
});

test('a correct odds bet is accepted', () => {
  const r = validateBet(oddsBet, NOW);
  assert.equal(r.error, undefined);
  assert.equal(r.value.books, 22);
  assert.equal(r.value.payout, 11000);
});

test('a purchase (negative values) is accepted', () => {
  const r = validateBet({ ...f500Bet, books: -10, stake: -1000, payout: -5000 }, NOW);
  assert.equal(r.error, undefined);
  assert.equal(r.value.stake, -1000);
});

test('a payout that does not match is rejected', () => {
  const r = validateBet({ ...f500Bet, payout: 999999 }, NOW);
  assert.match(r.error, /payout does not match/);
});

test('a stake that does not match is rejected', () => {
  const r = validateBet({ ...oddsBet, books: 1 }, NOW);
  assert.match(r.error, /books does not match/);
});

test('the server stores its own computed figures', () => {
  const r = validateBet({ ...f500Bet, stake: 1000.004 }, NOW);
  assert.equal(r.value.stake, 1000);
});

test('fields that are not part of a bet are dropped', () => {
  const r = validateBet({ ...f500Bet, cancelled: true, createdAt: '2000-01-01', _id: 'x', isAdmin: true }, NOW);
  assert.equal(r.value.cancelled, undefined);
  assert.equal(r.value.createdAt, undefined);
  assert.equal(r.value._id, undefined);
  assert.equal(r.value.isAdmin, undefined);
});

test('both f500 and odds100, or neither, is rejected', () => {
  assert.ok(validateBet({ ...f500Bet, odds100: 500 }, NOW).error);
  const { f500, ...none } = f500Bet;
  assert.ok(validateBet(none, NOW).error);
});

test('missing or empty text fields are rejected', () => {
  assert.ok(validateBet({ ...f500Bet, clientName: '  ' }, NOW).error);
  assert.ok(validateBet({ ...f500Bet, meetingName: undefined }, NOW).error);
  assert.ok(validateBet({ ...f500Bet, horseName: 42 }, NOW).error);
});

test('race and horse number must be whole numbers', () => {
  assert.ok(validateBet({ ...f500Bet, raceNum: 0 }, NOW).error);
  assert.ok(validateBet({ ...f500Bet, horseNum: 2.5 }, NOW).error);
  assert.ok(validateBet({ ...f500Bet, raceNum: '1' }, NOW).error);
});

test('tax must be from 0 to 100', () => {
  assert.ok(validateBet({ ...f500Bet, tax: -1 }, NOW).error);
  assert.ok(validateBet({ ...f500Bet, tax: 101 }, NOW).error);
  assert.ok(validateBet({ ...f500Bet, tax: null }, NOW).error);
  assert.equal(validateBet({ ...f500Bet, tax: 0 }, NOW).error, undefined);
});

test('NaN, Infinity and strings are rejected as amounts', () => {
  assert.ok(validateBet({ ...f500Bet, books: NaN }, NOW).error);
  assert.ok(validateBet({ ...f500Bet, books: Infinity }, NOW).error);
  assert.ok(validateBet({ ...f500Bet, books: '10' }, NOW).error);
  assert.ok(validateBet({ ...f500Bet, stake: '1000' }, NOW).error);
});

test('a zero stake or zero books is rejected', () => {
  assert.ok(validateBet({ ...f500Bet, books: 0, stake: 0, payout: 0 }, NOW).error);
});

test('a bet time in the far future is rejected, an old one (offline) is accepted', () => {
  assert.ok(validateBet({ ...f500Bet, betTime: '2027-01-01T00:00:00Z' }, NOW).error);
  assert.equal(validateBet({ ...f500Bet, betTime: '2026-10-20T08:00:00Z' }, NOW).error, undefined);
  assert.ok(validateBet({ ...f500Bet, betTime: 'not a date' }, NOW).error);
});

test('a body that is not an object is rejected without crashing', () => {
  assert.ok(validateBet(null, NOW).error);
  assert.ok(validateBet('x', NOW).error);
  assert.ok(validateBet(undefined, NOW).error);
});
