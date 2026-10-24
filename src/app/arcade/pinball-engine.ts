// A small pinball game: physics, rules and drawing, with no Angular in it.
//
// The table is 400 x 700. The ball is shot up the lane on the right, comes round the top curve into the
// playfield, bounces off three bumpers and is kept in play with two flippers. Three balls per game.

export interface Vec {
  x: number;
  y: number;
}

export interface Segment {
  a: Vec;
  b: Vec;
  /** How much of the speed the ball keeps when it hits (0 to 1). */
  bounce: number;
}

export interface Ball extends Vec {
  vx: number;
  vy: number;
}

export const WIDTH = 400;
export const HEIGHT = 700;
export const BALL_RADIUS = 9;

const GRAVITY = 1100;
const MAX_SPEED = 1500;
const STEP = 1 / 240;
const FLIPPER_RADIUS = 7;
const FLIPPER_LENGTH = 66;
const FLIPPER_SPEED = 20; // radians per second
const REST_ANGLE = (28 * Math.PI) / 180;
const UP_ANGLE = -(32 * Math.PI) / 180;
const LANE_X = 362;
const LANE_BALL_Y = 640;
const BALLS_PER_GAME = 3;

export function closestPointOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSquared));
  return { x: a.x + abx * t, y: a.y + aby * t };
}

/**
 * Pushes the ball out of a thick line and bounces it. `surface` is the speed of the line itself at the
 * point of contact (a moving flipper). Returns true if the ball touched it.
 */
export function collideWithSegment(ball: Ball, a: Vec, b: Vec, thickness: number, bounce: number, surface: Vec = { x: 0, y: 0 }): boolean {
  const closest = closestPointOnSegment(ball, a, b);
  let dx = ball.x - closest.x;
  let dy = ball.y - closest.y;
  let distance = Math.hypot(dx, dy);
  const reach = BALL_RADIUS + thickness;
  if (distance >= reach) return false;

  if (distance < 1e-6) {
    // exactly on the line: push along its normal
    dx = -(b.y - a.y);
    dy = b.x - a.x;
    distance = Math.hypot(dx, dy) || 1;
  }
  const nx = dx / distance;
  const ny = dy / distance;

  ball.x = closest.x + nx * reach;
  ball.y = closest.y + ny * reach;

  // speed of the ball as seen from the line
  const rvx = ball.vx - surface.x;
  const rvy = ball.vy - surface.y;
  const along = rvx * nx + rvy * ny;
  if (along < 0) {
    ball.vx -= (1 + bounce) * along * nx;
    ball.vy -= (1 + bounce) * along * ny;
  }
  return true;
}

export function collideWithCircle(ball: Ball, center: Vec, radius: number, bounce: number, kick = 0): boolean {
  const dx = ball.x - center.x;
  const dy = ball.y - center.y;
  const distance = Math.hypot(dx, dy);
  const reach = BALL_RADIUS + radius;
  if (distance >= reach || distance === 0) return false;

  const nx = dx / distance;
  const ny = dy / distance;
  ball.x = center.x + nx * reach;
  ball.y = center.y + ny * reach;

  const along = ball.vx * nx + ball.vy * ny;
  if (along < 0) {
    ball.vx -= (1 + bounce) * along * nx;
    ball.vy -= (1 + bounce) * along * ny;
  }
  ball.vx += nx * kick;
  ball.vy += ny * kick;
  return true;
}

export interface Bumper extends Vec {
  radius: number;
  /** Counts down after a hit; used for the flash. */
  glow: number;
}

export interface Flipper {
  pivot: Vec;
  /** +1 for the left flipper (points right), -1 for the right one (points left). */
  side: 1 | -1;
  angle: number;
  /** The speed it is turning at, used to hit the ball. */
  turning: number;
  pressed: boolean;
}

export type Phase = 'ready' | 'playing' | 'over';

