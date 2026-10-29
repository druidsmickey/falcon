// Reads the bets that contacts send in WhatsApp, and the odds lists that are sent back to them.
//
// Messages are short, one bet per line:
//   11 500x90      horse 1 of race 1 (there are no 11 runners), 500 books at F500 90
//   11 5000@420    stake 5000 at odds 420
//   11 500         one figure: books or a stake? (a stake when written 5k); the person chooses
//   3 11 500x90    four figures: race 3, horse 11
//   cap mag 500 120 the horse is named instead of numbered (see horseMatch.js)
//
// What sits between the amount and the second figure does not matter (x, @, #, c, z, a space, "on"...).
// The size of the second figure decides: up to 120 it is an F500 (so the amount is books), from 420 it is
// odds (so the amount is a stake), in between the person chooses.
//
// Nothing here saves anything: it only says what a message seems to mean, and what is still missing or
// unclear, so that a person can check it (see the inbox of the app).

const { matchHorse } = require('./horseMatch');

const MAX_HORSE = 40;
const MAX_RACE = 20;

/**
 * What the odds list of the day says about the race that is running, and the horses of the meeting.
 * `{ raceNum, runners, horses }`: runners is the highest horse number seen (raceNum and runners may be
 * null); horses are `{ raceNum, horseNum, horseName }`, used when a bet names its horse.
 */
function emptyContext() {
  return { raceNum: null, runners: null, horses: [] };
}

const number = text => Number(String(text).replace(/,/g, ''));

/**
 * Reads an odds list. Two styles are used:
 *   r1            race 1           1          race 1
 *   1 1500        horse, odds      2000       odds of horse 1, then of horse 2 ...
 *   2 500                          500
 *   6 800                          3000
 * Returns null if the text is not an odds list.
 */
function parseOddsList(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const withR = /^r\s*(\d+)$/i.exec(lines[0]);
  if (withR) {
    const odds = [];
    for (const line of lines.slice(1)) {
      const pair = /^(\d+)\s+(\d+(?:\.\d+)?)$/.exec(line.replace(/,/g, ''));
      if (!pair) return null;
      odds.push({ horseNum: Number(pair[1]), odds: Number(pair[2]) });
    }
    const raceNum = Number(withR[1]);
    if (raceNum < 1 || raceNum > MAX_RACE || odds.some(o => o.horseNum < 1 || o.horseNum > MAX_HORSE)) return null;
    return { raceNum, runners: Math.max(...odds.map(o => o.horseNum)), odds, style: 'pairs' };
  }

  // a race number, then the odds of horse 1, 2, 3 ...
  if (/^\d+$/.test(lines[0]) && lines.length >= 3) {
    const raceNum = Number(lines[0]);
    const rest = lines.slice(1).map(l => l.replace(/,/g, ''));
    if (raceNum < 1 || raceNum > MAX_RACE || !rest.every(l => /^\d+(?:\.\d+)?$/.test(l)) || rest.length > MAX_HORSE) return null;
    return { raceNum, runners: rest.length, odds: rest.map((o, i) => ({ horseNum: i + 1, odds: Number(o) })), style: 'column' };
  }
  return null;
}

/**
 * Works out the race and horse of the first number of a line.
 * `explicitRace` is set when the line has a race number of its own.
 */
