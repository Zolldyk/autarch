import {
  getAddressFromPublicKey,
  createSignerFromKeyPair,
  address,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  assertIsTransactionWithinSizeLimit,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { deriveKeypair } from './derivation.js';
import { createRpcClient } from './rpc-client.js';
import { DEFAULT_RPC_URL, TREASURY_AGENT_ID, DEFAULT_AIRDROP_LAMPORTS, TREASURY_MIN_BALANCE_LAMPORTS } from './constants.js';
import type { AgentWallet, AutarchWallet, Balance, TransactionResult, TransactionToSign, WalletConfig } from './types.js';

/**
 * Create an AutarchWallet with closure-based key isolation. Private keys are
 * trapped in closure scope — the returned frozen object exposes only address, balance, and signing methods.
 * @param config - Wallet configuration containing the seed and optional RPC settings.
 * @returns A frozen AutarchWallet with agent derivation, balance, signing, and distribution methods.
 *
 * @example
 * ```typescript
 * import { createAutarchWallet, loadSeed } from '@autarch/core';
 * const wallet = createAutarchWallet({ seed: loadSeed() });
 * const agent = await wallet.getAgent(1);
 * ```
 */
export function createAutarchWallet(config: WalletConfig): AutarchWallet {
  // Snapshot seed bytes to prevent post-construction external mutation.
  const seed = new Uint8Array(config.seed);
  const keypairCache = new Map<number, CryptoKeyPair>();
  const keypairPromiseCache = new Map<number, Promise<CryptoKeyPair>>();
  const agentCache = new Map<number, AgentWallet>();
  const agentPromiseCache = new Map<number, Promise<AgentWallet>>();

  const rpcClient = createRpcClient({
    rpcUrl: config.rpcUrl ?? DEFAULT_RPC_URL,
    endpoints: config.rpcEndpoints,
    onSimulationModeChange: config.onSimulationModeChange,
  });

  function isNetworkFailure(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes('[rpc_network_error]') ||
      lower.includes('network') ||
      lower.includes('timeout') ||
      lower.includes('econn') ||
      lower.includes('dns') ||
      lower.includes('429')
    );
  }

  function isTransactionFailure(message: string): boolean {
    const lower = message.toLowerCase();
    return lower.includes('[rpc_transaction_error]') || lower.includes('transaction');
  }

  async function getOrDeriveKeypair(agentId: number): Promise<CryptoKeyPair> {
    const cached = keypairCache.get(agentId);
    if (cached !== undefined) {
      return cached;
    }
    const pending = keypairPromiseCache.get(agentId);
    if (pending !== undefined) {
      return pending;
    }

    try {
      const keypairPromise = deriveKeypair(seed, agentId);
      keypairPromiseCache.set(agentId, keypairPromise);
      const keypair = await keypairPromise;
      keypairCache.set(agentId, keypair);
      return keypair;
    } catch (error: unknown) {
      throw new Error(
        `Failed to derive agent wallet for agentId ${String(agentId)}. ` +
          'The agent cannot operate without a valid wallet. ' +
          'Verify the seed is valid and agentId is a non-negative integer.',
        { cause: error },
      );
    } finally {
      keypairPromiseCache.delete(agentId);
    }
  }

  async function walletSignTransaction(agentId: number, tx: TransactionToSign): Promise<TransactionResult> {
    try {
      const keypair = await getOrDeriveKeypair(agentId);
      const signer = await createSignerFromKeyPair(keypair);
      let signature = '';
      const sendResult = await rpcClient.sendAndConfirm(async () => {
        const freshBlockhash = await rpcClient.getLatestBlockhash();
        const retryableMessage = pipe(
          createTransactionMessage({ version: 0 }),
          m => setTransactionMessageFeePayerSigner(signer, m),
          m => setTransactionMessageLifetimeUsingBlockhash(freshBlockhash, m),
          m => appendTransactionMessageInstructions(tx.instructions, m),
        );
        const signedTx = await signTransactionMessageWithSigners(retryableMessage);
        assertIsTransactionWithinSizeLimit(signedTx);
        signature = getSignatureFromTransaction(signedTx);
        return signedTx;
      }, { simulationLabel: `agent-${String(agentId)}` });
      if (sendResult) {
        return sendResult;
      }
      const mode = rpcClient.getConnectionMode();

      return { signature, status: 'confirmed', mode };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (isNetworkFailure(message)) {
        throw new Error(
          `Failed to submit transaction for agentId ${String(agentId)}: ${message}`,
          { cause: error },
        );
      }
      if (isTransactionFailure(message)) {
        throw new Error(
          `Transaction failed for agentId ${String(agentId)}: ${message}`,
          { cause: error },
        );
      }
      throw new Error(
        `Failed to prepare transaction for agentId ${String(agentId)}: ${message}`,
        { cause: error },
      );
    }
  }

  async function getAgent(agentId: number): Promise<AgentWallet> {
    const cached = agentCache.get(agentId);
    if (cached !== undefined) {
      return cached;
    }
    const pending = agentPromiseCache.get(agentId);
    if (pending !== undefined) {
      return pending;
    }

    const agentPromise = (async (): Promise<AgentWallet> => {
      const keypair = await getOrDeriveKeypair(agentId);
      const addressStr = await getAddressFromPublicKey(keypair.publicKey);

      const agentWallet: AgentWallet = Object.freeze({
        address: addressStr,
        async signTransaction(tx: TransactionToSign): Promise<TransactionResult> {
          return walletSignTransaction(agentId, tx);
        },
      });

      agentCache.set(agentId, agentWallet);
      return agentWallet;
    })();

    agentPromiseCache.set(agentId, agentPromise);

    try {
      return await agentPromise;
    } finally {
      agentPromiseCache.delete(agentId);
    }
  }

  async function getAddress(agentId: number): Promise<string> {
    const keypair = await getOrDeriveKeypair(agentId);
    return getAddressFromPublicKey(keypair.publicKey);
  }

  async function getBalance(agentId: number): Promise<Balance> {
    try {
      const keypair = await getOrDeriveKeypair(agentId);
      const addr = await getAddressFromPublicKey(keypair.publicKey);
      return rpcClient.getBalance(addr);
    } catch (error: unknown) {
      throw new Error(
        `Failed to fetch balance for agentId ${String(agentId)}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async function distributeSol(toAgentId: number, amountLamports: bigint): Promise<TransactionResult> {
    if (!Number.isInteger(toAgentId) || toAgentId <= TREASURY_AGENT_ID) {
      throw new Error('Cannot distribute SOL to treasury (self-transfer). Provide a child agentId > 0.');
    }
    if (amountLamports <= 0n) {
      throw new Error('Distribution amount must be greater than 0 lamports.');
    }

    try {
      const treasuryKeypair = await getOrDeriveKeypair(TREASURY_AGENT_ID);
      const treasurySigner = await createSignerFromKeyPair(treasuryKeypair);
      const destAddress = await getAddress(toAgentId);

      const transferInstruction = getTransferSolInstruction({
        source: treasurySigner,
        destination: address(destAddress),
        amount: amountLamports,
      });

      let signature = '';
      const distResult = await rpcClient.sendAndConfirm(async () => {
        const freshBlockhash = await rpcClient.getLatestBlockhash();
        const retryableMessage = pipe(
          createTransactionMessage({ version: 0 }),
          m => setTransactionMessageFeePayerSigner(treasurySigner, m),
          m => setTransactionMessageLifetimeUsingBlockhash(freshBlockhash, m),
          m => appendTransactionMessageInstruction(transferInstruction, m),
        );
        const signedTx = await signTransactionMessageWithSigners(retryableMessage);
        assertIsTransactionWithinSizeLimit(signedTx);
        signature = getSignatureFromTransaction(signedTx);
        return signedTx;
      }, { simulationLabel: `agent-${String(toAgentId)}` });
      if (distResult) {
        return distResult;
      }
      const mode = rpcClient.getConnectionMode();

      return { signature, status: 'confirmed', mode };
    } catch (error: unknown) {
      if (error instanceof Error && (error.message.includes('Cannot distribute') || error.message.includes('Distribution amount'))) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (isNetworkFailure(message)) {
        throw new Error(
          `Failed to distribute ${String(amountLamports)} lamports from treasury to agentId ${String(toAgentId)}: ${message}`,
          { cause: error },
        );
      }
      if (isTransactionFailure(message)) {
        throw new Error(
          `Distribution failed for agentId ${String(toAgentId)}: ${message}`,
          { cause: error },
        );
      }
      throw new Error(
        `Failed to distribute ${String(amountLamports)} lamports from treasury to agentId ${String(toAgentId)}: ${message}`,
        { cause: error },
      );
    }
  }

  async function walletRequestAirdrop(agentId: number, amountLamports?: bigint): Promise<string> {
    const amount = amountLamports ?? DEFAULT_AIRDROP_LAMPORTS;
    if (amount <= 0n) {
      throw new Error('Airdrop amount must be greater than 0 lamports.');
    }

    // FR31: Skip airdrop if treasury is already funded (only in non-simulation mode)
    if (agentId === TREASURY_AGENT_ID && rpcClient.getConnectionMode() !== 'simulation') {
      try {
        const balance = await getBalance(agentId);
        if (balance.lamports >= TREASURY_MIN_BALANCE_LAMPORTS) {
          const solBalance = Number(balance.lamports) / 1_000_000_000;
          console.log(`Treasury already funded (${solBalance.toFixed(2)} SOL), skipping airdrop`);
          return 'skipped:treasury-funded';
        }
      } catch {
        // Balance check failed — proceed with airdrop attempt (fail-open)
      }
    }

    const agentAddr = await getAddress(agentId);
    return rpcClient.requestAirdrop(agentAddr, amount);
  }

  return Object.freeze({
    getAgent,
    getAddress,
    getBalance,
    signTransaction: walletSignTransaction,
    distributeSol,
    requestAirdrop: walletRequestAirdrop,
    cleanup(): void {
      rpcClient.cleanup();
    },
  });
}
