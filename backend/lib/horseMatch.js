// Finds the horse a contact meant when a bet names it instead of giving a number:
//   "Captain Magpie", "cap magpie", "magp", "cap mag", "capmag", "mag", "cptn mgp", "captin magpy"
//
// Every horse of the meeting is given a score from 0 to 1 for how well the typed letters fit its name
// (capitals, spaces and punctuation do not matter), and the best fits are kept:
//   1.00  the whole name
//   0.97  the start of the name's words ("cap mag", "magp", "mag")
//   0.94  the same typed together ("capmag")
//   up to 0.9  the letters in the right order with some left out ("cptmgp", "cptn mgp")
//   up to 0.9  nearly the same letters, with slips ("captin magpy", "capain magpie")
// Below SURE_SCORE the match is only a guess and the caller should say so. Below MIN_SCORE it is not a match.
// When several horses fit equally well they are all returned, and the race that is running comes first.

const MIN_LETTERS = 3;
const MIN_SCORE = 0.6;
/** From this score a match is not flagged just for being loose. */
const SURE_SCORE = 0.9;
/** Horses scoring within this of the best are treated as equally good. */
const TIE_MARGIN = 0.04;

const normalise = text => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const wordsOf = text => normalise(text).split(' ').filter(Boolean);

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > Math.max(a.length, b.length)) return Infinity;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

/** The query is cut into pieces that are each the start of a word of the name, in order (words may be skipped). */
function pieces(compact, nameWords, from, minPiece) {
  if (compact === '') return true;
  for (let w = from; w < nameWords.length; w++) {
    const word = nameWords[w];
    const max = Math.min(compact.length, word.length);
    for (let length = max; length >= minPiece; length--) {
      if (word.startsWith(compact.slice(0, length)) && pieces(compact.slice(length), nameWords, w + 1, 2)) return true;
    }
  }
  return false;
}

/** The letters of the query all appear in the name in the same order, the first one starting a word. */
function isSubsequence(compact, nameWords) {
  const nameLetters = nameWords.join('');
  const starts = new Set();
  let at = 0;
  for (const word of nameWords) {
    starts.add(at);
    at += word.length;
  }
  for (const start of starts) {
    if (nameLetters[start] !== compact[0]) continue;
    let position = start + 1;
    let matched = 1;
    while (matched < compact.length) {
      const next = nameLetters.indexOf(compact[matched], position);
      if (next === -1) break;
      position = next + 1;
      matched += 1;
    }
    if (matched === compact.length) return true;
  }
  return false;
}

/** How similar two strings are, 0 to 1 (1 is the same). */
const similarity = (a, b) => (a.length === 0 && b.length === 0 ? 1 : 1 - editDistance(a, b) / Math.max(a.length, b.length));

/**
 * How well `query` fits `name`, from 0 (not at all) to 1 (the whole name). See the top of the file.
 */
function score(query, name) {
  const queryWords = wordsOf(query);
  const nameWords = wordsOf(name);
  if (queryWords.length === 0 || nameWords.length === 0) return 0;

  const compact = queryWords.join('');
  const nameCompact = nameWords.join('');
  if (compact.length < MIN_LETTERS) return 0;
  if (compact === nameCompact) return 1;

  // each typed word is the start of a different word of the name, in order
  let at = 0;
  const inOrder = queryWords.every(word => {
    while (at < nameWords.length) {
      if (nameWords[at++].startsWith(word)) return true;
    }
    return false;
  });
  if (inOrder) return 0.97;
  if (pieces(compact, nameWords, 0, MIN_LETTERS)) return 0.94;

  let best = 0;

  // letters left out: "cptmgp" for "captain magpie". The more of the name is typed, the better
  if (isSubsequence(compact, nameWords)) best = Math.max(best, 0.55 + 0.35 * Math.min(1, compact.length / nameCompact.length));

  // slips: the typed letters against the whole name, and against just its first letters (a cut-off name)
  const whole = similarity(compact, nameCompact);
  const start = similarity(compact, nameCompact.slice(0, compact.length));
  const wordwise = compact.length >= 4 ? similarity(compact, nameWords.map(w => w.slice(0, Math.ceil(compact.length / nameWords.length))).join('')) : 0;
  const fuzzy = Math.max(whole, start * 0.95, wordwise * 0.9);
  if (fuzzy >= 0.7) best = Math.max(best, 0.9 * fuzzy);

  return best >= MIN_SCORE ? best : 0;
}

/**
 * @param {string} query what was written in place of the number
 * @param {{raceNum:number, horseNum:number, horseName?:string}[]} horses the horses of the meeting
 * @param {number|null} currentRace the race of the latest odds list
 * @returns {{ found: {raceNum:number, horseNum:number, horseName:string}[], score: number, sure: boolean,
 *             elsewhere: {raceNum:number, horseNum:number, horseName:string}[] }}
 *   `found` is the best matches, best first (empty when nothing fits). `sure` is false when the match is only a
 *   loose guess. `elsewhere` are horses of other races that the text fits well too, so that the caller can ask
 *   which race is meant.
 */
function matchHorse(query, horses, currentRace = null) {
  const scored = [];
  for (const horse of horses || []) {
    if (!horse.horseName) continue;
    const s = score(query, horse.horseName);
    if (s > 0) scored.push({ raceNum: horse.raceNum, horseNum: horse.horseNum, horseName: horse.horseName, score: s });
  }
  if (scored.length === 0) return { found: [], score: 0, sure: false, elsewhere: [] };

  // the race that is running is looked at first, and the others only when it has nothing like it
  const pool = currentRace !== null && scored.some(s => s.raceNum === currentRace) ? scored.filter(s => s.raceNum === currentRace) : scored;
  const best = Math.max(...pool.map(s => s.score));
  const plain = ({ raceNum, horseNum, horseName }) => ({ raceNum, horseNum, horseName });
  const byPlace = (a, b) => a.raceNum - b.raceNum || a.horseNum - b.horseNum;

  const found = pool.filter(s => s.score >= best - TIE_MARGIN).sort(byPlace).map(plain);
  const chosenRaces = new Set(found.map(f => f.raceNum));
  const elsewhere = scored.filter(s => s.score >= 0.75 && !chosenRaces.has(s.raceNum)).sort(byPlace).map(plain);
  return { found, score: best, sure: best >= SURE_SCORE, elsewhere };
}

module.exports = { matchHorse, score, normalise, SURE_SCORE };
