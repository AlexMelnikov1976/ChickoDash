import { generateToken as generateJWT, validateToken, extractBearerToken } from './auth';
import {
  generateToken as generateMagicToken,
  storeToken,
  consumeToken,
  isAllowedUser,
  checkRateLimit,
  sendMagicLinkEmail,
} from './magic_link';
import { DASHBOARD_HTML } from './dashboard';
import { handleDowProfiles } from './dow_profiles';
import { handleForecast } from './forecast';
import { handleRestaurantsList, handleBenchmarks, handleRestaurantMeta } from './data_endpoints';
import { requireJwtSecret } from './security';

export interface Env {
  CLICKHOUSE_HOST: string;
  CLICKHOUSE_USER: string;
  CLICKHOUSE_PASSWORD: string;
  JWT_SECRET: string;
  RESEND_API_KEY: string;
  USERS: KVNamespace;
  MAGIC_LINKS: KVNamespace;
  FEEDBACK_WEBHOOK?: string; // n8n webhook URL for feedback → Notion + Telegram
}

// Allowed origins for CORS. Add custom domains here when ready.
// Wildcard '*' was removed in Phase 2.4 (security audit remediation).
const ALLOWED_ORIGINS = new Set([
  'https://chicko-api-proxy.chicko-api.workers.dev',
]);

// Build CORS headers based on the request's Origin. If origin matches the
// whitelist, echo it back; otherwise no Access-Control-Allow-Origin is set
// (cross-origin browser requests will fail at the SOP layer).
function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function jsonResponse(body: unknown, request: Request, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeadersFor(request),
    },
  });
}

// HTML security headers — see HTML_SECURITY_HEADERS below.

// Safe HTML response headers (no CSP yet — needs Report-Only testing first
// since dashboard.ts uses inline styles and onclick handlers extensively).
// Phase 2.4b will introduce CSP after audit of inline patterns.
const HTML_SECURITY_HEADERS: Record<string, string> = {
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeadersFor(request) });
    }

    const url = new URL(request.url);
    console.log(`[request] ${request.method} ${url.pathname}`);

    // --- Frontend (dashboard HTML) ---

    if ((url.pathname === '/' || url.pathname === '/index.html') && request.method === 'GET') {
      return new Response(DASHBOARD_HTML, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          ...HTML_SECURITY_HEADERS,
        },
      });
    }

    // --- Public API endpoints ---

    if (url.pathname === '/health') {
      return jsonResponse({
        status: 'ok',
        timestamp: new Date().toISOString(),
      }, request);
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

    // --- Protected API endpoints ---

    // /api/query REMOVED in Phase 2.3 (2026-04-21).
    // Replaced with whitelisted specific endpoints below.
    // Any remaining client code pointing at /api/query will fail with 404.

    if (url.pathname === '/api/restaurants' && request.method === 'GET') {
      return handleRestaurantsList(request, env);
    }

    if (url.pathname === '/api/benchmarks' && request.method === 'GET') {
      return handleBenchmarks(request, env);
    }

    if (url.pathname === '/api/restaurant-meta' && request.method === 'GET') {
      return handleRestaurantMeta(request, env);
    }

    if (url.pathname === '/api/feedback' && request.method === 'POST') {
      return handleFeedback(request, env, ctx);
    }

    if (url.pathname === '/api/dow-profiles' && request.method === 'GET') {
      return handleDowProfiles(request, env);
    }

    if (url.pathname === '/api/forecast' && request.method === 'GET') {
      return handleForecast(request, env);
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
      return jsonResponse({ error: 'Invalid email' }, 400, request);
    }

    console.log(`[request-link] attempt for email=${email}`);

    // Rate limit (per email, 60 seconds)
    const allowed = await checkRateLimit(env.MAGIC_LINKS, email);
    if (!allowed) {
      console.log(`[request-link] rate-limited for email=${email}`);
      return jsonResponse({ error: 'Too many requests. Try again in 60 seconds.' }, 429, request);
    }

    // Check whitelist. If user not allowed — still return 200 (no user enumeration),
    // just skip sending the email.
    const userId = await isAllowedUser(env.USERS, email);
    if (!userId) {
      console.log(`[request-link] email not in whitelist: ${email}`);
      return jsonResponse({ success: true, message: 'If this email is registered, a link has been sent.' }, request);
    }

    // Generate token, store in KV (TTL 15 min), send email.
    const token = generateMagicToken();
    await storeToken(env.MAGIC_LINKS, token, email);

    const magicLinkUrl = `${new URL(request.url).origin}/auth/callback?token=${token}`;
    const emailResult = await sendMagicLinkEmail(env.RESEND_API_KEY, email, magicLinkUrl);

    if (!emailResult.success) {
      console.error(`[request-link] email send failed: ${emailResult.error}`);
      return jsonResponse({ error: 'Failed to send email. Please try again.' }, 500, request);
    }

    console.log(`[request-link] email sent to ${email}, user_id=${userId}`);
    return jsonResponse({ success: true, message: 'Link sent. Check your email.' }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[request-link] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed' }, 500, request);
  }
}

