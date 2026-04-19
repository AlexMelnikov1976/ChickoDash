import { generateToken as generateJWT, validateToken, extractBearerToken } from './auth';
import { ClickHouseClient } from './clickhouse';
import {
  generateToken as generateMagicToken,
  storeToken,
  consumeToken,
  isAllowedUser,
  checkRateLimit,
  sendMagicLinkEmail,
} from './magic_link';

export interface Env {
  CLICKHOUSE_HOST: string;
  CLICKHOUSE_USER: string;
  CLICKHOUSE_PASSWORD: string;
  JWT_SECRET: string;
  RESEND_API_KEY: string;
  USERS: KVNamespace;
  MAGIC_LINKS: KVNamespace;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    console.log(`[request] ${request.method} ${url.pathname}`);

    // --- Public endpoints ---

    if (url.pathname === '/health') {
      return jsonResponse({
        status: 'ok',
        timestamp: new Date().toISOString(),
      });
    }

    if (url.pathname === '/api/auth/request-link' && request.method === 'POST') {
      return handleRequestLink(request, env);
    }

    if (url.pathname === '/auth/callback' && request.method === 'GET') {
      return handleAuthCallback(request, env);
    }

    if (url.pathname === '/api/auth/verify' && request.method === 'POST') {
      return handleVerify(request, env);
    }

    // --- Protected endpoints ---

    if (url.pathname === '/api/query' && request.method === 'POST') {
      return handleQuery(request, env);
    }

    console.log(`[404] No route for ${request.method} ${url.pathname}`);
    return new Response('Not Found', { status: 404 });
  },
};

/**
 * POST /api/auth/request-link
 * Body: { email: string }
 * Sends a magic-link email if email is in whitelist.
 * Returns 200 regardless of whether email is in whitelist (prevents user enumeration).
 */
async function handleRequestLink(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { email?: string };
    const email = body.email?.trim().toLowerCase();

    if (!email || !email.includes('@')) {
      console.log(`[request-link] invalid email format`);
      return jsonResponse({ error: 'Invalid email' }, 400);
    }

    console.log(`[request-link] attempt for email=${email}`);

    // Rate limit (per email, 60 seconds)
    const allowed = await checkRateLimit(env.MAGIC_LINKS, email);
    if (!allowed) {
      console.log(`[request-link] rate-limited for email=${email}`);
      return jsonResponse({ error: 'Too many requests. Try again in 60 seconds.' }, 429);
    }

    // Check whitelist. If user not allowed — still return 200 (no user enumeration),
    // just skip sending the email.
    const userId = await isAllowedUser(env.USERS, email);
    if (!userId) {
      console.log(`[request-link] email not in whitelist: ${email}`);
      return jsonResponse({ success: true, message: 'If this email is registered, a link has been sent.' });
    }

    // Generate token, store in KV (TTL 15 min), send email.
    const token = generateMagicToken();
    await storeToken(env.MAGIC_LINKS, token, email);

    const magicLinkUrl = `${new URL(request.url).origin}/auth/callback?token=${token}`;
    const emailResult = await sendMagicLinkEmail(env.RESEND_API_KEY, email, magicLinkUrl);

    if (!emailResult.success) {
      console.error(`[request-link] email send failed: ${emailResult.error}`);
      return jsonResponse({ error: 'Failed to send email. Please try again.' }, 500);
    }

    console.log(`[request-link] email sent to ${email}, user_id=${userId}`);
    return jsonResponse({ success: true, message: 'Link sent. Check your email.' });
  } catch (error) {
    const err = error as Error;
    console.error(`[request-link] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed', message: err.message }, 500);
  }
}

/**
 * GET /auth/callback?token=...
 * Called when user clicks the magic link in email.
 * For MVP (no frontend yet): exchanges token for JWT server-side and shows HTML page
 * with the JWT for manual testing.
 * When frontend (M4) exists, this will redirect to dashboard URL with token as param.
 */
async function handleAuthCallback(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return new Response(errorPage('Токен не передан в URL.'), {
        status: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    const email = await consumeToken(env.MAGIC_LINKS, token);
    if (!email) {
      console.log(`[callback] invalid or expired token`);
      return new Response(
        errorPage('Ссылка недействительна или срок её действия истёк. Запросите новую ссылку.'),
        { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }

    const userId = await isAllowedUser(env.USERS, email);
    if (!userId) {
      // Shouldn't happen (whitelist was checked on request-link), but defense in depth
      console.log(`[callback] email no longer in whitelist: ${email}`);
      return new Response(errorPage('Доступ отозван.'), {
        status: 403,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    const jwt = await generateJWT(
      { user_id: userId, email },
      env.JWT_SECRET || 'temp-secret-key-change-in-production'
    );

    console.log(`[callback] login success for ${email}, user_id=${userId}`);
    return new Response(successPage(email, jwt), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error) {
    const err = error as Error;
    console.error(`[callback] error: ${err.message}`, err.stack);
    return new Response(errorPage('Произошла ошибка при входе.'), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

/**
 * POST /api/auth/verify
 * Body: { token: string }
 * Alternative to /auth/callback: consumes magic-link token, returns JWT as JSON.
 * Used by frontend once it exists.
 */
async function handleVerify(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { token?: string };
    const token = body.token;

    if (!token) {
      return jsonResponse({ error: 'Token required' }, 400);
    }

    const email = await consumeToken(env.MAGIC_LINKS, token);
    if (!email) {
      console.log(`[verify] invalid or expired token`);
      return jsonResponse({ error: 'Invalid or expired token' }, 401);
    }

    const userId = await isAllowedUser(env.USERS, email);
    if (!userId) {
      console.log(`[verify] email no longer in whitelist: ${email}`);
      return jsonResponse({ error: 'Access denied' }, 403);
    }

    const jwt = await generateJWT(
      { user_id: userId, email },
      env.JWT_SECRET || 'temp-secret-key-change-in-production'
    );

    console.log(`[verify] login success for ${email}, user_id=${userId}`);
    return jsonResponse({
      success: true,
      token: jwt,
      expires_in: 60 * 60 * 24 * 30, // 30 days in seconds
      email,
    });
  } catch (error) {
    const err = error as Error;
    console.error(`[verify] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Verification failed', message: err.message }, 500);
  }
}

