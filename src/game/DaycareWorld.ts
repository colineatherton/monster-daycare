import * as THREE from 'three';
import {
  ANOMALY,
  BABIES,
  BEDS,
  COFFEE,
  DAY,
  DOORWAYS,
  LUNCH,
  PLACES,
  PLAYER,
  ROOM,
  ROOMS,
  SHOP,
  STORY,
} from './config.ts';
import type { RoomId } from './config.ts';
import { kx, ku, kz, disposeSubtree } from './render/three-helpers.ts';
import {
  bedPosition,
  buildHighlightRing,
  buildLostTeddy,
  buildMess,
  buildMicrophone,
  buildRoom,
  hangDrawing,
  wallPlaque,
  partitionWalls,
} from './render/room.ts';
import { buildBaby, buildRitualForm, type BabyModel } from './render/monsters.ts';
import {
  buildFlattened,
  buildMonsterForm,
  buildParent,
  buildPlayer,
  SKINS,
  type SkinId,
} from './render/player.ts';
import { buildItem, buildDreadGlow } from './render/items.ts';
import { thoughtBubble, textLabel } from './render/labels.ts';
import { ITEMS, itemById, itemsOfKind } from './data/items.ts';
import { BABY_NAMES, EVERYDAY_SPECIES, SPECIES, speciesById } from './data/species.ts';
import { loadStory, saveStory, type StoryState } from './data/story.ts';
import { secretFor, type SecretMode } from './data/secrets.ts';
import { netSession } from './net/session.ts';
import {
  FRAME_MS,
  INPUT_MS,
  type BabyFrame,
  type FrameMessage,
  type NetMessage,
  type StaffFrame,
} from './net/protocol.ts';
import { attachInput, walkVector } from './input.ts';
import { publish, commands } from './bus.ts';
import { music } from './audio/music.ts';
import type {
  Baby,
  ClickTarget,
  GameSnapshot,
  Item,
  MenuAction,
  NeedKind,
  ParentVerdict,
  Species,
  StaffScore,
  Upgrades,
} from './types/game.ts';

/**
 * The whole game: one scene, one loop, one place where clicking something turns
 * into the player walking over and doing it.
 *
 * The shape of a turn is always the same. You click a thing, a menu opens, you
 * pick an action, and the player walks there and carries it out. Everything
 * else — needs filling up, happiness draining, an anomaly's fuse burning down —
 * happens on its own in `step()`.
 */

/** Only used when the need is not about a particular object. */
const NEED_EMOJI: Record<NeedKind, string> = {
  hungry: '🍽️',
  thirsty: '🍼',
  sleepy: '😴',
  bored: '🧸',
  sad: '😢',
  arty: '🖍️',
  musical: '🎵',
  mathsy: '🔢',
};

const NEED_WORD: Record<NeedKind, string> = {
  hungry: 'hungry',
  thirsty: 'thirsty',
  sleepy: 'sleepy',
  bored: 'bored',
  sad: 'sad',
  arty: 'wants to draw',
  musical: 'wants to make a noise',
  mathsy: 'wants to do sums',
};

/** Which kind of thing answers each need. `sad` is answered by a cuddle. */
const NEED_ITEM_KIND: Record<NeedKind, Item['kind'] | null> = {
  hungry: 'food',
  thirsty: 'drink',
  sleepy: null,
  bored: 'toy',
  sad: null,
  arty: 'crayons',
  musical: 'instrument',
  mathsy: 'maths',
};

/**
 * How long a guest waits in silence before deciding the host has gone.
 *
 * Generous on purpose. The first version gave up after four seconds and
 * announced the host had left while she was still sitting there — a throttled
 * background tab or one long frame building the end-of-shift report is enough
 * to go that quiet. Now the connection dropping is what really decides it, and
 * silence alone has to last twice as long before we believe it.
 */
const HOST_SILENCE_MS = 6000;

/** The night shift's one real rule: how close is close enough to eat. */
const EATING = {
  /** Room units between the two of you. Less than a spawn gap apart. */
  reach: 72,
  /** How long you lie there before getting up by yourself. Wren picked this. */
  flatMs: 15_000,
} as const;

/** Where the camera sits relative to whatever it is looking at. */
const CAMERA_OFFSET = new THREE.Vector3(0, 9.0, 8.4);

/**
 * One picture on the playroom wall. The seat matters because the wall is sorted
 * by it: in a shared building you can see at a glance which of you was handed
 * what. Seat -1 is Pip's, which nobody was given.
 */
interface WallPicture {
  colour: number;
  seat: number;
  teddy?: boolean;
}

function encodeWall(items: WallPicture[]): string {
  return items
    .map((i) => `${i.seat}:${i.colour.toString(16)}${i.teddy ? ':t' : ''}`)
    .join(',');
}

function decodeWall(packed: string): WallPicture[] {
  if (!packed) return [];
  return packed.split(',').map((part) => {
    const [seat, colour, teddy] = part.split(':');
    return { seat: Number(seat), colour: Number.parseInt(colour, 16), teddy: teddy === 't' };
  });
}

/** Furniture you bump into. Room units. */
const FURNITURE = [
  PLACES.fridge,
  PLACES.toybox,
  PLACES.cots,
  PLACES.table,
  PLACES.bucket,
  PLACES.bin,
  PLACES.instruments,
  PLACES.sums,
  PLACES.kettle,
  PLACES.register,
  PLACES.shopCounter,
];

/**
 * The last two positions heard from the host, so a guest can draw the point
 * between them instead of jumping from one to the next.
 */
interface Trail {
  prevT: number;
  prevX: number;
  prevY: number;
  prevFacing: number;
  t: number;
  x: number;
  y: number;
  facing: number;
}

function freshTrail(x: number, y: number, facing = 0): Trail {
  const now = performance.now();
  return { prevT: now, prevX: x, prevY: y, prevFacing: facing, t: now, x, y, facing };
}

/** Record something the host just said, keeping the previous word. */
function pushTrail(trail: Trail, x: number, y: number, facing: number): void {
  trail.prevT = trail.t;
  trail.prevX = trail.x;
  trail.prevY = trail.y;
  trail.prevFacing = trail.facing;
  trail.t = performance.now();
  trail.x = x;
  trail.y = y;
  trail.facing = facing;
}

/**
 * Draw a little way in the past — just over one gap between updates — so
 * there are always two points to sit between. The cost is a fraction of a
 * second of lag on other people; the gain is that they move.
 */
const INTERP_DELAY_MS = 110;

/** Where something was at `renderTime`, between the two things last heard. */
function trailAt(trail: Trail, renderTime: number): { x: number; y: number; facing: number } {
  const span = trail.t - trail.prevT;
  const alpha = span > 0 ? Math.min(1, Math.max(0, (renderTime - trail.prevT) / span)) : 1;
  return {
    x: trail.prevX + (trail.x - trail.prevX) * alpha,
    y: trail.prevY + (trail.y - trail.prevY) * alpha,
    facing: trail.prevFacing + angleTo(trail.prevFacing, trail.facing) * alpha,
  };
}

/** The shortest way round from one angle to another, in radians. */
function angleTo(from: number, to: number): number {
  let difference = (to - from) % (Math.PI * 2);
  if (difference > Math.PI) difference -= Math.PI * 2;
  if (difference < -Math.PI) difference += Math.PI * 2;
  return difference;
}

/**
 * Which of the things under the pointer was meant.
 *
 * Big furniture is clicked through an invisible box the size of the whole
 * thing, so a wrapper dropped between the beds sits *inside* the nap corner's
 * box and the nearest hit is always the furniture. Small things on the floor
 * therefore win, as long as they are at roughly the same depth — far enough
 * behind and it is something in the next room, which was not meant at all.
 */
function pickFrom(hits: THREE.Intersection[]): THREE.Intersection | undefined {
  if (hits.length === 0) return undefined;
  const nearest = hits[0];
  const small = hits.find((candidate) => {
    if (candidate.distance > nearest.distance + 1.6) return false;
    const data = candidate.object.userData as {
      babyId?: string;
      parentId?: string;
      target?: ClickTarget;
    };
    if (data.babyId || data.parentId) return true;
    return (
      data.target?.kind === 'mess' ||
      data.target?.kind === 'lostteddy' ||
      data.target?.kind === 'player'
    );
  });
  return small ?? nearest;
}

