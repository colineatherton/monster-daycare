/**
 * Every number worth fiddling with while playtesting.
 *
 * Positions are in "room units" — a flat floor plan, because that is what
 * walking and collision need. The renderer maps those onto the 3D ground plane
 * (plan x -> world x, plan y -> world z, world y is height).
 */

/** The whole building. */
export const ROOM = {
  width: 2400,
  depth: 1500,
  wall: 20,
} as const;

/** How many room units make one 3D world unit. Sets room size vs. the player. */
export const UNITS_PER_METRE = 80;

/**
 * The five rooms. The playroom is the hub down the middle; everything else
 * opens off it, so you are always going back through the middle.
 */
export const ROOMS = {
  music: { x0: 20, y0: 20, x1: 790, y1: 600, name: 'the music room' },
  staff: { x0: 20, y0: 630, x1: 790, y1: 1040, name: 'the staff room' },
  shop: { x0: 20, y0: 1070, x1: 790, y1: 1480, name: 'the shop' },
  play: { x0: 810, y0: 20, x1: 1590, y1: 1480, name: 'the playroom' },
  maths: { x0: 1610, y0: 20, x1: 2380, y1: 740, name: 'the maths room' },
  anomaly: { x0: 1610, y0: 770, x1: 2380, y1: 1480, name: 'the anomaly room' },
} as const;

export type RoomId = keyof typeof ROOMS;

/** Where the doorways are. The anomaly room's is the one that gets broken. */
export const DOORWAYS = {
  music: { x: 800, y0: 240, y1: 400 },
  staff: { x: 800, y0: 760, y1: 910 },
  shop: { x: 800, y0: 1210, y1: 1360 },
  maths: { x: 1600, y0: 300, y1: 480 },
  anomaly: { x: 1600, y0: 1020, y1: 1200 },
} as const;

export const PLAYER = {
  speed: 300,
  /** How much faster a cup of tea makes you, and for how long. */
  teaSpeedMultiplier: 1.6,
  teaMs: 30_000,
  bodyWidth: 34,
  bodyHeight: 30,
  spawnX: 1200,
  spawnY: 900,
  /** How close you must be for a menu action to happen. */
  reach: 95,
} as const;

/** Nap time. */
export const BEDS = {
  /** How many beds there are. Fewer beds than children is the point. */
  count: 4,
  /** How long a baby sleeps before it wants waking up. */
  sleepMs: 22_000,
  /** Being put down in a bed is worth this much happiness. */
  tuckedInReward: 20,
} as const;

export const BABIES = {
  /** Toddling speed when a baby wanders off on its own. */
  speed: 42,
  bodyWidth: 30,
  bodyHeight: 28,
  /** How long between one need being met and the next one appearing. */
  needGapMs: 16_000,
  /** Wobble either side of the gap, so they don't all ask at once. */
  needGapJitterMs: 9_000,
  /** An ordinary baby gets this long before it starts losing happiness. */
  patienceMs: 50_000,
  /** Happiness lost per second once patience runs out. */
  unhappyPerSecond: 7,
  /** Happiness regained for getting it what it wanted. */
  needMetReward: 22,
  /** Being given the wrong thing. Crosser, not happier. */
  wrongThingPenalty: 10,
  /** How long a baby keeps toddling after it starts wanting something,
   *  before it settles down to stare at you until you bring it. */
  settleAfterMs: 9_000,
  /** How long a baby can be in the staff room before the coffee machine goes. */
  staffRoomGraceMs: 18_000,
  /** How long a baby colours for before its drawing is finished. */
  drawingMs: 14_000,
  /** Taking a drawing is worth this, and they love you for it. */
  drawingCoins: 12,
} as const;

