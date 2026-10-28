/**
 * The long game.
 *
 * Wren's Easter eggs run across twenty shifts, and a run ends the first time an
 * anomaly gets you — so counting shifts inside a run would mean never seeing
 * any of them. Instead this counts **shifts you have ever worked**, kept in the
 * browser, and the story beats hang off that. Lose the run, open up again, and
 * the story carries on from where it was.
 */

const KEY = 'monster-daycare:story';

export interface StoryState {
  /** How many shifts have ever been finished. The story clock. */
  shiftsWorked: number;
  /** You gave Pip a teddy, once, and he has not forgotten. */
  pipTeddy: boolean;
  /** Bob's teddy has been left on the playroom floor. */
  teddyDropped: boolean;
  /** And you went back for it. */
  teddyFound: boolean;
  /** Bob found out what he is, because nobody went back for it. */
  bobTurned: boolean;
}

const EMPTY: StoryState = {
  shiftsWorked: 0,
  pipTeddy: false,
  teddyDropped: false,
  teddyFound: false,
  bobTurned: false,
};

export function loadStory(): StoryState {
  try {
    const raw = window.localStorage?.getItem(KEY);
    if (!raw) return { ...EMPTY };
    // Spread the defaults under it, so a save from an older version that is
    // missing a field still loads rather than throwing the whole story away.
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<StoryState>) };
  } catch {
    return { ...EMPTY };
  }
}

export function saveStory(state: StoryState): void {
  try {
    window.localStorage?.setItem(KEY, JSON.stringify(state));
  } catch {
    // A browser with storage switched off still gets to play, it just forgets.
  }
}

export function forgetStory(): void {
  try {
    window.localStorage?.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

/** The shift you are working right now, counting from one. */
export function currentShift(state: StoryState): number {
  return state.shiftsWorked + 1;
}
