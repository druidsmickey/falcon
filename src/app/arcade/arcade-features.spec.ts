import { beforeEach, describe, expect, it } from 'vitest';
import { ARCADE_KEY, ArcadeStore } from './arcade-store';
import {
  DOUBLE_SECONDS, GameEvent, HEIGHT, LANE_XS, LANE_Y, MAX_LANE_LEVEL, MAX_MULTIPLIER, MAX_ON_TABLE, MYSTERIES, NUDGES_PER_BALL, Pinball, SAUCER_HOLD_SECONDS,
} from './pinball-engine';
import {
  BALL_STYLES, dailyStreak, dayKey, levelOf, levelProgress, previousDay, soClose, starsFor, styleById, unlocked, xpForGame, xpToReach,
} from './progression';
import { THEMES } from './themes';

const run = (game: Pinball, seconds: number): void => {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += 1 / 60) game.step(1 / 60);
};

/** A game with the ball in play, high above everything, so that only what a test does happens. */
const playing = (themeIndex = 0): Pinball => {
  const game = new Pinball(THEMES[themeIndex]);
  game.phase = 'playing';
  game.ball = { x: 330, y: 250, vx: 0, vy: 0 };
  return game;
};

const events = (game: Pinball): GameEvent[] => {
  const seen: GameEvent[] = [];
  game.onEvent = e => seen.push(e);
  return seen;
};

/** Puts the ball on a spot with no speed, as if it just arrived there. */
const place = (game: Pinball, x: number, y: number, ballIndex = 0): void => {
  game.balls[ballIndex] = { x, y, vx: 0, vy: 0 };
};

const drain = (game: Pinball): void => {
  game.ballSaveLeft = 0;
  game.ball = { x: 180, y: HEIGHT + 40, vx: 0, vy: 100 };
  run(game, 0.05);
};

describe('nudging', () => {
  it('pushes the ball up and sideways, four times per ball', () => {
    const game = playing();
    const seen = events(game);
    place(game, 330, 250);
    expect(game.nudge(1)).toBe(true);
    expect(game.ball.vx).toBeGreaterThan(100);
    expect(game.ball.vy).toBeLessThan(-100);
    expect(seen).toContain('nudge');

    for (let i = 1; i < NUDGES_PER_BALL; i++) expect(game.nudge(-1)).toBe(true);
    expect(game.nudgesLeft).toBe(0);
    expect(game.nudge(1)).toBe(false);
  });

  it('alternates sides when no direction is given, and comes back with the next ball', () => {
    const game = playing();
    place(game, 330, 250);
    game.nudge();
    const first = Math.sign(game.ball.vx);
    place(game, 330, 250);
    game.nudge();
    expect(Math.sign(game.ball.vx)).toBe(-first);

    game.ballSaveLeft = 0;
    drain(game);
    expect(game.nudgesLeft).toBe(NUDGES_PER_BALL);
  });

  it('does nothing while the ball waits on the plunger or the game is over or paused', () => {
    const game = new Pinball();
    expect(game.nudge(1)).toBe(false);
    const paused = playing();
    paused.togglePause();
    expect(paused.nudge(1)).toBe(false);
  });
});

describe('pausing', () => {
  it('stops everything, lets go of the flippers, and goes on from the same place', () => {
    const game = playing();
    place(game, 330, 250);
    game.setLeft(true);
    game.togglePause();
    expect(game.paused).toBe(true);
    expect(game.flippers[0].pressed).toBe(false);

    const { x, y } = game.ball;
    run(game, 1);
    expect(game.ball.x).toBe(x);
    expect(game.ball.y).toBe(y);

    game.togglePause();
    run(game, 0.2);
    expect(game.ball.y).toBeGreaterThan(y);
  });

  it('is not possible after the game', () => {
    const game = playing();
    game.phase = 'over';
    game.togglePause();
    expect(game.paused).toBe(false);
  });
});

