import { deriveOutcome, generateServerSeed } from '../../src/rng/hmac';
import { collectOutcomes, runNistSuite } from '../../src/stats/nist';

describe('NIST SP 800-22 statistical tests', () => {
  let hexOutput: string;

  beforeAll(() => {
    const serverSeed = generateServerSeed();
    hexOutput = collectOutcomes(deriveOutcome, serverSeed, 'nist-suite-test', 200);
  });

  test('collectOutcomes generates 200 * 64 hex chars', () => {
    expect(hexOutput.length).toBe(200 * 64);
  });

  test('runNistSuite returns suite result with all tests', () => {
    const result = runNistSuite(hexOutput);
    expect(result.results.length).toBeGreaterThanOrEqual(5);
    expect(result.alpha).toBe(0.01);
    expect(result.sampleBits).toBe(hexOutput.length * 4);
  });

  test('HMAC-SHA256 output passes NIST test suite (p >= 0.01)', () => {
    const result = runNistSuite(hexOutput);
    const failures = result.results.filter(r => !r.passed).map(r => r.name);
    expect(failures).toHaveLength(0);
  });

  test('runNistSuite throws for input < 100 bits', () => {
    expect(() => runNistSuite('ff'.repeat(10))).toThrow();
  });

  test('each test returns pValue between 0 and 1', () => {
    const result = runNistSuite(hexOutput);
    for (const t of result.results) {
      expect(t.pValue).toBeGreaterThanOrEqual(0);
      expect(t.pValue).toBeLessThanOrEqual(1);
    }
  });
});
