// The four tables. A theme is only data: colours, pictures, words and where the bumpers stand. The rules
// are the same on every table (see pinball-engine.ts), so each one plays a little differently because of
// its layout but earns the same rewards.

export type ThemeId = 'dino' | 'cars' | 'plants' | 'ocean';

export interface BumperSpot {
  x: number;
  y: number;
  radius: number;
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
}

export const THEMES: Theme[] = [
  {
    id: 'dino',
    name: 'Dino Island',
    tagline: 'Hatch the eggs before the volcano erupts',
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
  },
  {
    id: 'cars',
    name: 'Turbo Circuit',
    tagline: 'Rack up laps and beat the clock',
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
  },
  {
    id: 'plants',
    name: 'Secret Garden',
    tagline: 'Make your tree grow, one bloom at a time',
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
  },
  {
    id: 'ocean',
    name: 'Deep Blue',
    tagline: 'Dive deeper among the sharks and whales',
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
  },
];

export function themeById(id: string | null | undefined): Theme {
  return THEMES.find(theme => theme.id === id) ?? THEMES[0];
}