/**
 * POST /api/query
 * Requires Bearer JWT. Executes SQL without any RLS — all users see all data.
 */
async function handleQuery(request: Request, env: Env): Promise<Response> {
  try {
    const authHeader = request.headers.get('Authorization');
    const token = extractBearerToken(authHeader);

    if (!token) {
      console.log(`[query] missing Authorization header`);
      return jsonResponse({ error: 'Unauthorized', message: 'Missing Authorization header' }, 401);
    }

    const payload = await validateToken(token, env.JWT_SECRET || 'temp-secret-key-change-in-production');

    if (!payload) {
      console.log(`[query] invalid or expired JWT`);
      return jsonResponse({ error: 'Unauthorized', message: 'Invalid or expired token' }, 401);
    }

    const body = await request.json() as { query: string };

    console.log(`[query] user=${payload.user_id} email=${payload.email} sql_length=${body.query?.length ?? 0}`);

    const clickhouse = new ClickHouseClient({
      host: env.CLICKHOUSE_HOST || 'http://localhost:8123',
      user: env.CLICKHOUSE_USER || 'default',
      password: env.CLICKHOUSE_PASSWORD || '',
    });

    const result = await clickhouse.query(body.query);

    console.log(`[query] success user=${payload.user_id} rows=${result.rows} elapsed=${result.statistics?.elapsed ?? 'n/a'}`);
    return jsonResponse({
      status: 'success',
      data: result.data,
      rows: result.rows,
      statistics: result.statistics,
      user_id: payload.user_id,
      email: payload.email,
    });
  } catch (error) {
    const err = error as Error;
    console.error(`[query] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Query execution failed', message: err.message }, 500);
  }
}

// --- HTML page templates (temporary, for MVP before frontend exists) ---

function successPage(email: string, jwt: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Chicko Analytics — вход выполнен</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 640px; margin: 40px auto; padding: 0 24px; }
    h1 { color: #1a1a1a; }
    .success { background: #e8f5e9; border: 1px solid #a5d6a7; padding: 16px; border-radius: 8px; margin: 24px 0; }
    .token-box { background: #f5f5f5; border: 1px solid #ddd; padding: 16px; border-radius: 8px; font-family: monospace; font-size: 12px; word-break: break-all; margin: 12px 0; }
    button { background: #1a1a1a; color: #fff; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; }
    button:hover { background: #333; }
    .muted { color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <h1>Вход выполнен ✅</h1>
  <div class="success">Вы вошли как <strong>${email}</strong></div>
  <p class="muted">Фронтенд-дашборд пока не подключён. Ниже — ваш JWT-токен для ручного тестирования API:</p>
  <div class="token-box" id="token">${jwt}</div>
  <button onclick="navigator.clipboard.writeText(document.getElementById('token').textContent); this.textContent='Скопировано!'">Скопировать токен</button>
  <p class="muted" style="margin-top: 32px;">Токен действителен 30 дней. Используйте его в заголовке <code>Authorization: Bearer &lt;token&gt;</code> при запросах к <code>/api/query</code>.</p>
</body>
</html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Chicko Analytics — ошибка входа</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 560px; margin: 40px auto; padding: 0 24px; }
    h1 { color: #c62828; }
    .error { background: #ffebee; border: 1px solid #ef9a9a; padding: 16px; border-radius: 8px; margin: 24px 0; }
  </style>
</head>
<body>
  <h1>Ошибка входа</h1>
  <div class="error">${message}</div>
</body>
</html>`;
}
