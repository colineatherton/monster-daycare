/** The vocabulary of the whole game, in one page. */

import type { RoomId } from '../config.ts';

/** What a baby monster can want. */
export type NeedKind =
  | 'hungry'
  | 'thirsty'
  | 'sleepy'
  | 'bored'
  | 'sad'
  | 'arty'
  | 'musical'
  | 'mathsy';

/** What you can be holding. */
export type ItemKind =
  | 'food'
  | 'drink'
  | 'toy'
  | 'dummy'
  | 'crayons'
  | 'instrument'
  | 'maths'
  | 'tea';

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

/**
 * What an erupted anomaly is doing.
 * - `ritual`: up in the air, needs its nappy changing.
 * - `hunting`: loose in the building, walking towards a child to eat it.
 * - `angry`: it has eaten, and will go hunting again unless given a sock.
 */
export type EruptionState = 'none' | 'ritual' | 'hunting' | 'angry';

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
  /** How long it has been in the staff room, where it should not be. */
  staffRoomMs: number;
  /** Ticked off on the register when it arrived. */
  tickedIn: boolean;
  /** Its place in the lunch queue, while lunch is on. */
  lunchSlot: number | null;
  /** Tucked up in bed, with Zs coming off it. */
  asleep: boolean;
  /** Which bed it is in, while it is asleep. */
  bedIndex: number | null;
  /** Counts down while asleep; at zero it wants waking with a dummy. */
  sleepMsLeft: number;
  /** It has had its nap and would like a dummy now, please. */
  wantsWaking: boolean;
  /** What this one is doing, if it has gone off. */
  eruption: EruptionState;
  /** How long you have left to change a nappy, or until it eats again. */
  eruptionMsLeft: number;
  /** Who it is walking towards, while hunting. */
  huntingId: string | null;
}

/** A thing you can click on in the room. */
export type TargetKind =
  | 'baby'
  | 'parent'
  | 'fridge'
  | 'toybox'
  | 'cots'
  | 'bed'
  | 'table'
  | 'bucket'
  | 'mess'
  | 'instruments'
  | 'sums'
  | 'kettle'
  | 'register'
  | 'shop'
  | 'sockdrawer';

export interface ClickTarget {
  kind: TargetKind;
  /** Baby id or parent id. */
  id?: string;
}

/** One line in the menu that pops up when you click something. */
export interface MenuAction {
  id: string;
  label: string;
  /** Greyed out, with the reason shown. */
  disabledBecause?: string;
}

/** One parent's verdict, once they have gone home. */
export interface ParentVerdict {
  babyName: string;
  happy: boolean;
  said: string;
}

/** What you have bought at the register. */
export interface Upgrades {
  shoes: number;
  sockDrawer: boolean;
  /** False once a monster has got into the staff room and broken it. */
  coffeeMachine: boolean;
  strongDoor: boolean;
  teapot: boolean;
  nicerToys: boolean;
}

/** What the renderer hands to React every frame. */
export interface GameSnapshot {
  daycareName: string;
  coins: number;
  drawings: number;
  /** Drawings hung on the playroom wall so far. */
  onTheWall: number;
  upgrades: Upgrades;
  dayNumber: number;
  dayTimeLeftMs: number;
  /** Which room the player is standing in, in words. */
  playerRoom: string;
  /** True while everybody is queuing for their lunch. */
  lunchtime: boolean;
  /** Children who have arrived but are not on the register yet. */
  toTickIn: number;
  /** Wrappers still on the floor. */
  messCount: number;
  /** True while you are holding the mop rather than an item. */
  holdingMop: boolean;
  holding: Item | null;
  /** How much longer the tea lasts. Zero when there is none. */
  teaMsLeft: number;
  babies: Array<{
    id: string;
    name: string;
    speciesName: string;
    roomName: string;
    room: RoomId;
    need: NeedKind | null;
    /** What it is asking for, already turned into words and a picture. */
    wants: { emoji: string; name: string } | null;
    hasDrawing: boolean;
    tickedIn: boolean;
    asleep: boolean;
    wantsWaking: boolean;
    happiness: number;
    carried: boolean;
    holdingHands: boolean;
    isAnomaly: boolean;
    eruption: EruptionState;
    /** Milliseconds until it breaks out. Null unless a fuse is burning. */
    fuseLeftMs: number | null;
    /** Nappy time, or time until it eats again. */
    eruptionMsLeft: number | null;
  }>;
  /** Home time: the queue of parents still waiting at the door. */
  homeTime: {
    waiting: Array<{
      id: string;
      babyName: string;
      /** True once we have had to tell them their child was eaten. */
      babyEaten: boolean;
    }>;
    doneCount: number;
    totalCount: number;
  } | null;
  /** The open menu, positioned in screen pixels by the renderer. */
  menu: {
    title: string;
    subtitle: string;
    actions: MenuAction[];
    screenX: number;
    screenY: number;
  } | null;
  /** The card at the end of a day, once every parent has gone. */
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
