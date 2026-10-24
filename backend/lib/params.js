// Fields of a horse that may be changed one at a time (PATCH /api/params/:id)
function pickParamUpdate(body) {
  const b = body && typeof body === 'object' ? body : {};
  const update = {};
  const errors = [];

  const isDateOrNull = v => v === null || (v !== undefined && !Number.isNaN(new Date(v).getTime()));

  if ('winner' in b) {
    if (typeof b.winner === 'boolean') update.winner = b.winner;
    else errors.push('winner must be true or false');
  }
  for (const field of ['special', 'rule4']) {
    if (field in b) {
      if (isDateOrNull(b[field])) update[field] = b[field] === null ? null : new Date(b[field]);
      else errors.push(`${field} must be a date or null`);
    }
  }
  if ('rule4deduct' in b) {
    if (b.rule4deduct === null || (typeof b.rule4deduct === 'number' && b.rule4deduct >= 0 && b.rule4deduct <= 100)) {
      update.rule4deduct = b.rule4deduct;
    } else {
      errors.push('rule4deduct must be a number from 0 to 100, or null');
    }
  }
  if ('horseName' in b) {
    if (typeof b.horseName === 'string' && b.horseName.length <= 100) update.horseName = b.horseName;
    else errors.push('horseName must be a short text');
  }

  if (errors.length > 0) return { error: errors.join('; ') };
  if (Object.keys(update).length === 0) return { error: 'nothing to update' };
  return { update };
}

module.exports = { pickParamUpdate };
