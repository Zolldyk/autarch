import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileWatcher } from '../src/file-watcher.js';
import { DEBOUNCE_MS } from '../src/constants.js';

// Mock node:fs
vi.mock('node:fs', () => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  let changeCallback: ((eventType: string, filename: string | null) => void) | null = null;

  const mockWatcher = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      listeners.set(event, cb);
      return mockWatcher;
    }),
    close: vi.fn(),
    _listeners: listeners,
    _triggerChange: () => {
      if (changeCallback) changeCallback('change', 'test.json');
    },
    _triggerRename: () => {
      if (changeCallback) changeCallback('rename', 'test.json');
    },
    _triggerError: (err: Error) => {
      const errorCb = listeners.get('error');
      if (errorCb) errorCb(err);
    },
    _reset: () => {
      listeners.clear();
      changeCallback = null;
      mockWatcher.on.mockClear();
      mockWatcher.close.mockClear();
    },
  };

  return {
    watch: vi.fn((_path: string, cb: (eventType: string, filename: string | null) => void) => {
      changeCallback = cb;
      return mockWatcher;
    }),
    _mockWatcher: mockWatcher,
  };
});

// Mock loadAgentConfig
vi.mock('../src/config-loader.js', () => ({
  loadAgentConfig: vi.fn(),
}));

import { watch, _mockWatcher } from 'node:fs';
import { loadAgentConfig } from '../src/config-loader.js';
import type { AgentConfig } from '../src/types.js';

const mockWatcher = _mockWatcher as unknown as {
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  _triggerChange: () => void;
  _triggerRename: () => void;
  _triggerError: (err: Error) => void;
  _reset: () => void;
};

const mockLoadConfig = loadAgentConfig as ReturnType<typeof vi.fn>;

const validConfig: AgentConfig = {
  name: 'Test Agent',
  strategy: 'Buy the dip',
  intervalMs: 60000,
  rules: [
    {
      name: 'rule-1',
      conditions: [{ field: 'price_drop', operator: '>' as const, threshold: 5 }],
      action: 'buy' as const,
      amount: 0.1,
      weight: 80,
      cooldownSeconds: 60,
    },
  ],
};

describe('FileWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockWatcher._reset();
    mockLoadConfig.mockReset();
    (watch as ReturnType<typeof vi.fn>).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('detects file change and calls onReload with valid config', async () => {
    mockLoadConfig.mockResolvedValue(validConfig);
    const onReload = vi.fn();
    const onError = vi.fn();

    const fw = new FileWatcher('/path/to/config.json', onReload, onError);
    fw.start();

    mockWatcher._triggerChange();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(mockLoadConfig).toHaveBeenCalledWith('/path/to/config.json');
    expect(onReload).toHaveBeenCalledWith(validConfig);
    expect(onError).not.toHaveBeenCalled();

    fw.close();
  });

  it('detects file rename events and calls onReload (atomic save compatibility)', async () => {
    mockLoadConfig.mockResolvedValue(validConfig);
    const onReload = vi.fn();
    const onError = vi.fn();

    const fw = new FileWatcher('/path/to/config.json', onReload, onError);
    fw.start();

    mockWatcher._triggerRename();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(mockLoadConfig).toHaveBeenCalledWith('/path/to/config.json');
    expect(onReload).toHaveBeenCalledWith(validConfig);
    expect(onError).not.toHaveBeenCalled();

    fw.close();
  });

  it('calls onError when file contains invalid JSON', async () => {
    mockLoadConfig.mockRejectedValue(new SyntaxError('Invalid JSON in config file'));
    const onReload = vi.fn();
    const onError = vi.fn();

    const fw = new FileWatcher('/path/to/config.json', onReload, onError);
    fw.start();

    mockWatcher._triggerChange();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(onReload).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Invalid JSON'));

    fw.close();
  });

  it('calls onError when file fails schema validation', async () => {
    mockLoadConfig.mockRejectedValue(new Error('Invalid agent config: missing rules'));
    const onReload = vi.fn();
    const onError = vi.fn();

    const fw = new FileWatcher('/path/to/config.json', onReload, onError);
    fw.start();

    mockWatcher._triggerChange();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(onReload).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Invalid agent config'));

    fw.close();
  });

  it('debounces multiple rapid events — only one reload per burst', async () => {
    mockLoadConfig.mockResolvedValue(validConfig);
    const onReload = vi.fn();
    const onError = vi.fn();

    const fw = new FileWatcher('/path/to/config.json', onReload, onError);
    fw.start();

    // Fire 5 rapid change events
    mockWatcher._triggerChange();
    mockWatcher._triggerChange();
    mockWatcher._triggerChange();
    mockWatcher._triggerChange();
    mockWatcher._triggerChange();

    // Advance past debounce
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(onReload).toHaveBeenCalledTimes(1);

    fw.close();
  });

  it('close() stops watching — no further callbacks after close', async () => {
    mockLoadConfig.mockResolvedValue(validConfig);
    const onReload = vi.fn();
    const onError = vi.fn();

    const fw = new FileWatcher('/path/to/config.json', onReload, onError);
    fw.start();

    fw.close();

    mockWatcher._triggerChange();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(onReload).not.toHaveBeenCalled();
    expect(mockWatcher.close).toHaveBeenCalledOnce();
  });

  it('close() clears pending debounce timer', async () => {
    mockLoadConfig.mockResolvedValue(validConfig);
    const onReload = vi.fn();

    const fw = new FileWatcher('/path/to/config.json', onReload, vi.fn());
    fw.start();

    mockWatcher._triggerChange();
    // Close before debounce fires
    fw.close();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(onReload).not.toHaveBeenCalled();
  });

  it('isWatching() returns correct state', () => {
    const fw = new FileWatcher('/path/to/config.json', vi.fn(), vi.fn());

    expect(fw.isWatching()).toBe(false);

    fw.start();
    expect(fw.isWatching()).toBe(true);

    fw.close();
    expect(fw.isWatching()).toBe(false);
  });

  it('handles file read errors gracefully (calls onError, no crash)', async () => {
    mockLoadConfig.mockRejectedValue(new Error('Cannot read config file: ENOENT'));
    const onReload = vi.fn();
    const onError = vi.fn();

    const fw = new FileWatcher('/path/to/config.json', onReload, onError);
    fw.start();

    mockWatcher._triggerChange();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Cannot read config file'));
    expect(onReload).not.toHaveBeenCalled();

    fw.close();
  });

  it('double-close does not throw', () => {
    const fw = new FileWatcher('/path/to/config.json', vi.fn(), vi.fn());
    fw.start();

    expect(() => {
      fw.close();
      fw.close();
    }).not.toThrow();
  });

  it('events after close are ignored (closed guard in scheduleReload)', async () => {
    mockLoadConfig.mockResolvedValue(validConfig);
    const onReload = vi.fn();

    const fw = new FileWatcher('/path/to/config.json', onReload, vi.fn());
    fw.start();
    fw.close();

    // Simulate event arriving after close
    mockWatcher._triggerChange();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(onReload).not.toHaveBeenCalled();
  });
});
