// Chicko Analytics — Admin endpoints (Phase 2.9.3)
// © 2026 System360 by Alex Melnikov. All rights reserved.
// Proprietary software — unauthorized copying or distribution prohibited.
//
// Endpoint-ы для админ-аналитики. Доступны ТОЛЬКО пользователям с is_admin=true
// в KV USERS. Обычные пользователи получают 403.
//
//   GET /api/admin/me       — возвращает {is_admin: boolean}, без 403.
//                             Используется фронтом для выбора: показывать
//                             вкладку «Активность» или нет.
//   GET /api/admin/activity — статистика активности пользователей:
//                             top_tabs, top_endpoints, by_user, recent.
//                             Параметр ?window=7|30 (по умолчанию 7 дней).
//
// Чтобы пользователь стал админом:
//   wrangler kv key put --binding USERS --remote "user:email@x.com" \
//     '{"user_id":"slug","is_admin":true}'
//
// Источник данных: chicko.user_activity_log (пишется через activity_log.ts).

import {
  authFromCookie,
  corsHeadersFor,
  rateLimitOrResponse,
  RATE_LIMIT_DATA,
} from './security';
import { ClickHouseClient } from './clickhouse';
import type { Env } from './index';

function jsonResponse(body: unknown, request: Request, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeadersFor(request) },
  });
}

function makeClient(env: Env): ClickHouseClient {
  return new ClickHouseClient({
    host: env.CLICKHOUSE_HOST || 'http://localhost:8123',
    user: env.CLICKHOUSE_USER || 'default',
    password: env.CLICKHOUSE_PASSWORD || '',
  });
}

/**
 * Проверка прав админа: читает KV запись `user:<email>` и смотрит флаг
 * `is_admin`. Обратная совместимость — если поле отсутствует, считаем false.
 *
 * Возвращает true / false. Не бросает исключений.
 */
