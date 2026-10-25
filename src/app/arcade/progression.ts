// What the player keeps between games: stars for a game, experience points and levels, the ball styles the
// levels unlock, and the daily streak. Pure functions, so they can be tested without a browser.

import { Theme } from './themes';

// ---------------------------------------------------------------- stars

/** 1 to 3 stars for a score on a table (0 below the first). */
export function starsFor(theme: Pick<Theme, 'stars'>, score: number): number {
  return theme.stars.filter(threshold => score >= threshold).length;
}

/**
 * A line for the game-over screen when the player came close to something: a new best, or the next star.
 * "Close" is within 12% of the target. Returns null when nothing was close (or the target was reached).
 */
export function soClose(theme: Pick<Theme, 'stars'>, score: number, best: number): string | null {
  const candidates: { gap: number; target: number; text: (gap: number) => string }[] = [];

  if (best > 0 && score < best) {
    candidates.push({ gap: best - score, target: best, text: gap => `SO CLOSE! ${format(gap)} more for a new best`.toUpperCase() });
  }
  const next = theme.stars.find(threshold => score < threshold);
  if (next !== undefined) {
    const star = theme.stars.indexOf(next) + 1;
    candidates.push({ gap: next - score, target: next, text: gap => `SO CLOSE! ${format(gap)} more for star ${star}`.toUpperCase() });
  }

  const close = candidates.filter(c => c.gap / c.target <= 0.12).sort((a, b) => a.gap / a.target - b.gap / b.target)[0];
  return close ? close.text(close.gap) : null;
}

const format = (n: number): string => Math.round(n).toLocaleString('en-US');

// ---------------------------------------------------------------- experience and levels

/** Points of experience a finished game is worth. */
export function xpForGame(score: number, stars: number, missionsDone: number): number {
  return Math.max(0, Math.floor(score / 50)) + stars * 100 + missionsDone * 50;
}

/** The experience needed to reach a level: 250 for level 2, 750 for level 3, 1500 for level 4... */
export function xpToReach(level: number): number {
  return level <= 1 ? 0 : (250 * (level - 1) * level) / 2;
}

export function levelOf(xp: number): number {
  let level = 1;
  while (xp >= xpToReach(level + 1)) level += 1;
  return level;
}

export interface LevelProgress {
  level: number;
  /** Experience earned in this level, and what the level needs in all. */
  into: number;
  needed: number;
  fraction: number;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelOf(xp);
  const start = xpToReach(level);
  const needed = xpToReach(level + 1) - start;
  const into = xp - start;
  return { level, into, needed, fraction: Math.max(0, Math.min(1, into / needed)) };
}

// ---------------------------------------------------------------- ball styles

export interface BallStyle {
  id: string;
  name: string;
  /** The level that unlocks it. */
  level: number;
  /** Light and dark colour of the ball; null takes the colours of the table. */
  colors: [string, string] | null;
  glow?: string;
  /** The colour turns through the rainbow. */
  rainbow?: boolean;
}

export const BALL_STYLES: BallStyle[] = [
  { id: 'table', name: 'Table', level: 1, colors: null },
  { id: 'steel', name: 'Steel', level: 2, colors: ['#ffffff', '#94a3b8'] },
  { id: 'gold', name: 'Gold', level: 3, colors: ['#fef08a', '#b45309'], glow: '#fbbf24' },
  { id: 'neon', name: 'Neon', level: 5, colors: ['#f0abfc', '#7e22ce'], glow: '#e879f9' },
  { id: 'fire', name: 'Fire', level: 8, colors: ['#fef3c7', '#dc2626'], glow: '#f97316' },
  { id: 'rainbow', name: 'Rainbow', level: 12, colors: ['#ffffff', '#ffffff'], glow: '#ffffff', rainbow: true },
];

export const styleById = (id: string | null | undefined): BallStyle => BALL_STYLES.find(s => s.id === id) ?? BALL_STYLES[0];

export const unlocked = (style: BallStyle, level: number): boolean => level >= style.level;

// ---------------------------------------------------------------- the daily streak

/** A calendar day as text, in the player's own time zone: 2026-10-25. */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function previousDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return dayKey(new Date(year, month - 1, date - 1));
}

export interface DailyResult {
  /** The days in a row, today included. */
  streak: number;
  /** Experience for playing today (0 when today was already counted). */
  bonus: number;
}

/** Experience for the first game of a day: 100 for each day of the streak, up to 7 days. */
export const STREAK_BONUS_PER_DAY = 100;
export const STREAK_BONUS_DAYS = 7;

export function dailyStreak(lastDay: string | null, streak: number, today: string): DailyResult {
  if (lastDay === today) return { streak: Math.max(1, streak), bonus: 0 };
  const next = lastDay !== null && lastDay === previousDay(today) ? streak + 1 : 1;
  return { streak: next, bonus: Math.min(next, STREAK_BONUS_DAYS) * STREAK_BONUS_PER_DAY };
}
