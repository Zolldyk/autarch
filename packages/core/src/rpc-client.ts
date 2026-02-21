import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  address,
  lamports,
  sendAndConfirmTransactionFactory,
} from '@solana/kit';
import type { Blockhash } from '@solana/kit';
import { DEFAULT_RPC_URL, LAMPORTS_PER_SOL } from './constants.js';
import type { Balance, RpcConfig } from './types.js';

function httpToWs(url: string): string {
  return url.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
      return true;
    }
    const msg = error.message.toLowerCase();
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('timeout') || msg.includes('429') || msg.includes('dns')) {
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

export interface RpcClient {
  getBalance(addr: string): Promise<Balance>;
  sendAndConfirm(signedTx: Parameters<ReturnType<typeof sendAndConfirmTransactionFactory>>[0]): Promise<void>;
  getLatestBlockhash(): Promise<{ blockhash: Blockhash; lastValidBlockHeight: bigint }>;
  requestAirdrop(addr: string, amount: bigint): Promise<string>;
}

export function createRpcClient(config: RpcConfig): RpcClient {
  const rpcUrl = config.rpcUrl ?? process.env.RPC_URL ?? DEFAULT_RPC_URL;
  const rpc = createSolanaRpc(rpcUrl);
  const wsUrl = httpToWs(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  return Object.freeze({
    async getBalance(addr: string): Promise<Balance> {
      try {
        const result = await rpc.getBalance(address(addr)).send();
        const lamports = result.value;
        return {
          lamports,
          sol: Number(lamports) / LAMPORTS_PER_SOL,
        };
      } catch (error: unknown) {
        if (isNetworkError(error)) {
          throw new Error(
            `[RPC_NETWORK_ERROR] Network error connecting to ${rpcUrl}: ${error instanceof Error ? error.message : String(error)}. Check your RPC endpoint configuration.`,
            { cause: error },
          );
        }
        throw new Error(
          `[RPC_REQUEST_ERROR] RPC request failed while fetching balance: ${error instanceof Error ? error.message : String(error)}. Check the request parameters.`,
          { cause: error },
        );
      }
    },

    async sendAndConfirm(signedTx: Parameters<typeof sendAndConfirm>[0]): Promise<void> {
      try {
        await sendAndConfirm(signedTx, { commitment: 'confirmed' });
      } catch (error: unknown) {
        if (isNetworkError(error)) {
          throw new Error(
            `[RPC_NETWORK_ERROR] Network error connecting to ${rpcUrl}: ${error instanceof Error ? error.message : String(error)}. Check your RPC endpoint configuration.`,
            { cause: error },
          );
        }
        throw new Error(
          `[RPC_TRANSACTION_ERROR] Transaction failed: ${error instanceof Error ? error.message : String(error)}. Check the transaction parameters.`,
          { cause: error },
        );
      }
    },

    async getLatestBlockhash(): Promise<{ blockhash: Blockhash; lastValidBlockHeight: bigint }> {
      try {
        const result = await rpc.getLatestBlockhash().send();
        return {
          blockhash: result.value.blockhash,
          lastValidBlockHeight: result.value.lastValidBlockHeight,
        };
      } catch (error: unknown) {
        if (isNetworkError(error)) {
          throw new Error(
            `[RPC_NETWORK_ERROR] Network error connecting to ${rpcUrl}: ${error instanceof Error ? error.message : String(error)}. Check your RPC endpoint configuration.`,
            { cause: error },
          );
        }
        throw new Error(
          `[RPC_REQUEST_ERROR] RPC request failed while fetching latest blockhash: ${error instanceof Error ? error.message : String(error)}. Check the request parameters.`,
          { cause: error },
        );
      }
    },

    async requestAirdrop(addr: string, amount: bigint): Promise<string> {
      try {
        const signature = await rpc.requestAirdrop(address(addr), lamports(amount)).send();
        return signature;
      } catch (error: unknown) {
        if (isRateLimitError(error)) {
          throw new Error(
            `[RPC_AIRDROP_RATE_LIMITED] Airdrop failed — devnet faucet rate-limited. ` +
              `Wait 60 seconds or fund treasury manually at address ${addr}.`,
            { cause: error },
          );
        }
        if (isNetworkError(error)) {
          throw new Error(
            `[RPC_NETWORK_ERROR] Airdrop request failed — network error connecting to RPC. ` +
              `Check your RPC endpoint configuration.`,
            { cause: error },
          );
        }
        throw new Error(
          `[RPC_AIRDROP_FAILED] Airdrop request failed for address ${addr}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    },
  });
}
