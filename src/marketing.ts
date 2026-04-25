// ════════════════════════════════════════════════════════════════════════════
// /api/marketing-overview
//
// Возвращает CRM-портрет лояльности по сети Чико.
// Использует общую обёртку ClickHouseClient из clickhouse.ts.
//
// Источник: chicko.mart_crm_overview (1 строка на день, snapshot_date).
// История восстановлена за 112 дней (с 2026-01-01).
// ════════════════════════════════════════════════════════════════════════════

import { authFromCookie } from './security';
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
