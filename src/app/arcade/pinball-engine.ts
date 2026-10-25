// A small pinball game: physics, rules and drawing, with no Angular in it.
//
// The table is 400 x 700. The ball is shot up the lane on the right, comes round the top curve into the
// playfield, bounces off the theme's bumpers and is kept in play with two flippers. Three balls per game, with
// a combo multiplier, lanes that raise it, a row of targets that start a multiball, mystery saucers, missions, a
// meter that grows, a ball save, nudges and an extra ball every 10,000 points.

import { BallStyle, soClose, starsFor } from './progression';
import { MissionDef, MissionKind, THEMES, Theme } from './themes';

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
  /** True while a saucer holds it. */
  held?: boolean;
}

export const WIDTH = 400;
/** How much longer the table is than the first one (700): the flippers, the lane and the bottom walls sit this much lower. */
export const EXTRA_LENGTH = 80;
export const HEIGHT = 700 + EXTRA_LENGTH;
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
const LANE_BALL_Y = 640 + EXTRA_LENGTH;
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

/** A hole that catches the ball for a moment and gives a mystery reward. */
export interface Saucer extends Vec {
  radius: number;
  /** The ball it holds, and how long it will hold it. */
  held: Ball | null;
  timer: number;
  /** After letting a ball go it ignores balls for a moment. */
  cooldown: number;
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
export type GameEvent =
  | 'flip' | 'launch' | 'bumper' | 'target' | 'clear' | 'level' | 'extra' | 'save' | 'drain' | 'best' | 'over'
  | 'lane' | 'saucer' | 'multiball' | 'mission' | 'nudge';

/** What a mystery saucer can give. */
export type Mystery = 'double' | 'save' | 'extra' | 'multiball';
export const MYSTERIES: Mystery[] = ['double', 'save', 'extra', 'multiball'];

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
/** The most the combo and the lanes together can multiply a score by. */
export const MAX_MULTIPLIER = 8;
/** The lanes at the top give up to this level. */
export const MAX_LANE_LEVEL = 5;
export const NUDGES_PER_BALL = 4;
/** The most balls on the table at once. */
export const MAX_ON_TABLE = 4;
export const DOUBLE_SECONDS = 15;
export const SAUCER_HOLD_SECONDS = 0.9;

export const LANE_XS = [130, 170, 210, 250];
export const LANE_Y = 100;
const SAUCER_SPOTS: Vec[] = [{ x: 44, y: 405 }, { x: 316, y: 405 }];

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

  const down = EXTRA_LENGTH;
  add(20, cy, 20, 520 + down); // left wall
  add(380, cy, 380, 690 + down); // right wall, all the way down the lane
  add(340, 330, 340, 690 + down); // the wall between the playfield and the lane (open above y = 330)
  add(LANE_X - 22, 666 + down, LANE_X + 18, 666 + down, 0.1); // floor of the lane
  add(20, 520 + down, 105, 600 + down, 0.45); // slope to the left flipper
  add(340, 520 + down, 255, 600 + down, 0.45); // slope to the right flipper
  return walls;
}

const TARGET_XS = [120, 160, 200, 240];
const TARGET_Y = 140;

export class Pinball {
  readonly walls = buildWalls();
  readonly bumpers: Bumper[];
  readonly targets: Target[] = TARGET_XS.map(x => ({ x, y: TARGET_Y, radius: 10, lit: false, glow: 0 }));
  readonly saucers: Saucer[] = SAUCER_SPOTS.map(spot => ({ ...spot, radius: 15, held: null, timer: 0, cooldown: 0, glow: 0 }));
  /** The four lanes at the top: lit when the ball ran through them. */
  readonly lanes: boolean[] = LANE_XS.map(() => false);
  readonly flippers: Flipper[] = [
    { pivot: { x: 105, y: 600 + EXTRA_LENGTH }, side: 1, angle: REST_ANGLE, turning: 0, pressed: false },
    { pivot: { x: 255, y: 600 + EXTRA_LENGTH }, side: -1, angle: REST_ANGLE, turning: 0, pressed: false },
  ];

  score = 0;
  ballsLeft = BALLS_PER_GAME;
  phase: Phase = 'ready';
  /** The balls on the table. The first is the one that waits on the plunger; the others come from a multiball. */
  balls: Ball[] = [{ x: LANE_X, y: LANE_BALL_Y, vx: 0, vy: 0 }];
  /** 0 to 1: how far the plunger is pulled back. */
  charge = 0;

