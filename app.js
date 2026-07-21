/**
 * login-svc
 * Public service. Reached at GET /login via API Gateway (no authorizer).
 *
 * It does NOT authenticate anyone itself. Its job is to:
 *   1. GET /login           -> render a page with a button to the Cognito Hosted UI
 *   2. GET /login/callback  -> receive ?code=..., exchange it for tokens at
 *                              Cognito's /oauth2/token, and SHOW you the id_token
 *                              so you can paste it into the Task 8 curl command.
 *
 * Showing the raw token on screen is a TEACHING choice. A real app would set an
 * HttpOnly, Secure, SameSite=Lax cookie and never expose the token to JS.
 */
const os = require('os');
const express = require('express');
const { setupObservability } = require('./observability');

const SERVICE_NAME = 'login-svc';
const PORT = process.env.PORT || 8081;

// --- Injected as ECS task-definition environment variables (Task 5) ---
const COGNITO_DOMAIN = process.env.COGNITO_DOMAIN || 'https://auth.example.click';
const CLIENT_ID = process.env.CLIENT_ID || 'REPLACE_ME';
const REDIRECT_URI =
  process.env.REDIRECT_URI ||
  'https://api.mruthul-micro.click/login/callback';
const SCOPES         = process.env.COGNITO_SCOPES || 'openid email profile';

const app = express();
app.disable('x-powered-by');
app.use(express.json());

setupObservability(app, SERVICE_NAME);

const esc = (s) => String(s).replace(/[<>&"]/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

const shell = (inner) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Login Service</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background:#0f2b46;
           color:#fff; display:flex; align-items:center; justify-content:center;
           min-height:100vh; margin:0; padding:30px; box-sizing:border-box; }
    .card { background:#fff; color:#1c1c1e; padding:40px 48px; border-radius:12px;
            max-width:760px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,.35); }
    h1 { margin:0 0 6px; color:#0f2b46; }
    .btn { display:inline-block; background:#ff9900; color:#1c1c1e; font-weight:600;
           text-decoration:none; padding:13px 30px; border-radius:6px; margin-top:18px; }
    pre { background:#10202f; color:#e8eef4; padding:12px; border-radius:6px;
          font-size:11px; overflow-x:auto; white-space:pre-wrap; word-break:break-all; }
    code { background:#f0f2f5; padding:2px 6px; border-radius:4px; font-size:13px; }
    .muted { color:#5a6672; font-size:13px; }
    .warn { background:#fff6e5; border-left:4px solid #ff9900; padding:10px 14px;
            font-size:13px; margin-top:18px; }
    table { border-collapse:collapse; width:100%; font-size:13px; margin-top:10px; }
    td { padding:6px 8px; border:1px solid #d5dce4; }
    td:first-child { background:#f5f7fa; font-weight:600; width:150px; }
  </style>
</head>
<body><div class="card">${inner}</div></body>
</html>`;

// ---------- GET /login ----------
app.get(['/', '/login'], (_req, res) => {
  const hostedUiUrl =
    `https://${COGNITO_DOMAIN}/oauth2/authorize` +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

  res.type('html').send(shell(`
    <h1>Login Service</h1>
    <p class="muted">Served by task <code>${esc(os.hostname())}</code> &mdash; public route, no token required.</p>
    <p>Clicking below sends you to the <b>Cognito Hosted UI</b> at
       <code>${esc(COGNITO_DOMAIN)}</code>. This service never sees your password.</p>
    <a class="btn" href="${esc(hostedUiUrl)}">Sign in with Cognito &rarr;</a>
    <div class="warn">
      After signing in, Cognito redirects back to <code>/login/callback?code=...</code>.
      This service exchanges that code for tokens and prints your <b>id_token</b>,
      which you then paste into the Task 8 curl command.
    </div>
  `));
});

// ---------- GET /login/callback ----------
app.get('/login/callback', async (req, res) => {
  const { code, error, error_description: errDesc } = req.query;

  if (error) {
    return res.status(400).type('html').send(shell(`
      <h1>Login failed</h1>
      <p><b>${esc(error)}</b></p>
      <p class="muted">${esc(errDesc || '')}</p>
      <a class="btn" href="/login">Try again</a>
    `));
  }

  if (!code) {
    return res.status(400).type('html').send(shell(`
      <h1>Missing authorization code</h1>
      <p class="muted">Cognito did not return a <code>?code=</code> parameter.</p>
      <a class="btn" href="/login">Back to login</a>
    `));
  }

  try {
    // Public client (no secret) => no Authorization header on this call.
    // If you configured a CONFIDENTIAL client, you must instead send:
    //   Authorization: Basic base64(client_id:client_secret)
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: String(code),
      redirect_uri: REDIRECT_URI,
    });

    const tokenRes = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    const tokens = await tokenRes.json();

    if (!tokenRes.ok) {
      throw new Error(tokens.error_description || tokens.error || 'token exchange failed');
    }

    // Decode the id_token payload for display only. NOTE: this is base64 decoding,
    // NOT verification. We are deliberately not verifying the signature here --
    // that is API Gateway's JWT authorizer's job (see Task 12 question 4).
    const claims = JSON.parse(
      Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8')
    );

    return res.type('html').send(shell(`
      <h1>Signed in</h1>
      <p class="muted">Token exchange succeeded at <code>${esc(COGNITO_DOMAIN)}/oauth2/token</code></p>
      <table>
        <tr><td>email</td><td>${esc(claims.email || '-')}</td></tr>
        <tr><td>sub</td><td>${esc(claims.sub)}</td></tr>
        <tr><td>token_use</td><td>${esc(claims.token_use)}</td></tr>
        <tr><td>expires</td><td>${esc(new Date(claims.exp * 1000).toISOString())}</td></tr>
      </table>
      <p style="margin-top:20px"><b>Your id_token</b> &mdash; copy this for Task 8:</p>
      <pre>${esc(tokens.id_token)}</pre>
      <p><b>Test the protected route:</b></p>
      <pre>curl -i -X POST https://api.YOURDOMAIN.click/payment/pay \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${esc(tokens.id_token.slice(0, 24))}..." \\
  -d '{"amount":499,"currency":"USD"}'</pre>
      <div class="warn">
        A production app would set this in an <b>HttpOnly, Secure, SameSite</b> cookie
        and never render it. It is shown here purely so you can complete the task.
      </div>
    `));
  } catch (err) {
    console.error(JSON.stringify({ msg: 'token exchange failed', error: err.message }));
    return res.status(502).type('html').send(shell(`
      <h1>Token exchange failed</h1>
      <pre>${esc(err.message)}</pre>
      <p class="muted">Check: the callback URL registered in the Cognito app client
      must EXACTLY match <code>${esc(REDIRECT_URI)}</code>, and the app client must
      have <b>no client secret</b>.</p>
      <a class="btn" href="/login">Back to login</a>
    `));
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({
    msg: `${SERVICE_NAME} listening`, port: PORT,
    cognitoDomain: COGNITO_DOMAIN, redirectUri: REDIRECT_URI,
  }));
});

process.on('SIGTERM', () => {
  console.log(JSON.stringify({ msg: 'SIGTERM received, draining' }));
  server.close(() => process.exit(0));
});

