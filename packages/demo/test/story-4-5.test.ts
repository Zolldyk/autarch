import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createServer } from '../src/server.js';
import type { MarketUpdateEvent, SimulationModeEvent } from '@autarch/agent';

// ── Helpers ────────────────────────────────────────────────────────

function createMockRuntime(): EventEmitter & {
  injectDip: ReturnType<typeof vi.fn>;
  injectRally: ReturnType<typeof vi.fn>;
  resetMarket: ReturnType<typeof vi.fn>;
  getStates: ReturnType<typeof vi.fn>;
} {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    injectDip: vi.fn(),
    injectRally: vi.fn(),
    resetMarket: vi.fn(),
    getStates: vi.fn().mockReturnValue([]),
  });
}

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: data }));
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function openSseConnection(
  port: number,
): { events: string[]; req: http.ClientRequest; headerPromise: Promise<http.IncomingHttpHeaders> } {
  const events: string[] = [];
  let resolveHeaders: (h: http.IncomingHttpHeaders) => void;
  const headerPromise = new Promise<http.IncomingHttpHeaders>((r) => (resolveHeaders = r));

  const req = http.get({ hostname: '127.0.0.1', port, path: '/events' }, (res) => {
    resolveHeaders!(res.headers);
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => events.push(chunk));
  });

  return { events, req, headerPromise };
}

function extractEventPayload(events: string[], eventName: string): Record<string, unknown> | null {
  const combined = events.join('');
  const blocks = combined.split('\n\n').filter(Boolean);
  for (const block of blocks) {
    if (!block.startsWith(`event: ${eventName}\n`)) continue;
    const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
    if (!dataLine) continue;
    return JSON.parse(dataLine.replace('data: ', '')) as Record<string, unknown>;
  }
  return null;
}

function extractAllEventPayloads(events: string[], eventName: string): Record<string, unknown>[] {
  const combined = events.join('');
  const blocks = combined.split('\n\n').filter(Boolean);
  const results: Record<string, unknown>[] = [];
  for (const block of blocks) {
    if (!block.startsWith(`event: ${eventName}\n`)) continue;
    const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
    if (!dataLine) continue;
    results.push(JSON.parse(dataLine.replace('data: ', '')) as Record<string, unknown>);
  }
  return results;
}

// ── Tests ──────────────────────────────────────────────────────────

