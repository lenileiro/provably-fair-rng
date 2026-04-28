import { Request, Response, Router } from 'express';
import { deriveOutcome, generateServerSeed } from '../rng/hmac';
import { ProvablyFairRNGService } from '../rng/service';
import { SeedRotationPolicy } from '../rng/types';
import { collectOutcomes, runNistSuite } from '../stats/nist';

export function buildRouter(rngService: ProvablyFairRNGService): Router {
  const router = Router();

  // POST /sessions — create a new session, returns sessionId + serverSeedHash
  router.post('/sessions', (_req: Request, res: Response) => {
    const session = rngService.createSession();
    res.status(201).json({
      sessionId: session.sessionId,
      serverSeedHash: session.serverSeedHash,
      createdAt: session.createdAt,
    });
  });

  // GET /sessions/:sessionId — get session state (serverSeed NOT returned while active)
  router.get('/sessions/:sessionId', (req: Request, res: Response) => {
    const session = rngService.getSession(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({
      sessionId: session.sessionId,
      serverSeedHash: session.serverSeedHash,
      nonce: session.nonce,
      roundCount: session.roundCount,
      createdAt: session.createdAt,
    });
  });

  // POST /rounds — commit a round (Phase 1: returns serverSeedHash before any game input)
  router.post('/rounds', (req: Request, res: Response) => {
    const { sessionId, clientSeed } = req.body as { sessionId?: string; clientSeed?: string };
    if (!sessionId || typeof sessionId !== 'string') {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }
    if (!clientSeed || typeof clientSeed !== 'string') {
      res.status(400).json({ error: 'clientSeed is required' });
      return;
    }
    try {
      const commitment = rngService.commitRound(sessionId, clientSeed);
      res.status(201).json({
        roundId: commitment.roundId,
        serverSeedHash: commitment.serverSeedHash,
        clientSeed: commitment.clientSeed,
        nonce: commitment.nonce,
        createdAt: commitment.createdAt,
      });
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  // POST /rounds/:roundId/complete — complete round, reveal server seed + outcome
  router.post('/rounds/:roundId/complete', (req: Request, res: Response) => {
    try {
      const completed = rngService.completeRound(req.params.roundId);
      res.json({
        roundId: completed.roundId,
        serverSeed: completed.serverSeed,
        serverSeedHash: completed.serverSeedHash,
        clientSeed: completed.clientSeed,
        nonce: completed.nonce,
        outcome: completed.outcome,
        createdAt: completed.createdAt,
        completedAt: completed.completedAt,
      });
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  // GET /rounds/:roundId — get completed round (for historical lookup)
  router.get('/rounds/:roundId', (req: Request, res: Response) => {
    const round = rngService.getCompletedRound(req.params.roundId);
    if (!round) {
      res.status(404).json({ error: 'Round not found' });
      return;
    }
    res.json(round);
  });

  // GET /rounds/:roundId/verify — verify a completed round
  router.get('/rounds/:roundId/verify', (req: Request, res: Response) => {
    try {
      const result = rngService.verifyRound(req.params.roundId);
      res.json(result);
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  // POST /verify — verify raw values (no roundId, no auth needed — public endpoint)
  router.post('/verify', (req: Request, res: Response) => {
    const { serverSeed, clientSeed, nonce, expectedOutcome } = req.body as {
      serverSeed?: string;
      clientSeed?: string;
      nonce?: unknown;
      expectedOutcome?: string;
    };
    if (!serverSeed || !clientSeed || nonce === undefined || !expectedOutcome) {
      res.status(400).json({ error: 'serverSeed, clientSeed, nonce, and expectedOutcome are required' });
      return;
    }
    const nonceNum = Number(nonce);
    if (!Number.isInteger(nonceNum) || nonceNum < 0) {
      res.status(400).json({ error: 'nonce must be a non-negative integer' });
      return;
    }
    const result = rngService.verifyRaw(serverSeed, clientSeed, nonceNum, expectedOutcome);
    res.json(result);
  });

  // PUT /config/rotation — update rotation policy (admin endpoint)
  router.put('/config/rotation', (req: Request, res: Response) => {
    const { policy } = req.body as { policy?: SeedRotationPolicy };
    if (!policy || !policy.kind) {
      res.status(400).json({ error: 'policy with kind is required' });
      return;
    }
    if (policy.kind !== 'per_session' && policy.kind !== 'per_n_rounds') {
      res.status(400).json({ error: 'policy.kind must be per_session or per_n_rounds' });
      return;
    }
    if (policy.kind === 'per_n_rounds' && (!policy.n || policy.n < 1)) {
      res.status(400).json({ error: 'per_n_rounds policy requires n >= 1' });
      return;
    }
    rngService.setRotationPolicy(policy);
    res.json({ policy: rngService.getRotationPolicy() });
  });

  // GET /config/rotation — get current rotation policy
  router.get('/config/rotation', (_req: Request, res: Response) => {
    res.json({ policy: rngService.getRotationPolicy() });
  });

  // POST /stats/nist — run NIST SP 800-22 tests on RNG output
  router.post('/stats/nist', (req: Request, res: Response) => {
    const { rounds = 200 } = req.body as { rounds?: number };
    const roundsNum = Math.min(Math.max(Number(rounds) || 200, 50), 2000);
    const serverSeed = generateServerSeed();
    const clientSeed = 'nist-test-client-seed';
    const hexOutput = collectOutcomes(deriveOutcome, serverSeed, clientSeed, roundsNum);
    try {
      const result = runNistSuite(hexOutput);
      res.json({ ...result, rounds: roundsNum });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