function readHorse(digits, explicitRace, context) {
  const issues = [];
  const known = context.runners !== null;
  const horseOk = n => n >= 1 && n <= (known ? context.runners : MAX_HORSE);

  if (explicitRace !== null) {
    const horse = Number(digits);
    if (horse < 1 || horse > MAX_HORSE) issues.push('horse number not recognised');
    return { raceNum: explicitRace, horseNum: horse, unsure: false, issues };
  }

  const n = Number(digits);
  const asHorse = horseOk(n) ? { raceNum: context.raceNum, horseNum: n } : null;

  // "11" can also be race 1 horse 1: the digits are split in every possible place
  const splits = [];
  for (let at = 1; at < digits.length; at++) {
    const race = Number(digits.slice(0, at));
    const horse = Number(digits.slice(at));
    if (digits[at] === '0' || race < 1 || race > MAX_RACE) continue;
    const limit = race === context.raceNum && known ? context.runners : MAX_HORSE;
    if (horse >= 1 && horse <= limit) splits.push({ raceNum: race, horseNum: horse });
  }

  if (asHorse && splits.length === 0) {
    if (context.raceNum === null) issues.push('race not known yet (no odds list received)');
    return { ...asHorse, unsure: false, issues };
  }
  if (!asHorse && splits.length >= 1) {
    const chosen = splits[0];
    if (splits.length > 1) issues.push(`could be race ${splits.map(s => s.raceNum + ' horse ' + s.horseNum).join(' or race ')}`);
    if (context.raceNum !== null && chosen.raceNum !== context.raceNum) issues.push(`race ${chosen.raceNum}, the odds list is for race ${context.raceNum}`);
    return { ...chosen, unsure: splits.length > 1 || (context.raceNum !== null && chosen.raceNum !== context.raceNum), issues };
  }
  if (asHorse && splits.length >= 1) {
    issues.push(`horse ${asHorse.horseNum}, or race ${splits[0].raceNum} horse ${splits[0].horseNum}?`);
    return { ...asHorse, unsure: true, issues };
  }
  issues.push('horse number not recognised');
  return { raceNum: context.raceNum, horseNum: n, unsure: true, issues };
}

/** A second figure up to this is an F500 (so the first one is books); from SECOND_ODDS_FROM it is odds (so the first is a stake). */
const F500_UP_TO = 120;
const ODDS_FROM = 420;

