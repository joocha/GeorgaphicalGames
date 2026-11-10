import express from 'express';

export function createApp() {
  const app = express();

  // Requests arrive through Nginx on the same machine; trust its
  // X-Forwarded-* headers so req.ip and req.protocol are correct.
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  // Nginx forwards the full path (proxy_pass has no trailing URI),
  // so every route lives under /api.
  const api = express.Router();

  api.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
  });

  app.use('/api', api);

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: 'Internal server error' });
  });

  return app;
}