function buildWalls(): Segment[] {
  const walls: Segment[] = [];
  const add = (ax: number, ay: number, bx: number, by: number, bounce = 0.5) => walls.push({ a: { x: ax, y: ay }, b: { x: bx, y: by }, bounce });

  // the curve over the top, from the left wall to the right wall
  const cx = 200;
  const cy = 190;
  const radius = 180;
  const points: Vec[] = [];
  for (let i = 0; i <= 24; i++) {
    const angle = Math.PI + (Math.PI * i) / 24;
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  for (let i = 0; i < points.length - 1; i++) add(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);

  add(20, cy, 20, 520); // left wall
  add(380, cy, 380, 690); // right wall, all the way down the lane
  add(340, 330, 340, 690); // the wall between the playfield and the lane (open above y = 330)
  add(LANE_X - 22, 666, LANE_X + 18, 666, 0.1); // floor of the lane
  add(20, 520, 105, 600, 0.45); // slope to the left flipper
  add(340, 520, 255, 600, 0.45); // slope to the right flipper
  return walls;
}

export class Pinball {
  readonly walls = buildWalls();
  readonly bumpers: Bumper[] = [
    { x: 135, y: 290, radius: 26, glow: 0 },
    { x: 245, y: 290, radius: 26, glow: 0 },
    { x: 190, y: 210, radius: 26, glow: 0 },
  ];
  readonly flippers: Flipper[] = [
    { pivot: { x: 105, y: 600 }, side: 1, angle: REST_ANGLE, turning: 0, pressed: false },
    { pivot: { x: 255, y: 600 }, side: -1, angle: REST_ANGLE, turning: 0, pressed: false },
  ];

  score = 0;
  ballsLeft = BALLS_PER_GAME;
  phase: Phase = 'ready';
  ball: Ball = { x: LANE_X, y: LANE_BALL_Y, vx: 0, vy: 0 };
  /** 0 to 1: how far the plunger is pulled back. */
  charge = 0;

  private plungerHeld = false;
  private leftover = 0;

  // ---------------------------------------------------------------- input

  setLeft(on: boolean): void {
    this.flippers[0].pressed = on;
    this.restartIfOver(on);
  }

  setRight(on: boolean): void {
    this.flippers[1].pressed = on;
    this.restartIfOver(on);
  }

  /** Hold to pull the plunger back, let go to shoot. */
  setPlunger(on: boolean): void {
    if (this.phase === 'over') {
      this.restartIfOver(on);
      return;
    }
    if (this.plungerHeld && !on && this.phase === 'ready') {
      this.ball.vy = -(650 + 950 * this.charge);
      this.ball.vx = 0;
      this.phase = 'playing';
    }
    this.plungerHeld = on;
    if (!on) this.charge = 0;
  }

  private restartIfOver(pressed: boolean): void {
    if (pressed && this.phase === 'over') this.restart();
  }

  restart(): void {
    this.score = 0;
    this.ballsLeft = BALLS_PER_GAME;
    this.putBallInLane();
  }

  private putBallInLane(): void {
    this.ball = { x: LANE_X, y: LANE_BALL_Y, vx: 0, vy: 0 };
    this.phase = 'ready';
    this.charge = 0;
  }

  // ---------------------------------------------------------------- physics

  /** Moves the game forward by `seconds` (any size; it is cut into small steps). */
  step(seconds: number): void {
    this.leftover += Math.min(seconds, 0.1);
    while (this.leftover >= STEP) {
      this.leftover -= STEP;
      this.tick(STEP);
    }
  }

  private tick(dt: number): void {
    this.moveFlippers(dt);

    for (const bumper of this.bumpers) bumper.glow = Math.max(0, bumper.glow - dt);
    if (this.plungerHeld && this.phase === 'ready') this.charge = Math.min(1, this.charge + dt);

    const ball = this.ball;
    if (this.phase === 'over') return;

    ball.vy += GRAVITY * dt;
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > MAX_SPEED) {
      ball.vx = (ball.vx / speed) * MAX_SPEED;
      ball.vy = (ball.vy / speed) * MAX_SPEED;
    }
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    for (const wall of this.walls) collideWithSegment(ball, wall.a, wall.b, 0, wall.bounce);

    for (const bumper of this.bumpers) {
      if (collideWithCircle(ball, bumper, bumper.radius, 0.9, 260)) {
        bumper.glow = 0.25;
        this.score += 100;
      }
    }

    for (const flipper of this.flippers) {
      // the flipper points along d = (side cos a, sin a); a point s along it moves at s * turning * (-side sin a, cos a)
      const along = (ball.x - flipper.pivot.x) * flipper.side * Math.cos(flipper.angle) + (ball.y - flipper.pivot.y) * Math.sin(flipper.angle);
      const speed = flipper.turning * Math.max(0, Math.min(FLIPPER_LENGTH, along));
      const surface: Vec = { x: -flipper.side * Math.sin(flipper.angle) * speed, y: Math.cos(flipper.angle) * speed };
      collideWithSegment(ball, flipper.pivot, this.tipOf(flipper), FLIPPER_RADIUS, 0.3, surface);
    }

    // in the lane, waiting for the plunger: rest on it
    if (this.phase === 'ready') {
      if (ball.y > LANE_BALL_Y) {
        ball.y = LANE_BALL_Y;
        ball.vy = 0;
      }
    } else if (ball.x > 342 && ball.y >= LANE_BALL_Y) {
      // a weak shot that fell back down the lane: back on the plunger for another try (no ball is lost)
      this.putBallInLane();
    }

    // the ball left through the bottom
    if (ball.y > HEIGHT + 30) {
      this.ballsLeft -= 1;
      if (this.ballsLeft <= 0) {
        this.phase = 'over';
        this.ball = { x: -100, y: -100, vx: 0, vy: 0 };
      } else {
        this.putBallInLane();
      }
    }

    // a ball that somehow ends up outside the table is put back rather than lost for good
    if (!Number.isFinite(ball.x + ball.y) || ball.x < -60 || ball.x > WIDTH + 60 || ball.y < -60) {
      if (this.phase === 'playing') this.putBallInLane();
    }
  }

  private tipOf(flipper: Flipper): Vec {
    return {
      x: flipper.pivot.x + flipper.side * FLIPPER_LENGTH * Math.cos(flipper.angle),
      y: flipper.pivot.y + FLIPPER_LENGTH * Math.sin(flipper.angle),
    };
  }

  private moveFlippers(dt: number): void {
    for (const flipper of this.flippers) {
      const target = flipper.pressed ? UP_ANGLE : REST_ANGLE;
      const before = flipper.angle;
      const stepSize = FLIPPER_SPEED * dt;
      if (Math.abs(target - flipper.angle) <= stepSize) flipper.angle = target;
      else flipper.angle += Math.sign(target - flipper.angle) * stepSize;
      flipper.turning = (flipper.angle - before) / dt;
    }
  }

  // ---------------------------------------------------------------- drawing

  draw(ctx: CanvasRenderingContext2D): void {
    const background = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    background.addColorStop(0, '#0b1026');
    background.addColorStop(1, '#1b1140');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // walls
    ctx.lineCap = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#38bdf8';
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 8;
    for (const wall of this.walls) {
      ctx.beginPath();
      ctx.moveTo(wall.a.x, wall.a.y);
      ctx.lineTo(wall.b.x, wall.b.y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // bumpers
    for (const bumper of this.bumpers) {
      const lit = bumper.glow > 0;
      ctx.beginPath();
      ctx.arc(bumper.x, bumper.y, bumper.radius, 0, Math.PI * 2);
      ctx.fillStyle = lit ? '#fde047' : '#db2777';
      ctx.shadowColor = lit ? '#fde047' : '#db2777';
      ctx.shadowBlur = lit ? 22 : 10;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(bumper.x, bumper.y, bumper.radius - 8, 0, Math.PI * 2);
      ctx.fillStyle = lit ? '#fff7ae' : '#fbcfe8';
      ctx.fill();
    }

    // flippers
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = FLIPPER_RADIUS * 2;
    for (const flipper of this.flippers) {
      const tip = this.tipOf(flipper);
      ctx.beginPath();
      ctx.moveTo(flipper.pivot.x, flipper.pivot.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
    }

    // the plunger
    const pull = this.charge * 24;
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(LANE_X - 12, LANE_BALL_Y + BALL_RADIUS + pull, 24, 10);
    ctx.fillRect(LANE_X - 3, LANE_BALL_Y + BALL_RADIUS + pull + 10, 6, 30);

    // the ball
    if (this.phase !== 'over') {
      const shine = ctx.createRadialGradient(this.ball.x - 3, this.ball.y - 3, 1, this.ball.x, this.ball.y, BALL_RADIUS);
      shine.addColorStop(0, '#ffffff');
      shine.addColorStop(1, '#94a3b8');
      ctx.beginPath();
      ctx.arc(this.ball.x, this.ball.y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = shine;
      ctx.fill();
    }

    // scores and messages
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(String(this.score).padStart(6, '0'), 30, 40);
    ctx.textAlign = 'right';
    ctx.fillText('● '.repeat(Math.max(0, this.ballsLeft)).trim(), WIDTH - 24, 40);

    ctx.textAlign = 'center';
    if (this.phase === 'ready') {
      ctx.font = '16px sans-serif';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText('Hold LAUNCH, release to shoot', 190, 440);
    } else if (this.phase === 'over') {
      ctx.font = 'bold 34px sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('GAME OVER', 200, 330);
      ctx.font = '18px sans-serif';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText('Score ' + this.score, 200, 366);
      ctx.fillText('Press any button to play again', 200, 404);
    }
  }
}
