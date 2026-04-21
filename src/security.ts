// Chicko Analytics — shared security helpers
// © 2026 System360 by Alex Melnikov. All rights reserved.
//
// Phase 2.4 (2026-04-21, post-audit hardening):
//   • requireJwtSecret      — hard-fail вместо fallback на статичный secret
//   • parsePositiveIntStrict — строгий парсинг id (regex ^[1-9]\d*$)
//   • parseIsoDate          — каноническая валидация ISO даты + проверка реальности
//   • daysBetween           — для проверки максимального диапазона запросов
//
// Использование во всех handler-ах вместо встроенных fallback'ов и parseInt.

// Use these in module-local jsonResponse helpers so all endpoints share the same CORS policy.
export const ALLOWED_ORIGINS = new Set([
  'https://chicko-api-proxy.chicko-api.workers.dev',
]);

export function corsHeadersFor(request: Request): Record<string, string> {
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

import type { Env } from './index';

/**
 * Возвращает JWT_SECRET из env или бросает исключение, если он не задан или
 * слишком короткий. Заменяет старый fallback на 'temp-secret-key-...', который
 * был критической дырой: любой деплой без секрета позволил бы атакующему
 * подписать произвольный JWT.
 */
export function requireJwtSecret(env: Env): string {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) {
    throw new Error('JWT_SECRET is not configured (must be at least 16 chars)');
  }
  return env.JWT_SECRET;
}

/**
 * Строгий парсинг положительного целого. parseInt('12abc') → 12, что
 * permissive и небезопасно как привычка. Этот парсер требует чистую
 * последовательность цифр без ведущих нулей.
 *
 * Возвращает число или null, если вход не валидный.
 */
export function parsePositiveIntStrict(s: string | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  if (!/^[1-9]\d*$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Каноническая валидация ISO даты YYYY-MM-DD.
 * - Проверяет формат через regex
 * - Проверяет, что дата реальная (2026-99-99 не пройдёт)
 * - Проверяет, что round-trip через Date даёт ту же строку
 *
 * Возвращает нормализованную строку или null.
 */
export function parseIsoDate(s: string | null | undefined): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const normalized = d.toISOString().slice(0, 10);
  return normalized === s ? s : null;
}

/**
 * Количество дней между двумя ISO-датами (включительно).
 * Используется для ограничения слишком тяжёлых запросов.
 */
export function daysBetween(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00Z`).getTime();
  const b = new Date(`${end}T00:00:00Z`).getTime();
  return Math.floor((b - a) / 86400000) + 1;
}

/**
 * Максимальный допустимый диапазон дат для аналитических запросов.
 * Чтобы один запрос не выгребал годы данных и не клал ClickHouse.
 */
export const MAX_DATE_RANGE_DAYS = 400;

// -----------------------------------------------------------------------------
// Rate limiting (Phase 2.4b, 2026-04-21) — #6 из аудита
// -----------------------------------------------------------------------------
//
// Fixed-window counters в KV. Проще sliding window / Durable Objects и
// достаточно для текущего масштаба (4 пользователя). Допускает burst до 2×
// на границе окна — приемлемо для defense-in-depth.
//
// FAIL-OPEN: если KV сбоит — легитимные пользователи не должны ловить 429.
// Rate limiting — defense-in-depth, не первичная защита. Лог в console.error.
//
// Переиспользуем MAGIC_LINKS namespace с префиксом `rl:` (не конфликтует с
// `token:` и `ratelimit:`, которые использует magic_link.ts).

export interface RateLimitConfig {
  /** Максимум запросов в окне. */
  limit: number;
  /** Размер окна в секундах. */
  windowSec: number;
}

/**
 * Лимит для data endpoints (/api/restaurants, /api/benchmarks,
 * /api/restaurant-meta, /api/dow-profiles, /api/forecast).
 *
 * 60/мин/user — пользователь при активной работе (переключение ресторана +
 * период) делает 4-5 запросов, запас ~10× на нормальный UI.
 */
export const RATE_LIMIT_DATA: RateLimitConfig = { limit: 60, windowSec: 60 };

/**
 * Лимит для /api/feedback. Люди не пишут 10+ сообщений в минуту.
 */
export const RATE_LIMIT_FEEDBACK: RateLimitConfig = { limit: 10, windowSec: 60 };

/**
 * Выполняет rate limit check и возвращает Response(429) если лимит превышен,
 * или null если всё ок (и запрос надо пропустить дальше).
 *
 * Сигнатура — с учётом урока Phase 2.4a: все 4 аргумента разных типов, все
 * обязательны. Перепутать невозможно.
 *
 *   const rl = await rateLimitOrResponse(env.MAGIC_LINKS, `data:${userId}`,
 *                                        RATE_LIMIT_DATA, request);
 *   if (rl) return rl;
 *
 * Ключ в KV: `rl:<key>:<windowStart>` — где windowStart это начало текущего
 * окна в unix-секундах, выровненное по windowSec.
 */
export async function rateLimitOrResponse(
  kv: KVNamespace,
  key: string,
  config: RateLimitConfig,
  request: Request,
): Promise<Response | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (now % config.windowSec);
    const kvKey = `rl:${key}:${windowStart}`;

    const current = await kv.get(kvKey);
    const count = current ? parseInt(current, 10) : 0;

    if (count >= config.limit) {
      const retryAfter = config.windowSec - (now - windowStart);
      return new Response(
        JSON.stringify({
          error: 'Too many requests',
          retry_after_sec: retryAfter,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
            ...corsHeadersFor(request),
          },
        },
      );
    }

    // Инкремент. TTL = 2× размер окна — запись гарантированно переживёт
    // своё окно, но не заседает в KV лишнего.
    await kv.put(kvKey, String(count + 1), {
      expirationTtl: config.windowSec * 2,
    });

    return null;
  } catch (e) {
    // FAIL-OPEN: KV сбой не должен ронять легитимные запросы.
    const err = e as Error;
    console.error(`[rate-limit] KV error for key=${key}: ${err.message}`);
    return null;
  }
}