describe('the multiplier lanes', () => {
  it('a ball running through a lane lights it, once', () => {
    const game = playing();
    const seen = events(game);
    place(game, LANE_XS[1], LANE_Y);
    run(game, 0.01);
    expect(game.lanes).toEqual([false, true, false, false]);
    expect(seen).toContain('lane');
    const score = game.score;
    place(game, LANE_XS[1], LANE_Y);
    run(game, 0.01);
    expect(game.score).toBe(score);
  });

  it('the flipper buttons move the lit lanes along', () => {
    const game = playing();
    game.lanes[0] = true;
    game.lanes[1] = true;
    game.setRight(true);
    expect(game.lanes).toEqual([false, true, true, false]);
    game.setRight(false);
    game.setLeft(true);
    expect(game.lanes).toEqual([true, true, false, false]);
    // the lit lanes wrap round
    game.setLeft(false);
    game.setLeft(true);
    expect(game.lanes).toEqual([true, false, false, true]);
  });

  it('lighting all four raises the multiplier and clears the lanes; losing the ball takes it back', () => {
    const game = playing();
    game.ball = { x: 330, y: 250, vx: 0, vy: 0 };
    LANE_XS.forEach((x, i) => {
      place(game, x, LANE_Y);
      run(game, 0.01);
      expect(game.laneLevel).toBe(i === 3 ? 2 : 1);
    });
    // the lanes start again (the ball that completed them may still be touching the last one)
    expect(game.lanes.filter(Boolean).length).toBeLessThanOrEqual(1);
    expect(game.multiplier).toBe(2);
    expect(game.laneCompletions).toBe(1);

    drain(game);
    expect(game.laneLevel).toBe(1);
  });

  it('the lanes and the combo together never go past the maximum', () => {
    const game = playing();
    game.laneLevel = MAX_LANE_LEVEL;
    game.combo = 100;
    expect(game.multiplier).toBe(MAX_MULTIPLIER);
    game.combo = 0;
    expect(game.multiplier).toBe(MAX_LANE_LEVEL);
  });
});

describe('mystery saucers', () => {
  const saucerOf = (game: Pinball) => game.saucers[0];

  it('catch the ball for a moment and then let it go towards the middle', () => {
    const game = playing();
    const seen = events(game);
    game.random = () => 0; // the first mystery
    const saucer = saucerOf(game);
    place(game, saucer.x, saucer.y);
    run(game, 0.02);
    expect(saucer.held).not.toBeNull();
    expect(game.ball.held).toBe(true);
    expect(seen).toContain('saucer');
    expect(game.saucerVisits).toBe(1);

    const caught = { x: game.ball.x, y: game.ball.y };
    run(game, SAUCER_HOLD_SECONDS / 2);
    expect(game.ball.x).toBe(caught.x);
    for (let i = 0; i < 120 && saucer.held; i++) run(game, 1 / 60);
    expect(saucer.held).toBeNull();
    expect(game.ball.held).toBe(false);
    expect(game.ball.vx).toBeGreaterThan(0); // the left saucer throws it to the right
    expect(game.ball.vy).toBeLessThan(0);
  });

  it('give double score, a ball saver, an extra ball or a multiball', () => {
    const results: Record<string, (game: Pinball) => boolean> = {
      double: game => game.doubleLeft > 0,
      save: game => game.ballSaveLeft >= 12 - 1,
      extra: game => game.ballsLeft === 4,
      multiball: game => game.balls.length === 3,
    };
    MYSTERIES.forEach((mystery, i) => {
      const game = playing();
      game.ballSaveLeft = 0;
      game.random = () => (i + 0.5) / MYSTERIES.length;
      const saucer = saucerOf(game);
      const before = game.score;
      place(game, saucer.x, saucer.y);
      run(game, SAUCER_HOLD_SECONDS + 0.1);
      expect(results[mystery](game), mystery).toBe(true);
      expect(game.score).toBeGreaterThan(before);
    });
  });

  it('double score really doubles the points, and runs out', () => {
    const game = playing();
    game.doubleLeft = DOUBLE_SECONDS;
    const bumper = game.bumpers[0];
    game.ball = { x: bumper.x + bumper.radius + 6, y: bumper.y, vx: -200, vy: 0 };
    run(game, 0.03);
    expect(game.score).toBe(200);
    game.ball.held = true; // keeps the ball out of the way while the time runs out
    run(game, DOUBLE_SECONDS + 1);
    expect(game.doubleLeft).toBe(0);
  });

  it('do not catch a ball straight after letting one go', () => {
    const game = playing();
    game.random = () => 0;
    const saucer = saucerOf(game);
    place(game, saucer.x, saucer.y);
    run(game, SAUCER_HOLD_SECONDS + 0.05);
    place(game, saucer.x, saucer.y);
    run(game, 0.02);
    expect(saucer.held).toBeNull();
  });
});