export const ANOMALY = {
  /**
   * The whole point. Long enough to run and fetch the thing it asked for if
   * you set off immediately, and not a second longer.
   */
  fuseMs: 15_000,
  /** The building starts dimming with this much left. */
  dimAtMs: 10_000,
  /** Heartbeat starts here, and gets faster the lower it goes. */
  panicAtMs: 6_000,
  /** Anomalies pay better than ordinary babies. Being frightened is work. */
  payMultiplier: 3,

  /**
   * Once a ritual anomaly is up in the air, this is how long you have to get
   * over there and change its nappy. Generous on purpose — the fuse is the
   * scary bit, this is the rescue.
   */
  ritualMs: 15_000,
  /**
   * How long a loose one waits before going after the next child. The fuse is
   * five seconds and you will not stop many eruptions — this is the number
   * that decides whether you can *recover* from one, so it has to be long
   * enough to fetch a sock from the fridge and get back.
   */
  stalkMs: 20_000,
  /** How much faster than a toddler it moves while it is hunting. */
  huntSpeed: 95,
  /** Calming a loose one down with a sock is worth this. */
  sockCoins: 50,
  /** Changing a ritual nappy is worth this. */
  nappyCoins: 60,
} as const;

/** The marketplace. Prices in coins, and what each one actually does. */
export const COFFEE = {
  /** What a replacement coffee machine costs. */
  price: 80,
  /** Without one, no tea, and tea is how you keep up. */
} as const;

export const SHOP = {
  /** Repeatable: each pair makes you a bit faster, for good. */
  shoesPrice: 60,
  shoesMax: 3,
  shoesSpeedStep: 0.18,

  /** A sock drawer beside the anomaly room, so the fridge is not the only one. */
  sockDrawerPrice: 120,

  /** A stronger door on the anomaly room: a longer fuse, for good. */
  strongDoorPrice: 150,
  strongDoorExtraMs: 3_000,

  /** Tea lasts twice as long. */
  teapotPrice: 70,

  /** Toys and instruments count double. */
  nicerToysPrice: 90,
  nicerToysBonus: 18,
} as const;

/** Lunch, and the mess it leaves. */
export const LUNCH = {
  /** Lunch starts once this much of the day has gone. */
  startAfterFraction: 0.45,
  /** Lunch is over after this long whether or not everybody got fed. */
  windowMs: 55_000,
  /** Where the queue forms, and how far apart they stand. */
  queueX: 1000,
  queueY: 560,
  queueSpacing: 130,
  /** Each wrapper dropped afterwards is worth this to sweep up. */
  moppingCoins: 6,
  /** Children notice a filthy floor, and it costs them this much a second. */
  messUnhappinessPerSecond: 1.6,
  /** Below this many wrappers nobody minds. */
  messTolerated: 2,
} as const;

/** Which shift each of Wren's story beats lands on. */
export const STORY = {
  /** Bob starts coming, so he is a face you know before he loses anything. */
  bobFrom: 1,
  /** Bob's teddy gets left behind at the end of this shift. */
  teddyLeftOn: 3,
  /** Pip visits for the first time. */
  pipFrom: 4,
  /** Bob starts hunting for the teddy. */
  bobSearchesOn: 7,
  /** Pip turns up carrying the teddy you once gave him. */
  pipRemembersOn: 8,
  /** The microphone. */
  microphoneOn: 11,
  /** Pip's drawing arrives; and Bob either thanks you or stops pretending. */
  pipDrawsOn: 12,
  bobDecidesOn: 12,
  /** You find out why Pip keeps coming back. */
  pipTruthOn: 20,
} as const;

export const DAY = {
  /** How long a day lasts before the parents come back. */
  lengthMs: 240_000,
  /** Happiness at or above this and the parent goes home pleased. */
  happyParentThreshold: 60,
} as const;

/** Where everything in the building is. */
export const PLACES = {
  frontDoor: { x: 1200, y: 60, w: 150, h: 40 },
  fridge: { x: 920, y: 150, w: 150, h: 110 },
  toybox: { x: 1480, y: 150, w: 150, h: 110 },
  cots: { x: 1020, y: 1330, w: 380, h: 150 },
  table: { x: 950, y: 1080, w: 190, h: 110 },
  bucket: { x: 1520, y: 1360, w: 100, h: 100 },
  rug: { x: 1200, y: 760, w: 460, h: 420 },

  instruments: { x: 300, y: 260, w: 230, h: 130 },
  sums: { x: 2060, y: 300, w: 230, h: 130 },
  kettle: { x: 290, y: 850, w: 190, h: 110 },
  shopCounter: { x: 300, y: 1270, w: 240, h: 120 },
  pen: { x: 2000, y: 1130, w: 300, h: 240 },
  register: { x: 1200, y: 330, w: 160, h: 100 },
  sockDrawer: { x: 1480, y: 1120, w: 120, h: 90 },
} as const;
