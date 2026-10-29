import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { commands, subscribe } from '../game/bus.ts';
import type { GameSnapshot } from '../game/types/game.ts';
import { SKINS } from '../game/render/player.ts';
import './GameHUD.css';

const NEED_EMOJI: Record<string, string> = {
  hungry: '🍽️',
  thirsty: '🍼',
  sleepy: '😴',
  bored: '🧸',
  sad: '😢',
  arty: '🖍️',
  musical: '🎵',
  mathsy: '🔢',
};

function seconds(ms: number): string {
  return Math.ceil(ms / 1000).toString();
}

function clock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The night shift's buttons. Nothing here obeys the daytime rules. */
const ADMIN_BUTTONS: Array<[string, string]> = [
  ['coins', '🪙 +500 coins'],
  ['child', '👶 Add a child'],
  ['shadow', '🌑 Add a shadow one'],
  ['ritual', '🦷 Add a toothy one'],
  ['toys', '🧸 Give me a teddy'],
  ['drawing', '🖼️ Add 3 drawings'],
  ['mess', '🧹 Make a mess'],
  ['clean', '✨ Clean it all up'],
  ['happy', '😇 Everyone happy'],
  ['calm', '🧦 Calm everything'],
  ['noanomalies', '🚫 Remove all anomalies'],
  ['monster', '👹 Turn into an anomaly'],
  ['endday', '🏠 Home time now'],
  ['finish', '🏁 End the shift'],
  ['skipday', '⏭️ Next shift'],
];

/** What this one is up to, in a few words. */
function rosterLine(baby: GameSnapshot['babies'][number]): string {
  if (baby.eruption === 'ritual') return 'DOING THE RITUAL';
  if (baby.eruption === 'hunting') return 'HUNTING — give it a sock';
  if (baby.eruption === 'angry') return 'LOOSE — give it a sock';
  if (baby.asleep) return baby.wantsWaking ? 'wants its dummy 🍼' : 'asleep 💤';
  if (baby.searching) return 'looking for something 🧸';
  if (baby.hasDrawing) return 'has a drawing for you 🖼️';
  if (baby.wants) return `wants ${baby.wants.name} ${baby.wants.emoji}`;
  if (baby.need) return `${baby.need} ${NEED_EMOJI[baby.need] ?? ''}`;
  return 'happy 🙂';
}