describe('multiball', () => {
  const clearTargets = (game: Pinball): void => {
    game.ballSaveLeft = 0;
    for (const target of game.targets) {
      game.ball = { x: target.x, y: target.y + target.radius + 8, vx: 0, vy: -150 };
      run(game, 0.04);
    }
  };

  it('lighting all four targets adds two balls', () => {
    const game = playing();
    const seen = events(game);
    clearTargets(game);
    expect(game.balls.length).toBe(3);
    expect(game.multiball).toBe(true);
    expect(game.multiballs).toBe(1);
    expect(seen).toContain('multiball');
  });

  it('is capped at four balls', () => {
    const game = playing();
    game.startMultiball(2);
    game.startMultiball(2);
    expect(game.balls.length).toBe(MAX_ON_TABLE);
    game.startMultiball(2);
    expect(game.balls.length).toBe(MAX_ON_TABLE);
  });

  it('balls lost while others are in play cost nothing; the last one costs a ball', () => {
    const game = playing();
    game.startMultiball(2);
    game.ballSaveLeft = 0;
    game.balls[1] = { x: 180, y: HEIGHT + 40, vx: 0, vy: 100 };
    run(game, 0.05);
    expect(game.balls.length).toBe(2);
    expect(game.ballsLeft).toBe(3);

    // the first ball can be the one that goes: another takes its place
    game.balls[0] = { x: 180, y: HEIGHT + 40, vx: 0, vy: 100 };
    run(game, 0.05);
    expect(game.balls.length).toBe(1);
    expect(game.phase).toBe('playing');
    expect(game.ballsLeft).toBe(3);

    drain(game);
    expect(game.ballsLeft).toBe(2);
    expect(game.phase).toBe('ready');
    expect(game.balls.length).toBe(1);
  });

  it('does not start while the ball waits on the plunger', () => {
    const game = new Pinball();
    game.startMultiball(2);
    expect(game.balls.length).toBe(1);
  });
});

describe('missions', () => {
  it('count what they ask for, pay a reward, and the next one starts', () => {
    const game = playing();
    const seen = events(game);
    const first = game.mission;
    expect(first.kind).toBe('bumper');

    const bumper = game.bumpers[0];
    for (let i = 0; i < first.goal; i++) {
      game.ball = { x: bumper.x + bumper.radius + 6, y: bumper.y, vx: -200, vy: 0 };
      run(game, 0.03);
    }
    expect(game.missionsDone).toBe(1);
    expect(game.missionIndex).toBe(1);
    expect(game.missionProgress).toBe(0);
    expect(seen).toContain('mission');
    expect(game.score).toBeGreaterThanOrEqual(first.reward);
  });

  it('the combo mission takes the best chain, not a count', () => {
    const game = playing();
    game.missionIndex = game.theme.missions.findIndex(m => m.kind === 'combo');
    const goal = game.mission.goal;
    game.combo = goal - 1;
    game.comboTimer = 3;
    const bumper = game.bumpers[0];
    game.ball = { x: bumper.x + bumper.radius + 6, y: bumper.y, vx: -200, vy: 0 };
    run(game, 0.03);
    expect(game.missionsDone).toBe(1);
  });

  it('go round again, and every table has some', () => {
    const game = playing();
    game.missionIndex = game.theme.missions.length - 1;
    expect(game.mission).toBe(game.theme.missions[game.theme.missions.length - 1]);
    for (const theme of THEMES) {
      expect(theme.missions.length).toBeGreaterThanOrEqual(3);
      expect(theme.missions.every(m => m.goal > 0 && m.reward > 0 && m.text.length > 0)).toBe(true);
    }
    game.missionIndex = game.theme.missions.length;
    expect(game.mission).toBe(game.theme.missions[0]);
  });
});

