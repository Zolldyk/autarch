import type { Instruction } from '@solana/kit';

/** Configuration for seed loading behavior. */
export interface SeedConfig {
  /** Raw seed bytes (32 or 64 bytes). */
  readonly seed: Uint8Array;
  /** Whether the demo seed is being used. */
  readonly isDemo: boolean;
}

/** Agent provides instructions; wallet-core handles fee payer, blockhash, signing, sending. */
export interface TransactionToSign {
  readonly instructions: ReadonlyArray<Instruction>;
}

/** Connection mode for RPC operations. Epic 3 expands to 'normal' | 'degraded' | 'simulation'. */
export type ConnectionMode = 'normal';

/** Result of signing and submitting a transaction. */
export interface TransactionResult {
  readonly signature: string;
  readonly status: 'confirmed' | 'failed';
  readonly mode: ConnectionMode;
}

/** SOL balance for an agent wallet. */
export interface Balance {
  readonly lamports: bigint;
  readonly sol: number;
}

/** Frozen wallet handle exposed to agent code. No key material accessible. */
export interface AgentWallet {
  readonly address: string;
  signTransaction(tx: TransactionToSign): Promise<TransactionResult>;
}

/** Top-level wallet factory result. All key material trapped in closure scope. */
export interface AutarchWallet {
  getAgent(agentId: number): Promise<AgentWallet>;
  getAddress(agentId: number): Promise<string>;
  getBalance(agentId: number): Promise<Balance>;
  signTransaction(agentId: number, tx: TransactionToSign): Promise<TransactionResult>;
  distributeSol(toAgentId: number, amountLamports: bigint): Promise<TransactionResult>;
  requestAirdrop(agentId: number, amountLamports?: bigint): Promise<string>;
}

/** Configuration for creating an AutarchWallet. */
export interface WalletConfig {
  seed: Uint8Array;
  rpcUrl?: string;
}

/** Configuration for the RPC client. */
export interface RpcConfig {
  rpcUrl?: string;
}
