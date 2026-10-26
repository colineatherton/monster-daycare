import * as THREE from 'three';
import { ball, box, cyl, mat, torus } from './three-helpers.ts';
import { kx, ku, kz } from './three-helpers.ts';
import { PALETTE } from './palette.ts';
import { BEDS, DOORWAYS, PLACES, ROOM, ROOMS } from '../config.ts';
import type { RoomId } from '../config.ts';

/**
 * The whole daycare: five rooms off a playroom in the middle, and the things
 * you fetch from each.
 *
 * The outside walls are full height but every partition inside is knee-high, so
 * a camera looking down at the building can always see into the next room. A
 * proper wall would hide whichever room you are standing in.
 *
 * Anything you can click carries `userData.target`, which is what the raycaster
 * reads when the player taps the screen.
 */

export interface RoomModel {
  root: THREE.Group;
  /** Meshes the click raycaster tests against. */
  clickable: THREE.Object3D[];
  /** The front door, so we can rattle it. */
  frontDoor: THREE.Group;
  /** The anomaly room's door, which gets broken off its hinges. */
  anomalyDoor: THREE.Group;
  /** The sock drawer, hidden until it is bought. */
  sockDrawer: THREE.Group;
  /** Framed drawings get hung along here at the end of each day. */
  pictureWall: THREE.Group;
}

/** A solid block of wall, in plan units. Collision uses the same list. */
export interface WallRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PARTITION = 22;
const PARTITION_HEIGHT = 0.52;

/**
 * Every interior wall, worked out from the room rectangles and the doorways.
 * Returned so the movement code can collide against exactly what is drawn.
 */
export function partitionWalls(): WallRect[] {
  const walls: WallRect[] = [];

  // The two long partitions either side of the playroom, each broken by two
  // doorways.
  for (const [x, top, bottom] of [
    [800, DOORWAYS.music, DOORWAYS.staff],
    [1600, DOORWAYS.maths, DOORWAYS.anomaly],
  ] as const) {
    const spans: Array<[number, number]> = [
      [0, top.y0],
      [top.y1, bottom.y0],
      [bottom.y1, ROOM.depth],
    ];
    for (const [y0, y1] of spans) {
      if (y1 <= y0) continue;
      walls.push({ x, y: (y0 + y1) / 2, w: PARTITION, h: y1 - y0 });
    }
  }

  // The walls splitting each side column in two. No doors: everything goes
  // back through the playroom, which keeps the shape of the place simple.
  walls.push({ x: 400, y: 755, w: 800, h: PARTITION });
  walls.push({ x: 1995, y: 755, w: 800, h: PARTITION });

  return walls;
}

/** Where bed `index` sits, as an offset from the middle of the nap corner. */
export function bedOffsetX(index: number): number {
  const spacing = ku(PLACES.cots.w) / BEDS.count;
  return (index - (BEDS.count - 1) / 2) * spacing;
}

/** Where bed `index` is on the floor plan, for putting a baby down on it. */
export function bedPosition(index: number): { x: number; y: number } {
  const spacing = PLACES.cots.w / BEDS.count;
  return {
    x: PLACES.cots.x + (index - (BEDS.count - 1) / 2) * spacing,
    y: PLACES.cots.y,
  };
}

function furnitureBase(place: { x: number; y: number }): THREE.Group {
  const group = new THREE.Group();
  group.position.set(kx(place.x), 0, kz(place.y));
  return group;
}

/** A flat panel of floor in its own colour, so each room reads as a room. */
function floorPatch(id: RoomId, colour: number): THREE.Mesh {
  const r = ROOMS[id];
  const patch = new THREE.Mesh(
    new THREE.PlaneGeometry(ku(r.x1 - r.x0), ku(r.y1 - r.y0)),
    mat(colour),
  );
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(kx((r.x0 + r.x1) / 2), 0.004, kz((r.y0 + r.y1) / 2));
  patch.receiveShadow = true;
  return patch;
}

