// Chicko Analytics — Server-side whitelisted data endpoints
// © 2026 System360 by Alex Melnikov. All rights reserved.
// Proprietary software — unauthorized copying or distribution prohibited.
//
// Three endpoints, all require Bearer JWT:
//
//   GET /api/restaurants?full_history=0|1
//     List of restaurants with time-series data.
//     full_history=0 (default): last 90 days
//     full_history=1: since 2024-01-01
//
//   GET /api/benchmarks?start=YYYY-MM-DD&end=YYYY-MM-DD
//     Network median (NET) and top-10% (TOP10) benchmarks for the period.
//
//   GET /api/restaurant-meta?restaurant_id=N
//     Precomputed score + top recommendations for a specific restaurant.
//
// Moved from client in Phase 2.3 (2026-04-21).
// Rationale: replace the universal /api/query SQL proxy with whitelisted endpoints.
// Client can no longer execute arbitrary SQL against ClickHouse.

import { validateToken, extractBearerToken } from './auth';
import { ClickHouseClient } from './clickhouse';
import {
  corsHeadersFor,
  requireJwtSecret,
  parsePositiveIntStrict,
  parseIsoDate,
  daysBetween,
  MAX_DATE_RANGE_DAYS,
  rateLimitOrResponse,
  RATE_LIMIT_DATA,
} from './security';
import type { Env } from './index';

function jsonResponse(body: unknown, request: Request, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeadersFor(request),
    },
  });
}

async function auth(request: Request, env: Env): Promise<{ user_id: string; email: string } | Response> {
  const authHeader = request.headers.get('Authorization');
  const token = extractBearerToken(authHeader);
  if (!token) return jsonResponse({ error: 'Unauthorized', message: 'Missing Authorization header' }, request, 401);

  const payload = await validateToken(
    token,
    requireJwtSecret(env)
  );
  if (!payload) return jsonResponse({ error: 'Unauthorized', message: 'Invalid or expired token' }, request, 401);

  return payload as { user_id: string; email: string };
}

function mkClickhouse(env: Env): ClickHouseClient {
  return new ClickHouseClient({
    host: env.CLICKHOUSE_HOST || 'http://localhost:8123',
    user: env.CLICKHOUSE_USER || 'default',
    password: env.CLICKHOUSE_PASSWORD || '',
  });
}

// Date validation moved to security.ts (parseIsoDate, daysBetween).
// Old local isValidDate was a regex-only check; new helper does regex +
// real-date validation + round-trip check.

/**
 * GET /api/restaurants?full_history=0|1
 *
 * Returns:
 *   { data: [ {dept_id, restaurant_name, city, report_date_str, revenue_total_rub, ...}, ... ] }
 *
 * Same shape as the old /api/query response for loadFullHistory so the client
 * layer can be replaced without restructuring RESTS/ts handling.
 */
