import { beforeEach, describe, expect, it } from 'vitest';
import { ARCADE_KEY, ArcadeStore } from './arcade-store';
import {
  BALL_SAVE_SECONDS, COMBO_WINDOW, EXTRA_BALL_EVERY, GameEvent, HEIGHT, HITS_PER_LEVEL, MAX_BALLS, MAX_MULTIPLIER, Pinball,
} from './pinball-engine';
import { THEMES, themeById } from './themes';

const run = (game: Pinball, seconds: number): void => {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += 1 / 60) game.step(1 / 60);
};

/** Puts the ball against a bumper so that it is hit once. */
const hitBumper = (game: Pinball, index = 0): void => {
  const bumper = game.bumpers[index];
  game.phase = 'playing';
  game.ball = { x: bumper.x + bumper.radius + 6, y: bumper.y, vx: -200, vy: 0 };
  run(game, 0.03);
};

const drain = (game: Pinball): void => {
  game.ballSaveLeft = 0;
  game.ball = { x: 180, y: HEIGHT + 40, vx: 0, vy: 100 };
  run(game, 0.05);
};

describe('the four tables', () => {
  it('there are four, with their own names, colours and layouts', () => {
    expect(THEMES.map(t => t.id)).toEqual(['dino', 'cars', 'plants', 'ocean']);
    expect(new Set(THEMES.map(t => t.name)).size).toBe(4);
    expect(new Set(THEMES.map(t => t.wall)).size).toBe(4);
    expect(themeById('nonsense').id).toBe('dino');
    expect(themeById('ocean').id).toBe('ocean');
  });

  it.each(THEMES)('$name: bumpers stay clear of the walls, the lane, the flippers and each other', theme => {
    const game = new Pinball(theme);
    expect(game.bumpers.length).toBeGreaterThanOrEqual(3);
    for (const [i, b] of game.bumpers.entries()) {
      expect(b.x - b.radius).toBeGreaterThan(30);
      expect(b.x + b.radius).toBeLessThan(330); // the lane wall is at 340
      expect(b.y - b.radius).toBeGreaterThan(160); // below the row of targets
      expect(b.y + b.radius).toBeLessThan(470); // well above the flippers
      for (const other of game.bumpers.slice(i + 1)) {
        expect(Math.hypot(b.x - other.x, b.y - other.y)).toBeGreaterThan(b.radius + other.radius + 24); // the ball (18) fits between
      }
    }
  });

  it.each(THEMES)('$name: a long game with button mashing never loses the ball or breaks', theme => {
    const game = new Pinball(theme);
    let seed = 11;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 60 * 150; i++) {
      if (i % 30 === 0) { game.setLeft(random() < 0.5); game.setRight(random() < 0.5); }
      if (i % 80 === 0) game.setPlunger(true);
      if (i % 80 === 40) game.setPlunger(false);
      game.step(1 / 60);
      expect(Number.isFinite(game.ball.x + game.ball.y + game.score)).toBe(true);
      if (game.phase === 'over') game.restart();
    }
  });

  it.each(THEMES)('$name: a ball dropped on each bumper is thrown off it and scores', theme => {
    const game = new Pinball(theme);
    game.bumpers.forEach((_, i) => {
      const before = game.score;
      hitBumper(game, i);
      expect(game.score).toBeGreaterThan(before);
    });
  });
});

describe('scoring', () => {
  it('hits in quick succession build a multiplier up to the maximum, and it fades', () => {
    const game = new Pinball();
    expect(game.multiplier).toBe(1);
    game.combo = 5;
    expect(game.multiplier).toBe(2);
    game.combo = 14;
    expect(game.multiplier).toBe(3);
    game.combo = 500;
    expect(game.multiplier).toBe(MAX_MULTIPLIER);

    game.combo = 6;
    game.comboTimer = COMBO_WINDOW;
    game.phase = 'playing';
    game.ball = { x: 200, y: 400, vx: 0, vy: 0 };
    game.ballSaveLeft = 0;
    run(game, COMBO_WINDOW + 0.2);
    expect(game.combo).toBe(0);
  });

  it('a bumper is worth more with the multiplier and as the table levels up', () => {
    const game = new Pinball();
    game.combo = 10; // x3
    const before = game.score;
    hitBumper(game);
    expect(game.score - before).toBe(100 * 3);

    game.combo = 0;
    game.level = 4;
    expect(game.bumperValue).toBe(200);
  });

  it('every few bumper hits the theme meter goes up and pays a bonus', () => {
    const game = new Pinball();
    const events: GameEvent[] = [];
    game.onEvent = e => events.push(e);
    for (let i = 0; i < HITS_PER_LEVEL; i++) hitBumper(game, i % game.bumpers.length);
    expect(game.level).toBe(1);
    expect(events).toContain('level');
    expect(game.levelHits).toBe(0);
  });

  it('a target lights once, and lighting all four scores a bonus, resets them and extends the ball save', () => {
    const game = new Pinball();
    const events: GameEvent[] = [];
    game.onEvent = e => events.push(e);
    game.phase = 'playing';
    game.ballSaveLeft = 0;
    for (const target of game.targets) {
      game.ball = { x: target.x, y: target.y + target.radius + 8, vx: 0, vy: -150 };
      run(game, 0.04);
    }
    expect(events.filter(e => e === 'target').length).toBe(4);
    expect(events).toContain('clear');
    expect(game.clears).toBe(1);
    expect(game.targets.every(t => !t.lit)).toBe(true);
    expect(game.ballSaveLeft).toBeGreaterThan(4);
    expect(game.score).toBeGreaterThan(2500);
  });

  it('an extra ball comes every 10,000 points, up to the maximum', () => {
    const game = new Pinball();
    game.score = EXTRA_BALL_EVERY - 50;
    hitBumper(game);
    expect(game.ballsLeft).toBe(4);
    expect(game.nextExtra).toBe(EXTRA_BALL_EVERY * 2);

    game.ballsLeft = MAX_BALLS;
    game.score = EXTRA_BALL_EVERY * 2 - 50;
    hitBumper(game);
    expect(game.ballsLeft).toBe(MAX_BALLS);
  });

  it('beating the best score is announced once', () => {
    const game = new Pinball();
    game.best = 150;
    const events: GameEvent[] = [];
    game.onEvent = e => events.push(e);
    hitBumper(game);
    hitBumper(game);
    hitBumper(game);
    expect(game.newBest).toBe(true);
    expect(events.filter(e => e === 'best')).toHaveLength(1);
  });

  it('no announcement on the very first game, when there is nothing to beat', () => {
    const game = new Pinball();
    hitBumper(game);
    expect(game.newBest).toBe(false);
  });
});

