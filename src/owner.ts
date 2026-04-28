// Chicko Analytics — Owner P&L endpoints
// © 2026 System360 by Alex Melnikov. All rights reserved.
//
// Owner-only раздел: дашборд P&L Калининграда (dept_id=101) с план/факт/прогноз,
// сценарными слайдерами и редактируемыми постоянными затратами.
//
// Доступ: пользователи с is_owner=true в KV USERS (`user:<email>`).
// Сейчас задано для melnikov181076@gmail.com. Прочие 27 юзеров получают 403.
//
//   GET  /api/owner/me      — {is_owner: bool, email}
//   GET  /api/owner/history — daily revenue/checks/foodcost для Калининграда
//   GET  /api/owner/costs   — постоянные затраты (rent/utilities/staff/mgmt/...)
//   POST /api/owner/costs   — сохранить постоянные затраты в KV
//
// Изоляция: новый файл, ничего не правит в других разделах дашборда.

import {
  authFromCookie,
  corsHeadersFor,
  rateLimitOrResponse,
  RATE_LIMIT_DATA,
  checkOrigin,
} from './security';
import { ClickHouseClient } from './clickhouse';
import type { Env } from './index';

// dept_id ресторана в Калининграде. Зашит явно — owner-раздел работает только
// для одного юр-лица. Если когда-нибудь у владельца появится второй ресторан,
// добавим параметр.
const KALININGRAD_DEPT_ID = 101;

// Дефолты постоянных затрат — берутся из УпрЧико на момент запуска раздела.
// Пользователь может их перезаписать через POST /api/owner/costs.
const DEFAULT_COSTS = {
  rent: 200000,
  utilities: 50000,
  staffFixed: 250000,
  mgmtFixed: 120000,
  salaryTax: 16,
  foodcost: 32,
  franchise: 4,
  writeoff: 1.5,
  hozy: 1,
  acquiring: 1.5,
  deliveryShare: 15,
  deliveryCost: 33,
};

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
 * Проверка прав владельца — флаг `is_owner` в KV USERS.
 * Зеркало isAdmin() из admin.ts, но по другому полю.
 */
