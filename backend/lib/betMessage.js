// Reads the bets that contacts send in WhatsApp, and the odds lists that are sent back to them.
//
// Messages are short, one bet per line:
//   11 500x90      horse 1 of race 1 (there are no 11 runners), 500 books at F500 90
//   11 5000@2000   stake 5000 at odds 2000
//   11 5000        stake 5000 (the odds are missing)      11 5k   the same, written with a k
//   1 500          horse 1, 500 books or a stake of 500? (the F500 / odds are missing, and which one it is is not said)
//   3 11 500x90    race 3, horse 11
//   cap mag 500x90 the horse is named instead of numbered (see horseMatch.js)
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

/**
 * Reads one line. Returns null if it does not look like a bet.
 */
function parseLine(line, context) {
  // spaces around x, @ and * are removed only between figures, so that an x inside a horse name is left alone
  const cleaned = line.toLowerCase().replace(/(\d),(\d)/g, '$1$2').replace(/([\dk])\s*(x|@|\*)\s*(\d)/g, '$1$2$3').replace(/\s+/g, ' ').trim();
  const match = /^(?:r\s*(\d+)\s+)?(\d+)(?:\s+(\d+))?\s+(\d+(?:\.\d+)?)(k)?(?:(x|@|\*)(\d+(?:\.\d+)?))?$/.exec(cleaned);
  if (!match) return parseNamedLine(cleaned, context);

  let [, rLabel, first, second, amountText, k, operator, second2] = match;
  let explicitRace = rLabel ? Number(rLabel) : null;
  let digits = first;
  if (second !== undefined) {
    // "3 11 500x90": race, horse, amount
    if (explicitRace !== null) return null;
    explicitRace = Number(first);
    digits = second;
  }

  const id = readHorse(digits, explicitRace, context);
  const issues = [...id.issues];
  const amount = number(amountText) * (k ? 1000 : 1);
  const entry = {
    raceNum: id.raceNum,
    horseNum: id.horseNum,
    mode: null,
    books: null,
    f500: null,
    stake: null,
    odds100: null,
    amountKind: '?',
    unsure: id.unsure,
    issues,
  };

  applyAmount(entry, amount, k, operator, second2);

  if (entry.raceNum === null) issues.push('race not known');
  return entry;
}

/** Fills in the books / stake part of an entry from what was written after the horse. */
function applyAmount(entry, amount, k, operator, second) {
  if (operator === 'x' || operator === '*') {
    entry.mode = 'f500';
    entry.books = amount;
    entry.f500 = number(second);
    entry.amountKind = 'books';
  } else if (operator === '@') {
    entry.mode = 'odds';
    entry.stake = amount;
    entry.odds100 = number(second);
    entry.amountKind = 'stake';
  } else if (k) {
    entry.mode = 'odds';
    entry.stake = amount;
    entry.amountKind = 'stake';
    entry.issues.push('odds missing');
  } else {
    // no way to tell books from a stake: the person decides
    entry.amountKind = '?';
    entry.amount = amount;
    entry.issues.push('books or stake?');
    entry.unsure = true;
  }
}

/** "cap mag 500x90": the horse is named. Returns null if the line does not end with an amount. */
function parseNamedLine(cleaned, context) {
  const match = /^(?:r\s*(\d+)\s+)?([a-z][a-z0-9'.\- ]*?)\s+(\d+(?:\.\d+)?)(k)?(?:(x|@|\*)(\d+(?:\.\d+)?))?$/.exec(cleaned);
  if (!match) return null;
  const [, rLabel, name, amountText, k, operator, second] = match;
  const explicitRace = rLabel ? Number(rLabel) : null;

  const entry = {
    raceNum: explicitRace ?? context.raceNum,
    horseNum: null,
    mode: null,
    books: null,
    f500: null,
    stake: null,
    odds100: null,
    amountKind: '?',
    unsure: false,
    issues: [],
  };

  const horses = (context.horses || []).filter(h => explicitRace === null || h.raceNum === explicitRace);
  const result = matchHorse(name, horses, explicitRace ?? context.raceNum);
  if (horses.length === 0) {
    entry.unsure = true;
    entry.issues.push(`no horse list to find "${name}" in`);
  } else if (result.found.length === 0) {
    entry.unsure = true;
    entry.issues.push(`horse "${name}" not found`);
  } else {
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
  }

  applyAmount(entry, number(amountText) * (k ? 1000 : 1), k, operator, second);
  if (entry.raceNum === null) entry.issues.push('race not known');
  return entry;
}

/**
 * Reads a message: one bet per line. Returns the bets found; lines that are not bets are kept as
 * `{ unreadable: true, text }` so that nothing a contact wrote is silently dropped. A message with no
 * digit at all (a greeting, a thank-you) gives nothing.
 */
function parseBetMessage(text, context = emptyContext()) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const results = [];
  for (const line of lines) {
    const bet = parseLine(line, context);
    if (bet) results.push({ ...bet, text: line });
    else if (/\d/.test(line)) results.push({ unreadable: true, text: line, issues: ['could not read this line'] });
  }
  return results;
}

module.exports = { parseOddsList, parseBetMessage, emptyContext };
