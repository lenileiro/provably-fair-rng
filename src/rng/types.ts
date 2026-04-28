export type SeedRotationPolicy =
  | { kind: 'per_session' }
  | { kind: 'per_n_rounds'; n: number };

export interface RoundCommitment {
  roundId: string;
  sessionId: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  createdAt: string;
}

export interface CompletedRound extends RoundCommitment {
  serverSeed: string;
  outcome: string;
  completedAt: string;
}

export interface VerifyResult {
  valid: boolean;
  computedOutcome: string;
  storedOutcome: string;
}

export interface SessionState {
  sessionId: string;
  serverSeed: string;
  serverSeedHash: string;
  nonce: number;
  roundCount: number;
  createdAt: string;
}
