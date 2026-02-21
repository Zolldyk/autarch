/** Configuration for seed loading behavior. */
export interface SeedConfig {
  /** Raw seed bytes (32 or 64 bytes). */
  readonly seed: Uint8Array;
  /** Whether the demo seed is being used. */
  readonly isDemo: boolean;
}
