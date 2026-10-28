import * as THREE from 'three';
import { ball, box, cyl, dome, mat, torus } from './three-helpers.ts';
import { PALETTE } from './palette.ts';

/**
 * The two skins Wren drew: the Teacher (long hair, glasses, a heart on her top)
 * and the Robot (a slab head on a springy segmented neck).
 */

export type SkinId = 'teacher' | 'robot' | 'lsaCardigan' | 'lsaApron' | 'lsaHoodie';

/** Everybody you can be, in the order they appear on the front screen. */
export const SKINS: Array<{ id: SkinId; label: string; face: string }> = [
  { id: 'teacher', label: 'The Teacher', face: '👩‍🏫' },
  { id: 'robot', label: 'The Robot', face: '🤖' },
  { id: 'lsaCardigan', label: 'Mr Ashworth', face: '🧑‍🏫' },
  { id: 'lsaApron', label: 'Miss Dey', face: '🧑‍🍳' },
  { id: 'lsaHoodie', label: 'Sam', face: '🧢' },
];

export interface PlayerModel {
  root: THREE.Group;
  /** Turns to face where you are walking. */
  body: THREE.Group;
  /** Whatever you are carrying is parented here. */
  hands: THREE.Group;
  legs: THREE.Object3D[];
}

function teacher(): { body: THREE.Group; hands: THREE.Group; legs: THREE.Object3D[] } {
  const body = new THREE.Group();
  const legs: THREE.Object3D[] = [];

  const torso = box(0.42, 0.5, 0.26, PALETTE.teacherTop);
  torso.position.y = 0.72;
  body.add(torso);

  // The heart on her top.
  for (const [dx, dy] of [[-0.045, 0.78], [0.045, 0.78]] as const) {
    const lobe = ball(0.045, 0xff4d79);
    lobe.scale.z = 0.4;
    lobe.position.set(dx, dy, 0.13);
    body.add(lobe);
  }
  const heartTip = new THREE.Mesh(new THREE.ConeGeometry(0.062, 0.09, 4), mat(0xff4d79));
  heartTip.rotation.x = Math.PI;
  heartTip.rotation.y = Math.PI / 4;
  heartTip.scale.z = 0.4;
  heartTip.position.set(0, 0.715, 0.13);
  body.add(heartTip);

  const head = ball(0.21, PALETTE.teacherSkin);
  head.position.y = 1.14;
  body.add(head);

  // Hair. The camera looks down on her, so the top of the head is the part you
  // see most — it gets a proper cap of hair, not just a fringe and curtains.
  // The dome has to sit comfortably outside the skull at every point, or the
  // crown pokes through it and she looks like she is going bald.
  const cap = dome(0.238, PALETTE.teacherHair);
  cap.position.y = 1.095;
  cap.scale.set(1.02, 1.32, 1.08);
  body.add(cap);

  // And a band around the back and sides at the same height, so there is no
  // seam between the cap and the long hair.
  const band = ball(0.228, PALETTE.teacherHair);
  band.scale.set(1.02, 0.8, 1.06);
  band.position.set(0, 1.1, -0.045);
  body.add(band);

  // Long hair: a back slab and two side curtains.
  const back = box(0.4, 0.46, 0.16, PALETTE.teacherHair);
  back.position.set(0, 1.02, -0.13);
  body.add(back);
  for (const side of [-1, 1]) {
    const curtain = box(0.1, 0.46, 0.24, PALETTE.teacherHair);
    curtain.position.set(side * 0.19, 1.04, -0.01);
    body.add(curtain);
  }
  const fringe = box(0.38, 0.12, 0.12, PALETTE.teacherHair);
  fringe.position.set(0, 1.26, 0.14);
  body.add(fringe);

  // Glasses.
  for (const side of [-1, 1]) {
    const lens = torus(0.055, 0.012, 0x3a3a44);
    lens.position.set(side * 0.08, 1.13, 0.2);
    body.add(lens);
  }

  for (const side of [-1, 1]) {
    const upper = cyl(0.05, 0.05, 0.34, PALETTE.teacherSkin);
    upper.position.set(side * 0.26, 0.76, 0);
    body.add(upper);
  }

  for (const side of [-1, 1]) {
    const legGroup = new THREE.Group();
    const limb = cyl(0.06, 0.06, 0.46, 0x3f4a63);
    limb.position.y = -0.23;
    legGroup.add(limb);
    const shoe = box(0.13, 0.08, 0.2, 0x2b2b33);
    shoe.position.set(0, -0.46, 0.03);
    legGroup.add(shoe);
    legGroup.position.set(side * 0.11, 0.48, 0);
    body.add(legGroup);
    legs.push(legGroup);
  }

  const hands = new THREE.Group();
  hands.position.set(0, 0.78, 0.3);
  body.add(hands);

  return { body, hands, legs };
}

