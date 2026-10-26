import * as THREE from 'three';
import { ball, box, cyl, mat } from './three-helpers.ts';
import type { Item } from '../types/game.ts';

/** A little model for whatever you are carrying, held out in front of you. */
export function buildItem(item: Item): THREE.Group {
  const group = new THREE.Group();

  switch (item.kind) {
    case 'drink': {
      const bottle = cyl(0.07, 0.09, 0.22, item.colour);
      bottle.position.y = 0.11;
      group.add(bottle);
      const teat = cyl(0.03, 0.05, 0.08, 0xffc9c9);
      teat.position.y = 0.26;
      group.add(teat);
      break;
    }
    case 'blanket': {
      const folded = box(0.26, 0.1, 0.2, item.colour);
      folded.position.y = 0.06;
      group.add(folded);
      const fold = box(0.27, 0.03, 0.21, 0xffffff);
      fold.position.y = 0.12;
      group.add(fold);
      break;
    }
    case 'tea': {
      const mug = cyl(0.08, 0.07, 0.14, 0xffffff);
      mug.position.y = 0.07;
      group.add(mug);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 8, 16), mat(0xffffff));
      handle.position.set(0.09, 0.07, 0);
      group.add(handle);
      const surface = new THREE.Mesh(new THREE.CircleGeometry(0.072, 16), mat(item.colour));
      surface.rotation.x = -Math.PI / 2;
      surface.position.y = 0.135;
      group.add(surface);
      break;
    }
    case 'instrument': {
      if (item.id === 'drum') {
        const drum = cyl(0.12, 0.12, 0.14, item.colour);
        drum.position.y = 0.09;
        group.add(drum);
        const skin = new THREE.Mesh(new THREE.CircleGeometry(0.12, 18), mat(0xfff3d6));
        skin.rotation.x = -Math.PI / 2;
        skin.position.y = 0.161;
        group.add(skin);
      } else if (item.id === 'trumpet') {
        const tube = cyl(0.028, 0.028, 0.26, item.colour);
        tube.rotation.z = Math.PI / 2;
        tube.position.y = 0.12;
        group.add(tube);
        const bell = cyl(0.09, 0.035, 0.1, item.colour);
        bell.rotation.z = -Math.PI / 2;
        bell.position.set(0.17, 0.12, 0);
        group.add(bell);
      } else {
        [0.07, 0.055].forEach((radius, index) => {
          const bell = ball(radius, item.colour);
          bell.scale.y = 0.85;
          bell.position.set((index - 0.5) * 0.14, 0.1, 0);
          group.add(bell);
        });
      }
      break;
    }
    case 'maths': {
      if (item.id === 'blocks') {
        [0x5aa9ff, 0xff7a7a, 0x7ed957].forEach((colour, index) => {
          const cube = box(0.11, 0.11, 0.11, colour);
          cube.position.set((index - 1) * 0.055, 0.06 + index * 0.1, 0);
          cube.rotation.y = index * 0.3;
          group.add(cube);
        });
      } else if (item.id === 'abacus') {
        const frame = box(0.28, 0.22, 0.04, item.colour);
        frame.position.y = 0.14;
        group.add(frame);
        for (let row = 0; row < 2; row += 1) {
          for (let i = 0; i < 3; i += 1) {
            const bead = ball(0.026, row === 0 ? 0xff5a5a : 0x4aa8ff);
            bead.position.set(-0.06 + i * 0.06, 0.1 + row * 0.08, 0.03);
            group.add(bead);
          }
        }
      } else {
        const shapeBox = box(0.2, 0.14, 0.16, item.colour);
        shapeBox.position.y = 0.07;
        group.add(shapeBox);
        const triangle = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.1, 3), mat(0xff7a7a));
        triangle.position.set(-0.03, 0.19, 0);
        group.add(triangle);
      }
      break;
    }
    case 'crayons': {
      const pot = cyl(0.08, 0.07, 0.12, 0xffffff);
      pot.position.y = 0.06;
      group.add(pot);
      [0xff5a5a, 0x4aa8ff, 0x6bd36b, 0xffd166].forEach((colour, index) => {
        const crayon = cyl(0.015, 0.015, 0.18, colour);
        crayon.position.set((index - 1.5) * 0.026, 0.16, 0);
        crayon.rotation.z = (index - 1.5) * 0.12;
        group.add(crayon);
      });
      break;
    }
    case 'toy': {
      if (item.id === 'teddy') {
        const bodyMesh = ball(0.1, item.colour);
        bodyMesh.position.y = 0.1;
        group.add(bodyMesh);
        const head = ball(0.07, item.colour);
        head.position.y = 0.24;
        group.add(head);
        for (const side of [-1, 1]) {
          const ear = ball(0.03, item.colour);
          ear.position.set(side * 0.055, 0.29, 0);
          group.add(ear);
        }
      } else {
        const blob = ball(0.1, item.colour);
        blob.position.y = 0.1;
        group.add(blob);
      }
      break;
    }
    default: {
      // Food sits on a little plate so you can see you are carrying something.
      const plate = cyl(0.14, 0.13, 0.03, 0xffffff);
      plate.position.y = 0.02;
      group.add(plate);
      const food = ball(0.08, item.colour);
      food.scale.y = item.tags.includes('crunchy') ? 0.6 : 1;
      food.position.y = 0.09;
      group.add(food);
      if (item.id === 'sock') {
        const toe = box(0.09, 0.05, 0.14, item.colour);
        toe.position.set(0.04, 0.08, 0.03);
        group.add(toe);
      }
      break;
    }
  }

  return group;
}

/** A soft glow under something, used for the anomaly warning. */
export function buildDreadGlow(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 32),
    new THREE.MeshBasicMaterial({
      color: 0xff2b2b,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    }),
  );
}
