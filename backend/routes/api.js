'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { analyze, RULES, ValidationError } = require('../detector');
const { sanitizeSnippet } = require('../sanitize');

const RULE_NAMES = Object.fromEntries(RULES.map((r) => [r.id, r.name]));
const VALID_FLAG_IDS = new Set(RULES.map((r) => r.id));
const VALID_LEVELS = new Set(['Low', 'Medium', 'High']);

function apiError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function limiter(limit, windowMs) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a minute and try again.' } },
  });
}

/** The body must be a plain JSON object (not missing, not an array). */
function getBody(req) {
  const b = req.body;
  return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
}

function createApiRouter({ store, analyzeLimit = 30, reportLimit = 10 }) {
  const router = express.Router();

  router.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // POST /api/analyze  { text, link?, company?, sender? }
  router.post('/analyze', limiter(analyzeLimit, 60 * 1000), (req, res) => {
    const body = getBody(req);
    if (!body) return apiError(res, 400, 'INVALID_BODY', 'Send a JSON object with a "text" field.');

    for (const field of ['text', 'link', 'company', 'sender']) {
      if (body[field] !== undefined && body[field] !== null && typeof body[field] !== 'string') {
        return apiError(res, 400, 'INVALID_FIELD', '"' + field + '" must be text.');
      }
    }

    let result;
    try {
      result = analyze({
        text: body.text,
        link: body.link || '',
        company: body.company || '',
        sender: body.sender || '',
      });
    } catch (err) {
      if (err instanceof ValidationError) return apiError(res, 400, err.code, err.message);
      throw err;
    }

    // Stats are best effort: a storage problem must not break the answer.
    try {
      store.recordAnalysis(result);
    } catch (err) {
      console.error('Could not save stats:', err.message);
    }
    res.json(result);
  });

  // POST /api/report  { snippet, flags, level }
  router.post('/report', limiter(reportLimit, 60 * 1000), (req, res) => {
    const body = getBody(req);
    if (!body) return apiError(res, 400, 'INVALID_BODY', 'Send a JSON object with snippet, flags and level.');

    if (typeof body.snippet !== 'string' || !body.snippet.trim()) {
      return apiError(res, 400, 'INVALID_SNIPPET', 'Please include a short snippet of the offer.');
    }
    if (!Array.isArray(body.flags) || body.flags.length > RULES.length ||
        !body.flags.every((f) => typeof f === 'string' && VALID_FLAG_IDS.has(f))) {
      return apiError(res, 400, 'INVALID_FLAGS', '"flags" must be a list of valid flag ids.');
    }
    if (!VALID_LEVELS.has(body.level)) {
      return apiError(res, 400, 'INVALID_LEVEL', '"level" must be Low, Medium or High.');
    }

    const snippet = sanitizeSnippet(body.snippet);
    store.addReport({ snippet, flags: [...new Set(body.flags)], level: body.level });
    res.status(201).json({ ok: true, message: 'Thank you. Your report was saved without personal details.' });
  });

  // GET /api/stats
  router.get('/stats', (req, res) => {
    res.json(store.getStats(RULE_NAMES));
  });

  // Anything else under /api
  router.use((req, res) => apiError(res, 404, 'NOT_FOUND', 'This API route does not exist.'));

  return router;
}

module.exports = { createApiRouter };
