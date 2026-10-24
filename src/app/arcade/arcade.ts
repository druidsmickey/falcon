import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject, viewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { HEIGHT, Pinball, WIDTH } from './pinball-engine';

type Pad = 'left' | 'right' | 'launch';

/** A pinball game on its own page. It does not use the login, the server or any saved data. */
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
  private readonly game = new Pinball();
  private frame = 0;
  private lastTime = 0;

  constructor() {
    inject(Title).setTitle('Pinball');
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
      this.game.step(seconds);
      this.game.draw(ctx);
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
  }

  protected press(pad: Pad, down: boolean): void {
    if (pad === 'left') this.game.setLeft(down);
    else if (pad === 'right') this.game.setRight(down);
    else this.game.setPlunger(down);
  }

  protected onKey(event: KeyboardEvent, down: boolean): void {
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
