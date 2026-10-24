const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOddsList, parseBetMessage, emptyContext } = require('../lib/betMessage');

const race1of5 = { raceNum: 1, runners: 5 };
const one = (text, context = race1of5) => {
  const result = parseBetMessage(text, context);
  assert.equal(result.length, 1, `expected one result for "${text}", got ${JSON.stringify(result)}`);
  return result[0];
};

test('odds list with the race and pairs (horse, odds)', () => {
  const list = parseOddsList('r1\n1 1500\n2 500\n3 700\n6 800');
  assert.equal(list.raceNum, 1);
  assert.equal(list.runners, 6);
  assert.deepEqual(list.odds[3], { horseNum: 6, odds: 800 });
});

test('odds list with the race and a column of odds', () => {
  const list = parseOddsList('1\n2000\n500\n3000\n1000\n350');
  assert.equal(list.raceNum, 1);
  assert.equal(list.runners, 5);
  assert.deepEqual(list.odds[4], { horseNum: 5, odds: 350 });
});

test('things that are not odds lists', () => {
  assert.equal(parseOddsList('hello'), null);
  assert.equal(parseOddsList('11 500x90'), null);
  assert.equal(parseOddsList('1\n500'), null); // a bet and an amount, not a list
  assert.equal(parseOddsList('r1\n1 1500\nthanks'), null);
  assert.equal(parseOddsList(''), null);
});

test('books x F500', () => {
  const bet = one('11 500x90');
  assert.deepEqual([bet.raceNum, bet.horseNum, bet.mode, bet.books, bet.f500], [1, 1, 'f500', 500, 90]);
  assert.equal(bet.unsure, false);
  assert.deepEqual(bet.issues, []);
});

test('stake at odds', () => {
  const bet = one('11 5000@2000');
  assert.deepEqual([bet.raceNum, bet.horseNum, bet.mode, bet.stake, bet.odds100], [1, 1, 'odds', 5000, 2000]);
  assert.equal(bet.unsure, false);
});

test('a stake without odds, with and without k', () => {
  for (const text of ['11 5k', '11 5K', '11 5000k'.replace('5000k', '5k')]) {
    const bet = one(text);
    assert.deepEqual([bet.mode, bet.stake, bet.odds100], ['odds', 5000, null]);
    assert.ok(bet.issues.includes('odds missing'));
  }
  assert.equal(one('2 2.5k').stake, 2500);
});

test('a bare number is books or stake and is left to the person', () => {
  const bet = one('1 500');
  assert.deepEqual([bet.raceNum, bet.horseNum, bet.amountKind, bet.amount], [1, 1, '?', 500]);
  assert.equal(bet.unsure, true);
  assert.ok(bet.issues.includes('books or stake?'));
  assert.equal(one('11 5000').amountKind, '?');
});

test('11 is horse 11 when there are enough runners, with a warning that it could be race 1 horse 1', () => {
  const bet = one('11 500x90', { raceNum: 1, runners: 12 });
  assert.equal(bet.horseNum, 11);
  assert.equal(bet.raceNum, 1);
  assert.equal(bet.unsure, true);
  assert.ok(bet.issues.some(i => /race 1 horse 1/.test(i)));
});

test('a horse number inside the field is just that horse', () => {
  const bet = one('3 500x90');
  assert.deepEqual([bet.raceNum, bet.horseNum, bet.unsure], [1, 3, false]);
});

test('two digits that are not a horse are race and horse', () => {
  const bet = one('21 500x90');
  assert.deepEqual([bet.raceNum, bet.horseNum], [2, 1]);
  assert.equal(bet.unsure, true); // not the race of the odds list
  assert.ok(bet.issues.some(i => /race 2/.test(i)));
});

test('race and horse written out', () => {
  const bet = one('3 11 500x90');
  assert.deepEqual([bet.raceNum, bet.horseNum, bet.books, bet.f500, bet.unsure], [3, 11, 500, 90, false]);
  const labelled = one('r2 4 5k');
  assert.deepEqual([labelled.raceNum, labelled.horseNum, labelled.stake], [2, 4, 5000]);
});

test('spaces, capitals, commas and other separators', () => {
  assert.equal(one('11 500 x 90').books, 500);
  assert.equal(one('11 500X90').f500, 90);
  assert.equal(one('11 5,000@2,000').stake, 5000);
  assert.equal(one('11 5000 @ 2000').odds100, 2000);
  assert.equal(one('11 500*90').mode, 'f500');
});

test('without an odds list the race is not known', () => {
  const bet = one('3 500x90', emptyContext());
  assert.equal(bet.raceNum, null);
  assert.ok(bet.issues.includes('race not known'));
  const two = one('11 500x90', emptyContext());
  assert.equal(two.unsure, true);
});

test('several bets in one message, one per line', () => {
  const bets = parseBetMessage('11 500x90\n3 5k\n\n2 1000@500', race1of5);
  assert.equal(bets.length, 3);
  assert.deepEqual(bets.map(b => b.horseNum), [1, 3, 2]);
  assert.equal(bets[2].stake, 1000);
});

test('lines that are not bets are kept, chat without numbers is dropped', () => {
  const result = parseBetMessage('thanks\nput 500 on the favourite\n11 500x90', race1of5);
  assert.equal(result.length, 2);
  assert.equal(result[0].unreadable, true);
  assert.equal(result[0].text, 'put 500 on the favourite');
  assert.equal(result[1].horseNum, 1);
  assert.deepEqual(parseBetMessage('good morning!'), []);
  assert.deepEqual(parseBetMessage(''), []);
  assert.deepEqual(parseBetMessage(null), []);
});

test('a horse that does not exist is flagged', () => {
  const bet = one('0 500x90');
  assert.ok(bet.issues.length > 0);
  assert.equal(bet.unsure, true);
});