/**
 * GET /auth/callback?token=...
 * Called when user clicks the magic link in email.
 * Redirects to dashboard (/) with ?login_token=<same_token>.
 * The frontend picks up login_token from URL and exchanges it for JWT via /api/auth/verify.
 * Token is NOT consumed here — it's consumed when frontend calls /api/auth/verify.
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

    // Redirect to dashboard root with login_token param
    const redirectUrl = `${url.origin}/?login_token=${encodeURIComponent(token)}`;
    console.log(`[callback] redirecting to dashboard with login_token`);

    return new Response(null, {
      status: 302,
      headers: {
        'Location': redirectUrl,
        'Cache-Control': 'no-store',
      },
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
 * Consumes magic-link token, returns JWT as JSON.
 * Used by frontend after user clicks link and is redirected to /?login_token=...
 */
async function handleVerify(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { token?: string };
    const token = body.token;

    if (!token) {
      return jsonResponse({ error: 'Token required' }, 400, request);
    }

    const email = await consumeToken(env.MAGIC_LINKS, token);
    if (!email) {
      console.log(`[verify] invalid or expired token`);
      return jsonResponse({ error: 'Invalid or expired token' }, 401, request);
    }

    const userId = await isAllowedUser(env.USERS, email);
    if (!userId) {
      console.log(`[verify] email no longer in whitelist: ${email}`);
      return jsonResponse({ error: 'Access denied' }, 403, request);
    }

    const jwt = await generateJWT(
      { user_id: userId, email },
      requireJwtSecret(env)
    );

    console.log(`[verify] login success for ${email}, user_id=${userId}`);
    return jsonResponse({
      success: true,
      token: jwt,
      expires_in: 60 * 60 * 24 * 7, // 7 days in seconds (was 30 — reduced after audit)
      email,
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[verify] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Verification failed' }, 500, request);
  }
}

/**
 * POST /api/feedback
 * Requires Bearer JWT.
 * Body: { category: string, text: string, restaurant: string }
 * Forwards feedback to n8n webhook → Notion + Telegram.
 * Returns 200 immediately, webhook fires in background (waitUntil).
 */
async function handleFeedback(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const authHeader = request.headers.get('Authorization');
    const token = extractBearerToken(authHeader);

    if (!token) {
      return jsonResponse({ error: 'Unauthorized' }, 401, request);
    }

    const payload = await validateToken(token, requireJwtSecret(env));
    if (!payload) {
      return jsonResponse({ error: 'Unauthorized' }, 401, request);
    }

    const body = await request.json() as { category: string; text: string; restaurant: string };

    if (!body.category || !body.text?.trim()) {
      return jsonResponse({ error: 'Category and text required' }, 400, request);
    }

    // Защита от abuse: ограничиваем длину полей.
    const text = body.text.trim().slice(0, 4000);
    const category = String(body.category).slice(0, 50);
    const restaurant = String(body.restaurant || '—').slice(0, 200);

    const feedbackPayload = {
      category,
      text,
      restaurant,
      email: payload.email,
      user_id: payload.user_id,
      timestamp: new Date().toISOString(),
    };

    console.log(`[feedback] from=${payload.email} cat=${category} rest=${restaurant}`);

    // Fire-and-forget: forward to n8n webhook in background
    if (env.FEEDBACK_WEBHOOK) {
      ctx.waitUntil(
        fetch(env.FEEDBACK_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(feedbackPayload),
        }).catch(err => console.error(`[feedback] webhook error: ${err.message}`))
      );
    } else {
      console.warn(`[feedback] FEEDBACK_WEBHOOK not set, feedback not forwarded`);
    }

    return jsonResponse({ success: true }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[feedback] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Feedback failed' }, 500, request);
  }
}

// --- HTML error page template ---

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Chicko Analytics — ошибка</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 560px; margin: 40px auto; padding: 0 24px; }
    h1 { color: #c62828; }
    .error { background: #ffebee; border: 1px solid #ef9a9a; padding: 16px; border-radius: 8px; margin: 24px 0; }
  </style>
</head>
<body>
  <h1>Ошибка</h1>
  <div class="error">${message}</div>
</body>
</html>`;
}
