// Saving params replaces all rows of a meeting. The Params page does not know about winners
// (they are set on the Winners page), so the winner flag of the existing rows is carried over to
// the matching horses (same race and horse number) unless the incoming row sets it itself.
function keepWinners(newParams, existingWinners) {
  const winnerKeys = new Set(existingWinners.map(w => `${w.raceNum}-${w.horseNum}`));

  return newParams.map(p =>
    p.winner === undefined && winnerKeys.has(`${p.raceNum}-${p.horseNum}`)
      ? { ...p, winner: true }
      : p
  );
}

module.exports = { keepWinners };