describe('ball save', () => {
  it('a ball that drains just after the launch is given back and costs nothing', () => {
    const game = new Pinball();
    const events: GameEvent[] = [];
    game.onEvent = e => events.push(e);
    game.setPlunger(true);
    run(game, 0.3);
    game.setPlunger(false);
    expect(game.ballSaveLeft).toBeCloseTo(BALL_SAVE_SECONDS, 0);

    game.ball = { x: 180, y: HEIGHT + 40, vx: 0, vy: 100 };
    run(game, 0.05);
    expect(game.ballsLeft).toBe(3);
    expect(game.phase).toBe('ready');
    expect(events).toContain('save');
    expect(game.ballSaveLeft).toBe(0);
  });

  it('once the time is up the ball is lost as usual', () => {
    const game = new Pinball();
    game.phase = 'playing';
    game.ballSaveLeft = 0;
    drain(game);
    expect(game.ballsLeft).toBe(2);
  });

  it('losing the ball ends the multiplier', () => {
    const game = new Pinball();
    game.phase = 'playing';
    game.combo = 12;
    game.comboTimer = 2;
    drain(game);
    expect(game.combo).toBe(0);
  });

  it('the game reports when it is over, and a new game starts clean', () => {
    const game = new Pinball();
    const events: GameEvent[] = [];
    game.onEvent = e => events.push(e);
    game.level = 3;
    game.clears = 2;
    for (let i = 0; i < 3; i++) { game.phase = 'playing'; drain(game); }
    expect(game.phase).toBe('over');
    expect(events).toContain('over');
    game.restart();
    expect(game.level).toBe(0);
    expect(game.clears).toBe(0);
    expect(game.score).toBe(0);
    expect(game.ballsLeft).toBe(3);
  });
});

describe('the saved scores', () => {
  let saved: Record<string, string>;
  let store: ArcadeStore;

  beforeEach(() => {
    saved = {};
    store = new ArcadeStore({ getItem: key => saved[key] ?? null, setItem: (key, value) => { saved[key] = value; } });
  });

  it('starts empty, with the sound off', () => {
    const data = store.load();
    expect(Object.values(data.best)).toEqual([0, 0, 0, 0]);
    expect(data.muted).toBe(true);
    expect(data.last).toBe('dino');
  });

  it('keeps the best score of each table separately and counts the games', () => {
    expect(store.record('cars', 5000)).toBe(true);
    expect(store.record('cars', 3000)).toBe(false);
    expect(store.record('cars', 7000)).toBe(true);
    expect(store.record('ocean', 100)).toBe(true);
    const data = store.load();
    expect(data.best.cars).toBe(7000);
    expect(data.games.cars).toBe(3);
    expect(data.best.ocean).toBe(100);
    expect(data.best.dino).toBe(0);
  });

  it('remembers the last table and the sound setting', () => {
    store.setLast('plants');
    store.setMuted(false);
    const data = store.load();
    expect(data.last).toBe('plants');
    expect(data.muted).toBe(false);
  });

  it('damaged or odd saved data is ignored', () => {
    saved[ARCADE_KEY] = '{not json';
    expect(store.load().best.dino).toBe(0);
    saved[ARCADE_KEY] = JSON.stringify({ best: { dino: 'a lot', cars: -5, ocean: 900.7 }, last: 'moon', muted: 'yes' });
    const data = store.load();
    expect(data.best.dino).toBe(0);
    expect(data.best.cars).toBe(0);
    expect(data.best.ocean).toBe(900);
    expect(data.last).toBe('dino');
    expect(data.muted).toBe(true);
  });

  it('works when the browser will not store anything', () => {
    const blocked = new ArcadeStore({ getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } });
    expect(() => blocked.record('dino', 10)).not.toThrow();
    expect(blocked.load().best.dino).toBe(0);
  });

  it('what is stored says nothing about the app', () => {
    store.record('dino', 1234);
    expect(ARCADE_KEY).not.toMatch(/itb|bet|duress|vault/i);
    expect(saved[ARCADE_KEY]).not.toMatch(/itb|bet|duress|vault/i);
  });
});
