import {
  generateToken as generateJWT,
  extractTokenFromCookie,
  validateToken,
  buildSessionCookie,
  buildClearCookie,
} from './auth';
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
import { handleCspReport } from './csp_report';
import {
  requireJwtSecret,
  rateLimitOrResponse,
  RATE_LIMIT_FEEDBACK,
  authFromCookie,
  checkOrigin,
} from './security';

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
//
// NOTE: этот whitelist дублирует ALLOWED_ORIGINS из security.ts. Не
// рефакторим сейчас, чтобы не смешивать с Phase 2.4d (cookie migration) —
// отдельный cleanup после деплоя.
const ALLOWED_ORIGINS = new Set([
  'https://chicko-api-proxy.chicko-api.workers.dev',
]);

// Build CORS headers based on the request's Origin. If origin matches the
// whitelist, echo it back; otherwise no Access-Control-Allow-Origin is set
// (cross-origin browser requests will fail at the SOP layer).
//
// Phase 2.4d (2026-04-21):
//   - Убран 'Authorization' из Allow-Headers (больше не используется)
//   - Добавлен Allow-Credentials: true — обязателен для cookie-auth
//     при cross-origin (задел на кастомный домен)
function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
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

// --- HTML security headers ---

// Базовые security headers — применяются ко всем HTML-ответам
// (главный дашборд + страница ошибки из magic-link callback).
const HTML_SECURITY_HEADERS_BASE: Record<string, string> = {
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

// CSP Report-Only (Phase 2.4c, 21.04.2026).
//
// Политика строгая, без unsafe-inline — цель собрать максимум
// violations, чтобы увидеть что реально использует dashboard.ts.
// Через ~7 дней:
//   wrangler kv key list --binding MAGIC_LINKS --prefix "csp:"
//   → смотрим топ нарушений по count в агрегированных записях
//   → составляем enforce-политику (возможно с nonces для inline)
//   → меняем Content-Security-Policy-Report-Only на Content-Security-Policy
//
// Примечания:
// - 'report-sample' просит браузер включать короткий семпл кода
//   (до 40 символов) в отчёт. Помогает идентифицировать какой
//   именно inline style/script нарушает политику. PII-риск
//   минимальный — dashboard.ts не содержит персональных данных
//   в CSS/JS коде.
// - 'data:' в img-src — нужно для base64-инлайн-иконок если
//   они есть (SVG data URI). Если нет — увидим в отчётах и уберём.
// - frame-ancestors 'none' — эквивалент X-Frame-Options: DENY,
//   защита от clickjacking.
const CSP_REPORT_ONLY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'report-sample'",
  "style-src 'self' 'report-sample'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "report-uri /api/csp-report",
].join('; ');

// HTML-headers для главного дашборда: базовые + CSP Report-Only.
const HTML_SECURITY_HEADERS: Record<string, string> = {
  ...HTML_SECURITY_HEADERS_BASE,
  // 'Content-Security-Policy-Report-Only': CSP_REPORT_ONLY_POLICY, // TEMP OFF 21.04.2026: KV flood, вернём 28.04 с unsafe-inline
};

// errorPage() не получает Content-Security-Policy-Report-Only:
// сам error page содержит inline <style>, будет шуметь собственным
// мусором в отчётах. Базовые security headers — да.

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

    // CSP violation reports (Phase 2.4c). No auth — reports come from
    // the browser directly and may include cases where user is not logged in.
    if (url.pathname === '/api/csp-report' && request.method === 'POST') {
      return handleCspReport(request, env);
    }

    // --- Auth-state endpoints (Phase 2.4d) ---

    // Клиент не может прочитать HttpOnly cookie из JS, поэтому использует
    // этот endpoint как "am I logged in?". Возвращает 200+{email} или 401.
    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      return handleAuthMe(request, env);
    }

    // Logout: чистим session cookie. Origin-check защищает от CSRF
    // (злоумышленник не должен иметь возможность форсировать logout).
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      return handleLogout(request);
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
      return jsonResponse({ error: 'Invalid email' }, request, 400);
    }

    console.log(`[request-link] attempt for email=${email}`);

    // Rate limit (per email, 60 seconds)
    const allowed = await checkRateLimit(env.MAGIC_LINKS, email);
    if (!allowed) {
      console.log(`[request-link] rate-limited for email=${email}`);
      return jsonResponse({ error: 'Too many requests. Try again in 60 seconds.' }, request, 429);
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
      return jsonResponse({ error: 'Failed to send email. Please try again.' }, request, 500);
    }

    console.log(`[request-link] email sent to ${email}, user_id=${userId}`);
    return jsonResponse({ success: true, message: 'Link sent. Check your email.' }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[request-link] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed' }, request, 500);
  }
}

/**
 * GET /auth/callback?token=...
 * Called when user clicks the magic link in email.
 * Redirects to dashboard (/) with ?login_token=<same_token>.
 * The frontend picks up login_token from URL and exchanges it for a session
 * cookie via /api/auth/verify.
 * Token is NOT consumed here — it's consumed when frontend calls /api/auth/verify.
 */
