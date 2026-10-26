import * as THREE from 'three';
import { ANOMALY, BABIES, DAY, PLACES, PLAYER, ROOM } from './config.ts';
import { kx, ku, kz, disposeSubtree } from './render/three-helpers.ts';
import { buildRoom, buildHighlightRing } from './render/room.ts';
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
};

const NEED_WORD: Record<NeedKind, string> = {
  hungry: 'hungry',
  thirsty: 'thirsty',
  sleepy: 'sleepy',
  bored: 'bored',
  sad: 'sad',
  arty: 'wants to draw',
};

/** Which kind of thing answers each need. `sad` is answered by a cuddle. */
const NEED_ITEM_KIND: Record<NeedKind, Item['kind'] | null> = {
  hungry: 'food',
  thirsty: 'drink',
  sleepy: 'blanket',
  bored: 'toy',
  sad: null,
  arty: 'crayons',
};

/** Where the camera sits on a wide screen; `resize` backs it off on narrow ones. */
const CAMERA_HOME = new THREE.Vector3(0, 9.0, 8.4);

/** Blocks the player walks into. Room units. */
const OBSTACLES = [PLACES.fridge, PLACES.toybox, PLACES.cots, PLACES.table, PLACES.bucket];

interface BabyEntity extends Baby {
  model: BabyModel;
  bubble: THREE.Sprite | null;
  bubbleFor: string;
  nameTag: THREE.Sprite;
  glow: THREE.Mesh;
  walkPhase: number;
  /** The spiky triangle it becomes while the ritual is going on. */
  ritualForm: THREE.Group | null;
}

export class DaycareWorld {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly raycaster = new THREE.Raycaster();
  private lastFrameAt = performance.now();

  private readonly room = buildRoom();
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

  private babies: BabyEntity[] = [];
  private nextBabyId = 1;
  /** Drawings you have been given. Kept for the pure joy of a rising number. */
  private drawings = 0;
  /** Parents hang about by the door for a moment after dropping a baby off. */
  private parents: Array<{ group: THREE.Group; y: number; waitMs: number }> = [];

  private daycareName: string;
  private coins = 0;
  private dayNumber = 1;
  private dayTimeLeftMs = DAY.lengthMs;
  private spawnQueue: Species[] = [];
  private nextSpawnMs = 1500;

  private menuTarget: ClickTarget | null = null;
  private pending: { target: ClickTarget; actionId: string } | null = null;
  /** Home time. While this is set the game is paused and the card is up. */
  private dayReport: { dayNumber: number; verdicts: ParentVerdict[]; earned: number } | null = null;
  private gameOver: { reason: string; detail: string } | null = null;
  private musicOn = true;
  /** So the heartbeat thuds once a second rather than once a frame. */
  private lastHeartbeatAt = 0;
  private hint = 'Click a monster, or click the fridge to get some food.';

  private disposeInput: () => void;
  private frame = 0;
  private running = true;

  /** Which day a fresh run starts on. `?day=3` jumps straight to the anomalies. */
  private readonly firstDay: number;

