import Peer, { type DataConnection } from 'peerjs';
import { MAX_PLAYERS, makeRoomCode, peerIdFor, type NetMessage } from './protocol.ts';

/**
 * The connection between daycares.
 *
 * WebRTC needs a moment of help to introduce two browsers to each other, and a
 * static site has no server of its own, so this uses PeerJS's free public
 * broker for the handshake only. Once the two devices are introduced, all game
 * traffic goes directly between them — nothing is relayed.
 *
 * Trade-off worth knowing: that broker is a third-party service. If it is down
 * or rate-limited, hosting fails and the game falls back to playing on your
 * own. Swapping in your own PeerServer is a one-line change to `peerOptions`.
 */

export type NetRole = 'solo' | 'host' | 'guest';

export type NetStatus =
  | 'idle'
  | 'starting'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'error';

export interface NetEvents {
  onStatus: (status: NetStatus, detail: string) => void;
  /** `from` is the connection id, so a host can tell its guests apart. */
  onMessage: (message: NetMessage, from: string) => void;
  onGuestJoined: (id: string) => void;
  onGuestLeft: (id: string) => void;
}

/** Left empty: the default is PeerJS's public broker. */
const peerOptions = {};

class NetSession {
  role: NetRole = 'solo';
  status: NetStatus = 'idle';
  roomCode = '';
  /** Whatever went wrong, in words a player can read. */
  error = '';

  private peer: Peer | null = null;
  /** Guests, keyed by connection id. A guest has exactly one entry: the host. */
  private connections = new Map<string, DataConnection>();
  private events: NetEvents | null = null;

  get isConnected(): boolean {
    return this.status === 'connected' && this.openConnections.length > 0;
  }

  /** How many grown-ups are in the building, counting this one. */
  get playerCount(): number {
    return this.role === 'solo' ? 1 : this.openConnections.length + 1;
  }

  get isFull(): boolean {
    return this.playerCount >= MAX_PLAYERS;
  }

  /** Who is already connected, so a world opening late can adopt them. */
  get connectionIds(): string[] {
    return this.openConnections.map(
      (connection) => connection.connectionId ?? connection.peer,
    );
  }

  private get openConnections(): DataConnection[] {
    return [...this.connections.values()].filter((connection) => connection.open);
  }

  listen(events: NetEvents): void {
    this.events = events;
  }

  /** Open a room and wait for a friend. Resolves with the room code. */
  async host(): Promise<string> {
    this.teardown();
    this.role = 'host';
    this.roomCode = makeRoomCode();
    this.setStatus('starting', 'Opening a room...');

    try {
      this.peer = new Peer(peerIdFor(this.roomCode), peerOptions);
      await this.waitForOpen(this.peer);
    } catch (error) {
      // The most likely cause is that code already being taken; one retry with
      // a fresh code is usually enough.
      this.roomCode = makeRoomCode();
      try {
        this.peer = new Peer(peerIdFor(this.roomCode), peerOptions);
        await this.waitForOpen(this.peer);
      } catch (retryError) {
        this.fail(describe(retryError ?? error));
        throw retryError;
      }
    }

    this.setStatus('waiting', `Room ${this.roomCode} — waiting for a friend`);

    this.peer.on('connection', (connection) => {
      // Room for five grown-ups in total; anybody later is turned away.
      if (this.isFull) {
        connection.close();
        return;
      }
      this.attach(connection);
    });

    this.peer.on('error', (error) => this.fail(describe(error)));
    return this.roomCode;
  }

  /** Join somebody else's room by code. */
  async join(code: string): Promise<void> {
    this.teardown();
    this.role = 'guest';
    this.roomCode = code.toUpperCase().trim();
    this.setStatus('connecting', `Looking for room ${this.roomCode}...`);

    try {
      this.peer = new Peer(peerOptions);
      await this.waitForOpen(this.peer);
    } catch (error) {
      this.fail(describe(error));
      throw error;
    }

    const connection = this.peer.connect(peerIdFor(this.roomCode), {
      reliable: true,
      serialization: 'json',
    });
    this.attach(connection);

    this.peer.on('error', (error) => {
      const message = describe(error);
      this.fail(
        /peer-unavailable/i.test(message)
          ? `No room called ${this.roomCode}. Check the code?`
          : message,
      );
    });
  }

  /** Send to everybody (host) or to the host (guest). */
  send(message: NetMessage): void {
    for (const connection of this.openConnections) connection.send(message);
  }

  /** Send to one particular guest. */
  sendTo(id: string, message: NetMessage): void {
    const connection = this.connections.get(id);
    if (connection?.open) connection.send(message);
  }

  leave(): void {
    this.teardown();
    this.role = 'solo';
    this.roomCode = '';
    this.setStatus('idle', '');
  }

  /* ------------------------------------------------------------ internals */

  private attach(connection: DataConnection): void {
    const id = connection.connectionId ?? connection.peer;
    this.connections.set(id, connection);

    connection.on('open', () => {
      this.setStatus('connected', this.describeRoom());
      if (this.role === 'host') this.events?.onGuestJoined(id);
    });

    connection.on('data', (data) => {
      // Anything that is not one of our messages is ignored rather than
      // trusted — this is an open broker, after all.
      if (!data || typeof data !== 'object' || !('t' in (data as object))) return;
      this.events?.onMessage(data as NetMessage, id);
    });

    connection.on('close', () => {
      this.connections.delete(id);
      if (this.role === 'host') {
        this.events?.onGuestLeft(id);
        this.setStatus(
          this.openConnections.length > 0 ? 'connected' : 'waiting',
          this.describeRoom(),
        );
      } else {
        this.setStatus('idle', 'The host closed the daycare.');
      }
    });

    connection.on('error', (error) => this.fail(describe(error)));
  }

  private describeRoom(): string {
    if (this.role === 'guest') return 'Connected!';
    const others = this.openConnections.length;
    if (others === 0) return `Room ${this.roomCode} — waiting for friends`;
    return `${this.playerCount} in the daycare${this.isFull ? ' (full)' : ''}`;
  }

  private waitForOpen(peer: Peer): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out reaching the lobby server.')), 12_000);
      peer.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      peer.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private setStatus(status: NetStatus, detail: string): void {
    this.status = status;
    if (status !== 'error') this.error = '';
    this.events?.onStatus(status, detail);
  }

  private fail(message: string): void {
    this.error = message;
    this.status = 'error';
    this.events?.onStatus('error', message);
  }

  private teardown(): void {
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
    this.peer?.destroy();
    this.peer = null;
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  const type = (error as { type?: string })?.type;
  return type ? `Connection problem (${type}).` : 'Connection problem.';
}

export const netSession = new NetSession();