describe('the end of a game', () => {
  const finish = (game: Pinball): void => {
    for (let i = 0; i < 3; i++) {
      game.phase = 'playing';
      drain(game);
    }
  };

  it('gives stars for the score, and says when it was close', () => {
    const game = new Pinball(THEMES[0]);
    game.best = 20000;
    game.score = game.theme.stars[1] - 300;
    finish(game);
    expect(game.phase).toBe('over');
    expect(game.stars).toBe(1);
    expect(game.closeText).toMatch(/SO CLOSE/);
  });

  it('no stars and no message for a poor game', () => {
    const game = new Pinball(THEMES[0]);
    game.score = 100;
    finish(game);
    expect(game.stars).toBe(0);
    expect(game.closeText).toBeNull();
  });

  it('a tap starts the next game, but not at once', () => {
    const game = new Pinball(THEMES[0]);
    finish(game);
    expect(game.retry()).toBe(false); // too soon
    run(game, 0.6);
    expect(game.retry()).toBe(true);
    expect(game.phase).toBe('ready');
    expect(game.score).toBe(0);
    expect(game.missionsDone).toBe(0);
    expect(game.retry()).toBe(false); // not over any more
  });

  it('a new game starts clean: lanes, nudges, missions and balls', () => {
    const game = new Pinball(THEMES[0]);
    game.laneLevel = 3;
    game.lanes[1] = true;
    game.missionIndex = 2;
    game.startMultiball(2);
    game.restart();
    expect(game.laneLevel).toBe(1);
    expect(game.lanes.some(Boolean)).toBe(false);
    expect(game.missionIndex).toBe(0);
    expect(game.balls.length).toBe(1);
    expect(game.nudgesLeft).toBe(NUDGES_PER_BALL);
  });
});

describe('the four tables keep working with all the new parts', () => {
  it.each(THEMES)('$name: a long game with button mashing, nudges and pauses never breaks', theme => {
    const game = new Pinball(theme);
    let seed = 5;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    game.random = random;
    for (let i = 0; i < 60 * 200; i++) {
      if (i % 30 === 0) { game.setLeft(random() < 0.5); game.setRight(random() < 0.5); }
      if (i % 80 === 0) game.setPlunger(true);
      if (i % 80 === 40) game.setPlunger(false);
      if (i % 97 === 0) game.nudge(random() < 0.5 ? -1 : 1);
      if (i % 500 === 0) { game.togglePause(); game.togglePause(); }
      game.step(1 / 60);
      for (const ball of game.balls) expect(Number.isFinite(ball.x + ball.y)).toBe(true);
      expect(game.balls.length).toBeLessThanOrEqual(MAX_ON_TABLE);
      if (game.phase === 'over') { run(game, 0.6); game.retry(); }
    }
  });

  it('saucers and lanes stay clear of the bumpers on every table', () => {
    for (const theme of THEMES) {
      const game = new Pinball(theme);
      for (const bumper of game.bumpers) {
        for (const saucer of game.saucers) expect(Math.hypot(bumper.x - saucer.x, bumper.y - saucer.y)).toBeGreaterThan(bumper.radius + saucer.radius + 30);
        for (const x of LANE_XS) expect(Math.hypot(bumper.x - x, bumper.y - LANE_Y)).toBeGreaterThan(bumper.radius + 30);
      }
    }
  });
});

// ---------------------------------------------------------------- what is kept between games

