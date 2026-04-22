// Chicko Analytics — Menu Analysis endpoint (Phase 2.7)
// © 2026 System360 by Alex Melnikov. All rights reserved.
//
// GET /api/menu-analysis?restaurant_id=N&start=YYYY-MM-DD&end=YYYY-MM-DD
//
// Kasavana-Smith menu engineering matrix с 5 улучшениями относительно v1:
//   1. Классификация ВНУТРИ dish_group (а не по всему меню)
//      → правильнее сравнивать "Корейский чикен" внутри себя, а не с напитками
//   2. Класс 'too_small' для групп с n < 3 блюд
//      → KS на 1-2 блюдах вырождается
//   3. Фильтр аномалий через INNER JOIN с mart_restaurant_daily_base
//      → консистентно с forecast.ts / benchmarks.ts
//   4. Три ранга: rank (в меню), rank_in_class (в своём KS), rank_in_group
//      → UI сможет показывать "топ-5 dog по выручке" и т.п.
//   5. Сетевой бенчмарк по dish_code (порог n_rests >= 3)
//      → инсайт "у тебя это puzzle, а по сети — star в N ресторанах"
//
// Matching между ресторанами — по dish_code (стабильный SKU), не по dish_name.
// Блюда с пустым dish_code исключаются из основного анализа.

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
}

type KSClass = 'star' | 'plowhorse' | 'puzzle' | 'dog' | 'too_small';

interface NetworkBenchmark {
  margin_p50_net: number;
  mix_pct_p50_net: number;
  n_rests: number;
}

interface ClassifiedDish extends DishRow {
  menu_mix_pct: number;        // % от общего qty всего меню
  menu_mix_pct_group: number;  // % от qty внутри dish_group
  ks_class: KSClass;
  rank: number;                // по revenue во всём меню
  rank_in_class: number;       // по revenue внутри своего KS-класса
  rank_in_group: number;       // по revenue внутри своей dish_group
  network: NetworkBenchmark | null;
}

/**
 * Классификация блюд по Касаване-Смиту внутри dish_group.
 * Популярность: menu_mix_pct_group >= (1/n_group) * 0.70 * 100
 * Прибыльность: margin_per_unit >= средняя margin_per_unit внутри группы
 * Группы с n < 3 → all → 'too_small'
 */
