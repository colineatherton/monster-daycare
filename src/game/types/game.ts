/** The vocabulary of the whole game, in one page. */

/** What a baby monster can want. */
export type NeedKind = 'hungry' | 'thirsty' | 'sleepy' | 'bored' | 'sad';

/** What you can be holding. */
export type ItemKind = 'food' | 'drink' | 'toy' | 'blanket';

/**
 * Labels carried by food and wanted by babies. One monster only eats socks,
 * another only eats blue things — this is how that works, and it means a new
 * food works with every monster for free.
 */
export type Tag = 'sweet' | 'squishy' | 'crunchy' | 'blue' | 'sock' | 'slimy' | 'warm';

export interface Item {
  id: string;
  kind: ItemKind;
  name: string;
  tags: Tag[];
  colour: number;
}

/** The three body shapes Wren drew. */
export type BodyShape = 'blob' | 'square' | 'oval';

/**
 * Normal babies are just babies. The two anomaly kinds each have one obvious
 * tell and one very different way of going wrong.
 */
export type AnomalyKind = 'none' | 'shadow' | 'ritual';

export interface Species {
  id: string;
  name: string;
  shape: BodyShape;
  colour: number;
  anomaly: AnomalyKind;
  /** Food must carry this label, or the baby gets crosser. Null means anything. */
  fussyAbout: Tag | null;
}

export interface Baby {
  id: string;
  species: Species;
  name: string;
  x: number;
  y: number;
  /** Where it is toddling to, if anywhere. */
  wanderX: number;
  wanderY: number;
  facing: number;
  need: NeedKind | null;
  /** Milliseconds this need has been waiting. */
  needAgeMs: number;
  /** Counts down to the next need appearing. */
  nextNeedMs: number;
  happiness: number;
  /** Being carried by the player. */
  carried: boolean;
  /** Holding the player's hand, and following them about. */
  holdingHands: boolean;
  /** Set once an anomaly's fuse has burnt all the way down. */
  erupted: boolean;
}

/** A thing you can click on in the room. */
export type TargetKind = 'baby' | 'fridge' | 'toybox' | 'cots' | 'bucket';

export interface ClickTarget {
  kind: TargetKind;
  /** Baby id, for baby targets. */
  id?: string;
}

/** One line in the menu that pops up when you click something. */
export interface MenuAction {
  id: string;
  label: string;
  /** Greyed out, with the reason shown. */
  disabledBecause?: string;
}

/** What the renderer hands to React every frame. */
export interface GameSnapshot {
  daycareName: string;
  coins: number;
  dayNumber: number;
  dayTimeLeftMs: number;
  holding: Item | null;
  babies: Array<{
    id: string;
    name: string;
    speciesName: string;
    need: NeedKind | null;
    happiness: number;
    carried: boolean;
    holdingHands: boolean;
    isAnomaly: boolean;
    /** Milliseconds until it comes through the door. Null unless it is an
     *  anomaly with an unmet need. */
    fuseLeftMs: number | null;
  }>;
  /** The open menu, positioned in screen pixels by the renderer. */
  menu: {
    title: string;
    subtitle: string;
    actions: MenuAction[];
    screenX: number;
    screenY: number;
  } | null;
  /** Non-null once the run is over. */
  gameOver: { reason: string; detail: string } | null;
  hint: string;
}
