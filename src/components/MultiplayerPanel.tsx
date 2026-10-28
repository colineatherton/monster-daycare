import { useEffect, useState } from 'react';
import { netSession, type NetStatus } from '../game/net/session.ts';
import './MultiplayerPanel.css';

/**
 * Opening a daycare together, or joining somebody else's.
 *
 * One of you opens a room and reads out four letters; everybody else types
 * them in. There is no server of ours involved — the browsers talk straight to
 * each other once a public broker has introduced them.
 */
export default function MultiplayerPanel({
  onConnected,
}: {
  /** Called when a guest is in, so the game can start without another tap. */
  onConnected: () => void;
}) {
  const [mode, setMode] = useState<'alone' | 'host' | 'join'>('alone');
  const [code, setCode] = useState('');
  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState<NetStatus>('idle');
  const [detail, setDetail] = useState('');

  useEffect(() => {
    netSession.listen({
      onStatus: (next, says) => {
        setStatus(next);
        setDetail(says);
        if (next === 'connected' && netSession.role === 'guest') onConnected();
      },
      onMessage: () => undefined,
      onGuestJoined: () => undefined,
      onGuestLeft: () => undefined,
    });
  }, [onConnected]);

  const openRoom = async () => {
    setMode('host');
    try {
      setCode(await netSession.host());
    } catch {
      // The status line already says what went wrong.
    }
  };

  const joinRoom = async () => {
    setMode('join');
    try {
      await netSession.join(typed);
    } catch {
      // Likewise.
    }
  };

  const goAlone = () => {
    netSession.leave();
    setMode('alone');
    setCode('');
  };

  return (
    <div className="mp">
      <div className="mp__choices">
        <button
          className={`mp__choice${mode === 'alone' ? ' is-on' : ''}`}
          onClick={goAlone}
          type="button"
        >
          🧍 On my own
        </button>
        <button
          className={`mp__choice${mode === 'host' ? ' is-on' : ''}`}
          onClick={openRoom}
          type="button"
        >
          🏠 Open a room
        </button>
        <button
          className={`mp__choice${mode === 'join' ? ' is-on' : ''}`}
          onClick={() => setMode('join')}
          type="button"
        >
          🔑 Join with a code
        </button>
      </div>

      {mode === 'host' && code && (
        <div className="mp__code">
          <div className="mp__codeLabel">Your code</div>
          <div className="mp__codeValue">{code}</div>
          <div className="mp__hint">
            Read those four letters out. They can join now or once you have started.
          </div>
        </div>
      )}

      {mode === 'join' && (
        <div className="mp__join">
          <input
            className="mp__input"
            value={typed}
            maxLength={4}
            placeholder="ABCD"
            onChange={(event) => setTyped(event.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
            aria-label="Room code"
          />
          <button
            className="mp__go"
            type="button"
            onClick={joinRoom}
            disabled={typed.length !== 4 || status === 'connecting'}
          >
            Join
          </button>
        </div>
      )}

      {mode !== 'alone' && detail && (
        <div className={`mp__status${status === 'error' ? ' is-bad' : ''}`}>{detail}</div>
      )}
    </div>
  );
}
