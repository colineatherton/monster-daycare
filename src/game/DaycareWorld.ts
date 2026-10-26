import * as THREE from 'three';
import {
  ANOMALY,
  BABIES,
  BEDS,
  DAY,
  DOORWAYS,
  LUNCH,
  PLACES,
  PLAYER,
  ROOM,
  ROOMS,
  SHOP,
} from './config.ts';
import type { RoomId } from './config.ts';
import { kx, ku, kz, disposeSubtree } from './render/three-helpers.ts';
import {
  bedPosition,
  buildHighlightRing,
  buildMess,
  buildRoom,
  hangDrawing,
  partitionWalls,
} from './render/room.ts';
import { buildBaby, buildRitualForm, type BabyModel } from './render/monsters.ts';
import { buildParent, buildPlayer, type SkinId } from './render/player.ts';
import { buildItem, buildDreadGlow } from './render/items.ts';
import { thoughtBubble, textLabel } from './render/labels.ts';
import { ITEMS, itemById, itemsOfKind } from './data/items.ts';
import { BABY_NAMES, SPECIES } from './data/species.ts';
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

/** Where the camera sits relative to whatever it is looking at. */
const CAMERA_OFFSET = new THREE.Vector3(0, 9.0, 8.4);

/** Furniture you bump into. Room units. */
const FURNITURE = [
  PLACES.fridge,
  PLACES.toybox,
  PLACES.cots,
  PLACES.table,
  PLACES.bucket,
  PLACES.instruments,
  PLACES.sums,
  PLACES.kettle,
  PLACES.register,
];

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

interface BabyEntity extends Baby {
  model: BabyModel;
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

  private readonly room = buildRoom();
  private readonly walls = partitionWalls();
  private readonly ring = buildHighlightRing();
  private readonly ambient: THREE.AmbientLight;
  private readonly sun: THREE.DirectionalLight;

  private player!: ReturnType<typeof buildPlayer>;
  private playerX: number = PLAYER.spawnX;
  private playerY: number = PLAYER.spawnY;
  private playerFacing = 0;
  private playerWalkPhase = 0;
  private holding: Item | null = null;
  private heldModel: THREE.Group | null = null;
  private teaMsLeft = 0;

