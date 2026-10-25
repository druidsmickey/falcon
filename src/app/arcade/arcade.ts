import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, computed, inject, signal, viewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ArcadeSound } from './arcade-sound';
import { ArcadeStore } from './arcade-store';
import { HEIGHT, Pinball, WIDTH } from './pinball-engine';
import { BALL_STYLES, BallStyle, levelOf, levelProgress, starsFor, styleById, unlocked, xpForGame } from './progression';
import { THEMES, Theme } from './themes';

/** What a finger that is down on the screen is doing. */
interface Touch {
  role: 'left' | 'right' | 'plunger';
  x: number;
  y: number;
  at: number;
}

/** A swipe up of this many pixels, quickly, is a nudge. */
const SWIPE_PIXELS = 60;
const SWIPE_SECONDS = 0.45;

/**
 * Pinball on its own page, with four tables. The whole screen is the control: the left half works the left
 * flipper, the right half the right one, a finger held down while the ball waits charges the plunger, and a
 * swipe up nudges the table. It does not use the login, the server or any saved app data.
 */
@Component({
  selector: 'app-arcade',
  templateUrl: './arcade.html',
  styleUrl: './arcade.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:keydown)': 'onKey($event, true)',
    '(window:keyup)': 'onKey($event, false)',
    '(document:visibilitychange)': 'onHidden()',
  },
})
export class Arcade implements AfterViewInit, OnDestroy {
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('table');
  private readonly store = new ArcadeStore();
  private readonly sound = new ArcadeSound();
  private readonly zone = inject(NgZone);
  private readonly title = inject(Title);
  // the page is called Pinball while the game is shown, and gets its own name back when it is left (in the app the game is a tab)
  private readonly previousTitle = this.title.getTitle();
  private game: Pinball | null = null;
  private frame = 0;
  private lastTime = 0;
  private readonly touches = new Map<number, Touch>();
  /** A line for the game-over screen that comes from outside the game: the daily streak. */
  private dailyLine: string | null = null;

  protected readonly themes = THEMES;
  protected readonly balls = BALL_STYLES;
  protected readonly data = signal(this.store.load());
  protected readonly theme = signal<Theme | null>(null);
  protected readonly paused = signal(false);
  protected readonly level = computed(() => levelProgress(this.data().xp));

  constructor() {
    this.title.setTitle('Pinball');
    this.sound.muted = this.data().muted;
  }

  ngAfterViewInit(): void {
    const canvas = this.canvas().nativeElement;
    // the picture is drawn at twice the size so that it stays sharp on phones
    canvas.width = WIDTH * 2;
    canvas.height = HEIGHT * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(2, 2);

    const loop = (time: number) => {
      const seconds = this.lastTime ? (time - this.lastTime) / 1000 : 0;
      this.lastTime = time;
      const game = this.game;
      if (game) {
        game.step(seconds);
        game.draw(ctx, 2);
      }
      this.frame = requestAnimationFrame(loop);
    };
    // the game moves 60 times a second and must not make the whole app check itself each time (that made the buttons lag)
    this.zone.runOutsideAngular(() => {
      this.frame = requestAnimationFrame(loop);
    });
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    if (this.previousTitle) this.title.setTitle(this.previousTitle);
  }

  // ---------------------------------------------------------------- tables

  protected play(theme: Theme): void {
    this.sound.enable();
    this.store.setLast(theme.id);

    // the first game of a day counts for the streak and gives experience
    const daily = this.store.claimDaily();
    this.dailyLine = daily ? `DAY ${daily.streak} STREAK: +${daily.bonus} XP` : null;
    this.data.set(this.store.load());

    const game = new Pinball(theme);
    game.best = this.data().best[theme.id];
    game.ballStyle = this.chosenStyle();
    game.onEvent = event => {
      this.sound.play(event);
      if (event === 'over') this.finished(game, theme);
    };
    this.touches.clear();
    this.game = game;
    this.paused.set(false);
    this.theme.set(theme);
  }

  protected menu(): void {
    // leaving a game in progress still counts it, so the score is not lost
    if (this.game && this.theme() && this.game.phase !== 'over' && this.game.score > 0) {
      this.finished(this.game, this.theme()!);
    }
    this.releaseAll();
    this.game = null;
    this.theme.set(null);
    this.paused.set(false);
    this.data.set(this.store.load());
  }

  /** Saves the score, stars and experience of a game and puts what was won on the game-over screen. */
  private finished(game: Pinball, theme: Theme): void {
    const stars = starsFor(theme, game.score);
    const xp = xpForGame(game.score, stars, game.missionsDone);
    const record = this.store.finish(theme.id, { score: game.score, stars, xp });

    const lines = [`+${xp} XP`];
    const before = levelOf(record.xpBefore);
    const after = levelOf(record.xpAfter);
    if (after > before) {
      lines.push(`LEVEL UP! Level ${after}`);
      const gained = BALL_STYLES.find(style => style.level > before && style.level <= after);
      if (gained) lines.push(`${gained.name} ball unlocked`);
    }
    if (this.dailyLine) {
      lines.push(this.dailyLine);
      this.dailyLine = null;
    }
    game.bonusLines = lines;

    this.data.set(this.store.load());
    game.best = this.data().best[theme.id];
  }

