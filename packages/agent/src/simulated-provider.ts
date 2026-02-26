import {
  DEFAULT_BASELINE_PRICE,
  DEFAULT_VOLATILITY,
  MAX_HISTORY_SIZE,
  MIN_PRICE,
  MAX_PRICE,
  DEFAULT_BASE_VOLUME,
} from './constants.js';
import type { MarketData, MarketDataProvider } from './types.js';

/** Configuration options for SimulatedMarketDataProvider. */
export interface SimulatedProviderOptions {
  /** Baseline price the provider resets to. Defaults to DEFAULT_BASELINE_PRICE (100). */
  readonly baselinePrice?: number;
  /** Per-tick volatility multiplier. Defaults to DEFAULT_VOLATILITY (0.02). */
  readonly volatility?: number;
  /** Maximum entries in the history ring buffer. Defaults to MAX_HISTORY_SIZE (100). */
  readonly maxHistorySize?: number;
}

/**
 * Simulated market data provider that generates price movements via random walk
 * and supports manual event injection.
 */
export class SimulatedMarketDataProvider implements MarketDataProvider {
  private readonly baselinePrice: number;
  private readonly volatility: number;
  private readonly maxHistorySize: number;
  private price: number;
  private volume: number;
  private history: MarketData[] = [];
  private volumeHistory: number[] = [];

  constructor(options?: SimulatedProviderOptions) {
    this.baselinePrice = options?.baselinePrice ?? DEFAULT_BASELINE_PRICE;
    this.volatility = options?.volatility ?? DEFAULT_VOLATILITY;
    const configuredHistorySize = options?.maxHistorySize ?? MAX_HISTORY_SIZE;
    if (!Number.isFinite(configuredHistorySize) || configuredHistorySize < 1) {
      throw new RangeError('maxHistorySize must be a finite number greater than or equal to 1');
    }
    this.maxHistorySize = Math.floor(configuredHistorySize);
    this.price = this.baselinePrice;
    this.volume = DEFAULT_BASE_VOLUME;
  }

  /**
   * Advance the random walk and return the current market data snapshot.
   * @returns The latest MarketData point with source 'simulated'.
   */
  getCurrentData(): MarketData {
    const priceChange = this.price * this.volatility * (Math.random() - 0.5) * 2;
    this.price = Math.max(MIN_PRICE, Math.min(MAX_PRICE, this.price + priceChange));
    this.volume = DEFAULT_BASE_VOLUME * (0.5 + Math.random());

    const priceChange1m = this.calcPriceChangeFromHistory(this.price, 60_000);
    const priceChange5m = this.calcPriceChangeFromHistory(this.price, 300_000);
    const volumeChange1m = this.calcVolumeChangeFromHistory(this.volume, 60_000);

    const data: MarketData = {
      price: this.price,
      priceChange1m,
      priceChange5m,
      volumeChange1m,
      timestamp: Date.now(),
      source: 'simulated',
    };

    this.pushToHistory(data, this.volume);
    return data;
  }

  /**
   * Return the latest market snapshot without mutating simulation state.
   * @returns The latest MarketData point.
   */
  getSnapshot(): MarketData {
    const latest = this.history[this.history.length - 1];
    if (latest !== undefined) {
      return { ...latest };
    }

    return {
      price: this.price,
      priceChange1m: 0,
      priceChange5m: 0,
      volumeChange1m: 0,
      timestamp: Date.now(),
      source: 'simulated',
    };
  }

  /**
   * Return historical market data entries.
   * @param minutes - If provided, only entries within the last N minutes. Otherwise all history.
   * @returns A new array of MarketData entries (never the internal reference).
   */
  getHistory(minutes?: number): MarketData[] {
    if (minutes === undefined) {
      return [...this.history];
    }
    const cutoff = Date.now() - minutes * 60_000;
    return this.history.filter((entry) => entry.timestamp >= cutoff);
  }

  /**
   * Inject an immediate price dip.
   * @param percent - Percentage to drop the price by.
   */
  injectDip(percent: number): void {
    this.price *= 1 - percent / 100;
    this.price = Math.max(MIN_PRICE, this.price);
    this.buildAndPushInjected();
  }

  /**
   * Inject an immediate price rally.
   * @param percent - Percentage to increase the price by.
   */
  injectRally(percent: number): void {
    this.price *= 1 + percent / 100;
    this.price = Math.max(MIN_PRICE, Math.min(MAX_PRICE, this.price));
    this.buildAndPushInjected();
  }

  /**
   * Reset price to the initial baseline and clear all history.
   *
   * Restores the provider to its initial state: price returns to baselinePrice,
   * volume returns to DEFAULT_BASE_VOLUME, and the history ring buffer is emptied.
   *
   * @example
   * ```typescript
   * const provider = new SimulatedMarketDataProvider({ baselinePrice: 100 });
   * provider.injectDip(20);
   * provider.resetToBaseline(); // price back to 100, history cleared
   * ```
   */
  resetToBaseline(): void {
    this.price = this.baselinePrice;
    this.history = [];
    this.volumeHistory = [];
    this.volume = DEFAULT_BASE_VOLUME;
  }

  private buildAndPushInjected(): void {
    const priceChange1m = this.calcPriceChangeFromHistory(this.price, 60_000);
    const priceChange5m = this.calcPriceChangeFromHistory(this.price, 300_000);
    const volumeChange1m = this.calcVolumeChangeFromHistory(this.volume, 60_000);

    const data: MarketData = {
      price: this.price,
      priceChange1m,
      priceChange5m,
      volumeChange1m,
      timestamp: Date.now(),
      source: 'injected',
    };
    this.pushToHistory(data, this.volume);
  }

  private pushToHistory(data: MarketData, volume: number): void {
    if (this.history.length >= this.maxHistorySize) {
      this.history.shift();
      this.volumeHistory.shift();
    }
    this.history.push(data);
    this.volumeHistory.push(volume);
  }

  private findHistoricalIndex(msAgo: number): number {
    const targetTime = Date.now() - msAgo;
    if (this.history.length === 0) {
      return -1;
    }

    let closestIndex = 0;
    let closestDiff = Math.abs(this.history[0].timestamp - targetTime);
    for (let i = 1; i < this.history.length; i++) {
      const diff = Math.abs(this.history[i].timestamp - targetTime);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIndex = i;
      }
    }

    return closestIndex;
  }

  private calcPercentChange(current: number, previous: number): number {
    if (previous === 0) return 0;
    return ((current - previous) / previous) * 100;
  }

  private calcPriceChangeFromHistory(currentPrice: number, msAgo: number): number {
    const idx = this.findHistoricalIndex(msAgo);
    if (idx === -1) return 0;
    return this.calcPercentChange(currentPrice, this.history[idx].price);
  }

  private calcVolumeChangeFromHistory(currentVolume: number, msAgo: number): number {
    const idx = this.findHistoricalIndex(msAgo);
    if (idx === -1) return 0;
    return this.calcPercentChange(currentVolume, this.volumeHistory[idx]);
  }
}
