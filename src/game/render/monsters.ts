import * as THREE from 'three';
import { ball, box, cyl, mat, torus } from './three-helpers.ts';
import { PALETTE } from './palette.ts';
import type { Species } from '../types/game.ts';

/**
 * The baby monsters, built out of plain shapes to match Wren's character sheet:
 * a lumpy body, two antennae with little loops on the ends, dot eyes, a smile,
 * stick arms that end in loops and stick legs with blobby feet.
 *
 * Every baby's shadow is a flat shape we draw ourselves rather than a real cast
 * shadow — which is the whole reason the shadow anomaly works. Its body is an
 * ordinary monster and its shadow is a horned triangle, and the two not
 * matching is the tell.
 */

export interface BabyModel {
  root: THREE.Group;
  /** Turns to face where the baby is walking. The shadow does not. */
  body: THREE.Group;
  shadow: THREE.Group;
  /** Where a thought bubble hangs. */
  bubbleHeight: number;
  /** Arms and legs, for the toddling wobble. */
  limbs: THREE.Object3D[];
}

/** Two thin antennae, each with a loop on top, like every monster she drew. */
function antennae(colour: number, spread: number, height: number): THREE.Group {
  const group = new THREE.Group();
  for (const side of [-1, 1]) {
    const stalk = cyl(0.019, 0.019, height, colour);
    stalk.position.set(side * spread, height / 2, 0);
    stalk.rotation.z = side * -0.12;
    group.add(stalk);

    const loop = torus(0.046, 0.016, colour);
    loop.position.set(side * (spread + side * 0.02), height, 0);
    group.add(loop);
  }
  return group;
}

/** A stick arm ending in a little loop for a hand. */
function arm(colour: number, side: number, length: number): THREE.Group {
  const group = new THREE.Group();
  const stick = cyl(0.018, 0.018, length, colour);
  stick.position.y = -length / 2;
  group.add(stick);

  const hand = torus(0.038, 0.015, colour);
  hand.position.y = -length;
  hand.rotation.y = Math.PI / 2;
  group.add(hand);

  group.rotation.z = side * 1.15;
  return group;
}

/** A stick leg with a blobby foot. */
function leg(colour: number, length: number): THREE.Group {
  const group = new THREE.Group();
  const stick = cyl(0.021, 0.021, length, colour);
  stick.position.y = -length / 2;
  group.add(stick);

  const foot = ball(0.046, colour);
  foot.scale.set(1, 0.7, 1.25);
  foot.position.y = -length;
  group.add(foot);
  return group;
}

/** Two dot eyes and a smile, on the +z side of the body. */
function face(radiusZ: number, eyeSpread: number, eyeHeight: number): THREE.Group {
  const group = new THREE.Group();

  for (const side of [-1, 1]) {
    const white = ball(0.045, PALETTE.eyeWhite);
    white.scale.set(0.8, 1.15, 0.5);
    white.position.set(side * eyeSpread, eyeHeight, radiusZ);
    group.add(white);

    const pupil = ball(0.022, PALETTE.pupil);
    pupil.scale.set(1, 1.2, 0.6);
    pupil.position.set(side * eyeSpread, eyeHeight, radiusZ + 0.025);
    group.add(pupil);
  }

  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.07, 0.012, 8, 20, Math.PI),
    mat(PALETTE.mouth),
  );
  smile.rotation.z = Math.PI;
  smile.position.set(0, eyeHeight - 0.11, radiusZ);
  group.add(smile);

  return group;
}

/**
 * Teeth sticking out, the ritual anomaly's tell. Deliberately too big and
 * poking out past the mouth, so you can see them across the room.
 */
function teeth(radiusZ: number, mouthHeight: number): THREE.Group {
  const group = new THREE.Group();
  for (const offset of [-0.055, -0.018, 0.018, 0.055]) {
    const tooth = box(0.03, 0.075, 0.02, PALETTE.tooth);
    tooth.position.set(offset, mouthHeight - 0.03, radiusZ + 0.01);
    group.add(tooth);
  }
  // Two longer fangs at the outside, which is what makes it read as "wrong".
  for (const side of [-1, 1]) {
    const fang = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.11, 8), mat(PALETTE.tooth));
    fang.rotation.x = Math.PI;
    fang.position.set(side * 0.085, mouthHeight - 0.05, radiusZ);
    group.add(fang);
  }
  return group;
}

/** The ordinary shadow: a soft dark oval on the floor. */
function plainShadow(): THREE.Group {
  const group = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.3, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.scale.set(1, 0.8, 1);
  group.add(disc);
  return group;
}

