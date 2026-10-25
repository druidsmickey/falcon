import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject, signal, viewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ArcadeSound } from './arcade-sound';
import { ArcadeStore } from './arcade-store';
import { HEIGHT, Pinball, WIDTH } from './pinball-engine';
import { THEMES, Theme } from './themes';

type Pad = 'left' | 'right' | 'launch';

/** Pinball on its own page, with four tables. It does not use the login, the server or any saved app data. */
@Component({
  selector: 'app-arcade',
  templateUrl: './arcade.html',
  styleUrl: './arcade.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:keydown)': 'onKey($event, true)',
    '(window:keyup)': 'onKey($event, false)',
  },
})
export class Arcade implements AfterViewInit, OnDestroy {
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('table');
  private readonly store = new ArcadeStore();
  private readonly sound = new ArcadeSound();
  private game: Pinball | null = null;
  private frame = 0;
  private lastTime = 0;

  protected readonly themes = THEMES;
  protected readonly data = signal(this.store.load());
  protected readonly theme = signal<Theme | null>(null);

  private readonly title = inject(Title);
  // the page is called Pinball while the game is shown, and gets its own name back when it is left (in the app the game is a tab)
  private readonly previousTitle = this.title.getTitle();

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
        game.draw(ctx);
      }
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    if (this.previousTitle) this.title.setTitle(this.previousTitle);
  }

  // ---------------------------------------------------------------- tables

  protected play(theme: Theme): void {
    this.sound.enable();
    this.store.setLast(theme.id);
    this.data.set(this.store.load());

    const game = new Pinball(theme);
    game.best = this.data().best[theme.id];
    game.onEvent = event => {
      this.sound.play(event);
      if (event === 'over') this.finished(game, theme);
    };
    this.game = game;
    this.theme.set(theme);
  }

  protected menu(): void {
    // leaving a game in progress still counts it, so the score is not lost
    if (this.game && this.theme() && this.game.phase !== 'over' && this.game.score > 0) this.finished(this.game, this.theme()!);
    this.game?.setLeft(false);
    this.game?.setRight(false);
    this.game?.setPlunger(false);
    this.game = null;
    this.theme.set(null);
    this.data.set(this.store.load());
  }

  private finished(game: Pinball, theme: Theme): void {
    this.store.record(theme.id, game.score);
    this.data.set(this.store.load());
    game.best = this.data().best[theme.id];
  }

  protected toggleSound(): void {
    this.sound.enable();
    this.sound.muted = !this.sound.muted;
    this.store.setMuted(this.sound.muted);
    this.data.set(this.store.load());
  }

  protected format(score: number): string {
    return score.toLocaleString('en-US');
  }

  // ---------------------------------------------------------------- controls

  protected press(pad: Pad, down: boolean): void {
    this.sound.enable();
    const game = this.game;
    if (!game) return;
    if (pad === 'left') game.setLeft(down);
    else if (pad === 'right') game.setRight(down);
    else game.setPlunger(down);
  }

  protected onKey(event: KeyboardEvent, down: boolean): void {
    if (!this.game) {
      const index = /^(Digit|Numpad)([1-9])$/.exec(event.code);
      if (down && index && THEMES[Number(index[2]) - 1]) this.play(THEMES[Number(index[2]) - 1]);
      return;
    }
    if (down && event.code === 'Escape') {
      this.menu();
      return;
    }
    const pad = this.padFor(event.code);
    if (!pad) return;
    event.preventDefault();
    if (!event.repeat) this.press(pad, down);
  }

  private padFor(code: string): Pad | null {
    switch (code) {
      case 'ArrowLeft':
      case 'KeyZ':
      case 'KeyA':
        return 'left';
      case 'ArrowRight':
      case 'KeyM':
      case 'KeyD':
      case 'Slash':
        return 'right';
      case 'Space':
      case 'ArrowDown':
      case 'Enter':
        return 'launch';
      default:
        return null;
    }
  }

}
