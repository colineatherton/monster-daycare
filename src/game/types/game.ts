/** The vocabulary of the whole game, in one page. */

/** What a baby monster can want. */
export type NeedKind = 'hungry' | 'thirsty' | 'sleepy' | 'bored' | 'sad' | 'arty';

/** What you can be holding. */
export type ItemKind = 'food' | 'drink' | 'toy' | 'blanket' | 'crayons';

/**
 * Labels carried by food. A fussy monster only ever asks for food wearing its
 * one label, which is how "she only eats socks" works without a special case.
 */
export type Tag = 'sweet' | 'squishy' | 'crunchy' | 'blue' | 'sock' | 'slimy' | 'warm';

export interface Item {
  id: string;
  kind: ItemKind;
  name: string;
  /** Shown in the baby's thought bubble, so you know exactly what to fetch. */
  emoji: string;
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
  /** Only ever asks for food carrying this label. Null means anything goes. */
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
  /** The exact thing it is asking for, so the bubble can name it. */
  wantedItemId: string | null;
  /** Milliseconds this need has been waiting. */
  needAgeMs: number;
  /** Counts down to the next need appearing. */
  nextNeedMs: number;
  /** Counts down while it is colouring, before the drawing is finished. */
  drawingMs: number;
  /** It has finished a picture and wants you to have it. */
  hasDrawing: boolean;
  happiness: number;
  /** Being carried by the player. */
  carried: boolean;
  /** Holding the player's hand, and following them about. */
  holdingHands: boolean;
  /** A ritual anomaly whose fuse ran out: up in the air, nappy unchanged. */
  erupted: boolean;
  /** How long you have left to change its nappy and end the ritual. */
  ritualMsLeft: number;
}

/** A thing you can click on in the room. */
export type TargetKind = 'baby' | 'fridge' | 'toybox' | 'cots' | 'table' | 'bucket';

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

/** One parent's verdict at home time. */
export interface ParentVerdict {
  babyName: string;
  speciesName: string;
  happy: boolean;
  said: string;
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
    /** What it is asking for, already turned into words and a picture. */
    wants: { emoji: string; name: string } | null;
    hasDrawing: boolean;
    happiness: number;
    carried: boolean;
    holdingHands: boolean;
    isAnomaly: boolean;
    erupted: boolean;
    /** Milliseconds until it comes through the door. Null unless it is an
     *  anomaly with an unmet need. */
    fuseLeftMs: number | null;
    /** Milliseconds left to change its nappy, once the ritual has started. */
    ritualMsLeft: number | null;
  }>;
  /** The open menu, positioned in screen pixels by the renderer. */
  menu: {
    title: string;
    subtitle: string;
    actions: MenuAction[];
    screenX: number;
    screenY: number;
  } | null;
  /** Home time: what every parent said. Non-null pauses the game. */
  dayReport: {
    dayNumber: number;
    verdicts: ParentVerdict[];
    earned: number;
  } | null;
  /** Non-null once the run is over. */
  gameOver: { reason: string; detail: string } | null;
  musicOn: boolean;
  hint: string;
}