describe('Story 4-5: Transaction Links & Market Controls', () => {
  let server: http.Server;
  let port: number;
  let runtime: ReturnType<typeof createMockRuntime>;

  beforeEach(async () => {
    runtime = createMockRuntime();
    const { app } = createServer({ runtime: runtime as never, port: 0 });
    server = app.listen(0);
    await new Promise<void>((r) => server.on('listening', r));
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // ── AC3/AC4: Market Control → SSE Round-Trip ───────────────────

  describe('Market control → SSE round-trip (AC3, AC4, AC5)', () => {
    it('POST /api/market/dip should trigger runtime.injectDip with exact percent', async () => {
      const res = await request(port, 'POST', '/api/market/dip', { percent: 5 });
      expect(res.status).toBe(200);
      expect(runtime.injectDip).toHaveBeenCalledWith(5);
    });

    it('POST /api/market/rally should trigger runtime.injectRally with exact percent', async () => {
      const res = await request(port, 'POST', '/api/market/rally', { percent: 10 });
      expect(res.status).toBe(200);
      expect(runtime.injectRally).toHaveBeenCalledWith(10);
    });

    it('POST /api/market/reset should trigger runtime.resetMarket', async () => {
      const res = await request(port, 'POST', '/api/market/reset');
      expect(res.status).toBe(200);
      expect(runtime.resetMarket).toHaveBeenCalled();
    });

    it('dip → marketUpdate SSE delivers price + negative change for client rendering', async () => {
      const { events, req, headerPromise } = openSseConnection(port);
      await headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      // Simulate: API triggers injectDip → runtime emits marketUpdate
      runtime.injectDip.mockImplementation(() => {
        const event: MarketUpdateEvent = {
          marketData: {
            price: 95,
            priceChange1m: -5,
            priceChange5m: -3,
            volumeChange1m: 0,
            timestamp: Date.now(),
            source: 'simulated',
          },
          timestamp: Date.now(),
        };
        runtime.emit('marketUpdate', event);
      });

      await request(port, 'POST', '/api/market/dip', { percent: 5 });
      await new Promise((r) => setTimeout(r, 50));

      const payload = extractEventPayload(events, 'marketUpdate');
      expect(payload).not.toBeNull();
      expect(payload!['type']).toBe('market');

      const md = payload!['marketData'] as Record<string, unknown>;
      expect(md['price']).toBe(95);
      expect(md['priceChange1m']).toBe(-5);
      expect(typeof payload!['timestamp']).toBe('number');

      req.destroy();
    });

    it('rally → marketUpdate SSE delivers price + positive change for client rendering', async () => {
      const { events, req, headerPromise } = openSseConnection(port);
      await headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      runtime.injectRally.mockImplementation(() => {
        const event: MarketUpdateEvent = {
          marketData: {
            price: 110,
            priceChange1m: 10,
            priceChange5m: 8,
            volumeChange1m: 0,
            timestamp: Date.now(),
            source: 'simulated',
          },
          timestamp: Date.now(),
        };
        runtime.emit('marketUpdate', event);
      });

      await request(port, 'POST', '/api/market/rally', { percent: 10 });
      await new Promise((r) => setTimeout(r, 50));

      const payload = extractEventPayload(events, 'marketUpdate');
      expect(payload).not.toBeNull();
      const md = payload!['marketData'] as Record<string, unknown>;
      expect(md['price']).toBe(110);
      expect(md['priceChange1m']).toBe(10);

      req.destroy();
    });

    it('reset → marketUpdate SSE delivers baseline price', async () => {
      const { events, req, headerPromise } = openSseConnection(port);
      await headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      runtime.resetMarket.mockImplementation(() => {
        const event: MarketUpdateEvent = {
          marketData: {
            price: 100,
            priceChange1m: 0,
            priceChange5m: 0,
            volumeChange1m: 0,
            timestamp: Date.now(),
            source: 'simulated',
          },
          timestamp: Date.now(),
        };
        runtime.emit('marketUpdate', event);
      });

      await request(port, 'POST', '/api/market/reset');
      await new Promise((r) => setTimeout(r, 50));

      const payload = extractEventPayload(events, 'marketUpdate');
      expect(payload).not.toBeNull();
      const md = payload!['marketData'] as Record<string, unknown>;
      expect(md['price']).toBe(100);
      expect(md['priceChange1m']).toBe(0);

      req.destroy();
    });

    it('market control responses include connected client count', async () => {
      const { req: sseReq, headerPromise } = openSseConnection(port);
      await headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      const dipRes = await request(port, 'POST', '/api/market/dip', { percent: 5 });
      const dipBody = JSON.parse(dipRes.body);
      expect(dipBody.clients).toBe(1);

      const rallyRes = await request(port, 'POST', '/api/market/rally', { percent: 10 });
      const rallyBody = JSON.parse(rallyRes.body);
      expect(rallyBody.clients).toBe(1);

      const resetRes = await request(port, 'POST', '/api/market/reset');
      const resetBody = JSON.parse(resetRes.body);
      expect(resetBody.clients).toBe(1);

      sseReq.destroy();
    });
  });

  // ── AC6: Connection Status SSE Lifecycle ────────────────────────

  describe('Connection mode SSE delivery (AC6, AC9)', () => {
    it('should deliver modeChange with active:true for simulation mode', async () => {
      const { events, req, headerPromise } = openSseConnection(port);
      await headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      const event: SimulationModeEvent = {
        active: true,
        reason: 'RPC failure',
        timestamp: Date.now(),
      };
      runtime.emit('simulationMode', event);
      await new Promise((r) => setTimeout(r, 50));

      const payload = extractEventPayload(events, 'modeChange');
      expect(payload).not.toBeNull();
      expect(payload!['type']).toBe('mode');
      expect(payload!['active']).toBe(true);
      expect(payload!['reason']).toBe('RPC failure');

      req.destroy();
    });

    it('should deliver modeChange with fallback reason for degraded mode', async () => {
      const { events, req, headerPromise } = openSseConnection(port);
      await headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      const event: SimulationModeEvent = {
        active: false,
        reason: 'fallback RPC active',
        timestamp: Date.now(),
      };
      runtime.emit('simulationMode', event);
      await new Promise((r) => setTimeout(r, 50));

      const payload = extractEventPayload(events, 'modeChange');
      expect(payload).not.toBeNull();
      expect(payload!['active']).toBe(false);
      expect(payload!['reason']).toContain('fallback');

      req.destroy();
    });

    it('should deliver modeChange with active:false for normal devnet mode', async () => {
      const { events, req, headerPromise } = openSseConnection(port);
      await headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      const event: SimulationModeEvent = {
        active: false,
        reason: '',
        timestamp: Date.now(),
      };
      runtime.emit('simulationMode', event);
      await new Promise((r) => setTimeout(r, 50));

      const payload = extractEventPayload(events, 'modeChange');
      expect(payload).not.toBeNull();
      expect(payload!['active']).toBe(false);

      req.destroy();
    });

    it('mode transitions are delivered in order to SSE clients', async () => {
      const { events, req, headerPromise } = openSseConnection(port);
      await headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      // Simulate: normal → simulation → back to normal
      runtime.emit('simulationMode', { active: true, reason: 'RPC down', timestamp: Date.now() } satisfies SimulationModeEvent);
      runtime.emit('simulationMode', { active: false, reason: '', timestamp: Date.now() } satisfies SimulationModeEvent);
      await new Promise((r) => setTimeout(r, 50));

      const payloads = extractAllEventPayloads(events, 'modeChange');
      expect(payloads).toHaveLength(2);
      expect(payloads[0]!['active']).toBe(true);
      expect(payloads[1]!['active']).toBe(false);

      req.destroy();
    });
  });

  // ── AC4/AC5: Market Update SSE Data Contract ────────────────────

  describe('Market update SSE data contract (AC4, AC5)', () => {
    it('marketUpdate payload includes all fields needed for price display', async () => {
      const { events, req, headerPromise } = openSseConnection(port);
      await headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      const event: MarketUpdateEvent = {
        marketData: {
          price: 142.5,
          priceChange1m: -3.2,
          priceChange5m: 1.5,
          volumeChange1m: 0,
          timestamp: Date.now(),
          source: 'simulated',
        },
        timestamp: Date.now(),
      };
      runtime.emit('marketUpdate', event);
      await new Promise((r) => setTimeout(r, 50));

      const payload = extractEventPayload(events, 'marketUpdate');
      expect(payload).not.toBeNull();

      // Client expects: data.marketData.price and data.marketData.priceChange1m
      const md = payload!['marketData'] as Record<string, unknown>;
      expect(typeof md['price']).toBe('number');
      expect(typeof md['priceChange1m']).toBe('number');

      req.destroy();
    });

    it('marketUpdate delivers to multiple clients simultaneously', async () => {
      const conn1 = openSseConnection(port);
      const conn2 = openSseConnection(port);
      await conn1.headerPromise;
      await conn2.headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      const event: MarketUpdateEvent = {
        marketData: {
          price: 105,
          priceChange1m: 5,
          priceChange5m: 3,
          volumeChange1m: 0,
          timestamp: Date.now(),
          source: 'simulated',
        },
        timestamp: Date.now(),
      };
      runtime.emit('marketUpdate', event);
      await new Promise((r) => setTimeout(r, 50));

      const p1 = extractEventPayload(conn1.events, 'marketUpdate');
      const p2 = extractEventPayload(conn2.events, 'marketUpdate');
      expect(p1).not.toBeNull();
      expect(p2).not.toBeNull();
      expect((p1!['marketData'] as Record<string, unknown>)['price']).toBe(105);
      expect((p2!['marketData'] as Record<string, unknown>)['price']).toBe(105);

      conn1.req.destroy();
      conn2.req.destroy();
    });

    it('rapid market events are all delivered without loss', async () => {
      const { events, req, headerPromise } = openSseConnection(port);
      await headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      // Emit 3 rapid market updates
      for (let i = 0; i < 3; i++) {
        const event: MarketUpdateEvent = {
          marketData: {
            price: 100 + i * 5,
            priceChange1m: i * 5,
            priceChange5m: 0,
            volumeChange1m: 0,
            timestamp: Date.now(),
            source: 'simulated',
          },
          timestamp: Date.now(),
        };
        runtime.emit('marketUpdate', event);
      }
      await new Promise((r) => setTimeout(r, 100));

      const payloads = extractAllEventPayloads(events, 'marketUpdate');
      expect(payloads).toHaveLength(3);

      const prices = payloads.map((p) => (p['marketData'] as Record<string, unknown>)['price']);
      expect(prices).toEqual([100, 105, 110]);

      req.destroy();
    });
  });

  // ── AC7: Market Button Styling Contract ─────────────────────────

  describe('Market control response contract (AC7)', () => {
    it('all market endpoints return {success: true, clients: number}', async () => {
      for (const [path, body] of [
        ['/api/market/dip', { percent: 5 }],
        ['/api/market/rally', { percent: 10 }],
        ['/api/market/reset', undefined],
      ] as const) {
        const res = await request(port, 'POST', path, body);
        const parsed = JSON.parse(res.body);
        expect(parsed).toHaveProperty('success', true);
        expect(typeof parsed.clients).toBe('number');
      }
    });

    it('all market endpoints return 200 status', async () => {
      for (const [path, body] of [
        ['/api/market/dip', { percent: 5 }],
        ['/api/market/rally', { percent: 10 }],
        ['/api/market/reset', undefined],
      ] as const) {
        const res = await request(port, 'POST', path, body);
        expect(res.status).toBe(200);
      }
    });
  });

  // ── Error Handling ──────────────────────────────────────────────

  describe('Market control error handling', () => {
    it('should return 500 when injectDip throws', async () => {
      runtime.injectDip.mockImplementation(() => {
        throw new Error('Market provider unavailable');
      });
      const res = await request(port, 'POST', '/api/market/dip', { percent: 5 });
      expect(res.status).toBe(500);
      expect(JSON.parse(res.body).error).toBe('Market provider unavailable');
    });

    it('should return 500 when injectRally throws', async () => {
      runtime.injectRally.mockImplementation(() => {
        throw new Error('Rally injection failed');
      });
      const res = await request(port, 'POST', '/api/market/rally', { percent: 10 });
      expect(res.status).toBe(500);
      expect(JSON.parse(res.body).error).toBe('Rally injection failed');
    });

    it('should return 500 when resetMarket throws', async () => {
      runtime.resetMarket.mockImplementation(() => {
        throw new Error('Reset failed');
      });
      const res = await request(port, 'POST', '/api/market/reset');
      expect(res.status).toBe(500);
      expect(JSON.parse(res.body).error).toBe('Reset failed');
    });
  });
});
