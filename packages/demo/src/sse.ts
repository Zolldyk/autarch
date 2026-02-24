import type { Response } from 'express';
import { SSE_HEARTBEAT_INTERVAL_MS } from './constants.js';

/**
 * Manages Server-Sent Event connections, broadcasting events to all connected clients.
 * Handles client tracking, heartbeat keepalive, and cleanup on disconnect.
 */
export class SseManager {
  private readonly clients: Set<Response> = new Set();
  private readonly heartbeats: Map<Response, ReturnType<typeof setInterval>> = new Map();

  /**
   * Register a new SSE client connection and start heartbeat.
   *
   * @param res - Express response object for the SSE connection.
   */
  addClient(res: Response): void {
    this.clients.add(res);

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(':keepalive\n\n');
      }
    }, SSE_HEARTBEAT_INTERVAL_MS);

    this.heartbeats.set(res, heartbeat);

    res.on('close', () => {
      this.removeClient(res);
    });

    res.on('error', () => {
      this.removeClient(res);
    });
  }

  /**
   * Remove a client connection and clean up its heartbeat interval.
   *
   * @param res - Express response object to remove.
   */
  removeClient(res: Response): void {
    this.clients.delete(res);
    const heartbeat = this.heartbeats.get(res);
    if (heartbeat) {
      clearInterval(heartbeat);
      this.heartbeats.delete(res);
    }
  }

  /**
   * Broadcast a named SSE event with JSON data to all connected clients.
   *
   * @param event - SSE event name.
   * @param data - Data payload to JSON-stringify.
   */
  broadcast(event: string, data: unknown): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      if (!client.writableEnded) {
        client.write(message);
      }
    }
  }

  /**
   * Return the number of currently connected clients.
   *
   * @returns Client count.
   */
  getClientCount(): number {
    return this.clients.size;
  }
}
