/**
 * @file src/extended/stream.ts
 * @description Browser WebSocket client for Extended's public market-data streams.
 *
 * The public streams (order book, trades, mark price) live at
 * `wss://api.starknet.extended.exchange/stream.extended.exchange/v1/...` and require no
 * auth. We keep a single connection per channel with automatic reconnection and a
 * monotonic `seq` guard (the API instructs clients to reconnect on out-of-order seq).
 *
 * This module is browser-only (uses the global `WebSocket`).
 */

export interface StreamOptions {
  onMessage: (data: unknown) => void;
  onStatus?: (status: 'connecting' | 'open' | 'reconnecting' | 'closed') => void;
  onError?: (err: Error) => void;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

export class ExtendedStream {
  private url: string;
  private opts: StreamOptions;
  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSeq: number | null = null;

  constructor(url: string, opts: StreamOptions) {
    this.url = url;
    this.opts = opts;
    this.connect();
  }

  private connect(): void {
    if (this.closed || typeof WebSocket === 'undefined') return;
    this.opts.onStatus?.(this.reconnectAttempts === 0 ? 'connecting' : 'reconnecting');
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this.opts.onError?.(err instanceof Error ? err : new Error('Failed to open WebSocket.'));
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.opts.onStatus?.('open');
    };

    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        // Guard: reconnect if a snapshot/delta arrives out of sequence.
        if (typeof msg?.seq === 'number') {
          if (this.lastSeq !== null && msg.seq !== this.lastSeq + 1) {
            this.opts.onError?.(new Error(`Out-of-order stream sequence (${this.lastSeq} → ${msg.seq}). Reconnecting.`));
            this.reconnect();
            return;
          }
          this.lastSeq = msg.seq;
        }
        this.opts.onMessage(msg);
      } catch (err) {
        this.opts.onError?.(err instanceof Error ? err : new Error('Failed to parse stream message.'));
      }
    };

    this.ws.onerror = () => {
      this.opts.onError?.(new Error('Stream connection error.'));
    };

    this.ws.onclose = () => {
      this.opts.onStatus?.('closed');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const base = this.opts.reconnectDelayMs ?? 1000;
    const max = this.opts.maxReconnectDelayMs ?? 15000;
    const delay = Math.min(base * 2 ** this.reconnectAttempts, max);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private reconnect(): void {
    this.dispose();
    this.reconnectAttempts = 0;
    this.connect();
  }

  dispose(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    try {
      this.ws?.close();
    } catch {
      // Ignore.
    }
    this.ws = null;
  }
}

/** Build a market-data stream URL for a channel. */
export function marketStreamUrl(baseStreamUrl: string, channel: string, query?: string): string {
  const base = baseStreamUrl.replace(/\/+$/, '');
  return `${base}/${channel.replace(/^\/+/, '')}${query ? `?${query}` : ''}`;
}