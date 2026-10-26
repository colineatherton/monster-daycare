import * as THREE from 'three';
import { ball, box, cyl } from './three-helpers.ts';
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
