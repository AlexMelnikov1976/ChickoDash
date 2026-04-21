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
