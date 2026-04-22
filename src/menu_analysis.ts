// Chicko Analytics — Menu Analysis endpoint (Phase 2.7.3)
// © 2026 System360 by Alex Melnikov. All rights reserved.
//
// GET /api/menu-analysis?restaurant_id=N&start=YYYY-MM-DD&end=YYYY-MM-DD
//   &include_dormant=0|1   (default 1)
//   &include_event=0|1     (default 1)
//   &include_too_small=0|1 (default 1)
//
// Kasavana-Smith menu engineering matrix v4.
//
// 8 возможных классов, проверяются в порядке приоритета:
//   1. event     — dish_category начинается с 'ивент' (временные промо-меню)
//   2. dormant   — не продавалось 14+ дней на конец периода
//   3. new       — появилось в данных < 30 дней назад от конца периода
//   4. too_small — в dish_group < 3 KS-кандидатов (KS вырождается)
//   5-8. star / plowhorse / puzzle / dog — классическая матрица KS внутри dish_group
//
// Для dormant вычисляется dormant_reason:
//   - 'replaced'  — в той же dish_group есть блюдо, first_sold_at которого
//                   >= last_sold_at этого (т.е. оно появилось как замена)
//   - 'seasonal'  — этот же dish_code имел продажи в ±30 дней календарного
//                   окна год назад в этом ресторане
//   - 'retired'   — иначе (просто сняли с меню)
//
// Блюда из dish_group = 'Архив' исключаются на SQL-уровне.
//
// Возвращает в каждом блюде:
//   - метрики периода (qty, revenue, margin и производные)
//   - ks_class + dormant_reason (если dormant) + три рейтинга
//   - first_sold_at, last_sold_at, days_in_menu, days_since_last_sale
//   - network: сетевая медиана margin_per_unit и menu_mix_pct по dish_code

import { ClickHouseClient } from './clickhouse';
import {
  authFromCookie,
  corsHeadersFor,
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
    headers: { 'Content-Type': 'application/json', ...corsHeadersFor(request) },
  });
}

// --- Пороги классификации ---
const NEW_THRESHOLD_DAYS = 30;
const DORMANT_THRESHOLD_DAYS = 14;
const EVENT_CATEGORY_PREFIX = 'ивент';
const SEASONAL_WINDOW_DAYS = 30;  // ±30 дней от календарного окна год назад

interface DishRow {
  dish_code: string;
  dish_name: string;
  dish_category: string;
  dish_group: string;
  total_qty: number;
  total_revenue: number;
  total_foodcost: number;
  total_margin: number;
  margin_per_unit: number;
  avg_price: number;
  avg_foodcost_pct: number;
  first_sold_at: string;
  last_sold_at: string;
  days_in_menu: number;
  days_since_last_sale: number;
}

type KSClass =
  | 'star'
  | 'plowhorse'
  | 'puzzle'
  | 'dog'
  | 'too_small'
  | 'event'
  | 'dormant'
  | 'new';

type DormantReason = 'replaced' | 'seasonal' | 'retired';

interface NetworkBenchmark {
  margin_p50_net: number;
  mix_pct_p50_net: number;
  n_rests: number;
}

interface ClassifiedDish extends DishRow {
  menu_mix_pct: number;
  menu_mix_pct_group: number;
  ks_class: KSClass;
  dormant_reason: DormantReason | null;  // null если ks_class != 'dormant'
  rank: number;
  rank_in_class: number;
  rank_in_group: number;
  network: NetworkBenchmark | null;
}

