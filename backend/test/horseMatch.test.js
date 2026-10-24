const test = require('node:test');
const assert = require('node:assert/strict');
const { matchHorse, score } = require('../lib/horseMatch');
const { parseBetMessage } = require('../lib/betMessage');

const horses = [
  { raceNum: 1, horseNum: 1, horseName: 'Dambuster' },
  { raceNum: 1, horseNum: 2, horseName: 'Captain Magpie' },
  { raceNum: 1, horseNum: 3, horseName: 'Captain Marvel' },
  { raceNum: 1, horseNum: 4, horseName: 'Lux Star' },
  { raceNum: 1, horseNum: 5, horseName: 'Magic Man' },
  { raceNum: 2, horseNum: 1, horseName: 'Magpie Queen' },
  { raceNum: 2, horseNum: 2, horseName: 'Sea The Day' },
];
const context = { raceNum: 1, runners: 5, horses };

const find = (query, race = 1) => matchHorse(query, horses, race).found.map(h => `${h.raceNum}.${h.horseNum}`);

test('every way of writing Captain Magpie finds it', () => {
  for (const query of ['Captain Magpie', 'captain magpie', 'cap magpie', 'magp', 'cap mag', 'capmag', 'CAP MAG', 'cap-mag', 'captainmagpie', 'magpie']) {
    assert.deepEqual(find(query), ['1.2'], query);
  }
});

test('a few letters are enough when only one horse fits', () => {
  assert.deepEqual(find('dam'), ['1.1']);
  assert.deepEqual(find('lux'), ['1.4']);
  assert.deepEqual(find('cap mar'), ['1.3']);
  assert.deepEqual(find('luxstar'), ['1.4']);
});

test('the whole name beats a partial match, and the running race beats other races', () => {
  assert.deepEqual(find('magpie queen', 1), ['2.1']);
  assert.deepEqual(find('magpie queen', 2), ['2.1']);
  assert.deepEqual(find('magpie', 1), ['1.2']); // the race that is running first
  assert.deepEqual(find('magpie', 2), ['2.1']);
});

test('when several horses fit they are all returned, in order', () => {
  assert.deepEqual(find('mag'), ['1.2', '1.5']);
  assert.deepEqual(find('cap'), ['1.2', '1.3']);
});

test('a horse of another race is found when the running race has none like it', () => {
  assert.deepEqual(find('queen', 1), ['2.1']);
  assert.deepEqual(find('sea the', 1), ['2.2']);
});

test('how well a text fits a name is scored, best first', () => {
  const fit = text => score(text, 'Captain Magpie');
  assert.equal(fit('captain magpie'), 1);
  assert.ok(fit('cap mag') >= 0.97 && fit('mag') >= 0.97);
  assert.ok(fit('capmag') >= 0.94 && fit('capmag') < 0.97);
  assert.ok(fit('cptn mgp') > 0.6 && fit('cptn mgp') < 0.9, 'letters left out: ' + fit('cptn mgp'));
  assert.ok(fit('captin magpy') > 0.6 && fit('captin magpy') < 0.9, 'slips: ' + fit('captin magpy'));
  assert.ok(fit('captin magpie') > fit('captin magpy'));
  assert.equal(fit('zebra'), 0);
  assert.equal(fit('ca'), 0);
});

test('letters left out, or slips, are still matched as far as they can be', () => {
  for (const query of ['cptn mgp', 'cptnmgp', 'captin magpy', 'captian magpie', 'capt magpi', 'cpt magpie', 'captain mapie']) {
    assert.deepEqual(find(query), ['1.2'], query);
  }
  assert.equal(matchHorse('cptn mgp', horses, 1).sure, false);
  assert.equal(matchHorse('cap mag', horses, 1).sure, true);
});

test('ordinary words are not taken for horses', () => {
  for (const word of ['morning', 'thanks', 'please', 'market', 'cash', 'today', 'again', 'sorry', 'total', 'boston', 'magnet']) {
    assert.deepEqual(find(word), [], word);
  }
});

test('too little or nothing to go on finds nothing', () => {
  assert.deepEqual(find('ca'), []);
  assert.deepEqual(find(''), []);
  assert.deepEqual(find('zebra'), []);
  assert.deepEqual(find('xyz'), []);
  assert.deepEqual(matchHorse('mag', [], 1).found, []);
  assert.deepEqual(matchHorse('mag', [{ raceNum: 1, horseNum: 1 }], 1).found, []);
});

