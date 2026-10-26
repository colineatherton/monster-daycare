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
    return () => world.dispose();
  }, [daycareName, skin, firstDay]);

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />;
}