const NUMBER = /\d+(?:\.\d+)?k?/g;
// what may sit between two figures: nothing, a symbol or a short word ("x", "@", "#", "c", "z", "on", "lor", "at")
const SEPARATOR = /^\s*[a-z#@*×:/\-]{0,5}\s*$/;

/**
 * Reads the figures of a line (everything from the first digit on). Returns null if anything else is in
 * the way, so that "put 500 on the grey one" is not taken for a bet.
 */
function readFigures(rest) {
  const figures = [];
  let last = 0;
  for (const found of rest.matchAll(NUMBER)) {
    if (!SEPARATOR.test(rest.slice(last, found.index)) || (figures.length === 0 && found.index !== 0)) return null;
    const text = found[0];
    const k = text.endsWith('k');
    figures.push({ value: number(k ? text.slice(0, -1) : text) * (k ? 1000 : 1), k, whole: !k && /^\d+$/.test(text) });
    last = found.index + text.length;
  }
  return figures.length > 0 && rest.slice(last).trim() === '' ? figures : null;
}

/**
 * Works out what the amount and the figure after it are. The kind of separator does not matter ("500x120",
 * "500 120", "500@120", "500 #120", "500 on 120" all say the same); the size of the second figure does:
 *   up to 120      books at that F500
 *   420 and over   a stake at those odds
 *   in between     could be either, so the person chooses
 * One figure alone is books or a stake (a stake when it has a k, as in 5k) and the person chooses.
 */
function applyAmount(entry, first, second) {
  const amount = first.value;
  if (second === null) {
    if (first.k) {
      entry.mode = 'odds';
      entry.stake = amount;
      entry.amountKind = 'stake';
      entry.issues.push('odds missing');
    } else {
      entry.amountKind = '?';
      entry.amount = amount;
      entry.issues.push('books or stake?');
      entry.unsure = true;
    }
    return;
  }

  const price = second.value;
  if (price <= F500_UP_TO) {
    entry.mode = 'f500';
    entry.books = amount;
    entry.f500 = price;
    entry.amountKind = 'books';
  } else if (price >= ODDS_FROM) {
    entry.mode = 'odds';
    entry.stake = amount;
    entry.odds100 = price;
    entry.amountKind = 'stake';
  } else {
    entry.amountKind = '?';
    entry.amount = amount;
    entry.rate = price;
    entry.issues.push(`${price} could be an F500 (books) or odds (stake)`);
    entry.unsure = true;
  }
}

function newEntry(raceNum) {
  return {
    raceNum,
    horseNum: null,
    mode: null,
    books: null,
    f500: null,
    stake: null,
    odds100: null,
    rate: null,
    amountKind: '?',
    unsure: false,
    issues: [],
  };
}

/** "cap mag 500x120": the horse is named instead of numbered. */
function nameEntry(name, explicitRace, context) {
  const entry = newEntry(explicitRace ?? context.raceNum);
  const horses = (context.horses || []).filter(h => explicitRace === null || h.raceNum === explicitRace);
  const result = matchHorse(name, horses, explicitRace ?? context.raceNum);
  if (horses.length === 0) {
    entry.unsure = true;
    entry.issues.push(`no horse list to find "${name}" in`);
    return entry;
  }
  if (result.found.length === 0) {
    entry.unsure = true;
    entry.issues.push(`horse "${name}" not found`);
    return entry;
  }

  const [first, ...others] = result.found;
  entry.raceNum = first.raceNum;
  entry.horseNum = first.horseNum;
  if (others.length > 0) {
    entry.unsure = true;
    entry.issues.push(`"${name}" could be ${result.found.map(h => `race ${h.raceNum} horse ${h.horseNum} ${h.horseName}`).join(' or ')}`);
  }
  if (context.raceNum !== null && explicitRace === null && first.raceNum !== context.raceNum) {
    entry.unsure = true;
    entry.issues.push(`race ${first.raceNum}, the odds list is for race ${context.raceNum}`);
  }
  // the race is only taken as known when the message says it; the odds list may be for another race
  if (explicitRace === null && result.elsewhere.length > 0) {
    entry.unsure = true;
    entry.issues.push(`"${name}" also fits ${result.elsewhere.map(h => `race ${h.raceNum} horse ${h.horseNum} ${h.horseName}`).join(' or ')}`);
  }
  if (!result.sure) {
    entry.unsure = true;
    entry.issues.push(`best guess for "${name}": ${first.horseName}`);
  }
  return entry;
}

/**
 * Reads one line. Returns null if it does not look like a bet.
 *   <horse number or name> <amount> [<separator>] [<second figure>]
 * A race can be given first as "r2", or as a number before the horse when the line has four figures.
 */
function parseStrict(line, context) {
  let cleaned = line.toLowerCase().replace(/(\d),(?=\d)/g, '$1').replace(/\s+/g, ' ').trim();

  let explicitRace = null;
  const label = /^r\s*(\d+)\s+(?=\S)/.exec(cleaned);
  if (label) {
    explicitRace = Number(label[1]);
    cleaned = cleaned.slice(label[0].length);
  }

  const firstDigit = cleaned.search(/\d/);
  if (firstDigit === -1) return null;
  const name = cleaned.slice(0, firstDigit).trim();
  const figures = readFigures(cleaned.slice(firstDigit));
  if (!figures) return null;

  let entry;
  let amount;
  let second = null;

  if (name !== '') {
    // a horse name, then the amount and maybe a second figure
    if (!/[a-z]/.test(name) || figures.length > 2) return null;
    entry = nameEntry(name, explicitRace, context);
    [amount, second = null] = figures;
  } else {
    // the amount can be written first when it has a k: "25k 68 @ 650" is horse 68, 25000, at 650
    if (figures.length >= 2 && figures.length <= 3 && figures[0].k && figures[1].whole) {
      figures.splice(0, 2, figures[1], figures[0]);
    }

    // a horse number first; with four figures the first two are the race and the horse
    if (figures.length < 2 || figures.length > 4 || !figures[0].whole) return null;
    let rest = figures.slice(1);
    let digits = String(figures[0].value);
    if (figures.length === 4) {
      if (explicitRace !== null || !figures[1].whole) return null;
      explicitRace = figures[0].value;
      digits = String(figures[1].value);
      rest = figures.slice(2);
    }
    const id = readHorse(digits, explicitRace, context);
    entry = newEntry(id.raceNum);
    entry.horseNum = id.horseNum;
    entry.unsure = id.unsure;
    entry.issues.push(...id.issues);
    [amount, second = null] = rest;
  }

  applyAmount(entry, amount, second);
  if (entry.raceNum === null) entry.issues.push('race not known');
  return entry;
}

// words that carry no horse name: "put 500 on the grey one"
const FILLER = new Set(['put', 'bet', 'on', 'the', 'a', 'an', 'one', 'of', 'at', 'for', 'to', 'me', 'my', 'please', 'pls', 'plz', 'with', 'in', 'is', 'and', 'x', 'win', 'book', 'books', 'stake', 'pounds', 'pound', 'gbp']);

/**
 * A line with words and one or two figures that does not fit the usual shapes, such as "put 500 on the grey
 * one": the first figure is the amount (books or a stake, the person chooses), a second figure is read as usual,
 * and what is left of the words is tried as the horse name. Always marked unsure.
 */
function parseLoose(line, context) {
  const lower = line.toLowerCase().replace(/(\d),(?=\d)/g, '$1');
  const found = [...lower.matchAll(/\d+(?:\.\d+)?k?/g)];
  if (found.length < 1 || found.length > 2 || !/[a-z]/.test(lower)) return null;

  const words = lower.replace(/\d+(?:\.\d+)?k?/g, ' ').split(/[^a-z']+/).filter(w => w && !FILLER.has(w)).join(' ');
  const [first, second] = found.map(f => {
    const k = f[0].endsWith('k');
    return { value: number(k ? f[0].slice(0, -1) : f[0]) * (k ? 1000 : 1), k };
  });

  let entry;
  if (words.replace(/[^a-z]/g, '').length >= 3) {
    entry = nameEntry(words, null, context);
  } else {
    entry = newEntry(context.raceNum);
    entry.issues.push('horse not given');
  }
  applyAmount(entry, first, second ?? null);
  entry.unsure = true;
  entry.issues.push('read loosely from the words');
  if (entry.raceNum === null) entry.issues.push('race not known');
  return entry;
}

/** The usual shapes first, then a loose reading of lines with words. */
function parseLine(line, context) {
  return parseStrict(line, context) ?? parseLoose(line, context);
}

/** A line that is only a number: "200", "5k". It cannot say which horse, so it is never a bet. */
const isBareNumber = line => /^\d+(?:\.\d+)?k?$/i.test(line.replace(/,/g, '').trim());

/**
 * Whether a message is a column or a pile of numbers (somebody's odds, results, a list) and not bets:
 *   - an odds list in either of the styles of parseOddsList
 *   - three or more lines of which at least half are only a number
 */
function looksLikeNumbers(lines, text) {
  if (parseOddsList(text)) return true;
  return lines.length >= 3 && lines.filter(isBareNumber).length * 2 >= lines.length;
}

/**
 * Reads a message: one bet per line. Returns the bets found; lines with words that are not bets are kept
 * as `{ unreadable: true, text }` so that nothing a contact wrote is silently dropped. Ignored altogether:
 * a message with no digit (a greeting), a message that is mostly numbers (see looksLikeNumbers), a line that
 * is only a number, and a line with more than four figures.
 */
function parseBetMessage(text, context = emptyContext()) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (looksLikeNumbers(lines, text)) return [];

  const results = [];
  for (const line of lines) {
    if (isBareNumber(line)) continue;
    const bet = parseLine(line, context);
    if (bet) results.push({ ...bet, text: line });
    else if (/\d/.test(line) && (line.match(/\d+(?:\.\d+)?/g) || []).length <= 4) results.push({ unreadable: true, text: line, issues: ['could not read this line'] });
  }
  return results;
}

module.exports = { parseOddsList, parseBetMessage, emptyContext };
