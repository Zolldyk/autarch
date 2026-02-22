import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SimulatedMarketDataProvider } from '../src/simulated-provider.js';
import type { MarketData, MarketDataProvider } from '../src/types.js';
import {
  DEFAULT_BASELINE_PRICE,
  DEFAULT_VOLATILITY,
  MAX_HISTORY_SIZE,
  MIN_PRICE,
  MAX_PRICE,
  DEFAULT_BASE_VOLUME,
} from '../src/constants.js';

describe('SimulatedMarketDataProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // --- Task 5.2: Default constructor creates provider with price 100 (AC: #1) ---
  it('should create provider with default baseline price of 100', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // zero change
    const provider = new SimulatedMarketDataProvider();
    const data = provider.getCurrentData();
    expect(data.price).toBe(DEFAULT_BASELINE_PRICE);
  });

  // --- Task 5.3: getCurrentData() returns MarketData with all required fields (AC: #1) ---
  it('should return MarketData with all required fields', () => {
    const provider = new SimulatedMarketDataProvider();
    const data = provider.getCurrentData();
    expect(data).toHaveProperty('price');
    expect(data).toHaveProperty('priceChange1m');
    expect(data).toHaveProperty('priceChange5m');
    expect(data).toHaveProperty('volumeChange1m');
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('source');
    expect(typeof data.price).toBe('number');
    expect(typeof data.priceChange1m).toBe('number');
    expect(typeof data.priceChange5m).toBe('number');
    expect(typeof data.volumeChange1m).toBe('number');
    expect(typeof data.timestamp).toBe('number');
  });

  // --- Task 5.4: source is 'simulated' for getCurrentData() calls (AC: #1) ---
  it('should set source to "simulated" for getCurrentData()', () => {
    const provider = new SimulatedMarketDataProvider();
    const data = provider.getCurrentData();
    expect(data.source).toBe('simulated');
  });

  // --- Task 5.5: Successive getCurrentData() calls produce different prices (AC: #2) ---
  it('should produce different prices on successive calls (random walk)', () => {
    const provider = new SimulatedMarketDataProvider();
    const prices = new Set<number>();
    for (let i = 0; i < 20; i++) {
      prices.add(provider.getCurrentData().price);
    }
    // With real randomness, extremely unlikely all 20 are identical
    expect(prices.size).toBeGreaterThan(1);
  });

  // --- Task 5.6: Price stays within bounds over many ticks (AC: #2) ---
  it('should keep price within [MIN_PRICE, MAX_PRICE] over many ticks', () => {
    const provider = new SimulatedMarketDataProvider();
    for (let i = 0; i < 1000; i++) {
      const data = provider.getCurrentData();
      expect(data.price).toBeGreaterThanOrEqual(MIN_PRICE);
      expect(data.price).toBeLessThanOrEqual(MAX_PRICE);
    }
  });

  // --- Task 5.7: priceChange1m is calculated correctly from 1-minute-old history (AC: #2) ---
  it('should calculate priceChange1m from 1-minute-old history entry', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // zero change
    const provider = new SimulatedMarketDataProvider();

    // Generate data at t=0 — price stays at 100
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    provider.getCurrentData();

    // Advance 1 minute
    vi.setSystemTime(new Date('2026-02-21T12:01:00Z'));

    // Make price increase by returning random = 1.0 (max upward)
    vi.spyOn(Math, 'random').mockReturnValue(1.0);
    const data = provider.getCurrentData();

    // priceChange1m should reflect the change from price at t=0 (100) to current
    // With random=1.0: priceChange = 100 * 0.02 * (1-0.5)*2 = 100*0.02*1 = 2, new price = 102
    // priceChange1m = ((102-100)/100)*100 = 2%
    expect(data.priceChange1m).toBeCloseTo(2, 1);
  });

  // --- Task 5.8: priceChange5m is calculated correctly from 5-minute-old history (AC: #2) ---
  it('should calculate priceChange5m from 5-minute-old history entry', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // zero change
    const provider = new SimulatedMarketDataProvider();

    // Generate data at t=0
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    provider.getCurrentData();

    // Advance 5 minutes
    vi.setSystemTime(new Date('2026-02-21T12:05:00Z'));
    vi.spyOn(Math, 'random').mockReturnValue(1.0);
    const data = provider.getCurrentData();

    // Should have non-zero priceChange5m
    expect(data.priceChange5m).toBeCloseTo(2, 1);
  });

  // --- Task 5.9: priceChange1m returns 0 when no historical entry exists (AC: #2) ---
  it('should return 0 for priceChange1m on first tick (no history)', () => {
    const provider = new SimulatedMarketDataProvider();
    const data = provider.getCurrentData();
    expect(data.priceChange1m).toBe(0);
  });

  // --- Task 5.10: volumeChange1m is calculated from historical volume (AC: #2) ---
  it('should calculate volumeChange1m from historical volume', () => {
    const randomSpy = vi.spyOn(Math, 'random');

    const provider = new SimulatedMarketDataProvider();

    // t=0: volume = DEFAULT_BASE_VOLUME * (0.5 + 0.5) = DEFAULT_BASE_VOLUME
    randomSpy.mockReturnValue(0.5);
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    provider.getCurrentData();

    // t=1m: volume = DEFAULT_BASE_VOLUME * (0.5 + 1.0) = DEFAULT_BASE_VOLUME * 1.5
    vi.setSystemTime(new Date('2026-02-21T12:01:00Z'));
    randomSpy.mockReturnValue(1.0);
    const data = provider.getCurrentData();

    // volumeChange1m = ((1500 - 1000) / 1000) * 100 = 50%
    expect(data.volumeChange1m).toBeCloseTo(50, 1);
  });

  // --- Task 5.11: injectDip(5) drops price by 5% immediately (AC: #3) ---
  it('should drop price by specified percentage on injectDip', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // zero change
    const provider = new SimulatedMarketDataProvider();
    provider.getCurrentData(); // price = 100

    provider.injectDip(5);
    const history = provider.getHistory();
    const lastEntry = history[history.length - 1];
    expect(lastEntry.price).toBeCloseTo(95, 5);
  });

  // --- Task 5.12: injectDip() creates history entry with source 'injected' (AC: #3) ---
  it('should set source to "injected" for injectDip entries', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const provider = new SimulatedMarketDataProvider();
    provider.getCurrentData();

    provider.injectDip(10);
    const history = provider.getHistory();
    const lastEntry = history[history.length - 1];
    expect(lastEntry.source).toBe('injected');
  });

  // --- Task 5.13: getCurrentData() after injectDip() resumes random walk from new price (AC: #3) ---
  it('should resume random walk from new price after injectDip', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // zero change
    const provider = new SimulatedMarketDataProvider();
    provider.getCurrentData(); // price = 100

    provider.injectDip(50); // price = 50

    // Next getCurrentData should start from ~50, not ~100
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // zero change
    const data = provider.getCurrentData();
    expect(data.price).toBeCloseTo(50, 5);
    expect(data.source).toBe('simulated');
  });

  // --- Task 5.14: injectRally(10) increases price by 10% immediately (AC: #4) ---
  it('should increase price by specified percentage on injectRally', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const provider = new SimulatedMarketDataProvider();
    provider.getCurrentData(); // price = 100

    provider.injectRally(10);
    const history = provider.getHistory();
    const lastEntry = history[history.length - 1];
    expect(lastEntry.price).toBeCloseTo(110, 5);
  });

  // --- Task 5.15: injectRally() creates history entry with source 'injected' (AC: #4) ---
  it('should set source to "injected" for injectRally entries', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const provider = new SimulatedMarketDataProvider();
    provider.getCurrentData();

    provider.injectRally(10);
    const history = provider.getHistory();
    const lastEntry = history[history.length - 1];
    expect(lastEntry.source).toBe('injected');
  });

  // --- Task 5.16: resetToBaseline() returns price to initial default (AC: #5) ---
  it('should reset price to baseline on resetToBaseline', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const provider = new SimulatedMarketDataProvider();

    // Move price away from baseline
    provider.injectRally(50); // price = 150

    provider.resetToBaseline();

    // Next getCurrentData should start from 100
    const data = provider.getCurrentData();
    expect(data.price).toBe(DEFAULT_BASELINE_PRICE);
  });

  // --- Task 5.17: resetToBaseline() clears history (AC: #5) ---
  it('should clear history on resetToBaseline', () => {
    const provider = new SimulatedMarketDataProvider();
    provider.getCurrentData();
    provider.getCurrentData();
    expect(provider.getHistory().length).toBe(2);

    provider.resetToBaseline();
    expect(provider.getHistory().length).toBe(0);
  });

  // --- Task 5.18: getHistory() with no args returns all history entries (AC: #6) ---
  it('should return all history entries when called with no args', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const provider = new SimulatedMarketDataProvider();

    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(new Date('2026-02-21T12:00:00Z').getTime() + i * 60_000);
      provider.getCurrentData();
    }

    const history = provider.getHistory();
    expect(history.length).toBe(5);
  });

  // --- Task 5.19: getHistory(minutes) returns only entries within time window (AC: #6) ---
  it('should return only entries within time window for getHistory(minutes)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const provider = new SimulatedMarketDataProvider();
    const baseTime = new Date('2026-02-21T12:00:00Z').getTime();

    // Generate 5 entries, 1 minute apart
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(baseTime + i * 60_000);
      provider.getCurrentData();
    }

    // Current time is at t=4m. getHistory(2) should return entries from t=2m onward
    // Current time is baseTime + 4*60000. getHistory(2) → cutoff = now - 2*60000 = baseTime + 2*60000.
    // Entries with timestamp >= cutoff: t=2m (equal), t=3m, t=4m = 3 entries
    const recent = provider.getHistory(2);
    expect(recent.length).toBe(3);
  });

  // --- Task 5.20: Ring buffer caps at MAX_HISTORY_SIZE (AC: #6) ---
  it('should cap history at maxHistorySize entries', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const provider = new SimulatedMarketDataProvider({ maxHistorySize: 10 });

    for (let i = 0; i < 20; i++) {
      vi.setSystemTime(new Date('2026-02-21T12:00:00Z').getTime() + i * 1000);
      provider.getCurrentData();
    }

    expect(provider.getHistory().length).toBe(10);
  });

  // --- Task 5.21: getHistory() returns a new array (not internal reference) (AC: #6) ---
  it('should return a new array from getHistory, not internal reference', () => {
    const provider = new SimulatedMarketDataProvider();
    provider.getCurrentData();

    const history1 = provider.getHistory();
    const history2 = provider.getHistory();
    expect(history1).not.toBe(history2);
    expect(history1).toEqual(history2);
  });

  // --- Task 5.22: Custom SimulatedProviderOptions are respected (AC: #7) ---
  it('should respect custom baselinePrice option', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const provider = new SimulatedMarketDataProvider({ baselinePrice: 200 });
    const data = provider.getCurrentData();
    expect(data.price).toBe(200);
  });

  it('should respect custom volatility option', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1.0); // max upward
    const lowVol = new SimulatedMarketDataProvider({ volatility: 0.01 });
    const highVol = new SimulatedMarketDataProvider({ volatility: 0.10 });

    const lowData = lowVol.getCurrentData();
    const highData = highVol.getCurrentData();

    // Higher volatility → bigger price change from 100
    const lowChange = Math.abs(lowData.price - DEFAULT_BASELINE_PRICE);
    const highChange = Math.abs(highData.price - DEFAULT_BASELINE_PRICE);
    expect(highChange).toBeGreaterThan(lowChange);
  });

  it('should respect custom maxHistorySize option', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const provider = new SimulatedMarketDataProvider({ maxHistorySize: 5 });

    for (let i = 0; i < 10; i++) {
      vi.setSystemTime(new Date('2026-02-21T12:00:00Z').getTime() + i * 1000);
      provider.getCurrentData();
    }

    expect(provider.getHistory().length).toBe(5);
  });

  // --- Task 5.23: Provider implements MarketDataProvider interface (type-level check) (AC: #7) ---
  it('should satisfy MarketDataProvider interface', () => {
    const provider: MarketDataProvider = new SimulatedMarketDataProvider();
    expect(typeof provider.getCurrentData).toBe('function');
    expect(typeof provider.getSnapshot).toBe('function');
    expect(typeof provider.getHistory).toBe('function');
    expect(typeof provider.injectDip).toBe('function');
    expect(typeof provider.injectRally).toBe('function');
    expect(typeof provider.resetToBaseline).toBe('function');
  });

  // --- Task 5.24: injectDip() clamps price to MIN_PRICE ---
  it('should clamp price to MIN_PRICE on extreme dip', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const provider = new SimulatedMarketDataProvider();
    provider.getCurrentData(); // price = 100

    provider.injectDip(99.999);
    const history = provider.getHistory();
    const lastEntry = history[history.length - 1];
    expect(lastEntry.price).toBeGreaterThanOrEqual(MIN_PRICE);
  });

  // --- Task 5.25: injectRally() clamps price to MAX_PRICE ---
  it('should clamp price to MAX_PRICE on extreme rally', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const provider = new SimulatedMarketDataProvider();
    provider.getCurrentData(); // price = 100

    provider.injectRally(100_000); // massive rally
    const history = provider.getHistory();
    const lastEntry = history[history.length - 1];
    expect(lastEntry.price).toBeLessThanOrEqual(MAX_PRICE);
  });

  // --- Task 5.26: resetToBaseline() with custom baselinePrice resets to that custom price ---
  it('should reset to custom baselinePrice on resetToBaseline', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const provider = new SimulatedMarketDataProvider({ baselinePrice: 500 });
    provider.getCurrentData();
    provider.injectRally(50); // price = 750

    provider.resetToBaseline();

    const data = provider.getCurrentData();
    expect(data.price).toBe(500);
  });

  // --- Task 5.27: All tests use vi.useFakeTimers() (verified by beforeEach/afterEach) ---

  // --- Additional edge case tests ---
  it('should set timestamp to Date.now() for getCurrentData', () => {
    const provider = new SimulatedMarketDataProvider();
    vi.setSystemTime(new Date('2026-02-21T15:30:00Z'));
    const data = provider.getCurrentData();
    expect(data.timestamp).toBe(new Date('2026-02-21T15:30:00Z').getTime());
  });

  it('should set timestamp to Date.now() for injected entries', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const provider = new SimulatedMarketDataProvider();
    provider.getCurrentData();

    vi.setSystemTime(new Date('2026-02-21T15:31:00Z'));
    provider.injectDip(5);

    const history = provider.getHistory();
    const lastEntry = history[history.length - 1];
    expect(lastEntry.timestamp).toBe(new Date('2026-02-21T15:31:00Z').getTime());
  });

  it('should return latest injected snapshot without advancing random walk', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const provider = new SimulatedMarketDataProvider();
    provider.getCurrentData(); // baseline 100

    provider.injectDip(10); // 90, injected
    const snapshot = provider.getSnapshot();
    expect(snapshot.price).toBeCloseTo(90, 5);
    expect(snapshot.source).toBe('injected');

    const history = provider.getHistory();
    expect(history[history.length - 1]!.price).toBeCloseTo(90, 5);
  });

  it('should remove oldest entries when ring buffer is full', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const provider = new SimulatedMarketDataProvider({ maxHistorySize: 3 });
    const baseTime = new Date('2026-02-21T12:00:00Z').getTime();

    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(baseTime + i * 1000);
      provider.getCurrentData();
    }

    const history = provider.getHistory();
    expect(history.length).toBe(3);
    // Oldest entries (t=0, t=1) should be gone; newest (t=2, t=3, t=4) remain
    expect(history[0].timestamp).toBe(baseTime + 2 * 1000);
    expect(history[2].timestamp).toBe(baseTime + 4 * 1000);
  });

  it('should handle getHistory(minutes) returning filtered copy for injected entries', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const provider = new SimulatedMarketDataProvider();
    const baseTime = new Date('2026-02-21T12:00:00Z').getTime();

    vi.setSystemTime(baseTime);
    provider.getCurrentData();

    vi.setSystemTime(baseTime + 120_000); // 2 minutes later
    provider.injectDip(10);

    // getHistory(1) from t=2m should include only the injected entry (at t=2m)
    const recent = provider.getHistory(1);
    expect(recent.length).toBe(1);
    expect(recent[0].source).toBe('injected');
  });

  it('should return priceChange5m as 0 when no 5-minute-old entry exists', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const provider = new SimulatedMarketDataProvider();

    // Only 1 minute of data
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    provider.getCurrentData();

    vi.setSystemTime(new Date('2026-02-21T12:01:00Z'));
    const data = provider.getCurrentData();

    // No 5-minute-old entry exists
    expect(data.priceChange5m).toBe(0);
  });

  it('should reset volume to DEFAULT_BASE_VOLUME on resetToBaseline', () => {
    const provider = new SimulatedMarketDataProvider();
    // After reset + getCurrentData with random=0.5, volume = DEFAULT_BASE_VOLUME * (0.5+0.5) = DEFAULT_BASE_VOLUME
    provider.getCurrentData();
    provider.resetToBaseline();

    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const data = provider.getCurrentData();
    // volume = DEFAULT_BASE_VOLUME * (0.5 + 0.5) = DEFAULT_BASE_VOLUME
    // No history → volumeChange1m = 0
    expect(data.volumeChange1m).toBe(0);
  });

  it('should use historical entry closest to the 1-minute target timestamp', () => {
    const randomSpy = vi.spyOn(Math, 'random');
    const provider = new SimulatedMarketDataProvider({ volatility: 0.1 });
    const base = new Date('2026-02-21T12:00:00Z').getTime();

    // t=0s, random walk no-op -> 100
    vi.setSystemTime(base);
    randomSpy.mockReturnValue(0.5);
    provider.getCurrentData();

    // t=50s, upward move -> 110
    vi.setSystemTime(base + 50_000);
    randomSpy.mockReturnValue(1.0);
    provider.getCurrentData();

    // t=125s, upward move -> 121
    // target for 1m is t=65s, so closest sample is t=50s (15s away) not t=0 (65s away)
    vi.setSystemTime(base + 125_000);
    randomSpy.mockReturnValue(1.0);
    const data = provider.getCurrentData();

    // Based on closest sample (110): ((121 - 110)/110) * 100 = 10%
    expect(data.priceChange1m).toBeCloseTo(10, 5);
  });

  it('should throw on invalid maxHistorySize values', () => {
    expect(() => new SimulatedMarketDataProvider({ maxHistorySize: 0 })).toThrow(RangeError);
    expect(() => new SimulatedMarketDataProvider({ maxHistorySize: -1 })).toThrow(RangeError);
    expect(() => new SimulatedMarketDataProvider({ maxHistorySize: Number.NaN })).toThrow(RangeError);
  });
});