function robot(): { body: THREE.Group; hands: THREE.Group; legs: THREE.Object3D[] } {
  const body = new THREE.Group();
  const legs: THREE.Object3D[] = [];

  const torso = box(0.5, 0.46, 0.3, PALETTE.robotBody);
  torso.position.y = 0.7;
  body.add(torso);
  for (const y of [0.62, 0.74]) {
    const ridge = box(0.36, 0.03, 0.02, PALETTE.robotTrim);
    ridge.position.set(0, y, 0.155);
    body.add(ridge);
  }

  // The springy segmented neck from the drawing.
  for (let i = 0; i < 4; i += 1) {
    const segment = cyl(0.07, 0.07, 0.06, PALETTE.robotTrim);
    segment.position.y = 0.98 + i * 0.075;
    body.add(segment);
  }

  const head = box(0.46, 0.34, 0.28, PALETTE.robotBody);
  head.position.y = 1.42;
  body.add(head);
  for (const y of [1.36, 1.46]) {
    const ridge = box(0.3, 0.03, 0.02, PALETTE.robotTrim);
    ridge.position.set(0, y, 0.145);
    body.add(ridge);
  }
  for (const side of [-1, 1]) {
    const eye = ball(0.04, 0x6ef0ff, { emissive: 0x2bd5e8, emissiveIntensity: 1.1 });
    eye.position.set(side * 0.1, 1.45, 0.15);
    body.add(eye);
  }

  for (const side of [-1, 1]) {
    const upper = box(0.09, 0.34, 0.09, PALETTE.robotTrim);
    upper.position.set(side * 0.3, 0.74, 0);
    body.add(upper);
  }

  for (const side of [-1, 1]) {
    const legGroup = new THREE.Group();
    const limb = box(0.11, 0.44, 0.11, PALETTE.robotTrim);
    limb.position.y = -0.22;
    legGroup.add(limb);
    const foot = box(0.16, 0.08, 0.22, PALETTE.robotBody);
    foot.position.set(0, -0.45, 0.03);
    legGroup.add(foot);
    legGroup.position.set(side * 0.13, 0.47, 0);
    body.add(legGroup);
    legs.push(legGroup);
  }

  const hands = new THREE.Group();
  hands.position.set(0, 0.76, 0.32);
  body.add(hands);

  return { body, hands, legs };
}

/**
 * The learning support assistants: the other grown-ups in a daycare. Each is
 * built from the same parts as the teacher, so they read as the same species
 * of person, and told apart by one strong thing each — a cardigan and a beard,
 * an apron and a bun, a hoodie and a cap.
 */
function lsa(
  look: 'cardigan' | 'apron' | 'hoodie',
): { body: THREE.Group; hands: THREE.Group; legs: THREE.Object3D[] } {
  const body = new THREE.Group();
  const legs: THREE.Object3D[] = [];

  const kit = {
    cardigan: { top: 0xd98f4f, hair: 0x3a2a20, skin: 0xe3b68c, trousers: 0x4a4a58 },
    apron: { top: 0x58b58a, hair: 0x1f1b1a, skin: 0x8a5a3c, trousers: 0x3f4a63 },
    hoodie: { top: 0x7c6bd6, hair: 0xd8b25a, skin: 0xf0cfae, trousers: 0x2f3b4a },
  }[look];

  const torso = box(0.44, 0.5, 0.27, kit.top);
  torso.position.y = 0.72;
  body.add(torso);

  if (look === 'cardigan') {
    // A cardigan: a lighter panel down the front with two buttons.
    const front = box(0.16, 0.5, 0.02, 0xf3e2c7);
    front.position.set(0, 0.72, 0.14);
    body.add(front);
    for (const y of [0.84, 0.68]) {
      const button = ball(0.02, 0x6b4430);
      button.position.set(0, y, 0.155);
      body.add(button);
    }
  } else if (look === 'apron') {
    const apron = box(0.3, 0.42, 0.02, 0xfdf6e8);
    apron.position.set(0, 0.68, 0.145);
    body.add(apron);
    for (const side of [-1, 1]) {
      const strap = box(0.045, 0.2, 0.02, 0xfdf6e8);
      strap.position.set(side * 0.1, 0.92, 0.14);
      body.add(strap);
    }
    const pocket = box(0.16, 0.1, 0.02, 0xe8dcc6);
    pocket.position.set(0, 0.58, 0.16);
    body.add(pocket);
  } else {
    // A hoodie: a pouch, a drawstring and a hood bunched at the back.
    const pouch = box(0.26, 0.12, 0.03, 0x6a5ac0);
    pouch.position.set(0, 0.6, 0.15);
    body.add(pouch);
    const hood = ball(0.17, kit.top);
    hood.scale.set(1.1, 0.7, 0.7);
    hood.position.set(0, 0.95, -0.14);
    body.add(hood);
    for (const side of [-1, 1]) {
      const string = cyl(0.008, 0.008, 0.12, 0xf3f3f6);
      string.position.set(side * 0.05, 0.88, 0.15);
      body.add(string);
    }
  }

  const head = ball(0.21, kit.skin);
  head.position.y = 1.14;
  body.add(head);

  const cap = dome(0.232, kit.hair);
  cap.position.y = 1.1;
  cap.scale.set(1.02, look === 'apron' ? 1.1 : 1.28, 1.06);
  body.add(cap);

  if (look === 'cardigan') {
    // A short beard, which is all it takes to be a different person.
    const beard = box(0.24, 0.12, 0.1, kit.hair);
    beard.position.set(0, 1.0, 0.14);
    body.add(beard);
  } else if (look === 'apron') {
    const bun = ball(0.08, kit.hair);
    bun.position.set(0, 1.25, -0.18);
    body.add(bun);
  } else {
    const peak = box(0.26, 0.04, 0.14, 0x3b3570);
    peak.position.set(0, 1.26, 0.18);
    body.add(peak);
    const crown = dome(0.21, 0x3b3570);
    crown.position.y = 1.19;
    crown.scale.y = 0.85;
    body.add(crown);
  }

  for (const side of [-1, 1]) {
    const eye = ball(0.022, PALETTE.pupil);
    eye.position.set(side * 0.07, 1.14, 0.2);
    body.add(eye);
  }

  // A lanyard, because every assistant in every school has one.
  const lanyard = box(0.03, 0.22, 0.02, 0x2b7fd4);
  lanyard.position.set(0.05, 0.86, 0.145);
  body.add(lanyard);
  const badge = box(0.09, 0.12, 0.015, 0xfdfdfd);
  badge.position.set(0.05, 0.7, 0.15);
  body.add(badge);

  for (const side of [-1, 1]) {
    const upper = cyl(0.052, 0.052, 0.34, kit.top);
    upper.position.set(side * 0.27, 0.76, 0);
    body.add(upper);
    const hand = ball(0.05, kit.skin);
    hand.position.set(side * 0.27, 0.58, 0);
    body.add(hand);
  }

  for (const side of [-1, 1]) {
    const legGroup = new THREE.Group();
    const limb = cyl(0.062, 0.062, 0.46, kit.trousers);
    limb.position.y = -0.23;
    legGroup.add(limb);
    const shoe = box(0.13, 0.08, 0.2, 0x2b2b33);
    shoe.position.set(0, -0.46, 0.03);
    legGroup.add(shoe);
    legGroup.position.set(side * 0.11, 0.48, 0);
    body.add(legGroup);
    legs.push(legGroup);
  }

  const hands = new THREE.Group();
  hands.position.set(0, 0.78, 0.3);
  body.add(hands);

  return { body, hands, legs };
}

