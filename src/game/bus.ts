import type { GameSnapshot } from './types/game.ts';

/**
 * One-way channel from the game loop to React. The loop pushes a snapshot, the
 * HUD re-renders. React never reaches into the 3D world directly; it sends
 * commands back through `commands`.
 */

type Listener = (snapshot: GameSnapshot) => void;

const listeners = new Set<Listener>();
let latest: GameSnapshot | null = null;

export function publish(snapshot: GameSnapshot): void {
  latest = snapshot;
  for (const listener of listeners) listener(snapshot);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (latest) listener(latest);
  return () => {
    listeners.delete(listener);
  };
}

/** What the HUD can ask the game to do. */
export interface Commands {
  chooseMenuAction: (actionId: string) => void;
  /** Open a child's menu from the list down the side, wherever it is. */
  selectBaby: (babyId: string) => void;
  closeMenu: () => void;
  restart: () => void;
  /** Dismiss the home-time card and open up again tomorrow. */
  nextDay: () => void;
  toggleMusic: () => void;
  /** Night shift only: the admin panel's buttons. */
  admin: (what: string) => void;
}

export const commands: { current: Commands | null } = { current: null };
