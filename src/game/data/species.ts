import type { Species } from '../types/game.ts';

/**
 * The monsters, straight off Wren's character sheet.
 *
 * Two of them are anomalies, and each has exactly one tell you can see from
 * across the room: the shadow one's shadow is the wrong shape entirely, and
 * the ritual one has teeth sticking out of its mouth.
 */
export const SPECIES: Species[] = [
  {
    id: 'blobby',
    name: 'Blobby',
    shape: 'blob',
    colour: 0x7fd4a3,
    anomaly: 'none',
    fussyAbout: null,
  },
  {
    id: 'boxy',
    name: 'Boxy',
    shape: 'square',
    colour: 0xffb37a,
    anomaly: 'none',
    fussyAbout: null,
  },
  {
    id: 'pudding',
    name: 'Pudding',
    shape: 'oval',
    colour: 0xb79cff,
    anomaly: 'none',
    fussyAbout: 'sweet',
  },
  {
    id: 'sockeater',
    name: 'Nibbles',
    shape: 'blob',
    colour: 0xf2a0c9,
    anomaly: 'none',
    fussyAbout: 'sock',
  },
  {
    id: 'shadow',
    name: 'the one whose shadow is wrong',
    shape: 'oval',
    colour: 0x9fd0e8,
    anomaly: 'shadow',
    fussyAbout: null,
  },
  {
    id: 'ritual',
    name: 'the one with the teeth',
    shape: 'square',
    colour: 0xffd9a0,
    anomaly: 'ritual',
    fussyAbout: null,
  },
];

export function speciesById(id: string): Species {
  const found = SPECIES.find((s) => s.id === id);
  if (!found) throw new Error(`no species called ${id}`);
  return found;
}

/** Names for the ordinary babies, so they feel like somebody's child. */
export const BABY_NAMES = [
  'Mo',
  'Pip',
  'Dot',
  'Bug',
  'Nub',
  'Gus',
  'Wix',
  'Tam',
  'Olly',
  'Fen',
];