export function buildPlayer(skin: SkinId): PlayerModel {
  const built =
    skin === 'robot'
      ? robot()
      : skin === 'lsaCardigan'
        ? lsa('cardigan')
        : skin === 'lsaApron'
          ? lsa('apron')
          : skin === 'lsaHoodie'
            ? lsa('hoodie')
            : teacher();
  const root = new THREE.Group();
  root.add(built.body);
  return { root, body: built.body, hands: built.hands, legs: built.legs };
}

/**
 * The parents. Much bigger than the babies — that was the point. Two of them,
 * matching the drawing: a shaggy spiky one and a big smiley blob.
 */
export function buildParent(kind: 'shaggy' | 'blob', colour: number): THREE.Group {
  const group = new THREE.Group();

  if (kind === 'shaggy') {
    const core = ball(0.6, colour);
    core.scale.set(1, 1.2, 1);
    core.position.y = 1.1;
    group.add(core);
    // Spikes everywhere, which is how the scribble in the drawing reads.
    for (let i = 0; i < 44; i += 1) {
      const angle = (i / 44) * Math.PI * 2 * 3.1;
      const lift = (i / 44) * 1.2 - 0.3;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.42, 5), mat(colour));
      const radius = 0.52;
      spike.position.set(Math.cos(angle) * radius, 1.1 + lift * 0.6, Math.sin(angle) * radius);
      spike.lookAt(spike.position.clone().multiplyScalar(2).setY(spike.position.y + lift));
      spike.rotateX(Math.PI / 2);
      group.add(spike);
    }
  } else {
    const core = ball(0.68, colour);
    core.scale.set(1.1, 1.15, 0.95);
    core.position.y = 1.05;
    group.add(core);
    const lump = ball(0.3, colour);
    lump.position.set(0.4, 1.5, 0);
    group.add(lump);
  }

  for (const side of [-1, 1]) {
    const eye = ball(0.075, PALETTE.pupil);
    eye.scale.set(0.7, 1.3, 0.6);
    eye.position.set(side * 0.19, 1.22, 0.6);
    group.add(eye);
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.028, 8, 20, Math.PI), mat(PALETTE.mouth));
  smile.rotation.z = Math.PI;
  smile.position.set(0, 0.98, 0.58);
  group.add(smile);

  for (const side of [-1, 1]) {
    const limb = cyl(0.025, 0.025, 0.4, colour);
    limb.position.set(side * 0.72, 1.0, 0.1);
    limb.rotation.z = side * 0.9;
    group.add(limb);
  }
  for (const side of [-1, 1]) {
    const limb = cyl(0.03, 0.03, 0.42, colour);
    limb.position.set(side * 0.22, 0.22, 0);
    group.add(limb);
  }

  return group;
}
