import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentRuntime, AgentState, AgentLifecycleEvent, RulesReloadedEvent, MarketUpdateEvent, SimulationModeEvent } from '@autarch/agent';
import { SseManager } from './sse.js';
import { DEFAULT_PORT, SSE_RETRY_MS } from './constants.js';

/** Options for creating the demo server. */
export interface CreateServerOptions {
  /** The AgentRuntime instance to wire events from. */
  readonly runtime: AgentRuntime;
  /** Port to listen on. Defaults to PORT env var or 3000. */
  readonly port?: number;
}

/** Return value from createServer containing the Express app and SSE manager. */
export interface ServerInstance {
  /** The configured Express application. */
  readonly app: ReturnType<typeof express>;
  /** The SSE connection manager. */
  readonly sseManager: SseManager;
  /** The resolved port number. */
  readonly port: number;
}

/**
 * Create an Express 5 server wired to an AgentRuntime for SSE broadcasting.
 *
 * @param options - Server configuration with runtime and optional port.
 * @returns The Express app, SSE manager, and resolved port.
 */
export function createServer(options: CreateServerOptions): ServerInstance {
  const { runtime, port = Number(process.env['PORT']) || DEFAULT_PORT } = options;

  const app = express();
  const sseManager = new SseManager();

  // Body parsing for JSON POST endpoints
  app.use(express.json());

  // Static file serving from public/ directory
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // SSE endpoint — establishes EventSource connection
  app.get('/events', (_req: Request, res: Response) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    res.write(`retry: ${SSE_RETRY_MS}\n\n`);

    sseManager.addClient(res);
  });

  // --- Runtime event → SSE broadcast wiring (Task 3) ---

  runtime.on('stateUpdate', (state: AgentState) => {
    sseManager.broadcast('stateUpdate', {
      type: 'agentState',
      timestamp: Date.now(),
      ...state,
      agents: runtime.getStates(),
    });
  });

  runtime.on('agentLifecycle', (event: AgentLifecycleEvent) => {
    const timestamp = event.timestamp ?? Date.now();
    sseManager.broadcast('systemEvent', {
      type: 'lifecycle',
      ...event,
      timestamp,
    });
  });

  runtime.on('rulesReloaded', (event: RulesReloadedEvent) => {
    const timestamp = event.timestamp ?? Date.now();
    sseManager.broadcast('systemEvent', {
      type: 'hotReload',
      ...event,
      timestamp,
    });
  });

  runtime.on('marketUpdate', (event: MarketUpdateEvent) => {
    const timestamp = event.timestamp ?? Date.now();
    sseManager.broadcast('marketUpdate', {
      type: 'market',
      ...event,
      timestamp,
    });
  });

  runtime.on('simulationMode', (event: SimulationModeEvent) => {
    const timestamp = event.timestamp ?? Date.now();
    sseManager.broadcast('modeChange', {
      type: 'mode',
      ...event,
      timestamp,
    });
  });

  // --- Market control REST endpoints (Task 4) ---

  app.post('/api/market/dip', (req: Request, res: Response) => {
    const { percent } = req.body as { percent: number };
    runtime.injectDip(percent);
    res.status(200).json({ success: true, clients: sseManager.getClientCount() });
  });

  app.post('/api/market/rally', (req: Request, res: Response) => {
    const { percent } = req.body as { percent: number };
    runtime.injectRally(percent);
    res.status(200).json({ success: true, clients: sseManager.getClientCount() });
  });

  app.post('/api/market/reset', (_req: Request, res: Response) => {
    runtime.resetMarket();
    res.status(200).json({ success: true, clients: sseManager.getClientCount() });
  });

  // Error handler — MUST have exactly 4 parameters for Express 5
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  return { app, sseManager, port };
}