/**
 * The shadow anomaly's shadow: a horned triangle with eyes, which is nothing
 * like the round little monster standing on top of it.
 */
function demonShadow(): THREE.Group {
  const group = new THREE.Group();
  const dark = new THREE.MeshBasicMaterial({
    color: PALETTE.shadowDemon,
    transparent: true,
    opacity: 0.55,
  });

  // A 3-segment circle is a triangle. Point it away from the camera.
  const bodyTriangle = new THREE.Mesh(new THREE.CircleGeometry(0.42, 3), dark);
  bodyTriangle.rotation.x = -Math.PI / 2;
  bodyTriangle.rotation.z = Math.PI / 2;
  group.add(bodyTriangle);

  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.CircleGeometry(0.16, 3), dark);
    horn.rotation.x = -Math.PI / 2;
    horn.rotation.z = side * 0.6 + Math.PI / 2;
    horn.position.set(side * 0.2, 0, -0.3);
    group.add(horn);
  }

  // Two little gaps for eyes, in the floor colour, so it has a face.
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.floor, transparent: true, opacity: 0.9 });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.CircleGeometry(0.045, 10), eyeMaterial);
    eye.rotation.x = -Math.PI / 2;
    eye.position.set(side * 0.09, 0.002, -0.06);
    group.add(eye);
  }

  return group;
}

export function buildBaby(species: Species): BabyModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const limbs: THREE.Object3D[] = [];

  const colour = species.colour;
  let bodyRadiusZ = 0.26;
  let bodyTop = 0.5;
  let legLength = 0.14;

  if (species.shape === 'blob') {
    const blob = ball(0.27, colour);
    blob.scale.set(1.15, 1.0, 0.92);
    blob.position.y = 0.34;
    body.add(blob);
    // A second lump, because none of her monsters are perfectly round.
    const lump = ball(0.15, colour);
    lump.position.set(0.16, 0.48, 0);
    body.add(lump);
    bodyRadiusZ = 0.25;
    bodyTop = 0.58;
  } else if (species.shape === 'square') {
    const cube = box(0.46, 0.44, 0.4, colour);
    cube.position.y = 0.36;
    body.add(cube);
    bodyRadiusZ = 0.205;
    bodyTop = 0.58;
  } else {
    const oval = ball(0.28, colour);
    oval.scale.set(1.45, 0.72, 0.85);
    oval.position.y = 0.33;
    body.add(oval);
    bodyRadiusZ = 0.24;
    bodyTop = 0.52;
    legLength = 0.18;
  }

  const horns = antennae(colour, 0.1, 0.17);
  horns.position.y = bodyTop - 0.02;
  body.add(horns);

  const eyeHeight = species.shape === 'oval' ? 0.36 : 0.4;
  body.add(face(bodyRadiusZ, 0.1, eyeHeight));
  if (species.anomaly === 'ritual') body.add(teeth(bodyRadiusZ, eyeHeight - 0.08));

  for (const side of [-1, 1]) {
    const a = arm(colour, side, 0.2);
    a.position.set(side * 0.24, 0.4, 0);
    body.add(a);
    limbs.push(a);
  }

  for (const side of [-1, 1]) {
    const l = leg(colour, legLength);
    l.position.set(side * 0.1, legLength, 0);
    body.add(l);
    limbs.push(l);
  }

  const shadow = species.anomaly === 'shadow' ? demonShadow() : plainShadow();
  shadow.position.y = 0.015;

  root.add(shadow);
  root.add(body);
  // Babies are deliberately big for their room. If you cannot read the face
  // from where the camera sits, none of the monster design matters.
  root.scale.setScalar(1.35);

  return { root, body, shadow, bubbleHeight: bodyTop + 0.62, limbs };
}

/**
 * The ritual form: when a ritual anomaly's fuse runs out it stops being a cute
 * square monster and becomes the spiky triangle from the drawing, floating.
 */
export function buildRitualForm(): THREE.Group {
  const group = new THREE.Group();

  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.8, 3), mat(0x2a1e3d, { emissive: 0x6b2d8c, emissiveIntensity: 0.6 }));
  cone.rotation.x = Math.PI;
  cone.position.y = 0.5;
  group.add(cone);

  // Spikes along the top, like the drawing.
  for (const offset of [-0.26, -0.09, 0.09, 0.26]) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.22, 6), mat(0x2a1e3d));
    spike.position.set(offset, 0.95, 0);
    group.add(spike);
  }

  for (const side of [-1, 1]) {
    const eye = ball(0.05, 0xff4d4d, { emissive: 0xff0000, emissiveIntensity: 1.4 });
    eye.position.set(side * 0.1, 0.62, 0.22);
    group.add(eye);
  }

  return group;
}