export async function handleRestaurantsList(request: Request, env: Env): Promise<Response> {
  try {
    const a = await auth(request, env);
    if (a instanceof Response) return a;

    const rl = await rateLimitOrResponse(env.MAGIC_LINKS, `data:${a.user_id}`, RATE_LIMIT_DATA, request);
    if (rl) return rl;

    const url = new URL(request.url);
    const fullHistory = url.searchParams.get('full_history') === '1';

    console.log(`[restaurants] user=${a.user_id} full_history=${fullHistory}`);

    const whereDate = fullHistory
      ? `report_date >= '2024-01-01'`
      : `report_date >= today() - 90`;

    const sql = `
      SELECT
        dept_id,
        restaurant_name,
        city,
        toString(report_date) AS report_date_str,
        revenue_total_rub,
        revenue_bar_rub,
        revenue_kitchen_rub,
        revenue_delivery_rub,
        avg_check_total_rub,
        checks_total,
        foodcost_total_pct,
        discount_total_pct,
        delivery_share_pct,
        is_anomaly_day
      FROM chicko.mart_restaurant_daily_base
      WHERE ${whereDate}
        AND revenue_total_rub > 0
      ORDER BY restaurant_name, report_date
    `;

    const clickhouse = mkClickhouse(env);
    const result = await clickhouse.query(sql);

    return jsonResponse({
      data: result.data,
      rows: result.rows,
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[restaurants] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed' }, request, 500);
  }
}

/**
 * GET /api/benchmarks?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Returns NET (median) and TOP10 (p90 for "more-is-better", p25 for "less-is-better")
 * benchmarks across the network for the given date range.
 *
 * Returns:
 *   {
 *     net:   { revenue, avgCheck, checks, foodcost, discount, deliveryPct, restCount },
 *     top10: { revenue, avgCheck, foodcost, discount, deliveryPct },
 *     rest_count: number,
 *     insufficient_data: bool   // true if <3 restaurants in window
 *   }
 */
export async function handleBenchmarks(request: Request, env: Env): Promise<Response> {
  try {
    const a = await auth(request, env);
    if (a instanceof Response) return a;

    const rl = await rateLimitOrResponse(env.MAGIC_LINKS, `data:${a.user_id}`, RATE_LIMIT_DATA, request);
    if (rl) return rl;

    const url = new URL(request.url);
    const startRaw = url.searchParams.get('start');
    const endRaw = url.searchParams.get('end');

    // Canonical date validation: regex + real-date check + round-trip via Date.
    // Защищает от 2026-99-99 (regex пройдёт, но дата невалидна).
    const start = parseIsoDate(startRaw);
    const end = parseIsoDate(endRaw);
    if (!start || !end) {
      return jsonResponse({ error: 'Invalid start/end date (expected YYYY-MM-DD)' }, request, 400);
    }

    // Защита от перевёрнутого диапазона.
    if (start > end) {
      return jsonResponse({ error: 'start must be <= end' }, request, 400);
    }

    // Защита от чрезмерно широких диапазонов, перегружающих ClickHouse.
    const span = daysBetween(start, end);
    if (span > MAX_DATE_RANGE_DAYS) {
      return jsonResponse({ error: `Date range too wide (max ${MAX_DATE_RANGE_DAYS} days, got ${span})` }, request, 400);
    }

    console.log(`[benchmarks] user=${a.user_id} ${start}..${end} span=${span}d`);

    const sql = `
      SELECT
        quantile(0.50)(revenue_total_rub)      AS rev_median,
        quantile(0.90)(revenue_total_rub)      AS rev_p90,
        quantile(0.50)(avg_check_total_rub)    AS chk_median,
        quantile(0.90)(avg_check_total_rub)    AS chk_p90,
        quantile(0.50)(checks_total)           AS cnt_median,
        quantile(0.50)(foodcost_total_pct)     AS fc_median,
        quantile(0.25)(foodcost_total_pct)     AS fc_p25,
        quantile(0.50)(discount_total_pct)     AS disc_median,
        quantile(0.25)(discount_total_pct)     AS disc_p25,
        quantile(0.50)(delivery_share_pct)     AS del_median,
        quantile(0.90)(delivery_share_pct)     AS del_p90,
        count(DISTINCT dept_uuid)              AS rest_count
      FROM chicko.mart_restaurant_daily_base
      WHERE report_date BETWEEN '${start}' AND '${end}'
        AND is_anomaly_day = 0
        AND revenue_total_rub > 0
    `;

    const clickhouse = mkClickhouse(env);
    const result = await clickhouse.query(sql);
    const rows = result.data as Array<Record<string, unknown>>;

    if (!rows.length) {
      return jsonResponse({
        net: null,
        top10: null,
        rest_count: 0,
        insufficient_data: true,
      }, request);
    }

    const b = rows[0];
    const restCount = +(b.rest_count as number | string) || 0;

    // Fallback: <3 restaurants → data unreliable
    if (restCount < 3) {
      return jsonResponse({
        net: { restCount },
        top10: null,
        rest_count: restCount,
        insufficient_data: true,
      }, request);
    }

    return jsonResponse({
      net: {
        revenue:     Math.round(+(b.rev_median as number | string)),
        avgCheck:    Math.round(+(b.chk_median as number | string)),
        checks:      Math.round(+(b.cnt_median as number | string)),
        foodcost:    +(+(b.fc_median as number | string)).toFixed(1),
        discount:    +(+(b.disc_median as number | string)).toFixed(1),
        deliveryPct: +(+(b.del_median as number | string)).toFixed(1),
        restCount,
      },
      top10: {
        revenue:     Math.round(+(b.rev_p90 as number | string)),
        avgCheck:    Math.round(+(b.chk_p90 as number | string)),
        foodcost:    +(+(b.fc_p25 as number | string)).toFixed(1),
        discount:    +(+(b.disc_p25 as number | string)).toFixed(1),
        deliveryPct: +(+(b.del_p90 as number | string)).toFixed(1),
      },
      rest_count: restCount,
      insufficient_data: false,
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[benchmarks] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed' }, request, 500);
  }
}

/**
 * GET /api/restaurant-meta?restaurant_id=N
 *
 * Returns precomputed score (latest 7d window) + top-3 recommendations
 * for the given restaurant. Used by selectRest to populate score and insights panels.
 *
 * Returns:
 *   {
 *     score: { score_total, risk_level, rank_network, ... } | null,
 *     recommendations: [ { title, description, estimated_effect_rub, ... }, ... ]
 *   }
 */
export async function handleRestaurantMeta(request: Request, env: Env): Promise<Response> {
  try {
    const a = await auth(request, env);
    if (a instanceof Response) return a;

    const rl = await rateLimitOrResponse(env.MAGIC_LINKS, `data:${a.user_id}`, RATE_LIMIT_DATA, request);
    if (rl) return rl;

    const url = new URL(request.url);
    const restIdStr = url.searchParams.get('restaurant_id');
    const restId = restIdStr !== null ? parsePositiveIntStrict(restIdStr) : null;

    if (restId === null) {
      return jsonResponse({ error: 'Invalid restaurant_id' }, request, 400);
    }

    console.log(`[restaurant-meta] user=${a.user_id} restaurant_id=${restId}`);

    const clickhouse = mkClickhouse(env);

    const sqlScore = `
      SELECT score_total, risk_level, rank_network, restaurants_in_rank,
             score_revenue, score_traffic, score_avg_check,
             score_foodcost, score_discount, score_delivery, score_margin
      FROM chicko.mart_restaurant_scores
      WHERE restaurant_id = ${restId} AND score_window = '7d'
      ORDER BY dt DESC
      LIMIT 1
    `;

    const sqlRecs = `
      SELECT recommendation_code, title, description, estimated_effect_rub,
             confidence, impact_type, category
      FROM chicko.mart_recommendations
      WHERE restaurant_id = ${restId}
        AND dt = (SELECT max(dt) FROM chicko.mart_recommendations WHERE restaurant_id = ${restId})
      ORDER BY priority_score DESC
      LIMIT 3
    `;

    // Run both queries in parallel
    const [scoreResult, recsResult] = await Promise.all([
      clickhouse.query(sqlScore).catch(e => {
        console.error(`[restaurant-meta] score query failed: ${(e as Error).message}`);
        return { data: [], rows: 0 };
      }),
      clickhouse.query(sqlRecs).catch(e => {
        console.error(`[restaurant-meta] recs query failed: ${(e as Error).message}`);
        return { data: [], rows: 0 };
      }),
    ]);

    const scoreRows = scoreResult.data as Array<Record<string, unknown>>;
    const recsRows = recsResult.data as Array<Record<string, unknown>>;

    return jsonResponse({
      score: scoreRows.length ? scoreRows[0] : null,
      recommendations: recsRows,
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[restaurant-meta] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed' }, request, 500);
  }
}
