'use strict';

/**
 * API tests. Run:  npm run test:api
 * Every test group starts a fresh server on a random port with a temporary
 * data file, so nothing touches your real backend/data/store.json.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../backend/server');

const SCAM =
  'Congratulations! You are selected for Software Developer Internship at TechNova Solutions. ' +
  'Pay a registration fee of Rs 1500 via UPI today. 100% placement guaranteed.';

function startServer(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'internsafe-'));
  const dataFile = path.join(dir, 'store.json');
  const app = createApp({ dataFile, ...options });
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const base = 'http://127.0.0.1:' + server.address().port;
      resolve({
        base,
        dataFile,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function post(base, route, body, raw = false) {
  const res = await fetch(base + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? body : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function get(base, route) {
  const res = await fetch(base + route);
  return { status: res.status, json: await res.json() };
}

test('health and unknown routes', async () => {
  const s = await startServer();
  try {
    const health = await get(s.base, '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.status, 'ok');

    const missing = await get(s.base, '/api/nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, 'NOT_FOUND');
  } finally {
    await s.close();
  }
});

test('analyze: scam offer is High risk with flags, checklist and text', async () => {
  const s = await startServer();
  try {
    const r = await post(s.base, '/api/analyze', { text: SCAM });
    assert.equal(r.status, 200);
    assert.equal(r.json.level, 'High');
    assert.ok(r.json.score >= 60);
    assert.ok(r.json.flags.length >= 2);
    assert.ok(r.json.checklist.length > 0);
    assert.equal(r.json.analyzedText, SCAM);
  } finally {
    await s.close();
  }
});

test('analyze: bad input gets clear 400 errors', async () => {
  const s = await startServer();
  try {
    let r = await post(s.base, '/api/analyze', { text: '   ' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'EMPTY_TEXT');

    r = await post(s.base, '/api/analyze', {});
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'EMPTY_TEXT');

    r = await post(s.base, '/api/analyze', { text: 'hi' });
    assert.equal(r.json.error.code, 'TEXT_TOO_SHORT');

    r = await post(s.base, '/api/analyze', { text: 12345 });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'INVALID_FIELD');

    r = await post(s.base, '/api/analyze', { text: SCAM, link: 99 });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'INVALID_FIELD');

    r = await post(s.base, '/api/analyze', [1, 2, 3]);
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'INVALID_BODY');

    r = await post(s.base, '/api/analyze', '{ this is not json', true);
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'INVALID_JSON');
  } finally {
    await s.close();
  }
});

test('analyze: very long text and invalid link are handled gracefully', async () => {
  const s = await startServer();
  try {
    let r = await post(s.base, '/api/analyze', { text: 'Pay registration fee now. '.repeat(1000) });
    assert.equal(r.status, 200);
    assert.ok(r.json.truncated);
    assert.ok(r.json.warnings.length > 0);

    r = await post(s.base, '/api/analyze', {
      text: 'Software intern role at Acme Pvt Ltd, Noida. Apply with your resume.',
      link: 'not a link ::',
    });
    assert.equal(r.status, 200);
    assert.ok(r.json.warnings.some((w) => w.includes('not a valid web address')));
  } finally {
    await s.close();
  }
});

test('stats count checks and levels, and never store the pasted text', async () => {
  const s = await startServer();
  try {
    const unique = 'UNIQUEPHRASE9283 ' + SCAM;
    await post(s.base, '/api/analyze', { text: unique });
    await post(s.base, '/api/analyze', {
      text: 'We are pleased to offer you the Data Analyst Intern role at Brightpath Analytics LLP, Gurugram. Contact talent@brightpath-analytics.com',
    });

    const stats = await get(s.base, '/api/stats');
    assert.equal(stats.status, 200);
    assert.equal(stats.json.totalChecked, 2);
    assert.equal(stats.json.levels.High, 1);
    assert.equal(stats.json.levels.Low, 1);
    assert.equal(stats.json.highRiskShare, 0.5);
    assert.ok(stats.json.topFlags.length > 0 && stats.json.topFlags.length <= 5);
    assert.equal(stats.json.topFlags[0].name, 'Asks you to pay money');

    const saved = fs.readFileSync(s.dataFile, 'utf8');
    assert.ok(!saved.includes('UNIQUEPHRASE9283'), 'pasted text must not be stored');
    assert.ok(!saved.includes('TechNova'), 'pasted text must not be stored');
  } finally {
    await s.close();
  }
});

test('report: saves a sanitised snippet and updates stats', async () => {
  const s = await startServer();
  try {
    const dirty =
      'Pay Rs 500 to hr.fake@gmail.com or call +91 98765 43210. Aadhaar 1234 5678 9012, ' +
      'PAN ABCDE1234F, account 123456789012 now.';
    const r = await post(s.base, '/api/report', {
      snippet: dirty,
      flags: ['MONEY_REQUEST', 'MONEY_REQUEST', 'UNOFFICIAL_EMAIL'],
      level: 'High',
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.ok, true);

    const saved = JSON.parse(fs.readFileSync(s.dataFile, 'utf8'));
    assert.equal(saved.reports.length, 1);
    const snippet = saved.reports[0].snippet;
    for (const secret of ['hr.fake@gmail.com', '98765', '1234 5678 9012', 'ABCDE1234F', '123456789012']) {
      assert.ok(!snippet.includes(secret), 'snippet still contains ' + secret);
    }
    assert.ok(snippet.includes('Rs 500'), 'harmless text should stay');
    assert.ok(snippet.length <= 200);
    assert.deepEqual(saved.reports[0].flags, ['MONEY_REQUEST', 'UNOFFICIAL_EMAIL']);

    const stats = await get(s.base, '/api/stats');
    assert.equal(stats.json.totalReported, 1);
  } finally {
    await s.close();
  }
});

test('report: long snippet is cut to 200 characters', async () => {
  const s = await startServer();
  try {
    await post(s.base, '/api/report', { snippet: 'scam text '.repeat(100), flags: [], level: 'Medium' });
    const saved = JSON.parse(fs.readFileSync(s.dataFile, 'utf8'));
    assert.equal(saved.reports[0].snippet.length, 200);
  } finally {
    await s.close();
  }
});

test('report: invalid input is rejected', async () => {
  const s = await startServer();
  try {
    let r = await post(s.base, '/api/report', { snippet: '', flags: [], level: 'High' });
    assert.equal(r.json.error.code, 'INVALID_SNIPPET');

    r = await post(s.base, '/api/report', { snippet: 'some offer text', flags: ['MADE_UP'], level: 'High' });
    assert.equal(r.json.error.code, 'INVALID_FLAGS');

    r = await post(s.base, '/api/report', { snippet: 'some offer text', flags: 'MONEY_REQUEST', level: 'High' });
    assert.equal(r.json.error.code, 'INVALID_FLAGS');

    r = await post(s.base, '/api/report', { snippet: 'some offer text', flags: [], level: 'Extreme' });
    assert.equal(r.json.error.code, 'INVALID_LEVEL');

    const stats = await get(s.base, '/api/stats');
    assert.equal(stats.json.totalReported, 0);
  } finally {
    await s.close();
  }
});

test('rate limit: too many reports in a minute get HTTP 429', async () => {
  const s = await startServer({ reportLimit: 3 });
  try {
    const body = { snippet: 'some scam offer text', flags: [], level: 'High' };
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await post(s.base, '/api/report', body)).status);
    assert.deepEqual(statuses, [201, 201, 201, 429, 429]);
  } finally {
    await s.close();
  }
});
