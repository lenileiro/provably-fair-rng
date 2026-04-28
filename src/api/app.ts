import express from 'express';
import path from 'path';
import { ProvablyFairRNGService } from '../rng/service';
import { RoundStore } from '../rng/store';
import { buildRouter } from './routes';

export function createApp(rngService?: ProvablyFairRNGService): express.Application {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../../public')));

  const service = rngService ?? new ProvablyFairRNGService(new RoundStore());
  app.use('/api', buildRouter(service));

  // Serve verifier page for all non-API routes
  app.get('/verify', (_req, res) => {
    res.sendFile(path.join(__dirname, '../../public/verifier.html'));
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'provably-fair-rng' });
  });

  return app;
}
