import { useState } from 'react';
import GameCanvas from './components/GameCanvas.tsx';
import GameHUD from './components/GameHUD.tsx';
import TouchControls from './components/TouchControls.tsx';
import { prefersTouchControls } from './game/input.ts';
import { secretFor, secretTeaser } from './game/data/secrets.ts';
import type { SkinId } from './game/render/player.ts';
import './App.css';

export default function App() {
  const [playing, setPlaying] = useState(false);
  // Checked once: a tablet does not turn into a laptop halfway through.
  const [touch] = useState(prefersTouchControls);
  const [name, setName] = useState('');
  const [skin, setSkin] = useState<SkinId>('teacher');

  // You name your own daycare. Blank is fine; it gets a default.
  const daycareName = name.trim() || 'Monster Daycare';
  // Two names are not just names.
  const secret = secretFor(daycareName);
  const teaser = secretTeaser(secret);

  // ?shift=11 opens straight onto a story beat, instead of working eleven
  // shifts to get there. ?day= still works, because it is in the README.
  const params = new URLSearchParams(window.location.search);
  const firstDay = Number(params.get('shift') ?? params.get('day')) || 0;

  if (!playing) {
    return (
      <div className="title">
        <div className="title__card">
          <h1>Monster Daycare</h1>
          <p className="title__blurb">
            Monster parents drop their babies off in the morning. Feed them, play with them,
            cuddle them, get them down for a nap, sit them at the table with the crayons. They
            tell you exactly what they want — fetch that one thing. At home time the parents
            come back and say how it went.
            <br />
            <strong>Some of them are anomalies.</strong> You will know — one has teeth sticking
            out and one has a shadow that is the wrong shape entirely. Look after them like
            anybody else, but if an anomaly wants something and you take more than a minute,
            it comes through the door.
          </p>

          <label className="title__label" htmlFor="daycare-name">
            What is your daycare called?
          </label>
          <input
            id="daycare-name"
            className="title__input"
            value={name}
            maxLength={28}
            placeholder="Monster Daycare"
            onChange={(event) => setName(event.target.value)}
          />
          {teaser && <p className={`title__teaser title__teaser--${secret}`}>{teaser}</p>}

          <div className="title__label">Who are you?</div>
          <div className="title__skins">
            {(['teacher', 'robot'] as const).map((option) => (
              <button
                key={option}
                className={`skin${skin === option ? ' skin--on' : ''}`}
                onClick={() => setSkin(option)}
              >
                <span className="skin__face">{option === 'teacher' ? '👩‍🏫' : '🤖'}</span>
                {option === 'teacher' ? 'The Teacher' : 'The Robot'}
              </button>
            ))}
          </div>

          <button className="big-button" onClick={() => setPlaying(true)}>
            Open the daycare
          </button>

          <p className="title__controls">
            Tap a monster or a cupboard and pick from the menu — you walk over and do it by
            yourself. On a tablet there is a thumbstick in the corner if you want to walk
            about; on a keyboard it is <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or
            the arrow keys. The button at the top turns the music off.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`stage${secret === 'rotted' ? ' stage--rotted' : ''}`}>
      <GameCanvas daycareName={daycareName} skin={skin} firstDay={firstDay} />
      <GameHUD onQuit={() => setPlaying(false)} />
      {touch && <TouchControls />}
    </div>
  );
}