  protected toggleSound(): void {
    this.sound.enable();
    this.sound.muted = !this.sound.muted;
    this.store.setMuted(this.sound.muted);
    this.data.set(this.store.load());
  }

  protected togglePause(): void {
    const game = this.game;
    if (!game) return;
    game.togglePause();
    this.paused.set(game.paused);
    if (game.paused) this.releaseAll();
  }

  protected onHidden(): void {
    const game = this.game;
    if (document.hidden && game && game.phase === 'playing' && !game.paused) this.togglePause();
  }

  protected format(score: number): string {
    return score.toLocaleString('en-US');
  }

  protected stars(count: number): string {
    return '★'.repeat(count) + '☆'.repeat(3 - count);
  }

  // ---------------------------------------------------------------- ball styles

  private chosenStyle(): BallStyle {
    const style = styleById(this.data().ball);
    return unlocked(style, levelOf(this.data().xp)) ? style : BALL_STYLES[0];
  }

  protected isUnlocked(style: BallStyle): boolean {
    return unlocked(style, this.level().level);
  }

  protected isChosen(style: BallStyle): boolean {
    return this.chosenStyle().id === style.id;
  }

  protected chooseBall(style: BallStyle): void {
    if (!this.isUnlocked(style)) return;
    this.store.setBall(style.id);
    this.data.set(this.store.load());
  }

  /** The look of a ball style as a small picture. */
  protected swatch(style: BallStyle): string {
    if (style.rainbow) return 'conic-gradient(red, orange, yellow, lime, cyan, blue, magenta, red)';
    const [light, dark] = style.colors ?? ['#e2e8f0', '#475569'];
    return `radial-gradient(circle at 35% 35%, ${light}, ${dark})`;
  }

  // ---------------------------------------------------------------- touch: the whole screen is the control

  protected pointerDown(event: PointerEvent): void {
    const game = this.game;
    if (!game || game.paused) return;
    // buttons (tables, pause, sound) work as buttons
    if ((event.target as HTMLElement).closest('button, a, input')) return;

    this.sound.enable();
    if (game.phase === 'over') {
      game.retry();
      return;
    }

    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // not every browser lets a finger be captured; the game still works without it
    }

    // a finger held down while the ball waits charges the plunger, wherever it is; after that the halves are the flippers
    const role: Touch['role'] = game.phase === 'ready' ? 'plunger' : event.clientX < window.innerWidth / 2 ? 'left' : 'right';
    this.touches.set(event.pointerId, { role, x: event.clientX, y: event.clientY, at: event.timeStamp });
    this.syncControls();
  }

  protected pointerMove(event: PointerEvent): void {
    const touch = this.touches.get(event.pointerId);
    const game = this.game;
    if (!touch || !game || touch.role === 'plunger') return;

    const up = touch.y - event.clientY;
    if (up >= SWIPE_PIXELS && (event.timeStamp - touch.at) / 1000 <= SWIPE_SECONDS) {
      // a swipe up nudges the table, towards the side it leaned to; the flipper is let go
      const lean = event.clientX - touch.x;
      this.touches.delete(event.pointerId);
      this.syncControls();
      game.nudge(Math.abs(lean) > 25 ? Math.sign(lean) : 0);
    }
  }

  protected pointerUp(event: PointerEvent): void {
    if (!this.touches.delete(event.pointerId)) return;
    this.syncControls();
  }

  /** Presses the flippers and the plunger according to the fingers that are down. */
  private syncControls(): void {
    const game = this.game;
    if (!game) return;
    const roles = [...this.touches.values()].map(t => t.role);
    game.setLeft(roles.includes('left'));
    game.setRight(roles.includes('right'));
    game.setPlunger(roles.includes('plunger'));
  }

  private releaseAll(): void {
    this.touches.clear();
    this.syncControls();
  }

  // ---------------------------------------------------------------- keyboard

  protected onKey(event: KeyboardEvent, down: boolean): void {
    const game = this.game;
    if (!game) {
      const index = /^(Digit|Numpad)([1-9])$/.exec(event.code);
      if (down && index && THEMES[Number(index[2]) - 1]) this.play(THEMES[Number(index[2]) - 1]);
      return;
    }
    if (down && event.code === 'Escape') {
      this.menu();
      return;
    }
    if (down && event.code === 'KeyP') {
      this.togglePause();
      return;
    }
    if (game.paused) return;

    if (event.code === 'KeyN') {
      event.preventDefault();
      if (down && !event.repeat) game.nudge();
      return;
    }

    const press = (apply: (on: boolean) => void): void => {
      event.preventDefault();
      if (event.repeat) return;
      if (down && game.phase === 'over') game.retry();
      else apply(down);
    };

    switch (event.code) {
      case 'ArrowLeft':
      case 'KeyZ':
      case 'KeyA':
        press(on => game.setLeft(on));
        break;
      case 'ArrowRight':
      case 'KeyM':
      case 'KeyD':
      case 'Slash':
        press(on => game.setRight(on));
        break;
      case 'Space':
      case 'ArrowDown':
      case 'Enter':
        press(on => game.setPlunger(on));
        break;
    }
  }
}
