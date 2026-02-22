import { watch, type FSWatcher } from 'node:fs';
import { DEBOUNCE_MS } from './constants.js';
import { loadAgentConfig } from './config-loader.js';
import type { AgentConfig } from './types.js';

/**
 * Watches a JSON rule config file for changes, debounces filesystem events,
 * validates the new config, and invokes callbacks on success or failure.
 *
 * @param filePath - Absolute path to the agent's JSON rule config file.
 * @param onReload - Called with the validated new config on successful reload.
 * @param onError - Called with error message on invalid JSON, schema failure, or read error.
 */
export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly filePath: string,
    private readonly onReload: (config: AgentConfig) => void,
    private readonly onError: (error: string) => void,
  ) {}

  /**
   * Start watching the file for changes.
   *
   * @returns void
   */
  start(): void {
    if (this.watcher !== null) {
      return;
    }
    this.closed = false;

    this.watcher = watch(this.filePath, (eventType) => {
      if (eventType === 'change' || eventType === 'rename') {
        this.scheduleReload();
      }
    });

    this.watcher.on('error', (err: Error) => {
      this.onError(err.message);
      this.close();
    });
  }

  /**
   * Stop watching and clean up all resources.
   *
   * @returns void
   */
  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher !== null) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Whether the watcher is currently active.
   *
   * @returns true if watching, false otherwise.
   */
  isWatching(): boolean {
    return this.watcher !== null && !this.closed;
  }

  /**
   * Schedule a debounced reload. Clears any pending timer first.
   */
  private scheduleReload(): void {
    if (this.closed) {
      return;
    }

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      void this.reload();
    }, DEBOUNCE_MS);
  }

  /**
   * Load and validate the config file, then invoke the appropriate callback.
   * Never throws — all errors are routed to onError.
   */
  private async reload(): Promise<void> {
    if (this.closed) {
      return;
    }

    try {
      const config = await loadAgentConfig(this.filePath);
      this.onReload(config);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.onError(message);
    }
  }
}