describe('stars and the so-close message', () => {
  const theme = THEMES[0];

  it('one star for each threshold passed', () => {
    const [one, two, three] = theme.stars;
    expect([0, one - 1, one, two - 1, two, three - 1, three, three * 3].map(s => starsFor(theme, s))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('says so when a new best or the next star is near, and the nearer one first', () => {
    expect(soClose(theme, 14000, 14500)).toMatch(/500 MORE FOR A NEW BEST/);
    expect(soClose(theme, theme.stars[1] - 100, 0)).toMatch(/100 MORE FOR STAR 2/);
    expect(soClose(theme, theme.stars[1] - 100, theme.stars[1] + 3000)).toMatch(/STAR 2/);
  });

  it('keeps quiet when nothing is close, or when the best was beaten and all stars won', () => {
    expect(soClose(theme, 100, 90000)).toBeNull();
    expect(soClose(theme, theme.stars[2] + 1, 100)).toBeNull();
  });
});

describe('experience, levels and ball styles', () => {
  it('a game is worth its score, its stars and its missions', () => {
    expect(xpForGame(10000, 2, 3)).toBe(200 + 200 + 150);
    expect(xpForGame(0, 0, 0)).toBe(0);
    expect(xpForGame(-5, 0, 0)).toBe(0);
  });

  it('levels need more and more experience', () => {
    expect([1, 2, 3, 4, 5].map(xpToReach)).toEqual([0, 250, 750, 1500, 2500]);
    expect([0, 249, 250, 749, 750, 2500].map(levelOf)).toEqual([1, 1, 2, 2, 3, 5]);
  });

  it('shows how far through the level the player is', () => {
    expect(levelProgress(0)).toEqual({ level: 1, into: 0, needed: 250, fraction: 0 });
    const half = levelProgress(250 + 250);
    expect(half.level).toBe(2);
    expect(half.fraction).toBe(0.5);
  });

  it('balls are unlocked by level, and an unknown ball is the table ball', () => {
    expect(BALL_STYLES[0].level).toBe(1);
    expect(unlocked(styleById('gold'), 2)).toBe(false);
    expect(unlocked(styleById('gold'), 3)).toBe(true);
    expect(styleById('nonsense').id).toBe('table');
    expect(styleById(null).id).toBe('table');
    expect(new Set(BALL_STYLES.map(s => s.id)).size).toBe(BALL_STYLES.length);
  });
});

describe('the daily streak', () => {
  it('days are written the same way and the day before is found, also over month and year ends', () => {
    expect(dayKey(new Date(2026, 9, 25))).toBe('2026-10-25');
    expect(previousDay('2026-10-25')).toBe('2026-10-24');
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2027-01-01')).toBe('2026-12-31');
  });

  it('the first game ever starts a streak of one day', () => {
    expect(dailyStreak(null, 0, '2026-10-25')).toEqual({ streak: 1, bonus: 100 });
  });

  it('the next day carries on, a missed day starts again, the same day gives nothing more', () => {
    expect(dailyStreak('2026-10-24', 3, '2026-10-25')).toEqual({ streak: 4, bonus: 400 });
    expect(dailyStreak('2026-10-22', 3, '2026-10-25')).toEqual({ streak: 1, bonus: 100 });
    expect(dailyStreak('2026-10-25', 3, '2026-10-25')).toEqual({ streak: 3, bonus: 0 });
  });

  it('the bonus stops growing after seven days', () => {
    expect(dailyStreak('2026-10-24', 6, '2026-10-25').bonus).toBe(700);
    expect(dailyStreak('2026-10-24', 20, '2026-10-25')).toEqual({ streak: 21, bonus: 700 });
  });
});

describe('what the store keeps of it', () => {
  let saved: Record<string, string>;
  let store: ArcadeStore;

  beforeEach(() => {
    saved = {};
    store = new ArcadeStore({ getItem: key => saved[key] ?? null, setItem: (key, value) => { saved[key] = value; } });
  });

  it('keeps the most stars won on each table, and the experience', () => {
    store.finish('dino', { score: 8000, stars: 1, xp: 300 });
    store.finish('dino', { score: 4000, stars: 0, xp: 100 });
    const second = store.finish('dino', { score: 20000, stars: 2, xp: 600 });
    const data = store.load();
    expect(data.stars.dino).toBe(2);
    expect(data.stars.cars).toBe(0);
    expect(data.xp).toBe(1000);
    expect([second.xpBefore, second.xpAfter, second.isBest]).toEqual([400, 1000, true]);
    expect(data.games.dino).toBe(3);
  });

  it('counts the first game of each day once, and carries the streak', () => {
    expect(store.claimDaily('2026-10-24')).toEqual({ streak: 1, bonus: 100 });
    expect(store.claimDaily('2026-10-24')).toBeNull();
    expect(store.claimDaily('2026-10-25')).toEqual({ streak: 2, bonus: 200 });
    expect(store.claimDaily('2026-10-28')).toEqual({ streak: 1, bonus: 100 });
    const data = store.load();
    expect(data.streak).toBe(1);
    expect(data.lastDay).toBe('2026-10-28');
    expect(data.xp).toBe(400);
  });

  it('remembers the chosen ball', () => {
    expect(store.load().ball).toBe('table');
    store.setBall('gold');
    expect(store.load().ball).toBe('gold');
  });

  it('odd saved data is ignored', () => {
    saved[ARCADE_KEY] = JSON.stringify({ stars: { dino: 9, cars: -1 }, xp: 'lots', streak: 2.7, lastDay: 'yesterday', ball: 5 });
    const data = store.load();
    expect(data.stars.dino).toBe(3);
    expect(data.stars.cars).toBe(0);
    expect(data.xp).toBe(0);
    expect(data.streak).toBe(2);
    expect(data.lastDay).toBeNull();
    expect(data.ball).toBe('table');
  });
});
