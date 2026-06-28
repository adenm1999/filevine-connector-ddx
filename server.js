const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || true,
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: 'text/csv', limit: '50mb' }));

// Security headers for hosted environments
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'ALLOWALL'); // Allow Domo iframe embed
  next();
});

// ══════════════════════════════════════
//  FILEVINE PROXY
// ══════════════════════════════════════

// POST /proxy/fv/token — Exchange PAT for bearer token
app.post('/proxy/fv/token', async (req, res) => {
  const { pat, client_id, client_secret } = req.body || {};
  console.log('[FV Token] Request received — pat:', pat ? pat.substring(0,8)+'...' : 'MISSING', 'client_id:', client_id || 'MISSING');

  if (!pat || !client_id || !client_secret) {
    return res.status(400).json({ error: 'Missing pat, client_id, or client_secret in request body' });
  }

  const params = new URLSearchParams();
  params.append('grant_type', 'personal_access_token');
  params.append('token', pat);
  params.append('client_id', client_id);
  params.append('client_secret', client_secret);
  params.append('scope', 'fv.api.gateway.access tenant filevine.v2.api.* openid email fv.auth.tenant.read fv.vitals.api.* fv.payments.api.all filevine.v2.webhooks');

  try {
    const resp = await fetch('https://identity.filevine.com/connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = await resp.text();
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch (parseErr) {
      console.error('[FV Token] Non-JSON response:', data.substring(0, 200));
      return res.status(resp.status).json({ error: 'Filevine returned non-JSON (HTTP ' + resp.status + '). Check credentials.' });
    }

    if (!resp.ok) {
      console.error('[FV Token] Error:', resp.status, parsed);
      return res.status(resp.status).json({ error: 'Token exchange failed', details: parsed });
    }

    console.log('[FV Token] Success — scopes:', parsed.scope, 'expires_in:', parsed.expires_in);
    res.json(parsed);
  } catch (err) {
    console.error('[FV Token] Fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ALL /proxy/fv/gateway/* — Proxy any Filevine gateway call
app.all('/proxy/fv/gateway/*', async (req, res) => {
  const fvPath = '/' + req.params[0]; // e.g. /Auth/Identify, /Contacts, etc.
  const url = 'https://api.filevineapp.com/fv-app/v2' + fvPath;

  // Forward query string
  const qs = new URLSearchParams(req.query).toString();
  const fullUrl = qs ? url + '?' + qs : url;

  // Forward auth headers from the client
  const headers = {
    'Content-Type': 'application/json',
  };
  if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'];
  if (req.headers['x-fv-orgid']) headers['x-fv-orgid'] = req.headers['x-fv-orgid'];
  if (req.headers['x-fv-userid']) headers['x-fv-userid'] = req.headers['x-fv-userid'];

  const fetchOpts = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length) {
    fetchOpts.body = JSON.stringify(req.body);
  }

  try {
    console.log('[FV Gateway]', req.method, fvPath);
    const resp = await fetch(fullUrl, fetchOpts);
    const contentType = resp.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const data = await resp.json();
      res.status(resp.status).json(data);
    } else {
      const text = await resp.text();
      res.status(resp.status).send(text);
    }
  } catch (err) {
    console.error('[FV Gateway] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════
//  DOMO PROXY
// ══════════════════════════════════════

// GET /proxy/domo/token — OAuth client credentials
app.get('/proxy/domo/token', async (req, res) => {
  const { client_id, client_secret } = req.query;
  if (!client_id || !client_secret) {
    return res.status(400).json({ error: 'client_id and client_secret required' });
  }

  try {
    const resp = await fetch(
      'https://api.domo.com/oauth/token?grant_type=client_credentials&scope=data',
      {
        method: 'GET',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64'),
        },
      }
    );

    const data = await resp.text();
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch (parseErr) {
      console.error('[Domo Token] Non-JSON response:', data.substring(0, 200));
      return res.status(resp.status).json({ error: 'Domo returned non-JSON (HTTP ' + resp.status + '). Check credentials.' });
    }

    if (!resp.ok) {
      console.error('[Domo Token] Error:', resp.status, parsed);
      return res.status(resp.status).json({ error: 'Domo auth failed', details: parsed });
    }

    console.log('[Domo Token] Success — customer:', parsed.customer, 'expires_in:', parsed.expires_in);
    res.json(parsed);
  } catch (err) {
    console.error('[Domo Token] Fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ALL /proxy/domo/api/* — Proxy any Domo API call
app.all('/proxy/domo/api/*', async (req, res) => {
  const domoPath = '/' + req.params[0];
  const url = 'https://api.domo.com' + domoPath;
  const qs = new URLSearchParams(req.query).toString();
  const fullUrl = qs ? url + '?' + qs : url;

  const headers = {};
  if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'];

  const contentType = req.headers['content-type'] || 'application/json';
  headers['Content-Type'] = contentType;

  const fetchOpts = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    fetchOpts.body = contentType.includes('text/csv') ? req.body : JSON.stringify(req.body);
  }

  try {
    console.log('[Domo API]', req.method, domoPath);
    const resp = await fetch(fullUrl, fetchOpts);
    const respType = resp.headers.get('content-type') || '';

    if (respType.includes('application/json')) {
      const data = await resp.json();
      res.status(resp.status).json(data);
    } else {
      const text = await resp.text();
      res.status(resp.status).send(text);
    }
  } catch (err) {
    console.error('[Domo API] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Serve the HTML app (AFTER proxy routes so /proxy/* routes match first)
app.use(express.static(__dirname));

// ══════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║   Filevine Connector — Proxy Server          ║');
  console.log('  ║   http://localhost:' + PORT + '                       ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
  console.log('  Proxying:');
  console.log('    Filevine → identity.filevine.io + gateway.filevine.io');
  console.log('    Domo     → api.domo.com');
  console.log('');
});