async function handleAuthCallback(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return new Response(errorPage('Токен не передан в URL.'), {
        status: 400,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          ...HTML_SECURITY_HEADERS_BASE,
        },
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
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        ...HTML_SECURITY_HEADERS_BASE,
      },
    });
  }
}

/**
 * POST /api/auth/verify
 * Body: { token: string }
 *
 * Phase 2.4d (2026-04-21):
 *   - Consumes magic-link token
 *   - Sets HttpOnly session cookie (chicko_session)
 *   - Returns JSON {success, email} — JWT больше НЕ возвращается в теле
 *     ответа. Клиент не должен видеть токен ни в каком виде.
 */
async function handleVerify(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { token?: string };
    const token = body.token;

    if (!token) {
      return jsonResponse({ error: 'Token required' }, request, 400);
    }

    const email = await consumeToken(env.MAGIC_LINKS, token);
    if (!email) {
      console.log(`[verify] invalid or expired token`);
      return jsonResponse({ error: 'Invalid or expired token' }, request, 401);
    }

    const userId = await isAllowedUser(env.USERS, email);
    if (!userId) {
      console.log(`[verify] email no longer in whitelist: ${email}`);
      return jsonResponse({ error: 'Access denied' }, request, 403);
    }

    const jwt = await generateJWT(
      { user_id: userId, email },
      requireJwtSecret(env)
    );

    console.log(`[verify] login success for ${email}, user_id=${userId}`);

    // Cookie-based session. JWT в теле ответа больше не возвращается.
    return new Response(
      JSON.stringify({ success: true, email }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': buildSessionCookie(jwt),
          ...corsHeadersFor(request),
        },
      },
    );
  } catch (error) {
    const err = error as Error;
    console.error(`[verify] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Verification failed' }, request, 500);
  }
}

/**
 * GET /api/auth/me
 * Requires session cookie.
 *
 * Клиент не видит HttpOnly cookie и поэтому не может из JS понять, залогинен
 * ли пользователь. Этот endpoint — единственный способ проверить: 200 с
 * {email, user_id} → залогинен, 401 → показать форму логина.
 *
 * Не пишет в KV (нет rate-limit), т.к. вызывается на каждом открытии страницы
 * и должен быть лёгким. Проверка JWT — чисто CPU, масштабируется.
 */
async function handleAuthMe(request: Request, env: Env): Promise<Response> {
  try {
    const a = await authFromCookie(request, env);
    if (a instanceof Response) return a;

    return jsonResponse({ user_id: a.user_id, email: a.email }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[auth-me] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed' }, request, 500);
  }
}

/**
 * POST /api/auth/logout
 *
 * Возвращает Set-Cookie с Max-Age=0, браузер удаляет session cookie.
 * Origin-check защищает от CSRF-форсированного logout (атакующий не
 * должен иметь возможность выкинуть легитимного пользователя из системы,
 * даже если это "всего лишь" отказ в обслуживании).
 *
 * Endpoint не требует валидного cookie — логаут должен работать, даже если
 * cookie уже протух на стороне сервера (клиент всё равно хочет "забыть" его).
 */
async function handleLogout(request: Request): Promise<Response> {
  const originError = checkOrigin(request);
  if (originError) return originError;

  console.log(`[logout] clearing session cookie`);

  return new Response(
    JSON.stringify({ success: true }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': buildClearCookie(),
        ...corsHeadersFor(request),
      },
    },
  );
}

/**
 * POST /api/feedback
 * Requires session cookie.
 * Body: { category: string, text: string, restaurant: string }
 * Forwards feedback to n8n webhook → Notion + Telegram.
 * Returns 200 immediately, webhook fires in background (waitUntil).
 *
 * Phase 2.4d: migrated from Authorization: Bearer to session cookie,
 * added Origin-check for CSRF protection (state-changing endpoint).
 */
async function handleFeedback(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    // CSRF-защита: state-changing POST обязан проверять Origin.
    const originError = checkOrigin(request);
    if (originError) return originError;

    const a = await authFromCookie(request, env);
    if (a instanceof Response) return a;

    const rl = await rateLimitOrResponse(env.MAGIC_LINKS, `feedback:${a.user_id}`, RATE_LIMIT_FEEDBACK, request);
    if (rl) return rl;

    const body = await request.json() as { category: string; text: string; restaurant: string };

    if (!body.category || !body.text?.trim()) {
      return jsonResponse({ error: 'Category and text required' }, request, 400);
    }

    // Защита от abuse: ограничиваем длину полей.
    const text = body.text.trim().slice(0, 4000);
    const category = String(body.category).slice(0, 50);
    const restaurant = String(body.restaurant || '—').slice(0, 200);

    const feedbackPayload = {
      category,
      text,
      restaurant,
      email: a.email,
      user_id: a.user_id,
      timestamp: new Date().toISOString(),
    };

    console.log(`[feedback] from=${a.email} cat=${category} rest=${restaurant}`);

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
    return jsonResponse({ error: 'Feedback failed' }, request, 500);
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
