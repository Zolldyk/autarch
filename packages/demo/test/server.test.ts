import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createServer } from '../src/server.js';
import { SSE_RETRY_MS } from '../src/constants.js';
import type { AgentState, AgentLifecycleEvent, RulesReloadedEvent, MarketUpdateEvent, SimulationModeEvent } from '@autarch/agent';

/** Minimal mock of AgentRuntime — only the EventEmitter + market control methods. */
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
    getStates: vi.fn(),
  });
}

/** Make an HTTP request and return the response. */
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
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
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

/** Open an SSE connection and collect events until the caller aborts. */
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
    const dataLine = block.split('\n').find(line => line.startsWith('data: '));
    if (!dataLine) continue;
    return JSON.parse(dataLine.replace('data: ', '')) as Record<string, unknown>;
  }
  return null;
}

describe('Express SSE Server', () => {
  let server: http.Server;
  let port: number;
  let runtime: ReturnType<typeof createMockRuntime>;

  beforeEach(async () => {
    runtime = createMockRuntime();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { app } = createServer({ runtime: runtime as any, port: 0 });
    server = app.listen(0);
    await new Promise<void>((r) => server.on('listening', r));
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe('GET /events — SSE connection (AC1, AC7)', () => {
    it('should set correct SSE headers', async () => {
      const { req, headerPromise } = openSseConnection(port);
      const headers = await headerPromise;

      expect(headers['content-type']).toMatch(/text\/event-stream/);
      expect(headers['cache-control']).toBe('no-cache');
      expect(headers['connection']).toBe('keep-alive');
      expect(headers['x-accel-buffering']).toBe('no');

      req.destroy();
    });

    it('should send retry directive on connection', async () => {
      const { events, req, headerPromise } = openSseConnection(port);
      await headerPromise;

      // Give time for initial data to arrive
      await new Promise((r) => setTimeout(r, 50));

      const combined = events.join('');
      expect(combined).toContain(`retry: ${SSE_RETRY_MS}`);

      req.destroy();
    });
  });

  describe('State update broadcasting (AC2)', () => {
    it('should broadcast stateUpdate events to SSE clients', async () => {
      const { events, req, headerPromise } = openSseConnection(port);
      await headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      const mockState: Partial<AgentState> = {
        agentId: 1,
        name: 'TestAgent',
        status: 'active',
      };
      runtime.getStates.mockReturnValue([mockState]);
      runtime.emit('stateUpdate', mockState);

      await new Promise((r) => setTimeout(r, 50));

      const payload = extractEventPayload(events, 'stateUpdate');
      expect(payload?.['type']).toBe('agentState');
      expect(Array.isArray(payload?.['agents'])).toBe(true);
      expect(payload?.['agents']).toEqual([mockState]);

      req.destroy();
    });
  });

  describe('System event broadcasting (AC3)', () => {
    it('should broadcast agentLifecycle as systemEvent', async () => {
      const { events, req, headerPromise } = openSseConnection(port);
      await headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      const mockEvent: AgentLifecycleEvent = {
        agentId: 1,
        event: 'started',
        timestamp: Date.now(),
      };
      runtime.emit('agentLifecycle', mockEvent);
      await new Promise((r) => setTimeout(r, 50));

      const payload = extractEventPayload(events, 'systemEvent');
      expect(payload?.['type']).toBe('lifecycle');
      expect(typeof payload?.['timestamp']).toBe('number');

      req.destroy();
    });

    it('should add timestamp when system event is missing one', async () => {
      const { events, req, headerPromise } = openSseConnection(port);
      await headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      const mockEvent = {
        agentId: 3,
        event: 'started',
      };
      runtime.emit('agentLifecycle', mockEvent);
      await new Promise((r) => setTimeout(r, 50));

      const payload = extractEventPayload(events, 'systemEvent');
      expect(payload?.['type']).toBe('lifecycle');
      expect(typeof payload?.['timestamp']).toBe('number');

      req.destroy();
    });

    it('should broadcast rulesReloaded as systemEvent', async () => {
      const { events, req, headerPromise } = openSseConnection(port);
      await headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      const mockEvent: RulesReloadedEvent = {
        agentId: 2,
        success: true,
        timestamp: Date.now(),
      };
      runtime.emit('rulesReloaded', mockEvent);
      await new Promise((r) => setTimeout(r, 50));

      const combined = events.join('');
      expect(combined).toContain('event: systemEvent');
      expect(combined).toContain('"type":"hotReload"');

      req.destroy();
    });

    it('should broadcast marketUpdate events', async () => {
      const { events, req, headerPromise } = openSseConnection(port);
      await headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      const mockEvent: MarketUpdateEvent = {
        marketData: { price: 100, priceChange1m: 0.5, priceChange5m: 1.2, volumeChange1m: 0, timestamp: Date.now(), source: 'simulated' },
        timestamp: Date.now(),
      };
      runtime.emit('marketUpdate', mockEvent);
      await new Promise((r) => setTimeout(r, 50));

      const combined = events.join('');
      expect(combined).toContain('event: marketUpdate');
      expect(combined).toContain('"type":"market"');

      req.destroy();
    });

    it('should broadcast simulationMode as modeChange', async () => {
      const { events, req, headerPromise } = openSseConnection(port);
      await headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      const mockEvent: SimulationModeEvent = {
        active: true,
        reason: 'RPC failure',
        timestamp: Date.now(),
      };
      runtime.emit('simulationMode', mockEvent);
      await new Promise((r) => setTimeout(r, 50));

      const combined = events.join('');
      expect(combined).toContain('event: modeChange');
      expect(combined).toContain('"type":"mode"');

      req.destroy();
    });
  });

  describe('Multi-client broadcast (AC2)', () => {
    it('should deliver stateUpdate to multiple SSE clients simultaneously', async () => {
      const conn1 = openSseConnection(port);
      const conn2 = openSseConnection(port);
      await conn1.headerPromise;
      await conn2.headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      const mockState: Partial<AgentState> = {
        agentId: 1,
        name: 'TestAgent',
        status: 'active',
      };
      runtime.getStates.mockReturnValue([mockState]);
      runtime.emit('stateUpdate', mockState);

      await new Promise((r) => setTimeout(r, 50));

      const payload1 = extractEventPayload(conn1.events, 'stateUpdate');
      const payload2 = extractEventPayload(conn2.events, 'stateUpdate');
      expect(payload1?.['type']).toBe('agentState');
      expect(payload2?.['type']).toBe('agentState');
      expect(typeof payload1?.['timestamp']).toBe('number');
      expect(typeof payload2?.['timestamp']).toBe('number');

      conn1.req.destroy();
      conn2.req.destroy();
    });
  });

  describe('Connection cleanup (AC4)', () => {
    it('should clean up client on disconnect', async () => {
      const { app, sseManager } = createServer({ runtime: runtime as never, port: 0 });
      const tempServer = app.listen(0);
      await new Promise<void>((r) => tempServer.on('listening', r));
      const tempPort = (tempServer.address() as { port: number }).port;

      const { req, headerPromise } = openSseConnection(tempPort);
      await headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      expect(sseManager.getClientCount()).toBe(1);

      req.destroy();
      await new Promise((r) => setTimeout(r, 100));

      expect(sseManager.getClientCount()).toBe(0);

      await new Promise<void>((resolve) => tempServer.close(() => resolve()));
    });

    it('should not crash when broadcasting after a client disconnects', async () => {
      const { app, sseManager } = createServer({ runtime: runtime as never, port: 0 });
      const tempServer = app.listen(0);
      await new Promise<void>((r) => tempServer.on('listening', r));
      const tempPort = (tempServer.address() as { port: number }).port;

      const { req, headerPromise } = openSseConnection(tempPort);
      await headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      expect(sseManager.getClientCount()).toBe(1);

      req.destroy();
      await new Promise((r) => setTimeout(r, 100));

      expect(sseManager.getClientCount()).toBe(0);

      // Broadcasting after disconnect should not throw
      expect(() => sseManager.broadcast('stateUpdate', { type: 'agentState', timestamp: Date.now() })).not.toThrow();

      await new Promise<void>((resolve) => tempServer.close(() => resolve()));
    });
  });

  describe('Static file serving (AC5)', () => {
    it('should return 404 for nonexistent static files', async () => {
      const res = await request(port, 'GET', '/nonexistent.html');
      expect(res.status).toBe(404);
    });
  });

  describe('Market control endpoints (AC6)', () => {
    it('POST /api/market/dip should call runtime.injectDip', async () => {
      const res = await request(port, 'POST', '/api/market/dip', { percent: 10 });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(typeof body.clients).toBe('number');
      expect(runtime.injectDip).toHaveBeenCalledWith(10);
    });

    it('POST /api/market/rally should call runtime.injectRally', async () => {
      const res = await request(port, 'POST', '/api/market/rally', { percent: 15 });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(runtime.injectRally).toHaveBeenCalledWith(15);
    });

    it('POST /api/market/reset should call runtime.resetMarket', async () => {
      const res = await request(port, 'POST', '/api/market/reset');
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(runtime.resetMarket).toHaveBeenCalled();
    });

    it('should return 500 when runtime method throws on missing body', async () => {
      runtime.injectDip.mockImplementation(() => {
        throw new TypeError("Cannot read properties of undefined (reading 'percent')");
      });
      const res = await request(port, 'POST', '/api/market/dip', {});
      expect(res.status).toBe(500);
      const body = JSON.parse(res.body);
      expect(body.error).toBeDefined();
    });

    it('should return client count in response', async () => {
      // Connect an SSE client first
      const { req: sseReq, headerPromise } = openSseConnection(port);
      await headerPromise;
      await new Promise((r) => setTimeout(r, 50));

      const res = await request(port, 'POST', '/api/market/reset');
      const body = JSON.parse(res.body);
      expect(body.clients).toBeGreaterThanOrEqual(1);

      sseReq.destroy();
    });
  });

  describe('Error handler (AC: Express 5 compliance)', () => {
    it('should catch route errors and return 500 with error message', async () => {
      // Send request without JSON body — destructuring req.body throws
      runtime.injectDip.mockImplementation(() => {
        throw new Error('test error from handler');
      });
      const res = await request(port, 'POST', '/api/market/dip', { percent: 5 });
      expect(res.status).toBe(500);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('test error from handler');
    });
  });

  describe('Configurable port (AC7)', () => {
    it('should default port to 3000 when PORT env is not set', () => {
      const original = process.env['PORT'];
      delete process.env['PORT'];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { port: resolvedPort } = createServer({ runtime: runtime as any });
      expect(resolvedPort).toBe(3000);
      if (original !== undefined) process.env['PORT'] = original;
    });

    it('should use PORT env variable when set', () => {
      const original = process.env['PORT'];
      process.env['PORT'] = '4567';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { port: resolvedPort } = createServer({ runtime: runtime as any });
      expect(resolvedPort).toBe(4567);
      if (original !== undefined) {
        process.env['PORT'] = original;
      } else {
        delete process.env['PORT'];
      }
    });

    it('should allow port override via options', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { port: resolvedPort } = createServer({ runtime: runtime as any, port: 9999 });
      expect(resolvedPort).toBe(9999);
    });
  });
});