// ---------------------------------------------------------------- in a bet message

const bet = (text, ctx = context) => {
  const result = parseBetMessage(text, ctx);
  assert.equal(result.length, 1, text);
  return result[0];
};

test('a bet written with the horse name', () => {
  for (const text of ['Captain Magpie 500 x90', 'cap magpie 500x90', 'cap mag 500x90', 'capmag 500x90']) {
    const b = bet(text);
    assert.deepEqual([b.raceNum, b.horseNum, b.mode, b.books, b.f500, b.unsure], [1, 2, 'f500', 500, 90, false], text);
  }
});

test('a name that also fits a horse of another race is flagged, unless the message gives the race', () => {
  const b = bet('magp 500x90');
  assert.deepEqual([b.raceNum, b.horseNum, b.unsure], [1, 2, true]);
  assert.match(b.issues.join(' | '), /also fits race 2 horse 1 Magpie Queen/);

  for (const text of ['r1 magp 500x90', 'R1 magp 500x90']) {
    const explicit = bet(text);
    assert.deepEqual([explicit.raceNum, explicit.horseNum, explicit.unsure, explicit.issues], [1, 2, false, []], text);
  }
  assert.equal(bet('r2 magp 500x90').horseNum, 1);
  // nothing else fits, so nothing to ask
  assert.equal(bet('lux 500x90').unsure, false);
});

test('a name works with every way of writing the amount', () => {
  assert.deepEqual([bet('cap mag 5000@2000').mode, bet('cap mag 5000@2000').stake, bet('cap mag 5000@2000').odds100], ['odds', 5000, 2000]);
  const k = bet('cap mag 5k');
  assert.deepEqual([k.stake, k.odds100, k.issues], [5000, null, ['odds missing']]);
  const bare = bet('cap mag 500');
  assert.deepEqual([bare.amountKind, bare.amount, bare.unsure], ['?', 500, true]);
});

test('an x inside a horse name is not mistaken for a multiplication', () => {
  const b = bet('lux star 500 x 90');
  assert.deepEqual([b.horseNum, b.books, b.f500], [4, 500, 90]);
  assert.equal(bet('lux 500x90').horseNum, 4);
});

test('a name that fits several horses is flagged and lists them', () => {
  const b = bet('mag 500x90');
  assert.equal(b.unsure, true);
  assert.equal(b.horseNum, 2);
  assert.match(b.issues[0], /race 1 horse 2 Captain Magpie or race 1 horse 5 Magic Man/);
});

test('a horse from another race than the odds list is flagged', () => {
  const b = bet('queen 500x90');
  assert.deepEqual([b.raceNum, b.horseNum, b.unsure], [2, 1, true]);
  assert.ok(b.issues.some(i => /odds list is for race 1/.test(i)));
});

test('a race written first limits the search to that race', () => {
  const b = bet('r2 mag 500x90');
  assert.deepEqual([b.raceNum, b.horseNum, b.unsure], [2, 1, false]);
});

test('a name that is not in the list, or no list at all, is kept for a person to fix', () => {
  const none = bet('zebra 500x90');
  assert.deepEqual([none.horseNum, none.unsure, none.books], [null, true, 500]);
  assert.match(none.issues[0], /not found/);
  const noList = bet('cap mag 500x90', { raceNum: 1, runners: 5, horses: [] });
  assert.equal(noList.horseNum, null);
  assert.match(noList.issues[0], /no horse list/);
});

test('a loose match is flagged as a best guess', () => {
  for (const text of ['captin magpie 500x90', 'cptn mgp 500x90']) {
    const b = bet(text);
    assert.deepEqual([b.horseNum, b.unsure], [2, true], text);
    assert.ok(b.issues.some(i => /best guess/.test(i) && /Captain Magpie/.test(i)), text);
  }
});

test('numbers still work, and sentences are still not bets', () => {
  assert.equal(bet('11 500x90', { raceNum: 1, runners: 5, horses }).horseNum, 1);
  const result = parseBetMessage('please put 500 on the grey one', context);
  assert.equal(result[0].unreadable, true);
});
