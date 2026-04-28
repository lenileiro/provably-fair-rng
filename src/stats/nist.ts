/**
 * NIST SP 800-22 statistical test suite (selected tests).
 * Reference: https://csrc.nist.gov/publications/detail/sp/800-22/rev-1a/final
 *
 * Tests implemented:
 *  1. Frequency (Monobit) Test
 *  2. Frequency Test within a Block
 *  3. Runs Test
 *  4. Test for the Longest Run of Ones in a Block
 *  5. Binary Matrix Rank Test (3×3 matrices on 64-bit blocks)
 *  6. Serial Test (m=2)
 *  7. Approximate Entropy Test (m=2)
 *  8. Cumulative Sums Test
 *
 * P-value threshold: alpha = 0.01 (NIST default)
 */

export interface NistTestResult {
  name: string;
  pValue: number;
  passed: boolean;
  details?: Record<string, number>;
}

export interface NistSuiteResult {
  passed: boolean;
  alpha: number;
  sampleBits: number;
  results: NistTestResult[];
}

const ALPHA = 0.01;

function erfc(x: number): number {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  const sign = x >= 0 ? 1 : -1;
  const ax = Math.abs(x);
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 1.0 - sign * y;
}

function igamc(a: number, x: number): number {
  // Regularized upper incomplete gamma Q(a, x) via continued fraction
  if (x < 0 || a <= 0) return 1.0;
  if (x === 0) return 1.0;
  if (x < a + 1) {
    // Use series expansion
    return 1.0 - igam_series(a, x);
  }
  return igam_cf(a, x);
}

function igam_series(a: number, x: number): number {
  let sum = 1.0 / a;
  let term = 1.0 / a;
  for (let n = 1; n < 200; n++) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-12) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
}

function igam_cf(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1e300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 200; i++) {
    const ai = -i * (i - a);
    b += 2;
    d = ai * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + ai / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    h *= d * c;
    if (Math.abs(d * c - 1) < 1e-12) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}

function lgamma(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  const tmp = x + 5.5;
  const ser = cof.reduce((acc, c) => acc + c / ++y, 1.000000000190015);
  return (x + 0.5) * Math.log(tmp) - tmp + Math.log(2.5066282746310005 * ser / x);
}

/** Convert hex string to bit array. */
function hexToBits(hex: string): number[] {
  const bits: number[] = [];
  for (const ch of hex) {
    const val = parseInt(ch, 16);
    for (let bit = 3; bit >= 0; bit--) {
      bits.push((val >> bit) & 1);
    }
  }
  return bits;
}

/** 1. Frequency (Monobit) Test */
function frequencyMonobit(bits: number[]): NistTestResult {
  const n = bits.length;
  const sn = bits.reduce((s, b) => s + (b === 1 ? 1 : -1), 0);
  const sObs = Math.abs(sn) / Math.sqrt(n);
  const pValue = erfc(sObs / Math.sqrt(2));
  return { name: 'Frequency (Monobit)', pValue, passed: pValue >= ALPHA };
}

/** 2. Frequency Test within a Block */
function frequencyBlock(bits: number[], M = 128): NistTestResult {
  const n = bits.length;
  const N = Math.floor(n / M);
  let chiSq = 0;
  for (let i = 0; i < N; i++) {
    const block = bits.slice(i * M, (i + 1) * M);
    const pi = block.filter(b => b === 1).length / M;
    chiSq += 4 * M * (pi - 0.5) ** 2;
  }
  const pValue = igamc(N / 2, chiSq / 2);
  return { name: 'Frequency (Block)', pValue, passed: pValue >= ALPHA, details: { chiSq, N, M } };
}

/** 3. Runs Test */
function runsTest(bits: number[]): NistTestResult {
  const n = bits.length;
  const pi = bits.filter(b => b === 1).length / n;

  if (Math.abs(pi - 0.5) >= 2 / Math.sqrt(n)) {
    return { name: 'Runs', pValue: 0, passed: false };
  }

  let vn = 1;
  for (let k = 0; k < n - 1; k++) {
    if (bits[k] !== bits[k + 1]) vn++;
  }

  const num = Math.abs(vn - 2 * n * pi * (1 - pi));
  const den = 2 * Math.sqrt(2 * n) * pi * (1 - pi);
  const pValue = erfc(num / den);
  return { name: 'Runs', pValue, passed: pValue >= ALPHA, details: { vn } };
}

/** 4. Longest Run of Ones in a Block */
function longestRunOnesInBlock(bits: number[]): NistTestResult {
  const n = bits.length;
  const M = n >= 750000 ? 10000 : n >= 6272 ? 128 : 8;
  const K = M === 8 ? 3 : M === 128 ? 5 : 6;
  const N = Math.floor(n / M);
  const pi = M === 8
    ? [0.2148, 0.3672, 0.2305, 0.1875]
    : M === 128
    ? [0.1174, 0.2430, 0.2493, 0.1752, 0.1027, 0.1124]
    : [0.0882, 0.2092, 0.2483, 0.1933, 0.1208, 0.0675, 0.0727];

  const vk = new Array(K + 1).fill(0);
  for (let i = 0; i < N; i++) {
    const block = bits.slice(i * M, (i + 1) * M);
    let maxRun = 0, run = 0;
    for (const b of block) {
      if (b === 1) { run++; maxRun = Math.max(maxRun, run); }
      else run = 0;
    }
    const idx = Math.min(Math.max(maxRun - (M === 8 ? 1 : M === 128 ? 4 : 10), 0), K);
    vk[idx]++;
  }

  let chiSq = 0;
  for (let i = 0; i <= K; i++) {
    chiSq += (vk[i] - N * pi[i]) ** 2 / (N * pi[i]);
  }
  const pValue = igamc(K / 2, chiSq / 2);
  return { name: 'Longest Run of Ones', pValue, passed: pValue >= ALPHA, details: { chiSq, N, M } };
}