/** A door leaf on a frame, used for the front door and the anomaly door. */
function doorPanel(width: number, colour: number, frameColour: number): THREE.Group {
  const door = new THREE.Group();
  const frame = box(width + 0.12, 1.5, 0.12, frameColour);
  frame.position.y = 0.75;
  door.add(frame);
  const leaf = box(width, 1.36, 0.08, colour);
  leaf.position.set(0, 0.7, 0.05);
  door.add(leaf);
  const knob = ball(0.05, 0xffd166);
  knob.position.set(width / 2 - 0.12, 0.7, 0.11);
  door.add(knob);
  return door;
}

export function buildRoom(): RoomModel {
  const root = new THREE.Group();
  const clickable: THREE.Object3D[] = [];

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ku(ROOM.width), ku(ROOM.depth)),
    mat(PALETTE.floor),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);

  root.add(floorPatch('music', PALETTE.floorMusic));
  root.add(floorPatch('staff', PALETTE.floorStaff));
  root.add(floorPatch('maths', PALETTE.floorMaths));
  root.add(floorPatch('anomaly', PALETTE.floorAnomaly));

  // The play rug in the middle of the playroom.
  const rug = new THREE.Mesh(new THREE.CircleGeometry(ku(PLACES.rug.w / 2), 36), mat(PALETTE.rug));
  rug.rotation.x = -Math.PI / 2;
  rug.scale.y = PLACES.rug.h / PLACES.rug.w;
  rug.position.set(kx(PLACES.rug.x), 0.01, kz(PLACES.rug.y));
  root.add(rug);

  const rugRing = new THREE.Mesh(
    new THREE.RingGeometry(ku(PLACES.rug.w / 2) * 0.62, ku(PLACES.rug.w / 2) * 0.74, 36),
    mat(PALETTE.rugRing),
  );
  rugRing.rotation.x = -Math.PI / 2;
  rugRing.scale.y = PLACES.rug.h / PLACES.rug.w;
  rugRing.position.set(kx(PLACES.rug.x), 0.02, kz(PLACES.rug.y));
  root.add(rugRing);

  /* ----------------------------------------------------- the outside walls */

  const wallHeight = 1.9;
  const back = box(ku(ROOM.width), wallHeight, ku(ROOM.wall), PALETTE.wall);
  back.position.set(0, wallHeight / 2, kz(0));
  back.receiveShadow = true;
  root.add(back);

  for (const side of [-1, 1]) {
    const sideWall = box(ku(ROOM.wall), wallHeight, ku(ROOM.depth), PALETTE.wall);
    sideWall.position.set(side * ku(ROOM.width / 2), wallHeight / 2, 0);
    sideWall.receiveShadow = true;
    root.add(sideWall);
  }

  const front = box(ku(ROOM.width), 0.3, ku(ROOM.wall), PALETTE.wallTop);
  front.position.set(0, 0.15, kz(ROOM.depth));
  root.add(front);

  /* --------------------------------------------------- the low partitions */

  for (const wall of partitionWalls()) {
    const panel = box(ku(wall.w), PARTITION_HEIGHT, ku(wall.h), PALETTE.partition);
    panel.position.set(kx(wall.x), PARTITION_HEIGHT / 2, kz(wall.y));
    panel.castShadow = true;
    panel.receiveShadow = true;
    root.add(panel);

    const capRail = box(ku(wall.w) + 0.04, 0.05, ku(wall.h) + 0.04, PALETTE.partitionTop);
    capRail.position.set(kx(wall.x), PARTITION_HEIGHT, kz(wall.y));
    root.add(capRail);
  }

  /* --------------------------------------------------------- the doorways */

  // A painted threshold on the floor, so you can see where to walk through.
  for (const doorway of [DOORWAYS.music, DOORWAYS.staff, DOORWAYS.maths]) {
    const threshold = box(ku(PARTITION), 0.02, ku(doorway.y1 - doorway.y0), PALETTE.threshold);
    threshold.position.set(kx(doorway.x), 0.012, kz((doorway.y0 + doorway.y1) / 2));
    root.add(threshold);
  }

  /* ------------------------------------------------------- the front door */

  const frontDoor = doorPanel(ku(PLACES.frontDoor.w), PALETTE.door, PALETTE.doorFrame);
  frontDoor.position.set(kx(PLACES.frontDoor.x), 0, kz(PLACES.frontDoor.y) - 0.06);
  root.add(frontDoor);

  /* ------------------------------------------------- the anomaly room door */

  const anomalyDoor = new THREE.Group();
  const leaf = doorPanel(ku(DOORWAYS.anomaly.y1 - DOORWAYS.anomaly.y0), PALETTE.anomalyDoor, PALETTE.anomalyDoorFrame);
  leaf.rotation.y = Math.PI / 2;
  anomalyDoor.add(leaf);
  // Three heavy bars across it, because it is supposed to look like it is
  // holding something back.
  for (const y of [0.35, 0.7, 1.05]) {
    const bar = box(0.1, 0.09, ku(DOORWAYS.anomaly.y1 - DOORWAYS.anomaly.y0) * 0.92, PALETTE.anomalyDoorFrame);
    bar.position.set(0.09, y, 0);
    anomalyDoor.add(bar);
  }
  anomalyDoor.position.set(kx(DOORWAYS.anomaly.x), 0, kz((DOORWAYS.anomaly.y0 + DOORWAYS.anomaly.y1) / 2));
  root.add(anomalyDoor);

  /* ----------------------------------------------------------- the fridge */

  const fridge = furnitureBase(PLACES.fridge);
  const fridgeBody = box(ku(PLACES.fridge.w), 1.1, ku(PLACES.fridge.h), PALETTE.fridge);
  fridgeBody.position.y = 0.55;
  fridgeBody.castShadow = true;
  fridgeBody.userData.target = { kind: 'fridge' };
  fridge.add(fridgeBody);
  clickable.push(fridgeBody);

  const fridgeSplit = box(ku(PLACES.fridge.w) + 0.02, 0.04, ku(PLACES.fridge.h) + 0.02, PALETTE.fridgeTrim);
  fridgeSplit.position.y = 0.62;
  fridge.add(fridgeSplit);
  const handle = box(0.05, 0.3, 0.05, PALETTE.fridgeTrim);
  handle.position.set(ku(PLACES.fridge.w) / 2 - 0.08, 0.86, ku(PLACES.fridge.h) / 2 + 0.03);
  fridge.add(handle);
  root.add(fridge);

  /* ---------------------------------------------------------- the toy box */

  const toybox = furnitureBase(PLACES.toybox);
  const toyBody = box(ku(PLACES.toybox.w), 0.6, ku(PLACES.toybox.h), PALETTE.toybox);
  toyBody.position.y = 0.3;
  toyBody.castShadow = true;
  toyBody.userData.target = { kind: 'toybox' };
  toybox.add(toyBody);
  clickable.push(toyBody);

  const lid = box(ku(PLACES.toybox.w) + 0.04, 0.08, ku(PLACES.toybox.h) + 0.04, PALETTE.toyboxTrim);
  lid.position.y = 0.64;
  toybox.add(lid);
  for (const [dx, dz, colour] of [
    [-0.25, 0.1, 0xff7043],
    [0.2, -0.1, 0xffd166],
    [0.05, 0.22, 0x6ec6ff],
  ] as const) {
    const toy = ball(0.11, colour);
    toy.position.set(dx, 0.72, dz);
    toybox.add(toy);
  }
  root.add(toybox);

  /* ------------------------------------------------------------ the cots */

  const cots = furnitureBase(PLACES.cots);
  const cotTarget = box(ku(PLACES.cots.w), 0.5, ku(PLACES.cots.h), PALETTE.cot, { opacity: 0.001 });
  cotTarget.position.y = 0.25;
  cotTarget.userData.target = { kind: 'cots' };
  cots.add(cotTarget);
  clickable.push(cotTarget);

  // Four beds in a row. There are usually more children than beds, which is
  // the whole tension of nap time.
  for (let i = 0; i < BEDS.count; i += 1) {
    const dx = bedOffsetX(i);
    const mattress = box(0.54, 0.18, 0.95, PALETTE.cot);
    mattress.position.set(dx, 0.26, 0);
    mattress.castShadow = true;
    cots.add(mattress);
    for (const dz of [-0.47, 0.47]) {
      const end = box(0.58, 0.42, 0.06, PALETTE.cotFrame);
      end.position.set(dx, 0.3, dz);
      cots.add(end);
    }
    const pillow = box(0.38, 0.1, 0.22, 0xfff3d6);
    pillow.position.set(dx, 0.4, -0.3);
    cots.add(pillow);
  }
  root.add(cots);

  /* ------------------------------------------------- the colouring table */

  const table = furnitureBase(PLACES.table);
  const top = box(ku(PLACES.table.w), 0.08, ku(PLACES.table.h), PALETTE.tableTop);
  top.position.y = 0.46;
  top.castShadow = true;
  top.userData.target = { kind: 'table' };
  table.add(top);
  clickable.push(top);

  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) {
      const legMesh = cyl(0.035, 0.035, 0.46, PALETTE.tableLeg);
      legMesh.position.set(dx * (ku(PLACES.table.w) / 2 - 0.1), 0.23, dz * (ku(PLACES.table.h) / 2 - 0.1));
      table.add(legMesh);
    }
  }

  const pot = cyl(0.09, 0.08, 0.14, 0xffffff);
  pot.position.set(-0.3, 0.57, 0);
  table.add(pot);
  [0xff5a5a, 0x4aa8ff, 0x6bd36b, 0xffd166, 0xb77cff].forEach((colour, index) => {
    const crayon = cyl(0.016, 0.016, 0.2, colour);
    crayon.position.set(-0.3 + (index - 2) * 0.028, 0.66, (index % 2) * 0.02);
    crayon.rotation.z = (index - 2) * 0.1;
    table.add(crayon);
  });

  const paper = box(0.3, 0.012, 0.22, 0xffffff);
  paper.position.set(0.22, 0.51, 0);
  paper.rotation.y = 0.2;
  table.add(paper);
  for (const dx of [-1, 1]) {
    const stool = cyl(0.11, 0.11, 0.26, PALETTE.stool);
    stool.position.set(dx * (ku(PLACES.table.w) / 2 + 0.26), 0.13, 0);
    stool.castShadow = true;
    table.add(stool);
  }
  root.add(table);

  /* ----------------------------------------------------------- the bucket */

  const bucket = furnitureBase(PLACES.bucket);
  const pail = cyl(0.28, 0.22, 0.44, PALETTE.bucket);
  pail.position.y = 0.22;
  pail.castShadow = true;
  pail.userData.target = { kind: 'bucket' };
  bucket.add(pail);
  clickable.push(pail);

  const water = new THREE.Mesh(new THREE.CircleGeometry(0.25, 20), mat(0x58b7d6));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.42;
  bucket.add(water);

  const handleStick = cyl(0.025, 0.025, 1.0, 0xb08968);
  handleStick.position.set(0.08, 0.72, 0);
  handleStick.rotation.z = -0.18;
  bucket.add(handleStick);
  root.add(bucket);

  /* ------------------------------------------------------ the music room */

  const music = furnitureBase(PLACES.instruments);
  const musicShelf = box(ku(PLACES.instruments.w), 0.5, ku(PLACES.instruments.h), PALETTE.musicShelf);
  musicShelf.position.y = 0.25;
  musicShelf.castShadow = true;
  musicShelf.userData.target = { kind: 'instruments' };
  music.add(musicShelf);
  clickable.push(musicShelf);

  // A drum.
  const drum = cyl(0.21, 0.21, 0.26, 0xd64545);
  drum.position.set(-0.75, 0.63, 0);
  music.add(drum);
  for (const y of [0.52, 0.74]) {
    const rim = torus(0.215, 0.022, 0xfff3d6);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(-0.75, y, 0);
    music.add(rim);
  }
  for (const dx of [-0.08, 0.08]) {
    const stickMesh = cyl(0.015, 0.015, 0.34, 0xe8c9a0);
    stickMesh.position.set(-0.75 + dx, 0.9, 0.08);
    stickMesh.rotation.z = dx * 3;
    music.add(stickMesh);
  }

  // A trumpet, roughly.
  const trumpetBody = cyl(0.04, 0.04, 0.4, 0xf0b429);
  trumpetBody.rotation.z = Math.PI / 2;
  trumpetBody.position.set(0, 0.62, 0);
  music.add(trumpetBody);
  const bell = cyl(0.14, 0.05, 0.16, 0xf0b429);
  bell.rotation.z = -Math.PI / 2;
  bell.position.set(0.26, 0.62, 0);
  music.add(bell);

  // A row of bells, biggest to smallest.
  [0.1, 0.085, 0.07, 0.055].forEach((radius, index) => {
    const bellMesh = ball(radius, 0xffd166);
    bellMesh.scale.y = 0.85;
    bellMesh.position.set(0.62 + index * 0.21, 0.55 + radius, 0);
    music.add(bellMesh);
  });
  root.add(music);

  /* ------------------------------------------------------ the maths room */

  const maths = furnitureBase(PLACES.sums);
  const mathsDesk = box(ku(PLACES.sums.w), 0.5, ku(PLACES.sums.h), PALETTE.mathsDesk);
  mathsDesk.position.y = 0.25;
  mathsDesk.castShadow = true;
  mathsDesk.userData.target = { kind: 'sums' };
  maths.add(mathsDesk);
  clickable.push(mathsDesk);

  // A stack of counting blocks.
  const blockColours = [0x5aa9ff, 0xff7a7a, 0x7ed957, 0xffd166];
  blockColours.forEach((colour, index) => {
    const blockMesh = box(0.16, 0.16, 0.16, colour);
    blockMesh.position.set(-0.8 + (index % 2) * 0.19, 0.58 + Math.floor(index / 2) * 0.17, 0);
    blockMesh.rotation.y = index * 0.2;
    maths.add(blockMesh);
  });

  // An abacus: a frame with beads on wires.
  const abacusFrame = box(0.5, 0.42, 0.05, 0xb5651d);
  abacusFrame.position.set(0.1, 0.71, 0);
  maths.add(abacusFrame);
  for (let row = 0; row < 3; row += 1) {
    for (let beadIndex = 0; beadIndex < 4; beadIndex += 1) {
      const bead = ball(0.035, [0xff5a5a, 0x4aa8ff, 0x7ed957][row]);
      bead.position.set(-0.08 + beadIndex * 0.08, 0.59 + row * 0.12, 0.04);
      maths.add(bead);
    }
  }

  // A shape box with a triangle and a circle poking out.
  const shapeBox = box(0.3, 0.22, 0.26, 0x7ed957);
  shapeBox.position.set(0.82, 0.61, 0);
  maths.add(shapeBox);
  const triangle = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.14, 3), mat(0xff7a7a));
  triangle.position.set(0.76, 0.79, 0);
  maths.add(triangle);
  const circleBit = cyl(0.07, 0.07, 0.04, 0x4aa8ff);
  circleBit.rotation.x = Math.PI / 2;
  circleBit.position.set(0.9, 0.77, 0);
  maths.add(circleBit);
  root.add(maths);

  /* ------------------------------------------------------ the staff room */

  const staff = furnitureBase(PLACES.kettle);
  const counter = box(ku(PLACES.kettle.w), 0.56, ku(PLACES.kettle.h), PALETTE.staffCounter);
  counter.position.y = 0.28;
  counter.castShadow = true;
  counter.userData.target = { kind: 'kettle' };
  staff.add(counter);
  clickable.push(counter);

  const kettleBody = cyl(0.13, 0.15, 0.24, 0xdfe6ec);
  kettleBody.position.set(-0.45, 0.68, 0);
  staff.add(kettleBody);
  const spout = cyl(0.03, 0.045, 0.16, 0xdfe6ec);
  spout.rotation.z = -0.9;
  spout.position.set(-0.28, 0.72, 0);
  staff.add(spout);

  for (const dx of [0.05, 0.3]) {
    const mug = cyl(0.07, 0.065, 0.12, 0xffffff);
    mug.position.set(dx, 0.62, 0);
    staff.add(mug);
    const tea = new THREE.Mesh(new THREE.CircleGeometry(0.063, 14), mat(0xb07a4a));
    tea.rotation.x = -Math.PI / 2;
    tea.position.set(dx, 0.68, 0);
    staff.add(tea);
  }

  // A sofa, so it looks like somewhere you would actually sit down.
  const sofaBase = box(1.1, 0.26, 0.5, PALETTE.sofa);
  sofaBase.position.set(0.1, 0.13, 1.0);
  sofaBase.castShadow = true;
  staff.add(sofaBase);
  const sofaBack = box(1.1, 0.34, 0.14, PALETTE.sofa);
  sofaBack.position.set(0.1, 0.4, 1.2);
  staff.add(sofaBack);
  root.add(staff);

  /* --------------------------------------------------- the anomaly room */

  const pen = furnitureBase(PLACES.pen);
  // A painted circle on the floor and four corner posts. It is a containment
  // pen, in the sense that a nursery can contain anything.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(ku(PLACES.pen.w) * 0.34, ku(PLACES.pen.w) * 0.4, 36),
    mat(PALETTE.penRing),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.015;
  pen.add(ring);

  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) {
      const post = cyl(0.07, 0.08, 0.62, PALETTE.penPost);
      post.position.set(dx * ku(PLACES.pen.w) * 0.42, 0.31, dz * ku(PLACES.pen.h) * 0.42);
      post.castShadow = true;
      pen.add(post);
      const lamp = ball(0.06, 0xff5a5a, { emissive: 0xff0000, emissiveIntensity: 0.9 });
      lamp.position.set(dx * ku(PLACES.pen.w) * 0.42, 0.66, dz * ku(PLACES.pen.h) * 0.42);
      pen.add(lamp);
    }
  }
  root.add(pen);

  /* --------------------------------------------------------- the register */

  const register = furnitureBase(PLACES.register);
  const desk = box(ku(PLACES.register.w), 0.68, ku(PLACES.register.h), PALETTE.registerDesk);
  desk.position.y = 0.34;
  desk.castShadow = true;
  desk.userData.target = { kind: 'register' };
  register.add(desk);
  clickable.push(desk);

  const deskTop = box(ku(PLACES.register.w) + 0.08, 0.06, ku(PLACES.register.h) + 0.08, PALETTE.registerTop);
  deskTop.position.y = 0.71;
  register.add(deskTop);

  // A till with a little screen and some keys.
  const till = box(0.3, 0.2, 0.26, PALETTE.till);
  till.position.set(0.1, 0.84, 0);
  register.add(till);
  const screen = box(0.2, 0.13, 0.03, 0x9ff5c9);
  screen.position.set(0.1, 0.96, 0.1);
  register.add(screen);
  for (let i = 0; i < 6; i += 1) {
    const key = box(0.035, 0.02, 0.035, 0xfdfdfd);
    key.position.set(0.02 + (i % 3) * 0.06, 0.945, -0.02 - Math.floor(i / 3) * 0.05);
    register.add(key);
  }
  const coinStack = cyl(0.055, 0.055, 0.09, 0xffd166);
  coinStack.position.set(-0.28, 0.78, 0);
  register.add(coinStack);
  root.add(register);

  /* ------------------------------------------------------ the sock drawer */

  const sockDrawer = new THREE.Group();
  sockDrawer.position.set(kx(PLACES.sockDrawer.x), 0, kz(PLACES.sockDrawer.y));
  const chest = box(ku(PLACES.sockDrawer.w), 0.56, ku(PLACES.sockDrawer.h), PALETTE.sockDrawer);
  chest.position.y = 0.28;
  chest.castShadow = true;
  chest.userData.target = { kind: 'sockdrawer' };
  sockDrawer.add(chest);
  clickable.push(chest);
  for (const y of [0.18, 0.42]) {
    const drawerFront = box(ku(PLACES.sockDrawer.w) * 0.86, 0.16, 0.04, PALETTE.sockDrawerTrim);
    drawerFront.position.set(0, y, ku(PLACES.sockDrawer.h) / 2 + 0.02);
    sockDrawer.add(drawerFront);
  }
  // A sock hanging out of the top one, so you can tell what it is.
  const stray = box(0.16, 0.08, 0.1, 0xb7b7d8);
  stray.position.set(0.1, 0.6, 0.1);
  stray.rotation.z = 0.3;
  sockDrawer.add(stray);
  sockDrawer.visible = false;
  root.add(sockDrawer);

  /* ------------------------------------------------------ the picture wall */

  const pictureWall = new THREE.Group();
  root.add(pictureWall);

  return { root, clickable, frontDoor, anomalyDoor, sockDrawer, pictureWall };
}

