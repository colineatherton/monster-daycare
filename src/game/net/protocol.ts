import type { GameSnapshot } from '../types/game.ts';
import type { SkinId } from '../render/player.ts';

/**
 * What the devices say to each other.
 *
 * The host runs the whole simulation and is the only authority. Guests send
 * where they are walking and what they tapped, and draw whatever the host
 * tells them. That keeps the rules in exactly one place — the same code as a
 * quiet daycare on your own — so two buildings can never disagree.
 */

/** Grown-ups in one building, host included. */
export const MAX_PLAYERS = 5;

/** How often the host sends out a picture of the building. */
export const FRAME_MS = 70;

/** How often a guest says where it is walking. */
export const INPUT_MS = 60;

/* --------------------------------------------------------- guest -> host */

export interface HelloMessage {
  t: 'hello';
  name: string;
  skin: SkinId;
  /** Set by the host in its reply, so a guest knows which seat it has. */
  seat?: number;
}

export interface InputMessage {
  t: 'input';
  x: number;
  y: number;
}

/** "I tapped that." The host decides what, if anything, it means. */
export interface TapMessage {
  t: 'tap';
  kind: string;
  id?: string;
}

/** "I picked that off the menu." */
export interface ActionMessage {
  t: 'act';
  actionId: string;
}

export interface CloseMenuMessage {
  t: 'closemenu';
}

/**
 * Host -> guests: the daycare is open, come in. Until this arrives a guest
 * waits in the room rather than wandering an empty building.
 */
export interface StartMessage {
  t: 'start';
}

/* --------------------------------------------------------- host -> guest */

/** One grown-up, as everybody else sees them. */
export interface StaffFrame {
  seat: number;
  name: string;
  skin: SkinId;
  x: number;
  y: number;
  facing: number;
  /** What is in their hands, so it can be drawn there. */
  item: string | null;
  mop: boolean;
  /** Night shift: this one has turned, and is eating the others. */
  monster: boolean;
  /** Eaten. Lying flat where it happened. */
  flat: boolean;
}

/** One child, as everybody else sees them. */
export interface BabyFrame {
  id: string;
  species: string;
  name: string;
  x: number;
  y: number;
  facing: number;
  asleep: boolean;
  carried: boolean;
  bed: number | null;
  /** 'none' | 'ritual' | 'hunting' | 'angry'. */
  eruption: string;
  /** Whatever is in its thought bubble, already chosen. */
  bubble: string;
  urgent: boolean;
  /** How hard the dread glow underneath is pulsing, 0 to 1. */
  glow: number;
  /** Flat on the floor after the admin's anomaly caught it. */
  flat: boolean;
}

export interface ParentFrame {
  id: string;
  x: number;
  y: number;
  species: string;
  babyName: string;
}

/** Everything a guest needs to draw the building this instant. */
export interface FrameMessage {
  t: 'frame';
  /** The HUD, worked out for this particular guest. */
  hud: GameSnapshot;
  staff: StaffFrame[];
  babies: BabyFrame[];
  messes: Array<{ id: string; x: number; y: number }>;
  teddy: { x: number; y: number } | null;
  parents: ParentFrame[];
  /**
   * The picture wall, as "seat:colour" pairs — "0:ff5f9e,1:7fd4a3". Sending the
   * wall itself rather than a count is what lets a guest group it by person,
   * and lets somebody arriving halfway through see what is already up.
   */
  wall: string;
  doorBroken: boolean;
  /** How dark the building has gone, 0 to 1. */
  dread: number;
}

/** Sent when somebody joins or leaves, so everyone can see who is in. */
export interface LobbyMessage {
  t: 'lobby';
  names: string[];
  full: boolean;
}

export type NetMessage =
  | HelloMessage
  | InputMessage
  | TapMessage
  | ActionMessage
  | CloseMenuMessage
  | StartMessage
  | FrameMessage
  | LobbyMessage;

/* ------------------------------------------------------------- the code */

/** Letters that cannot be misread or misheard: no I, O, Q, S, Z, 0, 1. */
const CODE_LETTERS = 'ABCDEFGHJKLMNPRTUVWXY';

export function makeRoomCode(): string {
  let code = '';
  for (let i = 0; i < 4; i += 1) {
    code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
  }
  return code;
}

/**
 * The broker is shared with every other PeerJS app in the world, so the room
 * code gets a prefix of our own rather than being claimed bare.
 */
export function peerIdFor(code: string): string {
  return `monster-daycare-${code.toUpperCase()}`;
}