function classifyKS(dishes: DishRow[]): ClassifiedDish[] {
  const n = dishes.length;
  if (n === 0) return [];

  const totalQty = dishes.reduce((s, d) => s + d.total_qty, 0);
  if (totalQty === 0) return [];

  // Группируем по dish_group
  const byGroup = new Map<string, DishRow[]>();
  for (const d of dishes) {
    const key = d.dish_group || '(без группы)';
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(d);
  }

  const result: ClassifiedDish[] = [];

  for (const [, groupDishes] of byGroup) {
    const groupTotalQty = groupDishes.reduce((s, d) => s + d.total_qty, 0);
    const groupTotalMargin = groupDishes.reduce((s, d) => s + d.total_margin, 0);
    const nGroup = groupDishes.length;

    const popularityThreshold = nGroup > 0 ? (1 / nGroup) * 0.70 * 100 : 0;
    const avgMarginPerUnit = groupTotalQty > 0 ? groupTotalMargin / groupTotalQty : 0;

    for (const d of groupDishes) {
      const menuMixPct = (d.total_qty / totalQty) * 100;
      const menuMixPctGroup = groupTotalQty > 0 ? (d.total_qty / groupTotalQty) * 100 : 0;

      let ksClass: KSClass;
      if (nGroup < 3) {
        ksClass = 'too_small';
      } else {
        const isPopular = menuMixPctGroup >= popularityThreshold;
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
        rank: 0,
        rank_in_class: 0,
        rank_in_group: 0,
        network: null,
      });
    }
  }

  // Global rank by revenue
  result.sort((a, b) => b.total_revenue - a.total_revenue);
  result.forEach((d, i) => { d.rank = i + 1; });

  // Rank in class
  const byClass = new Map<KSClass, ClassifiedDish[]>();
  for (const d of result) {
    if (!byClass.has(d.ks_class)) byClass.set(d.ks_class, []);
    byClass.get(d.ks_class)!.push(d);
  }
  for (const arr of byClass.values()) {
    arr.sort((a, b) => b.total_revenue - a.total_revenue);
    arr.forEach((d, i) => { d.rank_in_class = i + 1; });
  }

  // Rank in group
  const byGroupFinal = new Map<string, ClassifiedDish[]>();
  for (const d of result) {
    const key = d.dish_group || '(без группы)';
    if (!byGroupFinal.has(key)) byGroupFinal.set(key, []);
    byGroupFinal.get(key)!.push(d);
  }
  for (const arr of byGroupFinal.values()) {
    arr.sort((a, b) => b.total_revenue - a.total_revenue);
    arr.forEach((d, i) => { d.rank_in_group = i + 1; });
  }

  // Возвращаем в порядке глобального rank (по revenue DESC)
  result.sort((a, b) => a.rank - b.rank);
  return result;
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

    console.log(`[menu] user=${a.user_id} rest=${restId} ${start}..${end}`);

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

    // --- SQL #1: per-dish aggregates for the selected restaurant ---
    // GROUP BY dish_code (стабильный SKU). any(dish_name) — у одного кода
    // теоретически может быть несколько названий (~44 случаев из 1515 в тестовой базе).
    // INNER JOIN отсекает дни с is_anomaly_day = 1.
    const sqlMain = `
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
        round(SUM(d.foodcost_rub) / nullIf(SUM(d.revenue_rub), 0) * 100, 1) AS avg_foodcost_pct
      FROM chicko.dish_sales d
      INNER JOIN chicko.mart_restaurant_daily_base b
        ON d.dept_uuid = b.dept_uuid AND d.report_date = b.report_date
      WHERE d.dept_uuid = '${deptUuid}'
        AND d.report_date BETWEEN '${start}' AND '${end}'
        AND b.is_anomaly_day = 0
        AND d.qty > 0
        AND d.dish_code != ''
      GROUP BY d.dish_code
      HAVING total_revenue > 0
      ORDER BY total_revenue DESC`;

    // --- SQL #2: network benchmark ---
    // Для каждого dish_code из моего меню считаем:
    //   - median margin_per_unit по другим ресторанам (агрегат за период)
    //   - median menu_mix_pct по другим ресторанам (доля блюда в их меню)
    //   - n_rests (в скольких других ресторанах продавалось, порог >= 3)
    // per_rest_total считает весь qty ресторана (не только блюда из моего
    // меню), чтобы mix_pct был честной долей в меню того ресторана.
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
            AND d.dish_code != ''
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

    // Запускаем параллельно. Network query не блокирует основной ответ.
    const [mainResult, netResult] = await Promise.all([
      ch.query(sqlMain),
      ch.query(sqlNet).catch(e => {
        console.error(`[menu] net query failed: ${(e as Error).message}`);
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
    }));

    // Map сетевых бенчмарков по dish_code
    const netMap = new Map<string, NetworkBenchmark>();
    for (const r of netResult.data as Array<Record<string, unknown>>) {
      netMap.set(String(r.dish_code), {
        margin_p50_net: +(r.margin_p50_net as number | string),
        mix_pct_p50_net: +(r.mix_pct_p50_net as number | string),
        n_rests: +(r.n_rests as number | string),
      });
    }

    const classified = classifyKS(rows);
    // Привязываем сетевые бенчмарки к классифицированным блюдам
    for (const d of classified) {
      d.network = netMap.get(d.dish_code) || null;
    }

    const counts = { star: 0, plowhorse: 0, puzzle: 0, dog: 0, too_small: 0 };
    classified.forEach(d => counts[d.ks_class]++);
    const totalRev = rows.reduce((s, d) => s + d.total_revenue, 0);
    const totalMargin = rows.reduce((s, d) => s + d.total_margin, 0);

    return jsonResponse({
      dishes: classified,
      summary: {
        total_dishes: classified.length,
        total_revenue: Math.round(totalRev),
        total_qty: Math.round(rows.reduce((s, d) => s + d.total_qty, 0)),
        total_margin: Math.round(totalMargin),
        avg_margin_pct: totalRev > 0 ? +(totalMargin / totalRev * 100).toFixed(1) : 0,
        ks_counts: counts,
        network_covered: netMap.size,
      },
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[menu] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed' }, request, 500);
  }
}