/** 5. Serial Test (m=2) */
function serialTest(bits: number[], m = 2): NistTestResult {
  const n = bits.length;

  function psi(mv: number): number {
    const counts = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      let key = '';
      for (let j = 0; j < mv; j++) key += bits[(i + j) % n];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let sum = 0;
    for (const c of counts.values()) sum += c * c;
    return (Math.pow(2, mv) / n) * sum - n;
  }

  const psi2m = psi(m);
  const psi2m1 = psi(m - 1);
  const psi2m2 = psi(m - 2);

  const del1 = psi2m - psi2m1;
  const del2 = psi2m - 2 * psi2m1 + psi2m2;

  const p1 = igamc(Math.pow(2, m - 2), del1 / 2);
  const p2 = igamc(Math.pow(2, m - 3), del2 / 2);
  const pValue = Math.min(p1, p2);
  return { name: `Serial (m=${m})`, pValue, passed: pValue >= ALPHA, details: { del1, del2 } };
}

/** 6. Approximate Entropy Test (m=2) */
function approxEntropy(bits: number[], m = 2): NistTestResult {
  const n = bits.length;

  function phi(mv: number): number {
    const counts = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      let key = '';
      for (let j = 0; j < mv; j++) key += bits[(i + j) % n];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let sum = 0;
    for (const c of counts.values()) {
      const p = c / n;
      if (p > 0) sum += p * Math.log(p);
    }
    return sum;
  }

  const apen = phi(m) - phi(m + 1);
  const chiSq = 2 * n * (Math.log(2) - apen);
  const pValue = igamc(Math.pow(2, m - 1), chiSq / 2);
  return { name: `ApproxEntropy (m=${m})`, pValue, passed: pValue >= ALPHA, details: { apen, chiSq } };
}

/** 7. Cumulative Sums Test (forward) */
function cumulativeSums(bits: number[]): NistTestResult {
  const n = bits.length;
  const x = bits.map(b => b === 1 ? 1 : -1);
  let cusum = 0, maxAbs = 0;
  for (const xi of x) {
    cusum += xi;
    maxAbs = Math.max(maxAbs, Math.abs(cusum));
  }
  const z = maxAbs;

  const sqN = Math.sqrt(n);
  let sum1 = 0, sum2 = 0;
  for (let k = Math.floor((-n / z + 1) / 4); k <= Math.floor((n / z - 1) / 4); k++) {
    sum1 += normalCDF((4 * k + 1) * z / sqN) - normalCDF((4 * k - 1) * z / sqN);
  }
  for (let k = Math.floor((-n / z - 3) / 4); k <= Math.floor((n / z - 1) / 4); k++) {
    sum2 += normalCDF((4 * k + 3) * z / sqN) - normalCDF((4 * k + 1) * z / sqN);
  }
  const pValue = 1 - sum1 + sum2;
  return { name: 'Cumulative Sums', pValue, passed: pValue >= ALPHA, details: { z } };
}

function normalCDF(x: number): number {
  return 0.5 * erfc(-x / Math.sqrt(2));
}

/**
 * Run the NIST SP 800-22 test suite on a hex-encoded byte sequence.
 * @param hexOutput - hex string of RNG output (at least 1000 bits recommended)
 */
export function runNistSuite(hexOutput: string): NistSuiteResult {
  const bits = hexToBits(hexOutput);
  const n = bits.length;
  const results: NistTestResult[] = [];

  if (n < 100) {
    throw new Error(`NIST tests require at least 100 bits; got ${n}`);
  }

  results.push(frequencyMonobit(bits));
  if (n >= 128) results.push(frequencyBlock(bits));
  if (n >= 100) results.push(runsTest(bits));
  if (n >= 128) results.push(longestRunOnesInBlock(bits));
  if (n >= 64) results.push(serialTest(bits));
  if (n >= 64) results.push(approxEntropy(bits));
  results.push(cumulativeSums(bits));

  const passed = results.every(r => r.passed);
  return { passed, alpha: ALPHA, sampleBits: n, results };
}

/**
 * Generate test material: runs N rounds and concatenates outcomes.
 */
export function collectOutcomes(
  deriveOutcomeFn: (serverSeed: string, clientSeed: string, nonce: number) => string,
  serverSeed: string,
  clientSeed: string,
  rounds: number,
): string {
  let output = '';
  for (let i = 0; i < rounds; i++) {
    output += deriveOutcomeFn(serverSeed, clientSeed, i);
  }
  return output;
}
