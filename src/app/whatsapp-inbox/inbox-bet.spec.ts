import { describe, expect, it } from 'vitest';
import { Draft, InboxItem, chooseKind, draftFrom, hasProblem, problems, toBetRequest } from './inbox-bet';

const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: 'a1', text: '11 500x90', contactName: 'Ann Smith', clientName: 'ANNIE', sentAt: '2026-10-24T10:15:00.000Z',
  unreadable: false, raceNum: 1, horseNum: 1, mode: 'f500', amountKind: 'books', amount: null, books: 500, f500: 90,
  stake: null, odds100: null, unsure: false, issues: [], clientRequestId: 'wa-abc', ...over,
});
const stakeItem = (over: Partial<InboxItem> = {}) => item({ mode: 'odds', amountKind: 'stake', books: null, f500: null, stake: 5000, odds100: 2000, ...over });

describe('a bet read from a WhatsApp message', () => {
  it('books x F500 is worked out like the Entry page does', () => {
    const bet = toBetRequest(draftFrom(item()), 'ASCOT', 'DAMBUSTER');
    expect(bet).toMatchObject({ meetingName: 'ASCOT', raceNum: 1, horseNum: 1, horseName: 'DAMBUSTER', clientName: 'ANNIE', tax: 5, f500: 90, books: 500, stake: 45000, payout: 250000 });
    expect(bet?.odds100).toBeUndefined();
  });

  it('a stake at odds is worked out like the Entry page does', () => {
    const bet = toBetRequest(draftFrom(stakeItem()), 'ASCOT', 'DAMBUSTER');
    expect(bet).toMatchObject({ odds100: 2000, stake: 5000, books: 200, payout: 100000 });
    expect(bet?.f500).toBeUndefined();
  });

  it('a purchase has negative figures, as on the Entry page', () => {
    const books = toBetRequest({ ...draftFrom(item()), purchase: true }, 'ASCOT', 'X');
    expect(books).toMatchObject({ books: -500, stake: -45000, payout: -250000, f500: 90 });
    const stake = toBetRequest({ ...draftFrom(stakeItem()), purchase: true }, 'ASCOT', 'X');
    expect(stake).toMatchObject({ books: -200, stake: -5000, payout: -100000, odds100: 2000 });
  });

  it('the time of the bet is the time of the message, and the request id keeps it from being entered twice', () => {
    const bet = toBetRequest(draftFrom(item()), 'ASCOT', 'X');
    expect(bet?.betTime).toEqual(new Date('2026-10-24T10:15:00.000Z'));
    expect(bet?.clientRequestId).toBe('wa-abc');
  });

  it('the client name is entered in capitals, as on the Entry page', () => {
    const draft = { ...draftFrom(item()), clientName: ' big ann ' };
    expect(toBetRequest(draft, 'ASCOT', 'X')?.clientName).toBe('BIG ANN');
  });

  it('a stake without odds cannot be saved until the odds are typed', () => {
    const draft = draftFrom(stakeItem({ odds100: null, issues: ['odds missing'] }));
    expect(problems(draft)).toEqual(['odds']);
    expect(toBetRequest(draft, 'ASCOT', 'X')).toBeNull();
    expect(problems({ ...draft, odds100: 2000 })).toEqual([]);
  });

  it('a bare number is books or a stake as the person says, and the other figure is then needed', () => {
    const draft = draftFrom(item({ mode: null, amountKind: '?', amount: 500, books: null, f500: null }));
    expect(draft.kind).toBeNull();
    expect(problems(draft)).toEqual(['F500 or odds']);

    const asBooks = chooseKind(draft, 'books');
    expect([asBooks.books, asBooks.stake]).toEqual([500, null]);
    expect(problems(asBooks)).toEqual(['F500']);
    expect(problems({ ...asBooks, f500: 90 })).toEqual([]);

    const asStake = chooseKind(draft, 'stake');
    expect([asStake.stake, asStake.books]).toEqual([500, null]);
    expect(problems(asStake)).toEqual(['odds']);
  });

  it('changing the choice moves the same number across', () => {
    const draft = chooseKind(draftFrom(item({ mode: null, amountKind: '?', amount: 500, books: null, f500: null })), 'books');
    const switched = chooseKind(draft, 'stake');
    expect(switched.stake).toBe(500);
    expect(switched.books).toBeNull();
  });

  it('race, horse and the name are needed', () => {
    const draft: Draft = { ...draftFrom(item()), raceNum: null, horseNum: null, clientName: ' ' };
    expect(problems(draft)).toEqual(['client name', 'race', 'horse']);
    expect(problems({ ...draftFrom(item()), raceNum: 1.5 })).toEqual(['race']);
  });

  it('the race and horse must exist in the meeting, and the horse must be one that can be bet on', () => {
    expect(problems(draftFrom(item()), { raceExists: true, horseExists: true })).toEqual([]);
    expect(problems(draftFrom(item()), { raceExists: false })).toEqual(['race is not in this meeting']);
    expect(problems(draftFrom(item()), { raceExists: true, horseExists: false })).toEqual(['horse is not in this race']);
    expect(problems(draftFrom(item()), { raceExists: true, horseExists: true, blocked: true })).toEqual(['horse is withdrawn or the race has a winner']);
    expect(problems(draftFrom(item()), { horseExists: null, raceExists: null })).toEqual([]); // nothing known yet
  });

  it('the same limits as the Entry page apply', () => {
    expect(problems({ ...draftFrom(item()), books: 0 })).toEqual(['books']);
    expect(problems({ ...draftFrom(item()), books: 5001 })).toEqual(['books must be 1 to 5000']);
    expect(problems({ ...draftFrom(item()), f500: -5 })).toEqual(['F500 must be 1 to 470']);
    expect(problems({ ...draftFrom(item()), f500: 471 })).toEqual(['F500 must be 1 to 470']);
    expect(problems(draftFrom(stakeItem({ stake: 99 })))).toEqual(['stake must be 100 to 1000000']);
    expect(problems(draftFrom(stakeItem({ odds100: 114 })))).toEqual(['odds must be 115 to 10000']);
    expect(problems(draftFrom(stakeItem({ odds100: 10001 })))).toEqual(['odds must be 115 to 10000']);
    expect(problems({ ...draftFrom(item()), tax: null })).toEqual(['tax']);
    expect(problems({ ...draftFrom(item()), tax: 101 })).toEqual(['tax']);
  });

  it('a field is found among the problems whether it is missing or out of range', () => {
    const list = ['odds must be 115 to 10000', 'books'];
    expect(hasProblem(list, 'odds')).toBe(true);
    expect(hasProblem(list, 'books')).toBe(true);
    expect(hasProblem(list, 'stake')).toBe(false);
    expect(hasProblem(['stake must be 100 to 1000000'], 'stake')).toBe(true);
  });

  it('a line that could not be read starts empty and has to be filled in', () => {
    const draft = draftFrom(item({ unreadable: true, raceNum: null, horseNum: null, mode: null, amountKind: '?', books: null, f500: null, unsure: true }));
    expect(problems(draft)).toEqual(['race', 'horse', 'F500 or odds']);
  });
});
