import { describe, expect, it } from 'vitest';
import {
  Ball, BALL_RADIUS, closestPointOnSegment, collideWithCircle, collideWithSegment, HEIGHT, Pinball, WIDTH,
} from './pinball-engine';

const ball = (x: number, y: number, vx = 0, vy = 0): Ball => ({ x, y, vx, vy });

// the game ignores jumps longer than a tenth of a second (a stalled page), so time is run in frames
const run = (game: Pinball, seconds: number): void => {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += 1 / 60) game.step(1 / 60);
};

describe('pinball: geometry', () => {
  it('finds the closest point on a line segment', () => {
    expect(closestPointOnSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ x: 5, y: 0 });
    expect(closestPointOnSegment({ x: -5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(closestPointOnSegment({ x: 20, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ x: 10, y: 0 });
    expect(closestPointOnSegment({ x: 3, y: 4 }, { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual({ x: 1, y: 1 });
  });

  it('a ball that hits a wall is pushed out and bounces back', () => {
    const b = ball(50, 100 - BALL_RADIUS + 3, 0, 300); // 3 px into a floor at y = 100
    expect(collideWithSegment(b, { x: 0, y: 100 }, { x: 100, y: 100 }, 0, 0.5)).toBe(true);
    expect(b.y).toBeCloseTo(100 - BALL_RADIUS, 5);
    expect(b.vy).toBeCloseTo(-150, 5);
  });

  it('a ball that is not touching is left alone', () => {
    const b = ball(50, 50, 10, 10);
    expect(collideWithSegment(b, { x: 0, y: 100 }, { x: 100, y: 100 }, 0, 0.5)).toBe(false);
    expect(b).toEqual({ x: 50, y: 50, vx: 10, vy: 10 });
  });

  it('a ball moving away from a wall is not slowed down', () => {
    const b = ball(50, 100 - BALL_RADIUS + 1, 40, -200);
    collideWithSegment(b, { x: 0, y: 100 }, { x: 100, y: 100 }, 0, 0.5);
    expect(b.vy).toBe(-200);
  });

  it('a moving surface hits the ball', () => {
    const b = ball(50, 100 - BALL_RADIUS + 1, 0, 0); // resting on a surface that moves up fast
    collideWithSegment(b, { x: 0, y: 100 }, { x: 100, y: 100 }, 0, 0.3, { x: 0, y: -800 });
    expect(b.vy).toBeLessThan(-800);
  });

  it('a bumper pushes the ball away and kicks it', () => {
    const b = ball(100 + 26 + BALL_RADIUS - 2, 100, -100, 0);
    expect(collideWithCircle(b, { x: 100, y: 100 }, 26, 0.9, 260)).toBe(true);
    expect(b.vx).toBeGreaterThan(100);
  });
});

describe('pinball: the game', () => {
  it('starts with the ball on the plunger and three balls', () => {
    const game = new Pinball();
    expect(game.phase).toBe('ready');
    expect(game.ballsLeft).toBe(3);
    expect(game.score).toBe(0);
  });

  it('the ball stays on the plunger until it is shot', () => {
    const game = new Pinball();
    const { x, y } = game.ball;
    run(game, 1);
    expect(game.ball.x).toBeCloseTo(x, 3);
    expect(game.ball.y).toBeCloseTo(y, 3);
    expect(game.phase).toBe('ready');
  });

  it('holding the plunger charges it and letting go shoots the ball up', () => {
    const game = new Pinball();
    game.setPlunger(true);
    run(game, 0.8);
    expect(game.charge).toBeGreaterThan(0.7);
    game.setPlunger(false);
    expect(game.phase).toBe('playing');
    expect(game.ball.vy).toBeLessThan(-1000);
    run(game, 0.2);
    expect(game.ball.y).toBeLessThan(500);
  });

  it('a full shot comes round the top and into the playfield', () => {
    const game = new Pinball();
    game.setPlunger(true);
    run(game, 1);
    game.setPlunger(false);
    run(game, 1.2);
    expect(game.ball.x).toBeLessThan(345); // left the lane
    expect(game.ball.y).toBeLessThan(HEIGHT);
  });

  it('a weak shot that falls back lands on the plunger again without losing a ball', () => {
    const game = new Pinball();
    game.setPlunger(true);
    run(game, 0.01);
    game.setPlunger(false);
    run(game, 4);
    expect(game.phase).toBe('ready');
    expect(game.ballsLeft).toBe(3);
  });

  it('a ball that falls out of the bottom costs one ball and a new one waits on the plunger', () => {
    const game = new Pinball();
    game.setPlunger(true);
    run(game, 1);
    game.setPlunger(false);
    run(game, 1);
    game.ball.x = 180;
    game.ball.y = HEIGHT + 40; // straight through the gap between the flippers
    game.ball.vy = 100;
    run(game, 0.05);
    expect(game.ballsLeft).toBe(2);
    expect(game.phase).toBe('ready');
  });

  it('the game is over after the third ball, and any button starts a new one', () => {
    const game = new Pinball();
    for (let i = 0; i < 3; i++) {
      game.setPlunger(true);
      run(game, 0.5);
      game.setPlunger(false);
      game.ball.x = 180;
      game.ball.y = HEIGHT + 40;
      run(game, 0.05);
    }
    expect(game.phase).toBe('over');
    run(game, 1);
    expect(game.phase).toBe('over');
    game.setLeft(true);
    expect(game.phase).toBe('ready');
    expect(game.ballsLeft).toBe(3);
    expect(game.score).toBe(0);
  });

  it('a bumper scores 100 points', () => {
    const game = new Pinball();
    game.phase = 'playing';
    game.ball = { x: game.bumpers[0].x + 30, y: game.bumpers[0].y, vx: -200, vy: 0 };
    run(game, 0.05);
    expect(game.score).toBeGreaterThanOrEqual(100);
    expect(game.bumpers[0].glow).toBeGreaterThan(0);
  });

  it('the flippers rest low, swing up when pressed and return', () => {
    const game = new Pinball();
    const rest = game.flippers[0].angle;
    game.setLeft(true);
    run(game, 0.1);
    expect(game.flippers[0].angle).toBeLessThan(0);
    game.setLeft(false);
    run(game, 0.2);
    expect(game.flippers[0].angle).toBeCloseTo(rest, 5);
  });

  it('a flipper hits a ball that rolls onto it and sends it up', () => {
    const game = new Pinball();
    game.phase = 'playing';
    game.ball = { x: 140, y: 615, vx: 0, vy: 0 }; // on the left flipper, which is pressed
    game.setLeft(true);
    run(game, 0.12);
    expect(game.ball.y).toBeLessThan(590);
  });

  it('the ball stays on or near the table through a long game with button mashing', () => {
    const game = new Pinball();
    let seed = 7;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 60 * 120; i++) {
      if (i % 40 === 0) { game.setLeft(random() < 0.5); game.setRight(random() < 0.5); }
      if (i % 90 === 0) game.setPlunger(true);
      if (i % 90 === 45) game.setPlunger(false);
      game.step(1 / 60);
      const { x, y } = game.ball;
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      if (game.phase === 'playing') {
        expect(x).toBeGreaterThan(-70);
        expect(x).toBeLessThan(WIDTH + 70);
        expect(y).toBeGreaterThan(-70);
        expect(y).toBeLessThan(HEIGHT + 100);
      }
      if (game.phase === 'over') game.restart();
    }
  });
});