/**
 * One of the children's drawings, framed and hung on the playroom wall.
 * `index` decides where along the wall it goes.
 */
export function hangDrawing(index: number, colour: number): THREE.Group {
  const group = new THREE.Group();

  const frame = box(0.42, 0.34, 0.04, 0xffe3a8);
  group.add(frame);
  const paper = box(0.36, 0.28, 0.02, 0xffffff);
  paper.position.z = 0.02;
  group.add(paper);

  // Scribbles in the colour of whoever drew it. The pattern comes from the
  // index, so the same drawing looks the same every time it is drawn.
  for (let i = 0; i < 5; i += 1) {
    const wobble = ((index * 7 + i * 13) % 9) / 9 - 0.5;
    const scribble = box(0.18 - i * 0.02, 0.025, 0.01, colour);
    scribble.position.set(wobble * 0.14, 0.09 - i * 0.045, 0.03);
    scribble.rotation.z = wobble * 0.5;
    group.add(scribble);
  }

  // Along the back wall of the playroom, wrapping onto a second row.
  const perRow = 7;
  const column = index % perRow;
  const row = Math.floor(index / perRow);
  group.position.set(
    kx(ROOMS.play.x0 + 90 + column * 100),
    1.45 - row * 0.45,
    kz(ROOMS.play.y0) - 0.02,
  );
  return group;
}