/** Is this object, and everything it hangs off, actually visible? */
function onScreen(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

/** Which room a point on the plan is in. Defaults to the playroom. */
function roomAt(x: number, y: number): RoomId {
  for (const id of Object.keys(ROOMS) as RoomId[]) {
    const r = ROOMS[id];
    if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return id;
  }
  return 'play';
}

function randomSpotIn(id: RoomId): { x: number; y: number } {
  const r = ROOMS[id];
  const inset = 90;
  return {
    x: r.x0 + inset + Math.random() * Math.max(1, r.x1 - r.x0 - inset * 2),
    y: r.y0 + inset + Math.random() * Math.max(1, r.y1 - r.y0 - inset * 2),
  };
}

/** Rooms a child might wander into on its own. Not the anomaly room. */
const WANDERABLE: RoomId[] = ['play', 'play', 'play', 'music', 'maths', 'staff', 'shop'];

/** The gap in the wall you have to go through to reach a room. */
/** How wide the gap is, so a route can aim at a clear part of it. */
function doorwaySpan(room: RoomId): { y0: number; y1: number } | null {
  if (room === 'play') return null;
  const gap = DOORWAYS[room];
  return { y0: gap.y0, y1: gap.y1 };
}

/** Is this spot inside something you would bump into? */
function insideFurniture(x: number, y: number): boolean {
  return FURNITURE.some(
    (o) =>
      Math.abs(x - o.x) < o.w / 2 + PLAYER.bodyWidth &&
      Math.abs(y - o.y) < o.h / 2 + PLAYER.bodyHeight,
  );
}

function doorwayInto(room: RoomId): { x: number; y: number } | null {
  switch (room) {
    case 'music':
      return { x: DOORWAYS.music.x, y: (DOORWAYS.music.y0 + DOORWAYS.music.y1) / 2 };
    case 'staff':
      return { x: DOORWAYS.staff.x, y: (DOORWAYS.staff.y0 + DOORWAYS.staff.y1) / 2 };
    case 'shop':
      return { x: DOORWAYS.shop.x, y: (DOORWAYS.shop.y0 + DOORWAYS.shop.y1) / 2 };
    case 'maths':
      return { x: DOORWAYS.maths.x, y: (DOORWAYS.maths.y0 + DOORWAYS.maths.y1) / 2 };
    case 'anomaly':
      return { x: DOORWAYS.anomaly.x, y: (DOORWAYS.anomaly.y0 + DOORWAYS.anomaly.y1) / 2 };
    default:
      return null;
  }
}

/**
 * One grown-up in the building. There is always at least one — you — and in a
 * shared daycare there is one of these per person, each with their own hands,
 * their own menu and their own cup of tea.
 */
interface Staff {
  /** Position in the list. Seat 0 is whoever is hosting. */
  seat: number;
  /**
   * The last two things the host said about this person, with the moment each
   * arrived. A guest draws a point *between* them — the host speaks fourteen
   * times a second and the screen draws sixty, so anything drawn straight off
   * the wire sits still for four frames and then leaps.
   */
  net: Trail;
  /** Where somebody else said they were walking. Unused for seat 0. */
  remoteMove: { x: number; y: number };
  name: string;
  skin: SkinId;
  x: number;
  y: number;
  facing: number;
  walkPhase: number;
  model: ReturnType<typeof buildPlayer>;
  holding: Item | null;
  heldModel: THREE.Group | null;
  holdingMop: boolean;
  mopModel: THREE.Group | null;
  teaMsLeft: number;
  /** Walk over there, then do this. Each person has their own. */
  pending: { target: ClickTarget; actionId: string } | null;
  /** Whose menu is open, for this person only. */
  menuTarget: ClickTarget | null;
  /** What they were last told, shown on their own screen. */
  hint: string;
  /** What they have done this shift, for the award at the end of it. */
  score: {
    looked: number;
    ticked: number;
    tidied: number;
    brave: number;
    /** Anomalies seen to before they erupted. Disasters that never happened. */
    prevented: number;
    home: number;
  };
  /**
   * Night shift only: this one has stopped being a member of staff. Walking
   * into anybody else now eats them.
   */
  monster: boolean;
  monsterModel: THREE.Group | null;
  /** Eaten. Flat on the floor, can't move, until this runs out or somebody mops. */
  flatMsLeft: number;
  flatModel: THREE.Group | null;
}

interface BabyEntity extends Baby {
  model: BabyModel;
  /** The last two things the host said about it. Only a guest uses this. */
  net: Trail;
  /** Bob, on the shift he starts looking for his teddy. Nothing settles him. */
  searching: boolean;
  /** Something carried or clutched: Pip's remembered teddy, or a microphone. */
  prop: THREE.Group | null;
  /** Waypoints left to walk, so it goes through doorways and not through
   *  walls. Every room opens off the playroom, so this is never more than
   *  two corners and a destination. */
  path: Array<{ x: number; y: number }>;
  bubble: THREE.Sprite | null;
  bubbleFor: string;
  nameTag: THREE.Sprite;
  glow: THREE.Mesh;
  walkPhase: number;
  /** The spiky triangle it becomes while the ritual is going on. */
  ritualForm: THREE.Group | null;
  /** Which room it is wandering about in. */
  room: RoomId;
}

/** A parent in the home-time queue. */
interface ParentEntity {
  id: string;
  babyId: string;
  babyName: string;
  species: Species;
  x: number;
  y: number;
  group: THREE.Group;
}

export class DaycareWorld {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly raycaster = new THREE.Raycaster();
  private lastFrameAt = performance.now();

  /** How many frames have gone wrong. Kept so the log does not fill up. */
  private frameFaults = 0;

  private readonly room = buildRoom();
  private readonly walls = partitionWalls();
  private readonly ring = buildHighlightRing();
  private readonly ambient: THREE.AmbientLight;
  private readonly sun: THREE.DirectionalLight;

  /** Everybody working in the building. Seat 0 is the person at this screen. */
  private staff: Staff[] = [];

  /**
   * Which seat belongs to this screen. Zero when hosting or playing alone; a
   * guest is told its seat when it says hello.
   */
  private mySeat = 0;

  /** The grown-up at this keyboard. */
  private get me(): Staff {
    return this.staff[this.mySeat] ?? this.staff[0];
  }

  private babies: BabyEntity[] = [];
  private nextBabyId = 1;
  /** Drawings you have been given. Kept for the pure joy of a rising number. */
  private drawings = 0;
  /** Drawings collected today, waiting to go up on the wall at home time. */
  private pendingDrawings: WallPicture[] = [];

  /** What is actually hanging up, in the order it hangs. */
  private wallItems: WallPicture[] = [];

  /** The wall as last drawn, so a guest only rebuilds it when it changes. */
  private wallKey = '';
  /** How many are already hanging up. */
  private onTheWall = 0;
  /** What you have bought at the register. */
  private upgrades: Upgrades = {
    shoes: 0,
    coffeeMachine: true,
    sockDrawer: false,
    strongDoor: false,
    teapot: false,
    nicerToys: false,
  };
  /** Children that were eaten today. Their parents still turn up. */
  private eaten: Array<{ id: string; name: string; species: Species }> = [];

  /** Parents who dropped a baby off and are about to leave again. */
  private droppers: Array<{ group: THREE.Group; y: number; waitMs: number }> = [];
  /** Parents queuing at home time. */
  private queue: ParentEntity[] = [];
  private verdicts: ParentVerdict[] = [];
  private homeTime = false;
  private nextParentId = 1;

  private daycareName: string;
  private coins = 0;
  /**
   * The shift number, which is also the day number, and which is kept in the
   * browser so the twenty-shift story survives a lost run. Difficulty stops
   * climbing at shift 7 anyway, so resuming high is no harder than resuming
   * low.
   */
  private story: StoryState;
  /** The shift number. Displayed, and what every story beat keys off. */
  private dayNumber = 1;
  private dayTimeLeftMs: number = DAY.lengthMs;
  private spawnQueue: Species[] = [];
  private nextSpawnMs = 1500;

  /** True while everybody is queuing up for lunch. */
  private lunchtime = false;
  private lunchDone = false;
  private lunchMsLeft = 0;
  /** Wrappers on the floor, waiting for the mop. */
  private messes: Array<{ id: string; x: number; y: number; group: THREE.Group }> = [];
  private nextMessId = 1;

  /** Bob's teddy, lying on the playroom floor where you left it. */
  private lostTeddy: { x: number; y: number; group: THREE.Group } | null = null;

  /** The monster with the microphone, on the shift it finds one. */
  private announcerId: string | null = null;
  private announcement: string | null = null;
  private announcementMsLeft = 0;
  private nextAnnounceMs = 6000;
  private announcementsMade = 0;
  /**
   * Something it has announced that has not happened yet. When the timer runs
   * out the game makes it true, which is the whole joke.
   */
  private prophecy: { kind: 'want' | 'break' | 'home'; babyId?: string; itemId?: string } | null =
    null;
  private prophecyMsLeft = 0;

  private dayReport: {
    dayNumber: number;
    verdicts: ParentVerdict[];
    earned: number;
    scores: StaffScore[];
    employeeOfTheShift: string | null;
  } | null = null;
  private gameOver: { reason: string; detail: string } | null = null;
  private musicOn = true;
  private lastHeartbeatAt = 0;

  private disposeInput: () => void;
  private frame = 0;
  private running = true;
  private canvas: HTMLCanvasElement;

  /** Which day a fresh run starts on. `?day=3` jumps straight to the anomalies. */
  private readonly firstDay: number;

  /** Connection ids in seat order, so seat N belongs to one particular guest. */
  private seats: string[] = [];
  private sinceFrameMs = 0;
  /** When the host last said anything, and whether we have given up on them. */
  private lastHostWordAt = performance.now();
  private hostLeft = false;
  private sinceInputMs = 0;
  /** The last picture of the building this guest was sent. */
  private latestFrame: FrameMessage | null = null;

  /** Normally 'normal'. The two secret names change the whole shift. */
  private readonly mode: SecretMode;

  /**
   * Which daycare you are *looking at*. A guest is in the host's building, so
   * if the host called it the rotted one then it is grey for everybody —
   * whatever the guest happened to type on their own front screen.
   */
  private get lookMode(): SecretMode {
    return this.amGuest ? (this.latestFrame?.hud.mode ?? 'normal') : this.mode;
  }

  constructor(
    canvas: HTMLCanvasElement,
    options: { daycareName: string; skin: SkinId; firstDay?: number },
  ) {
    this.canvas = canvas;
    this.daycareName = options.daycareName;
    this.mode = secretFor(options.daycareName);
    this.story = loadStory();
    if (options.firstDay && options.firstDay > 1) {
      // ?shift=N, for jumping straight to a story beat while building it.
      this.story.shiftsWorked = options.firstDay - 1;
    }
    this.firstDay = Math.max(1, options.firstDay ?? 1);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(0xdff3fb);

    // The building is far too big to see at once, so the camera travels with
    // you and the list down the side tells you what is happening elsewhere.
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.copy(CAMERA_OFFSET);
    this.camera.lookAt(0, 0.6, 0.1);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.78);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff3e0, 0.85);
    this.sun.position.set(5, 11, 7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -12;
    this.sun.shadow.camera.right = 12;
    this.sun.shadow.camera.top = 10;
    this.sun.shadow.camera.bottom = -10;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.scene.add(this.room.root);
    this.scene.add(this.ring);

    // Named after whoever you chose to be, the same as everybody else. "You"
    // read oddly on the board next to Sam and Mr Ashworth.
    this.addStaff(0, SKINS.find((entry) => entry.id === options.skin)?.label ?? 'The Teacher', options.skin);
    this.startDay(this.firstDay);

    this.disposeInput = attachInput();
    commands.current = {
      chooseMenuAction: (id) => {
        if (this.amGuest) {
          this.me.menuTarget = null;
          netSession.send({ t: 'act', actionId: id });
          return;
        }
        this.chooseMenuAction(this.me, id);
      },
      selectBaby: (babyId) => {
        // The building is far bigger than the screen, so the list down the
        // side is the only way to reach a child in another room. It goes
        // through the same path as tapping one, so a guest's choice reaches
        // the host rather than being opened only on their own screen.
        if (this.babyById(babyId)) this.tap({ kind: 'baby', id: babyId });
      },
      closeMenu: () => this.tap(null),
      restart: () => this.restart(),
      nextDay: () => {
        if (!this.dayReport) return;
        this.startDay(this.dayReport.dayNumber + 1);
        this.dayReport = null;
      },
      toggleMusic: () => {
        this.musicOn = !this.musicOn;
        music.setMuted(!this.musicOn);
      },
      admin: (what) => {
        this.admin(what);
        // Answer the button now rather than on the next tick.
        this.publishSnapshot();
      },
    };

    music.setMuted(!this.musicOn);
    music.start();

    // Anybody who joined while this screen was still on the front page is
    // already connected; give them a seat now.
    if (this.amHost) {
      for (const id of netSession.connectionIds) this.onGuestJoined(id);
    }

    // A guest introduces itself, so the host knows who has walked in.
    if (this.amGuest) {
      const label = SKINS.find((entry) => entry.id === options.skin)?.label ?? 'Helper';
      netSession.send({ t: 'hello', name: label, skin: options.skin });
    }

    netSession.listen({
      onStatus: (status) => {
        // The host closing the room, or the connection failing outright.
        if (this.amGuest && (status === 'idle' || status === 'error')) this.hostLeft = true;
      },
      onMessage: (message, from) => this.onNetMessage(message, from),
      onGuestJoined: (id) => this.onGuestJoined(id),
      onGuestLeft: (id) => this.onGuestLeft(id),
    });

    canvas.addEventListener('pointerdown', this.onPointerDown);

    this.resize();
    window.addEventListener('resize', this.resize);
    this.renderer.setAnimationLoop(this.tick);
  }

  /* ------------------------------------------------------------ lifecycle */

  /** Put somebody new on the staff, with their own hands and their own menu. */
  private addStaff(seat: number, name: string, skin: SkinId): Staff {
    const model = buildPlayer(skin);
    model.root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) child.castShadow = true;
    });
    this.scene.add(model.root);

    const member: Staff = {
      seat,
      net: freshTrail(PLAYER.spawnX + (seat - 0.5) * 90, PLAYER.spawnY),
      remoteMove: { x: 0, y: 0 },
      name,
      skin,
      // Everybody starts just inside the front door, spread out a little.
      x: PLAYER.spawnX + (seat - 0.5) * 90,
      y: PLAYER.spawnY,
      facing: 0,
      walkPhase: 0,
      model,
      holding: null,
      heldModel: null,
      holdingMop: false,
      mopModel: null,
      teaMsLeft: 0,
      pending: null,
      menuTarget: null,
      hint: 'Click a monster, or click a cupboard to fetch something.',
      score: { looked: 0, ticked: 0, tidied: 0, brave: 0, prevented: 0, home: 0 },
      monster: false,
      monsterModel: null,
      flatMsLeft: 0,
      flatModel: null,
    };
    this.staff[seat] = member;
    return member;
  }

  private removeStaff(seat: number): void {
    const member = this.staff[seat];
    if (!member) return;
    this.scene.remove(member.model.root);
    disposeSubtree(member.model.root);
    this.staff.splice(seat, 1);
    this.staff.forEach((person, index) => {
      person.seat = index;
    });
  }

  private startDay(day: number): void {
    this.dayNumber = day;
    this.story.shiftsWorked = day - 1;
    saveStory(this.story);
    this.dayTimeLeftMs = DAY.lengthMs;
    this.nextSpawnMs = 1500;
    this.homeTime = false;
    this.lunchtime = false;
    this.lunchDone = false;
    this.clearMesses();
    this.verdicts = [];
    this.eaten = [];
    this.setAnomalyDoorBroken(false);

    const anomalies = SPECIES.filter((s) => s.anomaly !== 'none');

    // Shifts 1 and 2 have no anomalies at all. The first one turns up on shift
    // 3, once you already know where everything is. Unless this is the rotted
    // daycare, where there was never anything else.
    const babyCount = Math.min(2 + (day - 1), 6);
    const anomalyCount =
      this.mode === 'rotted' ? babyCount : day < 3 ? 0 : Math.min(1 + Math.floor((day - 3) / 2), 2);

    const queue: Species[] = [];
    for (let i = 0; i < babyCount - anomalyCount; i += 1) {
      queue.push(EVERYDAY_SPECIES[(i + day) % EVERYDAY_SPECIES.length]);
    }
    for (let i = 0; i < anomalyCount; i += 1) {
      queue.push(anomalies[(i + day) % anomalies.length]);
    }

    for (let i = queue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }

    // The two regulars take places in the queue rather than adding to it, so
    // the room never gets more crowded than it should be.
    this.bookPlaceFor(queue, 'bob', day >= STORY.bobFrom && this.mode !== 'rotted');
    this.bookPlaceFor(queue, 'pip', day >= STORY.pipFrom && this.mode !== 'rotted');

    this.spawnQueue = queue;
    this.openShiftStory();
  }

  /** Put a particular child into the morning's queue, replacing a stranger. */
  private bookPlaceFor(queue: Species[], id: string, wanted: boolean): void {
    if (!wanted) return;
    if (queue.some((species) => species.id === id)) return;
    const regular = speciesById(id);
    // Only take a stranger's place. Booking Pip in used to overwrite Bob,
    // because Bob was in the first ordinary slot by then.
    const slot = queue.findIndex(
      (species) => species.anomaly === 'none' && species.id !== 'pip' && species.id !== 'bob',
    );
    if (slot === -1) queue.push(regular);
    else queue[slot] = regular;
  }

  private restart(): void {
    for (const baby of this.babies) this.removeBaby(baby);
    this.babies = [];
    this.clearDroppers();
    this.clearQueue();
    this.coins = 0;
    this.drawings = 0;
    this.pendingDrawings = [];
    this.me.teaMsLeft = 0;
    this.upgrades = {
      shoes: 0,
      coffeeMachine: true,
      sockDrawer: false,
      strongDoor: false,
      teapot: false,
      nicerToys: false,
    };
    this.room.sockDrawer.visible = false;
    this.room.pictureWall.clear();
    this.onTheWall = 0;
    this.wallItems = [];
    this.wallKey = '';
    this.gameOver = null;
    this.dayReport = null;
    this.me.holding = null;
    this.setHeldModel(this.me, null);
    this.me.x = PLAYER.spawnX;
    this.me.y = PLAYER.spawnY;
    this.me.menuTarget = null;
    this.me.pending = null;
    this.me.hint = 'Click a monster, or click a cupboard to fetch something.';
    // Losing does not cost you the story. You open up again on the same shift.
    this.startDay(Math.max(1, this.story.shiftsWorked + 1));
  }

  dispose(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.resize);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.disposeInput();
    while (this.staff.length > 0) this.removeStaff(this.staff.length - 1);
    music.stop();
    commands.current = null;
    disposeSubtree(this.scene);
    this.renderer.dispose();
  }

  private resize = (): void => {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  /* -------------------------------------------------------------- babies */

  private spawnBaby(species: Species, options: { quietly?: boolean } = {}): void {
    const id = `baby-${this.nextBabyId}`;
    const model = buildBaby(species);
    model.body.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = false;
        child.userData.babyId = id;
      }
    });
    this.scene.add(model.root);

    const regular = species.id === 'pip' || species.id === 'bob';
    const name = regular
      ? // The two who come back are always called the same thing. That is the
        // entire point of them.
        species.name
      : species.anomaly === 'none' || this.mode === 'rotted'
        ? BABY_NAMES[this.nextBabyId % BABY_NAMES.length]
        : '???';
    const nameTag = textLabel(name);
    model.root.add(nameTag);

    const glow = buildDreadGlow();
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.025;
    model.root.add(glow);

    // Anomalies go straight into the anomaly room, behind the barred door.
    // That is what the room is for, and it is why breaking out means something.
    // In the rotted daycare they would not all fit in the anomaly room, and
    // there would be nobody in the playroom at all.
    const room: RoomId =
      species.anomaly === 'none' || this.mode === 'rotted' ? 'play' : 'anomaly';
    const start =
      room === 'play'
        ? { x: PLACES.frontDoor.x + (Math.random() - 0.5) * 140, y: PLACES.frontDoor.y + 110 }
        : randomSpotIn('anomaly');
    const wander = randomSpotIn(room);

    const baby: BabyEntity = {
      id,
      species,
      name,
      x: start.x,
      y: start.y,
      wanderX: wander.x,
      wanderY: wander.y,
      facing: 0,
      need: null,
      wantedItemId: null,
      needAgeMs: 0,
      nextNeedMs: 5000 + Math.random() * 7000,
      drawingMs: 0,
      hasDrawing: false,
      staffRoomMs: 0,
      tickedIn: false,
      lunchSlot: null,
      asleep: false,
      bedIndex: null,
      sleepMsLeft: 0,
      wantsWaking: false,
      happiness: 100,
      carried: false,
      carriedBy: null,
      holdingHands: false,
      handHeldBy: null,
      eruption: 'none',
      eruptionMsLeft: 0,
      huntingId: null,
      model,
      bubble: null,
      bubbleFor: '',
      nameTag,
      glow,
      walkPhase: Math.random() * 6,
      net: freshTrail(start.x, start.y),
      path: [],
      searching: false,
      prop: null,
      ritualForm: null,
      room,
    };

    this.nextBabyId += 1;
    this.babies.push(baby);
    // Shift 20: nobody brought him. That is rather the point.
    if (!options.quietly) this.dropOff(species);
    this.arrivalStory(baby);
  }

  private removeBaby(baby: BabyEntity): void {
    this.scene.remove(baby.model.root);
    disposeSubtree(baby.model.root);
  }

  /**
   * Give a baby something to want, and decide *exactly* what. A hungry baby
   * does not ask for "food" — it asks for crisps, and the bubble over its head
   * shows crisps, so you are never guessing what to fetch.
   */
  private giveNeed(baby: BabyEntity): void {
    // No 'hungry' in here: nobody is hungry until lunchtime, and then
    // everybody is at once.
    const options: NeedKind[] = ['thirsty', 'bored', 'sleepy', 'sad', 'arty', 'musical', 'mathsy'];
    const need = options[Math.floor(Math.random() * options.length)];
    baby.need = need;
    baby.needAgeMs = 0;

    const kind = NEED_ITEM_KIND[need];
    if (!kind) {
      baby.wantedItemId = null;
      return;
    }

    let choices = itemsOfKind(kind);
    // A fussy monster only ever asks for food wearing its one label, which is
    // how "she only eats socks" works without a special case anywhere else.
    const fussy = baby.species.fussyAbout;
    if (fussy && kind === 'food') {
      const liked = choices.filter((item) => item.tags.includes(fussy));
      if (liked.length > 0) choices = liked;
    }
    baby.wantedItemId = choices[Math.floor(Math.random() * choices.length)].id;
  }

  /** Is this the exact thing it asked for? */
  private satisfies(baby: BabyEntity, item: Item): boolean {
    return baby.wantedItemId !== null && item.id === baby.wantedItemId;
  }

  private wantedItem(baby: BabyEntity): Item | null {
    return baby.wantedItemId ? itemById(baby.wantedItemId) : null;
  }

  private fuseLeftMs(baby: BabyEntity): number | null {
    if (baby.species.anomaly === 'none') return null;
    if (baby.need === null || baby.eruption !== 'none') return null;
    return Math.max(0, this.fuseLengthMs() - baby.needAgeMs);
  }

  /** A stronger door buys you a few more seconds, for good. */
  private fuseLengthMs(): number {
    return ANOMALY.fuseMs + (this.upgrades.strongDoor ? SHOP.strongDoorExtraMs : 0);
  }

  /* --------------------------------------------------------- the menu */

  private onPointerDown = (event: PointerEvent): void => {
    if (this.gameOver || this.dayReport) return;

    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);

    const pickable: THREE.Object3D[] = [];
    for (const baby of this.babies) {
      baby.model.body.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) pickable.push(child);
      });
    }
    for (const parent of this.queue) {
      parent.group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) pickable.push(child);
      });
    }
    for (const mess of this.messes) {
      mess.group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) pickable.push(child);
      });
    }
    if (this.lostTeddy) {
      this.lostTeddy.group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) pickable.push(child);
      });
    }
    // Only things you can actually see. The raycaster does not check this for
    // us, which is how the sock drawer was clickable before it was bought.
    // Somebody flat on the floor is the only time another grown-up is worth
    // clicking, so they only go in the list while they are down.
    for (const person of this.staff) {
      if (!person.flatModel) continue;
      person.flatModel.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.userData.target = { kind: 'player', id: String(person.seat) };
          pickable.push(child);
        }
      });
    }
    pickable.push(...this.room.clickable.filter(onScreen));

    const hit = pickFrom(this.raycaster.intersectObjects(pickable, false));
    if (!hit) {
      this.tap(null);
      return;
    }

    const babyId = hit.object.userData.babyId as string | undefined;
    if (babyId) {
      this.tap({ kind: 'baby', id: babyId });
      return;
    }
    const parentId = hit.object.userData.parentId as string | undefined;
    if (parentId) {
      this.tap({ kind: 'parent', id: parentId });
      return;
    }
    const target = hit.object.userData.target as ClickTarget | undefined;
    this.tap(target ? { ...target } : null);
  };

  /**
   * Somebody tapped something. On your own or hosting, that opens the menu
   * here; as a guest it is a request, and the menu comes back with the next
   * frame.
   */
  private tap(target: ClickTarget | null): void {
    this.me.menuTarget = target;
    this.publishSnapshot();
    if (!this.amGuest) return;
    if (target) netSession.send({ t: 'tap', kind: target.kind, id: target.id });
    else netSession.send({ t: 'closemenu' });
  }

  private babyById(id: string | undefined): BabyEntity | undefined {
    return this.babies.find((baby) => baby.id === id);
  }

  private parentById(id: string | undefined): ParentEntity | undefined {
    return this.queue.find((parent) => parent.id === id);
  }

  /** The furniture rectangle a non-baby target refers to. */
  private placeFor(kind: ClickTarget['kind']): { x: number; y: number; w: number; h: number } {
    switch (kind) {
      case 'fridge':
        return PLACES.fridge;
      case 'toybox':
        return PLACES.toybox;
      case 'cots':
        return PLACES.cots;
      case 'table':
        return PLACES.table;
      case 'bucket':
        return PLACES.bucket;
      case 'bin':
        return PLACES.bin;
      case 'mess':
        return PLACES.bucket;
      case 'register':
        return PLACES.register;
      case 'shop':
        return PLACES.shopCounter;
      case 'sockdrawer':
        return PLACES.sockDrawer;
      case 'instruments':
        return PLACES.instruments;
      case 'sums':
        return PLACES.sums;
      default:
        return PLACES.kettle;
    }
  }

  /** Where the player has to stand to act on a target. */
  private targetPosition(target: ClickTarget): { x: number; y: number } {
    if (target.kind === 'baby') {
      const baby = this.babyById(target.id);
      return baby ? { x: baby.x, y: baby.y } : { x: this.me.x, y: this.me.y };
    }
    if (target.kind === 'player') {
      const them = this.staff[Number(target.id)];
      return them ? { x: them.x, y: them.y } : { x: this.me.x, y: this.me.y };
    }
    if (target.kind === 'parent') {
      const parent = this.parentById(target.id);
      return parent ? { x: parent.x, y: parent.y } : { x: this.me.x, y: this.me.y };
    }
    if (target.kind === 'mess') {
      const mess = this.messes.find((m) => m.id === target.id);
      return mess ? { x: mess.x, y: mess.y } : { x: this.me.x, y: this.me.y };
    }
    if (target.kind === 'lostteddy') {
      return this.lostTeddy
        ? { x: this.lostTeddy.x, y: this.lostTeddy.y }
        : { x: this.me.x, y: this.me.y };
    }
    const place = this.placeFor(target.kind);
    return { x: place.x, y: place.y + place.h / 2 + 70 };
  }

  private sleepers(): number {
    return this.babies.filter((baby) => baby.asleep).length;
  }

  /**
   * Stop being a member of staff. The person's own model goes away and the
   * thing underneath comes out — but they keep their seat, their name and their
   * score, because they are still whoever was playing.
   */
  private setMonsterForm(who: Staff, on: boolean): void {
    if (who.monster === on) return;
    who.monster = on;
    who.model.body.visible = !on;

    if (on) {
      who.holding = null;
      this.setHeldModel(who, null);
      this.setMop(who, false);
      who.monsterModel = buildMonsterForm();
      who.model.root.add(who.monsterModel);
    } else if (who.monsterModel) {
      who.model.root.remove(who.monsterModel);
      disposeSubtree(who.monsterModel);
      who.monsterModel = null;
    }
  }

  /** Eaten, or back on your feet. */
  private setFlattened(who: Staff, flat: boolean): void {
    const already = who.flatModel !== null;
    if (already === flat) return;

    if (flat) {
      who.holding = null;
      this.setHeldModel(who, null);
      this.setMop(who, false);
      who.model.body.visible = false;
      who.flatModel = buildFlattened();
      who.model.root.add(who.flatModel);
    } else if (who.flatModel) {
      who.model.root.remove(who.flatModel);
      disposeSubtree(who.flatModel);
      who.flatModel = null;
      who.model.body.visible = !who.monster;
    }
  }

  /**
   * Night shift only. Anybody who has turned eats whoever they walk into, and
   * the person they ate goes flat where they stood. They get back up on their
   * own after a quarter of a minute — or straight away if one of the others is
   * brave enough to come over with the mop.
   */
  private stepEating(dt: number): void {
    const ms = dt * 1000;

    for (const who of this.staff) {
      if (!who.flatMsLeft) continue;
      who.flatMsLeft = Math.max(0, who.flatMsLeft - ms);
      if (who.flatMsLeft === 0) {
        this.setFlattened(who, false);
        who.hint = 'You are back on your feet.';
      } else {
        const left = Math.ceil(who.flatMsLeft / 1000);
        who.hint = `You have been eaten. Back up in ${left}s, or sooner if somebody mops you up.`;
      }
    }

    for (const monster of this.staff) {
      if (!monster.monster) continue;
      for (const prey of this.staff) {
        if (prey === monster || prey.flatMsLeft > 0) continue;
        if (Math.hypot(prey.x - monster.x, prey.y - monster.y) > EATING.reach) continue;

        prey.flatMsLeft = EATING.flatMs;
        this.setFlattened(prey, true);
        prey.menuTarget = null;
        prey.pending = null;
        monster.hint = `You ate ${prey.name}.`;
        music.alarm();
      }
    }
  }

  /** The lowest-numbered empty bed, or null if they are all taken. */
  private freeBed(): number | null {
    const taken = new Set(
      this.babies.filter((baby) => baby.bedIndex !== null).map((baby) => baby.bedIndex),
    );
    for (let i = 0; i < BEDS.count; i += 1) if (!taken.has(i)) return i;
    return null;
  }

  private carriedBaby(who: Staff): BabyEntity | undefined {
    return this.babies.find((baby) => baby.carried && baby.carriedBy === who.seat);
  }

  private menuFor(
    who: Staff,
    target: ClickTarget,
  ): { title: string; subtitle: string; actions: MenuAction[] } | null {
    if (target.kind === 'parent') {
      const parent = this.parentById(target.id);
      if (!parent) return null;
      const carried = this.carriedBaby(who);
      // Worked out fresh every time, because a child can be eaten *during*
      // home time, after the queue was built.
      const childHere = this.babyById(parent.babyId) !== undefined;
      const actions: MenuAction[] = [];

      if (carried) {
        actions.push({ id: `handover:${carried.id}`, label: `Hand over ${carried.name}` });
      }
      if (!childHere) {
        actions.push({
          id: 'sorry',
          label: '🧦 Give them a sock instead',
          disabledBecause: who.holding?.id === 'sock' ? undefined : 'fetch a sock from the fridge',
        });
      }
      if (actions.length === 0) {
        actions.push({
          id: 'nothing',
          label: `Fetch ${parent.babyName}`,
          disabledBecause: 'pick their child up first',
        });
      }

      return {
        title: `${parent.babyName}'s parent`,
        subtitle: childHere
          ? `They would like ${parent.babyName}, and nobody else.`
          : `${parent.babyName} is not here any more. All you can offer is a blanket.`,
        actions,
      };
    }

    if (target.kind === 'baby') {
      const baby = this.babyById(target.id);
      if (!baby) return null;

      // Once it has gone off there is exactly one thing worth doing, and it is
      // not cuddling it.
      if (baby.eruption === 'ritual') {
        return {
          title: 'THE RITUAL',
          subtitle: 'It is up in the air. It needs its nappy changing. Now.',
          actions: [{ id: 'nappy', label: '🧷 Change its nappy' }],
        };
      }
      if (baby.eruption === 'hunting' || baby.eruption === 'angry') {
        const hasSock = who.holding?.id === 'sock';
        return {
          title: 'IT IS LOOSE',
          subtitle: 'The only thing that calms it down is a sock.',
          actions: [
            {
              id: 'sock',
              label: '🧦 Give it the sock',
              disabledBecause: hasSock ? undefined : 'you are not carrying a sock',
            },
          ],
        };
      }

      if (baby.asleep) {
        return {
          title: `${baby.name} is asleep`,
          subtitle: baby.wantsWaking
            ? 'It has had enough sleep and would like its dummy.'
            : 'Fast asleep. Leave it alone for a bit.',
          actions: [
            {
              id: 'wake',
              label: '🍼 Give it its dummy',
              disabledBecause: !baby.wantsWaking
                ? 'it is still asleep'
                : who.holding?.kind === 'dummy'
                  ? undefined
                  : 'fetch a dummy from the nap corner',
            },
          ],
        };
      }

      const actions: MenuAction[] = [];
      if (baby.hasDrawing) actions.push({ id: 'takedrawing', label: '🖼️ Take their drawing' });
      if (who.holding) {
        actions.push({ id: `give:${who.holding.id}`, label: `Give it ${who.holding.name}` });
      }
      actions.push({ id: 'cuddle', label: 'Give it a cuddle' });
      const inMyHand = baby.holdingHands && baby.handHeldBy === who.seat;
      actions.push({
        id: inMyHand ? 'letgo' : 'hold',
        label: inMyHand ? 'Let go of its hand' : 'Hold its hand',
        disabledBecause: baby.carried
          ? 'you are already carrying it'
          : baby.holdingHands && !inMyHand
            ? 'somebody else has its hand'
            : undefined,
      });
      actions.push({
        id: baby.carried ? 'putdown' : 'pickup',
        label: baby.carried ? 'Put it down' : 'Pick it up',
      });

      const wanted = this.wantedItem(baby);
      let subtitle: string;
      if (baby.hasDrawing) subtitle = `${baby.species.name} — has finished a picture for you`;
      else if (baby.drawingMs > 0) subtitle = `${baby.species.name} — busy colouring`;
      else if (baby.need && wanted)
        subtitle = `${baby.species.name} — wants ${wanted.name} ${wanted.emoji}`;
      else if (baby.need) subtitle = `${baby.species.name} — ${NEED_WORD[baby.need]}`;
      else subtitle = `${baby.species.name} — happy enough for now`;

      return { title: baby.name, subtitle, actions };
    }

    const take = (kind: Item['kind']): MenuAction[] =>
      ITEMS.filter((item) => item.kind === kind).map((item) => ({
        id: `take:${item.id}`,
        label: `${item.emoji}  Take ${item.name}`,
      }));

    switch (target.kind) {
      case 'fridge':
        return {
          title: 'The fridge',
          subtitle: 'Fetch exactly the one they asked for. Socks live in here too.',
          actions: [...take('food'), ...take('drink')],
        };
      case 'toybox':
        return { title: 'The toy box', subtitle: 'For a bored monster.', actions: take('toy') };
      case 'cots': {
        const carried = this.carriedBaby(who);
        const freeBed = this.freeBed();
        const actions: MenuAction[] = [
          {
            id: 'tuckin',
            label: carried ? `🛏️  Place ${carried.name} in bed` : '🛏️  Place a monster in bed',
            disabledBecause: !carried
              ? 'pick a sleepy monster up first'
              : freeBed === null
                ? 'every bed is full'
                : undefined,
          },
          ...take('dummy'),
        ];
        return {
          title: 'The nap corner',
          subtitle: carried
            ? `Four beds, ${BEDS.count - this.sleepers()} free.`
            : 'Carry a sleepy monster over here and put it down in a bed.',
          actions,
        };
      }
      case 'table':
        return {
          title: 'The colouring table',
          subtitle: 'Give the crayons to a monster that wants to draw.',
          actions: take('crayons'),
        };
      case 'instruments':
        return {
          title: 'The music room',
          subtitle: 'For a monster that wants to make a noise.',
          actions: take('instrument'),
        };
      case 'sums':
        return {
          title: 'The maths room',
          subtitle: 'For a monster that wants to do sums.',
          actions: take('maths'),
        };
      case 'kettle':
        return {
          title: 'The staff room',
          subtitle: !this.upgrades.coffeeMachine
            ? 'The coffee machine is in bits. There is a new one in the shop.'
            : this.upgrades.teapot
              ? 'A cup of tea makes you walk faster for a whole minute.'
              : 'A cup of tea makes you walk faster for half a minute.',
          actions: [
            {
              id: 'take:tea',
              label: '☕  Make yourself a cup of tea',
              disabledBecause: this.upgrades.coffeeMachine
                ? undefined
                : 'a monster broke the machine',
            },
          ],
        };
      case 'player': {
        const them = this.staff[Number(target.id)];
        if (!them || them.flatMsLeft <= 0) return null;
        const left = Math.ceil(them.flatMsLeft / 1000);
        return {
          title: them.name,
          subtitle:
            who === them
              ? `You are the one on the floor. Up in ${left}s.`
              : `Flat on the floor. Up in ${left}s on their own.`,
          actions: [
            {
              id: `revive:${them.seat}`,
              label: '🧹  Mop them up',
              disabledBecause:
                who === them
                  ? 'you cannot mop yourself up'
                  : who.holdingMop
                    ? undefined
                    : 'fetch the mop from the bucket',
            },
          ],
        };
      }
      case 'bin':
        return {
          title: 'The bin',
          subtitle: who.holding
            ? `For ${who.holding.name} — it does not have to go back.`
            : who.holdingMop
              ? 'The mop goes back in its bucket, not in here.'
              : 'For putting back whatever you fetched and did not need.',
          actions: [
            {
              id: 'binit',
              label: who.holding ? `🗑️  Bin ${who.holding.name}` : '🗑️  Bin it',
              disabledBecause: who.holding
                ? undefined
                : who.holdingMop
                  ? 'put the mop back in the bucket instead'
                  : 'your hands are empty',
            },
          ],
        };
      case 'sockdrawer':
        return {
          title: 'The sock drawer',
          subtitle: 'Socks, right next to the room that needs them.',
          actions: [{ id: 'take:sock', label: '🧦  Take a sock' }],
        };
      case 'register': {
        const waiting = this.babies.filter((baby) => !baby.tickedIn);
        return {
          title: 'The register',
          subtitle: waiting.length
            ? `${waiting.length} still to tick in.`
            : 'Everybody who has arrived is ticked in.',
          actions: this.babies.map((baby) => ({
            id: `tick:${baby.id}`,
            label: baby.tickedIn ? `☑  ${baby.name}` : `☐  Tick in ${baby.name}`,
            disabledBecause: baby.tickedIn ? 'already ticked in' : undefined,
          })),
        };
      }
      case 'shop':
        return {
          title: 'The shop',
          subtitle: `You have ${this.coins} coins.`,
          actions: this.shopActions(),
        };
      case 'lostteddy':
        return {
          title: 'A teddy',
          subtitle: 'Face down behind the rug. It has been here a while.',
          actions: [{ id: 'findteddy', label: '🧸 Pick it up' }],
        };
      case 'mess':
        return {
          title: 'Somebody\'s lunch',
          subtitle: who.holdingMop
            ? 'Wrappers all over the floor.'
            : 'Wrappers all over the floor. You need the mop.',
          actions: [
            {
              id: `mop:${target.id}`,
              label: '🧹 Mop it up',
              disabledBecause: who.holdingMop ? undefined : 'fetch the mop from the bucket',
            },
          ],
        };
      default:
        return {
          title: 'The mop bucket',
          subtitle: who.holdingMop ? 'You already have the mop.' : 'For the mess after lunch.',
          actions: [
            {
              id: who.holdingMop ? 'putmop' : 'takemop',
              label: who.holdingMop ? 'Put the mop back' : '🧹  Take the mop',
            },
          ],
        };
    }
  }

  /** What is for sale, with everything you cannot afford greyed out. */
  private shopActions(): MenuAction[] {
    const afford = (price: number): string | undefined =>
      this.coins >= price ? undefined : `costs ${price}, you have ${this.coins}`;

    const actions: MenuAction[] = [];
    if (!this.upgrades.coffeeMachine) {
      actions.push({
        id: 'buy:coffee',
        label: `☕  A new coffee machine — ${COFFEE.price}`,
        disabledBecause: afford(COFFEE.price),
      });
    }
    actions.push(
      {
        id: 'buy:shoes',
        label: `👟  Comfy shoes — ${SHOP.shoesPrice} (you walk faster, for good)`,
        disabledBecause:
          this.upgrades.shoes >= SHOP.shoesMax
            ? 'you have all three pairs'
            : afford(SHOP.shoesPrice),
      },
      {
        id: 'buy:sockDrawer',
        label: `🧦  A sock drawer — ${SHOP.sockDrawerPrice} (socks by the anomaly room)`,
        disabledBecause: this.upgrades.sockDrawer
          ? 'already bought'
          : afford(SHOP.sockDrawerPrice),
      },
      {
        id: 'buy:strongDoor',
        label: `🚪  A stronger door — ${SHOP.strongDoorPrice} (a longer fuse)`,
        disabledBecause: this.upgrades.strongDoor
          ? 'already bought'
          : afford(SHOP.strongDoorPrice),
      },
      {
        id: 'buy:teapot',
        label: `🫖  A bigger teapot — ${SHOP.teapotPrice} (tea lasts twice as long)`,
        disabledBecause: this.upgrades.teapot ? 'already bought' : afford(SHOP.teapotPrice),
      },
      {
        id: 'buy:nicerToys',
        label: `🧸  Nicer toys — ${SHOP.nicerToysPrice} (toys cheer them up more)`,
        disabledBecause: this.upgrades.nicerToys ? 'already bought' : afford(SHOP.nicerToysPrice),
      },
    );
    return actions;
  }

  private buy(what: string): void {
    const spend = (price: number): boolean => {
      if (this.coins < price) {
        this.me.hint = `That costs ${price} coins and you have ${this.coins}.`;
        music.buzz();
        return false;
      }
      this.coins -= price;
      music.coin();
      return true;
    };

    switch (what) {
      case 'coffee':
        if (this.upgrades.coffeeMachine) return;
        if (!spend(COFFEE.price)) return;
        this.upgrades.coffeeMachine = true;
        this.me.hint = 'A new coffee machine. Tea is back on.';
        break;
      case 'shoes':
        if (this.upgrades.shoes >= SHOP.shoesMax) return;
        if (!spend(SHOP.shoesPrice)) return;
        this.upgrades.shoes += 1;
        this.me.hint = `New shoes. That is pair ${this.upgrades.shoes} of ${SHOP.shoesMax}.`;
        break;
      case 'sockDrawer':
        if (this.upgrades.sockDrawer) return;
        if (!spend(SHOP.sockDrawerPrice)) return;
        this.upgrades.sockDrawer = true;
        this.room.sockDrawer.visible = true;
        this.me.hint = 'A sock drawer, right outside the anomaly room. Much better.';
        break;
      case 'strongDoor':
        if (this.upgrades.strongDoor) return;
        if (!spend(SHOP.strongDoorPrice)) return;
        this.upgrades.strongDoor = true;
        this.me.hint = `A stronger door. You now get ${Math.round(this.fuseLengthMs() / 1000)} seconds instead of ${ANOMALY.fuseMs / 1000}.`;
        break;
      case 'teapot':
        if (this.upgrades.teapot) return;
        if (!spend(SHOP.teapotPrice)) return;
        this.upgrades.teapot = true;
        this.me.hint = 'A bigger teapot. Tea lasts twice as long now.';
        break;
      case 'nicerToys':
        if (this.upgrades.nicerToys) return;
        if (!spend(SHOP.nicerToysPrice)) return;
        this.upgrades.nicerToys = true;
        this.me.hint = 'Nicer toys. They will be much happier with those.';
        break;
      default:
        break;
    }
  }

  private chooseMenuAction(who: Staff, actionId: string): void {
    const target = who.menuTarget;
    who.menuTarget = null;
    if (!target) return;
    if (actionId === 'nothing') return;
    who.pending = { target, actionId };
  }

  /** Close enough to act? */
  private withinReach(who: Staff, target: ClickTarget): boolean {
    // Everything that moves, measured from wherever it is right now. Anything
    // missing from this list falls through to the furniture below, where
    // `placeFor` answers with the kettle for a target it does not know — so you
    // stand next to the thing you tapped and nothing ever happens.
    if (
      target.kind === 'baby' ||
      target.kind === 'parent' ||
      target.kind === 'mess' ||
      target.kind === 'lostteddy' ||
      target.kind === 'player'
    ) {
      const spot = this.targetPosition(target);
      return Math.hypot(spot.x - who.x, spot.y - who.y) <= PLAYER.reach;
    }
    const place = this.placeFor(target.kind);
    const dx = Math.max(Math.abs(who.x - place.x) - place.w / 2, 0);
    const dy = Math.max(Math.abs(who.y - place.y) - place.h / 2, 0);
    return Math.hypot(dx, dy) <= PLAYER.reach;
  }

  private performPending(who: Staff): void {
    if (!who.pending) return;
    const { target, actionId } = who.pending;
    who.pending = null;

    if (actionId.startsWith('buy:')) {
      this.buy(actionId.slice(4));
      return;
    }

    if (actionId.startsWith('tick:')) {
      const arrival = this.babyById(actionId.slice(5));
      if (!arrival || arrival.tickedIn) return;
      arrival.tickedIn = true;
      who.score.ticked += 1;
      this.coins += 5;
      const left = this.babies.filter((baby) => !baby.tickedIn).length;
      who.hint = left
        ? `${arrival.name} is on the register. ${left} to go.`
        : `${arrival.name} is on the register. Everybody is in.`;
      music.coin();
      return;
    }

    if (actionId.startsWith('take:')) {
      const item = itemById(actionId.slice(5));
      if (item.kind === 'tea') {
        if (!this.upgrades.coffeeMachine) {
          who.hint = 'The coffee machine is broken. The shop sells a new one.';
          music.buzz();
          return;
        }
        who.teaMsLeft = PLAYER.teaMs * (this.upgrades.teapot ? 2 : 1);
        who.hint = 'Tea. You can move a lot faster for the next half minute.';
        music.coin();
        return;
      }
      this.setMop(who, false);
      who.holding = item;
      this.setHeldModel(who, buildItem(item));
      who.hint = `You are carrying ${item.name}. Click a monster to give it over.`;
      return;
    }

    if (target.kind === 'parent') {
      this.handToParent(target.id, actionId);
      return;
    }

    if (actionId.startsWith('mop:')) {
      if (!who.holdingMop) return;
      const id = actionId.slice(4);
      const index = this.messes.findIndex((m) => m.id === id);
      if (index === -1) return;
      const [mess] = this.messes.splice(index, 1);
      this.scene.remove(mess.group);
      disposeSubtree(mess.group);
      this.coins += LUNCH.moppingCoins;
      who.score.tidied += 1;
      who.hint =
        this.messes.length === 0
          ? 'Floor spotless. Nicely done.'
          : `Mopped. ${this.messes.length} more to go.`;
      music.coin();
      return;
    }

    if (actionId === 'findteddy') {
      this.setLostTeddy(false);
      this.story.teddyFound = true;
      saveStory(this.story);
      this.setMop(who, false);
      who.holding = itemById('teddy');
      this.setHeldModel(who, buildItem(who.holding));
      who.hint = 'A teddy, behind the rug. Somebody has been missing this.';
      music.coin();
      return;
    }

    if (actionId === 'takemop') {
      // The mop needs both hands, so it replaces whatever you were carrying.
      who.holding = null;
      this.setHeldModel(who, null);
      this.setMop(who, true);
      who.hint = 'You have the mop. Click any mess to clean it up.';
      return;
    }

    if (actionId === 'binit') {
      if (!who.holding) {
        who.hint = 'Your hands are empty.';
        return;
      }
      const binned = who.holding.name;
      who.holding = null;
      this.setHeldModel(who, null);
      who.hint = `${binned[0].toUpperCase()}${binned.slice(1)} went in the bin. Your hands are free.`;
      music.coin();
      return;
    }

    if (actionId === 'putmop') {
      this.setMop(who, false);
      who.hint = 'Mop back in the bucket.';
      return;
    }

    if (actionId === 'tuckin') {
      const carried = this.carriedBaby(who);
      if (!carried) {
        who.hint = 'Pick a monster up first, then bring it over here.';
        return;
      }
      const bed = this.freeBed();
      if (bed === null) {
        who.hint = 'Every bed is full.';
        music.buzz();
        return;
      }
      const spot = bedPosition(bed);
      carried.carried = false;
      carried.holdingHands = false;
      carried.asleep = true;
      carried.bedIndex = bed;
      carried.sleepMsLeft = BEDS.sleepMs;
      carried.wantsWaking = false;
      carried.lunchSlot = null;
      carried.x = spot.x;
      carried.y = spot.y;
      carried.room = roomAt(spot.x, spot.y);
      // Being put down in a bed is what a sleepy one wanted all along.
      who.score.looked += 1;
      if (carried.need === 'sleepy') {
        this.meetNeed(
          carried,
          carried.species.anomaly === 'none' ? 10 : 10 * ANOMALY.payMultiplier,
          0,
          who,
        );
        carried.happiness = Math.min(100, carried.happiness + BEDS.tuckedInReward);
        who.hint = `${carried.name} is tucked up. It will want its dummy in a minute.`;
      } else {
        carried.need = null;
        carried.wantedItemId = null;
        who.hint = `${carried.name} is in bed, though it was not especially sleepy.`;
      }
      music.coin();
      return;
    }

    if (actionId.startsWith('revive:')) {
      const them = this.staff[Number(actionId.slice(7))];
      if (!them || them.flatMsLeft <= 0) return;
      if (them === who) {
        who.hint = 'You cannot mop yourself up. Sit tight.';
        return;
      }
      if (!who.holdingMop) {
        who.hint = 'You need the mop from the bucket first.';
        return;
      }
      them.flatMsLeft = 0;
      this.setFlattened(them, false);
      them.hint = `${who.name} mopped you up. You are fine.`;
      who.score.tidied += 1;
      who.hint = `${them.name} is back on their feet.`;
      music.coin();
      return;
    }

    const baby = this.babyById(target.id);
    if (!baby) return;

    if (actionId.startsWith('give:')) {
      const item = who.holding;
      if (!item) return;
      who.holding = null;
      this.setHeldModel(who, null);

      // The one thing he is looking for.
      if (baby.searching && item.id === 'teddy') {
        baby.searching = false;
        baby.happiness = 100;
        baby.nextNeedMs = BABIES.needGapMs;
        this.giveProp(baby, 'teddy');
        this.story.teddyFound = true;
        saveStory(this.story);
        this.coins += 40;
        who.hint = `${baby.name} has it back. He will not forget that.`;
        music.coin();
        return;
      }

      if (baby.need && this.satisfies(baby, item)) {
        // Crayons are a special case: it does not want to *have* them, it wants
        // to sit and draw with them for a bit and then show you the picture.
        if (item.kind === 'crayons') {
          baby.need = null;
          baby.wantedItemId = null;
          baby.needAgeMs = 0;
          baby.drawingMs = BABIES.drawingMs;
          who.score.looked += 1;
          baby.happiness = Math.min(100, baby.happiness + 8);
          who.hint = `${baby.name} is colouring. Come back for the picture.`;
          music.coin();
          return;
        }
        const cheering =
          this.upgrades.nicerToys && (item.kind === 'toy' || item.kind === 'instrument')
            ? SHOP.nicerToysBonus
            : 0;
        this.meetNeed(
          baby,
          baby.species.anomaly === 'none' ? 10 : 10 * ANOMALY.payMultiplier,
          cheering,
          who,
        );
        who.hint = `${baby.name} wanted that. Lovely.`;
        music.coin();
      } else {
        baby.happiness = Math.max(0, baby.happiness - BABIES.wrongThingPenalty);
        const wanted = this.wantedItem(baby);
        who.hint = wanted
          ? `${baby.name} did not want that — it asked for ${wanted.name} ${wanted.emoji}.`
          : `${baby.name} did not want that.`;
        music.buzz();
      }
      return;
    }

    switch (actionId) {
      case 'wake': {
        if (!baby.wantsWaking) {
          who.hint = `${baby.name} is still fast asleep.`;
          return;
        }
        if (who.holding?.kind !== 'dummy') {
          who.hint = 'You need a dummy from the nap corner.';
          return;
        }
        who.holding = null;
        this.setHeldModel(who, null);
        this.wakeUp(baby);
        who.score.looked += 1;
        this.coins += 10;
        who.hint = `${baby.name} is awake, and in a very good mood.`;
        music.coin();
        break;
      }
      case 'sock': {
        if (who.holding?.id !== 'sock') {
          who.hint = 'You need a sock from the fridge.';
          return;
        }
        who.holding = null;
        this.setHeldModel(who, null);
        this.calmDown(baby);
        this.coins += ANOMALY.sockCoins;
        who.score.brave += 1;
        who.hint = 'It took the sock and calmed right down. Back to the anomaly room with it.';
        music.coin();
        break;
      }
      case 'nappy': {
        this.calmDown(baby);
        this.coins += ANOMALY.nappyCoins;
        who.score.brave += 1;
        who.hint = 'You changed its nappy. The ritual stopped. Everyone is fine.';
        music.coin();
        break;
      }
      case 'takedrawing':
        baby.hasDrawing = false;
        // Give them a breather before they want the next thing.
        baby.nextNeedMs = BABIES.needGapMs + Math.random() * BABIES.needGapJitterMs;
        baby.happiness = Math.min(100, baby.happiness + 14);
        this.coins += BABIES.drawingCoins;
        who.score.tidied += 1;
        this.drawings += 1;
        this.pendingDrawings.push({ colour: baby.species.colour, seat: who.seat });
        who.hint = `${baby.name} gave you their drawing. It goes up on the wall at home time.`;
        music.coin();
        break;
      case 'cuddle':
        if (baby.need === 'sad') {
          who.score.looked += 1;
          this.meetNeed(baby, baby.species.anomaly === 'none' ? 8 : 8 * ANOMALY.payMultiplier, 0, who);
          who.hint = `${baby.name} feels much better.`;
          music.coin();
        } else {
          baby.happiness = Math.min(100, baby.happiness + 6);
          who.hint = `${baby.name} enjoyed that, but it wanted something else.`;
        }
        break;
      case 'hold':
        // One hand each. Letting go of your own does not let go of anybody
        // else's — another grown-up may be leading a child about.
        for (const other of this.babies) {
          if (other !== baby && other.handHeldBy === who.seat) {
            other.holdingHands = false;
            other.handHeldBy = null;
          }
        }
        baby.holdingHands = true;
        baby.handHeldBy = who.seat;
        who.hint = `${baby.name} is holding your hand and following you about.`;
        break;
      case 'letgo':
        baby.holdingHands = false;
        baby.handHeldBy = null;
        break;
      case 'pickup':
        // Only ever one child per pair of arms, and only out of arms that are
        // yours: another grown-up can be carrying somebody else.
        for (const other of this.babies) {
          if (other.carriedBy === who.seat) {
            other.carried = false;
            other.carriedBy = null;
          }
        }
        baby.carried = true;
        baby.carriedBy = who.seat;
        baby.holdingHands = false;
        who.hint = this.homeTime
          ? `You have ${baby.name}. Find their own parent.`
          : `You picked ${baby.name} up.`;
        break;
      case 'putdown':
        baby.carried = false;
        baby.carriedBy = null;
        baby.x = who.x;
        baby.y = who.y + 60;
        baby.room = roomAt(baby.x, baby.y);
        baby.wanderX = baby.x;
        baby.wanderY = baby.y;
        break;
      default:
        break;
    }
  }

  /**
   * Send a wandering child somewhere new. Most of the time that is somewhere
   * else in the playroom, but every so often it toddles off into another room
   * entirely — through the doorway, not through the wall.
   */
  private wanderSomewhere(baby: BabyEntity): void {
    // An anomaly stays in its room until it comes out of it properly.
    if (baby.species.anomaly !== 'none') {
      const spot = randomSpotIn('anomaly');
      baby.path = [];
      baby.wanderX = spot.x;
      baby.wanderY = spot.y;
      return;
    }

    const destination = WANDERABLE[Math.floor(Math.random() * WANDERABLE.length)];
    const from = roomAt(baby.x, baby.y);
    const points: Array<{ x: number; y: number }> = [];

    const out = doorwayInto(from);
    if (from !== destination && out) points.push(out);
    const into = doorwayInto(destination);
    if (from !== destination && into) points.push(into);
    points.push(randomSpotIn(destination));

    const first = points.shift();
    if (!first) return;
    baby.path = points;
    baby.wanderX = first.x;
    baby.wanderY = first.y;
  }

  /** Out of bed, back on its feet, delighted with everything. */
  private wakeUp(baby: BabyEntity): void {
    baby.asleep = false;
    baby.bedIndex = null;
    baby.sleepMsLeft = 0;
    baby.wantsWaking = false;
    baby.happiness = Math.min(100, baby.happiness + 18);
    baby.nextNeedMs = BABIES.needGapMs + Math.random() * BABIES.needGapJitterMs;
    // Put it down beside the bed rather than inside it.
    baby.y = PLACES.cots.y - 140;
    baby.wanderX = baby.x;
    baby.wanderY = baby.y;
  }

  /**
   * The night shift's admin panel. Only reachable by naming the place Monster
   * Nightcare, and it ignores every rule the daytime game has.
   */
  private admin(what: string): void {
    if (this.mode !== 'nightcare') return;

    const ordinary = SPECIES.filter((s) => s.anomaly === 'none');
    const shadows = SPECIES.filter((s) => s.anomaly === 'shadow');
    const rituals = SPECIES.filter((s) => s.anomaly === 'ritual');

    switch (what) {
      case 'coins':
        this.coins += 500;
        this.me.hint = `Money from nowhere. ${this.coins} coins.`;
        music.coin();
        break;
      case 'child':
        this.spawnBaby(ordinary[Math.floor(Math.random() * ordinary.length)]);
        this.me.hint = 'A child out of thin air.';
        break;
      case 'shadow':
        this.spawnBaby(shadows[0]);
        this.me.hint = 'You let one of the shadow ones in on purpose.';
        break;
      case 'ritual':
        this.spawnBaby(rituals[0]);
        this.me.hint = 'You let one of the toothy ones in on purpose.';
        break;
      case 'toys':
        // Everything in the building, in your hands, one after another.
        this.setMop(this.me, false);
        this.me.holding = itemById('teddy');
        this.setHeldModel(this.me, buildItem(this.me.holding));
        this.me.hint = 'Here. Have a teddy.';
        break;
      case 'drawing':
        for (const colour of [0xff5f9e, 0x7fd4a3, 0x4aa8ff]) {
          this.pendingDrawings.push({ colour, seat: this.me.seat });
        }
        this.drawings += 3;
        this.me.hint = 'Three drawings, from nobody. They go up at home time.';
        break;
      case 'mess':
        this.dropWrappers();
        break;
      case 'clean':
        this.clearMesses();
        this.me.hint = 'Spotless.';
        break;
      case 'happy':
        for (const baby of this.babies) {
          baby.happiness = 100;
          baby.tickedIn = true;
        }
        this.me.hint = 'Everybody is delighted and on the register.';
        break;
      case 'noanomalies': {
        const gone = this.babies.filter((baby) => baby.species.anomaly !== 'none');
        for (const baby of gone) {
          // Whoever was carrying it is not any more.
          baby.carried = false;
          this.removeBaby(baby);
        }
        this.babies = this.babies.filter((baby) => baby.species.anomaly === 'none');
        // Their parents have nobody to collect, so they go too. The model
        // version, not `removeParent` — that one ends the shift when the queue
        // empties, and this is the middle of the afternoon.
        for (const parent of this.queue.slice()) {
          if (!this.babyById(parent.babyId)) this.removeParentModel(parent);
        }
        this.setAnomalyDoorBroken(false);
        this.me.hint = gone.length
          ? `${gone.length} gone. Nothing left in here that shouldn't be.`
          : 'There were none in the building anyway.';
        break;
      }
      case 'calm':
        for (const baby of this.babies) if (baby.eruption !== 'none') this.calmDown(baby);
        this.me.hint = 'Everything is back in its room.';
        break;
      case 'monster': {
        const on = !this.me.monster;
        this.setMonsterForm(this.me, on);
        this.me.hint = on
          ? this.staff.length > 1
            ? 'Walk into the others to eat them.'
            : 'Nobody here to eat. Open a room and try it with friends.'
          : 'Back to normal. Everybody can get up.';
        if (!on) {
          // Nothing is left lying on the floor once you stop.
          for (const person of this.staff) {
            if (person.flatMsLeft > 0) {
              person.flatMsLeft = 0;
              this.setFlattened(person, false);
            }
          }
        }
        music.alarm();
        break;
      }
      case 'endday':
        this.dayTimeLeftMs = 1;
        this.me.hint = 'Home time, early.';
        break;
      case 'finish': {
        // Everybody goes home at once, whoever happens to be holding them.
        if (!this.homeTime) this.beginHomeTime();
        // A copy: sending somebody home takes them out of the queue.
        for (const parent of this.queue.slice()) {
          const child = this.babyById(parent.babyId);
          if (child) {
            this.verdicts.push(this.verdictFor(child));
            this.removeBaby(child);
            this.babies = this.babies.filter((other) => other !== child);
          } else {
            this.verdicts.push({
              babyName: parent.babyName,
              happy: false,
              said: 'Nobody has explained where they are.',
            });
          }
          this.removeParent(parent);
        }
        break;
      }
      case 'skipday':
        this.startDay(this.dayNumber + 1);
        for (const baby of this.babies) this.removeBaby(baby);
        this.babies = [];
        this.clearQueue();
        this.clearDroppers();
        this.me.hint = `Straight on to shift ${this.dayNumber}.`;
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------ the wire */

  private get amHost(): boolean {
    return netSession.role === 'host';
  }

  private get amGuest(): boolean {
    return netSession.role === 'guest';
  }

  private onGuestJoined(id: string): void {
    if (!this.amHost) return;
    if (this.seats.includes(id)) return;
    const seat = this.staff.length;
    this.seats[seat] = id;
    // A placeholder until they say who they are; their hello replaces it.
    this.addStaff(seat, `Helper ${seat}`, 'lsaCardigan');
    // They may have been waiting on the front screen for this.
    netSession.sendTo(id, { t: 'start' });
    this.sendLobby();
  }

  private onGuestLeft(id: string): void {
    if (!this.amHost) return;
    const seat = this.seats.indexOf(id);
    if (seat === -1) return;

    // Anything in their arms is put down where they stood rather than
    // vanishing with them.
    for (const baby of this.babies) {
      if (baby.carriedBy === seat) {
        baby.carried = false;
        baby.carriedBy = null;
      } else if (baby.carriedBy !== null && baby.carriedBy > seat) {
        baby.carriedBy -= 1;
      }
      if (baby.handHeldBy === seat) {
        baby.holdingHands = false;
        baby.handHeldBy = null;
      } else if (baby.handHeldBy !== null && baby.handHeldBy > seat) {
        baby.handHeldBy -= 1;
      }
    }
    this.removeStaff(seat);
    this.seats.splice(seat, 1);
    this.sendLobby();
  }

  /**
   * Two people can pick the same person to be, and two identical rows on the
   * board help nobody.
   */
  private uniqueStaffName(wanted: string, seat: number): string {
    const taken = (name: string): boolean =>
      this.staff.some((person) => person.seat !== seat && person.name === name);
    if (!taken(wanted)) return wanted;
    for (let n = 2; n < 10; n += 1) {
      const tried = `${wanted} ${n}`;
      if (!taken(tried)) return tried;
    }
    return wanted;
  }

  private sendLobby(): void {
    if (!this.amHost) return;
    netSession.send({
      t: 'lobby',
      names: this.staff.map((person) => person.name),
      full: netSession.isFull,
    });
  }

  private onNetMessage(message: NetMessage, from: string): void {
    if (this.amGuest) {
      if (message.t === 'frame') this.applyFrame(message);
      // The host's reply to our hello says which seat we are sitting in, and
      // therefore which of the people on screen the camera should follow.
      if (message.t === 'hello' && typeof message.seat === 'number') this.mySeat = message.seat;
      return;
    }
    if (!this.amHost) return;

    const seat = this.seats.indexOf(from);
    const who = seat === -1 ? undefined : this.staff[seat];
    if (!who) return;

    switch (message.t) {
      case 'hello':
        who.name = this.uniqueStaffName(message.name.slice(0, 14) || `Helper ${seat}`, seat);
        who.skin = message.skin;
        // Rebuild them as whoever they said they were.
        this.scene.remove(who.model.root);
        disposeSubtree(who.model.root);
        who.model = buildPlayer(who.skin);
        who.model.root.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) child.castShadow = true;
        });
        this.scene.add(who.model.root);
        who.heldModel = null;
        who.mopModel = null;
        netSession.sendTo(from, { t: 'hello', name: this.me.name, skin: this.me.skin, seat });
        this.sendLobby();
        break;
      case 'input':
        who.remoteMove = { x: message.x, y: message.y };
        break;
      case 'tap':
        who.menuTarget = { kind: message.kind as ClickTarget['kind'], id: message.id };
        break;
      case 'act':
        this.chooseMenuAction(who, message.actionId);
        break;
      case 'closemenu':
        who.menuTarget = null;
        break;
      default:
        break;
    }
  }

  /** The host's picture of the building, as one particular guest needs it. */
  private frameFor(seat: number): FrameMessage {
    const staff: StaffFrame[] = this.staff.map((person) => ({
      seat: person.seat,
      name: person.name,
      skin: person.skin,
      x: Math.round(person.x),
      y: Math.round(person.y),
      facing: Math.round(person.facing * 100) / 100,
      item: person.holding?.id ?? null,
      mop: person.holdingMop,
      monster: person.monster,
      flat: person.flatMsLeft > 0,
    }));

    const babies: BabyFrame[] = this.babies.map((baby) => ({
      id: baby.id,
      species: baby.species.id,
      name: baby.name,
      x: Math.round(baby.x),
      y: Math.round(baby.y),
      facing: Math.round(baby.facing * 100) / 100,
      asleep: baby.asleep,
      carried: baby.carried,
      bed: baby.bedIndex,
      eruption: baby.eruption,
      bubble: baby.bubbleFor.split('|')[0] ?? '',
      urgent: baby.bubbleFor.endsWith('true'),
      glow: (baby.glow.material as THREE.MeshBasicMaterial).opacity,
    }));

    return {
      t: 'frame',
      hud: this.snapshotFor(this.staff[seat]),
      staff,
      babies,
      messes: this.messes.map((mess) => ({ id: mess.id, x: mess.x, y: mess.y })),
      teddy: this.lostTeddy ? { x: this.lostTeddy.x, y: this.lostTeddy.y } : null,
      parents: this.queue.map((parent) => ({
        id: parent.id,
        x: parent.x,
        y: parent.y,
        species: parent.species.id,
        babyName: parent.babyName,
      })),
      wall: this.wallKey,
      doorBroken: this.room.anomalyDoor.rotation.z !== 0,
      dread: 1 - this.ambient.intensity / 0.78,
    };
  }

  /**
   * A guest draws the host's building. There is no simulation on this side at
   * all: everything here is reconciling what is on screen with the picture
   * that just arrived, which is why the two can never disagree.
   */
  private applyFrame(frame: FrameMessage): void {
    this.latestFrame = frame;
    this.lastHostWordAt = performance.now();

    // --- the grown-ups
    while (this.staff.length > frame.staff.length) this.removeStaff(this.staff.length - 1);
    frame.staff.forEach((person, seat) => {
      let member = this.staff[seat];
      const fresh = !member || member.skin !== person.skin;
      if (fresh) {
        if (member) this.removeStaff(seat);
        member = this.addStaff(seat, person.name, person.skin);
      }
      member.name = person.name;
      if (fresh) {
        member.net = freshTrail(person.x, person.y, person.facing);
        member.x = person.x;
        member.y = person.y;
        member.facing = person.facing;
      } else {
        pushTrail(member.net, person.x, person.y, person.facing);
      }

      this.setMonsterForm(member, person.monster);
      this.setFlattened(member, person.flat);

      const wantedItem = person.item ?? (person.mop ? 'mop' : null);
      const haveItem = member.holding?.id ?? (member.holdingMop ? 'mop' : null);
      if (wantedItem !== haveItem) {
        this.setMop(member, person.mop);
        if (person.item) {
          member.holding = itemById(person.item);
          this.setHeldModel(member, buildItem(member.holding));
        } else {
          member.holding = null;
          this.setHeldModel(member, null);
        }
      }
    });

    // --- the children
    const seen = new Set(frame.babies.map((baby) => baby.id));
    for (const baby of this.babies.slice()) {
      if (!seen.has(baby.id)) {
        this.removeBaby(baby);
        this.babies = this.babies.filter((other) => other !== baby);
      }
    }
    for (const incoming of frame.babies) {
      let baby = this.babyById(incoming.id);
      const justArrived = !baby;
      if (!baby) {
        this.spawnBaby(speciesById(incoming.species), { quietly: true });
        baby = this.babies[this.babies.length - 1];
        baby.id = incoming.id;
        baby.model.body.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) child.userData.babyId = incoming.id;
        });
      }
      baby.name = incoming.name;
      if (justArrived) {
        baby.net = freshTrail(incoming.x, incoming.y, incoming.facing);
        baby.x = incoming.x;
        baby.y = incoming.y;
        baby.facing = incoming.facing;
      } else {
        pushTrail(baby.net, incoming.x, incoming.y, incoming.facing);
      }
      baby.asleep = incoming.asleep;
      baby.carried = incoming.carried;
      baby.bedIndex = incoming.bed;
      baby.eruption = incoming.eruption as Baby['eruption'];
      (baby.glow.material as THREE.MeshBasicMaterial).opacity = incoming.glow;

      const key = `${incoming.bubble}|${incoming.urgent}`;
      if (key !== baby.bubbleFor) {
        if (baby.bubble) {
          baby.model.root.remove(baby.bubble);
          baby.bubble.material.map?.dispose();
          baby.bubble.material.dispose();
          baby.bubble = null;
        }
        if (incoming.bubble) {
          const bubble = thoughtBubble(incoming.bubble, incoming.urgent);
          bubble.position.set(0.46, baby.model.bubbleHeight, 0);
          baby.model.root.add(bubble);
          baby.bubble = bubble;
        }
        baby.bubbleFor = key;
      }
    }

    // --- the floor, the door, the wall and the parents at the door
    const messIds = new Set(frame.messes.map((mess) => mess.id));
    for (const mess of this.messes.slice()) {
      if (!messIds.has(mess.id)) {
        this.scene.remove(mess.group);
        disposeSubtree(mess.group);
        this.messes = this.messes.filter((other) => other !== mess);
      }
    }
    for (const incoming of frame.messes) {
      if (this.messes.some((mess) => mess.id === incoming.id)) continue;
      const group = buildMess(this.messes.length + 1);
      group.position.set(kx(incoming.x), 0, kz(incoming.y));
      group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.userData.target = { kind: 'mess', id: incoming.id };
        }
      });
      this.scene.add(group);
      this.messes.push({ id: incoming.id, x: incoming.x, y: incoming.y, group });
    }

    if (Boolean(this.lostTeddy) !== Boolean(frame.teddy)) this.setLostTeddy(Boolean(frame.teddy));
    // Things the host bought are in the host's building, which is the one
    // everybody is standing in.
    this.upgrades = { ...frame.hud.upgrades };
    this.room.sockDrawer.visible = frame.hud.upgrades.sockDrawer;
    this.setAnomalyDoorBroken(frame.doorBroken);

    if (frame.wall !== this.wallKey) {
      this.wallItems = decodeWall(frame.wall);
      this.rebuildWall();
    }

    const parentIds = new Set(frame.parents.map((parent) => parent.id));
    for (const parent of this.queue.slice()) {
      if (!parentIds.has(parent.id)) this.removeParentModel(parent);
    }
    for (const incoming of frame.parents) {
      if (this.queue.some((parent) => parent.id === incoming.id)) continue;
      const species = speciesById(incoming.species);
      const group = buildParent(species.shape === 'blob' ? 'blob' : 'shaggy', species.colour);
      group.scale.setScalar(0.8);
      group.position.set(kx(incoming.x), 0, kz(incoming.y));
      group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) child.userData.parentId = incoming.id;
      });
      const nameTag = textLabel(`${incoming.babyName}'s parent`, '#7a0040');
      nameTag.position.y = 2.3;
      nameTag.scale.set(1.9, 0.48, 1);
      group.add(nameTag);
      this.scene.add(group);
      this.queue.push({
        id: incoming.id,
        babyId: '',
        babyName: incoming.babyName,
        species,
        x: incoming.x,
        y: incoming.y,
        group,
      });
    }

    // The building darkens for everybody, not just whoever is hosting.
    const dread = frame.dread;
    this.ambient.intensity = 0.78 - dread * 0.5;
    this.sun.intensity = 0.85 - dread * 0.55;
    (this.scene.background as THREE.Color).lerp(
      new THREE.Color(0xdff3fb).lerp(new THREE.Color(0x1a0d16), dread),
      0.3,
    );
  }

  private stepNet(ms: number): void {
    if (this.amHost) {
      this.sinceFrameMs += ms;
      if (this.sinceFrameMs < FRAME_MS) return;
      this.sinceFrameMs = 0;
      // Each guest gets their own HUD, because the menu in it is theirs.
      this.seats.forEach((id, seat) => {
        if (id) netSession.sendTo(id, this.frameFor(seat));
      });
      return;
    }

    if (!this.amGuest) return;
    this.sinceInputMs += ms;
    if (this.sinceInputMs < INPUT_MS) return;
    this.sinceInputMs = 0;
    const move = walkVector();
    netSession.send({ t: 'input', x: move.x, y: move.y });
  }

  /* ------------------------------------------------------- Wren's long game */

  /**
   * Everything that is true about a particular shift rather than about the
   * game in general. Called once, as the shift opens.
   */
  private openShiftStory(): void {
    this.setLostTeddy(this.story.teddyDropped && !this.story.teddyFound);

    this.announcerId = null;
    this.announcement = null;
    this.announcementsMade = 0;
    this.prophecy = null;
    this.nextAnnounceMs = 14_000;

    // Shift 12: the picture Pip drew of the teddy you gave him turns up on
    // your wall, and you did not put it there.
    if (this.dayNumber === STORY.pipDrawsOn && this.story.pipTeddy) {
      this.wallItems.push({ colour: 0xc08552, seat: -1, teddy: true });
      this.rebuildWall();
    }

    // Shift 20. The front door has not opened yet.
    if (this.dayNumber >= STORY.pipTruthOn && this.mode !== 'rotted') {
      this.spawnQueue = this.spawnQueue.filter((species) => species.id !== 'pip');
      this.spawnBaby(speciesById('pip'), { quietly: true });
      const pip = this.babies.find((baby) => baby.species.id === 'pip');
      if (pip) {
        const bed = bedPosition(0);
        pip.x = bed.x;
        pip.y = bed.y;
        pip.room = roomAt(bed.x, bed.y);
        pip.asleep = true;
        pip.bedIndex = 0;
        pip.sleepMsLeft = BEDS.sleepMs * 3;
        pip.tickedIn = true;
        this.giveProp(pip, 'teddy');
      }
      this.me.hint = 'The front door has not opened yet. Pip is already here.';
    }
  }

  /** Something small carried about by a particular child. */
  private giveProp(baby: BabyEntity, what: 'teddy' | 'microphone'): void {
    if (baby.prop) {
      baby.model.body.remove(baby.prop);
      disposeSubtree(baby.prop);
      baby.prop = null;
    }
    const prop = what === 'teddy' ? buildItem(itemById('teddy')) : buildMicrophone();
    prop.scale.setScalar(0.7);
    prop.position.set(0.3, 0.16, 0.24);
    baby.model.body.add(prop);
    baby.prop = prop;
  }

  /** Called as each child arrives, for the ones who are not strangers. */
  private arrivalStory(baby: BabyEntity): void {
    if (baby.species.id === 'pip') {
      // Shift 8: he turns up carrying the teddy, and he has not changed a bit.
      if (this.dayNumber >= STORY.pipRemembersOn && this.story.pipTeddy) {
        this.giveProp(baby, 'teddy');
        baby.happiness = 100;
      }
      return;
    }

    if (baby.species.id === 'bob') {
      if (this.story.bobTurned) {
        // He stopped pretending a while ago.
        this.becomeShadow(baby);
        return;
      }
      // Shift 7 onwards, if nobody went back for it, he is looking for it.
      if (
        this.dayNumber >= STORY.bobSearchesOn &&
        this.story.teddyDropped &&
        !this.story.teddyFound
      ) {
        baby.searching = true;
        baby.need = null;
        baby.wantedItemId = null;
      }
      // Shift 12 onwards, if you did go back for it, he never forgets it.
      if (this.dayNumber >= STORY.bobDecidesOn && this.story.teddyFound) {
        baby.happiness = 100;
        baby.hasDrawing = true;
      }
    }
  }

  /** Bob, finding out what he is, in front of you. */
  private becomeShadow(baby: BabyEntity): void {
    baby.searching = false;
    baby.species = { ...baby.species, anomaly: 'shadow' };
    this.scene.remove(baby.model.root);
    disposeSubtree(baby.model.root);

    const model = buildBaby(baby.species);
    model.body.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = false;
        child.userData.babyId = baby.id;
      }
    });
    model.root.add(baby.nameTag);
    model.root.add(baby.glow);
    this.scene.add(model.root);
    baby.model = model;
    baby.bubble = null;
    baby.bubbleFor = '';
    baby.prop = null;
  }

  /** Beats that happen partway through a shift rather than at the start. */
  private stepShiftStory(ms: number): void {
    // Shift 12, with the teddy still behind the rug. Bob stops pretending.
    if (
      this.dayNumber >= STORY.bobDecidesOn &&
      this.story.teddyDropped &&
      !this.story.teddyFound &&
      !this.story.bobTurned
    ) {
      const bob = this.babies.find((baby) => baby.species.id === 'bob');
      // Give it a moment, so you are watching him when his shadow changes.
      if (bob && this.dayTimeLeftMs < DAY.lengthMs - 30_000) {
        this.story.bobTurned = true;
        saveStory(this.story);
        this.becomeShadow(bob);
        this.me.hint = 'Bob has stopped looking for it.';
        music.dread();
      }
    }

    if (this.dayNumber >= STORY.microphoneOn) this.stepMicrophone(ms);
  }

  /* ----------------------------------------------------- the microphone */

  private stepMicrophone(ms: number): void {
    if (this.announcementMsLeft > 0) this.announcementMsLeft -= ms;

    // Whatever it said is about to come true.
    if (this.prophecy) {
      this.prophecyMsLeft -= ms;
      if (this.prophecyMsLeft <= 0) {
        this.fulfil(this.prophecy);
        this.prophecy = null;
      }
    }

    const announcer = this.babyById(this.announcerId ?? undefined);
    if (!announcer || announcer.eruption !== 'none') {
      const candidate = this.babies.find(
        (baby) => baby.eruption === 'none' && !baby.asleep && baby.species.anomaly === 'none',
      );
      if (!candidate) return;
      this.announcerId = candidate.id;
      this.giveProp(candidate, 'microphone');
      this.say(`${candidate.name} has found a microphone.`);
      return;
    }

    this.nextAnnounceMs -= ms;
    if (this.nextAnnounceMs > 0) return;
    this.nextAnnounceMs = 9000 + Math.random() * 5000;
    this.announcementsMade += 1;

    // It starts by narrating things that are already true, and only later
    // starts announcing things that are not true yet.
    const readyToPredict = this.announcementsMade >= 4 && this.announcementsMade % 3 === 0;
    if (readyToPredict && !this.prophecy) this.predict(announcer);
    else this.say(this.observation(announcer));
  }

  private say(line: string): void {
    this.announcement = line;
    this.announcementMsLeft = 7000;
  }

  /** Something that is already true, reported as though it mattered. */
  private observation(announcer: BabyEntity): string {
    const others = this.babies.filter((baby) => baby !== announcer);
    const someone = others[Math.floor(Math.random() * others.length)];
    const lines: string[] = [];

    if (someone) {
      lines.push(`${someone.name} just blinked.`);
      lines.push(`${someone.name} is in ${ROOMS[someone.room].name}.`);
      if (someone.asleep) lines.push(`${someone.name} is asleep. I am not.`);
      const wants = this.wantedItem(someone);
      if (wants) lines.push(`${someone.name} still wants ${wants.name}. Still.`);
      if (someone.species.anomaly !== 'none') {
        lines.push(`I am not going to say anything about ${someone.name}.`);
      }
    }
    for (const person of this.staff) {
      if (person.holding) {
        lines.push(`${person.name} is carrying ${person.holding.name}. For some reason.`);
      }
    }
    if (this.messes.length > 0) lines.push(`There are ${this.messes.length} things on the floor.`);
    if (this.lostTeddy) lines.push('There is something behind the rug.');
    lines.push(`It is shift ${this.dayNumber}. It has been shift ${this.dayNumber} all day.`);
    lines.push('I am eating a cracker.');
    lines.push('Nothing is happening.');

    return lines[Math.floor(Math.random() * lines.length)];
  }

  /** Something that is not true yet. It will be. */
  private predict(announcer: BabyEntity): void {
    const anomaly = this.babies.find(
      (baby) => baby.species.anomaly !== 'none' && baby.eruption === 'none' && baby.need === null,
    );
    if (anomaly) {
      this.prophecy = { kind: 'break', babyId: anomaly.id };
      this.prophecyMsLeft = 5000;
      this.say(`${anomaly.name} is going to want something. Quite soon.`);
      return;
    }

    const ordinary = this.babies.filter(
      (baby) => baby !== announcer && baby.need === null && !baby.asleep && baby.eruption === 'none',
    );
    const who = ordinary[Math.floor(Math.random() * ordinary.length)];
    if (who) {
      const choices = itemsOfKind('toy');
      const item = choices[Math.floor(Math.random() * choices.length)];
      this.prophecy = { kind: 'want', babyId: who.id, itemId: item.id };
      this.prophecyMsLeft = 5000;
      this.say(`${who.name} is going to want ${item.name}.`);
      return;
    }

    if (this.dayTimeLeftMs > 40_000) {
      this.prophecy = { kind: 'home' };
      this.prophecyMsLeft = 6000;
      this.say('Everyone is going home now.');
    }
  }

  private fulfil(prophecy: { kind: 'want' | 'break' | 'home'; babyId?: string; itemId?: string }): void {
    if (prophecy.kind === 'home') {
      this.dayTimeLeftMs = Math.min(this.dayTimeLeftMs, 1);
      return;
    }
    const baby = this.babyById(prophecy.babyId);
    if (!baby || baby.need !== null) return;
    if (prophecy.kind === 'break') {
      this.giveNeed(baby);
      return;
    }
    baby.need = 'bored';
    baby.needAgeMs = 0;
    baby.wantedItemId = prophecy.itemId ?? 'teddy';
  }

  /** Bring an erupted anomaly back down to being somebody's child again. */
  private calmDown(baby: BabyEntity): void {
    if (baby.ritualForm) {
      baby.model.root.remove(baby.ritualForm);
      disposeSubtree(baby.ritualForm);
      baby.ritualForm = null;
    }
    baby.model.body.visible = true;
    baby.eruption = 'none';
    baby.eruptionMsLeft = 0;
    baby.huntingId = null;
    baby.need = null;
    baby.wantedItemId = null;
    baby.needAgeMs = 0;
    baby.nextNeedMs = BABIES.needGapMs;
    baby.happiness = 100;
  }

  private meetNeed(baby: BabyEntity, coins: number, extraCheer = 0, by?: Staff): void {
    // Getting to an anomaly in time is the whole job. Its fuse was burning and
    // now it is not, so whatever it was about to do is not going to happen.
    if (by && baby.species.anomaly !== 'none' && baby.eruption === 'none' && baby.need !== null) {
      by.score.prevented += 1;
    }
    if (baby.need === 'hungry') baby.lunchSlot = null;
    baby.need = null;
    baby.wantedItemId = null;
    baby.needAgeMs = 0;
    baby.nextNeedMs = BABIES.needGapMs + Math.random() * BABIES.needGapJitterMs;
    baby.happiness = Math.min(100, baby.happiness + BABIES.needMetReward + extraCheer);
    this.coins += coins;
  }

  private setHeldModel(who: Staff, model: THREE.Group | null): void {
    if (who.heldModel) {
      who.model.hands.remove(who.heldModel);
      disposeSubtree(who.heldModel);
    }
    who.heldModel = model;
    if (model) who.model.hands.add(model);
  }

  /* ------------------------------------------------------- the anomalies */

  private setAnomalyDoorBroken(broken: boolean): void {
    if (broken) {
      // Off its hinges and lying on the floor, which is the only honest way to
      // draw a door that something has just come through.
      this.room.anomalyDoor.rotation.z = -Math.PI / 2.1;
      this.room.anomalyDoor.position.x = kx(DOORWAYS.anomaly.x) - 0.7;
    } else {
      this.room.anomalyDoor.rotation.set(0, 0, 0);
      this.room.anomalyDoor.position.x = kx(DOORWAYS.anomaly.x);
    }
  }

  private erupt(baby: BabyEntity): void {
    music.dread();

    if (baby.species.anomaly === 'ritual') {
      // It does not eat anybody. It rises into the air and starts the ritual —
      // and the ritual is survivable, because what it actually wants is its
      // nappy changing.
      baby.model.body.visible = false;
      const form = buildRitualForm();
      baby.model.root.add(form);
      baby.ritualForm = form;
      baby.eruption = 'ritual';
      baby.eruptionMsLeft = ANOMALY.ritualMs;
      baby.carried = false;
      baby.holdingHands = false;
      this.me.hint = 'IT IS DOING THE RITUAL. CHANGE ITS NAPPY.';
      return;
    }

    // The shadow one comes through the door of its own room, which is what the
    // room and its barred door were for.
    this.setAnomalyDoorBroken(true);
    baby.carried = false;
    baby.holdingHands = false;
    if (!this.startHunting(baby)) this.noOneLeft(baby);
    this.me.hint = 'IT BROKE THE DOOR DOWN. Get a sock from the fridge, fast.';
  }

  /** Pick somebody to walk towards. Returns false if there is nobody left. */
  private startHunting(baby: BabyEntity): boolean {
    const victims = this.babies.filter((other) => other !== baby && other.eruption === 'none');
    if (victims.length === 0) {
      baby.eruption = 'angry';
      baby.eruptionMsLeft = ANOMALY.stalkMs;
      baby.huntingId = null;
      return false;
    }
    let nearest = victims[0];
    let best = Infinity;
    for (const victim of victims) {
      const distance = Math.hypot(victim.x - baby.x, victim.y - baby.y);
      if (distance < best) {
        best = distance;
        nearest = victim;
      }
    }
    baby.eruption = 'hunting';
    baby.huntingId = nearest.id;
    baby.eruptionMsLeft = ANOMALY.stalkMs;
    return true;
  }

  private eat(hunter: BabyEntity, victim: BabyEntity): void {
    this.eaten.push({ id: victim.id, name: victim.name, species: victim.species });
    this.removeBaby(victim);
    this.babies = this.babies.filter((baby) => baby !== victim);
    music.dread();
    this.me.hint = `It ate ${victim.name}. Get a sock before it does that again.`;

    hunter.eruption = 'angry';
    hunter.huntingId = null;
    hunter.eruptionMsLeft = ANOMALY.stalkMs;
  }

  private noOneLeft(baby: BabyEntity): void {
    baby.eruption = 'angry';
    baby.eruptionMsLeft = ANOMALY.stalkMs;
    this.gameOver = {
      reason: 'There was nobody left.',
      detail:
        this.eaten.length > 0
          ? `It went looking for another child and there were none, because it had already eaten ${this.eaten.length}. The daycare is closed.`
          : 'It went looking for a child and the building was empty. The daycare is closed.',
    };
  }

  /* ----------------------------------------------------------- home time */

  private beginHomeTime(): void {
    this.homeTime = true;

    // Shift 3. Somebody's teddy is still on the floor, and nobody notices.
    if (this.dayNumber >= STORY.teddyLeftOn && !this.story.teddyDropped) {
      this.story.teddyDropped = true;
      saveStory(this.story);
      this.setLostTeddy(true);
    }
    this.clearDroppers();
    this.me.holding = null;
    this.setHeldModel(this.me, null);
    this.me.menuTarget = null;
    this.me.pending = null;

    // One parent per child who was dropped off this morning, including the
    // ones that are no longer here.
    const entries = [
      ...this.babies
        // Shift 20: everybody else's parent arrives.
        .filter(
          (baby) => !(baby.species.id === 'pip' && this.dayNumber >= STORY.pipTruthOn),
        )
        .map((baby) => ({
          id: baby.id,
          name: baby.name,
          species: baby.species,
          eaten: false,
        })),
      ...this.eaten.map((record) => ({ ...record, eaten: true })),
    ];

    entries.forEach((entry, index) => {
      const group = buildParent(
        entry.species.shape === 'blob' ? 'blob' : 'shaggy',
        entry.species.colour,
      );
      group.scale.setScalar(0.8);
      const x = PLACES.frontDoor.x - 250 + index * 160;
      const y = PLACES.frontDoor.y + 200;
      group.position.set(kx(x), 0, kz(y));
      this.scene.add(group);

      const parentId = `parent-${this.nextParentId}`;
      this.nextParentId += 1;
      group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) child.userData.parentId = parentId;
      });

      // The label is the whole puzzle: it says whose parent this is.
      const nameTag = textLabel(`${entry.name}'s parent`, '#7a0040');
      nameTag.position.y = 2.3;
      nameTag.scale.set(1.9, 0.48, 1);
      group.add(nameTag);

      this.queue.push({
        id: parentId,
        babyId: entry.id,
        babyName: entry.name,
        species: entry.species,
        x,
        y,
        group,
      });
    });

    this.me.hint = 'Home time. Carry each child to their own parent — and no swapping.';
  }

  private handToParent(parentId: string | undefined, actionId: string): void {
    const parent = this.parentById(parentId);
    if (!parent) return;

    if (actionId === 'sorry') {
      if (this.me.holding?.id !== 'sock') {
        this.me.hint = 'You need a sock from the fridge first.';
        return;
      }
      // A sock is accepted by anybody whose child is not in the building —
      // including one eaten after the parents turned up. Without this the
      // queue can reach a parent nobody can satisfy, and the day never ends.
      if (this.babyById(parent.babyId)) {
        this.me.hint = `They do not want a sock. ${parent.babyName} is still here.`;
        music.buzz();
        return;
      }
      this.me.holding = null;
      this.setHeldModel(this.me, null);
      this.verdicts.push({
        babyName: parent.babyName,
        happy: false,
        said: 'This is a sock. Where is my child?',
      });
      this.me.hint = `You gave ${parent.babyName}'s parent a sock. They took it very badly.`;
      music.buzz();
      this.removeParent(parent);
      return;
    }

    if (!actionId.startsWith('handover:')) return;
    const baby = this.babyById(actionId.slice('handover:'.length));
    if (!baby || !baby.carried) return;

    if (baby.id !== parent.babyId) {
      this.me.hint = `“That is not my child.” They are waiting for ${parent.babyName}.`;
      music.buzz();
      return;
    }

    const verdict = this.verdictFor(baby);
    this.verdicts.push(verdict);
    const handedBy = this.staff.find((person) => person.seat === (baby.carriedBy ?? 0));
    if (handedBy) handedBy.score.home += 1;
    if (verdict.happy) {
      this.coins += 15;
      music.coin();
    } else {
      music.buzz();
    }
    this.removeBaby(baby);
    this.babies = this.babies.filter((other) => other !== baby);
    this.me.hint = `${parent.babyName} has gone home. “${verdict.said}”`;
    this.removeParent(parent);
  }

  /** Take a parent off the screen, without ending the day. */
  private removeParentModel(parent: ParentEntity): void {
    this.scene.remove(parent.group);
    disposeSubtree(parent.group);
    this.queue = this.queue.filter((other) => other !== parent);
  }

  private removeParent(parent: ParentEntity): void {
    this.removeParentModel(parent);

    if (this.queue.length === 0) {
      this.hangTodaysDrawings();
      const earned = this.verdicts.filter((verdict) => verdict.happy).length * 15;
      this.dayReport = {
        dayNumber: this.dayNumber,
        verdicts: [...this.verdicts],
        earned,
        ...this.shiftAward(),
      };
      this.homeTime = false;
      for (const baby of this.babies) this.removeBaby(baby);
      this.babies = [];
      this.announcerId = null;
      this.announcement = null;
    }
  }

  /**
   * Every picture you were given today goes up on the playroom wall, in the
   * colour of whoever drew it, and stays there for the rest of the run.
   */
  private hangTodaysDrawings(): void {
    this.wallItems.push(...this.pendingDrawings);
    this.pendingDrawings = [];
    this.rebuildWall();
  }

  /**
   * Hang the whole wall from scratch, sorted so that each person's pictures sit
   * together behind a card with their name on it. Rebuilding rather than
   * appending is what lets the grouping survive a new picture arriving.
   */
  private rebuildWall(): void {
    this.room.pictureWall.clear();

    const bySeat = this.wallItems.slice().sort((a, b) => a.seat - b.seat);
    const shared = this.staff.length > 1;
    let slot = 0;
    let lastSeat: number | null = null;

    for (const picture of bySeat) {
      if (shared && picture.seat !== lastSeat) {
        const who = this.staff.find((person) => person.seat === picture.seat);
        this.room.pictureWall.add(
          wallPlaque(slot, who?.name ?? 'Pip', picture.seat >= 0 ? 0xffd9a0 : 0xa8d8c0),
        );
        slot += 1;
        lastSeat = picture.seat;
      }
      this.room.pictureWall.add(
        hangDrawing(slot, picture.colour, picture.teddy ? 'teddy' : undefined),
      );
      slot += 1;
    }
    this.onTheWall = slot;
    this.wallKey = encodeWall(this.wallItems);
  }

  /**
   * Employee of the shift. Only worth saying when there is more than one of
   * you, and weighted so that the frightening jobs count for more than the
   * easy ones — anybody can tick a name off a list.
   */
  private shiftAward(): { scores: StaffScore[]; employeeOfTheShift: string | null } {
    const scores: StaffScore[] = this.staff.map((person) => {
      const s = person.score;
      return {
        seat: person.seat,
        name: person.name,
        skin: person.skin,
        looked: s.looked,
        ticked: s.ticked,
        tidied: s.tidied,
        brave: s.brave,
        prevented: s.prevented,
        home: s.home,
        total:
          s.looked * 2 +
          s.ticked +
          s.tidied * 2 +
          s.brave * 6 +
          s.prevented * 4 +
          s.home * 3,
      };
    });
    scores.sort((a, b) => b.total - a.total);

    // Nobody gets it for doing nothing, and nobody gets it for a draw.
    const best = scores[0];
    const tied = scores.length > 1 && scores[1].total === best?.total;
    const winner = this.staff.length > 1 && best && best.total > 0 && !tied ? best.name : null;

    // Reset for tomorrow.
    for (const person of this.staff) {
      person.score = { looked: 0, ticked: 0, tidied: 0, brave: 0, prevented: 0, home: 0 };
    }
    return { scores, employeeOfTheShift: winner };
  }

  /** What a parent says once they have their child back. */
  private verdictFor(baby: BabyEntity): ParentVerdict {
    // Never ticking a child in is its own kind of failure, whatever sort of
    // day they had.
    if (!baby.tickedIn) {
      return {
        babyName: baby.name,
        happy: false,
        said: 'You never even put them on the register.',
      };
    }
    const happy = baby.happiness >= DAY.happyParentThreshold;
    const delighted = baby.happiness >= 90;

    const happyLines = [
      'Thank you! They had a lovely day.',
      'They are beaming. See you tomorrow.',
      'Not a single tear. Marvellous.',
    ];
    const delightedLines = [
      'They have not stopped talking about it.',
      'Best day they have ever had, apparently.',
      'Whatever you are doing, keep doing it.',
    ];
    const sadLines = [
      'They seem rather upset, actually.',
      'They have been crying. What happened?',
      'We are going to have words about this.',
    ];

    const pool = delighted ? delightedLines : happy ? happyLines : sadLines;
    // Pick from the child and how the day went rather than at random, so two
    // parents in the same queue never say the identical sentence.
    const seed =
      [...baby.id].reduce((total, character) => total + character.charCodeAt(0), 0) +
      Math.floor(baby.happiness / 10);
    return { babyName: baby.name, happy, said: pool[seed % pool.length] };
  }

  private clearQueue(): void {
    for (const parent of this.queue) {
      this.scene.remove(parent.group);
      disposeSubtree(parent.group);
    }
    this.queue = [];
  }

  /* ------------------------------------------------------- dropping off */

  private dropOff(species: Species): void {
    const shaggy = species.shape !== 'blob';
    const group = buildParent(shaggy ? 'shaggy' : 'blob', species.colour);
    group.scale.setScalar(0.9);
    const y = PLACES.frontDoor.y + 130;
    group.position.set(kx(PLACES.frontDoor.x) + (Math.random() - 0.5) * 1.2, 0, kz(y));
    this.scene.add(group);
    this.droppers.push({ group, y, waitMs: 4000 });
  }

  private clearDroppers(): void {
    for (const dropper of this.droppers) {
      this.scene.remove(dropper.group);
      disposeSubtree(dropper.group);
    }
    this.droppers = [];
  }

  /* ---------------------------------------------------------- the loop */

  private tick = (): void => {
    if (!this.running) return;
    const now = performance.now();
    // Capped, so a backgrounded tab does not come back and jump the whole day.
    const dt = Math.min((now - this.lastFrameAt) / 1000, 0.05);
    this.lastFrameAt = now;

    // One bad frame must not end the shift. Anything thrown in here used to
    // escape into the animation loop and stop it for good: the building froze,
    // the host stopped sending frames, and everybody else was told the host had
    // left when she was still sitting there. Now a frame that goes wrong is
    // skipped and the next one carries on.
    try {
      this.step(dt);
    } catch (error) {
      this.frameFaults += 1;
      if (this.frameFaults <= 3) console.error('skipped a frame:', error);
    }

    this.renderer.render(this.scene, this.camera);
    this.frame += 1;
    // Every other frame: often enough that the screen feels immediate,
    // rarely enough that React is not rebuilding the HUD sixty times a second.
    if (this.frame % 2 === 0) {
      try {
        this.publishSnapshot();
      } catch (error) {
        this.frameFaults += 1;
        if (this.frameFaults <= 3) console.error('could not draw the HUD:', error);
      }
    }
  };

  private step(dt: number): void {
    const ms = dt * 1000;
    this.stepNet(ms);

    // A guest does not simulate anything. The host is the only authority, so
    // the two buildings can never drift apart.
    if (this.amGuest) {
      // Nothing works without the host, and without this the drift correction
      // keeps dragging you back to the last place they knew about, like an
      // elastic band.
      const quietFor = performance.now() - this.lastHostWordAt;
      if (quietFor > HOST_SILENCE_MS && netSession.status !== 'connected') this.hostLeft = true;
      else if (quietFor > HOST_SILENCE_MS * 2) this.hostLeft = true;
      if (!this.hostLeft) this.stepGuestVisuals(dt);
      return;
    }

    if (this.mode === 'nightcare') this.stepEating(dt);

    if (!this.gameOver && !this.dayReport) {
      this.stepPlayer(dt, ms);
      if (!this.homeTime) {
        this.stepSpawning(ms);
        this.stepDroppers(ms, dt);
      }
      this.stepBabies(ms, dt);
      this.stepShiftStory(ms);
      this.stepDay(ms);
    }
    this.stepVisuals(dt);
  }

  private stepPlayer(dt: number, ms: number): void {
    // Seat 0 is driven by this keyboard; anybody else is driven by what they
    // last told us they were doing.
    for (const person of this.staff) {
      this.stepStaff(person, dt, ms, person === this.me ? walkVector() : person.remoteMove);
    }
  }

  private stepStaff(who: Staff, dt: number, ms: number, move: { x: number; y: number }): void {
    if (who.teaMsLeft > 0) who.teaMsLeft = Math.max(0, who.teaMsLeft - ms);

    // Flat on the floor. You stay exactly where you were eaten.
    if (who.flatMsLeft > 0) {
      who.pending = null;
      who.walkPhase = 0;
      who.model.root.position.set(kx(who.x), 0, kz(who.y));
      return;
    }

    let dx = move.x;
    let dy = move.y;

    // Walking yourself cancels any "go over there and do it" from the menu.
    if ((dx !== 0 || dy !== 0) && who.pending) who.pending = null;

    if (who.pending) {
      if (this.withinReach(who, who.pending.target)) {
        this.performPending(who);
      } else {
        const spot = this.wayTo(who, this.targetPosition(who.pending.target));
        const toX = spot.x - who.x;
        const toY = spot.y - who.y;
        const distance = Math.hypot(toX, toY);
        if (distance > 1) {
          dx = toX / distance;
          dy = toY / distance;
        }
      }
    }

    const speed =
      PLAYER.speed *
      (1 + this.upgrades.shoes * SHOP.shoesSpeedStep) *
      (who.teaMsLeft > 0 ? PLAYER.teaSpeedMultiplier : 1);

    if (dx !== 0 || dy !== 0) {
      who.facing = Math.atan2(dx, dy);
      who.walkPhase += dt * 9;
      const moved = this.moveWithCollision(
        who.x,
        who.y,
        dx * speed * dt,
        dy * speed * dt,
      );
      who.x = moved.x;
      who.y = moved.y;
    } else {
      who.walkPhase *= 0.85;
    }

    who.model.root.position.set(kx(who.x), 0, kz(who.y));
    who.model.body.rotation.y = who.facing;
    const swing = Math.sin(who.walkPhase) * 0.5;
    who.model.legs[0].rotation.x = swing;
    who.model.legs[1].rotation.x = -swing;
  }

  /**
   * Where to head for next on the way to somewhere. Every room opens off the
   * playroom, so getting anywhere is at most "out through my door, in through
   * theirs" — without this you walk straight at the wall between you and the
   * thing you tapped, and stop there forever.
   */
  private wayTo(who: Staff, destination: { x: number; y: number }): { x: number; y: number } {
    const here = roomAt(who.x, who.y);
    const there = roomAt(destination.x, destination.y);
    if (here === there) return destination;

    // Out through my door if I am in a side room, otherwise in through theirs.
    const gate = here !== 'play' ? doorwayInto(here) : doorwayInto(there);
    if (!gate) return destination;

    // Go at the gap in two moves, never one. Heading straight for a point on
    // the far side cuts the corner, and cutting the corner from the playroom
    // towards the music room takes you through the staff room — where the
    // route decides you now have to come back out again, and you pace between
    // the two forever. So: line up with the gap on this side first, and only
    // then step through it. Aiming a little way past rather than at the middle
    // matters too, or you stand in the doorway still counted as being in the
    // room you came from.
    const onTheLeft = gate.x < ROOM.width / 2;
    const step = 70;
    const playX = gate.x + (onTheLeft ? step : -step);
    const roomX = gate.x + (onTheLeft ? -step : step);

    // Aim at a part of the gap that is actually clear on both sides of it. The
    // cots stand across the bottom of the playroom, right where the shop
    // doorway opens, so aiming at the middle of that gap walks you into the
    // beds and leaves you pressed against them.
    const span = doorwaySpan(here !== 'play' ? here : there);
    const middle = gate.y;
    const choices = span
      ? [middle, span.y0 + 40, span.y1 - 40, span.y0 + 20, span.y1 - 20]
      : [middle];
    const aimY =
      choices.find((y) => !insideFurniture(playX, y) && !insideFurniture(roomX, y)) ?? middle;

    // Line up with the gap on this side first, then step through. Going at it
    // diagonally cuts the corner, and cutting the corner from the playroom
    // towards the music room takes you through the staff room — where the
    // route decides you have to come back out again, and you pace between the
    // two forever.
    const lined = Math.abs(who.y - aimY) <= 50;
    const playSide = { x: playX, y: aimY };
    const roomSide = { x: roomX, y: aimY };

    if (here !== 'play') return lined ? playSide : roomSide;
    return lined ? roomSide : playSide;
  }

  /** Axis-aligned sliding collision: try x, then y, so you slide along walls. */
  private moveWithCollision(
    x: number,
    y: number,
    dx: number,
    dy: number,
    body: { width: number; height: number } = { width: PLAYER.bodyWidth, height: PLAYER.bodyHeight },
  ): { x: number; y: number } {
    const halfW = body.width / 2;
    const halfH = body.height / 2;
    const minX = ROOM.wall + halfW;
    const maxX = ROOM.width - ROOM.wall - halfW;
    const minY = ROOM.wall + halfH + 40;
    const maxY = ROOM.depth - halfH;

    const blocked = (px: number, py: number): boolean => {
      for (const o of FURNITURE) {
        if (Math.abs(px - o.x) < o.w / 2 + halfW && Math.abs(py - o.y) < o.h / 2 + halfH) return true;
      }
      for (const w of this.walls) {
        if (Math.abs(px - w.x) < w.w / 2 + halfW && Math.abs(py - w.y) < w.h / 2 + halfH) return true;
      }
      // The anomaly room's door is not locked against *you* — it is your
      // daycare and you have the key. It is there to keep them in, and the
      // game does that by keeping them inside the room until they erupt.
      return false;
    };

    let nx = Math.min(Math.max(x + dx, minX), maxX);
    if (blocked(nx, y)) nx = x;
    let ny = Math.min(Math.max(y + dy, minY), maxY);
    if (blocked(nx, ny)) ny = y;
    return { x: nx, y: ny };
  }

  private stepSpawning(ms: number): void {
    if (this.spawnQueue.length === 0) return;
    this.nextSpawnMs -= ms;
    if (this.nextSpawnMs > 0) return;
    const species = this.spawnQueue.shift();
    if (species) this.spawnBaby(species);
    this.nextSpawnMs = 9000 + Math.random() * 6000;
  }

  private stepDroppers(ms: number, dt: number): void {
    for (let i = this.droppers.length - 1; i >= 0; i -= 1) {
      const dropper = this.droppers[i];
      dropper.waitMs -= ms;
      if (dropper.waitMs > 0) {
        dropper.group.rotation.y = Math.sin(performance.now() * 0.001 + i) * 0.12;
        continue;
      }
      dropper.y -= 110 * dt;
      dropper.group.position.z = kz(dropper.y);
      if (dropper.y < PLACES.frontDoor.y - 40) {
        this.scene.remove(dropper.group);
        disposeSubtree(dropper.group);
        this.droppers.splice(i, 1);
      }
    }
  }

  private stepBabies(ms: number, dt: number): void {
    // A copy, because eating removes a baby from the list mid-loop.
    for (const baby of this.babies.slice()) {
      // The ritual: hanging in the air, waiting for a clean nappy.
      if (baby.eruption === 'ritual') {
        baby.eruptionMsLeft -= ms;
        if (baby.eruptionMsLeft <= 0) {
          this.gameOver = {
            reason: 'The ritual finished.',
            detail:
              'It hung in the air and nobody changed its nappy. Whatever it was summoning arrived. Everyone had to go home.',
          };
        }
        continue;
      }

      // Loose in the building, walking towards somebody.
      if (baby.eruption === 'hunting') {
        // Once the parents are at the door it stops hunting. It still has to
        // be calmed with a sock, but it does not get to eat its way through
        // the queue while you are carrying children about.
        if (this.homeTime) {
          baby.eruption = 'angry';
          baby.eruptionMsLeft = ANOMALY.stalkMs;
          baby.huntingId = null;
          continue;
        }
        const victim = this.babyById(baby.huntingId ?? undefined);
        if (!victim || victim.eruption !== 'none') {
          if (!this.startHunting(baby)) this.noOneLeft(baby);
          continue;
        }
        const toX = victim.x - baby.x;
        const toY = victim.y - baby.y;
        const distance = Math.hypot(toX, toY);
        if (distance < 46) {
          this.eat(baby, victim);
        } else {
          // It walks straight at them. It has already proved it does not care
          // about doors.
          baby.x += (toX / distance) * ANOMALY.huntSpeed * dt;
          baby.y += (toY / distance) * ANOMALY.huntSpeed * dt;
          baby.facing = Math.atan2(toX, toY);
          baby.walkPhase += dt * 11;
          baby.room = roomAt(baby.x, baby.y);
        }
        continue;
      }

      // It has eaten, and is working itself up to doing it again.
      if (baby.eruption === 'angry') {
        baby.eruptionMsLeft -= ms;
        baby.walkPhase += dt * 3;
        if (baby.eruptionMsLeft <= 0 && !this.gameOver && !this.homeTime) {
          if (!this.startHunting(baby)) this.noOneLeft(baby);
        }
        continue;
      }

      // Asleep in a bed: it stays put, and after a while it wants its dummy.
      if (baby.asleep) {
        baby.sleepMsLeft -= ms;
        if (baby.sleepMsLeft <= 0) {
          baby.wantsWaking = true;
          // Left lying there wanting its dummy, it gets grumpy like anyone.
          if (baby.sleepMsLeft < -BABIES.patienceMs) {
            baby.happiness = Math.max(0, baby.happiness - BABIES.unhappyPerSecond * dt);
          }
        }
        const spot = bedPosition(baby.bedIndex ?? 0);
        baby.x = spot.x;
        baby.y = spot.y;
        baby.walkPhase += dt * 0.7;
        continue;
      }

      // Colouring: a while after you hand over the crayons, there is a picture.
      if (baby.drawingMs > 0) {
        baby.drawingMs -= ms;
        if (baby.drawingMs <= 0) {
          baby.drawingMs = 0;
          baby.hasDrawing = true;
        }
      }

      // Needs. Nobody starts wanting things once the parents have arrived.
      if (baby.need === null) {
        if (!this.homeTime && baby.drawingMs <= 0 && !baby.hasDrawing && !baby.searching) {
          baby.nextNeedMs -= ms;
          if (baby.nextNeedMs <= 0) this.giveNeed(baby);
        }
      } else {
        baby.needAgeMs += ms;
        const fuse = this.fuseLeftMs(baby);
        if (fuse !== null && fuse <= 0) {
          this.erupt(baby);
          continue;
        }
        if (baby.needAgeMs > BABIES.patienceMs) {
          baby.happiness = Math.max(0, baby.happiness - BABIES.unhappyPerSecond * dt);
        }
      }

      // Where it is.
      const carrier = baby.carriedBy === null ? undefined : this.staff[baby.carriedBy];
      if (baby.carried && carrier) {
        baby.x = carrier.x;
        baby.y = carrier.y;
        baby.room = roomAt(baby.x, baby.y);
      } else if (baby.holdingHands && baby.handHeldBy !== null && this.staff[baby.handHeldBy]) {
        // Behind whoever is actually holding its hand, not behind the host.
        const leader = this.staff[baby.handHeldBy];
        const behindX = leader.x - Math.sin(leader.facing) * 70;
        const behindY = leader.y - Math.cos(leader.facing) * 70;
        const pull = Math.min(1, dt * 4);
        this.moveBaby(baby, (behindX - baby.x) * pull, (behindY - baby.y) * pull);
      } else if (baby.lunchSlot !== null && baby.need === 'hungry') {
        // Shuffling into place in the lunch queue, then standing there
        // looking at you until it is served.
        const spot = this.lunchSpot(baby.lunchSlot);
        const toX = spot.x - baby.x;
        const toY = spot.y - baby.y;
        const distance = Math.hypot(toX, toY);
        if (distance > 16) {
          this.moveBaby(
            baby,
            (toX / distance) * BABIES.speed * 1.6 * dt,
            (toY / distance) * BABIES.speed * 1.6 * dt,
          );
          baby.facing = Math.atan2(toX, toY);
          baby.walkPhase += dt * 8;
        } else {
          baby.facing += (0 - baby.facing) * Math.min(1, dt * 5);
          baby.walkPhase += dt * 2;
        }
      } else if (baby.searching) {
        // He does not stop and look at you. He is not looking for you.
        const toX = baby.wanderX - baby.x;
        const toY = baby.wanderY - baby.y;
        const distance = Math.hypot(toX, toY);
        if (distance < 16) {
          const next = baby.path.shift();
          if (next) {
            baby.wanderX = next.x;
            baby.wanderY = next.y;
          } else {
            this.wanderSomewhere(baby);
          }
        } else {
          this.moveBaby(
            baby,
            (toX / distance) * BABIES.speed * 1.5 * dt,
            (toY / distance) * BABIES.speed * 1.5 * dt,
          );
          baby.facing = Math.atan2(toX, toY);
          baby.walkPhase += dt * 10;
        }
      } else if (baby.need !== null && baby.needAgeMs > BABIES.settleAfterMs) {
        // A baby that has been waiting a few seconds stops and looks at you,
        // which is both how a real toddler behaves and the easiest way to read
        // its face. Before that it carries on toddling about — otherwise they
        // would spend the whole day rooted to the spot and never get into any
        // of the rooms they are not supposed to be in.
        baby.facing += (0 - baby.facing) * Math.min(1, dt * 5);
        baby.walkPhase += dt * 2;
      } else {
        const toX = baby.wanderX - baby.x;
        const toY = baby.wanderY - baby.y;
        const distance = Math.hypot(toX, toY);
        if (distance < 16) {
          const next = baby.path.shift();
          if (next) {
            baby.wanderX = next.x;
            baby.wanderY = next.y;
          } else {
            this.wanderSomewhere(baby);
          }
        } else {
          this.moveBaby(
            baby,
            (toX / distance) * BABIES.speed * dt,
            (toY / distance) * BABIES.speed * dt,
          );
          baby.facing = Math.atan2(toX, toY);
          baby.walkPhase += dt * 7;
        }
      }

      // The staff room is not for monsters. Left in there long enough and the
      // coffee machine is finished.
      if (baby.room === 'staff' && !baby.carried) {
        baby.staffRoomMs += ms;
        if (baby.staffRoomMs > BABIES.staffRoomGraceMs && this.upgrades.coffeeMachine) {
          this.upgrades.coffeeMachine = false;
          this.me.hint = `${baby.name} has broken the coffee machine. A new one is in the shop.`;
          music.buzz();
        }
      } else {
        baby.staffRoomMs = 0;
      }
    }

    this.keepBabiesApart();
  }

  /** A child walking: the same rules as you, with a smaller body. */
  private moveBaby(baby: BabyEntity, dx: number, dy: number): void {
    const moved = this.moveWithCollision(baby.x, baby.y, dx, dy, {
      width: BABIES.bodyWidth,
      height: BABIES.bodyHeight,
    });
    baby.x = moved.x;
    baby.y = moved.y;
    baby.room = roomAt(baby.x, baby.y);
  }

  /**
   * Nudge babies out of each other. Without this they pile up on one spot and
   * you cannot tell whose thought bubble is whose.
   */
  private keepBabiesApart(): void {
    const minGap = 150;
    for (let i = 0; i < this.babies.length; i += 1) {
      for (let j = i + 1; j < this.babies.length; j += 1) {
        const a = this.babies[i];
        const b = this.babies[j];
        if (a.carried || b.carried) continue;
        if (a.lunchSlot !== null || b.lunchSlot !== null) continue;
        // A hunter is supposed to close in, so it ignores personal space.
        if (a.eruption !== 'none' || b.eruption !== 'none') continue;

        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= minGap) continue;
        if (distance < 0.001) {
          dx = 1;
          dy = 0;
          distance = 1;
        }
        const push = (minGap - distance) / 2;
        a.x -= (dx / distance) * push;
        a.y -= (dy / distance) * push;
        b.x += (dx / distance) * push;
        b.y += (dy / distance) * push;
      }
    }
  }

  /**
   * Lunch. Nobody is hungry all morning and then everybody is at once: they
   * stop whatever they were doing, line up, and name the one thing they want.
   */
  private beginLunch(): void {
    this.lunchtime = true;
    this.lunchMsLeft = LUNCH.windowMs;
    let slot = 0;
    for (const baby of this.babies) {
      if (baby.asleep || baby.eruption !== 'none') continue;
      baby.lunchSlot = slot;
      slot += 1;
      // Lunch does not take a child out of your arms. It used to, which meant
      // carrying one to bed and having lunch start halfway there silently put
      // it back on the floor.
      baby.drawingMs = 0;
      baby.need = 'hungry';
      baby.needAgeMs = 0;
      baby.wantedItemId = this.pickFood(baby);
    }
    this.me.hint = 'Lunchtime. They are all lining up — give each one what it asked for.';
    music.alarm();
  }

  /** One particular food, respecting whatever this one is fussy about. */
  private pickFood(baby: BabyEntity): string {
    let choices = itemsOfKind('food');
    const fussy = baby.species.fussyAbout;
    if (fussy) {
      const liked = choices.filter((item) => item.tags.includes(fussy));
      if (liked.length > 0) choices = liked;
    }
    return choices[Math.floor(Math.random() * choices.length)].id;
  }

  /** Where this one stands in the lunch queue. */
  private lunchSpot(slot: number): { x: number; y: number } {
    return { x: LUNCH.queueX + slot * LUNCH.queueSpacing, y: LUNCH.queueY };
  }

  private endLunch(): void {
    this.lunchtime = false;
    this.lunchDone = true;
    for (const baby of this.babies) baby.lunchSlot = null;
    this.dropWrappers();
  }

  /** What lunch leaves behind. */
  private dropWrappers(): void {
    const howMany = Math.max(2, Math.min(6, this.babies.length));
    for (let i = 0; i < howMany; i += 1) {
      const spot = this.clearFloorSpot();
      const id = `mess-${this.nextMessId}`;
      this.nextMessId += 1;
      const group = buildMess(this.nextMessId);
      group.position.set(kx(spot.x), 0, kz(spot.y));
      group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) child.userData.target = { kind: 'mess', id };
      });
      this.scene.add(group);
      this.messes.push({ id, x: spot.x, y: spot.y, group });
    }
    this.me.hint = 'Lunch is over and the floor is covered. Get the mop from the bucket.';
  }

  /**
   * Put Bob's teddy on the playroom floor, or take it away again. It is a real
   * object that survives from shift to shift until somebody picks it up.
   */
  private setLostTeddy(there: boolean): void {
    if (this.lostTeddy) {
      this.scene.remove(this.lostTeddy.group);
      disposeSubtree(this.lostTeddy.group);
      this.lostTeddy = null;
    }
    if (!there) return;

    // Always the same spot, so it is findable once you know to look, and
    // tucked behind the rug rather than in the middle of the floor.
    const x = 1520;
    const y = 980;
    const group = buildLostTeddy();
    group.position.set(kx(x), 0, kz(y));
    group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) child.userData.target = { kind: 'lostteddy' };
    });
    this.scene.add(group);
    this.lostTeddy = { x, y, group };
  }

  /** Somewhere in the playroom with no furniture on top of it. */
  private clearFloorSpot(): { x: number; y: number } {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const spot = randomSpotIn('play');
      const onFurniture = FURNITURE.some(
        (thing) =>
          Math.abs(spot.x - thing.x) < thing.w / 2 + 40 &&
          Math.abs(spot.y - thing.y) < thing.h / 2 + 40,
      );
      if (!onFurniture) return spot;
    }
    return randomSpotIn('play');
  }

  private clearMesses(): void {
    for (const mess of this.messes) {
      this.scene.remove(mess.group);
      disposeSubtree(mess.group);
    }
    this.messes = [];
  }

  private setMop(who: Staff, holding: boolean): void {
    who.holdingMop = holding;
    if (who.mopModel) {
      who.model.hands.remove(who.mopModel);
      disposeSubtree(who.mopModel);
      who.mopModel = null;
    }
    if (holding) {
      const mop = new THREE.Group();
      const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 0.9, 10),
        new THREE.MeshLambertMaterial({ color: 0xb08968 }),
      );
      handle.position.y = 0.45;
      mop.add(handle);
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.12, 0.14),
        new THREE.MeshLambertMaterial({ color: 0xdfe6ec }),
      );
      head.position.y = 0.02;
      mop.add(head);
      who.model.hands.add(mop);
      who.mopModel = mop;
    }
  }

  private stepDay(ms: number): void {
    if (this.homeTime) return;
    this.dayTimeLeftMs -= ms;

    if (!this.lunchDone && !this.lunchtime) {
      const gone = 1 - this.dayTimeLeftMs / DAY.lengthMs;
      if (gone >= LUNCH.startAfterFraction && this.babies.length > 0) this.beginLunch();
    } else if (this.lunchtime) {
      this.lunchMsLeft -= ms;
      const stillEating = this.babies.some(
        (baby) => baby.lunchSlot !== null && baby.need === 'hungry',
      );
      // Lunch ends when everybody has eaten, or when lunch is simply over —
      // otherwise one child you never fed would keep the day in limbo.
      if (!stillEating || this.lunchMsLeft <= 0) this.endLunch();
    }

    // A filthy floor wears everybody down.
    if (this.messes.length > LUNCH.messTolerated) {
      const over = this.messes.length - LUNCH.messTolerated;
      for (const baby of this.babies) {
        if (baby.asleep) continue;
        baby.happiness = Math.max(
          0,
          baby.happiness - LUNCH.messUnhappinessPerSecond * over * (ms / 1000),
        );
      }
    }

    if (this.dayTimeLeftMs > 0) return;
    this.dayTimeLeftMs = 0;
    this.beginHomeTime();
  }

  /**
   * A guest draws sixty times a second but is told things fourteen times a
   * second, so nothing is ever drawn straight from the wire: everything
   * chases the last thing the host said. Your own grown-up is different again
   * — they move here, immediately, and are only nudged if the host disagrees,
   * because waiting a frame for your own feet feels horrible.
   */
  private stepGuestVisuals(dt: number): void {
    const renderTime = performance.now() - INTERP_DELAY_MS;

    for (const person of this.staff) {
      let moving: boolean;
      if (person === this.me) {
        this.stepGuestSelf(person, dt);
        moving = Math.hypot(person.remoteMove.x, person.remoteMove.y) > 0;
      } else {
        const at = trailAt(person.net, renderTime);
        moving = Math.hypot(at.x - person.x, at.y - person.y) > 0.3;
        person.x = at.x;
        person.y = at.y;
        person.facing = at.facing;
      }

      if (moving) person.walkPhase += dt * 9;
      else person.walkPhase *= 0.85;

      person.model.root.position.set(kx(person.x), 0, kz(person.y));
      person.model.body.rotation.y = person.facing;
      const swing = Math.sin(person.walkPhase) * 0.5;
      person.model.legs[0].rotation.x = swing;
      person.model.legs[1].rotation.x = -swing;
    }

    for (const baby of this.babies) {
      const at = trailAt(baby.net, renderTime);
      const stirring = Math.hypot(at.x - baby.x, at.y - baby.y) > 0.3;
      baby.x = at.x;
      baby.y = at.y;
      baby.facing = at.facing;
      if (stirring) baby.walkPhase += dt * 7;
      baby.model.root.position.set(kx(baby.x), 0, kz(baby.y));
      baby.model.body.rotation.y = baby.facing;
      const swing = Math.sin(baby.walkPhase) * 0.35;
      baby.model.limbs[2].rotation.x = swing;
      baby.model.limbs[3].rotation.x = -swing;

      if (baby.asleep) {
        baby.model.root.position.y = 0.36;
        baby.model.body.rotation.x = -Math.PI / 2;
        baby.model.shadow.visible = false;
      } else if (baby.carried) {
        baby.model.body.rotation.x = 0;
        baby.model.root.position.y = 0.95;
        baby.model.shadow.visible = false;
      } else if (baby.eruption === 'ritual') {
        baby.model.body.rotation.x = 0;
        baby.model.root.position.y = 1.2 + Math.sin(performance.now() * 0.003) * 0.08;
        baby.model.root.rotation.y += dt * 1.6;
        baby.model.shadow.visible = false;
      } else {
        baby.model.body.rotation.x = 0;
        baby.model.root.position.y = 0;
        baby.model.root.rotation.y = 0;
        baby.model.shadow.visible = true;
      }
      baby.nameTag.position.y = baby.model.bubbleHeight + (baby.bubble ? 0.68 : 0.12);
    }

    if (this.me.menuTarget) {
      const spot = this.targetPosition(this.me.menuTarget);
      this.ring.visible = true;
      this.ring.position.set(kx(spot.x), 0.03, kz(spot.y));
      const scale = this.me.menuTarget.kind === 'baby' ? 1 : 1.8;
      this.ring.scale.set(scale, scale, scale);
    } else {
      this.ring.visible = false;
    }

    if (this.me.heldModel) this.me.heldModel.rotation.y += dt * 1.2;
    this.shakeFrontDoor(this.latestFrame ? Math.max(0, (this.latestFrame.dread - 0.5) * 2) : 0);
    this.stepCamera(dt);
  }

  /**
   * Your own feet, on your own machine. The host is still the authority — it
   * just gets to correct you rather than drive you, so walking never waits for
   * a round trip.
   */
  private stepGuestSelf(who: Staff, dt: number): void {
    // Eaten. Nothing we press moves us, so do not predict otherwise — the
    // correction would only drag us back and look like a glitch.
    if ((this.latestFrame?.staff[who.seat]?.flat ?? false) || who.flatModel) {
      who.remoteMove = { x: 0, y: 0 };
      return;
    }

    const move = walkVector();
    who.remoteMove = move;

    if (move.x !== 0 || move.y !== 0) {
      who.facing = Math.atan2(move.x, move.y);
      // The *host's* numbers, not ours. A guest never bought the shoes and
      // never made the tea — the host did, on their behalf — so predicting at
      // our own idea of the speed leaves us trailing, and the correction then
      // drags us forward in jerks every time a frame lands.
      const hud = this.latestFrame?.hud;
      const speed =
        PLAYER.speed *
        (1 + (hud?.upgrades.shoes ?? 0) * SHOP.shoesSpeedStep) *
        ((hud?.teaMsLeft ?? 0) > 0 ? PLAYER.teaSpeedMultiplier : 1);
      const moved = this.moveWithCollision(who.x, who.y, move.x * speed * dt, move.y * speed * dt);
      who.x = moved.x;
      who.y = moved.y;
    }

    // How far the host thinks we are from where we think we are. A long way
    // means something moved us — being carried off, or a shove — so snap;
    // a little means ordinary drift, so drift back quietly.
    const drift = Math.hypot(who.net.x - who.x, who.net.y - who.y);
    if (drift > 220) {
      who.x = who.net.x;
      who.y = who.net.y;
    } else {
      const settle = Math.min(1, dt * (move.x === 0 && move.y === 0 ? 6 : 1.5));
      who.x += (who.net.x - who.x) * settle;
      who.y += (who.net.y - who.y) * settle;
    }
  }

  /** Bubbles, wobbling, the dread glow, the camera and the room going dark. */
  private stepVisuals(dt: number): void {
    let worstFuse: number | null = null;
    let anyLoose = false;

    for (const baby of this.babies) {
      baby.model.root.position.set(kx(baby.x), 0, kz(baby.y));
      baby.model.body.rotation.y = baby.facing;

      const bob = Math.sin(baby.walkPhase) * 0.02;
      baby.model.body.position.y = bob;
      const swing = Math.sin(baby.walkPhase) * 0.35;
      baby.model.limbs[2].rotation.x = swing;
      baby.model.limbs[3].rotation.x = -swing;

      if (baby.asleep) {
        // Flat on its back on the mattress, breathing.
        baby.model.root.position.y = 0.36;
        baby.model.root.rotation.y = 0;
        baby.model.body.rotation.x = -Math.PI / 2;
        baby.model.body.position.y = 0.1 + Math.sin(baby.walkPhase) * 0.015;
        baby.model.shadow.visible = false;
      } else if (baby.eruption === 'ritual') {
        baby.model.body.rotation.x = 0;
        const risen = 1 - Math.max(0, baby.eruptionMsLeft) / ANOMALY.ritualMs;
        baby.model.root.position.y = 0.6 + risen * 1.1 + Math.sin(performance.now() * 0.003) * 0.08;
        baby.model.root.rotation.y += dt * 1.6;
        baby.model.shadow.visible = false;
      } else if (baby.carried) {
        baby.model.body.rotation.x = 0;
        baby.model.root.position.y = 0.95;
        baby.model.root.rotation.y = 0;
        baby.model.shadow.visible = false;
      } else {
        baby.model.body.rotation.x = 0;
        baby.model.root.position.y = 0;
        baby.model.root.rotation.y = 0;
        baby.model.shadow.visible = true;
      }

      const fuse = this.fuseLeftMs(baby);
      if (fuse !== null && (worstFuse === null || fuse < worstFuse)) worstFuse = fuse;
      if (baby.eruption === 'hunting' || baby.eruption === 'angry') anyLoose = true;

      // The thought bubble, rebuilt only when what it wants changes. It shows
      // the exact thing asked for, not the category.
      let wanted = '';
      if (baby.eruption === 'ritual') wanted = '🌀';
      else if (baby.eruption !== 'none') wanted = '🧦';
      else if (baby.searching) wanted = '🧸';
      else if (baby.asleep) wanted = baby.wantsWaking ? '🍼' : '💤';
      else if (baby.hasDrawing) wanted = '🖼️';
      else if (baby.drawingMs > 0) wanted = '🖍️';
      else if (baby.need) wanted = this.wantedItem(baby)?.emoji ?? NEED_EMOJI[baby.need];

      const urgent =
        (fuse !== null && fuse < ANOMALY.panicAtMs) ||
        (baby.eruption !== 'none' && !baby.asleep);
      const key = `${wanted}|${urgent}`;
      if (key !== baby.bubbleFor) {
        if (baby.bubble) {
          baby.model.root.remove(baby.bubble);
          baby.bubble.material.map?.dispose();
          baby.bubble.material.dispose();
          baby.bubble = null;
        }
        if (wanted) {
          const bubble = thoughtBubble(wanted, urgent);
          bubble.position.set(0.46, baby.model.bubbleHeight, 0);
          baby.model.root.add(bubble);
          baby.bubble = bubble;
        }
        baby.bubbleFor = key;
      }
      if (baby.bubble) {
        baby.bubble.position.y = baby.model.bubbleHeight + Math.sin(baby.walkPhase * 0.6) * 0.03;
      }
      baby.nameTag.position.y = baby.model.bubbleHeight + (baby.bubble ? 0.68 : 0.12);

      const glowMaterial = baby.glow.material as THREE.MeshBasicMaterial;
      if (baby.eruption === 'hunting' || baby.eruption === 'angry') {
        glowMaterial.opacity = 0.45 + 0.3 * Math.sin(performance.now() * 0.01);
      } else if (fuse !== null && fuse < ANOMALY.dimAtMs) {
        const closeness = 1 - fuse / ANOMALY.dimAtMs;
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() * (0.006 + closeness * 0.02));
        glowMaterial.opacity = 0.2 + closeness * 0.6 * pulse;
      } else {
        glowMaterial.opacity = 0;
      }
    }

    for (const parent of this.queue) {
      parent.group.rotation.y = Math.sin(performance.now() * 0.0012 + parent.x) * 0.1;
    }

    // The building darkens while a fuse burns, and stays dark while something
    // is loose in it.
    const fuseDread = worstFuse === null ? 0 : Math.max(0, 1 - worstFuse / ANOMALY.dimAtMs);
    const dread = anyLoose ? 1 : fuseDread;
    this.ambient.intensity += (0.78 - dread * 0.5 - this.ambient.intensity) * Math.min(1, dt * 3);
    this.sun.intensity += (0.85 - dread * 0.55 - this.sun.intensity) * Math.min(1, dt * 3);
    const target = new THREE.Color(0xdff3fb).lerp(new THREE.Color(0x1a0d16), dread);
    (this.scene.background as THREE.Color).lerp(target, Math.min(1, dt * 3));

    if (worstFuse !== null && worstFuse < ANOMALY.panicAtMs) {
      const closeness = 1 - worstFuse / ANOMALY.panicAtMs;
      const now = performance.now();
      if (now - this.lastHeartbeatAt > 700 - closeness * 400) {
        this.lastHeartbeatAt = now;
        music.heartbeat(closeness);
      }
    }

    this.shakeFrontDoor(dread > 0.5 ? (dread - 0.5) * 2 : 0);

    // The highlight ring follows whatever the menu is open on.
    if (this.me.menuTarget) {
      const spot = this.targetPosition(this.me.menuTarget);
      this.ring.visible = true;
      this.ring.position.set(kx(spot.x), 0.03, kz(spot.y));
      const scale = this.me.menuTarget.kind === 'baby' ? 1 : 1.8;
      this.ring.scale.set(scale, scale, scale);
    } else {
      this.ring.visible = false;
    }

    if (this.me.heldModel) this.me.heldModel.rotation.y += dt * 1.2;

    this.stepCamera(dt);
  }

  /**
   * The front door, rattling. It does that when something inside is about to
   * come through it — and in the rotted daycare it never stops, because
   * something always is.
   */
  private shakeFrontDoor(rattle: number): void {
    const howHard = this.lookMode === 'rotted' ? Math.max(rattle, 0.8) : rattle;
    if (howHard <= 0) {
      this.room.frontDoor.position.x = kx(PLACES.frontDoor.x);
      this.room.frontDoor.rotation.z = 0;
      return;
    }
    // Two frequencies that do not divide into each other, so it judders
    // unevenly rather than swinging like a pendulum.
    const now = performance.now();
    const shove = Math.sin(now * 0.05) * 0.6 + Math.sin(now * 0.131) * 0.4;
    this.room.frontDoor.position.x = kx(PLACES.frontDoor.x) + shove * howHard * 0.05;
    this.room.frontDoor.rotation.z = shove * howHard * 0.012;
  }

  /**
   * The camera travels with you. The focus is clamped so it never drifts far
   * outside the building, which would leave half the screen showing sky.
   */
  private stepCamera(dt: number): void {
    const halfWidth = ku(ROOM.width) / 2;
    const halfDepth = ku(ROOM.depth) / 2;
    // Enough margin that the camera does not look far past the building, but
    // not so much that you can walk off the bottom of your own screen — which
    // you could, and which made the mop bucket unreachable.
    const marginX = Math.min(halfWidth, 5.2);
    const marginZ = Math.min(halfDepth, 3.0);

    const focusX = Math.min(Math.max(kx(this.me.x), -halfWidth + marginX), halfWidth - marginX);
    const focusZ = Math.min(Math.max(kz(this.me.y), -halfDepth + marginZ), halfDepth - marginZ);

    const wanted = new THREE.Vector3(focusX, 0, focusZ).add(CAMERA_OFFSET);
    this.camera.position.lerp(wanted, Math.min(1, dt * 4));
    this.camera.lookAt(focusX, 0.6, focusZ + 0.1);
    this.sun.position.set(focusX + 5, 11, focusZ + 7);
    this.sun.target.position.set(focusX, 0, focusZ);
    this.sun.target.updateMatrixWorld();
  }

  /* ------------------------------------------------------------ snapshot */

  private screenPosition(x: number, y: number, height: number): { x: number; y: number } {
    const vector = new THREE.Vector3(kx(x), height, kz(y)).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((vector.x + 1) / 2) * rect.width,
      y: ((1 - vector.y) / 2) * rect.height,
    };
  }

  private snapshotFor(who: Staff): GameSnapshot {
    const menu = (() => {
      if (!who.menuTarget) return null;
      // `who`, not `this.me`: the options in somebody's menu depend on what
      // *they* are holding, and a guest's menu is built here on the host.
      const built = this.menuFor(who, who.menuTarget);
      if (!built) return null;
      const key = `${who.menuTarget.kind}:${who.menuTarget.id ?? ''}`;
      return { ...built, key, ...this.menuAnchor(who.menuTarget) };
    })();

    const snapshot: GameSnapshot = {
      daycareName: this.daycareName,
      mode: this.mode,
      // Only whoever opened the room gets the keys to everything.
      admin: this.mode === 'nightcare' && who.seat === 0,
      coins: this.coins,
      drawings: this.drawings,
      onTheWall: this.onTheWall,
      upgrades: { ...this.upgrades },
      dayNumber: this.dayNumber,
      dayTimeLeftMs: Math.max(0, this.dayTimeLeftMs),
      playerRoom: ROOMS[roomAt(who.x, who.y)].name,
      lunchtime: this.lunchtime,
      announcement: this.announcementMsLeft > 0 ? this.announcement : null,
      toTickIn: this.babies.filter((baby) => !baby.tickedIn).length,
      messCount: this.messes.length,
      holdingMop: who.holdingMop,
      holding: who.holding,
      teaMsLeft: who.teaMsLeft,
      babies: this.babies.map((baby) => {
        const wanted = this.wantedItem(baby);
        return {
          id: baby.id,
          name: baby.name,
          speciesName: baby.species.name,
          roomName: ROOMS[baby.room].name,
          room: baby.room,
          need: baby.need,
          wants: wanted ? { emoji: wanted.emoji, name: wanted.name } : null,
          hasDrawing: baby.hasDrawing,
          searching: baby.searching,
          tickedIn: baby.tickedIn,
          asleep: baby.asleep,
          wantsWaking: baby.wantsWaking,
          happiness: Math.round(baby.happiness),
          carried: baby.carried,
          holdingHands: baby.holdingHands,
          isAnomaly: baby.species.anomaly !== 'none',
          eruption: baby.eruption,
          fuseLeftMs: this.fuseLeftMs(baby),
          eruptionMsLeft: baby.eruption === 'none' ? null : Math.max(0, baby.eruptionMsLeft),
        };
      }),
      homeTime: this.homeTime
        ? {
            waiting: this.queue.map((parent) => ({
              id: parent.id,
              babyName: parent.babyName,
              babyEaten: this.babyById(parent.babyId) === undefined,
            })),
            doneCount: this.verdicts.length,
            totalCount: this.verdicts.length + this.queue.length,
          }
        : null,
      menu,
      dayReport: this.dayReport,
      gameOver: this.gameOver,
      hostLeft: this.hostLeft,
      // Worked out on the host, so a guest is shown the same code and the
      // same count as everybody else.
      room:
        netSession.role === 'solo'
          ? null
          : { code: netSession.roomCode, players: netSession.playerCount },
      musicOn: this.musicOn,
      hint: who.hint,
    };
    return snapshot;
  }

  /** Where a menu belongs on screen, according to *this* camera. */
  private menuAnchor(target: ClickTarget): { screenX: number; screenY: number } {
    const spot = this.targetPosition(target);
    const screen = this.screenPosition(spot.x, spot.y, target.kind === 'baby' ? 1.1 : 1.6);
    return { screenX: screen.x, screenY: screen.y };
  }

  private publishSnapshot(): void {
    if (!this.amGuest) {
      publish(this.snapshotFor(this.me));
      return;
    }
    const hud = this.latestFrame?.hud;
    if (!hud) {
      publish(this.snapshotFor(this.me));
      return;
    }
    // The host decides what is *in* a guest's menu, but where it belongs on
    // screen depends on this camera, not the host's. Sending the host's screen
    // position made the menu drift about as the host walked.
    const target = this.me.menuTarget;
    const dressed =
      hud.menu && target ? { ...hud, menu: { ...hud.menu, ...this.menuAnchor(target) } } : hud;
    publish(this.hostLeft ? { ...dressed, hostLeft: true, menu: null } : dressed);
  }
}
