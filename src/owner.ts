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
const KALININGRAD_DEPT_ID = 42;

// Фиксированная ЗП управляющего — из УпрЧико (оклад + управленческий фикс).
// Не зависит от выручки, начисляется каждый месяц.
const MGT_SALARY = 657500;

// Google Sheets УпрЧико — Лист1, публичный доступ (только просмотр).
// Читается через Visualization API, кэшируется в KV на 1 час.
const SHEETS_SPREADSHEET_ID = '1nqpQ97D9rS2hPVQrrlbPKO5QG5RXvc936xvw6TSHnXc';
const SHEETS_CACHE_KEY = 'owner:sheets:defaults';
const SHEETS_CACHE_TTL = 3600; // секунды

// Хардкоженные дефолты — используются только при недоступности Google Sheets.
const HARDCODED_DEFAULTS: Record<string, number> = {
  rent:         690000,   // Аренда (фикс)
  fixed:        1250000,  // Постоянные затраты итого
  mgtSalary:    MGT_SALARY,
  salaryTax:    16,       // Налог с ФОТ %
  foodcost:     22.5,     // Фудкост %
  franchise:    5.0,      // Франшиза %
  writeoff:     2.3,      // Списание %
  hozy:         4.0,      // Хозрасходы %
  acquiring:    0.7,      // Эквайринг %
  bankFee:      0.3,      // Комиссия банка %
  deliveryCost: 31.44,    // Доставка % от выручки доставки
  usn:          15,       // УСН % (в таблице пусто — оставляем дефолт)
};

// Маппинг: название строки в Лист1 → поле в HARDCODED_DEFAULTS + колонка (D=Сумма, E=%)
const SHEETS_FIELD_MAP: Record<string, { field: string; col: 'D' | 'E' }> = {
  'Аренда':           { field: 'rent',         col: 'D' },
  'Процент списания': { field: 'writeoff',      col: 'E' },
  'Процент хозы':     { field: 'hozy',          col: 'E' },
  'Процент доставка': { field: 'deliveryCost',  col: 'E' },
  'Фудкост':          { field: 'foodcost',      col: 'E' },
  'Франшиза':         { field: 'franchise',     col: 'E' },
  'Эквайринг':        { field: 'acquiring',     col: 'E' },
  'Комиссия банка':   { field: 'bankFee',       col: 'E' },
  'ЗП упр':           { field: 'mgtSalary',     col: 'D' },
  'Налоги ЗП':        { field: 'salaryTax',     col: 'E' },
  'Постоянные':       { field: 'fixed',         col: 'D' },
  'УСН':              { field: 'usn',           col: 'E' },
};

function parseRuNumber(s: string): number | null {
  if (!s) return null;
  const clean = s.replace('%', '').replace(',', '.').trim();
  const n = parseFloat(clean);
  return isFinite(n) ? n : null;
}

