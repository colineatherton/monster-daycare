/**
 * Secret names.
 *
 * What you call your daycare on the front screen is normally just a label in
 * the corner. Two names are not.
 */

export type SecretMode = 'normal' | 'rotted' | 'nightcare';

/** Loose matching, so capitals and stray spaces do not spoil it. */
function tidy(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function secretFor(daycareName: string): SecretMode {
  const name = tidy(daycareName);
  if (name === 'the rotted monster daycare' || name === 'rotted monster daycare') return 'rotted';
  if (name === 'monster nightcare' || name === 'the monster nightcare') return 'nightcare';
  return 'normal';
}

/** What the front screen says once you have typed one of them. */
export function secretTeaser(mode: SecretMode): string | null {
  switch (mode) {
    case 'rotted':
      return 'Something is wrong with that name.';
    case 'nightcare':
      return 'Night shift. You will have the keys to everything.';
    default:
      return null;
  }
}
