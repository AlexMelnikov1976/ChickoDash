// Chicko Analytics — Server-side forecast endpoint
// © 2026 System360 by Alex Melnikov. All rights reserved.
// Proprietary software — unauthorized copying or distribution prohibited.
//
// Endpoint: GET /api/forecast?restaurant_id=N  or  GET /api/forecast?network=1
// Returns monthly revenue forecast via Algorithm Г (hybrid):
//   A. current month (≥7 days of data) → current-month DOW medians
//   B. prior year same month (≥7 days) → prior-year DOW × YoY coefficient
//   C. fallback → 90-day DOW profile
//
// Moved from client (dashboard.ts computeForecast) in Phase 2.2 (2026-04-21).
// Rationale: hide the core forecasting algorithm and YoY coefficient formula
// from the browser. Client now receives pre-computed bars and totals only.

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

// Russian month names (full form, nominative case).
const MNAMES_FULL = [
  '', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

// ISO day-of-week: JS getDay() returns 0=Sun..6=Sat.
// We normalize to ClickHouse/ISO: 1=Mon..7=Sun.
function jsToIsoDow(jsDow: number): number {
  return jsDow === 0 ? 7 : jsDow;
}

function medianArr(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

type DailyRow = { date: string; revenue: number };
type DailyBar = { day: number; rev: number; type: 'actual' | 'forecast' };

/**
 * Core Algorithm Г implementation.
 * Pure function — takes already-fetched data, returns forecast object.
 * MaxDate is determined by caller (from the data itself).
 */
function computeForecastCore(
  ts: DailyRow[],
  maxDateStr: string,
  dowFallback: Record<number, number>, // { 1..7 : rev_p50 } for 90-day fallback
): {
  total: number;
  actual: number;
  remaining: number;
  daysElapsed: number;
  daysInMonth: number;
  prevMonthTotal: number;
  yoyK: number;
  method: string;
  dailyBars: DailyBar[];
  monthLabel: string;
  year: number;
  maxDate: string;
} {
  const maxDate = new Date(maxDateStr + 'T00:00:00Z');
  const year = maxDate.getUTCFullYear();
  const month = maxDate.getUTCMonth(); // 0-based
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const monthPrefix = `${year}-${pad2(month + 1)}`;
  const prevMonthPrefix = month === 0
    ? `${year - 1}-12`
    : `${year}-${pad2(month)}`;
  const prevYearMonthPrefix = `${year - 1}-${pad2(month + 1)}`;
  const prevMonthPYPrefix = month === 0
    ? `${year - 2}-12`
    : `${year - 1}-${pad2(month)}`;

  // Current month data
  const curData = ts.filter(t => t.date.startsWith(monthPrefix));
  const actualTotal = curData.reduce((s, t) => s + t.revenue, 0);
  const daysElapsed = curData.length;

  // DOW medians from current month
  const curDowRevs: Record<number, number[]> = {};
  for (const t of curData) {
    const dow = jsToIsoDow(new Date(t.date + 'T00:00:00Z').getUTCDay());
    if (!curDowRevs[dow]) curDowRevs[dow] = [];
    curDowRevs[dow].push(t.revenue);
  }
  const curDowMedians: Record<number, number> = {};
  for (const [dow, vals] of Object.entries(curDowRevs)) {
    curDowMedians[+dow] = medianArr(vals);
  }

  // Previous year same month data → DOW medians
  const prevYearData = ts.filter(t => t.date.startsWith(prevYearMonthPrefix));
  const prevYearDowRevs: Record<number, number[]> = {};
  for (const t of prevYearData) {
    const dow = jsToIsoDow(new Date(t.date + 'T00:00:00Z').getUTCDay());
    if (!prevYearDowRevs[dow]) prevYearDowRevs[dow] = [];
    prevYearDowRevs[dow].push(t.revenue);
  }
  const prevYearDowMedians: Record<number, number> = {};
  for (const [dow, vals] of Object.entries(prevYearDowRevs)) {
    prevYearDowMedians[+dow] = medianArr(vals);
  }

  // YoY coefficient from last complete month
  const prevMonthData = ts.filter(t => t.date.startsWith(prevMonthPrefix));
  const prevMonthPYData = ts.filter(t => t.date.startsWith(prevMonthPYPrefix));
  const prevMonthRev = prevMonthData.reduce((s, t) => s + t.revenue, 0);
  const prevMonthPYRev = prevMonthPYData.reduce((s, t) => s + t.revenue, 0);
  const yoyK = prevMonthPYRev > 0 ? prevMonthRev / prevMonthPYRev : 1;

  // Determine method & build DOW estimates
  let method = '';
  const dowEstimates: Record<number, number> = {};

  if (daysElapsed >= 7) {
    // Variant A: current month
    method = 'медианы текущего месяца';
    Object.assign(dowEstimates, curDowMedians);
  } else if (prevYearData.length >= 7) {
    // Variant B: prior year × k
    method = `по ${year - 1} году (×${yoyK.toFixed(2)})`;
    for (const [dow, med] of Object.entries(prevYearDowMedians)) {
      dowEstimates[+dow] = med * yoyK;
    }
  } else {
    // Variant C: 90-day DOW fallback
    method = 'DOW-профиль 90 дней';
    for (let d = 1; d <= 7; d++) {
      if (dowFallback[d]) dowEstimates[d] = dowFallback[d];
    }
  }

  // Build daily forecast array
  const dailyBars: DailyBar[] = [];
  let forecastRemaining = 0;
  const curDates = new Set(curData.map(t => t.date));
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${pad2(month + 1)}-${pad2(d)}`;
    if (curDates.has(ds)) {
      const actual = curData.find(t => t.date === ds)!;
      dailyBars.push({ day: d, rev: actual.revenue, type: 'actual' });
    } else {
      const dow = jsToIsoDow(new Date(ds + 'T00:00:00Z').getUTCDay());
      const est = dowEstimates[dow] || 0;
      forecastRemaining += est;
      dailyBars.push({ day: d, rev: est, type: 'forecast' });
    }
  }

  const prevMonthTotal = prevMonthData.reduce((s, t) => s + t.revenue, 0);

  return {
    actual: actualTotal,
    remaining: forecastRemaining,
    total: actualTotal + forecastRemaining,
    daysElapsed,
    daysInMonth,
    prevMonthTotal,
    yoyK,
    method,
    dailyBars,
    monthLabel: MNAMES_FULL[month + 1] || '',
    year,
    maxDate: maxDateStr,
  };
}

/**
 * GET /api/forecast?restaurant_id=N  or  GET /api/forecast?network=1
 * Requires Bearer JWT.
 */
export async function handleForecast(request: Request, env: Env): Promise<Response> {
  try {
    // --- Auth ---
    const authHeader = request.headers.get('Authorization');
    const token = extractBearerToken(authHeader);
    if (!token) {
      return jsonResponse({ error: 'Unauthorized', message: 'Missing Authorization header' }, request, 401);
    }

    const payload = await validateToken(
      token,
      requireJwtSecret(env)
    );
    if (!payload) {
      return jsonResponse({ error: 'Unauthorized', message: 'Invalid or expired token' }, request, 401);
    }

    // --- Input ---
    const url = new URL(request.url);
    const restIdStr = url.searchParams.get('restaurant_id');
    const networkStr = url.searchParams.get('network');
    const isNetwork = networkStr === '1' || networkStr === 'true';
    const restId = restIdStr !== null ? parsePositiveIntStrict(restIdStr) : null;

    if (!isNetwork && restId === null) {
      return jsonResponse({ error: 'Either restaurant_id or network=1 required' }, request, 400);
    }

    console.log(`[forecast] user=${payload.user_id} ${isNetwork ? 'network' : 'restaurant_id=' + restId}`);

    const clickhouse = new ClickHouseClient({
      host: env.CLICKHOUSE_HOST || 'http://localhost:8123',
      user: env.CLICKHOUSE_USER || 'default',
      password: env.CLICKHOUSE_PASSWORD || '',
    });

    // --- SQL #1: daily revenue data ---
    // 500-day window covers: current month + previous month + same month last year
    // + previous month last year (for YoY coefficient).
    const whereClause = isNetwork
      ? `WHERE report_date >= today() - 500
           AND report_date <= today()
           AND is_anomaly_day = 0
           AND revenue_total_rub > 0`
      : `WHERE dept_id = ${restId}
           AND report_date >= today() - 500
           AND report_date <= today()
           AND is_anomaly_day = 0
           AND revenue_total_rub > 0`;

    const sqlTs = isNetwork
      ? `SELECT toString(report_date) AS date, SUM(revenue_total_rub) AS revenue
         FROM chicko.mart_restaurant_daily_base
         ${whereClause}
         GROUP BY report_date
         ORDER BY report_date`
      : `SELECT toString(report_date) AS date, revenue_total_rub AS revenue
         FROM chicko.mart_restaurant_daily_base
         ${whereClause}
         ORDER BY report_date`;

    let ts: DailyRow[] = [];
    try {
      const result = await clickhouse.query(sqlTs);
      ts = (result.data as Array<Record<string, unknown>>).map(r => ({
        date: String(r.date),
        revenue: +(r.revenue as number | string),
      }));
    } catch (e) {
      const err = e as Error;
      console.error(`[forecast] ts query failed: ${err.message}`);
      return jsonResponse({ error: 'Data fetch failed' }, request, 500);
    }

    if (!ts.length) {
      return jsonResponse({ error: 'No data available' }, request, 404);
    }

    // Determine MAX_DATE from the data itself
    const maxDateStr = ts[ts.length - 1].date;

    // --- SQL #2: 90-day DOW fallback ---
    // Only needed if variants A and B won't fire, but cheap enough to always run.
    const dowFallbackWhere = isNetwork
      ? `WHERE report_date >= today() - 90
           AND report_date <= today()
           AND is_anomaly_day = 0
           AND revenue_total_rub > 0`
      : `WHERE dept_id = ${restId}
           AND report_date >= today() - 90
           AND report_date <= today()
           AND is_anomaly_day = 0
           AND revenue_total_rub > 0`;

    const sqlDow = isNetwork
      ? `SELECT toDayOfWeek(report_date) AS dow,
                quantile(0.50)(daily_sum) AS rev_p50
         FROM (
           SELECT report_date, SUM(revenue_total_rub) AS daily_sum
           FROM chicko.mart_restaurant_daily_base
           ${dowFallbackWhere}
           GROUP BY report_date
         )
         GROUP BY dow`
      : `SELECT toDayOfWeek(report_date) AS dow,
                quantile(0.50)(revenue_total_rub) AS rev_p50
         FROM chicko.mart_restaurant_daily_base
         ${dowFallbackWhere}
         GROUP BY dow`;

    const dowFallback: Record<number, number> = {};
    try {
      const result = await clickhouse.query(sqlDow);
      for (const r of result.data as Array<Record<string, unknown>>) {
        dowFallback[+(r.dow as number | string)] = +(r.rev_p50 as number | string);
      }
    } catch (e) {
      const err = e as Error;
      console.error(`[forecast] dow fallback query failed: ${err.message}`);
      // Not fatal — fallback just won't be available.
    }

    // --- Compute forecast ---
    const forecast = computeForecastCore(ts, maxDateStr, dowFallback);

    return jsonResponse(forecast, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[forecast] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed' }, request, 500);
  }
}
