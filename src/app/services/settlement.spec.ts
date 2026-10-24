import { applyRule4, rule4Applies, rule4EntriesAfter, rule4Percentages, Rule4Entry } from './settlement';

const at = (hour: number, minute = 0) => new Date(2026, 9, 24, hour, minute);

// horse 1 withdrawn at 11:00 (10%), horse 2 withdrawn at 13:00 (20%)
const entries: Rule4Entry[] = [
  { date: at(11), deduct: 10 },
  { date: at(13), deduct: 20 },
];

describe('Rule 4 deductions', () => {
  it('a bet placed before both withdrawals is reduced by both (10,000 -> 9,000 -> 7,200)', () => {
    expect(applyRule4(10000, at(10), entries)).toBeCloseTo(7200, 6);
  });

  it('a bet placed between the withdrawals is reduced only by the second one', () => {
    expect(applyRule4(10000, at(12), entries)).toBeCloseTo(8000, 6);
  });

  it('a bet placed after both withdrawals is not reduced', () => {
    expect(applyRule4(10000, at(14), entries)).toBe(10000);
  });

  it('a bet placed exactly at the withdrawal time is not reduced', () => {
    expect(applyRule4(10000, at(11), [entries[0]])).toBe(10000);
  });

  it('the order of the entries does not change the result', () => {
    const reversed = [...entries].reverse();
    expect(applyRule4(10000, at(10), reversed)).toBeCloseTo(applyRule4(10000, at(10), entries), 6);
  });

  it('no entries leaves the amount unchanged', () => {
    expect(applyRule4(10000, at(10), [])).toBe(10000);
  });

  it('works for a purchase (negative amount)', () => {
    expect(applyRule4(-10000, at(10), entries)).toBeCloseTo(-7200, 6);
  });

  it('works for books as well as payouts', () => {
    expect(applyRule4(50, at(10), [entries[0]])).toBeCloseTo(45, 6);
  });

  it('a 100% deduction takes the whole amount', () => {
    expect(applyRule4(10000, at(10), [{ date: at(11), deduct: 100 }])).toBe(0);
  });

  it('does not change the entries it is given', () => {
    const copy = JSON.stringify(entries);
    applyRule4(10000, at(10), entries);
    expect(JSON.stringify(entries)).toBe(copy);
  });
});

describe('Rule 4 helpers', () => {
  it('rule4Applies is true only when a withdrawal came after the bet', () => {
    expect(rule4Applies(at(10), entries)).toBe(true);
    expect(rule4Applies(at(12), entries)).toBe(true);
    expect(rule4Applies(at(14), entries)).toBe(false);
    expect(rule4Applies(at(10), [])).toBe(false);
  });

  it('rule4Percentages lists the deductions that apply, in order', () => {
    expect(rule4Percentages(at(10), entries)).toEqual([10, 20]);
    expect(rule4Percentages(at(12), entries)).toEqual([20]);
    expect(rule4Percentages(at(14), entries)).toEqual([]);
  });

  it('rule4EntriesAfter returns the entries after the bet', () => {
    expect(rule4EntriesAfter(at(12), entries)).toEqual([entries[1]]);
  });
});
