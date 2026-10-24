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

// ---------------------------------------------------------------- the size of the second figure decides

const horseList = [
  { raceNum: 1, horseNum: 1, horseName: 'Dambuster' },
  { raceNum: 1, horseNum: 2, horseName: 'Captain Magpie' },
  { raceNum: 1, horseNum: 3, horseName: 'Lux Star' },
];
const withHorses = { raceNum: 1, runners: 5, horses: horseList };

test('one figure is books or a stake, never unreadable', () => {
  for (const text of ['capt mag 500', 'capmag 500', '11 500']) {
    const bet = one(text, withHorses);
    assert.deepEqual([bet.amountKind, bet.amount, bet.mode, bet.rate], ['?', 500, null, null], text);
    assert.ok(bet.issues.includes('books or stake?'), text);
  }
  assert.equal(one('capt mag 500', withHorses).horseNum, 2);
  assert.equal(one('11 500', withHorses).horseNum, 1);
});

test('a second figure up to 120 is an F500: books at that price, whatever sits between', () => {
  const texts = ['capt mag 500x120', 'capt mag 500 120', '11 500@120', '11 500 #120', '11 500c120', '11 500z120', '11 500 lor 120', '11 500 on 120', '11 500 x 120', '11 500*120'];
  for (const text of texts) {
    const bet = one(text, withHorses);
    assert.deepEqual([bet.mode, bet.books, bet.f500, bet.stake, bet.odds100, bet.amountKind, bet.unsure], ['f500', 500, 120, null, null, 'books', false], text);
  }
  assert.equal(one('11 500 90', withHorses).f500, 90);
  assert.equal(one('11 500 1', withHorses).f500, 1);
});

test('a second figure from 420 is odds: a stake at that price, whatever sits between', () => {
  const texts = ['capt mag 5000x420', 'capt mag 5000 420', '11 5000@420', '11 5000 #420', '11 5000c420', '11 5000z420', '11 5000 lor 420', '11 5000 on 420', '11 5000 x 420'];
  for (const text of texts) {
    const bet = one(text, withHorses);
    assert.deepEqual([bet.mode, bet.stake, bet.odds100, bet.books, bet.f500, bet.amountKind, bet.unsure], ['odds', 5000, 420, null, null, 'stake', false], text);
  }
  assert.equal(one('11 5000 2000', withHorses).odds100, 2000);
  assert.equal(one('11 5k 420', withHorses).stake, 5000);
});

test('the separator no longer decides: x with a big second figure is a stake, @ with a small one is books', () => {
  const x = one('11 5000x420', withHorses);
  assert.deepEqual([x.mode, x.stake, x.odds100], ['odds', 5000, 420]);
  const at = one('11 500@120', withHorses);
  assert.deepEqual([at.mode, at.books, at.f500], ['f500', 500, 120]);
});

test('a second figure between 121 and 419 is left for the person, with both figures kept', () => {
  for (const text of ['11 500 200', 'capt mag 500x300', '11 500@419', '11 500 121']) {
    const bet = one(text, withHorses);
    assert.equal(bet.amountKind, '?', text);
    assert.equal(bet.amount, 500, text);
    assert.ok(bet.rate >= 121 && bet.rate <= 419, text);
    assert.equal(bet.unsure, true, text);
    assert.ok(bet.issues.some(i => /could be an F500/.test(i)), text);
  }
});

test('four figures are race, horse, amount and second figure', () => {
  const bet = one('3 11 500 120', withHorses);
  assert.deepEqual([bet.raceNum, bet.horseNum, bet.mode, bet.books, bet.f500], [3, 11, 'f500', 500, 120]);
  const odds = one('3 11 5000@420', withHorses);
  assert.deepEqual([odds.raceNum, odds.mode, odds.stake, odds.odds100], [3, 'odds', 5000, 420]);
});

test('sentences and stray words are still not bets', () => {
  const result = parseBetMessage('put 500 on the grey one\n300 pounds\n11', withHorses);
  assert.ok(result.every(r => r.unreadable), JSON.stringify(result));
});
