import type { ClientMessage, ServerMessage } from './protocol';

/** The game server's WebSocket address: same host as the page, unless a build overrides it. */
export function serverUrl(): string {
  const override = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (override) return override;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/** Thin wrapper over the WebSocket that hands each server message to one listener. */
export class Connection {
  private ws: WebSocket;
  private closedByUs = false;
  onMessage: (msg: ServerMessage) => void = () => {};
  onClose: (unexpected: boolean) => void = () => {};

  readonly opened: Promise<void>;

  constructor(url = serverUrl()) {
    this.ws = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error('Could not reach the game server.')), { once: true });
    });
    this.ws.addEventListener('message', (e) => {
      try {
        this.onMessage(JSON.parse(String(e.data)) as ServerMessage);
      } catch (err) {
        console.error('Bad server message', err);
      }
    });
    this.ws.addEventListener('close', () => this.onClose(!this.closedByUs));
  }

  send(msg: ClientMessage) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closedByUs = true;
    this.ws.close();
  }
}
