import * as THREE from 'three';
import { ball, box, cyl, mat } from './three-helpers.ts';
import { kx, ku, kz } from './three-helpers.ts';
import { PALETTE } from './palette.ts';
import { PLACES, ROOM } from '../config.ts';

/**
 * The daycare itself: floor, walls, the front door the parents come through,
 * and the four places you fetch things from.
 *
 * Anything you can click carries `userData.target`, which is what the raycaster
 * reads when the player taps the screen.
 */

export interface RoomModel {
  root: THREE.Group;
  /** Meshes the click raycaster tests against. */
  clickable: THREE.Object3D[];
  /** The front door, so we can rattle it when an anomaly is about to go. */
  door: THREE.Group;
}

function furnitureBase(place: { x: number; y: number; w: number; h: number }): THREE.Group {
  const group = new THREE.Group();
  group.position.set(kx(place.x), 0, kz(place.y));
  return group;
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

  // The play rug in the middle of the room.
  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(ku(PLACES.rug.w / 2), 36),
    mat(PALETTE.rug),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.scale.y = PLACES.rug.h / PLACES.rug.w;
  rug.position.set(kx(PLACES.rug.x), 0.01, kz(PLACES.rug.y));
  root.add(rug);

  const rugRing = new THREE.Mesh(
    new THREE.RingGeometry(ku(PLACES.rug.w / 2) * 0.6, ku(PLACES.rug.w / 2) * 0.72, 36),
    mat(PALETTE.rugRing),
  );
  rugRing.rotation.x = -Math.PI / 2;
  rugRing.scale.y = PLACES.rug.h / PLACES.rug.w;
  rugRing.position.set(kx(PLACES.rug.x), 0.02, kz(PLACES.rug.y));
  root.add(rugRing);

  // Walls. The far wall is full height; the near one is a low lip so the
  // camera can see in.
  const wallHeight = 1.9;
  const far = box(ku(ROOM.width), wallHeight, ku(ROOM.wall), PALETTE.wall);
  far.position.set(0, wallHeight / 2, kz(0));
  far.receiveShadow = true;
  root.add(far);

  for (const side of [-1, 1]) {
    const sideWall = box(ku(ROOM.wall), wallHeight, ku(ROOM.depth), PALETTE.wall);
    sideWall.position.set(side * ku(ROOM.width / 2), wallHeight / 2, 0);
    sideWall.receiveShadow = true;
    root.add(sideWall);
  }

  const near = box(ku(ROOM.width), 0.3, ku(ROOM.wall), PALETTE.wallTop);
  near.position.set(0, 0.15, kz(ROOM.depth));
  root.add(near);

  /* ------------------------------------------------------------ the door */

  const door = new THREE.Group();
  const frame = box(ku(PLACES.door.w) + 0.12, 1.5, 0.1, PALETTE.doorFrame);
  frame.position.y = 0.75;
  door.add(frame);
  const leaf = box(ku(PLACES.door.w), 1.36, 0.08, PALETTE.door);
  leaf.position.set(0, 0.7, 0.04);
  door.add(leaf);
  const knob = ball(0.05, 0xffd166);
  knob.position.set(ku(PLACES.door.w) / 2 - 0.12, 0.7, 0.1);
  door.add(knob);
  door.position.set(kx(PLACES.door.x), 0, kz(PLACES.door.y) - 0.06);
  root.add(door);

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
  // Toys poking out of the top.
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

  for (const dx of [-0.58, 0.1]) {
    const mattress = box(0.6, 0.18, 0.95, PALETTE.cot);
    mattress.position.set(dx, 0.26, 0);
    mattress.castShadow = true;
    cots.add(mattress);
    for (const dz of [-0.47, 0.47]) {
      const end = box(0.64, 0.42, 0.06, PALETTE.cotFrame);
      end.position.set(dx, 0.3, dz);
      cots.add(end);
    }
    const pillow = box(0.42, 0.1, 0.22, 0xfff3d6);
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
      legMesh.position.set(
        dx * (ku(PLACES.table.w) / 2 - 0.1),
        0.23,
        dz * (ku(PLACES.table.h) / 2 - 0.1),
      );
      table.add(legMesh);
    }
  }

  // A pot of crayons and a sheet of paper, so it reads as the drawing table.
  const pot = cyl(0.09, 0.08, 0.14, 0xffffff);
  pot.position.set(-0.3, 0.57, 0);
  table.add(pot);
  const crayonColours = [0xff5a5a, 0x4aa8ff, 0x6bd36b, 0xffd166, 0xb77cff];
  crayonColours.forEach((colour, index) => {
    const crayon = cyl(0.016, 0.016, 0.2, colour);
    crayon.position.set(-0.3 + (index - 2) * 0.028, 0.66, (index % 2) * 0.02);
    crayon.rotation.z = (index - 2) * 0.1;
    table.add(crayon);
  });

  const paper = box(0.3, 0.012, 0.22, 0xffffff);
  paper.position.set(0.22, 0.51, 0);
  paper.rotation.y = 0.2;
  table.add(paper);
  for (const [dx, dz, colour] of [
    [0.18, -0.04, 0xff5a5a],
    [0.26, 0.04, 0x4aa8ff],
  ] as const) {
    const scribble = box(0.07, 0.004, 0.05, colour);
    scribble.position.set(dx, 0.518, dz);
    table.add(scribble);
  }

  // Two little stools at the ends, where they stay on screen.
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

  return { root, clickable, door };
}

/** The yellow ring that shows which thing you have selected. */
export function buildHighlightRing(): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.34, 0.44, 28),
    new THREE.MeshBasicMaterial({ color: PALETTE.highlight, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = false;
  return ring;
}
