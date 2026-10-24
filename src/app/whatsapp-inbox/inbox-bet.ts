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

/** What is being edited before the bet is confirmed. `kind` is how the amount counts: books at an F500, or a stake at odds. */
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
}

export const DEFAULT_TAX = 5;

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
  };
}

/** Says what the number that came without "x", "@" or "k" is. */
export function chooseKind(draft: Draft, kind: 'books' | 'stake'): Draft {
  const amount = draft.amount ?? (kind === 'books' ? draft.stake : draft.books);
  return kind === 'books'
    ? { ...draft, kind, books: amount, stake: null }
    : { ...draft, kind, stake: amount, books: null };
}

const positive = (value: number | null): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const wholeNumber = (value: number | null): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1;

/** What is still missing or wrong. An empty list means the bet can be confirmed. */
export function problems(draft: Draft, horseExists: boolean | null = null): string[] {
  const list: string[] = [];
  if (!draft.clientName.trim()) list.push('client name');
  if (!wholeNumber(draft.raceNum)) list.push('race');
  if (!wholeNumber(draft.horseNum)) list.push('horse');
  else if (wholeNumber(draft.raceNum) && horseExists === false) list.push('horse is not in this race');

  if (draft.kind === null) {
    list.push('books or stake');
  } else if (draft.kind === 'books') {
    if (!positive(draft.books)) list.push('books');
    if (!positive(draft.f500)) list.push('F500');
  } else {
    if (!positive(draft.stake)) list.push('stake');
    if (!positive(draft.odds100)) list.push('odds');
  }
  if (draft.tax === null || draft.tax < 0 || draft.tax > 100) list.push('tax');
  return list;
}

/**
 * The bet to send, worked out the same way as on the Entry page, or null while anything is missing.
 * The time of the bet is the time the message was sent.
 */
export function toBetRequest(draft: Draft, meetingName: string, horseName: string): BetRequest | null {
  if (problems(draft).length > 0 || !draft.kind) return null;

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
    bet.books = (stake * odds) / 50000;
    bet.stake = stake;
    bet.payout = (odds * stake) / 100;
  } else {
    const books = draft.books as number;
    const f500 = draft.f500 as number;
    bet.f500 = f500;
    bet.books = books;
    bet.stake = f500 * books;
    bet.payout = books * 500;
  }
  return bet;
}
