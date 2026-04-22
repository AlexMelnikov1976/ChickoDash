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
  dish_name: string;
  dish_category: string;
  total_qty: number;
  total_revenue: number;
  total_foodcost: number;
  total_margin: number;
  margin_per_unit: number;
  avg_price: number;
  avg_foodcost_pct: number;
}

type KSClass = 'star' | 'plowhorse' | 'puzzle' | 'dog';

function classifyKS(dishes: DishRow[]): Array<DishRow & { menu_mix_pct: number; ks_class: KSClass; rank: number }> {
  const totalQty = dishes.reduce((s, d) => s + d.total_qty, 0);
  const totalMargin = dishes.reduce((s, d) => s + d.total_margin, 0);
  const n = dishes.length;
  if (n === 0 || totalQty === 0) return [];

  const popularityThreshold = (1 / n) * 0.70 * 100;
  const avgMarginPerUnit = totalMargin / totalQty;

  return dishes
    .map(d => {
      const menuMixPct = (d.total_qty / totalQty) * 100;
      const isPopular = menuMixPct >= popularityThreshold;
      const isProfitable = d.margin_per_unit >= avgMarginPerUnit;
      let ksClass: KSClass;
      if (isPopular && isProfitable) ksClass = 'star';
      else if (isPopular && !isProfitable) ksClass = 'plowhorse';
      else if (!isPopular && isProfitable) ksClass = 'puzzle';
      else ksClass = 'dog';
      return { ...d, menu_mix_pct: +menuMixPct.toFixed(2), ks_class: ksClass, rank: 0 };
    })
    .sort((a, b) => b.total_revenue - a.total_revenue)
    .map((d, i) => ({ ...d, rank: i + 1 }));
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

    const uuidR = await ch.query(`SELECT DISTINCT dept_uuid FROM chicko.mart_restaurant_daily_base WHERE dept_id = ${restId} LIMIT 1`);
    const uuidRows = uuidR.data as Array<{ dept_uuid: string }>;
    if (!uuidRows.length) return jsonResponse({ error: 'Restaurant not found' }, request, 404);

    const sql = `
      SELECT dish_name, dish_category,
        round(SUM(qty),2) AS total_qty,
        round(SUM(revenue_rub),2) AS total_revenue,
        round(SUM(foodcost_rub),2) AS total_foodcost,
        round(SUM(revenue_rub)-SUM(foodcost_rub),2) AS total_margin,
        round((SUM(revenue_rub)-SUM(foodcost_rub))/nullIf(SUM(qty),0),2) AS margin_per_unit,
        round(SUM(revenue_rub)/nullIf(SUM(qty),0),2) AS avg_price,
        round(SUM(foodcost_rub)/nullIf(SUM(revenue_rub),0)*100,1) AS avg_foodcost_pct
      FROM chicko.dish_sales
      WHERE dept_uuid='${uuidRows[0].dept_uuid}' AND report_date BETWEEN '${start}' AND '${end}' AND qty>0
      GROUP BY dish_name, dish_category HAVING total_revenue>0
      ORDER BY total_revenue DESC`;

    const result = await ch.query(sql);
    const rows: DishRow[] = (result.data as Array<Record<string, unknown>>).map(r => ({
      dish_name: String(r.dish_name),
      dish_category: String(r.dish_category),
      total_qty: +(r.total_qty as number | string),
      total_revenue: +(r.total_revenue as number | string),
      total_foodcost: +(r.total_foodcost as number | string),
      total_margin: +(r.total_margin as number | string),
      margin_per_unit: +(r.margin_per_unit as number | string) || 0,
      avg_price: +(r.avg_price as number | string) || 0,
      avg_foodcost_pct: +(r.avg_foodcost_pct as number | string) || 0,
    }));

    const classified = classifyKS(rows);
    const counts = { star: 0, plowhorse: 0, puzzle: 0, dog: 0 };
    classified.forEach(d => counts[d.ks_class]++);
    const totalRev = rows.reduce((s,d)=>s+d.total_revenue,0);
    const totalMargin = rows.reduce((s,d)=>s+d.total_margin,0);

    return jsonResponse({
      dishes: classified,
      summary: {
        total_dishes: classified.length,
        total_revenue: Math.round(totalRev),
        total_qty: Math.round(rows.reduce((s,d)=>s+d.total_qty,0)),
        total_margin: Math.round(totalMargin),
        avg_margin_pct: totalRev>0 ? +(totalMargin/totalRev*100).toFixed(1) : 0,
        ks_counts: counts,
      },
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[menu] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed' }, request, 500);
  }
}