  private babies: BabyEntity[] = [];
  private nextBabyId = 1;
  /** Drawings you have been given. Kept for the pure joy of a rising number. */
  private drawings = 0;
  /** Drawings collected today, waiting to go up on the wall at home time. */
  private pendingDrawings: number[] = [];
  /** How many are already hanging up. */
  private onTheWall = 0;
  /** What you have bought at the register. */
  private upgrades: Upgrades = {
    shoes: 0,
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
  private holdingMop = false;
  private mopModel: THREE.Group | null = null;

  private menuTarget: ClickTarget | null = null;
  private pending: { target: ClickTarget; actionId: string } | null = null;
  private dayReport: { dayNumber: number; verdicts: ParentVerdict[]; earned: number } | null = null;
  private gameOver: { reason: string; detail: string } | null = null;
  private musicOn = true;
  private lastHeartbeatAt = 0;
  private hint = 'Click a monster, or click a cupboard to fetch something.';

  private disposeInput: () => void;
  private frame = 0;
  private running = true;
  private canvas: HTMLCanvasElement;

  /** Which day a fresh run starts on. `?day=3` jumps straight to the anomalies. */
  private readonly firstDay: number;

  constructor(
    canvas: HTMLCanvasElement,
    options: { daycareName: string; skin: SkinId; firstDay?: number },
  ) {
    this.canvas = canvas;
    this.daycareName = options.daycareName;
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

    this.setSkin(options.skin);
    this.startDay(this.firstDay);

    this.disposeInput = attachInput();
    commands.current = {
      chooseMenuAction: (id) => this.chooseMenuAction(id),
      selectBaby: (babyId) => {
        // The building is far bigger than the screen, so the list down the
        // side is the only way to reach a child in another room.
        if (this.babyById(babyId)) this.menuTarget = { kind: 'baby', id: babyId };
      },
      closeMenu: () => {
        this.menuTarget = null;
      },
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
    };

    music.setMuted(!this.musicOn);
    music.start();

    canvas.addEventListener('pointerdown', this.onPointerDown);

    this.resize();
    window.addEventListener('resize', this.resize);
    this.renderer.setAnimationLoop(this.tick);
  }

  /* ------------------------------------------------------------ lifecycle */

  private setSkin(skin: SkinId): void {
    if (this.player) {
      this.scene.remove(this.player.root);
      disposeSubtree(this.player.root);
    }
    this.player = buildPlayer(skin);
    this.player.root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) child.castShadow = true;
    });
    this.scene.add(this.player.root);
  }

  private startDay(day: number): void {
    this.dayNumber = day;
    this.dayTimeLeftMs = DAY.lengthMs;
    this.nextSpawnMs = 1500;
    this.homeTime = false;
    this.lunchtime = false;
    this.lunchDone = false;
    this.clearMesses();
    this.verdicts = [];
    this.eaten = [];
    this.setAnomalyDoorBroken(false);

    const ordinary = SPECIES.filter((s) => s.anomaly === 'none');
    const anomalies = SPECIES.filter((s) => s.anomaly !== 'none');

    // Day 1 and 2 have no anomalies at all. The first one turns up on day 3,
    // once you already know where everything is.
    const babyCount = Math.min(2 + (day - 1), 6);
    const anomalyCount = day < 3 ? 0 : Math.min(1 + Math.floor((day - 3) / 2), 2);

    const queue: Species[] = [];
    for (let i = 0; i < babyCount - anomalyCount; i += 1) {
      queue.push(ordinary[(i + day) % ordinary.length]);
    }
    for (let i = 0; i < anomalyCount; i += 1) {
      queue.push(anomalies[(i + day) % anomalies.length]);
    }

    for (let i = queue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    this.spawnQueue = queue;
  }

  private restart(): void {
    for (const baby of this.babies) this.removeBaby(baby);
    this.babies = [];
    this.clearDroppers();
    this.clearQueue();
    this.coins = 0;
    this.drawings = 0;
    this.pendingDrawings = [];
    this.teaMsLeft = 0;
    this.upgrades = {
      shoes: 0,
      sockDrawer: false,
      strongDoor: false,
      teapot: false,
      nicerToys: false,
    };
    this.room.sockDrawer.visible = false;
    this.room.pictureWall.clear();
    this.onTheWall = 0;
    this.gameOver = null;
    this.dayReport = null;
    this.holding = null;
    this.setHeldModel(null);
    this.playerX = PLAYER.spawnX;
    this.playerY = PLAYER.spawnY;
    this.menuTarget = null;
    this.pending = null;
    this.hint = 'Click a monster, or click a cupboard to fetch something.';
    this.startDay(this.firstDay);
  }

  dispose(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.resize);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.disposeInput();
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

  private spawnBaby(species: Species): void {
    const id = `baby-${this.nextBabyId}`;
    const model = buildBaby(species);
    model.body.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = false;
        child.userData.babyId = id;
      }
    });
    this.scene.add(model.root);

    const name =
      species.anomaly === 'none' ? BABY_NAMES[this.nextBabyId % BABY_NAMES.length] : '???';
    const nameTag = textLabel(name);
    model.root.add(nameTag);

    const glow = buildDreadGlow();
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.025;
    model.root.add(glow);

    // Anomalies go straight into the anomaly room, behind the barred door.
    // That is what the room is for, and it is why breaking out means something.
    const room: RoomId = species.anomaly === 'none' ? 'play' : 'anomaly';
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
      lunchSlot: null,
      asleep: false,
      bedIndex: null,
      sleepMsLeft: 0,
      wantsWaking: false,
      happiness: 100,
      carried: false,
      holdingHands: false,
      eruption: 'none',
      eruptionMsLeft: 0,
      huntingId: null,
      model,
      bubble: null,
      bubbleFor: '',
      nameTag,
      glow,
      walkPhase: Math.random() * 6,
      ritualForm: null,
      room,
    };

    this.nextBabyId += 1;
    this.babies.push(baby);
    this.dropOff(species);
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
    pickable.push(...this.room.clickable);

    const hit = this.raycaster.intersectObjects(pickable, false)[0];
    if (!hit) {
      this.menuTarget = null;
      return;
    }

    const babyId = hit.object.userData.babyId as string | undefined;
    if (babyId) {
      this.menuTarget = { kind: 'baby', id: babyId };
      return;
    }
    const parentId = hit.object.userData.parentId as string | undefined;
    if (parentId) {
      this.menuTarget = { kind: 'parent', id: parentId };
      return;
    }
    const target = hit.object.userData.target as ClickTarget | undefined;
    this.menuTarget = target ? { ...target } : null;
  };

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
      case 'mess':
        return PLACES.bucket;
      case 'register':
        return PLACES.register;
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
      return baby ? { x: baby.x, y: baby.y } : { x: this.playerX, y: this.playerY };
    }
    if (target.kind === 'parent') {
      const parent = this.parentById(target.id);
      return parent ? { x: parent.x, y: parent.y } : { x: this.playerX, y: this.playerY };
    }
    if (target.kind === 'mess') {
      const mess = this.messes.find((m) => m.id === target.id);
      return mess ? { x: mess.x, y: mess.y } : { x: this.playerX, y: this.playerY };
    }
    const place = this.placeFor(target.kind);
    return { x: place.x, y: place.y + place.h / 2 + 70 };
  }

  private sleepers(): number {
    return this.babies.filter((baby) => baby.asleep).length;
  }

  /** The lowest-numbered empty bed, or null if they are all taken. */
  private freeBed(): number | null {
    const taken = new Set(
      this.babies.filter((baby) => baby.bedIndex !== null).map((baby) => baby.bedIndex),
    );
    for (let i = 0; i < BEDS.count; i += 1) if (!taken.has(i)) return i;
    return null;
  }

  private carriedBaby(): BabyEntity | undefined {
    return this.babies.find((baby) => baby.carried);
  }

  private menuFor(
    target: ClickTarget,
  ): { title: string; subtitle: string; actions: MenuAction[] } | null {
    if (target.kind === 'parent') {
      const parent = this.parentById(target.id);
      if (!parent) return null;
      const carried = this.carriedBaby();
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
          disabledBecause: this.holding?.id === 'sock' ? undefined : 'fetch a sock from the fridge',
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
        const hasSock = this.holding?.id === 'sock';
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
                : this.holding?.kind === 'dummy'
                  ? undefined
                  : 'fetch a dummy from the nap corner',
            },
          ],
        };
      }

      const actions: MenuAction[] = [];
      if (baby.hasDrawing) actions.push({ id: 'takedrawing', label: '🖼️ Take their drawing' });
      if (this.holding) {
        actions.push({ id: `give:${this.holding.id}`, label: `Give it ${this.holding.name}` });
      }
      actions.push({ id: 'cuddle', label: 'Give it a cuddle' });
      actions.push({
        id: baby.holdingHands ? 'letgo' : 'hold',
        label: baby.holdingHands ? 'Let go of its hand' : 'Hold its hand',
        disabledBecause: baby.carried ? 'you are already carrying it' : undefined,
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
        const carried = this.carriedBaby();
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
          subtitle: this.upgrades.teapot
            ? 'A cup of tea makes you walk faster for a whole minute.'
            : 'A cup of tea makes you walk faster for half a minute.',
          actions: [{ id: 'take:tea', label: '☕  Make yourself a cup of tea' }],
        };
      case 'sockdrawer':
        return {
          title: 'The sock drawer',
          subtitle: 'Socks, right next to the room that needs them.',
          actions: [{ id: 'take:sock', label: '🧦  Take a sock' }],
        };
      case 'register':
        return {
          title: 'The register',
          subtitle: `You have ${this.coins} coins.`,
          actions: this.shopActions(),
        };
      case 'mess':
        return {
          title: 'Somebody\'s lunch',
          subtitle: this.holdingMop
            ? 'Wrappers all over the floor.'
            : 'Wrappers all over the floor. You need the mop.',
          actions: [
            {
              id: `mop:${target.id}`,
              label: '🧹 Mop it up',
              disabledBecause: this.holdingMop ? undefined : 'fetch the mop from the bucket',
            },
          ],
        };
      default:
        return {
          title: 'The mop bucket',
          subtitle: this.holdingMop ? 'You already have the mop.' : 'For the mess after lunch.',
          actions: [
            {
              id: this.holdingMop ? 'putmop' : 'takemop',
              label: this.holdingMop ? 'Put the mop back' : '🧹  Take the mop',
            },
          ],
        };
    }
  }

  /** What is for sale, with everything you cannot afford greyed out. */
  private shopActions(): MenuAction[] {
    const afford = (price: number): string | undefined =>
      this.coins >= price ? undefined : `costs ${price}, you have ${this.coins}`;

    const actions: MenuAction[] = [
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
    ];
    return actions;
  }

  private buy(what: string): void {
    const spend = (price: number): boolean => {
      if (this.coins < price) {
        this.hint = `That costs ${price} coins and you have ${this.coins}.`;
        music.buzz();
        return false;
      }
      this.coins -= price;
      music.coin();
      return true;
    };

    switch (what) {
      case 'shoes':
        if (this.upgrades.shoes >= SHOP.shoesMax) return;
        if (!spend(SHOP.shoesPrice)) return;
        this.upgrades.shoes += 1;
        this.hint = `New shoes. That is pair ${this.upgrades.shoes} of ${SHOP.shoesMax}.`;
        break;
      case 'sockDrawer':
        if (this.upgrades.sockDrawer) return;
        if (!spend(SHOP.sockDrawerPrice)) return;
        this.upgrades.sockDrawer = true;
        this.room.sockDrawer.visible = true;
        this.hint = 'A sock drawer, right outside the anomaly room. Much better.';
        break;
      case 'strongDoor':
        if (this.upgrades.strongDoor) return;
        if (!spend(SHOP.strongDoorPrice)) return;
        this.upgrades.strongDoor = true;
        this.hint = `A stronger door. You now get ${Math.round(this.fuseLengthMs() / 1000)} seconds instead of ${ANOMALY.fuseMs / 1000}.`;
        break;
      case 'teapot':
        if (this.upgrades.teapot) return;
        if (!spend(SHOP.teapotPrice)) return;
        this.upgrades.teapot = true;
        this.hint = 'A bigger teapot. Tea lasts twice as long now.';
        break;
      case 'nicerToys':
        if (this.upgrades.nicerToys) return;
        if (!spend(SHOP.nicerToysPrice)) return;
        this.upgrades.nicerToys = true;
        this.hint = 'Nicer toys. They will be much happier with those.';
        break;
      default:
        break;
    }
  }

  private chooseMenuAction(actionId: string): void {
    const target = this.menuTarget;
    this.menuTarget = null;
    if (!target) return;
    if (actionId === 'nothing') return;
    this.pending = { target, actionId };
  }

  /** Close enough to act? */
  private withinReach(target: ClickTarget): boolean {
    if (target.kind === 'baby' || target.kind === 'parent' || target.kind === 'mess') {
      const spot = this.targetPosition(target);
      return Math.hypot(spot.x - this.playerX, spot.y - this.playerY) <= PLAYER.reach;
    }
    const place = this.placeFor(target.kind);
    const dx = Math.max(Math.abs(this.playerX - place.x) - place.w / 2, 0);
    const dy = Math.max(Math.abs(this.playerY - place.y) - place.h / 2, 0);
    return Math.hypot(dx, dy) <= PLAYER.reach;
  }

  private performPending(): void {
    if (!this.pending) return;
    const { target, actionId } = this.pending;
    this.pending = null;

    if (actionId.startsWith('buy:')) {
      this.buy(actionId.slice(4));
      return;
    }

    if (actionId.startsWith('take:')) {
      const item = itemById(actionId.slice(5));
      if (item.kind === 'tea') {
        this.teaMsLeft = PLAYER.teaMs * (this.upgrades.teapot ? 2 : 1);
        this.hint = 'Tea. You can move a lot faster for the next half minute.';
        music.coin();
        return;
      }
      this.setMop(false);
      this.holding = item;
      this.setHeldModel(buildItem(item));
      this.hint = `You are carrying ${item.name}. Click a monster to give it over.`;
      return;
    }

    if (target.kind === 'parent') {
      this.handToParent(target.id, actionId);
      return;
    }

    if (actionId === 'takemop') {
      // The mop needs both hands, so it replaces whatever you were carrying.
      this.holding = null;
      this.setHeldModel(null);
      this.setMop(true);
      this.hint = 'You have the mop. Click any mess to clean it up.';
      return;
    }

    if (actionId === 'putmop') {
      this.setMop(false);
      this.hint = 'Mop back in the bucket.';
      return;
    }

    if (actionId === 'tuckin') {
      const carried = this.carriedBaby();
      if (!carried) {
        this.hint = 'Pick a monster up first, then bring it over here.';
        return;
      }
      const bed = this.freeBed();
      if (bed === null) {
        this.hint = 'Every bed is full.';
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
      if (carried.need === 'sleepy') {
        this.meetNeed(carried, carried.species.anomaly === 'none' ? 10 : 10 * ANOMALY.payMultiplier);
        carried.happiness = Math.min(100, carried.happiness + BEDS.tuckedInReward);
        this.hint = `${carried.name} is tucked up. It will want its dummy in a minute.`;
      } else {
        carried.need = null;
        carried.wantedItemId = null;
        this.hint = `${carried.name} is in bed, though it was not especially sleepy.`;
      }
      music.coin();
      return;
    }

    const baby = this.babyById(target.id);
    if (!baby) return;

    if (actionId.startsWith('give:')) {
      const item = this.holding;
      if (!item) return;
      this.holding = null;
      this.setHeldModel(null);

      if (baby.need && this.satisfies(baby, item)) {
        // Crayons are a special case: it does not want to *have* them, it wants
        // to sit and draw with them for a bit and then show you the picture.
        if (item.kind === 'crayons') {
          baby.need = null;
          baby.wantedItemId = null;
          baby.needAgeMs = 0;
          baby.drawingMs = BABIES.drawingMs;
          baby.happiness = Math.min(100, baby.happiness + 8);
          this.hint = `${baby.name} is colouring. Come back for the picture.`;
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
        );
        this.hint = `${baby.name} wanted that. Lovely.`;
        music.coin();
      } else {
        baby.happiness = Math.max(0, baby.happiness - BABIES.wrongThingPenalty);
        const wanted = this.wantedItem(baby);
        this.hint = wanted
          ? `${baby.name} did not want that — it asked for ${wanted.name} ${wanted.emoji}.`
          : `${baby.name} did not want that.`;
        music.buzz();
      }
      return;
    }

    if (actionId.startsWith('mop:')) {
      if (!this.holdingMop) return;
      const id = actionId.slice(4);
      const index = this.messes.findIndex((m) => m.id === id);
      if (index === -1) return;
      const [mess] = this.messes.splice(index, 1);
      this.scene.remove(mess.group);
      disposeSubtree(mess.group);
      this.coins += LUNCH.moppingCoins;
      this.hint =
        this.messes.length === 0
          ? 'Floor spotless. Nicely done.'
          : `Mopped. ${this.messes.length} more to go.`;
      music.coin();
      return;
    }

    switch (actionId) {
      case 'wake': {
        if (!baby.wantsWaking) {
          this.hint = `${baby.name} is still fast asleep.`;
          return;
        }
        if (this.holding?.kind !== 'dummy') {
          this.hint = 'You need a dummy from the nap corner.';
          return;
        }
        this.holding = null;
        this.setHeldModel(null);
        this.wakeUp(baby);
        this.coins += 10;
        this.hint = `${baby.name} is awake, and in a very good mood.`;
        music.coin();
        break;
      }
      case 'sock': {
        if (this.holding?.id !== 'sock') {
          this.hint = 'You need a sock from the fridge.';
          return;
        }
        this.holding = null;
        this.setHeldModel(null);
        this.calmDown(baby);
        this.coins += ANOMALY.sockCoins;
        this.hint = 'It took the sock and calmed right down. Back to the anomaly room with it.';
        music.coin();
        break;
      }
      case 'nappy': {
        this.calmDown(baby);
        this.coins += ANOMALY.nappyCoins;
        this.hint = 'You changed its nappy. The ritual stopped. Everyone is fine.';
        music.coin();
        break;
      }
      case 'takedrawing':
        baby.hasDrawing = false;
        // Give them a breather before they want the next thing.
        baby.nextNeedMs = BABIES.needGapMs + Math.random() * BABIES.needGapJitterMs;
        baby.happiness = Math.min(100, baby.happiness + 14);
        this.coins += BABIES.drawingCoins;
        this.drawings += 1;
        this.pendingDrawings.push(baby.species.colour);
        this.hint = `${baby.name} gave you their drawing. It goes up on the wall at home time.`;
        music.coin();
        break;
      case 'cuddle':
        if (baby.need === 'sad') {
          this.meetNeed(baby, baby.species.anomaly === 'none' ? 8 : 8 * ANOMALY.payMultiplier);
          this.hint = `${baby.name} feels much better.`;
          music.coin();
        } else {
          baby.happiness = Math.min(100, baby.happiness + 6);
          this.hint = `${baby.name} enjoyed that, but it wanted something else.`;
        }
        break;
      case 'hold':
        baby.holdingHands = true;
        for (const other of this.babies) if (other !== baby) other.holdingHands = false;
        this.hint = `${baby.name} is holding your hand and following you about.`;
        break;
      case 'letgo':
        baby.holdingHands = false;
        break;
      case 'pickup':
        for (const other of this.babies) other.carried = false;
        baby.carried = true;
        baby.holdingHands = false;
        this.hint = this.homeTime
          ? `You have ${baby.name}. Find their own parent.`
          : `You picked ${baby.name} up.`;
        break;
      case 'putdown':
        baby.carried = false;
        baby.x = this.playerX;
        baby.y = this.playerY + 60;
        baby.room = roomAt(baby.x, baby.y);
        baby.wanderX = baby.x;
        baby.wanderY = baby.y;
        break;
      default:
        break;
    }
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

  private meetNeed(baby: BabyEntity, coins: number, extraCheer = 0): void {
    if (baby.need === 'hungry') baby.lunchSlot = null;
    baby.need = null;
    baby.wantedItemId = null;
    baby.needAgeMs = 0;
    baby.nextNeedMs = BABIES.needGapMs + Math.random() * BABIES.needGapJitterMs;
    baby.happiness = Math.min(100, baby.happiness + BABIES.needMetReward + extraCheer);
    this.coins += coins;
  }

  private setHeldModel(model: THREE.Group | null): void {
    if (this.heldModel) {
      this.player.hands.remove(this.heldModel);
      disposeSubtree(this.heldModel);
    }
    this.heldModel = model;
    if (model) this.player.hands.add(model);
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
      this.hint = 'IT IS DOING THE RITUAL. CHANGE ITS NAPPY.';
      return;
    }

    // The shadow one comes through the door of its own room, which is what the
    // room and its barred door were for.
    this.setAnomalyDoorBroken(true);
    baby.carried = false;
    baby.holdingHands = false;
    if (!this.startHunting(baby)) this.noOneLeft(baby);
    this.hint = 'IT BROKE THE DOOR DOWN. Get a sock from the fridge, fast.';
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
    this.hint = `It ate ${victim.name}. Get a sock before it does that again.`;

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
    this.clearDroppers();
    this.holding = null;
    this.setHeldModel(null);
    this.menuTarget = null;
    this.pending = null;

    // One parent per child who was dropped off this morning, including the
    // ones that are no longer here.
    const entries = [
      ...this.babies.map((baby) => ({
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

    this.hint = 'Home time. Carry each child to their own parent — and no swapping.';
  }

  private handToParent(parentId: string | undefined, actionId: string): void {
    const parent = this.parentById(parentId);
    if (!parent) return;

    if (actionId === 'sorry') {
      if (this.holding?.id !== 'sock') {
        this.hint = 'You need a sock from the fridge first.';
        return;
      }
      // A sock is accepted by anybody whose child is not in the building —
      // including one eaten after the parents turned up. Without this the
      // queue can reach a parent nobody can satisfy, and the day never ends.
      if (this.babyById(parent.babyId)) {
        this.hint = `They do not want a sock. ${parent.babyName} is still here.`;
        music.buzz();
        return;
      }
      this.holding = null;
      this.setHeldModel(null);
      this.verdicts.push({
        babyName: parent.babyName,
        happy: false,
        said: 'This is a sock. Where is my child?',
      });
      this.hint = `You gave ${parent.babyName}'s parent a sock. They took it very badly.`;
      music.buzz();
      this.removeParent(parent);
      return;
    }

    if (!actionId.startsWith('handover:')) return;
    const baby = this.babyById(actionId.slice('handover:'.length));
    if (!baby || !baby.carried) return;

    if (baby.id !== parent.babyId) {
      this.hint = `“That is not my child.” They are waiting for ${parent.babyName}.`;
      music.buzz();
      return;
    }

    const verdict = this.verdictFor(baby);
    this.verdicts.push(verdict);
    if (verdict.happy) {
      this.coins += 15;
      music.coin();
    } else {
      music.buzz();
    }
    this.removeBaby(baby);
    this.babies = this.babies.filter((other) => other !== baby);
    this.hint = `${parent.babyName} has gone home. “${verdict.said}”`;
    this.removeParent(parent);
  }

  private removeParent(parent: ParentEntity): void {
    this.scene.remove(parent.group);
    disposeSubtree(parent.group);
    this.queue = this.queue.filter((other) => other !== parent);

    if (this.queue.length === 0) {
      this.hangTodaysDrawings();
      const earned = this.verdicts.filter((verdict) => verdict.happy).length * 15;
      this.dayReport = { dayNumber: this.dayNumber, verdicts: [...this.verdicts], earned };
      this.homeTime = false;
      for (const baby of this.babies) this.removeBaby(baby);
      this.babies = [];
    }
  }

  /**
   * Every picture you were given today goes up on the playroom wall, in the
   * colour of whoever drew it, and stays there for the rest of the run.
   */
  private hangTodaysDrawings(): void {
    for (const colour of this.pendingDrawings) {
      this.room.pictureWall.add(hangDrawing(this.onTheWall, colour));
      this.onTheWall += 1;
    }
    this.pendingDrawings = [];
  }

  /** What a parent says once they have their child back. */
  private verdictFor(baby: BabyEntity): ParentVerdict {
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
    this.step(dt);
    this.renderer.render(this.scene, this.camera);
    this.frame += 1;
    if (this.frame % 3 === 0) this.publishSnapshot();
  };

  private step(dt: number): void {
    const ms = dt * 1000;
    if (!this.gameOver && !this.dayReport) {
      this.stepPlayer(dt, ms);
      if (!this.homeTime) {
        this.stepSpawning(ms);
        this.stepDroppers(ms, dt);
      }
      this.stepBabies(ms, dt);
      this.stepDay(ms);
    }
    this.stepVisuals(dt);
  }

  private stepPlayer(dt: number, ms: number): void {
    if (this.teaMsLeft > 0) this.teaMsLeft = Math.max(0, this.teaMsLeft - ms);

    const keys = walkVector();
    let dx = keys.x;
    let dy = keys.y;

    // Walking yourself cancels any "go over there and do it" from the menu.
    if ((dx !== 0 || dy !== 0) && this.pending) this.pending = null;

    if (this.pending) {
      if (this.withinReach(this.pending.target)) {
        this.performPending();
      } else {
        const spot = this.targetPosition(this.pending.target);
        const toX = spot.x - this.playerX;
        const toY = spot.y - this.playerY;
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
      (this.teaMsLeft > 0 ? PLAYER.teaSpeedMultiplier : 1);

    if (dx !== 0 || dy !== 0) {
      this.playerFacing = Math.atan2(dx, dy);
      this.playerWalkPhase += dt * 9;
      const moved = this.moveWithCollision(
        this.playerX,
        this.playerY,
        dx * speed * dt,
        dy * speed * dt,
      );
      this.playerX = moved.x;
      this.playerY = moved.y;
    } else {
      this.playerWalkPhase *= 0.85;
    }

    this.player.root.position.set(kx(this.playerX), 0, kz(this.playerY));
    this.player.body.rotation.y = this.playerFacing;
    const swing = Math.sin(this.playerWalkPhase) * 0.5;
    this.player.legs[0].rotation.x = swing;
    this.player.legs[1].rotation.x = -swing;
  }

  /** Axis-aligned sliding collision: try x, then y, so you slide along walls. */
  private moveWithCollision(x: number, y: number, dx: number, dy: number): { x: number; y: number } {
    const halfW = PLAYER.bodyWidth / 2;
    const halfH = PLAYER.bodyHeight / 2;
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
        if (!this.homeTime && baby.drawingMs <= 0 && !baby.hasDrawing) {
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
      if (baby.carried) {
        baby.x = this.playerX;
        baby.y = this.playerY;
        baby.room = roomAt(baby.x, baby.y);
      } else if (baby.holdingHands) {
        const behindX = this.playerX - Math.sin(this.playerFacing) * 70;
        const behindY = this.playerY - Math.cos(this.playerFacing) * 70;
        baby.x += (behindX - baby.x) * Math.min(1, dt * 4);
        baby.y += (behindY - baby.y) * Math.min(1, dt * 4);
        baby.room = roomAt(baby.x, baby.y);
      } else if (baby.lunchSlot !== null && baby.need === 'hungry') {
        // Shuffling into place in the lunch queue, then standing there
        // looking at you until it is served.
        const spot = this.lunchSpot(baby.lunchSlot);
        const toX = spot.x - baby.x;
        const toY = spot.y - baby.y;
        const distance = Math.hypot(toX, toY);
        if (distance > 16) {
          baby.x += (toX / distance) * BABIES.speed * 1.6 * dt;
          baby.y += (toY / distance) * BABIES.speed * 1.6 * dt;
          baby.facing = Math.atan2(toX, toY);
          baby.walkPhase += dt * 8;
          baby.room = roomAt(baby.x, baby.y);
        } else {
          baby.facing += (0 - baby.facing) * Math.min(1, dt * 5);
          baby.walkPhase += dt * 2;
        }
      } else if (baby.need !== null) {
        // A baby that wants something stops and looks at you, which is both
        // how a real toddler behaves and the easiest way to read its face.
        baby.facing += (0 - baby.facing) * Math.min(1, dt * 5);
        baby.walkPhase += dt * 2;
      } else {
        const toX = baby.wanderX - baby.x;
        const toY = baby.wanderY - baby.y;
        const distance = Math.hypot(toX, toY);
        if (distance < 14) {
          const spot = randomSpotIn(baby.room);
          baby.wanderX = spot.x;
          baby.wanderY = spot.y;
        } else {
          baby.x += (toX / distance) * BABIES.speed * dt;
          baby.y += (toY / distance) * BABIES.speed * dt;
          baby.facing = Math.atan2(toX, toY);
          baby.walkPhase += dt * 7;
        }
      }
    }

    this.keepBabiesApart();
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
    this.hint = 'Lunchtime. They are all lining up — give each one what it asked for.';
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
      const spot = randomSpotIn('play');
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
    this.hint = 'Lunch is over and the floor is covered. Get the mop from the bucket.';
  }

  private clearMesses(): void {
    for (const mess of this.messes) {
      this.scene.remove(mess.group);
      disposeSubtree(mess.group);
    }
    this.messes = [];
  }

  private setMop(holding: boolean): void {
    this.holdingMop = holding;
    if (this.mopModel) {
      this.player.hands.remove(this.mopModel);
      disposeSubtree(this.mopModel);
      this.mopModel = null;
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
      this.player.hands.add(mop);
      this.mopModel = mop;
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

    const rattle = dread > 0.5 ? (dread - 0.5) * 2 : 0;
    this.room.frontDoor.position.x =
      kx(PLACES.frontDoor.x) + Math.sin(performance.now() * 0.05) * rattle * 0.05;

    // The highlight ring follows whatever the menu is open on.
    if (this.menuTarget) {
      const spot = this.targetPosition(this.menuTarget);
      this.ring.visible = true;
      this.ring.position.set(kx(spot.x), 0.03, kz(spot.y));
      const scale = this.menuTarget.kind === 'baby' ? 1 : 1.8;
      this.ring.scale.set(scale, scale, scale);
    } else {
      this.ring.visible = false;
    }

    if (this.heldModel) this.heldModel.rotation.y += dt * 1.2;

    this.stepCamera(dt);
  }

  /**
   * The camera travels with you. The focus is clamped so it never drifts far
   * outside the building, which would leave half the screen showing sky.
   */
  private stepCamera(dt: number): void {
    const halfWidth = ku(ROOM.width) / 2;
    const halfDepth = ku(ROOM.depth) / 2;
    // The bottom margin is the big one: without it the camera looks straight
    // over the front wall and a quarter of the screen is sky.
    const marginX = Math.min(halfWidth, 5.2);
    const marginZ = Math.min(halfDepth, 4.6);

    const focusX = Math.min(Math.max(kx(this.playerX), -halfWidth + marginX), halfWidth - marginX);
    const focusZ = Math.min(Math.max(kz(this.playerY), -halfDepth + marginZ), halfDepth - marginZ);

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

  private publishSnapshot(): void {
    const menu = (() => {
      if (!this.menuTarget) return null;
      const built = this.menuFor(this.menuTarget);
      if (!built) return null;
      const spot = this.targetPosition(this.menuTarget);
      const screen = this.screenPosition(spot.x, spot.y, this.menuTarget.kind === 'baby' ? 1.1 : 1.6);
      return { ...built, screenX: screen.x, screenY: screen.y };
    })();

    const snapshot: GameSnapshot = {
      daycareName: this.daycareName,
      coins: this.coins,
      drawings: this.drawings,
      onTheWall: this.onTheWall,
      upgrades: { ...this.upgrades },
      dayNumber: this.dayNumber,
      dayTimeLeftMs: Math.max(0, this.dayTimeLeftMs),
      playerRoom: ROOMS[roomAt(this.playerX, this.playerY)].name,
      lunchtime: this.lunchtime,
      messCount: this.messes.length,
      holdingMop: this.holdingMop,
      holding: this.holding,
      teaMsLeft: this.teaMsLeft,
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
      musicOn: this.musicOn,
      hint: this.hint,
    };
    publish(snapshot);
  }
}
