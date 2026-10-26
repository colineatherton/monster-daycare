/**
 * Keyboard state, read by the game loop every frame.
 *
 * You walk with the keys and you click to do things. Walking yourself cancels
 * any "walk over there and then do the thing" the menu set going.
 */

const pressed = new Set<string>();

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export function attachInput(): () => void {
  const down = (event: KeyboardEvent): void => {
    if (MOVE_KEYS[event.code] || event.code === 'Escape') event.preventDefault();
    pressed.add(event.code);
  };
  const up = (event: KeyboardEvent): void => {
    pressed.delete(event.code);
  };
  const blur = (): void => pressed.clear();

  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);

  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', blur);
    pressed.clear();
  };
}

/** Normalised walk direction from the keys, in room-plan axes. */
export function walkVector(): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const code of pressed) {
    const dir = MOVE_KEYS[code];
    if (!dir) continue;
    x += dir[0];
    y += dir[1];
  }
  const length = Math.hypot(x, y);
  if (length === 0) return { x: 0, y: 0 };
  return { x: x / length, y: y / length };
}

export function isPressed(code: string): boolean {
  return pressed.has(code);
}

/** Touch stick, written by React and read by the loop. */
export const touch = { x: 0, y: 0, active: false };
