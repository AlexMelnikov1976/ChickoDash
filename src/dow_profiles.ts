// Chicko Analytics — Server-side DOW profiles endpoint
// © 2026 System360 by Alex Melnikov. All rights reserved.
// Proprietary software — unauthorized copying or distribution prohibited.
//
// Endpoint: GET /api/dow-profiles?restaurant_id=N
// Returns aggregated 90-day DOW profiles for network and specific restaurant.
// Moved from client (dashboard.ts loadDowProfiles) in Phase 2.1 (2026-04-21).
// Rationale: hide SQL schema, table names, and aggregation logic from the browser.

import { validateToken, extractBearerToken } from './auth';
import { ClickHouseClient } from './clickhouse';
import { corsHeadersFor, requireJwtSecret, parsePositiveIntStrict } from './security';
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

/**
 * GET /api/dow-profiles?restaurant_id=N
 * Requires Bearer JWT.
 *
 * Returns:
 *   {
 *     net: { "1": {rev_p50, rev_p75, chk_p50, chk_p75, cnt_p50, cnt_p75,
 *                  fc_p50, fc_p25, disc_p50, disc_p25, del_p50, del_p75, n}, ..., "7": {...} },
 *     my:  { "1": {rev_p50, chk_p50, cnt_p50, fc_p50, disc_p50, del_p50, n}, ..., "7": {...} },
 *     my_days: number   // total days of history for this restaurant (for >=14 gating)
 *   }
 *
 * Window: last 90 days, excluding anomaly days and zero-revenue days.
 * DOW: 1=Mon .. 7=Sun (ClickHouse toDayOfWeek convention).
 */
export async function handleDowProfiles(request: Request, env: Env): Promise<Response> {
  try {
    // --- Auth ---
    const authHeader = request.headers.get('Authorization');
    const token = extractBearerToken(authHeader);
    if (!token) {
      return jsonResponse({ error: 'Unauthorized', message: 'Missing Authorization header' }, 401, request);
    }

    const payload = await validateToken(
      token,
      requireJwtSecret(env)
    );
    if (!payload) {
      return jsonResponse({ error: 'Unauthorized', message: 'Invalid or expired token' }, 401, request);
    }

    // --- Input ---
    const url = new URL(request.url);
    const restIdStr = url.searchParams.get('restaurant_id');
    const restId = restIdStr !== null ? parsePositiveIntStrict(restIdStr) : null;

    if (restIdStr !== null && restId === null) {
      return jsonResponse({ error: 'Invalid restaurant_id' }, 400, request);
    }

    console.log(`[dow-profiles] user=${payload.user_id} restaurant_id=${restId ?? 'none'}`);

    // --- ClickHouse client ---
    const clickhouse = new ClickHouseClient({
      host: env.CLICKHOUSE_HOST || 'http://localhost:8123',
      user: env.CLICKHOUSE_USER || 'default',
      password: env.CLICKHOUSE_PASSWORD || '',
    });

    // --- SQL #1: network profile (90-day DOW medians & percentiles) ---
    const sqlNet = `
      SELECT
        toDayOfWeek(report_date) AS dow,
        quantile(0.50)(revenue_total_rub)    AS rev_p50,
        quantile(0.75)(revenue_total_rub)    AS rev_p75,
        quantile(0.50)(avg_check_total_rub)  AS chk_p50,
        quantile(0.75)(avg_check_total_rub)  AS chk_p75,
        quantile(0.50)(checks_total)         AS cnt_p50,
        quantile(0.75)(checks_total)         AS cnt_p75,
        quantile(0.50)(foodcost_total_pct)   AS fc_p50,
        quantile(0.25)(foodcost_total_pct)   AS fc_p25,
        quantile(0.50)(discount_total_pct)   AS disc_p50,
        quantile(0.25)(discount_total_pct)   AS disc_p25,
        quantile(0.50)(delivery_share_pct)   AS del_p50,
        quantile(0.75)(delivery_share_pct)   AS del_p75,
        count() AS n
      FROM chicko.mart_restaurant_daily_base
      WHERE report_date >= today() - 90
        AND report_date <= today()
        AND is_anomaly_day = 0
        AND revenue_total_rub > 0
      GROUP BY dow
    `;

    const net: Record<string, unknown> = {};
    try {
      const rows = await clickhouse.query(sqlNet);
      for (const r of rows.data as Array<Record<string, unknown>>) {
        const dow = String(+(r.dow as number | string));
        net[dow] = {
          rev_p50: +(r.rev_p50 as number | string),
          rev_p75: +(r.rev_p75 as number | string),
          chk_p50: +(r.chk_p50 as number | string),
          chk_p75: +(r.chk_p75 as number | string),
          cnt_p50: +(r.cnt_p50 as number | string),
          cnt_p75: +(r.cnt_p75 as number | string),
          fc_p50:  +(r.fc_p50  as number | string),
          fc_p25:  +(r.fc_p25  as number | string),
          disc_p50:+(r.disc_p50 as number | string),
          disc_p25:+(r.disc_p25 as number | string),
          del_p50: +(r.del_p50 as number | string),
          del_p75: +(r.del_p75 as number | string),
          n:       +(r.n       as number | string),
        };
      }
    } catch (e) {
      const err = e as Error;
      console.error(`[dow-profiles] net query failed: ${err.message}`);
      // Return empty net but don't fail the whole request
    }

    // --- SQL #2: restaurant profile (if restaurant_id provided) ---
    const my: Record<string, unknown> = {};
    let myDays = 0;

    if (restId !== null) {
      const sqlMy = `
        SELECT
          toDayOfWeek(report_date) AS dow,
          quantile(0.50)(revenue_total_rub)    AS rev_p50,
          quantile(0.50)(avg_check_total_rub)  AS chk_p50,
          quantile(0.50)(checks_total)         AS cnt_p50,
          quantile(0.50)(foodcost_total_pct)   AS fc_p50,
          quantile(0.50)(discount_total_pct)   AS disc_p50,
          quantile(0.50)(delivery_share_pct)   AS del_p50,
          count() AS n
        FROM chicko.mart_restaurant_daily_base
        WHERE dept_id = ${restId}
          AND report_date >= today() - 90
          AND report_date <= today()
          AND is_anomaly_day = 0
          AND revenue_total_rub > 0
        GROUP BY dow
      `;

      try {
        const rows = await clickhouse.query(sqlMy);
        for (const r of rows.data as Array<Record<string, unknown>>) {
          const dow = String(+(r.dow as number | string));
          const n = +(r.n as number | string);
          my[dow] = {
            rev_p50: +(r.rev_p50 as number | string),
            chk_p50: +(r.chk_p50 as number | string),
            cnt_p50: +(r.cnt_p50 as number | string),
            fc_p50:  +(r.fc_p50  as number | string),
            disc_p50:+(r.disc_p50 as number | string),
            del_p50: +(r.del_p50 as number | string),
            n,
          };
          myDays += n;
        }
      } catch (e) {
        const err = e as Error;
        console.error(`[dow-profiles] my query failed: ${err.message}`);
      }
    }

    return jsonResponse({
      net,
      my,
      my_days: myDays,
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[dow-profiles] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed' }, 500, request);
  }
}
