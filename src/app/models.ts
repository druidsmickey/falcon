// Shapes of the data exchanged with the backend (see backend/models).
// Dates arrive from the server as text and are turned into Date objects where they are used.

/** A bet. Purchases have negative stake, books and payout. */
export interface Bet {
  _id?: string;
  meetingName: string;
  raceNum: number;
  horseNum: number;
  horseName: string;
  clientName: string;
  betTime: string | Date;
  createdAt?: string;
  tax: number;
  /** Set when the bet was entered as books x F500 */
  f500?: number;
  /** Set when the bet was entered as stake at odds */
  odds100?: number;
  books: number;
  stake: number;
  payout: number;
  cancelled?: boolean;
  clientRequestId?: string;
}

/** A bet as the entry screens build it before it is sent. */
export type BetRequest = Omit<Bet, '_id' | 'createdAt' | 'cancelled' | 'books' | 'stake' | 'payout' | 'tax'> &
  Partial<Pick<Bet, 'books' | 'stake' | 'payout'>> & { tax: number | null };

/** The settings of one horse of a race (names, withdrawals, winner). */
export interface HorseParam {
  _id?: string;
  meetingName: string;
  raceNum: number;
  horseNum: number;
  horseName?: string;
  winner?: boolean;
  special?: string | Date | null;
  rule4?: string | Date | null;
  rule4deduct?: number | null;
  updatedAt?: string;
}

/** A race of the selected meeting. */
export interface SelectedRace {
  raceNum: number;
  numHorse: number;
  raceName: string;
  meetingName: string;
  selected?: boolean;
  updatedAt?: string;
}

/** A horse as listed in the bet slip. */
export interface BetslipHorse {
  horseNum: number;
  horseName: string;
  hasSpecial: boolean;
  hasRule4: boolean;
  isWinner?: boolean;
}

/** A manual adjustment added to a client's report. */
export interface Addon {
  meetingName?: string;
  clientName: string;
  stake: number;
}

/** A bet with its time as a Date, as the report screens list it. */
export type BetRow = Bet & { date: Date };

/** When the bet was placed (falls back to when it was saved). */
export function betTimeOf(bet: Bet): Date {
  return new Date((bet.betTime || bet.createdAt) as string | Date);
}
