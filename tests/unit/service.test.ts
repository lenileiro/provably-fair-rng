import { hashServerSeed } from '../../src/rng/hmac';
import { ProvablyFairRNGService } from '../../src/rng/service';
import { RoundStore } from '../../src/rng/store';

function makeService(policy?: Parameters<ProvablyFairRNGService['setRotationPolicy']>[0]) {
  const store = new RoundStore();
  const svc = new ProvablyFairRNGService(store);
  if (policy) svc.setRotationPolicy(policy);
  return svc;
}

describe('ProvablyFairRNGService', () => {
  test('createSession returns session with hash matching seed', () => {
    const svc = makeService();
    const session = svc.createSession();
    expect(session.sessionId).toBeTruthy();
    expect(session.serverSeedHash).toBe(hashServerSeed(session.serverSeed));
    expect(session.nonce).toBe(0);
    expect(session.roundCount).toBe(0);
  });

  test('commitRound returns commitment with serverSeedHash only (not seed)', () => {
    const svc = makeService();
    const { sessionId } = svc.createSession();
    const commitment = svc.commitRound(sessionId, 'myclient');
    expect(commitment.roundId).toBeTruthy();
    expect(commitment.serverSeedHash).toBeTruthy();
    expect((commitment as unknown as Record<string, unknown>).serverSeed).toBeUndefined();
    expect(commitment.clientSeed).toBe('myclient');
    expect(commitment.nonce).toBe(0);
  });

  test('commitRound increments session nonce', () => {
    const svc = makeService();
    const { sessionId } = svc.createSession();
    svc.commitRound(sessionId, 'c1');
    svc.commitRound(sessionId, 'c2');
    const session = svc.getSession(sessionId)!;
    expect(session.nonce).toBe(2);
    expect(session.roundCount).toBe(2);
  });

  test('completeRound reveals serverSeed and outcome', () => {
    const svc = makeService();
    const { sessionId, serverSeedHash } = svc.createSession();
    const { roundId, nonce } = svc.commitRound(sessionId, 'testclient');
    const completed = svc.completeRound(roundId);
    expect(completed.serverSeed).toBeTruthy();
    expect(hashServerSeed(completed.serverSeed)).toBe(serverSeedHash);
    expect(completed.outcome).toBeTruthy();
    expect(completed.nonce).toBe(nonce);
  });

  test('verifyRound confirms outcome integrity', () => {
    const svc = makeService();
    const { sessionId } = svc.createSession();
    const { roundId } = svc.commitRound(sessionId, 'verify-me');
    svc.completeRound(roundId);
    const result = svc.verifyRound(roundId);
    expect(result.valid).toBe(true);
    expect(result.computedOutcome).toBe(result.storedOutcome);
  });

  test('verifyRaw with tampered serverSeed fails', () => {
    const svc = makeService();
    const { sessionId } = svc.createSession();
    const { roundId } = svc.commitRound(sessionId, 'raw-test');
    const completed = svc.completeRound(roundId);
    const result = svc.verifyRaw('f'.repeat(64), completed.clientSeed, completed.nonce, completed.outcome);
    expect(result.valid).toBe(false);
  });

  test('commitRound throws for unknown session', () => {
    const svc = makeService();
    expect(() => svc.commitRound('does-not-exist', 'cs')).toThrow();
  });

  test('completeRound throws for unknown round', () => {
    const svc = makeService();
    expect(() => svc.completeRound('does-not-exist')).toThrow();
  });

  describe('seed rotation policy', () => {
    test('per_session policy does NOT rotate seed between rounds', () => {
      const svc = makeService({ kind: 'per_session' });
      const session = svc.createSession();
      const hashBefore = session.serverSeedHash;

      for (let i = 0; i < 5; i++) {
        const { roundId } = svc.commitRound(session.sessionId, `client${i}`);
        svc.completeRound(roundId);
      }

      const sessionAfter = svc.getSession(session.sessionId)!;
      expect(sessionAfter.serverSeedHash).toBe(hashBefore);
    });

    test('per_n_rounds policy rotates seed after N rounds', () => {
      const N = 3;
      const svc = makeService({ kind: 'per_n_rounds', n: N });
      const session = svc.createSession();
      const hashBefore = session.serverSeedHash;

      // Complete N rounds — should trigger rotation
      for (let i = 0; i < N; i++) {
        const { roundId } = svc.commitRound(session.sessionId, `c${i}`);
        svc.completeRound(roundId);
      }

      const sessionAfter = svc.getSession(session.sessionId)!;
      expect(sessionAfter.serverSeedHash).not.toBe(hashBefore);
    });

    test('per_n_rounds does NOT rotate before N rounds', () => {
      const N = 5;
      const svc = makeService({ kind: 'per_n_rounds', n: N });
      const session = svc.createSession();
      const hashBefore = session.serverSeedHash;

      for (let i = 0; i < N - 1; i++) {
        const { roundId } = svc.commitRound(session.sessionId, `c${i}`);
        svc.completeRound(roundId);
      }

      const sessionAfter = svc.getSession(session.sessionId)!;
      expect(sessionAfter.serverSeedHash).toBe(hashBefore);
    });
  });
});