  constructor(
    canvas: HTMLCanvasElement,
    options: { daycareName: string; skin: SkinId; firstDay?: number },
  ) {
    this.daycareName = options.daycareName;
    this.firstDay = Math.max(1, options.firstDay ?? 1);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(0xdff3fb);

    // Close enough in that you can actually see their faces — that is the whole
    // point of the monsters, and a camera any further back loses them.
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.copy(CAMERA_HOME);
    this.camera.lookAt(0, 0.6, 0.1);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.78);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff3e0, 0.85);
    this.sun.position.set(5, 11, 7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -11;
    this.sun.shadow.camera.right = 11;
    this.sun.shadow.camera.top = 9;
    this.sun.shadow.camera.bottom = -9;
    this.scene.add(this.sun);

    this.scene.add(this.room.root);
    this.scene.add(this.ring);

    this.setSkin(options.skin);
    this.startDay(this.firstDay);

    this.disposeInput = attachInput();
    commands.current = {
      chooseMenuAction: (id) => this.chooseMenuAction(id),
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
    this.canvas = canvas;

    this.resize();
    window.addEventListener('resize', this.resize);
    this.renderer.setAnimationLoop(this.tick);
  }

  private canvas: HTMLCanvasElement;

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

    // Shuffle so the anomaly is not always last through the door.
    for (let i = queue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    this.spawnQueue = queue;
  }

  private restart(): void {
    for (const baby of this.babies) this.removeBaby(baby);
    this.babies = [];
    this.clearParents();
    this.coins = 0;
    this.gameOver = null;
    this.holding = null;
    this.setHeldModel(null);
    this.playerX = PLAYER.spawnX;
    this.playerY = PLAYER.spawnY;
    this.menuTarget = null;
    this.pending = null;
    this.dayReport = null;
    this.drawings = 0;
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

    // Back the camera off just far enough that the whole room fits sideways.
    // On a wide screen this does nothing; on a square or portrait one it is the
    // difference between seeing the toy box and not.
    const halfRoom = ku(ROOM.width) / 2 + 0.5;
    const distance = CAMERA_HOME.length();
    const halfVisible = Math.tan((this.camera.fov * Math.PI) / 360) * distance * this.camera.aspect;
    const scale = Math.max(1, halfRoom / halfVisible);
    this.camera.position.copy(CAMERA_HOME).multiplyScalar(scale);
    this.camera.lookAt(0, 0.6, 0.1);

    this.camera.updateProjectionMatrix();
  };

  /* -------------------------------------------------------------- babies */

  private spawnBaby(species: Species): void {
    const model = buildBaby(species);
    model.body.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = false;
        child.userData.babyId = `baby-${this.nextBabyId}`;
      }
    });
    this.scene.add(model.root);

    const nameTag = textLabel(
      species.anomaly === 'none' ? BABY_NAMES[this.nextBabyId % BABY_NAMES.length] : '???',
    );
    nameTag.position.y = model.bubbleHeight + 0.42;
    model.root.add(nameTag);

    const glow = buildDreadGlow();
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.025;
    model.root.add(glow);

    const baby: BabyEntity = {
      id: `baby-${this.nextBabyId}`,
      species,
      name: species.anomaly === 'none' ? BABY_NAMES[this.nextBabyId % BABY_NAMES.length] : '???',
      x: PLACES.door.x + (Math.random() - 0.5) * 120,
      y: PLACES.door.y + 90,
      wanderX: 140 + Math.random() * (ROOM.width - 280),
      wanderY: 220 + Math.random() * (ROOM.depth - 320),
      facing: 0,
      need: null,
      wantedItemId: null,
      needAgeMs: 0,
      nextNeedMs: 4000 + Math.random() * 6000,
      drawingMs: 0,
      hasDrawing: false,
      happiness: 100,
      carried: false,
      holdingHands: false,
      erupted: false,
      ritualMsLeft: 0,
      model,
      bubble: null,
      bubbleFor: '',
      nameTag,
      glow,
      walkPhase: Math.random() * 6,
      ritualForm: null,
    };

    this.nextBabyId += 1;
    this.babies.push(baby);
    this.dropOff(species);
  }

  /**
   * The parent that brought it. They are much bigger than the babies, which was
   * the whole point of putting them in. They stand by the door for a moment and
   * then go off to work.
   */
  private dropOff(species: Species): void {
    const shaggy = species.shape !== 'blob';
    const group = buildParent(shaggy ? 'shaggy' : 'blob', species.colour);
    group.scale.setScalar(0.9);
    const y = PLACES.door.y + 120;
    group.position.set(kx(PLACES.door.x) + (Math.random() - 0.5) * 1.2, 0, kz(y));
    this.scene.add(group);
    this.parents.push({ group, y, waitMs: 4000 });
  }

  private stepParents(ms: number, dt: number): void {
    for (let i = this.parents.length - 1; i >= 0; i -= 1) {
      const parent = this.parents[i];
      parent.waitMs -= ms;
      if (parent.waitMs > 0) {
        // A small sway, so they do not look like statues.
        parent.group.rotation.y = Math.sin(performance.now() * 0.001 + i) * 0.12;
        continue;
      }
      parent.y -= 110 * dt;
      parent.group.position.z = kz(parent.y);
      if (parent.y < PLACES.door.y - 40) {
        this.scene.remove(parent.group);
        disposeSubtree(parent.group);
        this.parents.splice(i, 1);
      }
    }
  }

  private clearParents(): void {
    for (const parent of this.parents) {
      this.scene.remove(parent.group);
      disposeSubtree(parent.group);
    }
    this.parents = [];
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
    const options: NeedKind[] = ['hungry', 'thirsty', 'bored', 'sleepy', 'sad', 'arty'];
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

  /** What a baby is asking for, as a picture and some words. */
  private wantedItem(baby: BabyEntity): Item | null {
    return baby.wantedItemId ? itemById(baby.wantedItemId) : null;
  }

  private fuseLeftMs(baby: BabyEntity): number | null {
    if (baby.species.anomaly === 'none' || baby.need === null || baby.erupted) return null;
    return Math.max(0, ANOMALY.fuseMs - baby.needAgeMs);
  }

  /* --------------------------------------------------------- the menu */

  private onPointerDown = (event: PointerEvent): void => {
    if (this.gameOver) return;

    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);

    const babyMeshes = this.babies.flatMap((baby) => {
      const meshes: THREE.Object3D[] = [];
      baby.model.body.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) meshes.push(child);
      });
      return meshes;
    });

    const hits = this.raycaster.intersectObjects([...babyMeshes, ...this.room.clickable], false);
    const hit = hits[0];
    if (!hit) {
      this.menuTarget = null;
      return;
    }

    const babyId = hit.object.userData.babyId as string | undefined;
    if (babyId) {
      this.menuTarget = { kind: 'baby', id: babyId };
      return;
    }
    const target = hit.object.userData.target as ClickTarget | undefined;
    this.menuTarget = target ? { ...target } : null;
  };

  private babyById(id: string | undefined): BabyEntity | undefined {
    return this.babies.find((baby) => baby.id === id);
  }

  /** Where the player has to stand to act on a target. */
  private targetPosition(target: ClickTarget): { x: number; y: number } {
    if (target.kind === 'baby') {
      const baby = this.babyById(target.id);
      return baby ? { x: baby.x, y: baby.y } : { x: this.playerX, y: this.playerY };
    }
    const place = PLACES[target.kind];
    // Stand in front of the furniture rather than inside it.
    return { x: place.x, y: place.y + place.h / 2 + 60 };
  }

  private menuFor(target: ClickTarget): { title: string; subtitle: string; actions: MenuAction[] } | null {
    if (target.kind === 'baby') {
      const baby = this.babyById(target.id);
      if (!baby) return null;

      // Once the ritual has started there is exactly one thing worth doing,
      // and it is not cuddling it.
      if (baby.erupted) {
        return {
          title: 'THE RITUAL',
          subtitle: 'It is up in the air. It needs its nappy changing. Now.',
          actions: [{ id: 'nappy', label: '🧷 Change its nappy' }],
        };
      }

      const actions: MenuAction[] = [];
      if (baby.hasDrawing) {
        actions.push({ id: 'takedrawing', label: '🖼️ Take their drawing' });
      }
      if (this.holding) {
        actions.push({
          id: `give:${this.holding.id}`,
          label: `Give it ${this.holding.name}`,
        });
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
      if (baby.hasDrawing) {
        subtitle = `${baby.species.name} — has finished a picture for you`;
      } else if (baby.drawingMs > 0) {
        subtitle = `${baby.species.name} — busy colouring`;
      } else if (baby.need && wanted) {
        subtitle = `${baby.species.name} — wants ${wanted.name} ${wanted.emoji}`;
      } else if (baby.need) {
        subtitle = `${baby.species.name} — ${NEED_WORD[baby.need]} ${NEED_EMOJI[baby.need]}`;
      } else {
        subtitle = `${baby.species.name} — happy enough for now`;
      }
      return { title: baby.name, subtitle, actions };
    }

    if (target.kind === 'fridge') {
      return {
        title: 'The fridge',
        subtitle: 'Fetch exactly the one they asked for.',
        actions: ITEMS.filter((item) => item.kind === 'food' || item.kind === 'drink').map((item) => ({
          id: `take:${item.id}`,
          label: `${item.emoji}  Take ${item.name}`,
        })),
      };
    }

    if (target.kind === 'toybox') {
      return {
        title: 'The toy box',
        subtitle: 'For a bored monster.',
        actions: ITEMS.filter((item) => item.kind === 'toy').map((item) => ({
          id: `take:${item.id}`,
          label: `${item.emoji}  Take ${item.name}`,
        })),
      };
    }

    if (target.kind === 'cots') {
      return {
        title: 'The nap corner',
        subtitle: 'For a sleepy monster.',
        actions: [{ id: 'take:blanket', label: '🛏️  Take a blanket' }],
      };
    }

    if (target.kind === 'table') {
      return {
        title: 'The colouring table',
        subtitle: 'Give the crayons to a monster that wants to draw.',
        actions: [{ id: 'take:crayons', label: '🖍️  Take the crayons' }],
      };
    }

    return {
      title: 'The mop bucket',
      subtitle: 'For when they make a mess.',
      actions: [{ id: 'nothing', label: 'Take the mop', disabledBecause: 'messes are not built yet' }],
    };
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
    const spot = this.targetPosition(target);
    if (target.kind === 'baby') {
      return Math.hypot(spot.x - this.playerX, spot.y - this.playerY) <= PLAYER.reach;
    }
    const place = PLACES[target.kind];
    const dx = Math.max(Math.abs(this.playerX - place.x) - place.w / 2, 0);
    const dy = Math.max(Math.abs(this.playerY - place.y) - place.h / 2, 0);
    return Math.hypot(dx, dy) <= PLAYER.reach;
  }

  private performPending(): void {
    if (!this.pending) return;
    const { target, actionId } = this.pending;
    this.pending = null;

    if (actionId.startsWith('take:')) {
      const item = itemById(actionId.slice(5));
      this.holding = item;
      this.setHeldModel(buildItem(item));
      this.hint = `You are carrying ${item.name}. Click a monster to give it over.`;
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
        this.meetNeed(baby, baby.species.anomaly === 'none' ? 10 : 10 * ANOMALY.payMultiplier);
        this.hint = `${baby.name} wanted that. Lovely.`;
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

    switch (actionId) {
      case 'nappy': {
        // The ritual, ended by the least dramatic thing imaginable.
        baby.erupted = false;
        baby.ritualMsLeft = 0;
        baby.need = null;
        baby.wantedItemId = null;
        baby.needAgeMs = 0;
        baby.nextNeedMs = BABIES.needGapMs;
        baby.happiness = 100;
        if (baby.ritualForm) {
          baby.model.root.remove(baby.ritualForm);
          disposeSubtree(baby.ritualForm);
          baby.ritualForm = null;
        }
        baby.model.body.visible = true;
        this.coins += 60;
        this.hint = `You changed its nappy. The ritual stopped. Everyone is fine.`;
        music.coin();
        break;
      }
      case 'takedrawing':
        baby.hasDrawing = false;
        // Give them a breather before they want the next thing. Without this
        // they can ask for something the instant you take the picture, because
        // the countdown was already at zero when they started colouring.
        baby.nextNeedMs = BABIES.needGapMs + Math.random() * BABIES.needGapJitterMs;
        baby.happiness = Math.min(100, baby.happiness + 14);
        this.coins += BABIES.drawingCoins;
        this.drawings += 1;
        this.hint = `${baby.name} gave you their drawing. You have ${this.drawings} now.`;
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
        this.hint = `You picked ${baby.name} up.`;
        break;
      case 'putdown':
        baby.carried = false;
        baby.x = this.playerX;
        baby.y = this.playerY + 60;
        baby.wanderX = baby.x;
        baby.wanderY = baby.y;
        break;
      default:
        break;
    }
  }

  private meetNeed(baby: BabyEntity, coins: number): void {
    baby.need = null;
    baby.wantedItemId = null;
    baby.needAgeMs = 0;
    baby.nextNeedMs = BABIES.needGapMs + Math.random() * BABIES.needGapJitterMs;
    baby.happiness = Math.min(100, baby.happiness + BABIES.needMetReward);
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
      this.stepPlayer(dt);
      this.stepSpawning(ms);
      this.stepParents(ms, dt);
      this.stepBabies(ms, dt);
      this.stepDay(ms);
    }
    this.stepVisuals(dt);
  }

  private stepPlayer(dt: number): void {
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

    if (dx !== 0 || dy !== 0) {
      this.playerFacing = Math.atan2(dx, dy);
      this.playerWalkPhase += dt * 9;
      const moved = this.moveWithCollision(this.playerX, this.playerY, dx * PLAYER.speed * dt, dy * PLAYER.speed * dt);
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

    const blocked = (px: number, py: number): boolean =>
      OBSTACLES.some(
        (o) =>
          Math.abs(px - o.x) < o.w / 2 + halfW && Math.abs(py - o.y) < o.h / 2 + halfH,
      );

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

  private stepBabies(ms: number, dt: number): void {
    for (const baby of this.babies) {
      // A ritual in progress: it hangs in the air and you have until the
      // second countdown runs out to get over there with a clean nappy.
      if (baby.erupted) {
        baby.ritualMsLeft -= ms;
        if (baby.ritualMsLeft <= 0) {
          this.gameOver = {
            reason: 'The ritual finished.',
            detail:
              'It hung in the air and nobody changed its nappy. Whatever it was summoning arrived. Everyone had to go home.',
          };
        }
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

      // Needs. A baby busy colouring, or holding a finished picture, is not
      // going to start wanting something else mid-masterpiece.
      if (baby.need === null) {
        if (baby.drawingMs > 0 || baby.hasDrawing) {
          // busy
        } else {
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
      } else if (baby.holdingHands) {
        const behindX = this.playerX - Math.sin(this.playerFacing) * 70;
        const behindY = this.playerY - Math.cos(this.playerFacing) * 70;
        baby.x += (behindX - baby.x) * Math.min(1, dt * 4);
        baby.y += (behindY - baby.y) * Math.min(1, dt * 4);
      } else if (baby.need !== null) {
        // A baby that wants something stops and looks at you, which is both
        // how a real toddler behaves and the easiest way to read its face.
        baby.facing += (0 - baby.facing) * Math.min(1, dt * 5);
        baby.walkPhase += dt * 2;
      } else {
        const toX = baby.wanderX - baby.x;
        const toY = baby.wanderY - baby.y;
        const distance = Math.hypot(toX, toY);
        if (distance < 12) {
          baby.wanderX = 120 + Math.random() * (ROOM.width - 240);
          baby.wanderY = 220 + Math.random() * (ROOM.depth - 320);
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
   * you cannot tell whose thought bubble is whose — which matters most for the
   * one bubble you must not miss.
   */
  private keepBabiesApart(): void {
    const minGap = 150;
    for (let i = 0; i < this.babies.length; i += 1) {
      for (let j = i + 1; j < this.babies.length; j += 1) {
        const a = this.babies[i];
        const b = this.babies[j];
        if (a.carried || b.carried) continue;

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

  private erupt(baby: BabyEntity): void {
    baby.erupted = true;
    music.dread();

    if (baby.species.anomaly === 'ritual') {
      // It does not eat anybody. It rises into the air and starts the ritual —
      // and the ritual is survivable, because what it actually needs is its
      // nappy changing.
      baby.model.body.visible = false;
      const form = buildRitualForm();
      baby.model.root.add(form);
      baby.ritualForm = form;
      baby.ritualMsLeft = ANOMALY.ritualMs;
      baby.carried = false;
      baby.holdingHands = false;
      this.hint = 'IT IS DOING THE RITUAL. CHANGE ITS NAPPY.';
    } else {
      this.gameOver = {
        reason: 'It got out.',
        detail:
          'Its shadow was never the right shape. You were too slow, it broke the door down, and it ate the other children.',
      };
    }
  }

  /** What a parent says when they come to collect. */
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
    // Pick from the child's name and how the day went, rather than at random:
    // the same day reads the same way twice, and two parents in the same queue
    // never say the identical sentence.
    const seed =
      [...baby.id].reduce((total, character) => total + character.charCodeAt(0), 0) +
      Math.floor(baby.happiness / 10);
    const said = pool[seed % pool.length];

    return { babyName: baby.name, speciesName: baby.species.name, happy, said };
  }

  private stepDay(ms: number): void {
    this.dayTimeLeftMs -= ms;
    if (this.dayTimeLeftMs > 0) return;

    // Home time. Every parent comes back and tells you how it went.
    const verdicts = this.babies.map((baby) => this.verdictFor(baby));
    const pleased = verdicts.filter((verdict) => verdict.happy).length;
    const earned = pleased * 15;

    for (const baby of this.babies) this.removeBaby(baby);
    this.babies = [];
    this.clearParents();
    this.coins += earned;
    this.holding = null;
    this.setHeldModel(null);
    this.menuTarget = null;
    this.pending = null;

    // Setting this pauses everything until they press the button.
    this.dayReport = { dayNumber: this.dayNumber, verdicts, earned };
    this.hint = 'Home time.';
  }

  /** Bubbles, wobbling, the dread glow and the room going dark. */
  private stepVisuals(dt: number): void {
    let worstFuse: number | null = null;

    for (const baby of this.babies) {
      baby.model.root.position.set(kx(baby.x), 0, kz(baby.y));
      baby.model.body.rotation.y = baby.facing;

      const bob = Math.sin(baby.walkPhase) * 0.02;
      baby.model.body.position.y = bob;
      const swing = Math.sin(baby.walkPhase) * 0.35;
      baby.model.limbs[2].rotation.x = swing;
      baby.model.limbs[3].rotation.x = -swing;

      if (baby.erupted) {
        // Rising, turning, and getting slowly higher the longer it goes on.
        const risen = 1 - Math.max(0, baby.ritualMsLeft) / ANOMALY.ritualMs;
        baby.model.root.position.y = 0.6 + risen * 1.1 + Math.sin(performance.now() * 0.003) * 0.08;
        baby.model.root.rotation.y += dt * 1.6;
        baby.model.shadow.visible = false;
      } else if (baby.carried) {
        baby.model.root.position.y = 0.95;
        baby.model.root.rotation.y = 0;
        baby.model.shadow.visible = false;
      } else {
        baby.model.root.position.y = 0;
        baby.model.root.rotation.y = 0;
        baby.model.shadow.visible = true;
      }

      const fuse = this.fuseLeftMs(baby);
      if (fuse !== null && (worstFuse === null || fuse < worstFuse)) worstFuse = fuse;

      // The thought bubble, rebuilt only when what it wants changes. It shows
      // the exact thing asked for, not the category, so "hungry" is never a
      // guessing game about which of five foods it meant.
      let wanted = '';
      if (baby.erupted) wanted = '🌀';
      else if (baby.hasDrawing) wanted = '🖼️';
      else if (baby.drawingMs > 0) wanted = '🖍️';
      else if (baby.need) wanted = this.wantedItem(baby)?.emoji ?? NEED_EMOJI[baby.need];

      const urgent = (fuse !== null && fuse < ANOMALY.panicAtMs) || baby.erupted;
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
          // Up and off to one side, so it never sits on top of the face — the
          // face is where the anomaly tells are.
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

      // Red glow under an anomaly whose time is running out.
      const glowMaterial = baby.glow.material as THREE.MeshBasicMaterial;
      if (fuse !== null && fuse < ANOMALY.dimAtMs) {
        const closeness = 1 - fuse / ANOMALY.dimAtMs;
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() * (0.004 + closeness * 0.012));
        glowMaterial.opacity = 0.2 + closeness * 0.5 * pulse;
      } else {
        glowMaterial.opacity = 0;
      }
    }

    // The room darkens, and the door rattles, as the worst fuse burns down.
    const dread = worstFuse === null ? 0 : Math.max(0, 1 - worstFuse / ANOMALY.dimAtMs);
    this.ambient.intensity += (0.78 - dread * 0.5 - this.ambient.intensity) * Math.min(1, dt * 3);
    this.sun.intensity += (0.85 - dread * 0.55 - this.sun.intensity) * Math.min(1, dt * 3);
    const target = new THREE.Color(0xdff3fb).lerp(new THREE.Color(0x1a0d16), dread);
    (this.scene.background as THREE.Color).lerp(target, Math.min(1, dt * 3));

    // One thud a second while the fuse burns, speeding up as it goes.
    if (worstFuse !== null && worstFuse < ANOMALY.panicAtMs) {
      const closeness = 1 - worstFuse / ANOMALY.panicAtMs;
      const gap = 900 - closeness * 500;
      const now = performance.now();
      if (now - this.lastHeartbeatAt > gap) {
        this.lastHeartbeatAt = now;
        music.heartbeat(closeness);
      }
    }

    const rattle = dread > 0.5 ? (dread - 0.5) * 2 : 0;
    this.room.door.position.x = kx(PLACES.door.x) + Math.sin(performance.now() * 0.05) * rattle * 0.05;

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
      const screen = this.screenPosition(spot.x, spot.y, this.menuTarget.kind === 'baby' ? 1.1 : 1.3);
      return { ...built, screenX: screen.x, screenY: screen.y };
    })();

    const snapshot: GameSnapshot = {
      daycareName: this.daycareName,
      coins: this.coins,
      dayNumber: this.dayNumber,
      dayTimeLeftMs: Math.max(0, this.dayTimeLeftMs),
      holding: this.holding,
      babies: this.babies.map((baby) => {
        const wanted = this.wantedItem(baby);
        return {
          id: baby.id,
          name: baby.name,
          speciesName: baby.species.name,
          need: baby.need,
          wants: wanted ? { emoji: wanted.emoji, name: wanted.name } : null,
          hasDrawing: baby.hasDrawing,
          happiness: Math.round(baby.happiness),
          carried: baby.carried,
          holdingHands: baby.holdingHands,
          isAnomaly: baby.species.anomaly !== 'none',
          erupted: baby.erupted,
          fuseLeftMs: this.fuseLeftMs(baby),
          ritualMsLeft: baby.erupted ? Math.max(0, baby.ritualMsLeft) : null,
        };
      }),
      menu,
      dayReport: this.dayReport,
      gameOver: this.gameOver,
      musicOn: this.musicOn,
      hint: this.hint,
    };
    publish(snapshot);
  }

  /** Room bounds, handy for the HUD. */
  static get size(): { width: number; depth: number } {
    return { width: ku(ROOM.width), depth: ku(ROOM.depth) };
  }
}
