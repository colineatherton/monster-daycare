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
  arty: '🖍️',
};

function seconds(ms: number): string {
  return Math.ceil(ms / 1000).toString();
}

function clock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** One line in the list down the right-hand side. */
function rosterLine(baby: GameSnapshot['babies'][number]): string {
  if (baby.erupted) return 'DOING THE RITUAL';
  if (baby.hasDrawing) return 'has a drawing for you 🖼️';
  if (baby.wants) return `wants ${baby.wants.name} ${baby.wants.emoji}`;
  if (baby.need) return `${baby.need} ${NEED_EMOJI[baby.need]}`;
  return 'happy 🙂';
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
  const ritual = snapshot.babies.find((baby) => baby.erupted);

  return (
    <div className="hud">
      <div className="hud__top">
        <div className="pill pill--name">{snapshot.daycareName}</div>
        <div className="pill">Day {snapshot.dayNumber}</div>
        <div className="pill">🕑 {clock(snapshot.dayTimeLeftMs)}</div>
        <div className="pill">🪙 {snapshot.coins}</div>
        {snapshot.holding && <div className="pill pill--holding">🫳 {snapshot.holding.name}</div>}
        <button
          className="pill pill--button"
          onClick={() => commands.current?.toggleMusic()}
          title={snapshot.musicOn ? 'Turn the music off' : 'Turn the music on'}
        >
          {snapshot.musicOn ? '🔊 Music on' : '🔇 Music off'}
        </button>
      </div>

      {ritual ? (
        <div className="fuse fuse--panic fuse--ritual">
          <div className="fuse__label">🌀 It is doing the ritual — change its nappy!</div>
          <div className="fuse__time">{seconds(ritual.ritualMsLeft ?? 0)}</div>
        </div>
      ) : (
        fuse !== null &&
        fuse < 60_000 && (
          <div className={`fuse${fuse < 20_000 ? ' fuse--panic' : ''}`}>
            <div className="fuse__label">It is going to come through the door</div>
            <div className="fuse__time">{seconds(fuse)}</div>
          </div>
        )
      )}

      <div className="roster">
        {snapshot.babies.map((baby) => (
          <div
            key={baby.id}
            className={`roster__row${baby.isAnomaly ? ' roster__row--anomaly' : ''}`}
          >
            <div className="roster__name">
              {baby.name}
              {baby.carried && ' 🤲'}
              {baby.holdingHands && ' 🤝'}
            </div>
            <div className="roster__want">{rosterLine(baby)}</div>
            <div className="roster__bar">
              <span
                style={{
                  width: `${baby.happiness}%`,
                  background:
                    baby.happiness > 60 ? '#4cc46a' : baby.happiness > 30 ? '#f0a92c' : '#e2544a',
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

      {snapshot.dayReport && !snapshot.gameOver && (
        <div className="overlay">
          <div className="card">
            <h1>Home time</h1>
            <p>Day {snapshot.dayReport.dayNumber} is over. The parents have come back.</p>

            <div className="verdicts">
              {snapshot.dayReport.verdicts.map((verdict, index) => (
                <div
                  key={`${verdict.babyName}-${index}`}
                  className={`verdict${verdict.happy ? '' : ' verdict--cross'}`}
                >
                  <div className="verdict__face">{verdict.happy ? '😊' : '😠'}</div>
                  <div>
                    <strong>{verdict.babyName}'s parent</strong>
                    <div className="verdict__said">“{verdict.said}”</div>
                  </div>
                </div>
              ))}
              {snapshot.dayReport.verdicts.length === 0 && (
                <p>Nobody turned up today. Quiet one.</p>
              )}
            </div>

            <p>
              You earned <strong>{snapshot.dayReport.earned} coins</strong> from happy parents.
            </p>
            <button className="big-button" onClick={() => commands.current?.nextDay()}>
              Open up tomorrow
            </button>
          </div>
        </div>
      )}

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
