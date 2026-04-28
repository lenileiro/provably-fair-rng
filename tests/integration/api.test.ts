import request from 'supertest';
import { createApp } from '../../src/api/app';
import { ProvablyFairRNGService } from '../../src/rng/service';
import { RoundStore } from '../../src/rng/store';

const store = new RoundStore();
const rngService = new ProvablyFairRNGService(store);
const app = createApp(rngService);

describe('POST /api/sessions', () => {
  test('creates session and returns sessionId + serverSeedHash', async () => {
    const res = await request(app).post('/api/sessions');
    expect(res.status).toBe(201);
    expect(res.body.sessionId).toBeTruthy();
    expect(res.body.serverSeedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.createdAt).toBeTruthy();
  });

  test('serverSeed is NOT included in response', async () => {
    const res = await request(app).post('/api/sessions');
    expect(res.body.serverSeed).toBeUndefined();
  });
});

describe('GET /api/sessions/:sessionId', () => {
  test('returns session info without serverSeed', async () => {
    const { body: { sessionId } } = await request(app).post('/api/sessions');
    const res = await request(app).get(`/api/sessions/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(sessionId);
    expect(res.body.serverSeed).toBeUndefined();
    expect(res.body.nonce).toBe(0);
  });

  test('returns 404 for unknown session', async () => {
    const res = await request(app).get('/api/sessions/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/rounds (Phase 1: commitment)', () => {
  let sessionId: string;

  beforeEach(async () => {
    const res = await request(app).post('/api/sessions');
    sessionId = res.body.sessionId;
  });

  test('commits round and returns roundId + serverSeedHash before any game input', async () => {
    const res = await request(app)
      .post('/api/rounds')
      .send({ sessionId, clientSeed: 'player-seed-abc' });
    expect(res.status).toBe(201);
    expect(res.body.roundId).toBeTruthy();
    expect(res.body.serverSeedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.clientSeed).toBe('player-seed-abc');
    expect(res.body.nonce).toBe(0);
    // serverSeed must NOT be revealed at commit time
    expect(res.body.serverSeed).toBeUndefined();
  });

  test('returns 400 without sessionId', async () => {
    const res = await request(app).post('/api/rounds').send({ clientSeed: 'cs' });
    expect(res.status).toBe(400);
  });

  test('returns 400 without clientSeed', async () => {
    const res = await request(app).post('/api/rounds').send({ sessionId });
    expect(res.status).toBe(400);
  });

  test('returns 404 for unknown session', async () => {
    const res = await request(app).post('/api/rounds').send({ sessionId: 'unknown', clientSeed: 'cs' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/rounds/:roundId/complete (Phase 2: reveal)', () => {
  let sessionId: string;
  let roundId: string;
  let serverSeedHash: string;

  beforeEach(async () => {
    const sessRes = await request(app).post('/api/sessions');
    sessionId = sessRes.body.sessionId;
    const roundRes = await request(app).post('/api/rounds').send({ sessionId, clientSeed: 'test-client' });
    roundId = roundRes.body.roundId;
    serverSeedHash = roundRes.body.serverSeedHash;
  });

  test('reveals serverSeed and outcome', async () => {
    const res = await request(app).post(`/api/rounds/${roundId}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.serverSeed).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.outcome).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.completedAt).toBeTruthy();
  });

  test('revealed serverSeed hashes to committed serverSeedHash', async () => {
    const { createHash } = await import('crypto');
    const res = await request(app).post(`/api/rounds/${roundId}/complete`);
    const actualHash = createHash('sha256').update(res.body.serverSeed).digest('hex');
    expect(actualHash).toBe(serverSeedHash);
  });

  test('returns 404 for unknown round', async () => {
    const res = await request(app).post('/api/rounds/fake-round-id/complete');
    expect(res.status).toBe(404);
  });

  test('cannot complete the same round twice', async () => {
    await request(app).post(`/api/rounds/${roundId}/complete`);
    const res = await request(app).post(`/api/rounds/${roundId}/complete`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/rounds/:roundId/verify', () => {
  test('verifies completed round correctly', async () => {
    const { body: { sessionId } } = await request(app).post('/api/sessions');
    const { body: { roundId } } = await request(app).post('/api/rounds').send({ sessionId, clientSeed: 'verifytest' });
    await request(app).post(`/api/rounds/${roundId}/complete`);

    const res = await request(app).get(`/api/rounds/${roundId}/verify`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.computedOutcome).toBe(res.body.storedOutcome);
  });
});

describe('POST /api/verify (public raw verifier — no login)', () => {
  test('verifies correct raw values', async () => {
    const { createHmac } = await import('crypto');
    const serverSeed = 'a'.repeat(64);
    const clientSeed = 'testclient';
    const nonce = 7;
    const expectedOutcome = createHmac('sha256', serverSeed).update(`${clientSeed}:${nonce}`).digest('hex');

    const res = await request(app).post('/api/verify').send({ serverSeed, clientSeed, nonce, expectedOutcome });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  test('returns invalid for wrong outcome', async () => {
    const res = await request(app).post('/api/verify').send({
      serverSeed: 'a'.repeat(64),
      clientSeed: 'c',
      nonce: 0,
      expectedOutcome: '0'.repeat(64),
    });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
  });

  test('returns 400 when fields are missing', async () => {
    const res = await request(app).post('/api/verify').send({ serverSeed: 'a'.repeat(64) });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/rounds/:roundId (historical lookup — no login needed)', () => {
  test('returns completed round data', async () => {
    const { body: { sessionId } } = await request(app).post('/api/sessions');
    const { body: { roundId } } = await request(app).post('/api/rounds').send({ sessionId, clientSeed: 'history' });
    await request(app).post(`/api/rounds/${roundId}/complete`);

    const res = await request(app).get(`/api/rounds/${roundId}`);
    expect(res.status).toBe(200);
    expect(res.body.roundId).toBe(roundId);
    expect(res.body.serverSeed).toBeTruthy();
    expect(res.body.outcome).toBeTruthy();
  });

  test('returns 404 for pending or unknown round', async () => {
    const res = await request(app).get('/api/rounds/ghost-id');
    expect(res.status).toBe(404);
  });
});

describe('Rotation policy config', () => {
  test('GET /api/config/rotation returns current policy', async () => {
    const res = await request(app).get('/api/config/rotation');
    expect(res.status).toBe(200);
    expect(res.body.policy.kind).toBe('per_session');
  });

  test('PUT /api/config/rotation updates to per_n_rounds', async () => {
    const res = await request(app)
      .put('/api/config/rotation')
      .send({ policy: { kind: 'per_n_rounds', n: 10 } });
    expect(res.status).toBe(200);
    expect(res.body.policy.kind).toBe('per_n_rounds');
    expect(res.body.policy.n).toBe(10);
  });

  test('PUT /api/config/rotation returns 400 for invalid policy', async () => {
    const res = await request(app).put('/api/config/rotation').send({ policy: { kind: 'unknown' } });
    expect(res.status).toBe(400);
  });
});

describe('GET /health', () => {
  test('returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
