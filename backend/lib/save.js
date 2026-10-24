// How the Params page and the Init page save their rows.
//
// Saving used to delete all rows of the meeting and insert them again. Two saves at the same time
// (the Params page saves on every Enter press) then both inserted their rows, leaving duplicates, and
// the winner flag had to be copied across by hand. Now every row is written in place, found by its
// race and horse number: saving twice at once gives the same result as saving once, the winner flag
// is simply not touched (the page does not send it), and the ids of the rows stay the same.

const MAX_TEXT = 100;
const isRowNumber = v => Number.isInteger(v) && v >= 1 && v <= 10000;
const cleanName = v => (typeof v === 'string' ? v.trim() : '');

function dateOrNull(value) {
  if (value === undefined || value === null) return { value: null };
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? { error: true } : { value: date };
}

/**
 * Checks the rows sent by the Params page and prepares the writes.
 * Returns { meetingName, ops, keys } or { error }.
 */
function buildParamSave(params) {
  if (!Array.isArray(params)) return { error: 'Params array is required' };
  if (params.length === 0) return { meetingName: null, ops: [], keys: [] };

  const meetingName = cleanName(params[0] && params[0].meetingName);
  if (!meetingName || meetingName.length > MAX_TEXT) return { error: 'meetingName is required' };

  const rows = new Map();
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    const where = `row ${i + 1}`;
    if (!p || typeof p !== 'object') return { error: `${where} is not a horse` };
    if (cleanName(p.meetingName) !== meetingName) return { error: `${where}: all rows must be for the same meeting` };
    if (!isRowNumber(p.raceNum) || !isRowNumber(p.horseNum)) return { error: `${where}: raceNum and horseNum must be whole numbers of 1 or more` };

    const horseName = p.horseName === undefined || p.horseName === null ? '' : p.horseName;
    if (typeof horseName !== 'string' || horseName.length > MAX_TEXT) return { error: `${where}: horseName must be a short text` };

    const special = dateOrNull(p.special);
    const rule4 = dateOrNull(p.rule4);
    if (special.error || rule4.error) return { error: `${where}: special and rule4 must be dates or empty` };

    const rule4deduct = p.rule4deduct === undefined ? null : p.rule4deduct;
    if (rule4deduct !== null && !(typeof rule4deduct === 'number' && rule4deduct >= 0 && rule4deduct <= 100)) {
      return { error: `${where}: rule4deduct must be a number from 0 to 100, or empty` };
    }

    const set = { horseName, special: special.value, rule4: rule4.value, rule4deduct };
    if (p.winner !== undefined) {
      if (typeof p.winner !== 'boolean') return { error: `${where}: winner must be true or false` };
      set.winner = p.winner;
    }
    rows.set(`${p.raceNum}-${p.horseNum}`, { raceNum: p.raceNum, horseNum: p.horseNum, set }); // the last one wins
  }

  const list = [...rows.values()];
  return {
    meetingName,
    ops: list.map(r => ({
      updateOne: {
        filter: { meetingName, raceNum: r.raceNum, horseNum: r.horseNum },
        update: { $set: r.set },
        upsert: true,
      },
    })),
    keys: list.map(r => ({ raceNum: r.raceNum, horseNum: r.horseNum })),
  };
}

/** Checks the races sent by the Init page and prepares the writes. Returns { ops, keys } or { error }. */
function buildRaceSave(meetingName, races, selected) {
  if (!Array.isArray(races) || races.length === 0) return { error: 'Races array is required' };

  const rows = new Map();
  for (let i = 0; i < races.length; i++) {
    const r = races[i];
    const where = `race ${i + 1}`;
    if (!r || typeof r !== 'object') return { error: `${where} is not a race` };
    if (!isRowNumber(r.raceNum)) return { error: `${where}: raceNum must be a whole number of 1 or more` };
    const raceName = cleanName(r.raceName);
    if (!raceName || raceName.length > MAX_TEXT) return { error: `${where}: raceName is required` };
    if (!Number.isInteger(r.numHorse) || r.numHorse < 1 || r.numHorse > 1000) return { error: `${where}: numHorse must be a whole number of 1 or more` };
    rows.set(r.raceNum, { raceNum: r.raceNum, set: { raceName, numHorse: r.numHorse, selected: !!selected } });
  }

  const list = [...rows.values()];
  return {
    ops: list.map(r => ({
      updateOne: { filter: { meetingName, raceNum: r.raceNum }, update: { $set: r.set }, upsert: true },
    })),
    keys: list.map(r => ({ raceNum: r.raceNum })),
  };
}

/** Which of the duplicate rows of one horse to keep: a winner first, then the most recently changed. */
function paramPreference(a, b) {
  if (!!a.winner !== !!b.winner) return a.winner ? -1 : 1;
  return newestFirst(a, b);
}

/** Which of the duplicate rows of one race to keep: the most recently changed. */
function newestFirst(a, b) {
  const x = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
  const y = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
  if (x !== y) return y - x;
  return String(a._id).localeCompare(String(b._id));
}

/** From the rows of one group of duplicates: the one to keep and the ids to delete. */
function splitDuplicates(group, preference) {
  const sorted = [...group].sort(preference);
  return { keep: sorted[0], remove: sorted.slice(1).map(d => d._id) };
}

module.exports = { buildParamSave, buildRaceSave, paramPreference, newestFirst, splitDuplicates };