function classifyKS(
  dishes: DishRow[],
  seasonalCodes: Set<string>,
): ClassifiedDish[] {
  const n = dishes.length;
  if (n === 0) return [];

  const totalQty = dishes.reduce((s, d) => s + d.total_qty, 0);
  if (totalQty === 0) return [];

  const fixed: Array<{ dish: DishRow; ksClass: KSClass }> = [];
  const ksCandidates: DishRow[] = [];

  for (const d of dishes) {
    const category = (d.dish_category || '').toLowerCase();
    if (category.startsWith(EVENT_CATEGORY_PREFIX)) {
      fixed.push({ dish: d, ksClass: 'event' });
    } else if (d.days_since_last_sale > DORMANT_THRESHOLD_DAYS) {
      fixed.push({ dish: d, ksClass: 'dormant' });
    } else if (d.days_in_menu < NEW_THRESHOLD_DAYS) {
      fixed.push({ dish: d, ksClass: 'new' });
    } else {
      ksCandidates.push(d);
    }
  }

  // Групповые агрегаты по всей группе (для menu_mix_pct_group в ответе)
  const groupTotals = new Map<string, { totalQty: number; dishes: DishRow[] }>();
  for (const d of dishes) {
    const key = d.dish_group || '(без группы)';
    const g = groupTotals.get(key) || { totalQty: 0, dishes: [] };
    g.totalQty += d.total_qty;
    g.dishes.push(d);
    groupTotals.set(key, g);
  }

  // Групповые агрегаты только по KS-кандидатам (для порогов KS)
  const ksGroupTotals = new Map<string, { totalQty: number; totalMargin: number; n: number }>();
  for (const d of ksCandidates) {
    const key = d.dish_group || '(без группы)';
    const g = ksGroupTotals.get(key) || { totalQty: 0, totalMargin: 0, n: 0 };
    g.totalQty += d.total_qty;
    g.totalMargin += d.total_margin;
    g.n++;
    ksGroupTotals.set(key, g);
  }

  /**
   * Определение dormant_reason для блюда.
   * 1. replaced — в той же dish_group есть другое блюдо,
   *    first_sold_at которого >= last_sold_at этого (появилось как замена).
   * 2. seasonal — dish_code был в seasonalCodes (есть продажи в прошлом году
   *    в ±30 дней от календарного окна).
   * 3. retired — иначе.
   */
  function dormantReasonFor(d: DishRow): DormantReason {
    const groupKey = d.dish_group || '(без группы)';
    const group = groupTotals.get(groupKey);
    if (group) {
      for (const other of group.dishes) {
        if (other.dish_code === d.dish_code) continue;
        // Замена — другое блюдо в группе появилось ПОСЛЕ того, как это перестало
        if (other.first_sold_at >= d.last_sold_at) {
          return 'replaced';
        }
      }
    }
    if (seasonalCodes.has(d.dish_code)) {
      return 'seasonal';
    }
    return 'retired';
  }

  const result: ClassifiedDish[] = [];

  // Fixed-классы (event/dormant/new)
  for (const { dish, ksClass } of fixed) {
    const groupKey = dish.dish_group || '(без группы)';
    const gt = groupTotals.get(groupKey)!;
    const menuMixPct = (dish.total_qty / totalQty) * 100;
    const menuMixPctGroup = gt.totalQty > 0 ? (dish.total_qty / gt.totalQty) * 100 : 0;
    const dormantReason = ksClass === 'dormant' ? dormantReasonFor(dish) : null;

    result.push({
      ...dish,
      menu_mix_pct: +menuMixPct.toFixed(2),
      menu_mix_pct_group: +menuMixPctGroup.toFixed(2),
      ks_class: ksClass,
      dormant_reason: dormantReason,
      rank: 0,
      rank_in_class: 0,
      rank_in_group: 0,
      network: null,
    });
  }

  // KS-классификация среди кандидатов
  for (const d of ksCandidates) {
    const groupKey = d.dish_group || '(без группы)';
    const gt = groupTotals.get(groupKey)!;
    const ksg = ksGroupTotals.get(groupKey)!;

    const menuMixPct = (d.total_qty / totalQty) * 100;
    const menuMixPctGroup = gt.totalQty > 0 ? (d.total_qty / gt.totalQty) * 100 : 0;

    let ksClass: KSClass;
    if (ksg.n < 3) {
      ksClass = 'too_small';
    } else {
      const popularityThreshold = (1 / ksg.n) * 0.70 * 100;
      const avgMarginPerUnit = ksg.totalQty > 0 ? ksg.totalMargin / ksg.totalQty : 0;
      const mixPctWithinKs = ksg.totalQty > 0 ? (d.total_qty / ksg.totalQty) * 100 : 0;
      const isPopular = mixPctWithinKs >= popularityThreshold;
      const isProfitable = d.margin_per_unit >= avgMarginPerUnit;
      if (isPopular && isProfitable) ksClass = 'star';
      else if (isPopular && !isProfitable) ksClass = 'plowhorse';
      else if (!isPopular && isProfitable) ksClass = 'puzzle';
      else ksClass = 'dog';
    }

    result.push({
      ...d,
      menu_mix_pct: +menuMixPct.toFixed(2),
      menu_mix_pct_group: +menuMixPctGroup.toFixed(2),
      ks_class: ksClass,
      dormant_reason: null,
      rank: 0,
      rank_in_class: 0,
      rank_in_group: 0,
      network: null,
    });
  }

  return result;
}

