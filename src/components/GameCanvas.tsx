import { useEffect, useRef } from 'react';
import { DaycareWorld } from '../game/DaycareWorld.ts';
import type { SkinId } from '../game/render/player.ts';

/** Mounts the 3D world, and tears it down properly when we leave. */
export default function GameCanvas({
  daycareName,
  skin,
  firstDay,
}: {
  daycareName: string;
  skin: SkinId;
  firstDay: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const world = new DaycareWorld(canvas, { daycareName, skin, firstDay });

    // A handle on the building while developing, so a test driving a real
    // browser can ask where everybody is standing instead of guessing from
    // what happens to be on screen. Never shipped: Vite strips this branch
    // out of the build entirely.
    if (import.meta.env.DEV) {
      (window as unknown as { daycare?: DaycareWorld }).daycare = world;
    }

    return () => world.dispose();
  }, [daycareName, skin, firstDay]);

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />;
}
