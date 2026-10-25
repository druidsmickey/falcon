// The four tables. A theme is only data: colours, pictures, words and where the bumpers stand. The rules
// are the same on every table (see pinball-engine.ts), so each one plays a little differently because of
// its layout but earns the same rewards.

export type ThemeId = 'dino' | 'cars' | 'plants' | 'ocean';

export interface BumperSpot {
  x: number;
  y: number;
  radius: number;
}

/** What a mission counts: hits on the bumpers, all four targets lit, visits to a mystery saucer, lanes completed, or the longest combo. */
export type MissionKind = 'bumper' | 'clear' | 'saucer' | 'lane' | 'combo';

export interface MissionDef {
  kind: MissionKind;
  goal: number;
  /** Shown on the table, short. */
  text: string;
  /** Points for finishing it (not multiplied). */
  reward: number;
}

export interface Theme {
  id: ThemeId;
  name: string;
  tagline: string;
  icon: string;
  /** Top and bottom colour of the table. */
  sky: [string, string];
  /** The walls. */
  wall: string;
  bumper: string;
  bumperLit: string;
  flipper: string;
  ball: [string, string];
  /** The accent used for the score, the multiplier and the targets. */
  accent: string;
  bumperIcons: string[];
  /** Faint pictures spread over the table. */
  scatter: string[];
  /** What flies out of a bumper that is hit. */
  particles: string[];
  /** Name of the thing that grows as the bumpers are hit, and a picture for each of its stages. */
  meter: { name: string; stages: string[]; levelUp: string };
  bumpers: BumperSpot[];
  clear: string;
  /** The missions, one after the other, then round again. */
  missions: MissionDef[];
  /** The scores for one, two and three stars. */
  stars: [number, number, number];
}