async function isOwner(kv: KVNamespace, email: string): Promise<boolean> {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    const raw = await kv.get(`user:${normalizedEmail}`);
    if (!raw) return false;
    const data = JSON.parse(raw) as { user_id?: string; is_owner?: boolean };
    return data.is_owner === true;
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// GET /api/owner/me — лёгкий probe для фронта (200 всегда)
// -----------------------------------------------------------------------------
export async function handleOwnerMe(request: Request, env: Env): Promise<Response> {
  try {
    const a = await authFromCookie(request, env);
    if (a instanceof Response) return a;
    const owner = await isOwner(env.USERS, a.email);
    return jsonResponse({ is_owner: owner, email: a.email }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[owner-me] error: ${err.message}`);
    return jsonResponse({ error: 'Request failed' }, request, 500);
  }
}

// -----------------------------------------------------------------------------
// GET /api/owner/history
// -----------------------------------------------------------------------------
// Daily history по Калининграду: дата, revenue, checks, avgCheck, foodcost%, disc%.
// Источник: chicko.mart_restaurant_daily_base, dept_id=101, revenue>0.
// Окно: с 2024-05-01 (старт текущей серии данных) по сегодня.
export async function handleOwnerHistory(request: Request, env: Env): Promise<Response> {
  try {
    const a = await authFromCookie(request, env);
    if (a instanceof Response) return a;

    const rl = await rateLimitOrResponse(env.MAGIC_LINKS, `data:${a.user_id}`, RATE_LIMIT_DATA, request);
    if (rl) return rl;

    const owner = await isOwner(env.USERS, a.email);
    if (!owner) {
      console.warn(`[owner-history] 403 for ${a.email}`);
      return jsonResponse({ error: 'Forbidden', message: 'Owner access required' }, request, 403);
    }

    const ch = makeClient(env);

    // Сначала резолвим фактический dept_id Калининграда из CH (не хардкодим 101,
    // т.к. в prod-таблице dept_id может отличаться от синтетических данных).
    // Фолбэк: KALININGRAD_DEPT_ID=101 если ресторан не найден по city.
    let resolvedDeptId: number = KALININGRAD_DEPT_ID;
    try {
      const lookupSql = `
        SELECT DISTINCT dept_id
        FROM chicko.mart_restaurant_daily_base
        WHERE LOWER(city) = 'калининград'
        LIMIT 1
        SETTINGS max_execution_time=10
      `;
      const lookup = await ch.query(lookupSql);
      const rows = lookup.data as Array<Record<string, unknown>>;
      if (rows.length > 0 && rows[0].dept_id != null) {
        resolvedDeptId = Number(rows[0].dept_id);
      }
    } catch (lookupErr) {
      console.warn('[owner-history] city lookup failed, using fallback dept_id=101:', (lookupErr as Error).message);
    }

    const sql = `
      SELECT
        toString(report_date)              AS date,
        toFloat64(revenue_total_rub)       AS revenue,
        toFloat64(revenue_delivery_rub)    AS revenueDelivery,
        toFloat64(avg_check_total_rub)     AS avgCheck,
        toFloat64(checks_total)            AS checks,
        toFloat64(foodcost_total_pct)      AS foodcostPct,
        toFloat64(discount_total_pct)      AS discPct,
        toFloat64(delivery_share_pct)      AS deliverySharePct
      FROM chicko.mart_restaurant_daily_base
      WHERE dept_id = ${resolvedDeptId}
        AND report_date >= '2024-05-01'
        AND revenue_total_rub > 0
      ORDER BY report_date ASC
      SETTINGS max_execution_time=30
    `;

    const result = await ch.query(sql);
    const rows = result.data as Array<Record<string, unknown>>;

    const toNum = (v: unknown): number => {
      if (v === null || v === undefined) return 0;
      const n = typeof v === 'number' ? v : Number(v);
      return isFinite(n) ? n : 0;
    };

    const data = rows.map(r => {
      const date = String(r.date);
      const dow = new Date(date).getDay();
      return {
        date,
        revenue: Math.round(toNum(r.revenue)),
        revenueDelivery: Math.round(toNum(r.revenueDelivery)),
        checks: Math.round(toNum(r.checks)),
        avgCheck: Math.round(toNum(r.avgCheck)),
        foodcostPct: +toNum(r.foodcostPct).toFixed(1),
        discPct: +toNum(r.discPct).toFixed(1),
        deliverySharePct: +toNum(r.deliverySharePct).toFixed(1),
        isWe: dow === 0 || dow === 6,
      };
    });

    return jsonResponse({
      dept_id: resolvedDeptId,
      city: 'Калининград',
      rows: data.length,
      data,
      generated_at: new Date().toISOString(),
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[owner-history] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed', detail: err.message }, request, 500);
  }
}

// -----------------------------------------------------------------------------
// GET /api/owner/costs — текущие постоянные/нормативы (KV или дефолты)
// POST /api/owner/costs — сохранить пользовательские значения
// -----------------------------------------------------------------------------
const COSTS_KV_KEY = (email: string) => `owner:costs:${email.trim().toLowerCase()}`;

function sanitizeCosts(input: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = { ...DEFAULT_COSTS };
  for (const k of Object.keys(DEFAULT_COSTS)) {
    if (k in input) {
      const v = Number(input[k]);
      if (isFinite(v) && v >= 0 && v < 1e9) out[k] = v;
    }
  }
  return out;
}

export async function handleOwnerCostsGet(request: Request, env: Env): Promise<Response> {
  try {
    const a = await authFromCookie(request, env);
    if (a instanceof Response) return a;

    const owner = await isOwner(env.USERS, a.email);
    if (!owner) return jsonResponse({ error: 'Forbidden' }, request, 403);

    const raw = await env.USERS.get(COSTS_KV_KEY(a.email));
    let costs: Record<string, number> = { ...DEFAULT_COSTS };
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        costs = sanitizeCosts(parsed);
      } catch {
        // битый JSON в KV — отдаём дефолты, пишем варн
        console.warn(`[owner-costs] corrupt KV for ${a.email}, using defaults`);
      }
    }
    return jsonResponse({ costs, defaults: DEFAULT_COSTS }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[owner-costs-get] error: ${err.message}`);
    return jsonResponse({ error: 'Request failed' }, request, 500);
  }
}

export async function handleOwnerCostsPost(request: Request, env: Env): Promise<Response> {
  try {
    const originError = checkOrigin(request);
    if (originError) return originError;

    const a = await authFromCookie(request, env);
    if (a instanceof Response) return a;

    const owner = await isOwner(env.USERS, a.email);
    if (!owner) return jsonResponse({ error: 'Forbidden' }, request, 403);

    const body = await request.json() as Record<string, unknown>;
    const costs = sanitizeCosts(body || {});
    await env.USERS.put(COSTS_KV_KEY(a.email), JSON.stringify(costs));

    console.log(`[owner-costs-post] ${a.email} saved costs`);
    return jsonResponse({ success: true, costs }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[owner-costs-post] error: ${err.message}`);
    return jsonResponse({ error: 'Request failed' }, request, 500);
  }
}
