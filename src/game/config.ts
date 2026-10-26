/**
 * Every number worth fiddling with while playtesting.
 *
 * Positions are in "room units" — a flat 1200 x 800 floor plan, because that is
 * what walking and collision care about. The renderer maps those onto the 3D
 * ground plane (room x -> world x, room y -> world z, world y is height).
 */

export const ROOM = {
  width: 1000,
  depth: 680,
  wall: 18,
} as const;

/** How many room units make one 3D world unit. Sets room size vs. the player. */
export const UNITS_PER_METRE = 80;

export const PLAYER = {
  speed: 260,
  bodyWidth: 34,
  bodyHeight: 30,
  spawnX: 500,
  spawnY: 450,
  /** How close you must be for a menu action to happen. */
  reach: 90,
} as const;

export const BABIES = {
  /** Toddling speed when a baby wanders off on its own. */
  speed: 42,
  bodyWidth: 30,
  bodyHeight: 28,
  /** How long between one need being met and the next one appearing. */
  needGapMs: 14_000,
  /** Wobble either side of the gap, so they don't all ask at once. */
  needGapJitterMs: 7_000,
  /** An ordinary baby gets this long before it starts losing happiness. */
  patienceMs: 45_000,
  /** Happiness lost per second once patience runs out. */
  unhappyPerSecond: 7,
  /** Happiness regained for getting it what it wanted. */
  needMetReward: 22,
  /** Being given the wrong thing. Crosser, not happier. */
  wrongThingPenalty: 10,
  /** How long a baby colours for before its drawing is finished. */
  drawingMs: 14_000,
  /** Taking a drawing is worth this, and they love you for it. */
  drawingCoins: 12,
} as const;

export const ANOMALY = {
  /**
   * The whole point. When an anomaly wants something, this is all the time you
   * get before it comes through the door.
   */
  fuseMs: 60_000,
  /** The room starts dimming at this much time left. */
  dimAtMs: 40_000,
  /** Heartbeat starts here, and gets faster the lower it goes. */
  panicAtMs: 20_000,
  /** Anomalies pay better than ordinary babies. Being frightened is work. */
  payMultiplier: 3,
  /**
   * Once a ritual anomaly is up in the air, this is how long you have to get
   * over there and change its nappy. The ritual is survivable; the other one
   * is not.
   */
  ritualMs: 25_000,
} as const;

export const DAY = {
  /** How long a day lasts before the parents come back. */
  lengthMs: 240_000,
  /** Happiness at or above this and the parent goes home pleased. */
  happyParentThreshold: 60,
} as const;

/** Where everything in the room is. */
export const PLACES = {
  door: { x: 500, y: 55, w: 150, h: 40 },
  fridge: { x: 135, y: 175, w: 140, h: 110 },
  toybox: { x: 865, y: 175, w: 140, h: 110 },
  cots: { x: 150, y: 545, w: 210, h: 130 },
  table: { x: 500, y: 585, w: 180, h: 100 },
  bucket: { x: 890, y: 560, w: 100, h: 100 },
  rug: { x: 500, y: 340, w: 380, h: 240 },
} as const;