  /** Hits in a row, each less than COMBO_WINDOW seconds after the one before. */
  combo = 0;
  comboTimer = 0;
  /** The level of the lanes at the top (1 to MAX_LANE_LEVEL); it goes back to 1 when a ball is lost. */
  laneLevel = 1;
  /** The stage of the theme's meter (0 at the start of a game). */
  level = 0;
  levelHits = 0;
  /** Seconds left in which a ball that drains is given back. */
  ballSaveLeft = 0;
  /** Seconds left of double score (from a mystery saucer). */
  doubleLeft = 0;
  nudgesLeft = NUDGES_PER_BALL;
  paused = false;

  /** Times all four targets were lit in this game. */
  clears = 0;
  multiballs = 0;
  saucerVisits = 0;
  laneCompletions = 0;
  maxCombo = 0;
  missionIndex = 0;
  missionProgress = 0;
  missionsDone = 0;

  nextExtra = EXTRA_BALL_EVERY;
  /** The best score saved so far (set by the page), and whether this game has beaten it. */
  best = 0;
  newBest = false;
  /** The look of the ball (set by the page). */
  ballStyle: BallStyle | null = null;
  /** Called when something happens that deserves a sound. */
  onEvent: ((event: GameEvent) => void) | null = null;
  /** The source of luck, so that tests can decide it. */
  random: () => number = Math.random;
  /** Shown on the game-over screen: the stars, and a line when the player came close to more. */
  stars = 0;
  closeText: string | null = null;
  /** More lines for the game-over screen (experience, level), set by the page. */
  bonusLines: string[] = [];

  private messages: Message[] = [];
  private popups: Popup[] = [];
  private particles: Particle[] = [];
  private plungerHeld = false;
  private leftover = 0;
  private clock = 0;
  private nudgeSide = 1;
  private overAt = 0;

  constructor(readonly theme: Theme = THEMES[0]) {
    this.bumpers = theme.bumpers.map(spot => ({ ...spot, glow: 0 }));
  }

  /** The ball that waits on the plunger (the first of the balls on the table). */
  get ball(): Ball {
    return this.balls[0];
  }

  set ball(ball: Ball) {
    this.balls[0] = ball;
  }

  /** What each point scored is multiplied by now: the combo and the lanes together. */
  get multiplier(): number {
    const comboLevel = 1 + Math.floor(this.combo / 5);
    return Math.min(MAX_MULTIPLIER, comboLevel + this.laneLevel - 1);
  }

  /** What one hit on a bumper is worth before the multiplier. */
  get bumperValue(): number {
    return 100 + 25 * Math.min(this.level, 12);
  }

  /** The mission that is running. */
  get mission(): MissionDef {
    return this.theme.missions[this.missionIndex % this.theme.missions.length];
  }

  /** True while more than one ball is on the table. */
  get multiball(): boolean {
    return this.balls.length > 1;
  }

  // ---------------------------------------------------------------- input

  setLeft(on: boolean): void {
    if (on && !this.flippers[0].pressed) {
      this.emit('flip');
      this.shiftLanes(-1);
    }
    this.flippers[0].pressed = on;
    this.restartIfOver(on);
  }