export default function GameHUD({ onQuit, touch }: { onQuit: () => void; touch: boolean }) {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /**
   * Where a menu was when it opened. It stays there until you pick something
   * or open a different one — a menu that creeps about while you are trying
   * to tap it is horrible, and children wander.
   */
  const menuAnchor = useRef<{ key: string; left: number; top: number } | null>(null);
  // On a tablet the panel would sit on top of the thumbstick, so it starts
  // folded away behind its own button.
  const [adminOpen, setAdminOpen] = useState(!touch);

  useEffect(() => subscribe(setSnapshot), []);

  // Put the menu where it was asked for, then shove it back on screen. The
  // fridge menu is seven items tall and would otherwise run off the top.
  // Writing the style straight onto the node avoids a re-render every frame
  // as the camera moves.
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    const anchor = (element.dataset.anchor ?? '0,0').split(',').map(Number);
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const pad = 12;

    const left = Math.min(
      Math.max(anchor[0], width / 2 + pad),
      Math.max(width / 2 + pad, window.innerWidth - width / 2 - pad),
    );
    // `top` is the menu's bottom edge, because of the -100% transform.
    const bottom = Math.min(
      Math.max(anchor[1], height + pad),
      Math.max(height + pad, window.innerHeight - pad),
    );

    element.style.left = `${left}px`;
    element.style.top = `${bottom}px`;
  });

  if (!snapshot) return null;

  const fuses = snapshot.babies
    .map((baby) => baby.fuseLeftMs)
    .filter((value): value is number => value !== null);
  const fuse = fuses.length > 0 ? Math.min(...fuses) : null;
  const ritual = snapshot.babies.find((baby) => baby.eruption === 'ritual');
  const loose = snapshot.babies.find(
    (baby) => baby.eruption === 'hunting' || baby.eruption === 'angry',
  );

  return (
    <div className="hud">
      <div className="hud__top">
        <div className="pill pill--name">{snapshot.daycareName}</div>
        {snapshot.room && (
          <div
            className="pill pill--room-code"
            title="Read these four letters out to anybody else who wants to join"
          >
            🔑 <strong>{snapshot.room.code}</strong>
            <span className="pill__who">
              {snapshot.room.players} {snapshot.room.players === 1 ? 'person' : 'people'}
            </span>
          </div>
        )}
        <div className="pill">Shift {snapshot.dayNumber}</div>
        <div className="pill">🕑 {clock(snapshot.dayTimeLeftMs)}</div>
        <div className="pill">🪙 {snapshot.coins}</div>
        {snapshot.drawings > 0 && (
          <div className="pill" title="drawings on the wall / drawings collected">
            🖼️ {snapshot.onTheWall}/{snapshot.drawings}
          </div>
        )}
        {snapshot.upgrades.shoes > 0 && <div className="pill">👟 ×{snapshot.upgrades.shoes}</div>}
        <div className="pill pill--room">📍 {snapshot.playerRoom}</div>
        {!snapshot.upgrades.coffeeMachine && (
          <div className="pill pill--broken">☕ coffee machine broken</div>
        )}
        {snapshot.toTickIn > 0 && (
          <div className="pill pill--register">📋 {snapshot.toTickIn} to tick in</div>
        )}
        {snapshot.lunchtime && <div className="pill pill--lunch">🍽️ Lunchtime</div>}
        {snapshot.messCount > 0 && (
          <div className="pill pill--mess">🧹 {snapshot.messCount} to clean up</div>
        )}
        {snapshot.holdingMop && <div className="pill pill--holding">🧹 the mop</div>}
        {snapshot.holding && <div className="pill pill--holding">🫳 {snapshot.holding.name}</div>}
        {snapshot.teaMsLeft > 0 && (
          <div className="pill pill--tea">☕ fast for {seconds(snapshot.teaMsLeft)}s</div>
        )}
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
          <div className="fuse__time">{seconds(ritual.eruptionMsLeft ?? 0)}</div>
        </div>
      ) : loose ? (
        <div className="fuse fuse--panic fuse--loose">
          <div className="fuse__label">
            🧦 Something is loose in the building — give it a sock
          </div>
          <div className="fuse__time">
            {loose.eruption === 'hunting' ? 'HUNTING' : seconds(loose.eruptionMsLeft ?? 0)}
          </div>
        </div>
      ) : (
        fuse !== null && (
          <div className="fuse fuse--panic">
            <div className="fuse__label">It is about to break the door down</div>
            <div className="fuse__time">{seconds(fuse)}</div>
          </div>
        )
      )}

      {snapshot.homeTime && (
        <div className="hometime">
          <div className="hometime__title">
            Home time — {snapshot.homeTime.doneCount}/{snapshot.homeTime.totalCount} gone
          </div>
          <div className="hometime__hint">Carry each child to their own parent.</div>
          {snapshot.homeTime.waiting.map((parent) => (
            <div key={parent.id} className="hometime__row">
              {parent.babyEaten ? '🛏️' : '👪'} waiting for <strong>{parent.babyName}</strong>
            </div>
          ))}
        </div>
      )}

      <div className="roster">
        {snapshot.babies.map((baby) => (
          <button
            key={baby.id}
            type="button"
            title={`Go to ${baby.name}`}
            onClick={() => commands.current?.selectBaby(baby.id)}
            className={`roster__row${baby.isAnomaly ? ' roster__row--anomaly' : ''}${
              baby.eruption !== 'none' ? ' roster__row--loose' : ''
            }`}
          >
            <div className="roster__name">
              {baby.tickedIn ? '' : '📋 '}
              {baby.name}
              {baby.carried && ' 🤲'}
              {baby.holdingHands && ' 🤝'}
            </div>
            <div className="roster__want">{rosterLine(baby)}</div>
            <div className="roster__where">in {baby.roomName}</div>
            <div className="roster__bar">
              <span
                style={{
                  width: `${baby.happiness}%`,
                  background:
                    baby.happiness > 60 ? '#4cc46a' : baby.happiness > 30 ? '#f0a92c' : '#e2544a',
                }}
              />
            </div>
          </button>
        ))}
      </div>

      {snapshot.menu && (
        <div
          className="menu"
          ref={menuRef}
          data-anchor={(() => {
            const open = menuAnchor.current;
            if (open && open.key === snapshot.menu.key) return `${open.left},${open.top}`;
            const left = Math.round(snapshot.menu.screenX);
            const top = Math.round(snapshot.menu.screenY);
            menuAnchor.current = { key: snapshot.menu.key, left, top };
            return `${left},${top}`;
          })()}
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

      {snapshot.announcement && (
        <div className="tannoy">
          <span className="tannoy__icon">🎤</span>
          {snapshot.announcement}
        </div>
      )}

      {snapshot.admin && (
        <div className={`admin${adminOpen ? '' : ' admin--shut'}`}>
          <button
            className="admin__title"
            type="button"
            onClick={() => setAdminOpen((open) => !open)}
          >
            🌙 Night shift {adminOpen ? '▾' : '▸'}
          </button>
          {adminOpen && (
            <div className="admin__grid">
              {ADMIN_BUTTONS.map(([what, label]) => (
                <button
                  key={what}
                  className="admin__button"
                  onClick={() => commands.current?.admin(what)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!snapshot.menu && menuAnchor.current !== null && ((menuAnchor.current = null), null)}

      <div className="hud__hint">{snapshot.hint}</div>

      {snapshot.dayReport && !snapshot.gameOver && (
        <div className="overlay">
          <div className="card">
            <h1>That is everyone</h1>
            <p>Shift {snapshot.dayReport.dayNumber} is over. Here is what they all said.</p>

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
              {snapshot.dayReport.verdicts.length === 0 && <p>Nobody turned up today. Quiet one.</p>}
            </div>

            {snapshot.dayReport.employeeOfTheShift && (
              <div className="award">
                <div className="award__ribbon">🏅 Employee of the shift</div>
                <div className="award__who">{snapshot.dayReport.employeeOfTheShift}</div>
              </div>
            )}

            {snapshot.dayReport.scores.length > 1 && (
              <table className="scores">
                <thead>
                  <tr>
                    <th>Who</th>
                    <th title="fetched, fed, cuddled, tucked in">Looked after</th>
                    <th title="ticked in on the register">Register</th>
                    <th title="drawings taken and mess mopped">Tidied</th>
                    <th title="an anomaly seen to before it ever erupted">Disasters stopped</th>
                    <th title="socks given and nappies changed">Calmed</th>
                    <th title="handed to the right parent">Sent home</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.dayReport.scores.map((score) => (
                    <tr
                      key={score.seat}
                      className={
                        score.name === snapshot.dayReport?.employeeOfTheShift ? 'is-best' : ''
                      }
                    >
                      <td className="scores__who">
                        <span className="scores__face" aria-hidden="true">
                          {SKINS.find((skin) => skin.id === score.skin)?.face ?? '🧍'}
                        </span>
                        {score.name}
                      </td>
                      <td>{score.looked}</td>
                      <td>{score.ticked}</td>
                      <td>{score.tidied}</td>
                      <td>{score.prevented}</td>
                      <td>{score.brave}</td>
                      <td>{score.home}</td>
                      <td>
                        <strong>{score.total}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {snapshot.dayReport.scores.length > 1 && (
              <p className="scores__key">
                <strong>Looked after</strong> — fed, cuddled, played with, tucked into bed.{' '}
                <strong>Register</strong> — names ticked off as they arrived.{' '}
                <strong>Tidied</strong> — drawings taken and mess mopped.{' '}
                <strong>Disasters stopped</strong> — you got to an anomaly while its fuse was
                still burning, so it never broke the door down at all.{' '}
                <strong>Calmed</strong> — one got out anyway and you brought it back: a sock for a
                loose one, a nappy changed mid-ritual. Worth the most, because not everybody will
                go near them.{' '}
                <strong>Sent home</strong> — handed to the right parent.
              </p>
            )}

            <p>
              You earned <strong>{snapshot.dayReport.earned} coins</strong> from happy parents.
            </p>
            <button className="big-button" onClick={() => commands.current?.nextDay()}>
              Open up tomorrow
            </button>
          </div>
        </div>
      )}

      {snapshot.hostLeft && (
        <div className="overlay">
          <div className="card">
            <h1>The host has gone</h1>
            <p>
              Whoever opened the room has closed it, so there is no daycare to be in any more.
              Nothing here is yours to run — the host was keeping it all going.
            </p>
            <button className="big-button" onClick={onQuit}>
              Back to the front
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
              You lasted to shift {snapshot.dayNumber} and earned {snapshot.coins} coins.
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
