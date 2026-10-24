import { THEMES, ThemeId } from './themes';

/** Where the scores are kept. The name says nothing about the app. */
export const ARCADE_KEY = 'arcade-v1';

export interface ArcadeData {
  best: Record<ThemeId, number>;
  games: Record<ThemeId, number>;
  last: ThemeId;
  muted: boolean;
}

function empty(): ArcadeData {
  const zero = () => Object.fromEntries(THEMES.map(theme => [theme.id, 0])) as Record<ThemeId, number>;
  return { best: zero(), games: zero(), last: THEMES[0].id, muted: true };
}

/**
 * The high scores, the number of games and the settings of the game, kept in the browser. Nothing here is
 * secret, so it is not encrypted; it is removed together with everything else by a wipe of the device.
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
      for (const theme of THEMES) {
        const best = saved.best?.[theme.id];
        const games = saved.games?.[theme.id];
        if (typeof best === 'number' && Number.isFinite(best) && best > 0) data.best[theme.id] = Math.floor(best);
        if (typeof games === 'number' && Number.isFinite(games) && games > 0) data.games[theme.id] = Math.floor(games);
      }
      if (THEMES.some(theme => theme.id === saved.last)) data.last = saved.last as ThemeId;
      if (typeof saved.muted === 'boolean') data.muted = saved.muted;
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

  /** Counts a finished game. Returns true if `score` is a new best for the theme. */
  record(theme: ThemeId, score: number): boolean {
    const data = this.load();
    data.games[theme] += 1;
    const isBest = score > data.best[theme];
    if (isBest) data.best[theme] = Math.floor(score);
    this.save(data);
    return isBest;
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
}