  setRight(on: boolean): void {
    if (on && !this.flippers[1].pressed) {
      this.emit('flip');
      this.shiftLanes(1);
    }
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

  /**
   * Shakes the table: the balls get a push up and sideways. Four times per ball. `direction` is -1 (left),
   * 1 (right) or 0 (alternate). Returns false when it is not allowed (no nudges left, or no ball in play).
   */
  nudge(direction = 0): boolean {
    if (this.phase !== 'playing' || this.nudgesLeft <= 0 || this.paused) return false;
    const side = direction !== 0 ? Math.sign(direction) : (this.nudgeSide = -this.nudgeSide);
    for (const ball of this.balls) {
      if (ball.held) continue;
      ball.vx += side * 150;
      ball.vy -= 130;
    }
    this.nudgesLeft -= 1;
    this.emit('nudge');
    return true;
  }

  togglePause(): void {
    if (this.phase === 'over') return;
    this.paused = !this.paused;
    if (this.paused) {
      // nothing stays held while the game stands still
      this.flippers[0].pressed = false;
      this.flippers[1].pressed = false;
    }
  }

  /** Moves the lit lanes one place: the flipper buttons shift them, so that the last lane can be reached. */
  private shiftLanes(direction: -1 | 1): void {
    if (this.phase !== 'playing' || !this.lanes.some(Boolean)) return;
    const lit = [...this.lanes];
    const n = lit.length;
    for (let i = 0; i < n; i++) this.lanes[i] = lit[(i - direction + n) % n];
  }

  private restartIfOver(pressed: boolean): void {
    if (pressed) this.retry();
  }

  /** Starts the next game after one that is over. Returns false if the game is not over, or ended less than half a second ago, so that a finger still pressing does not start it by accident. */
  retry(): boolean {
    if (this.phase !== 'over' || this.clock - this.overAt <= 0.5) return false;
    this.restart();
    return true;
  }

  restart(): void {
    this.score = 0;
    this.ballsLeft = BALLS_PER_GAME;
    this.combo = 0;
    this.comboTimer = 0;
    this.laneLevel = 1;
    this.level = 0;
    this.levelHits = 0;
    this.clears = 0;
    this.multiballs = 0;
    this.saucerVisits = 0;
    this.laneCompletions = 0;
    this.maxCombo = 0;
    this.missionIndex = 0;
    this.missionProgress = 0;
    this.missionsDone = 0;
    this.nextExtra = EXTRA_BALL_EVERY;
    this.newBest = false;
    this.ballSaveLeft = 0;
    this.doubleLeft = 0;
    this.stars = 0;
    this.closeText = null;
    this.bonusLines = [];
    this.paused = false;
    this.messages = [];
    this.popups = [];
    this.particles = [];
    for (const target of this.targets) target.lit = false;
    this.lanes.fill(false);
    for (const saucer of this.saucers) Object.assign(saucer, { held: null, timer: 0, cooldown: 0, glow: 0 });
    this.putBallInLane();
  }

  private putBallInLane(): void {
    this.balls = [{ x: LANE_X, y: LANE_BALL_Y, vx: 0, vy: 0 }];
    for (const saucer of this.saucers) saucer.held = null;
    this.phase = 'ready';
    this.charge = 0;
    this.nudgesLeft = NUDGES_PER_BALL;
  }

  private emit(event: GameEvent): void {
    this.onEvent?.(event);
  }

  // ---------------------------------------------------------------- scoring

  /** Adds `base` points times the multiplier (and times two during a double), shows them where they were earned. */
  private award(base: number, at: Vec): void {
    this.addPoints(Math.round(base * this.multiplier * (this.doubleLeft > 0 ? 2 : 1)), at);
  }

  private addPoints(points: number, at: Vec): void {
    this.score += points;
    this.popups.push({ x: at.x, y: at.y - 14, text: '+' + points, life: 0.9 });

    if (!this.newBest && this.best > 0 && this.score > this.best) {
      this.newBest = true;
      this.say('NEW HIGH SCORE!', true);
      this.emit('best');
    }
    if (this.score >= this.nextExtra) {
      this.nextExtra += EXTRA_BALL_EVERY;
      this.giveExtraBall();
    }
  }

  private giveExtraBall(): void {
    if (this.ballsLeft < MAX_BALLS) this.ballsLeft += 1;
    this.say('EXTRA BALL!', true);
    this.emit('extra');
  }

  private say(text: string, big = false): void {
    this.messages = [{ text, life: big ? 2 : 1.4, big }, ...this.messages].slice(0, 2);
  }

  private hit(): void {
    this.combo += 1;
    this.comboTimer = COMBO_WINDOW;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.progress('combo', this.combo);
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

  /** Counts towards the mission that is running (the combo mission takes the best chain, the others add up). */
  private progress(kind: MissionKind, amount = 1): void {
    const mission = this.mission;
    if (mission.kind !== kind || this.phase === 'over') return;
    this.missionProgress = kind === 'combo' ? Math.max(this.missionProgress, amount) : this.missionProgress + amount;
    if (this.missionProgress < mission.goal) return;

    this.missionsDone += 1;
    this.missionIndex = (this.missionIndex + 1) % this.theme.missions.length;
    this.missionProgress = 0;
    this.say('MISSION COMPLETE!', true);
    this.addPoints(mission.reward, { x: 200, y: 330 });
    this.emit('mission');
  }

  private hitBumper(bumper: Bumper): void {
    bumper.glow = 0.25;
    this.hit();
    this.award(this.bumperValue, bumper);
    this.burst(bumper, 4);
    this.emit('bumper');
    this.progress('bumper');

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
      this.say(this.theme.clear, true);
      this.burst({ x: 200, y: TARGET_Y }, 10);
      this.emit('clear');
      this.progress('clear');
      // all four targets also start a multiball
      this.startMultiball(2);
    }
  }

  /** A ball ran through a lane at the top. */
  private lightLane(index: number): void {
    if (this.lanes[index]) return;
    this.lanes[index] = true;
    this.award(50, { x: LANE_XS[index], y: LANE_Y });
    this.emit('lane');

    if (this.lanes.every(Boolean)) {
      this.lanes.fill(false);
      this.laneCompletions += 1;
      this.laneLevel = Math.min(MAX_LANE_LEVEL, this.laneLevel + 1);
      this.award(500, { x: 200, y: LANE_Y + 30 });
      this.say(`MULTIPLIER x${this.multiplier}`, true);
      this.progress('lane');
    }
  }

  /** More balls on the table. Each is given back free when lost; the game goes on until the last one drains. */
  startMultiball(extra = 2): void {
    if (this.phase !== 'playing') return;
    let added = 0;
    for (let i = 0; i < extra && this.balls.length < MAX_ON_TABLE; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      this.balls.push({ x: 200 + side * 25, y: 175, vx: side * (70 + 60 * this.random()), vy: 120 });
      added += 1;
    }
    if (added === 0) return;
    this.multiballs += 1;
    this.ballSaveLeft = Math.max(this.ballSaveLeft, 8);
    this.say('MULTIBALL!', true);
    this.emit('multiball');
  }

  /** What a mystery saucer gives. */
  private giveMystery(saucer: Saucer): void {
    const reward = MYSTERIES[Math.min(MYSTERIES.length - 1, Math.floor(this.random() * MYSTERIES.length))];
    this.addPoints(500, saucer);
    switch (reward) {
      case 'double':
        this.doubleLeft = DOUBLE_SECONDS;
        this.say(`DOUBLE SCORE ${DOUBLE_SECONDS}s!`, true);
        break;
      case 'save':
        this.ballSaveLeft = Math.max(this.ballSaveLeft, 12);
        this.say('BALL SAVER!', true);
        break;
      case 'extra':
        this.giveExtraBall();
        break;
      case 'multiball':
        this.startMultiball(2);
        break;
    }
  }

  // ---------------------------------------------------------------- physics

  /** Moves the game forward by `seconds` (any size; it is cut into small steps). */
  step(seconds: number): void {
    if (this.paused) return;
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
    if (this.phase === 'playing') {
      this.ballSaveLeft = Math.max(0, this.ballSaveLeft - dt);
      this.doubleLeft = Math.max(0, this.doubleLeft - dt);
    }
    this.tickSaucers(dt);

    if (this.phase === 'over') return;
    for (const ball of [...this.balls]) this.moveBall(ball, dt);
  }

  private tickSaucers(dt: number): void {
    for (const saucer of this.saucers) {
      saucer.glow = Math.max(0, saucer.glow - dt);
      saucer.cooldown = Math.max(0, saucer.cooldown - dt);
      const held = saucer.held;
      if (!held) continue;

      saucer.glow = 0.3;
      saucer.timer -= dt;
      if (saucer.timer > 0) continue;

      // let the ball go, towards the middle, and say what the mystery was
      saucer.held = null;
      saucer.cooldown = 1.2;
      held.held = false;
      held.vx = (saucer.x < WIDTH / 2 ? 1 : -1) * 170;
      held.vy = -430;
      this.giveMystery(saucer);
    }
  }

  private moveBall(ball: Ball, dt: number): void {
    if (ball.held) return;
    const primary = ball === this.balls[0];

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

    if (this.phase === 'playing') {
      // the lanes at the top light up when a ball runs through
      LANE_XS.forEach((x, i) => {
        if (!this.lanes[i] && Math.abs(ball.x - x) <= 13 && Math.abs(ball.y - LANE_Y) <= 13) this.lightLane(i);
      });

      // a saucer catches the ball
      for (const saucer of this.saucers) {
        if (saucer.held || saucer.cooldown > 0 || Math.hypot(ball.x - saucer.x, ball.y - saucer.y) > saucer.radius - 4) continue;
        saucer.held = ball;
        saucer.timer = SAUCER_HOLD_SECONDS;
        ball.held = true;
        ball.x = saucer.x;
        ball.y = saucer.y;
        ball.vx = 0;
        ball.vy = 0;
        this.saucerVisits += 1;
        this.burst(saucer, 5);
        this.emit('saucer');
        this.progress('saucer');
        return;
      }
    }

    // in the lane, waiting for the plunger: rest on it
    if (this.phase === 'ready' && primary) {
      if (ball.y > LANE_BALL_Y) {
        ball.y = LANE_BALL_Y;
        ball.vy = 0;
      }
    } else if (ball.x > 342 && ball.y >= LANE_BALL_Y) {
      // a weak shot that fell back down the lane: back on the plunger for another try (no ball is lost)
      if (primary && this.balls.length === 1) this.putBallInLane();
      else this.removeBall(ball);
      return;
    }

    // the ball left through the bottom
    if (ball.y > HEIGHT + 30) {
      this.lose(ball);
      return;
    }

    // a ball that somehow ends up outside the table is put back rather than lost for good
    if (!Number.isFinite(ball.x + ball.y) || ball.x < -60 || ball.x > WIDTH + 60 || ball.y < -60) {
      if (this.phase !== 'playing') return;
      if (this.balls.length === 1) this.putBallInLane();
      else this.removeBall(ball);
    }
  }

  private removeBall(ball: Ball): void {
    this.balls = this.balls.filter(b => b !== ball);
    for (const saucer of this.saucers) if (saucer.held === ball) saucer.held = null;
  }

  /** A ball went out of the bottom. With others still on the table it is simply gone; the last one costs a ball. */
  private lose(ball: Ball): void {
    if (this.balls.length > 1) {
      this.removeBall(ball);
      return;
    }
    this.drain();
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

    // a lost ball takes the lanes back to the start
    this.laneLevel = 1;
    this.lanes.fill(false);
    this.ballsLeft -= 1;
    this.emit('drain');
    if (this.ballsLeft <= 0) {
      this.phase = 'over';
      this.balls = [{ x: -100, y: -100, vx: 0, vy: 0 }];
      this.overAt = this.clock;
      this.stars = starsFor(this.theme, this.score);
      this.closeText = soClose(this.theme, this.score, this.best);
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

  private emojiFont = (size: number): string => `${size}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;

  /** `scale` is how many pixels the canvas has for each unit of the table. */
  draw(ctx: CanvasRenderingContext2D, scale = 2): void {
    const theme = this.theme;
    const emojiFont = this.emojiFont;

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

    // the multiplier lanes
    LANE_XS.forEach((x, i) => {
      ctx.beginPath();
      ctx.roundRect(x - 11, LANE_Y - 7, 22, 14, 7);
      ctx.fillStyle = this.lanes[i] ? theme.accent : 'rgba(255,255,255,0.1)';
      ctx.shadowColor = theme.accent;
      ctx.shadowBlur = this.lanes[i] ? 12 : 0;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = theme.accent;
      ctx.stroke();
    });

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

    // the mystery saucers
    for (const saucer of this.saucers) {
      const holding = !!saucer.held;
      ctx.beginPath();
      ctx.arc(saucer.x, saucer.y, saucer.radius, 0, Math.PI * 2);
      ctx.fillStyle = '#020617';
      ctx.shadowColor = theme.accent;
      ctx.shadowBlur = holding ? 18 : 6;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 3;
      ctx.strokeStyle = holding ? '#ffffff' : theme.accent;
      ctx.stroke();
      if (!holding) {
        ctx.fillStyle = theme.accent;
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText('?', saucer.x, saucer.y + 1);
      }
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
    ctx.lineCap = 'round';
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

    // the balls, with a glow while one is saved
    if (this.phase !== 'over') {
      const style = this.ballStyle;
      const saved = this.phase === 'playing' && this.ballSaveLeft > 0;
      let light = style?.colors?.[0] ?? theme.ball[0];
      let dark = style?.colors?.[1] ?? theme.ball[1];
      let glow = style?.glow ?? theme.accent;
      if (style?.rainbow) {
        const hue = (this.clock * 160) % 360;
        light = `hsl(${hue}, 100%, 85%)`;
        dark = `hsl(${(hue + 40) % 360}, 90%, 50%)`;
        glow = `hsl(${hue}, 100%, 60%)`;
      }
      for (const ball of this.balls) {
        const shine = ctx.createRadialGradient(ball.x - 3, ball.y - 3, 1, ball.x, ball.y, BALL_RADIUS);
        shine.addColorStop(0, light);
        shine.addColorStop(1, dark);
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = shine;
        ctx.shadowColor = glow;
        ctx.shadowBlur = style?.glow || style?.rainbow ? 10 : saved ? 14 + 6 * Math.sin(this.clock * 12) : 0;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // score pop-ups
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = theme.accent;
    for (const popup of this.popups) {
      ctx.globalAlpha = Math.max(0, Math.min(1, popup.life / 0.4));
      ctx.fillText(popup.text, popup.x, popup.y);
    }
    ctx.globalAlpha = 1;

    this.drawStatus(ctx);
  }

  private drawStatus(ctx: CanvasRenderingContext2D): void {
    const theme = this.theme;
    const emojiFont = this.emojiFont;

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

    // the multiplier and how long the combo lasts
    if (this.multiplier > 1 || this.combo > 1) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillStyle = theme.accent;
      ctx.fillText('x' + this.multiplier, 200, 62);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(170, 68, 60, 4);
      ctx.fillStyle = theme.accent;
      ctx.fillRect(170, 68, 60 * Math.max(0, Math.min(1, this.comboTimer / COMBO_WINDOW)), 4);
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

    // timers: ball save, double score, multiball
    ctx.textAlign = 'right';
    ctx.font = '12px sans-serif';
    ctx.fillStyle = theme.accent;
    let timerRow = 76;
    if (this.ballSaveLeft > 0 && this.phase === 'playing') {
      ctx.fillText('BALL SAVE ' + this.ballSaveLeft.toFixed(0) + 's', WIDTH - 24, timerRow);
      timerRow += 14;
    }
    if (this.doubleLeft > 0) {
      ctx.fillText('DOUBLE SCORE ' + this.doubleLeft.toFixed(0) + 's', WIDTH - 24, timerRow);
      timerRow += 14;
    }
    if (this.multiball) ctx.fillText('MULTIBALL', WIDTH - 24, timerRow);

    // the mission at the bottom left, and the nudges left at the bottom right
    const mission = this.mission;
    ctx.textAlign = 'left';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillStyle = theme.accent;
    ctx.fillText('MISSION ' + Math.min(this.missionProgress, mission.goal) + '/' + mission.goal, 26, HEIGHT - 36);
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(mission.text.length > 26 ? mission.text.slice(0, 25) + '…' : mission.text, 26, HEIGHT - 23);
    ctx.textAlign = 'right';
    ctx.fillStyle = this.nudgesLeft > 0 ? '#94a3b8' : '#ef4444';
    ctx.font = '10px sans-serif';
    ctx.fillText('NUDGE ' + this.nudgesLeft, 330, HEIGHT - 23);

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
      ctx.fillText('Hold anywhere, let go to launch', 190, 540);
    } else if (this.phase === 'over') {
      this.drawOver(ctx);
    }

    if (this.paused) {
      ctx.fillStyle = 'rgba(2,6,23,0.72)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 34px sans-serif';
      ctx.fillText('PAUSED', 200, 330);
      ctx.font = '16px sans-serif';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText('Press P or the pause button to go on', 200, 366);
    }
  }

  private drawOver(ctx: CanvasRenderingContext2D): void {
    const theme = this.theme;
    ctx.fillStyle = 'rgba(2,6,23,0.94)';
    ctx.fillRect(30, 200, 340, 330);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(30, 200, 340, 330);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('GAME OVER', 200, 244);

    // the three stars
    ctx.font = '44px sans-serif';
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < this.stars ? '#fbbf24' : 'rgba(255,255,255,0.18)';
      ctx.fillText('★', 140 + i * 60, 300);
    }

    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = this.newBest ? theme.accent : '#e2e8f0';
    ctx.fillText(this.newBest ? 'NEW HIGH SCORE ' + this.score : 'Score ' + this.score, 200, 344);
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Best ' + Math.max(this.best, this.score) + '  ·  ' + this.missionsDone + ' missions  ·  ' + this.multiballs + ' multiballs', 200, 368);

    let row = 396;
    if (this.closeText) {
      ctx.font = 'bold 15px sans-serif';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(this.closeText, 200, row);
      row += 24;
    }
    ctx.font = '14px sans-serif';
    ctx.fillStyle = theme.accent;
    for (const line of this.bonusLines.slice(0, 3)) {
      ctx.fillText(line, 200, row);
      row += 20;
    }

    ctx.font = 'bold 20px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = theme.accent;
    ctx.shadowBlur = 10 + 6 * Math.sin(this.clock * 5);
    ctx.fillText('TAP TO PLAY AGAIN', 200, 500);
    ctx.shadowBlur = 0;
  }
}
