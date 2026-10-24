// Makes sure that a horse (and a race) exists only once per meeting, in the database itself.
// Duplicates left by the old way of saving are removed first, then the unique indexes are built.
const { paramPreference, newestFirst, splitDuplicates } = require('./save');

async function removeDuplicates(Model, keyFields, preference) {
  const groups = await Model.aggregate([
    {
      $group: {
        _id: Object.fromEntries(keyFields.map(field => [field, '$' + field])),
        docs: { $push: { _id: '$_id', winner: '$winner', updatedAt: '$updatedAt', createdAt: '$createdAt' } },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  let removed = 0;
  for (const group of groups) {
    const { keep, remove } = splitDuplicates(group.docs, preference);
    await Model.collection.deleteMany({ _id: { $in: remove } });
    removed += remove.length;

    // a meeting's age counts from when it was first input, so the row that is kept gets the earliest time
    const earliest = group.docs.map(d => d.createdAt).filter(Boolean).sort((a, b) => a - b)[0];
    if (earliest) await Model.collection.updateOne({ _id: keep._id }, { $set: { createdAt: earliest } });
  }
  return removed;
}

async function makeUnique(Model, keyFields, preference) {
  const removed = await removeDuplicates(Model, keyFields, preference);

  // an older, non-unique index on the same fields would stop the unique one from being created
  const key = Object.fromEntries(keyFields.map(field => [field, 1]));
  const existing = await Model.collection.indexes().catch(() => []);
  const same = existing.find(index => JSON.stringify(index.key) === JSON.stringify(key));
  if (same && !same.unique) await Model.collection.dropIndex(same.name);

  await Model.createIndexes();
  return removed;
}

async function ensureUniqueRows({ Params, Init }) {
  const params = await makeUnique(Params, ['meetingName', 'raceNum', 'horseNum'], paramPreference);
  const races = await makeUnique(Init, ['meetingName', 'raceNum'], newestFirst);
  return { duplicateHorsesRemoved: params, duplicateRacesRemoved: races };
}

module.exports = { ensureUniqueRows };
