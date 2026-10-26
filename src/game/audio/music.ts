/**
 * Background music, synthesised with the Web Audio API.
 *
 * There is no audio file to ship, download or license — the tune is built from
 * oscillators at runtime: a soft chord pad, a bouncy marimba-ish melody and a
 * gentle heartbeat of a bass. It loops forever over a four-chord progression.
 *
 * Browsers (and iPad especially) will not let audio start until the user has
 * interacted with the page, so `start()` is called from the Start button.
 */

/** Semitone offsets from A, used to turn note names into frequencies. */
const NOTE_FREQUENCIES: Record<string, number> = {
  C: 261.63,
  D: 293.66,
  E: 329.63,
  F: 349.23,
  G: 392.0,
  A: 440.0,
  B: 493.88,
};

function noteToHz(note: string): number {
  const name = note[0];
  const octave = Number(note.slice(1));
  // The table is octave 4; shift by whole octaves from there.
  return NOTE_FREQUENCIES[name] * 2 ** (octave - 4);
}

/** Four bars of a warm, major-key loop. */
const PROGRESSION: { chord: string[]; melody: (string | null)[] }[] = [
  { chord: ['C3', 'E4', 'G4'], melody: ['C5', 'E5', 'G5', 'E5', 'C5', null, 'G4', null] },
  { chord: ['A2', 'C4', 'E4'], melody: ['A4', 'C5', 'E5', 'C5', 'A4', null, 'E4', null] },
  { chord: ['F2', 'A3', 'C4'], melody: ['F4', 'A4', 'C5', 'A4', 'F4', null, 'C5', null] },
  { chord: ['G2', 'B3', 'D4'], melody: ['G4', 'B4', 'D5', 'B4', 'G4', 'D5', 'B4', null] },
];

const BEATS_PER_BAR = 8;
const SECONDS_PER_BEAT = 60 / 108 / 2; // ~108bpm in eighth notes

export class Music {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: number | null = null;
  private bar = 0;
  private nextNoteTime = 0;
  private started = false;
  private muted = false;

  get isMuted(): boolean {
    return this.muted;
  }

  /** Begin playing. Safe to call more than once. */
  start(): void {
    if (this.started) {
      void this.context?.resume();
      return;
    }

    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return; // no Web Audio: play on in silence

    this.context = new Ctor();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.16;

    // A little low-pass keeps the square/triangle edges soft rather than buzzy.
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    filter.Q.value = 0.7;

    this.master.connect(filter);
    filter.connect(this.context.destination);

    this.started = true;
    this.nextNoteTime = this.context.currentTime + 0.1;
    // Schedule ahead on a timer rather than per-note, which keeps timing
    // steady even when the game loop stutters.
    this.timer = window.setInterval(() => this.schedule(), 60);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.master || !this.context) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.16, this.context.currentTime, 0.05);
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.started = false;
  }

  /** Queue up any bars that fall inside the next second or so. */
  private schedule(): void {
    const context = this.context;
    if (!context || !this.master) return;

    while (this.nextNoteTime < context.currentTime + 0.6) {
      this.playBar(this.bar % PROGRESSION.length, this.nextNoteTime);
      this.nextNoteTime += BEATS_PER_BAR * SECONDS_PER_BEAT;
      this.bar += 1;
    }
  }

  private playBar(index: number, startTime: number): void {
    const { chord, melody } = PROGRESSION[index];
    const barLength = BEATS_PER_BAR * SECONDS_PER_BEAT;

    // Pad: the chord held softly under everything.
    for (const note of chord.slice(1)) {
      this.playTone(noteToHz(note), startTime, barLength * 0.98, 'triangle', 0.16, 0.25);
    }

    // Bass: one gentle note per bar, plus an off-beat lift.
    this.playTone(noteToHz(chord[0]), startTime, barLength * 0.45, 'sine', 0.5, 0.02);
    this.playTone(noteToHz(chord[0]) * 1.5, startTime + barLength * 0.5, barLength * 0.2, 'sine', 0.25, 0.02);

    // Melody: short plucked notes.
    melody.forEach((note, beat) => {
      if (!note) return;
      this.playTone(
        noteToHz(note),
        startTime + beat * SECONDS_PER_BEAT,
        SECONDS_PER_BEAT * 0.9,
        'triangle',
        0.34,
        0.005,
      );
    });
  }

  private playTone(
    frequency: number,
    startTime: number,
    duration: number,
    type: OscillatorType,
    peak: number,
    attack: number,
  ): void {
    const context = this.context;
    if (!context || !this.master) return;

    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, startTime);
    envelope.gain.exponentialRampToValueAtTime(peak, startTime + attack + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    oscillator.connect(envelope);
    envelope.connect(this.master);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.05);
  }

  /* --- one-off sounds, sharing the same context --- */

  /** A short rising chime for a happy customer. */
  coin(): void {
    if (!this.context || this.muted) return;
    const now = this.context.currentTime;
    this.playTone(noteToHz('E5'), now, 0.12, 'triangle', 0.3, 0.004);
    this.playTone(noteToHz('B5'), now + 0.08, 0.16, 'triangle', 0.26, 0.004);
  }

  /** A flat buzz for a rejected dish. */
  buzz(): void {
    if (!this.context || this.muted) return;
    const now = this.context.currentTime;
    this.playTone(120, now, 0.22, 'square', 0.2, 0.004);
  }

  /** A soft alarm. */
  alarm(): void {
    if (!this.context || this.muted) return;
    const now = this.context.currentTime;
    for (let i = 0; i < 3; i++) {
      this.playTone(660, now + i * 0.18, 0.12, 'square', 0.16, 0.004);
    }
  }

  /** One low thud. Called once a second while an anomaly's fuse burns down. */
  heartbeat(strength: number): void {
    if (!this.context || this.muted) return;
    const now = this.context.currentTime;
    this.playTone(55, now, 0.16, 'sine', 0.3 + strength * 0.5, 0.004);
    this.playTone(48, now + 0.17, 0.2, 'sine', 0.2 + strength * 0.4, 0.004);
  }

  /** The room going wrong. */
  dread(): void {
    if (!this.context || this.muted) return;
    const now = this.context.currentTime;
    this.playTone(110, now, 1.4, 'sawtooth', 0.12, 0.3);
    this.playTone(104, now, 1.4, 'sawtooth', 0.12, 0.3);
  }
}

export const music = new Music();
