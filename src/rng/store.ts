import { CompletedRound, RoundCommitment, SessionState } from './types';

/**
 * In-memory store for rounds and sessions.
 * Replace with persistent DB adapter in production.
 */
export class RoundStore {
  private pendingRounds = new Map<string, RoundCommitment>();
  private completedRounds = new Map<string, CompletedRound>();
  private sessions = new Map<string, SessionState>();

  savePendingRound(round: RoundCommitment): void {
    this.pendingRounds.set(round.roundId, round);
  }

  getPendingRound(roundId: string): RoundCommitment | undefined {
    return this.pendingRounds.get(roundId);
  }

  deletePendingRound(roundId: string): void {
    this.pendingRounds.delete(roundId);
  }

  saveCompletedRound(round: CompletedRound): void {
    this.completedRounds.set(round.roundId, round);
  }

  getCompletedRound(roundId: string): CompletedRound | undefined {
    return this.completedRounds.get(roundId);
  }

  getAllCompletedRounds(): CompletedRound[] {
    return Array.from(this.completedRounds.values());
  }

  saveSession(session: SessionState): void {
    this.sessions.set(session.sessionId, session);
  }

  getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  updateSession(session: SessionState): void {
    this.sessions.set(session.sessionId, session);
  }
}

export const defaultStore = new RoundStore();
