'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Store } = require('./store');
const { createApiRouter } = require('./routes/api');

const DEFAULT_DATA_FILE = path.join(__dirname, 'data', 'store.json');
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');

/**
 * Builds the Express app. Kept separate from app.listen() so the tests can
 * create a fresh app (with a temporary data file) for every test run.
 */
function createApp(options = {}) {
  const store = new Store(options.dataFile || process.env.INTERNSAFE_DATA_FILE || DEFAULT_DATA_FILE);
  const app = express();

  app.disable('x-powered-by');
  // On a host like Render the app sits behind a proxy. Needed for rate limits.
  if (process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  // CORS is only needed in development, when React (Vite) runs on port 5173.
  const origins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : ['http://localhost:5173', 'http://127.0.0.1:5173'];
  app.use('/api', cors({ origin: origins }));

  app.use(express.json({ limit: '50kb' }));

  app.use('/api', createApiRouter({
    store,
    analyzeLimit: options.analyzeLimit,
    reportLimit: options.reportLimit,
  }));

  // In production Express also serves the built React app.
  const indexFile = path.join(FRONTEND_DIST, 'index.html');
  if (fs.existsSync(indexFile)) {
    app.use(express.static(FRONTEND_DIST));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) return res.sendFile(indexFile);
      next();
    });
  }

  // Error handler: bad JSON, body too large, or an unexpected bug.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'The request body is not valid JSON.' } });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request is too large.' } });
    }
    console.error('Unexpected error:', err.message); // never log the request body
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side.' } });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log('InternSafe API running on http://localhost:' + port);
  });
}

module.exports = { createApp };
