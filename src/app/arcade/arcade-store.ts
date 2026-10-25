import { DailyResult, dailyStreak, dayKey } from './progression';
import { THEMES, ThemeId } from './themes';

/** Where the scores are kept. The name says nothing about the app. */
export const ARCADE_KEY = 'arcade-v1';

export interface ArcadeData {
  best: Record<ThemeId, number>;
  /** The most stars won on each table (0 to 3). */
  stars: Record<ThemeId, number>;
  games: Record<ThemeId, number>;
  last: ThemeId;
  muted: boolean;
  /** Experience points, and the ball style that is chosen. */
  xp: number;
  ball: string;
  /** The days in a row that a game was played, and the last of them (2026-10-25). */
  streak: number;
  lastDay: string | null;
}

function empty(): ArcadeData {
  const zero = () => Object.fromEntries(THEMES.map(theme => [theme.id, 0])) as Record<ThemeId, number>;
  return { best: zero(), stars: zero(), games: zero(), last: THEMES[0].id, muted: true, xp: 0, ball: 'table', streak: 0, lastDay: null };
}

export interface GameRecord {
  isBest: boolean;
  /** The experience before and after the game. */
  xpBefore: number;
  xpAfter: number;
}

/**
 * The high scores, stars, experience and settings of the game, kept in the browser. Nothing here is secret,
 * so it is not encrypted; it is removed together with everything else by a wipe of the device.
 */
export class ArcadeStore {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = ArcadeStore.browserStorage()) {}

  private static browserStorage(): Storage | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  }

  load(): ArcadeData {
    const data = empty();
    try {
      const saved = JSON.parse(this.storage?.getItem(ARCADE_KEY) ?? 'null') as Partial<ArcadeData> | null;
      if (!saved || typeof saved !== 'object') return data;
      const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
      for (const theme of THEMES) {
        data.best[theme.id] = count(saved.best?.[theme.id]);
        data.games[theme.id] = count(saved.games?.[theme.id]);
        data.stars[theme.id] = Math.min(3, count(saved.stars?.[theme.id]));
      }
      if (THEMES.some(theme => theme.id === saved.last)) data.last = saved.last as ThemeId;
      if (typeof saved.muted === 'boolean') data.muted = saved.muted;
      data.xp = count(saved.xp);
      if (typeof saved.ball === 'string') data.ball = saved.ball;
      data.streak = count(saved.streak);
      if (typeof saved.lastDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.lastDay)) data.lastDay = saved.lastDay;
    } catch {
      // damaged data: start again
    }
    return data;
  }

  private save(data: ArcadeData): void {
    try {
      this.storage?.setItem(ARCADE_KEY, JSON.stringify(data));
    } catch {
      // storage full or blocked: the game still works, the scores are just not kept
    }
  }

  /** Counts a finished game: the best score, the stars and the experience. */
  finish(theme: ThemeId, result: { score: number; stars: number; xp: number }): GameRecord {
    const data = this.load();
    data.games[theme] += 1;
    const isBest = result.score > data.best[theme];
    if (isBest) data.best[theme] = Math.floor(result.score);
    data.stars[theme] = Math.max(data.stars[theme], Math.min(3, Math.max(0, result.stars)));
    const xpBefore = data.xp;
    data.xp += Math.max(0, Math.floor(result.xp));
    this.save(data);
    return { isBest, xpBefore, xpAfter: data.xp };
  }

  /**
   * The first game of a day adds to the streak and gives experience. Returns what was given, or null when the
   * day was already counted.
   */
  claimDaily(today: string = dayKey(new Date())): DailyResult | null {
    const data = this.load();
    const result = dailyStreak(data.lastDay, data.streak, today);
    if (result.bonus === 0) return null;
    data.streak = result.streak;
    data.lastDay = today;
    data.xp += result.bonus;
    this.save(data);
    return result;
  }

  setLast(theme: ThemeId): void {
    const data = this.load();
    data.last = theme;
    this.save(data);
  }

  setMuted(muted: boolean): void {
    const data = this.load();
    data.muted = muted;
    this.save(data);
  }

  setBall(id: string): void {
    const data = this.load();
    data.ball = id;
    this.save(data);
  }
}
