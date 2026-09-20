const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const APIv2 = require('../modules/apiv2/index.js');

const FIXTURE_SPOTS = [
    { spotted: 'W1AW', spotter: 'K1ABC', frequency: 14074, band: '20m', source: 'cluster' }
];

function startApp(config, rateLimiter) {
    const apiv2 = new APIv2(config);
    const app = express();
    app.use('/api/v2', apiv2.createRouter(rateLimiter));
    return new Promise((resolve) => {
        const server = app.listen(0, () => resolve(server));
    });
}

function stopApp(server) {
    return new Promise((resolve) => server.close(resolve));
}

const ROUTES = ['/bands', '/sources', '/heatmap', '/info'];

test('rate limiter applies to /bands, /sources, /heatmap, /info', async (t) => {
    const rateLimiter = (req, res, next) => {
        res.status(429).json({ error: 'rate limited' });
    };
    const server = await startApp({ getSpotsData: () => FIXTURE_SPOTS }, rateLimiter);
    const base = `http://localhost:${server.address().port}/api/v2`;

    t.after(() => stopApp(server));

    for (const route of ROUTES) {
        const res = await fetch(`${base}${route}`);
        assert.equal(res.status, 429, `${route} should be rate limited`);
    }

    // Regression guard: existing rate-limited route still behaves as before
    const spotsRes = await fetch(`${base}/spots`);
    assert.equal(spotsRes.status, 429, '/spots should still be rate limited');
});

test('global auth middleware protects /bands, /sources, /heatmap, /info when apiKey is configured', async (t) => {
    const server = await startApp({ getSpotsData: () => FIXTURE_SPOTS, apiKey: 'secret' });
    const base = `http://localhost:${server.address().port}/api/v2`;

    t.after(() => stopApp(server));

    for (const route of ROUTES) {
        const noKey = await fetch(`${base}${route}`);
        assert.equal(noKey.status, 401, `${route} without X-API-Key should be 401`);

        const wrongKey = await fetch(`${base}${route}`, { headers: { 'x-api-key': 'wrong' } });
        assert.equal(wrongKey.status, 403, `${route} with wrong X-API-Key should be 403`);

        const correctKey = await fetch(`${base}${route}`, { headers: { 'x-api-key': 'secret' } });
        assert.equal(correctKey.status, 200, `${route} with correct X-API-Key should be 200`);
    }
});