/**
 * A dropped lunch wrapper. Deliberately bright and a bit horrible, so a
 * messy floor reads from across the room.
 */
export function buildMess(seed: number): THREE.Group {
  const group = new THREE.Group();
  const colours = [0xff7a7a, 0xffd166, 0x7ed957, 0x6ec6ff, 0xff9ddd];

  for (let i = 0; i < 4; i += 1) {
    const colour = colours[(seed + i) % colours.length];
    const scrap = box(0.1 + ((seed + i) % 3) * 0.03, 0.015, 0.07, colour);
    const angle = ((seed * 11 + i * 29) % 360) * (Math.PI / 180);
    const radius = 0.06 + ((seed + i) % 4) * 0.035;
    scrap.position.set(Math.cos(angle) * radius, 0.012, Math.sin(angle) * radius);
    scrap.rotation.y = angle;
    group.add(scrap);
  }

  // A splodge underneath, so it reads as a mess rather than confetti.
  const splodge = new THREE.Mesh(
    new THREE.CircleGeometry(0.2, 16),
    new THREE.MeshBasicMaterial({ color: 0xb08a6a, transparent: true, opacity: 0.35 }),
  );
  splodge.rotation.x = -Math.PI / 2;
  splodge.position.y = 0.006;
  group.add(splodge);

  return group;
}

/** The yellow ring that shows which thing you have selected. */
export function buildHighlightRing(): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.34, 0.44, 28),
    new THREE.MeshBasicMaterial({
      color: PALETTE.highlight,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = false;
  return ring;
}
