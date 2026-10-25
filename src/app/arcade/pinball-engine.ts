// A small pinball game: physics, rules and drawing, with no Angular in it.
//
// The table is 400 x 700. The ball is shot up the lane on the right, comes round the top curve into the
// playfield, bounces off the theme's bumpers and is kept in play with two flippers. Three balls per game, with
// a combo multiplier, a row of targets, a meter that grows, a ball save and an extra ball every 10,000 points.

import { THEMES, Theme } from './themes';

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

export interface Target extends Vec {
  radius: number;
  lit: boolean;
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

/** Things that happen in the game, so that the page can add sound. */
export type GameEvent = 'flip' | 'launch' | 'bumper' | 'target' | 'clear' | 'level' | 'extra' | 'save' | 'drain' | 'best' | 'over';

interface Message {
  text: string;
  life: number;
  big: boolean;
}

interface Popup extends Vec {
  text: string;
  life: number;
}

interface Particle extends Vec {
  vx: number;
  vy: number;
  life: number;
  icon: string;
}

/** Hits within this many seconds of each other build the multiplier. */
export const COMBO_WINDOW = 3;
/** Every so many hits on the bumpers the theme's meter goes up one stage. */
export const HITS_PER_LEVEL = 8;
/** A free extra ball every so many points. */
export const EXTRA_BALL_EVERY = 10000;
export const MAX_BALLS = 5;
/** After a launch a ball that drains is given back for this long. */
export const BALL_SAVE_SECONDS = 7;
export const MAX_MULTIPLIER = 5;

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

const TARGET_XS = [120, 160, 200, 240];
const TARGET_Y = 140;

export class Pinball {
  readonly walls = buildWalls();
  readonly bumpers: Bumper[];
  readonly targets: Target[] = TARGET_XS.map(x => ({ x, y: TARGET_Y, radius: 10, lit: false, glow: 0 }));
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

  /** Hits in a row, each less than COMBO_WINDOW seconds after the one before. */
  combo = 0;
  comboTimer = 0;
  /** The stage of the theme's meter (0 at the start of a game). */
  level = 0;
  levelHits = 0;
  /** Seconds left in which a ball that drains is given back. */
  ballSaveLeft = 0;
  /** Times all four targets were lit in this game. */
  clears = 0;
  nextExtra = EXTRA_BALL_EVERY;
  /** The best score saved so far (set by the page), and whether this game has beaten it. */
  best = 0;
  newBest = false;
  /** Called when something happens that deserves a sound. */
  onEvent: ((event: GameEvent) => void) | null = null;

  private messages: Message[] = [];
  private popups: Popup[] = [];
  private particles: Particle[] = [];
  private plungerHeld = false;
  private leftover = 0;
  private clock = 0;

  constructor(readonly theme: Theme = THEMES[0]) {
    this.bumpers = theme.bumpers.map(spot => ({ ...spot, glow: 0 }));
  }

  /** What each point scored is multiplied by now. */
  get multiplier(): number {
    return Math.min(MAX_MULTIPLIER, 1 + Math.floor(this.combo / 5));
  }

  /** What one hit on a bumper is worth before the multiplier. */
  get bumperValue(): number {
    return 100 + 25 * Math.min(this.level, 12);
  }

  // ---------------------------------------------------------------- input

  setLeft(on: boolean): void {
    if (on && !this.flippers[0].pressed) this.emit('flip');
    this.flippers[0].pressed = on;
    this.restartIfOver(on);
  }

  setRight(on: boolean): void {
    if (on && !this.flippers[1].pressed) this.emit('flip');
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
      this.ballSaveLeft = BALL_SAVE_SECONDS;
      this.emit('launch');
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
    this.combo = 0;
    this.comboTimer = 0;
    this.level = 0;
    this.levelHits = 0;
    this.clears = 0;
    this.nextExtra = EXTRA_BALL_EVERY;
    this.newBest = false;
    this.ballSaveLeft = 0;
    this.messages = [];
    this.popups = [];
    this.particles = [];
    for (const target of this.targets) target.lit = false;
    this.putBallInLane();
  }

  private putBallInLane(): void {
    this.ball = { x: LANE_X, y: LANE_BALL_Y, vx: 0, vy: 0 };
    this.phase = 'ready';
    this.charge = 0;
  }

  private emit(event: GameEvent): void {
    this.onEvent?.(event);
  }

