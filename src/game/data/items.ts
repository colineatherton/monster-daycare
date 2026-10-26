import type { Item, ItemKind } from '../types/game.ts';

/**
 * Everything you can pick up.
 *
 * A hungry baby does not just want "food" — it asks for one particular thing,
 * by name and by picture, so you always know what to fetch. The labels are what
 * a fussy baby checks when it picks what to ask for.
 */
export const ITEMS: Item[] = [
  { id: 'jelly', kind: 'food', name: 'wobbly jelly', emoji: '🍮', tags: ['sweet', 'squishy'], colour: 0xff5f9e },
  { id: 'crisps', kind: 'food', name: 'crisps', emoji: '🍟', tags: ['crunchy'], colour: 0xf2c14e },
  { id: 'sock', kind: 'food', name: 'a sock', emoji: '🧦', tags: ['sock', 'squishy'], colour: 0xb7b7d8 },
  { id: 'bluecake', kind: 'food', name: 'blue cake', emoji: '🎂', tags: ['sweet', 'blue'], colour: 0x4aa8ff },
  { id: 'worms', kind: 'food', name: 'jelly worms', emoji: '🪱', tags: ['slimy', 'squishy'], colour: 0x6bd36b },
  { id: 'milk', kind: 'drink', name: 'a bottle of milk', emoji: '🍼', tags: ['warm'], colour: 0xfff6e0 },
  { id: 'slime', kind: 'drink', name: 'slime juice', emoji: '🧋', tags: ['slimy', 'blue'], colour: 0x3fd0d0 },
  { id: 'ball', kind: 'toy', name: 'a bouncy ball', emoji: '⚽', tags: [], colour: 0xff7043 },
  { id: 'rattle', kind: 'toy', name: 'a rattle', emoji: '🔔', tags: [], colour: 0xffd166 },
  { id: 'teddy', kind: 'toy', name: 'a teddy', emoji: '🧸', tags: ['squishy'], colour: 0xc08552 },
  { id: 'blanket', kind: 'blanket', name: 'a blanket', emoji: '🛏️', tags: ['warm'], colour: 0xa78bfa },
  { id: 'crayons', kind: 'crayons', name: 'the crayons', emoji: '🖍️', tags: [], colour: 0xff5a5a },
];

export function itemById(id: string): Item {
  const found = ITEMS.find((item) => item.id === id);
  if (!found) throw new Error(`no item called ${id}`);
  return found;
}

export function itemsOfKind(kind: ItemKind): Item[] {
  return ITEMS.filter((item) => item.kind === kind);
}
