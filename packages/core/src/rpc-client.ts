import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  address,
  lamports,
  sendAndConfirmTransactionFactory,
} from '@solana/kit';
import type { Blockhash } from '@solana/kit';
import {
  BASE_RETRY_DELAY_MS,
  DEFAULT_RPC_URL,
  HEALTH_CHECK_INTERVAL_MS,
  HEALTH_CHECK_POLL_INTERVAL_MS,
  LAMPORTS_PER_SOL,
  MAX_ENDPOINTS,
  MAX_RETRY_ATTEMPTS,
  SIMULATION_FAILURE_THRESHOLD,
} from './constants.js';
import type { Balance, ConnectionMode, ResilientRpcConfig, TransactionResult } from './types.js';

function httpToWs(url: string): string {
  return url.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
      return true;
    }
    const msg = error.message.toLowerCase();
    if (
      msg.includes('fetch') ||
      msg.includes('network') ||
      msg.includes('timeout') ||
      msg.includes('429') ||
      msg.includes('dns') ||
      msg.includes('socket hang up') ||
      msg.includes('econnreset')
    ) {
      return true;
    }
  }
  return false;
}

function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests');
  }
  return false;
}

function isTransactionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const msg = error.message.toLowerCase();
  return (
    msg.includes('insufficient funds') ||
    msg.includes('program error') ||
    msg.includes('simulation failed') ||
    msg.includes('transaction failed') ||
    msg.includes('invalid params') ||
    msg.includes('signature verification') ||
    msg.includes('blockhash not found')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface RpcClient {
  getBalance(addr: string): Promise<Balance>;
  sendAndConfirm(
    signedTxOrFactory:
      | Parameters<ReturnType<typeof sendAndConfirmTransactionFactory>>[0]
      | (() => Promise<Parameters<ReturnType<typeof sendAndConfirmTransactionFactory>>[0]>),
    options?: { simulationLabel?: string },
  ): Promise<TransactionResult | void>;
  getLatestBlockhash(): Promise<{ blockhash: Blockhash; lastValidBlockHeight: bigint }>;
  requestAirdrop(addr: string, amount: bigint): Promise<string>;
  getConnectionMode(): ConnectionMode;
  cleanup(): void;
}

function resolveEndpoints(config: ResilientRpcConfig): string[] {
  const configEndpoints = config.endpoints ?? config.rpcEndpoints;
  if (configEndpoints !== undefined && configEndpoints.length > 0) {
    const filtered = configEndpoints.map(url => url.trim()).filter(Boolean).slice(0, MAX_ENDPOINTS);
    if (filtered.length > 0) {
      return filtered;
    }
  }

  const envEndpoints = process.env.RPC_ENDPOINTS
    ?.split(',')
    .map(url => url.trim())
    .filter(Boolean);
  if (envEndpoints !== undefined && envEndpoints.length > 0) {
    return envEndpoints.slice(0, MAX_ENDPOINTS);
  }

  return [config.rpcUrl ?? process.env.RPC_URL ?? DEFAULT_RPC_URL];
}

export function createRpcClient(config: ResilientRpcConfig): RpcClient {
  const endpoints = resolveEndpoints(config);
  const maxRetries = Math.max(0, config.maxRetries ?? MAX_RETRY_ATTEMPTS);
  const baseDelayMs = Math.max(1, config.baseDelayMs ?? BASE_RETRY_DELAY_MS);
  const healthCheckPollIntervalMs = config.healthCheckIntervalMs ?? HEALTH_CHECK_POLL_INTERVAL_MS;
  const onSimulationModeChange = config.onSimulationModeChange;

  let currentEndpointIndex = 0;
  let mode: ConnectionMode = 'normal';
  let rpc = createSolanaRpc(endpoints[currentEndpointIndex]!);
  let rpcSubscriptions = createSolanaRpcSubscriptions(httpToWs(endpoints[currentEndpointIndex]!));
  let sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  // Simulation mode state
  let consecutiveNetworkFailures = 0;
  let simulationEnteredAt: number | null = null;
  let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  let lastKnownBalance: Balance = { lamports: 0n, sol: 0 };
  let simulationSignatureCounter = 0;

  const isSimulationMode = (): boolean => mode === 'simulation';

  const getCurrentEndpoint = (): string => endpoints[currentEndpointIndex]!;
  const refreshClients = (): void => {
    rpc = createSolanaRpc(getCurrentEndpoint());
    rpcSubscriptions = createSolanaRpcSubscriptions(httpToWs(getCurrentEndpoint()));
    sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  };

  const rotateEndpoint = (): void => {
    if (endpoints.length <= 1) {
      return;
    }
    currentEndpointIndex = (currentEndpointIndex + 1) % endpoints.length;
    mode = currentEndpointIndex === 0 ? 'normal' : 'degraded';
    refreshClients();
  };

  const markSuccess = (): void => {
    consecutiveNetworkFailures = 0;
    mode = currentEndpointIndex === 0 ? 'normal' : 'degraded';
  };

  const stopHealthCheck = (): void => {
    if (healthCheckTimer !== null) {
      clearInterval(healthCheckTimer);
      healthCheckTimer = null;
    }
  };

  const exitSimulationMode = (): void => {
    mode = 'normal';
    currentEndpointIndex = 0;
    consecutiveNetworkFailures = 0;
    simulationEnteredAt = null;
    stopHealthCheck();
    refreshClients();
    onSimulationModeChange?.(false, 'Health check succeeded — primary endpoint recovered');
  };

  const performHealthCheck = async (): Promise<void> => {
    try {
      const healthRpc = createSolanaRpc(endpoints[0]!);
      await (healthRpc as ReturnType<typeof createSolanaRpc> & { getHealth(): { send(): Promise<string> } }).getHealth().send();
      exitSimulationMode();
    } catch {
      // Health check failed — stay in simulation mode
    }
  };

  const startHealthCheck = (): void => {
    if (healthCheckTimer !== null) return;
    healthCheckTimer = setInterval(() => {
      void performHealthCheck();
    }, healthCheckPollIntervalMs);
  };

  const enterSimulationMode = (reason: string): void => {
    mode = 'simulation';
    simulationEnteredAt = Date.now();
    void simulationEnteredAt;
    startHealthCheck();
    onSimulationModeChange?.(true, reason);
  };

  const generateSimulatedTransactionResult = (simulationLabel?: string): TransactionResult => ({
    signature: `sim-${Date.now().toString(36)}-${simulationLabel ?? String(simulationSignatureCounter++)}`,
    status: 'simulated',
    mode: 'simulation',
  });

  async function withRetry<T>(
    operationName: string,
    operation: () => Promise<T>,
    nonRetryTag: '[RPC_REQUEST_ERROR]' | '[RPC_TRANSACTION_ERROR]' | '[RPC_AIRDROP_FAILED]',
    nonRetryHelp: string,
    rateLimitExhaustedError?: (error: unknown) => Error,
  ): Promise<T> {
    let lastError: unknown = undefined;
    const totalAttempts = maxRetries + 1;
    let totalDelayMs = 0;
    let lastErrorWasRateLimit = false;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      try {
        const result = await operation();
        markSuccess();
        return result;
      } catch (error: unknown) {
        lastError = error;

        if (!isNetworkError(error) || isTransactionError(error)) {
          throw new Error(
            `${nonRetryTag} ${operationName} failed: ${getErrorMessage(error)}. ${nonRetryHelp}`,
            { cause: error },
          );
        }

        const isRateLimit = isRateLimitError(error);
        lastErrorWasRateLimit = isRateLimit;
        if (!isRateLimit) {
          consecutiveNetworkFailures++;
        }
        if (consecutiveNetworkFailures >= SIMULATION_FAILURE_THRESHOLD && !isSimulationMode()) {
          enterSimulationMode(
            `RPC reached ${String(consecutiveNetworkFailures)} consecutive network failures`,
          );
          break;
        }

        if (attempt > maxRetries) {
          break;
        }

        const retryAttempt = attempt;
        const rateLimitMultiplier = isRateLimit ? 2 : 1;
        const delayMsRaw = baseDelayMs * (2 ** (retryAttempt - 1)) * rateLimitMultiplier;
        const delayBudgetMs = HEALTH_CHECK_INTERVAL_MS;
        const remainingBudgetMs = Math.max(0, delayBudgetMs - totalDelayMs);
        const delayMs = Math.min(delayMsRaw, remainingBudgetMs);
        rotateEndpoint();
        if (delayMs > 0) {
          await sleep(delayMs);
          totalDelayMs += delayMs;
        }
      }
    }

    if (lastErrorWasRateLimit && rateLimitExhaustedError !== undefined) {
      throw rateLimitExhaustedError(lastError);
    }

    const message = getErrorMessage(lastError);
    throw new Error(
      `[RPC_NETWORK_ERROR] Network issue — retrying exhausted (${maxRetries} retries, ${totalAttempts} total attempts) ` +
        `on endpoint ${getCurrentEndpoint()}: ${message}. Check your RPC endpoint configuration.`,
      { cause: lastError },
    );
  }

  return Object.freeze({
    async getBalance(addr: string): Promise<Balance> {
      if (mode === 'simulation') {
        return lastKnownBalance;
      }
      try {
        return await withRetry(
          'RPC request while fetching balance',
          async () => {
            const result = await rpc.getBalance(address(addr)).send();
            const value = result.value;
            const balance: Balance = {
              lamports: value,
              sol: Number(value) / LAMPORTS_PER_SOL,
            };
            lastKnownBalance = balance;
            return balance;
          },
          '[RPC_REQUEST_ERROR]',
          'Check the request parameters.',
        );
      } catch (error: unknown) {
        if (isSimulationMode()) {
          return lastKnownBalance;
        }
        throw error;
      }
    },

    async sendAndConfirm(
      signedTxOrFactory:
        | Parameters<typeof sendAndConfirm>[0]
        | (() => Promise<Parameters<typeof sendAndConfirm>[0]>),
      options?: { simulationLabel?: string },
    ): Promise<TransactionResult | void> {
      if (mode === 'simulation') {
        return generateSimulatedTransactionResult(options?.simulationLabel);
      }
      try {
        await withRetry(
          'Transaction submission',
          async () => {
            const signedTx = typeof signedTxOrFactory === 'function'
              ? await signedTxOrFactory()
              : signedTxOrFactory;
            await sendAndConfirm(signedTx, { commitment: 'confirmed' });
          },
          '[RPC_TRANSACTION_ERROR]',
          'Transaction invalid — check your config.',
        );
      } catch (error: unknown) {
        if (isSimulationMode()) {
          return generateSimulatedTransactionResult(options?.simulationLabel);
        }
        throw error;
      }
    },

    async getLatestBlockhash(): Promise<{ blockhash: Blockhash; lastValidBlockHeight: bigint }> {
      if (mode === 'simulation') {
        return {
          blockhash: '11111111111111111111111111111111' as Blockhash,
          lastValidBlockHeight: 0n,
        };
      }
      try {
        return await withRetry(
          'RPC request while fetching latest blockhash',
          async () => {
            const result = await rpc.getLatestBlockhash().send();
            return {
              blockhash: result.value.blockhash,
              lastValidBlockHeight: result.value.lastValidBlockHeight,
            };
          },
          '[RPC_REQUEST_ERROR]',
          'Check the request parameters.',
        );
      } catch (error: unknown) {
        if (isSimulationMode()) {
          return {
            blockhash: '11111111111111111111111111111111' as Blockhash,
            lastValidBlockHeight: 0n,
          };
        }
        throw error;
      }
    },

    async requestAirdrop(addr: string, amount: bigint): Promise<string> {
      if (amount <= 0n) {
        throw new Error('[RPC_AIRDROP_FAILED] Airdrop amount must be greater than 0 lamports.');
      }

      if (mode === 'simulation') {
        return `sim-${Date.now().toString(36)}-${String(simulationSignatureCounter++)}`;
      }

      try {
        return await withRetry(
          'Airdrop request',
          async () => rpc.requestAirdrop(address(addr), lamports(amount)).send(),
          '[RPC_AIRDROP_FAILED]',
          `Check airdrop request parameters for address ${addr}.`,
          error => new Error(
            `[RPC_AIRDROP_RATE_LIMITED] Airdrop failed — devnet faucet rate-limited. ` +
              `Wait 60 seconds or fund treasury manually at address ${addr}.`,
            { cause: error },
          ),
        );
      } catch (error: unknown) {
        if (isSimulationMode()) {
          return `sim-${Date.now().toString(36)}-${String(simulationSignatureCounter++)}`;
        }
        throw error;
      }
    },

    getConnectionMode(): ConnectionMode {
      return mode;
    },

    cleanup(): void {
      stopHealthCheck();
    },
  });
}
