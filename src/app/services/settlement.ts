// Rule 4 deductions, in one place. Used by Reports, Merge, Chart and Single.
//
// When a horse is withdrawn under Rule 4 at some time, the bets on the OTHER horses of that race that
// were placed before that time have their payout (and books) reduced by the deduction %. With several
// withdrawals the reductions are applied one after another (10% then 20% leaves 90% x 80% = 72%).
// Bets on the withdrawn horse itself are ignored altogether; that is not decided here.

export interface Rule4Entry {
  /** When the horse was withdrawn */
  date: Date;
  /** Deduction in percent, above 0 */
  deduct: number;
}

/** The Rule 4 entries that reduce a bet placed at `betTime`: the ones that happened after it. */
export function rule4EntriesAfter(betTime: Date, entries: readonly Rule4Entry[]): Rule4Entry[] {
  return entries.filter(entry => betTime < entry.date);
}

/** True when at least one Rule 4 withdrawal happened after the bet was placed. */
export function rule4Applies(betTime: Date, entries: readonly Rule4Entry[]): boolean {
  return entries.some(entry => betTime < entry.date);
}

/** The deduction percentages that apply to a bet, in the order of the entries. */
export function rule4Percentages(betTime: Date, entries: readonly Rule4Entry[]): number[] {
  return rule4EntriesAfter(betTime, entries).map(entry => entry.deduct);
}

/** `amount` (a payout or books) after the Rule 4 deductions that apply to a bet placed at `betTime`. */
export function applyRule4(amount: number, betTime: Date, entries: readonly Rule4Entry[]): number {
  let result = amount;
  for (const entry of entries) {
    if (betTime < entry.date) {
      result = result * (1 - entry.deduct / 100);
    }
  }
  return result;
}