  // ---------------------------------------------------------------- scoring

  /** Adds `base` points times the multiplier, shows them where they were earned, and checks the rewards. */
  private award(base: number, at: Vec): void {
    const points = base * this.multiplier;
    this.score += points;
    this.popups.push({ x: at.x, y: at.y - 14, text: '+' + points, life: 0.9 });

    if (!this.newBest && this.best > 0 && this.score > this.best) {
      this.newBest = true;
      this.say('NEW HIGH SCORE!', true);
      this.emit('best');
    }
    if (this.score >= this.nextExtra) {
      this.nextExtra += EXTRA_BALL_EVERY;
      if (this.ballsLeft < MAX_BALLS) this.ballsLeft += 1;
      this.say('EXTRA BALL!', true);
      this.emit('extra');
    }
  }

  private say(text: string, big = false): void {
    this.messages = [{ text, life: big ? 2 : 1.4, big }, ...this.messages].slice(0, 2);
  }

  private hit(): void {
    this.combo += 1;
    this.comboTimer = COMBO_WINDOW;
  }

  private burst(at: Vec, count: number): void {
    const icons = this.theme.particles;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + this.clock;
      const speed = 60 + ((i * 37) % 70);
      this.particles.push({ x: at.x, y: at.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 40, life: 0.7, icon: icons[i % icons.length] });
    }
    if (this.particles.length > 60) this.particles.splice(0, this.particles.length - 60);
  }

  private hitBumper(bumper: Bumper): void {
    bumper.glow = 0.25;
    this.hit();
    this.award(this.bumperValue, bumper);
    this.burst(bumper, 4);
    this.emit('bumper');

    this.levelHits += 1;
    if (this.levelHits >= HITS_PER_LEVEL) {
      this.levelHits = 0;
      this.level += 1;
      this.award(500 * this.level, { x: 200, y: 100 });
      this.say(this.theme.meter.levelUp, true);
      this.emit('level');
    }
  }

  private hitTarget(target: Target): void {
    target.glow = 0.25;
    if (target.lit) return;
    target.lit = true;
    this.hit();
    this.award(300, target);
    this.emit('target');

    if (this.targets.every(t => t.lit)) {
      this.clears += 1;
      for (const t of this.targets) t.lit = false;
      this.award(2500, { x: 200, y: 170 });
      this.ballSaveLeft += 5;
      this.say(this.theme.clear, true);
      this.burst({ x: 200, y: TARGET_Y }, 10);
      this.emit('clear');
    }
  }

  // ---------------------------------------------------------------- physics

  /** Moves the game forward by `seconds` (any size; it is cut into small steps). */
  step(seconds: number): void {
    const frame = Math.min(seconds, 0.1);
    this.leftover += frame;
    while (this.leftover >= STEP) {
      this.leftover -= STEP;
      this.tick(STEP);
    }
    this.fade(frame);
  }

  /** Things that are only for the eyes: messages, score pop-ups, particles. */
  private fade(seconds: number): void {
    this.clock += seconds;
    for (const message of this.messages) message.life -= seconds;
    this.messages = this.messages.filter(m => m.life > 0);
    for (const popup of this.popups) {
      popup.life -= seconds;
      popup.y -= 30 * seconds;
    }
    this.popups = this.popups.filter(p => p.life > 0);
    for (const particle of this.particles) {
      particle.life -= seconds;
      particle.vy += 300 * seconds;
      particle.x += particle.vx * seconds;
      particle.y += particle.vy * seconds;
    }
    this.particles = this.particles.filter(p => p.life > 0);
  }

  private tick(dt: number): void {
    this.moveFlippers(dt);

    for (const bumper of this.bumpers) bumper.glow = Math.max(0, bumper.glow - dt);
    for (const target of this.targets) target.glow = Math.max(0, target.glow - dt);
    if (this.plungerHeld && this.phase === 'ready') this.charge = Math.min(1, this.charge + dt);

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    if (this.phase === 'playing') this.ballSaveLeft = Math.max(0, this.ballSaveLeft - dt);

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
      if (collideWithCircle(ball, bumper, bumper.radius, 0.9, 260)) this.hitBumper(bumper);
    }

