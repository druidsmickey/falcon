import { BetRequest } from '../models';

/** A bet read from a WhatsApp message, as the server lists it (see backend/lib/whatsappInbox.js). */
export interface InboxItem {
  id: string;
  text: string;
  contactName: string;
  clientName: string;
  sentAt: string;
  unreadable: boolean;
  /** A sample from the demo button: confirming it saves nothing. */
  demo?: boolean;
  raceNum: number | null;
  horseNum: number | null;
  mode: 'f500' | 'odds' | null;
  amountKind: 'books' | 'stake' | '?';
  amount: number | null;
  books: number | null;
  f500: number | null;
  stake: number | null;
  odds100: number | null;
  unsure: boolean;
  issues: string[];
  clientRequestId: string;
}

/** What is being edited before the bet is saved. `kind` is how the amount counts: books at an F500, or a stake at odds. */
export interface Draft {
  id: string;
  clientRequestId: string;
  text: string;
  sentAt: string;
  contactName: string;
  clientName: string;
  unreadable: boolean;
  demo: boolean;
  unsure: boolean;
  issues: string[];
  raceNum: number | null;
  horseNum: number | null;
  kind: 'books' | 'stake' | null;
  /** The number that was sent when it was not said whether it is books or a stake. */
  amount: number | null;
  books: number | null;
  f500: number | null;
  stake: number | null;
  odds100: number | null;
  tax: number | null;
  /** A purchase has negative figures, as on the Entry page. */
  purchase: boolean;
}

/** What is known about the race and horse of a draft, from the meeting's races and horses (null: not known yet). */
export interface Surroundings {
  raceExists?: boolean | null;
  horseExists?: boolean | null;
  /** The horse is withdrawn, or the race has a winner: the Entry page does not allow a bet on it. */
  blocked?: boolean;
}

export const DEFAULT_TAX = 5;

// The same limits as the Entry page
export const BOOKS_MAX = 5000;
export const F500_MAX = 470;
export const STAKE_MIN = 100;
export const STAKE_MAX = 1000000;
export const ODDS_MIN = 115;
export const ODDS_MAX = 10000;

export function draftFrom(item: InboxItem): Draft {
  const kind = item.amountKind === 'books' ? 'books' : item.amountKind === 'stake' ? 'stake' : null;
  return {
    id: item.id,
    clientRequestId: item.clientRequestId,
    text: item.text,
    sentAt: item.sentAt,
    contactName: item.contactName,
    clientName: item.clientName,
    unreadable: item.unreadable,
    demo: !!item.demo,
    unsure: item.unsure,
    issues: item.issues,
    raceNum: item.raceNum,
    horseNum: item.horseNum,
    kind,
    amount: item.amount,
    books: item.books,
    f500: item.f500,
    stake: item.stake,
    odds100: item.odds100,
    tax: DEFAULT_TAX,
    purchase: false,
  };
}

/** Says what the number that came without "x", "@" or "k" is. */
export function chooseKind(draft: Draft, kind: 'books' | 'stake'): Draft {
  const amount = draft.amount ?? (kind === 'books' ? draft.stake : draft.books);
  return kind === 'books'
    ? { ...draft, kind, books: amount, stake: null }
    : { ...draft, kind, stake: amount, books: null };
}

const present = (value: number | null): value is number => typeof value === 'number' && Number.isFinite(value);
const wholeNumber = (value: number | null): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1;
const between = (value: number | null, low: number, high: number): boolean => present(value) && value >= low && value <= high;

/**
 * What is still missing or wrong, in the words shown to the person. An empty list means the bet can be saved.
 * A figure that is missing is named alone ("odds"); one outside the Entry page's limits says so ("odds must be 115 to 10000").
 */
export function problems(draft: Draft, around: Surroundings = {}): string[] {
  const list: string[] = [];
  if (!draft.clientName.trim()) list.push('client name');

  if (!wholeNumber(draft.raceNum)) list.push('race');
  else if (around.raceExists === false) list.push('race is not in this meeting');

  if (!wholeNumber(draft.horseNum)) list.push('horse');
  else if (wholeNumber(draft.raceNum) && around.raceExists !== false) {
    if (around.horseExists === false) list.push('horse is not in this race');
    else if (around.blocked) list.push('horse is withdrawn or the race has a winner');
  }

  if (draft.kind === null) {
    list.push('F500 or odds');
  } else if (draft.kind === 'books') {
    if (!present(draft.books) || draft.books === 0) list.push('books');
    else if (!between(draft.books, 1, BOOKS_MAX)) list.push(`books must be 1 to ${BOOKS_MAX}`);
    if (!present(draft.f500) || draft.f500 === 0) list.push('F500');
    else if (!between(draft.f500, 1, F500_MAX)) list.push(`F500 must be 1 to ${F500_MAX}`);
  } else {
    if (!present(draft.stake) || draft.stake === 0) list.push('stake');
    else if (!between(draft.stake, STAKE_MIN, STAKE_MAX)) list.push(`stake must be ${STAKE_MIN} to ${STAKE_MAX}`);
    if (!present(draft.odds100) || draft.odds100 === 0) list.push('odds');
    else if (!between(draft.odds100, ODDS_MIN, ODDS_MAX)) list.push(`odds must be ${ODDS_MIN} to ${ODDS_MAX}`);
  }
  if (draft.tax === null || draft.tax < 0 || draft.tax > 100) list.push('tax');
  return list;
}

/** True if what was asked about (a field name such as "odds") is among the problems. */
export const hasProblem = (list: string[], field: string): boolean => list.some(p => p === field || p.startsWith(field + ' '));

/**
 * The bet to send, worked out the same way as on the Entry page, or null while anything is missing.
 * The time of the bet is the time the message was sent.
 */
export function toBetRequest(draft: Draft, meetingName: string, horseName: string, around: Surroundings = {}): BetRequest | null {
  if (problems(draft, around).length > 0 || !draft.kind) return null;

  const sign = draft.purchase ? -1 : 1;
  const bet: BetRequest = {
    meetingName,
    raceNum: draft.raceNum as number,
    horseNum: draft.horseNum as number,
    horseName,
    clientName: draft.clientName.trim().toUpperCase(),
    tax: draft.tax,
    betTime: new Date(draft.sentAt),
    clientRequestId: draft.clientRequestId,
  };

  if (draft.kind === 'stake') {
    const stake = draft.stake as number;
    const odds = draft.odds100 as number;
    bet.odds100 = odds;
    bet.books = ((stake * odds) / 50000) * sign;
    bet.stake = stake * sign;
    bet.payout = ((odds * stake) / 100) * sign;
  } else {
    const books = draft.books as number;
    const f500 = draft.f500 as number;
    bet.f500 = f500;
    bet.books = books * sign;
    bet.stake = f500 * books * sign;
    bet.payout = books * 500 * sign;
  }
  return bet;
}
