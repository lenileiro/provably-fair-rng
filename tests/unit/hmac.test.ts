import { createHash, createHmac } from 'crypto';
import { deriveOutcome, floatToRange, generateServerSeed, hashServerSeed, outcomeToFloat } from '../../src/rng/hmac';

describe('HMAC-SHA256 core functions', () => {
  test('generateServerSeed returns 64-char hex string', () => {
    const seed = generateServerSeed();
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
  });

  test('generateServerSeed returns different values each call', () => {
    const a = generateServerSeed();
    const b = generateServerSeed();
    expect(a).not.toBe(b);
  });

  test('hashServerSeed returns SHA256 hex of seed', () => {
    const seed = generateServerSeed();
    const expected = createHash('sha256').update(seed).digest('hex');
    expect(hashServerSeed(seed)).toBe(expected);
  });

  test('deriveOutcome matches manual HMAC-SHA256', () => {
    const serverSeed = 'a'.repeat(64);
    const clientSeed = 'testclient';
    const nonce = 42;
    const expected = createHmac('sha256', serverSeed)
      .update(`${clientSeed}:${nonce}`)
      .digest('hex');
    expect(deriveOutcome(serverSeed, clientSeed, nonce)).toBe(expected);
  });

  test('deriveOutcome is deterministic', () => {
    const ss = 'b'.repeat(64);
    const cs = 'myseed';
    expect(deriveOutcome(ss, cs, 0)).toBe(deriveOutcome(ss, cs, 0));
  });

  test('deriveOutcome changes with different nonce', () => {
    const ss = 'c'.repeat(64);
    const cs = 'seed';
    expect(deriveOutcome(ss, cs, 0)).not.toBe(deriveOutcome(ss, cs, 1));
  });

  test('deriveOutcome changes with different clientSeed', () => {
    const ss = 'd'.repeat(64);
    expect(deriveOutcome(ss, 'alpha', 0)).not.toBe(deriveOutcome(ss, 'beta', 0));
  });

  test('outcomeToFloat returns value in [0, 1)', () => {
    const outcome = deriveOutcome(generateServerSeed(), 'test', 0);
    const f = outcomeToFloat(outcome);
    expect(f).toBeGreaterThanOrEqual(0);
    expect(f).toBeLessThan(1);
  });

  test('floatToRange maps to inclusive integer range', () => {
    for (const v of [0, 0.5, 0.999]) {
      const r = floatToRange(v, 1, 6);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(6);
    }
  });
});