async function fetchSheetsDefaults(kv: KVNamespace): Promise<Record<string, number>> {
  // Сначала пробуем KV-кэш
  try {
    const cached = await kv.get(SHEETS_CACHE_KEY);
    if (cached) return JSON.parse(cached) as Record<string, number>;
  } catch { /* битый кэш — идём в Sheets */ }

  // Читаем CSV через gviz (cols A=название, D=Сумма, E=%)
  const url = `https://docs.google.com/spreadsheets/d/${SHEETS_SPREADSHEET_ID}/gviz/tq?tq=select+A,D,E+limit+14&gid=0&tqx=out:csv`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Sheets HTTP ${resp.status}`);
  const csv = await resp.text();

  const result: Record<string, number> = { ...HARDCODED_DEFAULTS };
  const lines = csv.trim().split('\n').slice(1); // пропускаем заголовок

  for (const line of lines) {
    const cols = [...line.matchAll(/"([^"]*)"/g)].map(m => m[1]);
    if (cols.length < 3) continue;
    const [rowName, dVal, eVal] = cols;
    const trimmed = rowName.trim();
    const entry = Object.entries(SHEETS_FIELD_MAP).find(([k]) => trimmed.startsWith(k));
    if (!entry) continue;
    const { field, col } = entry[1];
    const n = parseRuNumber(col === 'D' ? dVal : eVal);
    if (n !== null) result[field] = n;
  }

  await kv.put(SHEETS_CACHE_KEY, JSON.stringify(result), { expirationTtl: SHEETS_CACHE_TTL });
  return result;
}

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

    const sqlDaily = `
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
      WHERE dept_id = ${KALININGRAD_DEPT_ID}
        AND report_date >= '2024-05-01'
        AND revenue_total_rub > 0
      ORDER BY report_date ASC
      SETTINGS max_execution_time=30
    `;

    // Месячный ФОТ персонала из ЧикоВремя (db1 — однорестораные таблицы Калининград).
    const sqlFot = `
      SELECT
        toString(toStartOfMonth(toDate(\`Дата\`))) AS month,
        SUM(toFloat64(\`Начислено\`))              AS fotPersonnel
      FROM db1.\`ЧикоВремя\`
      WHERE toDate(\`Дата\`) >= '2024-05-01'
        AND \`Имя\` IS NOT NULL AND \`Имя\` != ''
        AND \`Имя\` NOT LIKE '%iiko%'
      GROUP BY month
      ORDER BY month ASC
      SETTINGS max_execution_time=30
    `;

    // Месячные агрегаты по выручке и фудкосту из mart.
    const sqlMonthly = `
      SELECT
        toString(toStartOfMonth(report_date)) AS month,
        SUM(toFloat64(revenue_total_rub))     AS revenue,
        avgWeighted(
          toFloat64(foodcost_total_pct),
          toFloat64(revenue_total_rub)
        )                                     AS foodcostPct,
        SUM(toFloat64(revenue_delivery_rub))  AS revenueDelivery
      FROM chicko.mart_restaurant_daily_base
      WHERE dept_id = ${KALININGRAD_DEPT_ID}
        AND report_date >= '2024-05-01'
        AND revenue_total_rub > 0
      GROUP BY month
      ORDER BY month ASC
      SETTINGS max_execution_time=30
    `;

    const [dailyResult, fotResult, monthlyResult] = await Promise.all([
      ch.query(sqlDaily),
      ch.query(sqlFot).catch(() => ({ data: [] })),
      ch.query(sqlMonthly),
    ]);

    const rows = dailyResult.data as Array<Record<string, unknown>>;

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

    // Объединяем monthly mart + ФОТ по ключу month.
    const fotByMonth: Record<string, number> = {};
    (fotResult.data as Array<Record<string, unknown>>).forEach(r => {
      fotByMonth[String(r.month)] = Math.round(toNum(r.fotPersonnel));
    });

    const monthly = (monthlyResult.data as Array<Record<string, unknown>>).map(r => {
      const month = String(r.month);
      const revenue = Math.round(toNum(r.revenue));
      const fotPersonnel = fotByMonth[month] ?? 0;
      const fotTotal = fotPersonnel + MGT_SALARY;
      const fotPct = revenue > 0 ? +(fotTotal / revenue * 100).toFixed(1) : 0;
      return {
        month,
        revenue,
        revenueDelivery: Math.round(toNum(r.revenueDelivery)),
        foodcostPct: +toNum(r.foodcostPct).toFixed(1),
        fotPersonnel,
        fotTotal,
        fotPct,
      };
    });

    // sliderDefaults — последний полный месяц для инициализации слайдеров.
    // "Полный" = не текущий месяц (данные могут быть частичными).
    const today = new Date();
    const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    const completedMonths = monthly.filter(m => m.month < currentMonth && m.revenue > 0);
    const lastComplete = completedMonths.length > 0 ? completedMonths[completedMonths.length - 1] : null;

    const sliderDefaults = lastComplete
      ? { foodcostPct: lastComplete.foodcostPct, fotPct: lastComplete.fotPct, month: lastComplete.month }
      : { foodcostPct: HARDCODED_DEFAULTS.foodcost, fotPct: 18, month: null };

    return jsonResponse({
      dept_id: KALININGRAD_DEPT_ID,
      city: 'Калининград',
      rows: data.length,
      data,
      monthly,
      sliderDefaults,
      mgtSalary: MGT_SALARY,
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

function sanitizeCosts(input: Record<string, unknown>, defaults: Record<string, number> = HARDCODED_DEFAULTS): Record<string, number> {
  const out: Record<string, number> = { ...defaults };
  for (const k of Object.keys(defaults)) {
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

    // Нормативы из Google Sheets (кэш 1ч), fallback на хардкод
    let sheetDefaults: Record<string, number>;
    try {
      sheetDefaults = await fetchSheetsDefaults(env.USERS);
    } catch (e) {
      console.warn('[owner-costs] sheets unavailable, using hardcoded:', (e as Error).message);
      sheetDefaults = { ...HARDCODED_DEFAULTS };
    }

    const raw = await env.USERS.get(COSTS_KV_KEY(a.email));
    let costs: Record<string, number> = { ...sheetDefaults };
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        costs = sanitizeCosts(parsed, sheetDefaults);
      } catch {
        console.warn(`[owner-costs] corrupt KV for ${a.email}, using sheet defaults`);
      }
    }
    return jsonResponse({ costs, defaults: sheetDefaults }, request);
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