    for (const target of this.targets) {
      if (collideWithCircle(ball, target, target.radius, 0.6, 40)) this.hitTarget(target);
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
    if (ball.y > HEIGHT + 30) this.drain();

    // a ball that somehow ends up outside the table is put back rather than lost for good
    if (!Number.isFinite(ball.x + ball.y) || ball.x < -60 || ball.x > WIDTH + 60 || ball.y < -60) {
      if (this.phase === 'playing') this.putBallInLane();
    }
  }

  private drain(): void {
    this.combo = 0;
    this.comboTimer = 0;

    if (this.ballSaveLeft > 0) {
      // shortly after a launch the ball is given back without costing one
      this.ballSaveLeft = 0;
      this.putBallInLane();
      this.say('BALL SAVED!', true);
      this.emit('save');
      return;
    }

    this.ballsLeft -= 1;
    this.emit('drain');
    if (this.ballsLeft <= 0) {
      this.phase = 'over';
      this.ball = { x: -100, y: -100, vx: 0, vy: 0 };
      this.emit('over');
    } else {
      this.putBallInLane();
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

  /** The table's background and walls never change, so they are drawn once and copied (the glow is slow to draw on a phone). */
  private backdrop: HTMLCanvasElement | null = null;

  private drawBackdrop(ctx: CanvasRenderingContext2D): void {
    const theme = this.theme;
    const background = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    background.addColorStop(0, theme.sky[0]);
    background.addColorStop(1, theme.sky[1]);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.lineCap = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = theme.wall;
    ctx.shadowColor = theme.wall;
    ctx.shadowBlur = 8;
    for (const wall of this.walls) {
      ctx.beginPath();
      ctx.moveTo(wall.a.x, wall.a.y);
      ctx.lineTo(wall.b.x, wall.b.y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  /** `scale` is how many pixels the canvas has for each unit of the table. */
  draw(ctx: CanvasRenderingContext2D, scale = 2): void {
    const theme = this.theme;
    const emojiFont = (size: number) => `${size}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;

    if (!this.backdrop && typeof document !== 'undefined') {
      const layer = document.createElement('canvas');
      layer.width = WIDTH * scale;
      layer.height = HEIGHT * scale;
      const layerContext = layer.getContext('2d');
      if (layerContext) {
        layerContext.scale(scale, scale);
        this.drawBackdrop(layerContext);
        this.backdrop = layer;
      }
    }
    if (this.backdrop) ctx.drawImage(this.backdrop, 0, 0, WIDTH, HEIGHT);
    else this.drawBackdrop(ctx);

    // faint pictures on the table, drifting a little
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.13;
    ctx.font = emojiFont(34);
    theme.scatter.forEach((icon, i) => {
      const x = 70 + ((i * 97) % 240);
      const y = 120 + ((i * 131) % 380);
      ctx.fillText(icon, x + Math.sin(this.clock * 0.6 + i) * 6, y + Math.cos(this.clock * 0.5 + i * 2) * 6);
    });
    ctx.globalAlpha = 1;

    // targets
    for (const target of this.targets) {
      ctx.beginPath();
      ctx.arc(target.x, target.y, target.radius, 0, Math.PI * 2);
      ctx.fillStyle = target.lit ? theme.accent : 'rgba(255,255,255,0.12)';
      ctx.shadowColor = theme.accent;
      ctx.shadowBlur = target.lit || target.glow > 0 ? 16 : 0;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = theme.accent;
      ctx.stroke();
    }

    // bumpers
    this.bumpers.forEach((bumper, i) => {
      const lit = bumper.glow > 0;
      const swell = lit ? 1 + bumper.glow * 0.5 : 1;
      ctx.beginPath();
      ctx.arc(bumper.x, bumper.y, bumper.radius * swell, 0, Math.PI * 2);
      ctx.fillStyle = lit ? theme.bumperLit : theme.bumper;
      ctx.shadowColor = lit ? theme.bumperLit : theme.bumper;
      ctx.shadowBlur = lit ? 22 : 0;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(bumper.x, bumper.y, bumper.radius - 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fill();
      ctx.font = emojiFont(Math.round(bumper.radius * 1.15 * swell));
      ctx.fillStyle = '#ffffff';
      ctx.fillText(theme.bumperIcons[i % theme.bumperIcons.length], bumper.x, bumper.y + 2);
    });

    // flippers
    ctx.strokeStyle = theme.flipper;
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

    // particles
    ctx.font = emojiFont(14);
    for (const particle of this.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, particle.life / 0.4));
      ctx.fillText(particle.icon, particle.x, particle.y);
    }
    ctx.globalAlpha = 1;

    // the ball, with a glow while it is saved
    if (this.phase !== 'over') {
      const saved = this.phase === 'playing' && this.ballSaveLeft > 0;
      const shine = ctx.createRadialGradient(this.ball.x - 3, this.ball.y - 3, 1, this.ball.x, this.ball.y, BALL_RADIUS);
      shine.addColorStop(0, theme.ball[0]);
      shine.addColorStop(1, theme.ball[1]);
      ctx.beginPath();
      ctx.arc(this.ball.x, this.ball.y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = shine;
      ctx.shadowColor = theme.accent;
      ctx.shadowBlur = saved ? 14 + 6 * Math.sin(this.clock * 12) : 0;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // score pop-ups
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = theme.accent;
    for (const popup of this.popups) {
      ctx.globalAlpha = Math.max(0, Math.min(1, popup.life / 0.4));
      ctx.fillText(popup.text, popup.x, popup.y);
    }
    ctx.globalAlpha = 1;

    this.drawStatus(ctx, emojiFont);
  }

  private drawStatus(ctx: CanvasRenderingContext2D, emojiFont: (size: number) => string): void {
    const theme = this.theme;

    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(String(this.score).padStart(6, '0'), 30, 40);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = this.newBest ? theme.accent : '#94a3b8';
    ctx.fillText(this.newBest ? 'NEW BEST!' : 'BEST ' + Math.max(this.best, 0), 30, 56);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('● '.repeat(Math.max(0, this.ballsLeft)).trim(), WIDTH - 24, 40);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('EXTRA BALL AT ' + this.nextExtra, WIDTH - 24, 56);

    // the multiplier and how long it lasts
    if (this.multiplier > 1 || this.combo > 1) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillStyle = theme.accent;
      ctx.fillText('x' + this.multiplier, 200, 84);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(170, 92, 60, 4);
      ctx.fillStyle = theme.accent;
      ctx.fillRect(170, 92, 60 * Math.max(0, Math.min(1, this.comboTimer / COMBO_WINDOW)), 4);
    }

    // the theme's meter: a picture for the stage, its name and the hits to the next stage
    const stages = theme.meter.stages;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = emojiFont(18);
    ctx.fillText(stages[this.level % stages.length], 30, 80);
    ctx.textBaseline = 'alphabetic';
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(theme.meter.name + ' ' + this.level, 54, 79);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(30, 88, 70, 4);
    ctx.fillStyle = theme.accent;
    ctx.fillRect(30, 88, 70 * (this.levelHits / HITS_PER_LEVEL), 4);

    if (this.ballSaveLeft > 0 && this.phase === 'playing') {
      ctx.textAlign = 'right';
      ctx.font = '12px sans-serif';
      ctx.fillStyle = theme.accent;
      ctx.fillText('BALL SAVE ' + this.ballSaveLeft.toFixed(0) + 's', WIDTH - 24, 76);
    }

    // messages
    ctx.textAlign = 'center';
    this.messages.forEach((message, i) => {
      ctx.globalAlpha = Math.max(0, Math.min(1, message.life / 0.5));
      ctx.font = message.big ? 'bold 28px sans-serif' : 'bold 18px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = theme.accent;
      ctx.shadowBlur = 12;
      ctx.fillText(message.text, 200, 440 + i * 34);
      ctx.shadowBlur = 0;
    });
    ctx.globalAlpha = 1;

    if (this.phase === 'ready') {
      ctx.font = '16px sans-serif';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText('Hold LAUNCH, release to shoot', 190, 500);
    } else if (this.phase === 'over') {
      ctx.fillStyle = 'rgba(2,6,23,0.7)';
      ctx.fillRect(40, 250, 320, 200);
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 34px sans-serif';
      ctx.fillText('GAME OVER', 200, 300);
      ctx.font = '20px sans-serif';
      ctx.fillStyle = this.newBest ? theme.accent : '#cbd5e1';
      ctx.fillText(this.newBest ? 'NEW HIGH SCORE ' + this.score : 'Score ' + this.score, 200, 338);
      ctx.font = '15px sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('Best ' + Math.max(this.best, this.score) + '   ·   ' + this.clears + ' target sweeps   ·   ' + this.theme.meter.name.toLowerCase() + ' ' + this.level, 200, 366);
      ctx.font = '18px sans-serif';
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText('Press any button to play again', 200, 414);
    }
  }
}
