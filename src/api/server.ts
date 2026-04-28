import { createApp } from './app';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const app = createApp();
app.listen(PORT, () => {
  console.log(`Provably fair RNG service listening on port ${PORT}`);
});
