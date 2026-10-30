// What a person changed on a card before saving the bet, kept as examples for the AI. The AI itself learns nothing:
// the few corrections that look like the line being read are put in its question, so that it follows the same habits.

const MAX_KEPT = 300;
const MAX_SHOWN = 6;

const positive = value => (typeof value === 'number' && Number.isFinite(value) && value !== 0 ? Math.abs(value) : null);
const whole = value => (Number.isInteger(value) && value > 0 && value < 1000 ? value : null);

/** The reading of an inbox item as the five things a person checks. */
function readingOf(item) {
  const kind = item.amountKind === 'books' || item.amountKind === 'stake' ? item.amountKind : null;
  const amount = kind === 'books' ? item.books : kind === 'stake' ? item.stake : item.amount;
  const second = item.f500 ?? item.odds100 ?? item.rate;
  return { race: whole(item.raceNum), horse: whole(item.horseNum), kind, amount: positive(amount), second: positive(second) };
}

/** What the browser says was saved, cleaned; null when it is not usable. */
function savedReading(saved) {
  if (!saved || typeof saved !== 'object') return null;
  const kind = saved.kind === 'books' || saved.kind === 'stake' ? saved.kind : null;
  const reading = { race: whole(saved.raceNum), horse: whole(saved.horseNum), kind, amount: positive(saved.amount), second: positive(saved.second) };
  return kind && reading.race && reading.horse && reading.amount && reading.second ? reading : null;
}

/** True when the person changed something the reader had said. A kind that was not known is not a change. */
function differs(read, saved) {
  return read.race !== saved.race || read.horse !== saved.horse || read.amount !== saved.amount || read.second !== saved.second
    || (read.kind !== null && read.kind !== saved.kind);
}

const signature = (line, saved) => [line.toLowerCase(), saved.kind, saved.race, saved.horse, saved.amount, saved.second].join('|');

/** Keeps the correction when the saved bet is not what was read. Returns true when one was kept. */
async function learn(Model, item, savedBody) {
  const line = String(item.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const saved = savedReading(savedBody);
  if (!line || !saved) return false;
  const read = readingOf(item);
  if (!differs(read, saved)) return false;

  await Model.updateOne({ sig: signature(line, saved) }, { $set: { line, read, saved, byAi: !!item.ai, createdAt: new Date() } }, { upsert: true });
  const total = await Model.countDocuments();
  if (total > MAX_KEPT) {
    const oldest = await Model.find().sort({ createdAt: 1 }).limit(total - MAX_KEPT).select('_id').lean();
    await Model.deleteMany({ _id: { $in: oldest.map(o => o._id) } });
  }
  return true;
}

const wordsOf = text => new Set(String(text).toLowerCase().match(/[a-z]{3,}/g) || []);

/** The corrections that look most like the lines being read (shared words first, then the newest). */
function pickExamples(lines, corrections) {
  const wanted = new Set();
  for (const line of lines || []) for (const word of wordsOf(line)) wanted.add(word);
  const scored = (corrections || []).map((c, index) => {
    let score = 0;
    for (const word of wordsOf(c.line)) if (wanted.has(word)) score += 1;
    return { c, score, index };
  });
  const similar = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 4);
  const chosen = new Set(similar.map(s => s.index));
  const recent = scored.filter(s => !chosen.has(s.index)).slice(0, Math.max(0, 3 - similar.length));
  return [...similar, ...recent].slice(0, MAX_SHOWN).map(s => s.c);
}

/** One example as text for the question: the line and the reading a person gave it. */
function exampleText(c) {
  const s = c.saved || {};
  const bet = { race: s.race ?? null, horse: s.horse ?? null, amount: s.amount ?? null, second: s.second ?? null, kind: s.kind ?? null };
  return `"${String(c.line).replace(/"/g, "'")}" -> ${JSON.stringify(bet)}`;
}

module.exports = { readingOf, savedReading, differs, learn, pickExamples, exampleText, MAX_KEPT };