export const THEMES: Theme[] = [
  {
    id: 'dino',
    name: 'Dino Rampage',
    tagline: 'Stampede through the jungle',
    icon: '🦖',
    sky: ['#1b2a10', '#3b1d0b'],
    wall: '#84cc16',
    bumper: '#ea580c',
    bumperLit: '#fde047',
    flipper: '#a16207',
    ball: ['#fef9c3', '#a16207'],
    accent: '#bef264',
    bumperIcons: ['🥚', '🦕', '🌋'],
    scatter: ['🦴', '🌿', '🦖', '🥚', '🌴', '🦕'],
    particles: ['🦴', '🔥', '🥚'],
    meter: { name: 'Eggs hatched', stages: ['🥚', '🐣', '🦖', '🦕', '🐉'], levelUp: 'AN EGG HATCHED!' },
    bumpers: [
      { x: 135, y: 290, radius: 26 },
      { x: 245, y: 290, radius: 26 },
      { x: 190, y: 210, radius: 26 },
    ],
    clear: 'STAMPEDE!',
    stars: [5000, 15000, 30000],
    missions: [
      { kind: 'bumper', goal: 12, text: 'Hatch 12 eggs: hit the bumpers', reward: 1500 },
      { kind: 'saucer', goal: 1, text: 'Find the mystery nest', reward: 2000 },
      { kind: 'clear', goal: 1, text: 'Light all four targets', reward: 3000 },
      { kind: 'combo', goal: 10, text: 'Chain 10 hits', reward: 2500 },
    ],
  },
  {
    id: 'cars',
    name: 'Turbo Garage',
    tagline: 'Cars and motorbikes: rack up the laps',
    icon: '🏎️',
    sky: ['#111827', '#3f0d12'],
    wall: '#f43f5e',
    bumper: '#2563eb',
    bumperLit: '#fde047',
    flipper: '#e5e7eb',
    ball: ['#ffffff', '#6b7280'],
    accent: '#fb7185',
    bumperIcons: ['🏎️', '🏍️', '🏁', '🚓'],
    scatter: ['🏁', '🛞', '🚦', '⛽', '🏍️', '🏎️'],
    particles: ['💨', '🔥', '⚡'],
    meter: { name: 'Laps', stages: ['🚦', '🚗', '🏎️', '🏍️', '🏆'], levelUp: 'LAP COMPLETE!' },
    bumpers: [
      { x: 115, y: 330, radius: 24 },
      { x: 225, y: 330, radius: 24 },
      { x: 170, y: 255, radius: 24 },
      { x: 285, y: 265, radius: 22 },
    ],
    clear: 'CHEQUERED FLAG!',
    stars: [6000, 17000, 34000],
    missions: [
      { kind: 'bumper', goal: 12, text: 'Take 12 corners: hit the bumpers', reward: 1500 },
      { kind: 'lane', goal: 1, text: 'Light all four boost lanes', reward: 2500 },
      { kind: 'saucer', goal: 1, text: 'Visit the pit stop', reward: 2000 },
      { kind: 'combo', goal: 10, text: 'Run a 10-hit streak', reward: 2500 },
    ],
  },
  {
    id: 'plants',
    name: 'Jungle Grove',
    tagline: 'Plants and trees: grow your tree, one bloom at a time',
    icon: '🌳',
    sky: ['#052e1c', '#123524'],
    wall: '#4ade80',
    bumper: '#be185d',
    bumperLit: '#fef08a',
    flipper: '#65a30d',
    ball: ['#fefce8', '#ca8a04'],
    accent: '#86efac',
    bumperIcons: ['🌸', '🍄', '🌻', '🌷', '🪻'],
    scatter: ['🌿', '🍃', '🌱', '🌲', '🌼', '🍀'],
    particles: ['🍃', '🌸', '🌼'],
    meter: { name: 'Tree stage', stages: ['🌱', '🌿', '🪴', '🌳', '🌸'], levelUp: 'YOUR TREE GREW!' },
    bumpers: [
      { x: 100, y: 265, radius: 21 },
      { x: 180, y: 305, radius: 21 },
      { x: 260, y: 265, radius: 21 },
      { x: 135, y: 385, radius: 20 },
      { x: 225, y: 385, radius: 20 },
    ],
    clear: 'IN FULL BLOOM!',
    stars: [5500, 16000, 32000],
    missions: [
      { kind: 'bumper', goal: 14, text: 'Pollinate 14 flowers', reward: 1500 },
      { kind: 'clear', goal: 1, text: 'Grow all four sprouts', reward: 3000 },
      { kind: 'saucer', goal: 1, text: 'Find the hidden spring', reward: 2000 },
      { kind: 'lane', goal: 1, text: 'Light all four sun lanes', reward: 2500 },
    ],
  },
  {
    id: 'ocean',
    name: 'Deep Blue',
    tagline: 'Fish, sharks and whales: dive deeper',
    icon: '🐋',
    sky: ['#06304f', '#020c24'],
    wall: '#22d3ee',
    bumper: '#0e7490',
    bumperLit: '#fef08a',
    flipper: '#38bdf8',
    ball: ['#ecfeff', '#0891b2'],
    accent: '#67e8f9',
    bumperIcons: ['🦈', '🐋', '🐟', '🐙'],
    scatter: ['🐟', '🫧', '🐠', '🦀', '🐡', '🪸'],
    particles: ['🫧', '🐟', '💦'],
    meter: { name: 'Depth', stages: ['🫧', '🐟', '🦈', '🐋', '🐙'], levelUp: 'DIVING DEEPER!' },
    bumpers: [
      { x: 95, y: 330, radius: 24 },
      { x: 250, y: 330, radius: 24 },
      { x: 170, y: 245, radius: 26 },
      { x: 170, y: 410, radius: 19 },
    ],
    clear: 'SCHOOL OF FISH!',
    stars: [5000, 15000, 30000],
    missions: [
      { kind: 'bumper', goal: 12, text: 'Dive past 12 creatures', reward: 1500 },
      { kind: 'saucer', goal: 1, text: 'Open the treasure chest', reward: 2000 },
      { kind: 'clear', goal: 1, text: 'Gather the school of fish', reward: 3000 },
      { kind: 'combo', goal: 12, text: 'Ride a 12-hit wave', reward: 2500 },
    ],
  },
];

export function themeById(id: string | null | undefined): Theme {
  return THEMES.find(theme => theme.id === id) ?? THEMES[0];
}