/**
 * Сдвигает ISO-дату на N дней (+/-). Без зависимости от toDate (работаем в UTC).
 */
function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Сдвигает ISO-дату на 365 дней назад (для сравнения с прошлогодним окном).
 */
function shiftOneYearBack(iso: string): string {
  return shiftIsoDate(iso, -365);
}

export async function handleMenuAnalysis(request: Request, env: Env): Promise<Response> {
  try {
    const a = await authFromCookie(request, env);
    if (a instanceof Response) return a;
    const rl = await rateLimitOrResponse(env.MAGIC_LINKS, `data:${a.user_id}`, RATE_LIMIT_DATA, request);
    if (rl) return rl;

    const url = new URL(request.url);
    const restId = parsePositiveIntStrict(url.searchParams.get('restaurant_id'));
    const start = parseIsoDate(url.searchParams.get('start'));
    const end = parseIsoDate(url.searchParams.get('end'));
    if (restId === null) return jsonResponse({ error: 'Invalid restaurant_id' }, request, 400);
    if (!start || !end) return jsonResponse({ error: 'Invalid dates' }, request, 400);
    if (start > end) return jsonResponse({ error: 'start > end' }, request, 400);
    if (daysBetween(start, end) > MAX_DATE_RANGE_DAYS) return jsonResponse({ error: 'Range too wide' }, request, 400);

    // Фильтры. Default = true (показывать).
    const includeDormant = url.searchParams.get('include_dormant') !== '0';
    const includeEvent = url.searchParams.get('include_event') !== '0';
    const includeTooSmall = url.searchParams.get('include_too_small') !== '0';

    console.log(`[menu] user=${a.user_id} rest=${restId} ${start}..${end} ` +
      `includes: dormant=${includeDormant ? 1 : 0} event=${includeEvent ? 1 : 0} too_small=${includeTooSmall ? 1 : 0}`);

    const ch = new ClickHouseClient({
      host: env.CLICKHOUSE_HOST || 'http://localhost:8123',
      user: env.CLICKHOUSE_USER || 'default',
      password: env.CLICKHOUSE_PASSWORD || '',
    });

    const uuidR = await ch.query(
      `SELECT DISTINCT dept_uuid FROM chicko.mart_restaurant_daily_base WHERE dept_id = ${restId} LIMIT 1`
    );
    const uuidRows = uuidR.data as Array<{ dept_uuid: string }>;
    if (!uuidRows.length) return jsonResponse({ error: 'Restaurant not found' }, request, 404);
    const deptUuid = uuidRows[0].dept_uuid;

    // Расширенное окно для seasonal — ±30 дней от календарного года назад
    const seasonalStart = shiftIsoDate(shiftOneYearBack(start), -SEASONAL_WINDOW_DAYS);
    const seasonalEnd = shiftIsoDate(shiftOneYearBack(end), SEASONAL_WINDOW_DAYS);

    // --- SQL #1: per-dish aggregates + история продаж ---
    const sqlMain = `
      WITH
        valid_days AS (
          SELECT dept_uuid, report_date
          FROM chicko.mart_restaurant_daily_base
          WHERE is_anomaly_day = 0
            AND dept_uuid = '${deptUuid}'
        ),
        history AS (
          SELECT
            d.dish_code,
            min(d.report_date) AS first_sold_at,
            max(d.report_date) AS last_sold_at
          FROM chicko.dish_sales d
          INNER JOIN valid_days v ON d.dept_uuid = v.dept_uuid AND d.report_date = v.report_date
          WHERE d.dept_uuid = '${deptUuid}'
            AND d.report_date <= '${end}'
            AND d.qty > 0
            AND d.dish_code != ''
            AND d.dish_group != 'Архив'
          GROUP BY d.dish_code
        )
      SELECT
        d.dish_code AS dish_code,
        any(d.dish_name) AS dish_name,
        any(d.dish_category) AS dish_category,
        any(d.dish_group) AS dish_group,
        round(SUM(d.qty), 2) AS total_qty,
        round(SUM(d.revenue_rub), 2) AS total_revenue,
        round(SUM(d.foodcost_rub), 2) AS total_foodcost,
        round(SUM(d.revenue_rub) - SUM(d.foodcost_rub), 2) AS total_margin,
        round((SUM(d.revenue_rub) - SUM(d.foodcost_rub)) / nullIf(SUM(d.qty), 0), 2) AS margin_per_unit,
        round(SUM(d.revenue_rub) / nullIf(SUM(d.qty), 0), 2) AS avg_price,
        round(SUM(d.foodcost_rub) / nullIf(SUM(d.revenue_rub), 0) * 100, 1) AS avg_foodcost_pct,
        toString(h.first_sold_at) AS first_sold_at,
        toString(h.last_sold_at) AS last_sold_at,
        dateDiff('day', h.first_sold_at, toDate('${end}')) AS days_in_menu,
        dateDiff('day', h.last_sold_at, toDate('${end}')) AS days_since_last_sale
      FROM chicko.dish_sales d
      INNER JOIN valid_days v ON d.dept_uuid = v.dept_uuid AND d.report_date = v.report_date
      INNER JOIN history h ON d.dish_code = h.dish_code
      WHERE d.dept_uuid = '${deptUuid}'
        AND d.report_date BETWEEN '${start}' AND '${end}'
        AND d.qty > 0
        AND d.dish_code != ''
        AND d.dish_group != 'Архив'
      GROUP BY d.dish_code, h.first_sold_at, h.last_sold_at
      HAVING total_revenue > 0
      ORDER BY total_revenue DESC`;

    // --- SQL #2: network benchmark ---
    const sqlNet = `
      WITH
        valid_days AS (
          SELECT dept_uuid, report_date
          FROM chicko.mart_restaurant_daily_base
          WHERE is_anomaly_day = 0
            AND report_date BETWEEN '${start}' AND '${end}'
        ),
        mine AS (
          SELECT DISTINCT d.dish_code
          FROM chicko.dish_sales d
          INNER JOIN valid_days v ON d.dept_uuid = v.dept_uuid AND d.report_date = v.report_date
          WHERE d.dept_uuid = '${deptUuid}'
            AND d.qty > 0
            AND d.revenue_rub > 0
            AND d.dish_code != ''
            AND d.dish_group != 'Архив'
        ),
        per_rest_dish AS (
          SELECT
            d.dept_uuid,
            d.dish_code,
            SUM(d.qty) AS q,
            (SUM(d.revenue_rub) - SUM(d.foodcost_rub)) / nullIf(SUM(d.qty), 0) AS margin_per_unit
          FROM chicko.dish_sales d
          INNER JOIN valid_days v ON d.dept_uuid = v.dept_uuid AND d.report_date = v.report_date
          WHERE d.dept_uuid != '${deptUuid}'
            AND d.dish_code IN (SELECT dish_code FROM mine)
            AND d.qty > 0
          GROUP BY d.dept_uuid, d.dish_code
        ),
        per_rest_total AS (
          SELECT
            d.dept_uuid,
            SUM(d.qty) AS total_q
          FROM chicko.dish_sales d
          INNER JOIN valid_days v ON d.dept_uuid = v.dept_uuid AND d.report_date = v.report_date
          WHERE d.dept_uuid != '${deptUuid}'
            AND d.qty > 0
          GROUP BY d.dept_uuid
        )
      SELECT
        prd.dish_code AS dish_code,
        round(quantile(0.50)(prd.margin_per_unit), 2) AS margin_p50_net,
        round(quantile(0.50)(prd.q / prt.total_q * 100), 2) AS mix_pct_p50_net,
        count(DISTINCT prd.dept_uuid) AS n_rests
      FROM per_rest_dish prd
      INNER JOIN per_rest_total prt ON prd.dept_uuid = prt.dept_uuid
      GROUP BY prd.dish_code
      HAVING n_rests >= 3`;

    // --- SQL #3: seasonal — какие dish_code продавались в прошлом году в том же календарном окне ---
    const sqlSeasonal = `
      SELECT DISTINCT d.dish_code AS dish_code
      FROM chicko.dish_sales d
      INNER JOIN chicko.mart_restaurant_daily_base b
        ON d.dept_uuid = b.dept_uuid AND d.report_date = b.report_date
      WHERE d.dept_uuid = '${deptUuid}'
        AND b.is_anomaly_day = 0
        AND d.report_date BETWEEN '${seasonalStart}' AND '${seasonalEnd}'
        AND d.qty > 0
        AND d.dish_code != ''
        AND d.dish_group != 'Архив'`;

    const [mainResult, netResult, seasonalResult] = await Promise.all([
      ch.query(sqlMain),
      ch.query(sqlNet).catch(e => {
        console.error(`[menu] net query failed: ${(e as Error).message}`);
        return { data: [] as Array<Record<string, unknown>>, rows: 0 };
      }),
      ch.query(sqlSeasonal).catch(e => {
        console.error(`[menu] seasonal query failed: ${(e as Error).message}`);
        return { data: [] as Array<Record<string, unknown>>, rows: 0 };
      }),
    ]);

    const rows: DishRow[] = (mainResult.data as Array<Record<string, unknown>>).map(r => ({
      dish_code: String(r.dish_code),
      dish_name: String(r.dish_name),
      dish_category: String(r.dish_category),
      dish_group: String(r.dish_group),
      total_qty: +(r.total_qty as number | string),
      total_revenue: +(r.total_revenue as number | string),
      total_foodcost: +(r.total_foodcost as number | string),
      total_margin: +(r.total_margin as number | string),
      margin_per_unit: +(r.margin_per_unit as number | string) || 0,
      avg_price: +(r.avg_price as number | string) || 0,
      avg_foodcost_pct: +(r.avg_foodcost_pct as number | string) || 0,
      first_sold_at: String(r.first_sold_at),
      last_sold_at: String(r.last_sold_at),
      days_in_menu: +(r.days_in_menu as number | string),
      days_since_last_sale: +(r.days_since_last_sale as number | string),
    }));

    const netMap = new Map<string, NetworkBenchmark>();
    for (const r of netResult.data as Array<Record<string, unknown>>) {
      netMap.set(String(r.dish_code), {
        margin_p50_net: +(r.margin_p50_net as number | string),
        mix_pct_p50_net: +(r.mix_pct_p50_net as number | string),
        n_rests: +(r.n_rests as number | string),
      });
    }

    const seasonalCodes = new Set<string>();
    for (const r of seasonalResult.data as Array<Record<string, unknown>>) {
      seasonalCodes.add(String(r.dish_code));
    }

    // Классифицируем ВСЕ блюда
    const allClassified = classifyKS(rows, seasonalCodes);

    // Применяем фильтры include_*
    const filtered = allClassified.filter(d => {
      if (d.ks_class === 'dormant' && !includeDormant) return false;
      if (d.ks_class === 'event' && !includeEvent) return false;
      if (d.ks_class === 'too_small' && !includeTooSmall) return false;
      return true;
    });

    // Привязываем сетевые бенчмарки
    let networkCovered = 0;
    for (const d of filtered) {
      const nb = netMap.get(d.dish_code);
      if (nb) {
        d.network = nb;
        networkCovered++;
      }
    }

    // Ранги считаем по отфильтрованным блюдам
    // Global rank by revenue
    filtered.sort((a, b) => b.total_revenue - a.total_revenue);
    filtered.forEach((d, i) => { d.rank = i + 1; });

    // Rank in class
    const byClass = new Map<KSClass, ClassifiedDish[]>();
    for (const d of filtered) {
      if (!byClass.has(d.ks_class)) byClass.set(d.ks_class, []);
      byClass.get(d.ks_class)!.push(d);
    }
    for (const arr of byClass.values()) {
      arr.sort((a, b) => b.total_revenue - a.total_revenue);
      arr.forEach((d, i) => { d.rank_in_class = i + 1; });
    }

    // Rank in group
    const byGroupFinal = new Map<string, ClassifiedDish[]>();
    for (const d of filtered) {
      const key = d.dish_group || '(без группы)';
      if (!byGroupFinal.has(key)) byGroupFinal.set(key, []);
      byGroupFinal.get(key)!.push(d);
    }
    for (const arr of byGroupFinal.values()) {
      arr.sort((a, b) => b.total_revenue - a.total_revenue);
      arr.forEach((d, i) => { d.rank_in_group = i + 1; });
    }

    // Финальная сортировка по rank
    filtered.sort((a, b) => a.rank - b.rank);

    const counts = {
      star: 0, plowhorse: 0, puzzle: 0, dog: 0,
      too_small: 0, event: 0, dormant: 0, new: 0,
    };
    filtered.forEach(d => counts[d.ks_class]++);

    // Dormant-reasons counts (только из отфильтрованных)
    const dormantReasons = { replaced: 0, seasonal: 0, retired: 0 };
    filtered.forEach(d => {
      if (d.ks_class === 'dormant' && d.dormant_reason) {
        dormantReasons[d.dormant_reason]++;
      }
    });

    const totalRev = filtered.reduce((s, d) => s + d.total_revenue, 0);
    const totalMargin = filtered.reduce((s, d) => s + d.total_margin, 0);
    const totalQtySum = filtered.reduce((s, d) => s + d.total_qty, 0);

    return jsonResponse({
      dishes: filtered,
      summary: {
        total_dishes: filtered.length,
        total_revenue: Math.round(totalRev),
        total_qty: Math.round(totalQtySum),
        total_margin: Math.round(totalMargin),
        avg_margin_pct: totalRev > 0 ? +(totalMargin / totalRev * 100).toFixed(1) : 0,
        ks_counts: counts,
        dormant_reasons: dormantReasons,
        network_covered: networkCovered,
      },
      filters: {
        include_dormant: includeDormant,
        include_event: includeEvent,
        include_too_small: includeTooSmall,
      },
      thresholds: {
        new_threshold_days: NEW_THRESHOLD_DAYS,
        dormant_threshold_days: DORMANT_THRESHOLD_DAYS,
        seasonal_window_days: SEASONAL_WINDOW_DAYS,
      },
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[menu] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed' }, request, 500);
  }
}
