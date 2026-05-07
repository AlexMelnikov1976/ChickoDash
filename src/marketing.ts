// ════════════════════════════════════════════════════════════════════════════
// /api/marketing-overview
//
// Возвращает CRM-портрет лояльности по сети Чико.
// Использует общую обёртку ClickHouseClient из clickhouse.ts.
//
// Источник: chicko.mart_crm_overview (1 строка на день, snapshot_date).
// История восстановлена за 112 дней (с 2026-01-01).
// ════════════════════════════════════════════════════════════════════════════

import { authFromCookie, parseIsoDate, daysBetween, MAX_DATE_RANGE_DAYS } from './security';
import { ClickHouseClient } from './clickhouse';

interface Env {
  CLICKHOUSE_HOST: string;
  CLICKHOUSE_USER: string;
  CLICKHOUSE_PASSWORD: string;
}

export async function handleMarketingOverview(request: Request, env: Env): Promise<Response> {
  // Auth: authFromCookie возвращает либо Response (если 401), либо AuthContext.
  const auth = await authFromCookie(request, env as any);
  if (auth instanceof Response) return auth;

  try {
    const ch = new ClickHouseClient({
      host: env.CLICKHOUSE_HOST,
      user: env.CLICKHOUSE_USER,
      password: env.CLICKHOUSE_PASSWORD
    });

    // ── SQL 1: текущий снапшот (последняя доступная дата в mart) ─────────
    const snapshotSql = `
      SELECT *
      FROM chicko.mart_crm_overview
      WHERE snapshot_date = (SELECT max(snapshot_date) FROM chicko.mart_crm_overview)
      LIMIT 1
    `;

    // ── SQL 2: история за последние 365 дней (для графиков и дельт) ──────
    // Возвращаем 5 полей, нужных фронту:
    //   clients_total, clients_active_30d, repeat_rate_pct,
    //   ltv_median, new_registrations_today
    // Сортировка по возрастанию даты — фронт делает slice(-N) с конца.
    const historySql = `
      SELECT
        toString(snapshot_date) AS date,
        clients_total,
        clients_active_30d,
        repeat_rate_pct,
        ltv_median,
        new_registrations_today
      FROM chicko.mart_crm_overview
      WHERE snapshot_date >= today() - 365
      ORDER BY snapshot_date ASC
    `;

    // Параллельно — снапшот + история
    const [snapshotResult, historyResult] = await Promise.all([
      ch.query(snapshotSql),
      ch.query(historySql)
    ]);

    if (snapshotResult.data.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'no_data',
          message: 'mart_crm_overview is empty',
          history_rows: historyResult.data.length
        }),
        { status: 503, headers: { 'content-type': 'application/json' } }
      );
    }

    const s = snapshotResult.data[0];

    // ── Структурированный ответ ───────────────────────────────────────────
    const response = {
      kpi: {
        clients_total: s.clients_total,
        clients_active_30d: s.clients_active_30d,
        repeat_rate_pct: s.repeat_rate_pct,
        ltv_median: s.ltv_median,
        bal_total_sum: s.bal_total_sum
      },
      funnel: {
        clients_total: s.clients_total,
        clients_repeat: s.clients_repeat,
        clients_active_90d: s.clients_active_90d,
        clients_active_30d: s.clients_active_30d,
        clients_loyal_5_plus: s.clients_loyal_5_plus,
        clients_one_check: s.clients_one_check
      },
      rfm: {
        vip: s.rfm_vip,
        at_risk: s.rfm_at_risk,
        dormant_valuable: s.rfm_dormant_valuable,
        lost_one_time: s.rfm_lost_one_time,
        new_first_purchase: s.rfm_new_first_purchase,
        other: s.rfm_other
      },
      loyalty: {
        novichok: s.loyalty_novichok,
        treyni: s.loyalty_treyni,
        idol: s.loyalty_idol,
        legenda: s.loyalty_legenda,
        other: s.loyalty_other
      },
      campaigns: {
        burning_gift_clients: s.camp_burning_gift_clients,
        burning_gift_amount: s.camp_burning_gift_amount,
        second_visit_clients: s.camp_second_visit_clients,
        winback_clients: s.camp_winback_clients,
        birthday_7d_clients: s.camp_birthday_7d_clients,
        birthday_30d_clients: s.camp_birthday_30d_clients
      },
      balances: {
        total: s.bal_total_sum,
        gift: s.bal_gift_sum,
        accumulated: s.bal_accumulated_sum,
        promo: s.bal_promo_sum,
        clients_with_gift: s.clients_with_gift,
        clients_with_accumulated: s.clients_with_accumulated
      },
      money: {
        ltv_total: s.ltv_total,
        ltv_mean: s.ltv_mean,
        ltv_median: s.ltv_median,
        ltv_p75: s.ltv_p75,
        avg_check: s.avg_check_network
      },
      health: {
        pct_with_email: s.pct_with_email,
        pct_with_birth_date: s.pct_with_birth_date,
        pct_with_gender: s.pct_with_gender,
        anomaly_zero_revenue_with_balance: s.anomaly_zero_revenue_with_balance,
        clients_dormant_180_plus: s.clients_dormant_180_plus
      },
      // Sparkline: историческая динамика. Фронт сам режет slice(-N) для периодов.
      // Поля под именами как в макете marketing-mockup.html.
      sparkline: historyResult.data,
      meta: {
        snapshot_date: s.snapshot_date,
        history_days: historyResult.data.length,
        source: 'chicko.mart_crm_overview',
        scope: 'kaliningrad'
      }
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'private, max-age=300' // 5 минут — данные обновляются раз в сутки
      }
    });

  } catch (e: any) {
    console.error('[marketing-overview] error:', e.message);
    return new Response(
      JSON.stringify({ error: 'internal', message: e.message }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// /api/marketing/loyalty-users
//
// Список клиентов программы лояльности с операциями за период.
// Источник: chicko.premiumbonus_detail (по одной строке на покупку с картой)
// LEFT JOIN chicko.mart_crm_clients (по phone) для имени и сегмента.
//
// Query params:
//   start=YYYY-MM-DD     обязателен
//   end=YYYY-MM-DD       обязателен
//   city=<строка>        опционально, фильтр по point_of_sale (positionCaseInsensitive)
//
// Ответ: { rows: [...], meta: { start, end, city, count, source } }
// ════════════════════════════════════════════════════════════════════════════
const LOYALTY_USERS_LIMIT = 50000;

// Фильтр city — допускаем только безопасные символы (буквы кириллица/латиница,
// цифры, пробел, дефис, точка, запятая). Всё прочее (кавычки, бэкслеши и т.п.)
// отклоняется. Это защищает от SQL-injection при подстановке в запрос.
function sanitizeCity(s: string): string | null {
  if (!s) return null;
  if (s.length > 100) return null;
  // \p{L} требует флаг u — допустим: буквы любых алфавитов, цифры, пробел, - . , /
  if (!/^[\p{L}\d\s\-.,/]+$/u.test(s)) return null;
  return s.trim();
}

export async function handleLoyaltyUsers(request: Request, env: Env): Promise<Response> {
  const auth = await authFromCookie(request, env as any);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const start = parseIsoDate(url.searchParams.get('start'));
  const end = parseIsoDate(url.searchParams.get('end'));
  const cityRaw = url.searchParams.get('city');

  if (!start || !end) {
    return new Response(
      JSON.stringify({ error: 'bad_request', message: 'invalid start/end (expected YYYY-MM-DD)' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }
  if (start > end) {
    return new Response(
      JSON.stringify({ error: 'bad_request', message: 'start must be <= end' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }
  const span = daysBetween(start, end);
  if (span > MAX_DATE_RANGE_DAYS) {
    return new Response(
      JSON.stringify({ error: 'bad_request', message: `date range too wide (max ${MAX_DATE_RANGE_DAYS} days)` }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }

  let cityFilter = '';
  let cityNormalized: string | null = null;
  if (cityRaw && cityRaw !== 'all') {
    cityNormalized = sanitizeCity(cityRaw);
    if (!cityNormalized) {
      return new Response(
        JSON.stringify({ error: 'bad_request', message: 'invalid city filter' }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }
    // Уже отфильтровали безопасные символы — подставляем как литерал.
    cityFilter = `AND positionCaseInsensitiveUTF8(point_of_sale, '${cityNormalized}') > 0`;
  }

  try {
    const ch = new ClickHouseClient({
      host: env.CLICKHOUSE_HOST,
      user: env.CLICKHOUSE_USER,
      password: env.CLICKHOUSE_PASSWORD
    });

    // Aggregate per phone, потом LEFT JOIN с последним снапшотом mart_crm_clients
    // для имени, loyalty_group и last_check_pos.
    const sql = `
      WITH period_users AS (
        SELECT
          phone,
          any(client_id)                AS client_id,
          toString(min(purchase_date))  AS first_visit,
          toString(max(purchase_date))  AS last_visit,
          count()                       AS visits,
          round(sum(price_sum), 2)      AS gross,
          round(sum(payment_sum), 2)    AS paid,
          round(sum(discount_sum), 2)   AS discount,
          round(sum(bonus_sum), 2)      AS bonus_used,
          arrayStringConcat(arrayDistinct(groupArray(point_of_sale)), ' | ') AS points
        FROM chicko.premiumbonus_detail
        WHERE purchase_date BETWEEN '${start}' AND '${end}'
          ${cityFilter}
        GROUP BY phone
      )
      SELECT
        pu.phone        AS phone,
        pu.client_id    AS client_id,
        c.name          AS name,
        c.loyalty_group AS loyalty_group,
        c.last_check_pos AS home_point,
        pu.first_visit  AS first_visit,
        pu.last_visit   AS last_visit,
        pu.visits       AS visits,
        pu.gross        AS gross,
        pu.paid         AS paid,
        pu.discount     AS discount,
        pu.bonus_used   AS bonus_used,
        pu.points       AS points_used
      FROM period_users pu
      LEFT JOIN (
        SELECT phone, name, loyalty_group, last_check_pos
        FROM chicko.mart_crm_clients
        WHERE snapshot_date = (SELECT max(snapshot_date) FROM chicko.mart_crm_clients)
      ) c USING (phone)
      ORDER BY pu.visits DESC, pu.gross DESC
      LIMIT ${LOYALTY_USERS_LIMIT}
    `;

    const result = await ch.query(sql);

    return new Response(JSON.stringify({
      rows: result.data,
      meta: {
        start,
        end,
        city: cityNormalized,
        count: result.data.length,
        limit: LOYALTY_USERS_LIMIT,
        source: 'chicko.premiumbonus_detail + mart_crm_clients'
      }
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'private, max-age=120'
      }
    });
  } catch (e: any) {
    console.error('[loyalty-users] error:', e.message);
    return new Response(
      JSON.stringify({ error: 'internal', message: e.message }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// /api/marketing/loyalty-count
//
// Лёгкий COUNT-запрос для KPI-карточки «По ПЛ за период».
// Возвращает только число уникальных клиентов — без строк.
//
// Query params: start, end, city (те же что у loyalty-users)
// Ответ: { count, start, end, city }
// ════════════════════════════════════════════════════════════════════════════

export async function handleLoyaltyCount(request: Request, env: Env): Promise<Response> {
  const auth = await authFromCookie(request, env as any);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const start = parseIsoDate(url.searchParams.get('start'));
  const end = parseIsoDate(url.searchParams.get('end'));
  const cityRaw = url.searchParams.get('city');

  if (!start || !end) {
    return new Response(
      JSON.stringify({ error: 'bad_request', message: 'invalid start/end (expected YYYY-MM-DD)' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }
  if (start > end) {
    return new Response(
      JSON.stringify({ error: 'bad_request', message: 'start must be <= end' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }
  const span = daysBetween(start, end);
  if (span > MAX_DATE_RANGE_DAYS) {
    return new Response(
      JSON.stringify({ error: 'bad_request', message: `date range too wide (max ${MAX_DATE_RANGE_DAYS} days)` }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }

  let cityFilter = '';
  let cityNormalized: string | null = null;
  if (cityRaw && cityRaw !== 'all') {
    cityNormalized = sanitizeCity(cityRaw);
    if (!cityNormalized) {
      return new Response(
        JSON.stringify({ error: 'bad_request', message: 'invalid city filter' }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }
    cityFilter = `AND positionCaseInsensitiveUTF8(point_of_sale, '${cityNormalized}') > 0`;
  }

  try {
    const ch = new ClickHouseClient({
      host: env.CLICKHOUSE_HOST,
      user: env.CLICKHOUSE_USER,
      password: env.CLICKHOUSE_PASSWORD
    });

    const sql = `
      SELECT count(DISTINCT phone) AS unique_clients
      FROM chicko.premiumbonus_detail
      WHERE purchase_date BETWEEN '${start}' AND '${end}'
        ${cityFilter}
    `;

    const result = await ch.query(sql);
    const count = result.data.length > 0 ? Number(result.data[0].unique_clients) : 0;

    return new Response(JSON.stringify({
      count,
      start,
      end,
      city: cityNormalized
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'private, max-age=300'
      }
    });
  } catch (e: any) {
    console.error('[loyalty-count] error:', e.message);
    return new Response(
      JSON.stringify({ error: 'internal', message: e.message }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}
