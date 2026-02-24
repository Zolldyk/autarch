import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { SseManager } from '../src/sse.js';
import { SSE_HEARTBEAT_INTERVAL_MS } from '../src/constants.js';
import type { Response } from 'express';

/** Create a mock Express Response that behaves like a writable SSE stream. */
function createMockResponse(): Response & { chunks: string[]; writableEnded: boolean } {
  const emitter = new EventEmitter();
  const chunks: string[] = [];
  let writableEnded = false;

  const mock = Object.assign(emitter, {
    chunks,
    writableEnded,
    write(chunk: string) {
      if (!mock.writableEnded) {
        mock.chunks.push(chunk);
      }
      return true;
    },
    set: vi.fn(),
    flushHeaders: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  });

  return mock as unknown as Response & { chunks: string[]; writableEnded: boolean };
}

describe('SseManager', () => {
  let manager: SseManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new SseManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('addClient / removeClient / getClientCount', () => {
    it('should track a newly added client', () => {
      const res = createMockResponse();
      manager.addClient(res);
      expect(manager.getClientCount()).toBe(1);
    });

    it('should track multiple clients', () => {
      const res1 = createMockResponse();
      const res2 = createMockResponse();
      manager.addClient(res1);
      manager.addClient(res2);
      expect(manager.getClientCount()).toBe(2);
    });

    it('should remove a client and decrement count', () => {
      const res = createMockResponse();
      manager.addClient(res);
      expect(manager.getClientCount()).toBe(1);
      manager.removeClient(res);
      expect(manager.getClientCount()).toBe(0);
    });

    it('should handle removing a client that was never added', () => {
      const res = createMockResponse();
      manager.removeClient(res);
      expect(manager.getClientCount()).toBe(0);
    });
  });

  describe('broadcast', () => {
    it('should deliver events to all connected clients', () => {
      const res1 = createMockResponse();
      const res2 = createMockResponse();
      manager.addClient(res1);
      manager.addClient(res2);

      manager.broadcast('stateUpdate', { type: 'agentState', timestamp: 1000 });

      const expected = 'event: stateUpdate\ndata: {"type":"agentState","timestamp":1000}\n\n';
      expect(res1.chunks).toContain(expected);
      expect(res2.chunks).toContain(expected);
    });

    it('should not write to clients with writableEnded', () => {
      const res = createMockResponse();
      manager.addClient(res);
      res.writableEnded = true;

      manager.broadcast('stateUpdate', { type: 'agentState' });
      // Only the initial chunks from addClient setup, no broadcast data
      expect(res.chunks).toHaveLength(0);
    });

    it('should format SSE wire protocol correctly', () => {
      const res = createMockResponse();
      manager.addClient(res);

      manager.broadcast('marketUpdate', { type: 'market', price: 42 });

      const msg = res.chunks[0]!;
      expect(msg).toMatch(/^event: marketUpdate\n/);
      expect(msg).toMatch(/data: .+\n\n$/);
      const dataLine = msg.split('\n')[1]!;
      const payload = JSON.parse(dataLine.replace('data: ', ''));
      expect(payload.type).toBe('market');
      expect(payload.price).toBe(42);
    });
  });

  describe('cleanup on close/error', () => {
    it('should remove client when connection closes', () => {
      const res = createMockResponse();
      manager.addClient(res);
      expect(manager.getClientCount()).toBe(1);

      res.emit('close');
      expect(manager.getClientCount()).toBe(0);
    });

    it('should remove client on error event', () => {
      const res = createMockResponse();
      manager.addClient(res);
      expect(manager.getClientCount()).toBe(1);

      res.emit('error', new Error('connection reset'));
      expect(manager.getClientCount()).toBe(0);
    });

    it('should not leak references after cleanup', () => {
      const res = createMockResponse();
      manager.addClient(res);
      res.emit('close');

      // Broadcast should not write to removed client
      manager.broadcast('test', { data: 'ignored' });
      expect(res.chunks).toHaveLength(0);
    });
  });

  describe('heartbeat', () => {
    it('should send keepalive comment at configured interval', () => {
      const res = createMockResponse();
      manager.addClient(res);

      expect(res.chunks).toHaveLength(0);

      vi.advanceTimersByTime(SSE_HEARTBEAT_INTERVAL_MS);
      expect(res.chunks).toContain(':keepalive\n\n');
    });

    it('should not send keepalive to ended connections', () => {
      const res = createMockResponse();
      manager.addClient(res);
      res.writableEnded = true;

      vi.advanceTimersByTime(SSE_HEARTBEAT_INTERVAL_MS);
      expect(res.chunks).toHaveLength(0);
    });

    it('should stop heartbeat after client removal', () => {
      const res = createMockResponse();
      manager.addClient(res);
      manager.removeClient(res);

      vi.advanceTimersByTime(SSE_HEARTBEAT_INTERVAL_MS * 3);
      expect(res.chunks).toHaveLength(0);
    });

    it('should stop heartbeat on connection close', () => {
      const res = createMockResponse();
      manager.addClient(res);
      res.emit('close');

      vi.advanceTimersByTime(SSE_HEARTBEAT_INTERVAL_MS * 3);
      expect(res.chunks).toHaveLength(0);
    });
  });
});