async function isAdmin(kv: KVNamespace, email: string): Promise<boolean> {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    const raw = await kv.get(`user:${normalizedEmail}`);
    if (!raw) return false;
    const data = JSON.parse(raw) as { user_id?: string; is_admin?: boolean };
    return data.is_admin === true;
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// GET /api/admin/me
// -----------------------------------------------------------------------------
// Легковесный endpoint для фронта: узнать, админ ли текущий пользователь.
// Возвращает 200 всегда (не 403), чтобы фронт мог мягко скрыть вкладку
// без ошибок в консоли.
export async function handleAdminMe(request: Request, env: Env): Promise<Response> {
  try {
    const a = await authFromCookie(request, env);
    if (a instanceof Response) return a;

    const admin = await isAdmin(env.USERS, a.email);
    return jsonResponse({ is_admin: admin, email: a.email }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[admin-me] error: ${err.message}`);
    return jsonResponse({ error: 'Request failed' }, request, 500);
  }
}

// -----------------------------------------------------------------------------
// GET /api/admin/activity?window=7
// -----------------------------------------------------------------------------
// Сводка активности за последние N дней. По умолчанию 7.
// Доступно только админам.
export async function handleAdminActivity(request: Request, env: Env): Promise<Response> {
  try {
    const a = await authFromCookie(request, env);
    if (a instanceof Response) return a;

    // Rate-limit как у обычных data endpoint-ов
    const rl = await rateLimitOrResponse(env.MAGIC_LINKS, `data:${a.user_id}`, RATE_LIMIT_DATA, request);
    if (rl) return rl;

    // Проверка админа — 403 если не админ
    const admin = await isAdmin(env.USERS, a.email);
    if (!admin) {
      console.warn(`[admin-activity] 403 for ${a.email} (${a.user_id})`);
      return jsonResponse({ error: 'Forbidden', message: 'Admin access required' }, request, 403);
    }

    // Парсим window (7 / 30, по умолчанию 7)
    const url = new URL(request.url);
    const windowParam = url.searchParams.get('window');
    const windowDays = windowParam === '30' ? 30 : 7;

    console.log(`[admin-activity] admin=${a.email} window=${windowDays}d`);

    const ch = makeClient(env);

    // Фильтр по времени: ts >= now() - INTERVAL N DAY
    const timeFilter = `ts >= now() - INTERVAL ${windowDays} DAY`;

    // 1. Сводные цифры: DAU/WAU, всего запросов, уникальных пользователей
    const sqlSummary = `
      SELECT
        COUNT(*) AS total_events,
        uniqExact(email) AS unique_users,
        uniqExactIf(email, ts >= now() - INTERVAL 1 DAY) AS dau,
        uniqExactIf(email, ts >= now() - INTERVAL 7 DAY) AS wau,
        countIf(startsWith(endpoint, '/api/')) AS api_calls,
        countIf(startsWith(endpoint, '/ui/')) AS ui_clicks,
        countIf(response_status >= 400) AS errors
      FROM chicko.user_activity_log
      WHERE ${timeFilter}
    `;

    // 2. Топ вкладок и UI-событий.
    //
    // С Phase 2.9.3 (трекинг вкладок) события 'tab' пишутся как `/ui/tab/<name>`,
    // где name — menu, overview, staff и т.д. Старые записи (`/ui/tab` без
    // хвоста) приходят из логов до 2.9.3 — их показываем как 'tab (legacy)'
    // для обратной совместимости.
    //
    // Группируем: если endpoint начинается с '/ui/tab/' — имя вкладки = хвост.
    // Остальные /ui/* события (menu_open, menu_class, staff_open, ai_insight,
    // login) группируются по самому endpoint.
    const sqlTopTabs = `
      SELECT
        CASE
          WHEN endpoint = '/ui/tab' THEN '/ui/tab (legacy)'
          WHEN startsWith(endpoint, '/ui/tab/') THEN endpoint
          ELSE endpoint
        END AS tab_action,
        COUNT(*) AS clicks,
        uniqExact(email) AS unique_users
      FROM chicko.user_activity_log
      WHERE ${timeFilter}
        AND startsWith(endpoint, '/ui/')
      GROUP BY tab_action
      ORDER BY clicks DESC
      LIMIT 30
    `;

    // 3. Топ API endpoints (что чаще всего дёргают)
    const sqlTopEndpoints = `
      SELECT
        endpoint,
        method,
        COUNT(*) AS calls,
        uniqExact(email) AS unique_users,
        avg(response_ms) AS avg_ms,
        countIf(response_status >= 400) AS errors
      FROM chicko.user_activity_log
      WHERE ${timeFilter}
        AND startsWith(endpoint, '/api/')
      GROUP BY endpoint, method
      ORDER BY calls DESC
      LIMIT 20
    `;

    // 4. Активность по пользователям
    const sqlByUser = `
      SELECT
        email,
        user_id,
        COUNT(*) AS total_events,
        countIf(startsWith(endpoint, '/api/')) AS api_calls,
        countIf(startsWith(endpoint, '/ui/')) AS ui_clicks,
        MAX(ts) AS last_seen,
        MIN(ts) AS first_seen_in_window,
        uniqExact(toDate(ts)) AS active_days,
        uniqExact(endpoint) AS unique_endpoints,
        uniqExactIf(restaurant_id, restaurant_id IS NOT NULL) AS restaurants_viewed
      FROM chicko.user_activity_log
      WHERE ${timeFilter}
      GROUP BY email, user_id
      ORDER BY total_events DESC
      LIMIT 50
    `;

    // 5. DAU по дням (для графика 14 дней) — даже если window=7, возвращаем 14
    //    чтобы всегда был контекст шире выбранного окна.
    const sqlDailyDau = `
      SELECT
        toDate(ts) AS date,
        uniqExact(email) AS dau,
        COUNT(*) AS events
      FROM chicko.user_activity_log
      WHERE ts >= now() - INTERVAL 14 DAY
      GROUP BY date
      ORDER BY date ASC
    `;

    const [summaryR, tabsR, endpointsR, byUserR, dailyR] = await Promise.all([
      ch.query(sqlSummary),
      ch.query(sqlTopTabs),
      ch.query(sqlTopEndpoints),
      ch.query(sqlByUser),
      ch.query(sqlDailyDau),
    ]);

    // Приводим DateTime к ISO строке и числа к number (CH может вернуть как string)
    const toNum = (v: unknown): number => {
      if (v === null || v === undefined) return 0;
      if (typeof v === 'number') return v;
      const n = Number(v);
      return isFinite(n) ? n : 0;
    };

    const summary = (summaryR.data[0] || {}) as Record<string, unknown>;
    const tabs = (tabsR.data as Array<Record<string, unknown>>).map(r => ({
      tab_action: String(r.tab_action),
      clicks: toNum(r.clicks),
      unique_users: toNum(r.unique_users),
    }));
    const endpoints = (endpointsR.data as Array<Record<string, unknown>>).map(r => ({
      endpoint: String(r.endpoint),
      method: String(r.method),
      calls: toNum(r.calls),
      unique_users: toNum(r.unique_users),
      avg_ms: Math.round(toNum(r.avg_ms)),
      errors: toNum(r.errors),
    }));
    const byUser = (byUserR.data as Array<Record<string, unknown>>).map(r => ({
      email: String(r.email),
      user_id: String(r.user_id),
      total_events: toNum(r.total_events),
      api_calls: toNum(r.api_calls),
      ui_clicks: toNum(r.ui_clicks),
      last_seen: String(r.last_seen),
      first_seen_in_window: String(r.first_seen_in_window),
      active_days: toNum(r.active_days),
      unique_endpoints: toNum(r.unique_endpoints),
      restaurants_viewed: toNum(r.restaurants_viewed),
    }));
    const daily = (dailyR.data as Array<Record<string, unknown>>).map(r => ({
      date: String(r.date),
      dau: toNum(r.dau),
      events: toNum(r.events),
    }));

    return jsonResponse({
      window_days: windowDays,
      summary: {
        total_events: toNum(summary.total_events),
        unique_users: toNum(summary.unique_users),
        dau: toNum(summary.dau),
        wau: toNum(summary.wau),
        api_calls: toNum(summary.api_calls),
        ui_clicks: toNum(summary.ui_clicks),
        errors: toNum(summary.errors),
      },
      top_tabs: tabs,
      top_endpoints: endpoints,
      by_user: byUser,
      daily_dau: daily,
      generated_at: new Date().toISOString(),
      meta: {
        source: 'chicko.user_activity_log',
        admin_email: a.email,
      },
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[admin-activity] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed', detail: err.message }, request, 500);
  }
}
