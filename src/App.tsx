import { useState } from 'react';
import GameCanvas from './components/GameCanvas.tsx';
import GameHUD from './components/GameHUD.tsx';
import type { SkinId } from './game/render/player.ts';
import './App.css';

export default function App() {
  const [playing, setPlaying] = useState(false);
  const [name, setName] = useState('');
  const [skin, setSkin] = useState<SkinId>('teacher');

  // You name your own daycare. Blank is fine; it gets a default.
  const daycareName = name.trim() || 'Monster Daycare';

  // ?day=3 opens straight onto the first day that has an anomaly in it, which
  // saves playing through two quiet days every time you want to test the scary
  // part.
  const firstDay = Number(new URLSearchParams(window.location.search).get('day')) || 1;

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
            Walk with <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or the arrow keys.
            Click a monster, the fridge, the toy box, the cots or the colouring table to see
            what you can do. There is music — the button at the top turns it off.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="stage">
      <GameCanvas daycareName={daycareName} skin={skin} firstDay={firstDay} />
      <GameHUD onQuit={() => setPlaying(false)} />
    </div>
  );
}
