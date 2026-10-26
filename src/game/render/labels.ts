import * as THREE from 'three';

/**
 * Floating text and thought bubbles, drawn onto a canvas and hung in the world
 * as a sprite. No font files, no asset loading — the browser already has fonts.
 */

function canvasTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, width = 256, height = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * The bubble that hangs over a baby's head showing what it wants. `urgent`
 * turns it red, which is what an anomaly's bubble does while the fuse burns.
 */
export function thoughtBubble(emoji: string, urgent: boolean): THREE.Sprite {
  const texture = canvasTexture((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = urgent ? '#ff3b3b' : '#ffffff';
    ctx.strokeStyle = urgent ? '#7a0000' : '#2b2b33';
    ctx.lineWidth = 10;
    roundedRect(ctx, 24, 18, w - 48, h - 90, 44);
    ctx.fill();
    ctx.stroke();

    // The two little trailing bubbles, so it reads as a thought not a shout.
    for (const [cx, cy, r] of [
      [w / 2 - 10, h - 62, 20],
      [w / 2 - 26, h - 24, 12],
    ] as const) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.font = '96px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, w / 2, h / 2 - 22);
  });

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.renderOrder = 10;
  sprite.scale.set(0.72, 0.72, 1);
  return sprite;
}

/** A name tag, or any short bit of text, floating in the world. */
export function textLabel(text: string, colour = '#2b2b33'): THREE.Sprite {
  const texture = canvasTexture(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.font = 'bold 64px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 12;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText(text, w / 2, h / 2);
      ctx.fillStyle = colour;
      ctx.fillText(text, w / 2, h / 2);
    },
    512,
    128,
  );

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.renderOrder = 11;
  sprite.scale.set(1.15, 0.29, 1);
  return sprite;
}
