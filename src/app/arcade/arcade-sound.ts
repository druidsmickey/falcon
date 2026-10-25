import { GameEvent } from './pinball-engine';

interface Tone {
  from: number;
  to: number;
  seconds: number;
  type: OscillatorType;
  volume: number;
}

const TONES: Record<GameEvent, Tone[]> = {
  flip: [{ from: 140, to: 90, seconds: 0.05, type: 'square', volume: 0.05 }],
  launch: [{ from: 180, to: 700, seconds: 0.25, type: 'sawtooth', volume: 0.07 }],
  bumper: [{ from: 520, to: 880, seconds: 0.09, type: 'triangle', volume: 0.12 }],
  target: [{ from: 880, to: 1180, seconds: 0.12, type: 'sine', volume: 0.12 }],
  clear: [
    { from: 660, to: 660, seconds: 0.12, type: 'triangle', volume: 0.12 },
    { from: 880, to: 880, seconds: 0.12, type: 'triangle', volume: 0.12 },
    { from: 1320, to: 1320, seconds: 0.25, type: 'triangle', volume: 0.12 },
  ],
  level: [
    { from: 520, to: 520, seconds: 0.1, type: 'square', volume: 0.08 },
    { from: 780, to: 780, seconds: 0.1, type: 'square', volume: 0.08 },
    { from: 1040, to: 1040, seconds: 0.2, type: 'square', volume: 0.08 },
  ],
  extra: [
    { from: 700, to: 1400, seconds: 0.3, type: 'sine', volume: 0.12 },
    { from: 1400, to: 700, seconds: 0.3, type: 'sine', volume: 0.1 },
  ],
  save: [{ from: 400, to: 800, seconds: 0.25, type: 'sine', volume: 0.1 }],
  drain: [{ from: 300, to: 80, seconds: 0.5, type: 'sawtooth', volume: 0.1 }],
  best: [
    { from: 880, to: 880, seconds: 0.1, type: 'triangle', volume: 0.12 },
    { from: 1100, to: 1100, seconds: 0.1, type: 'triangle', volume: 0.12 },
    { from: 1320, to: 1320, seconds: 0.3, type: 'triangle', volume: 0.12 },
  ],
  lane: [{ from: 700, to: 900, seconds: 0.07, type: 'sine', volume: 0.1 }],
  saucer: [
    { from: 300, to: 600, seconds: 0.12, type: 'sine', volume: 0.1 },
    { from: 600, to: 300, seconds: 0.12, type: 'sine', volume: 0.1 },
  ],
  multiball: [
    { from: 520, to: 520, seconds: 0.08, type: 'square', volume: 0.08 },
    { from: 660, to: 660, seconds: 0.08, type: 'square', volume: 0.08 },
    { from: 780, to: 780, seconds: 0.08, type: 'square', volume: 0.08 },
    { from: 1040, to: 1040, seconds: 0.22, type: 'square', volume: 0.08 },
  ],
  mission: [
    { from: 660, to: 660, seconds: 0.1, type: 'triangle', volume: 0.12 },
    { from: 990, to: 990, seconds: 0.1, type: 'triangle', volume: 0.12 },
    { from: 1320, to: 1320, seconds: 0.3, type: 'triangle', volume: 0.12 },
  ],
  nudge: [{ from: 120, to: 60, seconds: 0.12, type: 'sawtooth', volume: 0.09 }],
  over: [
    { from: 400, to: 300, seconds: 0.25, type: 'square', volume: 0.08 },
    { from: 300, to: 200, seconds: 0.25, type: 'square', volume: 0.08 },
    { from: 200, to: 100, seconds: 0.5, type: 'square', volume: 0.08 },
  ],
};

/** Small sound effects made with the browser's audio, no files. Silent until `enable` is called by a tap or key press. */
export class ArcadeSound {
  muted = true;
  private context: AudioContext | null = null;

  /** Must be called from a user action, as browsers do not allow sound before one. */
  enable(): void {
    if (this.context || typeof AudioContext === 'undefined') return;
    try {
      this.context = new AudioContext();
    } catch {
      this.context = null;
    }
  }

  play(event: GameEvent): void {
    const context = this.context;
    if (this.muted || !context) return;
    if (context.state === 'suspended') void context.resume();

    let start = context.currentTime;
    for (const tone of TONES[event]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = tone.type;
      oscillator.frequency.setValueAtTime(tone.from, start);
      oscillator.frequency.linearRampToValueAtTime(tone.to, start + tone.seconds);
      gain.gain.setValueAtTime(tone.volume, start);
      gain.gain.linearRampToValueAtTime(0.0001, start + tone.seconds);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + tone.seconds);
      start += tone.seconds;
    }
  }
}
