import { useEffect, useState } from 'react';
import { commands, subscribe } from '../game/bus.ts';
import type { GameSnapshot } from '../game/types/game.ts';
import './GameHUD.css';

const NEED_EMOJI: Record<string, string> = {
  hungry: '🍽️',
  thirsty: '🍼',
  sleepy: '😴',
  bored: '🧸',
  sad: '😢',
};

function seconds(ms: number): string {
  return Math.ceil(ms / 1000).toString();
}

function clock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export default function GameHUD({ onQuit }: { onQuit: () => void }) {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);

  useEffect(() => subscribe(setSnapshot), []);

  if (!snapshot) return null;

  // The worst anomaly fuse is the only thing that can end the run, so it gets
  // the biggest thing on the screen.
  const fuses = snapshot.babies
    .map((baby) => baby.fuseLeftMs)
    .filter((value): value is number => value !== null);
  const fuse = fuses.length > 0 ? Math.min(...fuses) : null;

  return (
    <div className="hud">
      <div className="hud__top">
        <div className="pill pill--name">{snapshot.daycareName}</div>
        <div className="pill">Day {snapshot.dayNumber}</div>
        <div className="pill">🕑 {clock(snapshot.dayTimeLeftMs)}</div>
        <div className="pill">🪙 {snapshot.coins}</div>
        {snapshot.holding && <div className="pill">🫳 {snapshot.holding.name}</div>}
      </div>

      {fuse !== null && fuse < 60_000 && (
        <div className={`fuse${fuse < 20_000 ? ' fuse--panic' : ''}`}>
          <div className="fuse__label">It is going to come through the door</div>
          <div className="fuse__time">{seconds(fuse)}</div>
        </div>
      )}

      <div className="roster">
        {snapshot.babies.map((baby) => (
          <div
            key={baby.id}
            className={`roster__row${baby.isAnomaly ? ' roster__row--anomaly' : ''}`}
          >
            {baby.name} {baby.need ? NEED_EMOJI[baby.need] : '🙂'}
            {baby.carried && ' 🤲'}
            {baby.holdingHands && ' 🤝'}
            <div className="roster__bar">
              <span
                style={{
                  width: `${baby.happiness}%`,
                  background: baby.happiness > 60 ? '#4cc46a' : baby.happiness > 30 ? '#f0a92c' : '#e2544a',
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {snapshot.menu && (
        <div
          className="menu"
          style={{
            // Keep it on screen when you click something near an edge.
            left: Math.min(Math.max(snapshot.menu.screenX, 140), window.innerWidth - 140),
            top: Math.max(snapshot.menu.screenY, 230),
          }}
        >
          <button className="menu__close" onClick={() => commands.current?.closeMenu()}>
            ×
          </button>
          <div className="menu__title">{snapshot.menu.title}</div>
          <div className="menu__subtitle">{snapshot.menu.subtitle}</div>
          {snapshot.menu.actions.map((action) => (
            <button
              key={action.id}
              className="menu__action"
              disabled={Boolean(action.disabledBecause)}
              title={action.disabledBecause}
              onClick={() => commands.current?.chooseMenuAction(action.id)}
            >
              {action.label}
              {action.disabledBecause && ` — ${action.disabledBecause}`}
            </button>
          ))}
        </div>
      )}

      <div className="hud__hint">{snapshot.hint}</div>

      {snapshot.gameOver && (
        <div className="overlay">
          <div className="card">
            <h1>{snapshot.gameOver.reason}</h1>
            <p>{snapshot.gameOver.detail}</p>
            <p>
              You lasted to day {snapshot.dayNumber} and earned {snapshot.coins} coins.
            </p>
            <button className="big-button" onClick={() => commands.current?.restart()}>
              Open up again
            </button>{' '}
            <button className="big-button" onClick={onQuit} style={{ background: '#8d949e' }}>
              Back to the front
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
