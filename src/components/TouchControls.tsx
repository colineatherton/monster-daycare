import { useCallback, useRef, useState } from 'react';
import { touchInput } from '../game/input.ts';
import './TouchControls.css';

/**
 * A thumbstick for tablets, bottom left.
 *
 * There is no action button, because there is nothing an action button would
 * do: every verb in this game comes from tapping a monster or a cupboard and
 * picking from the menu, and choosing walks you there by itself. The stick is
 * only for when you want to go somewhere yourself.
 *
 * It writes into `touchInput`, which the game loop reads once per frame —
 * exactly like the keyboard, so nothing downstream knows the difference.
 */

const STICK_RADIUS = 54;

export default function TouchControls() {
  const baseRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const updateFrom = useCallback((clientX: number, clientY: number) => {
    const base = baseRef.current;
    if (!base) return;

    const rect = base.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);

    // Clamp the knob to the ring, and normalise what the game reads.
    const distance = Math.hypot(dx, dy);
    const clamped = Math.min(distance, STICK_RADIUS);
    const angle = Math.atan2(dy, dx);

    setKnob({ x: Math.cos(angle) * clamped, y: Math.sin(angle) * clamped });

    // A small dead zone stops them drifting when a thumb rests on it.
    const magnitude = clamped / STICK_RADIUS;
    if (magnitude < 0.18) touchInput.setMove(0, 0);
    else touchInput.setMove(Math.cos(angle) * magnitude, Math.sin(angle) * magnitude);
  }, []);

  const release = useCallback(() => {
    pointerId.current = null;
    setKnob({ x: 0, y: 0 });
    touchInput.setMove(0, 0);
  }, []);

  return (
    <div className="touch">
      <div
        ref={baseRef}
        className="touch__stick"
        onPointerDown={(event) => {
          pointerId.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFrom(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (pointerId.current !== event.pointerId) return;
          updateFrom(event.clientX, event.clientY);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        aria-label="Walk"
      >
        <div className="touch__knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
      </div>
    </div>
  );
}
