import type { Item, ItemKind } from '../types/game.ts';

/**
 * Everything you can pick up. Food and drink carry labels; a fussy baby checks
 * for its one label and sulks if it isn't there.
 */
export const ITEMS: Item[] = [
  { id: 'jelly', kind: 'food', name: 'wobbly jelly', tags: ['sweet', 'squishy'], colour: 0xff5f9e },
  { id: 'crisps', kind: 'food', name: 'crisps', tags: ['crunchy'], colour: 0xf2c14e },
  { id: 'sock', kind: 'food', name: 'a sock', tags: ['sock', 'squishy'], colour: 0xb7b7d8 },
  { id: 'bluecake', kind: 'food', name: 'blue cake', tags: ['sweet', 'blue'], colour: 0x4aa8ff },
  { id: 'worms', kind: 'food', name: 'jelly worms', tags: ['slimy', 'squishy'], colour: 0x6bd36b },
  { id: 'milk', kind: 'drink', name: 'a bottle of milk', tags: ['warm'], colour: 0xfff6e0 },
  { id: 'slime', kind: 'drink', name: 'slime juice', tags: ['slimy', 'blue'], colour: 0x3fd0d0 },
  { id: 'ball', kind: 'toy', name: 'a bouncy ball', tags: [], colour: 0xff7043 },
  { id: 'rattle', kind: 'toy', name: 'a rattle', tags: [], colour: 0xffd166 },
  { id: 'teddy', kind: 'toy', name: 'a teddy', tags: ['squishy'], colour: 0xc08552 },
  { id: 'blanket', kind: 'blanket', name: 'a blanket', tags: ['warm'], colour: 0xa78bfa },
];

export function itemById(id: string): Item {
  const found = ITEMS.find((item) => item.id === id);
  if (!found) throw new Error(`no item called ${id}`);
  return found;
}

export function itemsOfKind(kind: ItemKind): Item[] {
  return ITEMS.filter((item) => item.kind === kind);
}
