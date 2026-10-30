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

test('a sentence with a figure is read loosely, chat without numbers is dropped', () => {
  const result = parseBetMessage('thanks\nput 500 on the favourite\n11 500x90\n1 2 3 4 5 6 7', race1of5);
  assert.equal(result.length, 2); // the line of seven figures is ignored
  assert.deepEqual([result[0].text, result[0].amountKind, result[0].amount, result[0].unsure], ['put 500 on the favourite', '?', 500, true]);
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

test('"put 500 on the grey one": the 500 is the amount, books or a stake, and the horse is left to the person', () => {
  const bet = one('put 500 on the grey one', withHorses);
  assert.deepEqual([bet.amountKind, bet.amount, bet.mode, bet.horseNum, bet.unsure], ['?', 500, null, null, true]);
  assert.ok(bet.issues.includes('books or stake?'));
  assert.ok(bet.issues.some(i => /not found/.test(i)));
});

test('the words of a loose line are tried as the horse name', () => {
  const grey = [...horseList, { raceNum: 1, horseNum: 4, horseName: 'Grey Dawn' }];
  const bet = one('put 500 on the grey one', { raceNum: 1, runners: 5, horses: grey });
  assert.deepEqual([bet.horseNum, bet.amountKind, bet.amount, bet.unsure], [4, '?', 500, true]);
  const k = one('put 5k on dambuster', withHorses);
  assert.deepEqual([k.horseNum, k.stake, k.odds100], [1, 5000, null]);
  const priced = one('put 500 on lux at 120', withHorses);
  assert.deepEqual([priced.horseNum, priced.mode, priced.books, priced.f500], [3, 'f500', 500, 120]);
});

test('a loose line with no horse in it keeps the amount and says the horse is missing', () => {
  const bet = one('300 pounds', withHorses);
  assert.deepEqual([bet.horseNum, bet.amountKind, bet.amount], [null, '?', 300]);
  assert.ok(bet.issues.includes('horse not given'));
});

test('three or four figures among words are still unreadable', () => {
  const result = parseBetMessage('call me on 0771 55 4321', withHorses);
  assert.equal(result.length, 1);
  assert.equal(result[0].unreadable, true);
});

// ---------------------------------------------------------------- piles of numbers are ignored

test('a column of numbers is not a bet', () => {
  assert.deepEqual(parseBetMessage('1\n200\n1000\n500\n800\n2000\n500', withHorses), []);
  assert.deepEqual(parseBetMessage('200\n1000\n500', withHorses), []);
  assert.deepEqual(parseBetMessage('1\n2000\n500\n3000\n1000\n350', withHorses), []); // an odds list, race 1
});

test('an odds list from a contact is ignored', () => {
  assert.deepEqual(parseBetMessage('r1\n1 1500\n2 500\n3 700\n6 800', withHorses), []);
});

test('a line with many numbers, or a bare number, is ignored, and bets next to them are kept', () => {
  assert.deepEqual(parseBetMessage('1 200 1000 500 800 2000 500', withHorses), []);
  assert.deepEqual(parseBetMessage('500', withHorses), []);
  const result = parseBetMessage('11 500x90\n200\n11 5000 420', withHorses);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(r => r.mode), ['f500', 'odds']);
});

test('a few bets with only one or two plain numbers among them are still bets', () => {
  const result = parseBetMessage('11 500x90\n2 5k\n3 500 120', withHorses);
  assert.equal(result.length, 3);
});

// ---------------------------------------------------------------- the formats the players really use

test('"41 20k @ 1000" is race 4, horse 1, a stake of 20000 at odds 1000', () => {
  const bet = one('41 20k @ 1000');
  assert.deepEqual([bet.raceNum, bet.horseNum, bet.mode, bet.stake, bet.odds100], [4, 1, 'odds', 20000, 1000]);
});

test('"25k 68 @ 650" has the amount first: race 6, horse 8, a stake of 25000 at odds 650', () => {
  const bet = one('25k 68 @ 650');
  assert.deepEqual([bet.raceNum, bet.horseNum, bet.mode, bet.stake, bet.odds100], [6, 8, 'odds', 25000, 650]);
});

test('the amount with a k is the amount wherever it stands, and without a k nothing changes', () => {
  assert.deepEqual([one('25k 68 650').horseNum, one('25k 68 650').stake], [8, 25000]);
  assert.deepEqual([one('68 25k 650').horseNum, one('68 25k 650').stake], [8, 25000]);
  const plain = one('3 500 90');
  assert.deepEqual([plain.horseNum, plain.books, plain.f500], [3, 500, 90]);
});

// ---------------------------------------------------------------- only races and horses that exist in the meeting

const meeting = (() => {
  const horses = [];
  for (let race = 1; race <= 8; race++) {
    const count = race === 6 ? 10 : race === 3 ? 12 : 6;
    for (let horse = 1; horse <= count; horse++) horses.push({ raceNum: race, horseNum: horse, horseName: `R${race}H${horse}` });
  }
  return horses;
})();
const eight = { raceNum: 5, runners: 6, horses: meeting };

test('"13" is race 1 horse 3 when there are 8 races and no race has 13 horses', () => {
  const bet = one('13 2k@200', eight);
  assert.deepEqual([bet.raceNum, bet.horseNum], [1, 3]);
  assert.equal(bet.unsure, true); // the odds list is for race 5
  assert.ok(bet.issues.some(i => /odds list is for race 5/.test(i)));
});

test('a race or a horse that does not exist in the meeting is never proposed', () => {
  // 8 races: 13, 21 (race 21) and 99 do not exist as races; horse 13 exists nowhere
  const none = one('99 500x90', eight);
  assert.deepEqual([none.horseNum, none.unsure], [null, true]);
  assert.match(none.issues[0], /"99" is not a horse of this meeting/);
  assert.match(none.issues[0], /races 1, 2, 3, 4, 5, 6, 7, 8/);

  // 9x: race 9 does not exist
  assert.equal(one('92 5k', eight).horseNum, null);
  // horse 3 of race 6, and horse 8 of race 6 (it has 10 horses)
  assert.deepEqual([one('25k 68 @ 650', eight).raceNum, one('25k 68 @ 650', eight).horseNum], [6, 8]);
  // race 4 has no horse 8
  assert.equal(one('48 5k', eight).horseNum, null);
});

test('when the current race has that horse and the digits also fit a race and horse, the person is told', () => {
  const bet = one('13 5k', { raceNum: 3, runners: 12, horses: meeting }); // race 3 has 12 horses: horse 13 does not exist
  assert.deepEqual([bet.raceNum, bet.horseNum], [1, 3]);
  const both = one('12 5k', { raceNum: 3, runners: 12, horses: meeting }); // horse 12 of race 3, or race 1 horse 2
  assert.deepEqual([both.raceNum, both.horseNum, both.unsure], [3, 12, true]);
  assert.match(both.issues[0], /horse 12, or race 1 horse 2/);
});

test('a written race must exist, with that horse', () => {
  const noRace = one('r13 2 5k', eight);
  assert.deepEqual([noRace.raceNum, noRace.horseNum, noRace.unsure], [13, 2, true]);
  assert.match(noRace.issues[0], /there is no race 13 in this meeting/);
  const noHorse = one('r4 9 5k', eight);
  assert.match(noHorse.issues[0], /race 4 has no horse 9/);
  const fine = one('r6 9 5k', eight);
  assert.deepEqual([fine.raceNum, fine.horseNum, fine.unsure], [6, 9, false]);
});

test('with one race in the meeting and no odds list, that race is the current one', () => {
  const single = meeting.filter(h => h.raceNum === 2);
  const bet = one('3 5k', { raceNum: null, runners: null, horses: single });
  assert.deepEqual([bet.raceNum, bet.horseNum, bet.unsure], [2, 3, false]);
});

test('chat with a figure in it is not a bet: "Last bet 22*", "total 300", "thanks 2"', () => {
  for (const text of ['* Last bet 22*', 'Last bet 22*', 'total 300', 'thanks 2', 'Balance 1500 today']) {
    assert.deepEqual(parseBetMessage(text, withHorses), [], text);
  }
  // a horse that really is called that is still found
  const horses = [{ raceNum: 1, horseNum: 3, horseName: 'Last Dance' }];
  const bet = parseBetMessage('last dance 500', { raceNum: 1, runners: 5, horses })[0];
  assert.equal(bet.horseNum, 3);
});
