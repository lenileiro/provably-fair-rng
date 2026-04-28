import { v4 as uuidv4 } from 'uuid';
import { deriveOutcome, generateServerSeed, hashServerSeed } from './hmac';
import { RoundStore } from './store';
import { CompletedRound, RoundCommitment, SeedRotationPolicy, SessionState, VerifyResult } from './types';

export class ProvablyFairRNGService {
  constructor(
    private store: RoundStore,
    private rotationPolicy: SeedRotationPolicy = { kind: 'per_session' },
  ) {}

  createSession(sessionId?: string): SessionState {
    const id = sessionId ?? uuidv4();
    const serverSeed = generateServerSeed();
    const session: SessionState = {
      sessionId: id,
      serverSeed,
      serverSeedHash: hashServerSeed(serverSeed),
      nonce: 0,
      roundCount: 0,
      createdAt: new Date().toISOString(),
    };
    this.store.saveSession(session);
    return session;
  }

  getSession(sessionId: string): SessionState | undefined {
    return this.store.getSession(sessionId);
  }

  /**
   * Phase 1: Commit server seed hash before client provides input.
   * Returns roundId + serverSeedHash so client can record the commitment.
   */
  commitRound(sessionId: string, clientSeed: string): RoundCommitment {
    const session = this.store.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const roundId = uuidv4();
    const nonce = session.nonce;

    const commitment: RoundCommitment = {
      roundId,
      sessionId,
      serverSeedHash: session.serverSeedHash,
      clientSeed,
      nonce,
      createdAt: new Date().toISOString(),
    };

    this.store.savePendingRound(commitment);
    session.nonce += 1;
    session.roundCount += 1;
    this.store.updateSession(session);

    return commitment;
  }

  /**
   * Phase 2: Complete the round — reveal server seed and compute outcome.
   * Rotates seed per policy after revelation.
   */
  completeRound(roundId: string): CompletedRound {
    const pending = this.store.getPendingRound(roundId);
    if (!pending) {
      throw new Error(`Pending round ${roundId} not found`);
    }

    const session = this.store.getSession(pending.sessionId);
    if (!session) {
      throw new Error(`Session ${pending.sessionId} not found`);
    }

    const outcome = deriveOutcome(session.serverSeed, pending.clientSeed, pending.nonce);

    const completed: CompletedRound = {
      ...pending,
      serverSeed: session.serverSeed,
      outcome,
      completedAt: new Date().toISOString(),
    };

    this.store.saveCompletedRound(completed);
    this.store.deletePendingRound(roundId);

    if (this.shouldRotateSeed(session)) {
      this.rotateSeed(session);
    }

    return completed;
  }

  /**
   * Verify a completed round by round ID.
   */
  verifyRound(roundId: string): VerifyResult {
    const round = this.store.getCompletedRound(roundId);
    if (!round) {
      throw new Error(`Completed round ${roundId} not found`);
    }
    return this.verifyRaw(round.serverSeed, round.clientSeed, round.nonce, round.outcome);
  }

  /**
   * Verify using raw values — no roundId required; fully client-side compatible.
   */
  verifyRaw(serverSeed: string, clientSeed: string, nonce: number, expectedOutcome: string): VerifyResult {
    const computedOutcome = deriveOutcome(serverSeed, clientSeed, nonce);
    return {
      valid: computedOutcome === expectedOutcome,
      computedOutcome,
      storedOutcome: expectedOutcome,
    };
  }

  getCompletedRound(roundId: string): CompletedRound | undefined {
    return this.store.getCompletedRound(roundId);
  }

  setRotationPolicy(policy: SeedRotationPolicy): void {
    this.rotationPolicy = policy;
  }

  getRotationPolicy(): SeedRotationPolicy {
    return this.rotationPolicy;
  }

  private shouldRotateSeed(session: SessionState): boolean {
    if (this.rotationPolicy.kind === 'per_session') return false;
    return session.roundCount % this.rotationPolicy.n === 0;
  }

  private rotateSeed(session: SessionState): void {
    session.serverSeed = generateServerSeed();
    session.serverSeedHash = hashServerSeed(session.serverSeed);
    this.store.updateSession(session);
  }
}
