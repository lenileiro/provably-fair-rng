import { createHmac, createHash, randomBytes } from 'crypto';

export function generateServerSeed(): string {
  return randomBytes(32).toString('hex');
}

export function hashServerSeed(serverSeed: string): string {
  return createHash('sha256').update(serverSeed).digest('hex');
}

/**
 * Core provably fair outcome derivation:
 * HMAC-SHA256(key=serverSeed, data="clientSeed:nonce")
 * Returns hex string output.
 */
export function deriveOutcome(serverSeed: string, clientSeed: string, nonce: number): string {
  return createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest('hex');
}

/**
 * Converts an HMAC-SHA256 hex output to a float in [0, 1).
 * Takes the first 8 hex chars (32 bits) for uniform distribution.
 */
export function outcomeToFloat(outcome: string): number {
  const slice = outcome.slice(0, 8);
  const int = parseInt(slice, 16);
  return int / 0x100000000;
}

/**
 * Converts a float [0,1) to an integer in [min, max].
 */
export function floatToRange(value: number, min: number, max: number): number {
  return Math.floor(value * (max - min + 1)) + min;
}
