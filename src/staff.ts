// Chicko Analytics — Staff Analysis endpoints (Phase 2.9.1 — real ClickHouse)
// © 2026 System360 by Alex Melnikov. All rights reserved.
// Proprietary software — unauthorized copying or distribution prohibited.
//
// 6 endpoints, все требуют session cookie (chicko_session, HttpOnly),
// rate-limit 60/min/user:
//
//   GET /api/staff-list        — Block 1+2: период в цифрах + KPI + штат
//   GET /api/staff-detail      — drawer отдельного сотрудника
//   GET /api/staff-groups      — Block 3: 4 группы + ресторан + корреляция
//   GET /api/staff-performance — Block 4: KS-матрица официантов + bad/good shifts
//   GET /api/staff-managers    — Block 5: менеджеры дня за выбранный период
//   GET /api/staff-losses      — Block 6: потери за период
//
// ИСТОЧНИКИ (ClickHouse database = db1, timezone = Europe/Kaliningrad UTC+2):
//
//   db1.`ЧикоВремя` (313K строк) — табель смен
//     Дата Date32, Имя String, Роль String, Группа String,
//     РабВремяЧас Decimal, Начислено Decimal, Приход DateTime64
//
//   db1.`Чико4` (183K строк) — дневной агрегат ресторана
//     Дата DateTime64, Менеджер String,
//     ВыручкаБар/Кухня/Доставка Decimal, Начислено Decimal,
//     Бар/Зал/Клининг/Кухня Начислено Decimal,
//     ПорчаТовараБар/Кухня, ПорчаВитрина, ПорчаПоВинеСотрудника,
//     УдалениеБлюдСоСписанием, НедостачаИнвентаризации,
//     ПитаниеПерсонала, МотивацияПерсонала, ПроработкаБар/Кухня/БрендШеф,
//     КлиентскийСервис, Представительские, Оценка2Гис, ОценкаЯндекс,
//     ФудкостОбщий, СкидкаОбщий, СрЧекОбщий, и др.
//
//   db1.`ЧикоНов3` (133K строк) — продажи по официантам
//     Дата DateTime64, Официант String,
//     СреднийЧек Decimal, КолВоЧеков Decimal, СрКолВоПозВЧеке Decimal
//
// Таблицы = один ресторан (Калининград). restaurant_id игнорируется на уровне
// фильтров, но валидируется на входе для совместимости с остальными endpoint-ами.
//
// Факт-only: все данные возвращаются до `today()` включительно. Если выбранный
// период уходит в будущее — в summary честно пишем "факт X из Y дней".
//
// Пороги активности (пакт v3 раздел 18):
//   LEFT_STAFF_DAYS = 21  → сотрудники/менеджеры с last_shift > 21 дня
//                           до end периода исключаются из основной выдачи.

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
import { ClickHouseClient } from './clickhouse';
import type { Env } from './index';

function jsonResponse(body: unknown, request: Request, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeadersFor(request) },
  });
}

// --- Пороги классификации (пакт v3 раздел 2 + 18) ---
const NEW_STAFF_DAYS = 30;
const DORMANT_STAFF_DAYS = 14;
const LEFT_STAFF_DAYS = 21;
const TENURE_MIN_DAYS = 60;
const OCCASIONAL_RATIO = 0.3;

// --- Валидация параметров + расчёт факт/прогноз границ периода ---
interface ValidatedInput {
  restId: number;
  start: string;
  end: string;
  // Факт: только до today() (ClickHouse today() в timezone сервера).
  // Если весь период в прошлом — factEnd = end; если end в будущем — factEnd = today.
  factEnd: string;
  daysInPeriod: number;   // календарных дней [start..end]
  daysFact: number;       // фактически доступных [start..factEnd]
  user_id: string;
  email: string;
}

async function validateCommon(
  request: Request,
  env: Env,
): Promise<ValidatedInput | Response> {
  const a = await authFromCookie(request, env);
  if (a instanceof Response) return a;

  const rl = await rateLimitOrResponse(env.MAGIC_LINKS, `data:${a.user_id}`, RATE_LIMIT_DATA, request);
  if (rl) return rl;

  const url = new URL(request.url);
  const restId = parsePositiveIntStrict(url.searchParams.get('restaurant_id'));
  if (restId === null) {
    return jsonResponse({ error: 'Invalid restaurant_id' }, request, 400);
  }

  const start = parseIsoDate(url.searchParams.get('start'));
  const end = parseIsoDate(url.searchParams.get('end'));
  if (!start || !end) return jsonResponse({ error: 'Invalid start/end date (expected YYYY-MM-DD)' }, request, 400);
  if (start > end) return jsonResponse({ error: 'start must be <= end' }, request, 400);

  const daysInPeriod = daysBetween(start, end);
  if (daysInPeriod > MAX_DATE_RANGE_DAYS) {
    return jsonResponse({ error: `Date range too wide (max ${MAX_DATE_RANGE_DAYS} days, got ${daysInPeriod})` }, request, 400);
  }

  // today в Калининградской timezone (UTC+2). Workers в UTC, поэтому отнимаем оффсет.
  // Калининград круглый год UTC+2 (без DST).
  const nowUtc = new Date();
  const kaliningradNow = new Date(nowUtc.getTime() + 2 * 3600 * 1000);
  const today = kaliningradNow.toISOString().slice(0, 10);

  const factEnd = end <= today ? end : today;
  const daysFact = factEnd < start ? 0 : daysBetween(start, factEnd);

  return { restId, start, end, factEnd, daysInPeriod, daysFact, user_id: a.user_id, email: a.email };
}

function makeClient(env: Env): ClickHouseClient {
  return new ClickHouseClient({
    host: env.CLICKHOUSE_HOST || 'http://localhost:8123',
    user: env.CLICKHOUSE_USER || 'default',
    password: env.CLICKHOUSE_PASSWORD || '',
  });
}

// Хелпер: преобразует строку из Decimal(38,6) в number. ClickHouse отдаёт Decimal
// как строку в JSON, чтобы не терять точность. Нам нужны number'а для арифметики.
function d(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v));
  return isFinite(n) ? n : 0;
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// -----------------------------------------------------------------------------
// GET /api/staff-list  — Block 1+2
// -----------------------------------------------------------------------------
export async function handleStaffList(request: Request, env: Env): Promise<Response> {
  try {
    const v = await validateCommon(request, env);
    if (v instanceof Response) return v;

    console.log(`[staff-list] user=${v.user_id} rest=${v.restId} ${v.start}..${v.end} factEnd=${v.factEnd} daysFact=${v.daysFact}`);

    const ch = makeClient(env);

    // Агрегат ресторана за период: выручка из mart (единый источник с вкладкой Обзор),
    // ФОТ из Чико4 (в mart нет payroll).
    const sqlRestaurant = `
      SELECT
        countIf(revenue_total_rub > 0) AS days_with_data,
        SUM(revenue_total_rub)          AS revenue_total,
        0                               AS payroll_total
      FROM chicko.mart_restaurant_daily_base
      WHERE dept_id = ${v.restId}
        AND report_date BETWEEN '${v.start}' AND '${v.factEnd}'
    `;
    const sqlPayroll = `
      SELECT SUM(toFloat64(\`Начислено\`)) AS payroll_total
      FROM db1.\`Чико4\`
      WHERE toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')
    `;

    // Сотрудники за период: агрегат из ЧикоВремя, с last_shift для классификации left/dormant.
    // Считаем часы, смены, ФОТ. last_shift относительно factEnd для фильтра left.
    // Сотрудники активные в последние LEFT_STAFF_DAYS дней до factEnd.
    // sumIf/countIf считают метрики только за выбранный период — честно дают 0
    // когда период попадает в зону лага ЧикоВремя (~7 дней).
    // Глобальный MAX(Дата) в HAVING гарантирует, что видим команду даже когда
    // выбранный период ещё не попал в ЧикоВремя.
    const sqlEmployees = `
      SELECT
        \`Имя\` AS employee_name,
        any(\`Роль\`) AS role_primary,
        any(\`Группа\`) AS group_primary,
        uniqIf(toDate(\`Дата\`), toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')) AS shifts_count,
        sumIf(toFloat64(\`РабВремяЧас\`), toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')) AS hours_total,
        sumIf(toFloat64(\`Начислено\`), toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')) AS payroll_total,
        maxIf(\`Дата\`, toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')) AS last_shift,
        MIN(\`Дата\`) AS first_shift_in_period,
        dateDiff('day', MAX(\`Дата\`), toDate32('${v.factEnd}')) AS days_since_last_shift
      FROM db1.\`ЧикоВремя\`
      WHERE \`Имя\` IS NOT NULL
        AND \`Имя\` != ''
        AND \`Имя\` NOT LIKE '%iikoTransport%'
        AND \`Имя\` NOT LIKE '%iiko%'
        AND toDate(\`Дата\`) <= today()
      GROUP BY \`Имя\`
      HAVING dateDiff('day', MAX(\`Дата\`), toDate32('${v.factEnd}')) <= ${LEFT_STAFF_DAYS}
      ORDER BY hours_total DESC
    `;

    // Глобальный tenure: первая смена сотрудника за всю историю ЧикоВремя.
    // Нужен для отличения new от old-dormant.
    const sqlTenure = `
      SELECT
        \`Имя\` AS employee_name,
        dateDiff('day', MIN(\`Дата\`), toDate32('${v.factEnd}')) AS tenure_days
      FROM db1.\`ЧикоВремя\`
      WHERE \`Имя\` IS NOT NULL AND \`Имя\` != ''
        AND \`Имя\` NOT LIKE '%iiko%'
      GROUP BY \`Имя\`
    `;

    const sqlWorkdataThrough = `
      SELECT toString(MAX(toDate(\`Дата\`))) AS last_date
      FROM db1.\`ЧикоВремя\`
      WHERE \`Имя\` IS NOT NULL AND \`Имя\` != ''
    `;

    const [restR, payrollR, empR, tenureR, workdataR] = await Promise.all([
      ch.query(sqlRestaurant),
      ch.query(sqlPayroll),
      ch.query(sqlEmployees),
      ch.query(sqlTenure),
      ch.query(sqlWorkdataThrough),
    ]);

    const restRow = (restR.data[0] || {}) as Record<string, unknown>;
    const revenueTotal = Math.round(d(restRow.revenue_total));
    const payrollTotal = Math.round(d(((payrollR.data[0] || {}) as Record<string, unknown>).payroll_total));
    const daysWithData = Number(restRow.days_with_data) || 0;

    // Map tenure
    const tenureMap = new Map<string, number>();
    for (const row of tenureR.data) {
      const r = row as Record<string, unknown>;
      tenureMap.set(String(r.employee_name), Number(r.tenure_days) || 0);
    }

    // Классификация статусов сотрудников
    interface EmpRow {
      employee_name: string;
      role_primary: string;
      group_primary: string;
      shifts_count: number;
      hours_total: number;
      payroll_total: number;
      last_shift: string;
      first_shift_in_period: string;
      days_since_last_shift: number;
    }
    const rawEmployees = empR.data as EmpRow[];

    // Сначала отсекаем "left" по порогу LEFT_STAFF_DAYS
    const activeEmployees = rawEmployees.filter(e => Number(e.days_since_last_shift) <= LEFT_STAFF_DAYS);
    const excludedLeftCount = rawEmployees.length - activeEmployees.length;

    const employees = activeEmployees.map((e, idx) => {
      const tenure = tenureMap.get(e.employee_name) || 0;
      const shiftsCount = Number(e.shifts_count) || 0;
      const hoursTotal = d(e.hours_total);
      const payroll = d(e.payroll_total);
      const daysSince = Number(e.days_since_last_shift) || 0;
      const avgHoursPerShift = shiftsCount > 0 ? +(hoursTotal / shiftsCount).toFixed(2) : 0;
      const attendance = v.daysFact > 0 ? +(shiftsCount / v.daysFact).toFixed(2) : 0;
      const rate = hoursTotal > 0 ? Math.round(payroll / hoursTotal) : 0;

      let status: string;
      if (tenure < NEW_STAFF_DAYS) status = 'new';
      else if (daysSince > DORMANT_STAFF_DAYS) status = 'dormant';
      else if (attendance < OCCASIONAL_RATIO && tenure >= TENURE_MIN_DAYS) status = 'occasional';
      else if (shiftsCount >= v.daysFact * 0.5) status = 'core';
      else status = 'regular';

      return {
        employee_id: `emp-${idx + 1}`, // stable-ish: порядок от hours_total DESC
        employee_name: e.employee_name,
        role_primary: e.role_primary || '—',
        group_primary: e.group_primary || '-',
        tenure_days: tenure,
        shifts_count: shiftsCount,
        hours_total: +hoursTotal.toFixed(2),
        hours_avg_per_shift: avgHoursPerShift,
        attendance_rate: attendance,
        days_since_last_shift: daysSince,
        status,
        payroll_total_rub: Math.round(payroll),
        rate_effective_rub_per_hour: rate,
        pay_type: rate > 0 ? 'hourly' : 'franchise',
        rate_vs_tariff_pct: null,
        revenue_per_hour_rub: null, // Атрибуция выручки — в /api/staff-performance
        checks_per_hour: null,
        avg_check_rub: null,
        items_per_check: null,
      };
    });

    // Менеджер-менее-дней — сколько дней периода прошли без менеджера.
    const sqlNoMgr = `
      SELECT COUNT(*) AS cnt
      FROM db1.\`Чико4\`
      WHERE toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')
        AND (\`Менеджер\` IS NULL OR \`Менеджер\` = '' OR \`Менеджер\` = 'Отсутствовал')
    `;
    const noMgrR = await ch.query(sqlNoMgr);
    const daysWithoutManager = Number((noMgrR.data[0] as Record<string, unknown>)?.cnt) || 0;

    const hoursTotal = employees.reduce((s, e) => s + e.hours_total, 0);
    const activeHeadcount = employees.length;
    const newCount = employees.filter(e => e.status === 'new').length;
    const rotationPct = activeHeadcount > 0
      ? +((newCount / activeHeadcount) * 100).toFixed(1)
      : 0;

    const statusCounts: Record<string, number> = { core: 0, regular: 0, new: 0, occasional: 0, dormant: 0 };
    for (const e of employees) statusCounts[e.status] = (statusCounts[e.status] || 0) + 1;

    const groupCounts: Record<string, number> = {};
    for (const e of employees) groupCounts[e.group_primary] = (groupCounts[e.group_primary] || 0) + 1;

    const shiftsTotal = employees.reduce((s, e) => s + e.shifts_count, 0);

    return jsonResponse({
      period_stats: {
        days_in_period: v.daysInPeriod,
        days_fact: v.daysFact,
        days_with_data: daysWithData,
        revenue_total_rub: revenueTotal,
        revenue_per_day_avg_rub: v.daysFact > 0 ? Math.round(revenueTotal / v.daysFact) : 0,
        hours_total: Math.round(hoursTotal),
        shifts_total: shiftsTotal,
        payroll_total_rub: payrollTotal, // из Чико4 (включает всё)
      },
      kpi: {
        payroll_pct_of_revenue: {
          value: revenueTotal > 0 ? +((payrollTotal / revenueTotal) * 100).toFixed(1) : 0,
          numerator: payrollTotal,
          denominator: revenueTotal,
          formula: 'ФОТ за период ÷ Выручка за период × 100',
          unit: '%',
          norm: { min: 20, max: 25 },
        },
        active_headcount: {
          value: activeHeadcount,
          formula: `Сотрудников со сменой в периоде (исключая уволенных с last_shift > ${LEFT_STAFF_DAYS} дней)`,
          unit: 'чел',
        },
        revenue_per_hour_rub: {
          value: hoursTotal > 0 ? Math.round(revenueTotal / hoursTotal) : 0,
          numerator: revenueTotal,
          denominator: Math.round(hoursTotal),
          formula: 'Выручка за период ÷ Часы работы персонала',
          unit: '₽/час',
        },
        rotation_pct: {
          value: rotationPct,
          numerator: newCount,
          denominator: activeHeadcount,
          formula: 'Новых сотрудников (стаж < 30 дней) ÷ Активный состав × 100',
          unit: '%',
        },
        days_without_manager: {
          value: daysWithoutManager,
          numerator: daysWithoutManager,
          denominator: v.daysFact,
          formula: 'Дней с Менеджер=NULL/Отсутствовал ÷ Дней с данными',
          unit: 'дн',
        },
      },
      employees,
      summary: {
        active_headcount: activeHeadcount,
        total_hours: Math.round(hoursTotal),
        total_payroll: payrollTotal,
        status_counts: statusCounts,
        group_counts: groupCounts,
        excluded_left_count: excludedLeftCount,
      },
      period: { start: v.start, end: v.end, days: v.daysInPeriod, fact_end: v.factEnd, days_fact: v.daysFact },
      meta: {
        mock: false,
        pipeline_status: 'Phase 2.9.1 — real ClickHouse data',
        source: 'db1.ЧикоВремя + chicko.mart',
        left_staff_threshold_days: LEFT_STAFF_DAYS,
        workdata_through: String((workdataR.data[0] as Record<string, unknown>)?.last_date || ''),
      },
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[staff-list] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed', detail: err.message }, request, 500);
  }
}

// -----------------------------------------------------------------------------
// GET /api/staff-detail
// -----------------------------------------------------------------------------
export async function handleStaffDetail(request: Request, env: Env): Promise<Response> {
  try {
    const v = await validateCommon(request, env);
    if (v instanceof Response) return v;

    const url = new URL(request.url);
    const employeeId = url.searchParams.get('employee_id');
    if (!employeeId || employeeId.length > 100) {
      return jsonResponse({ error: 'Invalid employee_id' }, request, 400);
    }

    console.log(`[staff-detail] user=${v.user_id} rest=${v.restId} emp=${employeeId} ${v.start}..${v.end}`);

    // employee_id у нас в формате `emp-N` — порядковый номер в отсортированном списке.
    // Чтобы найти конкретного сотрудника — перезапрашиваем тот же список и берём по индексу.
    // Это не идеально (N+1 запрос при клике), но альтернативы — UUID у нас нет.
    const ch = makeClient(env);

    const match = employeeId.match(/^emp-(\d+)$/);
    if (!match) return jsonResponse({ error: 'Invalid employee_id format' }, request, 400);
    const empIdx = parseInt(match[1], 10) - 1;

    const sqlEmployees = `
      SELECT
        \`Имя\` AS employee_name,
        any(\`Роль\`) AS role_primary,
        any(\`Группа\`) AS group_primary,
        COUNT(DISTINCT \`Дата\`) AS shifts_count,
        SUM(toFloat64(\`РабВремяЧас\`)) AS hours_total,
        SUM(toFloat64(\`Начислено\`)) AS payroll_total,
        MAX(\`Дата\`) AS last_shift,
        dateDiff('day', MAX(\`Дата\`), toDate32('${v.factEnd}')) AS days_since_last_shift
      FROM db1.\`ЧикоВремя\`
      WHERE toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')
        AND \`Имя\` IS NOT NULL AND \`Имя\` != ''
      GROUP BY \`Имя\`
      HAVING shifts_count > 0
      ORDER BY hours_total DESC
    `;
    const empR = await ch.query(sqlEmployees);
    const rows = empR.data as Array<Record<string, unknown>>;

    // Фильтруем left-сотрудников, как в /api/staff-list
    const active = rows.filter(r => Number(r.days_since_last_shift) <= LEFT_STAFF_DAYS);
    if (empIdx < 0 || empIdx >= active.length) {
      return jsonResponse({ error: 'Employee not found in this period' }, request, 404);
    }
    const emp = active[empIdx];
    const empName = String(emp.employee_name);

    // Детали по сотруднику: tenure + timeline смен + атрибуция выручки
    const [tenureR, timelineR, attrR, restAggR] = await Promise.all([
      ch.query(`
        SELECT dateDiff('day', MIN(\`Дата\`), toDate32('${v.factEnd}')) AS tenure_days
        FROM db1.\`ЧикоВремя\`
        WHERE \`Имя\` = '${empName.replace(/'/g, "''")}'
      `),
      ch.query(`
        SELECT
          toDate(\`Дата\`) AS date,
          \`Роль\` AS role,
          toFloat64(\`РабВремяЧас\`) AS hours,
          toFloat64(\`Начислено\`) AS payroll
        FROM db1.\`ЧикоВремя\`
        WHERE \`Имя\` = '${empName.replace(/'/g, "''")}'
          AND toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')
        ORDER BY \`Дата\` DESC
        LIMIT 30
      `),
      // Атрибуция выручки — если этот человек был официантом в ЧикоНов3
      ch.query(`
        SELECT
          SUM(toFloat64(\`СреднийЧек\`) * toFloat64(\`КолВоЧеков\`)) AS revenue_total,
          SUM(toFloat64(\`КолВоЧеков\`)) AS checks_total,
          AVG(toFloat64(\`СреднийЧек\`)) AS avg_check
        FROM db1.\`ЧикоНов3\`
        WHERE \`Официант\` = '${empName.replace(/'/g, "''")}'
          AND toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')
      `),
      // Агрегат ресторана для contribution
      ch.query(`
        SELECT
          SUM(toFloat64(\`ВыручкаБар\`) + toFloat64(\`ВыручкаКухня\`) + toFloat64(\`ВыручкаДоставка\`)) AS revenue_total,
          SUM(toFloat64(\`Начислено\`)) AS payroll_total
        FROM db1.\`Чико4\`
        WHERE toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')
      `),
    ]);

    const tenure = Number((tenureR.data[0] as Record<string, unknown>)?.tenure_days) || 0;
    const empHours = d(emp.hours_total);
    const empPayroll = Math.round(d(emp.payroll_total));
    const empShifts = Number(emp.shifts_count);
    const attr = attrR.data[0] as Record<string, unknown> || {};
    const attrRevenue = Math.round(d(attr.revenue_total));
    const attrChecks = Math.round(d(attr.checks_total));
    const attrAvgChk = Math.round(d(attr.avg_check));

    const rest = restAggR.data[0] as Record<string, unknown> || {};
    const restRevenue = Math.round(d(rest.revenue_total));
    const restPayroll = Math.round(d(rest.payroll_total));
    // restHours — отдельно агрегируем, т.к. у сотрудников могут быть часы не в ЧикоВремя
    // для простоты считаем сумму по всем активным сотрудникам
    const sqlRestHours = `
      SELECT SUM(toFloat64(\`РабВремяЧас\`)) AS hours_total
      FROM db1.\`ЧикоВремя\`
      WHERE toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')
    `;
    const restHoursR = await ch.query(sqlRestHours);
    const restHours = d((restHoursR.data[0] as Record<string, unknown>)?.hours_total);

    const rate = empHours > 0 ? Math.round(empPayroll / empHours) : 0;
    const revPerHour = empHours > 0 && attrRevenue > 0 ? Math.round(attrRevenue / empHours) : null;
    const checksPerHour = empHours > 0 && attrChecks > 0 ? +(attrChecks / empHours).toFixed(1) : null;
    const daysSinceLast = Number(emp.days_since_last_shift) || 0;

    const timeline = (timelineR.data as Array<Record<string, unknown>>).map(r => ({
      date: String(r.date),
      role: String(r.role || '—'),
      hours: +d(r.hours).toFixed(2),
      payroll: Math.round(d(r.payroll)),
      revenue_attributed: null, // Пока не считаем дневную атрибуцию в timeline
      checks: null,
    }));

    // Классификация статуса
    let status: string;
    if (tenure < NEW_STAFF_DAYS) status = 'new';
    else if (daysSinceLast > DORMANT_STAFF_DAYS) status = 'dormant';
    else if (empShifts / Math.max(1, v.daysFact) < OCCASIONAL_RATIO && tenure >= TENURE_MIN_DAYS) status = 'occasional';
    else if (empShifts >= v.daysFact * 0.5) status = 'core';
    else status = 'regular';

    return jsonResponse({
      employee: {
        employee_id: employeeId,
        employee_name: empName,
        role_primary: emp.role_primary || '—',
        group_primary: emp.group_primary || '-',
        tenure_days: tenure,
        status,
      },
      kpi_period: {
        shifts_count: empShifts,
        hours_total: +empHours.toFixed(2),
        hours_avg_per_shift: empShifts > 0 ? +(empHours / empShifts).toFixed(2) : 0,
        days_since_last_shift: daysSinceLast,
        payroll_total_rub: empPayroll,
        rate_effective_rub_per_hour: rate,
        revenue_per_hour_rub: revPerHour,
        checks_per_hour: checksPerHour,
        avg_check_rub: attrAvgChk || null,
        items_per_check: null,
      },
      contribution: {
        hours_share_pct: restHours > 0 ? +((empHours / restHours) * 100).toFixed(1) : 0,
        hours_share_formula: `${empHours.toFixed(1)} ч ÷ ${Math.round(restHours)} ч ресторана × 100`,
        payroll_share_pct: restPayroll > 0 ? +((empPayroll / restPayroll) * 100).toFixed(1) : 0,
        payroll_share_formula: `${empPayroll.toLocaleString()} ₽ ÷ ${restPayroll.toLocaleString()} ₽ ФОТ × 100`,
        revenue_attributed_rub: attrRevenue || null,
        revenue_share_pct: attrRevenue > 0 && restRevenue > 0
          ? +((attrRevenue / restRevenue) * 100).toFixed(1)
          : null,
        revenue_share_formula: attrRevenue > 0 && restRevenue > 0
          ? `${attrRevenue.toLocaleString()} ₽ его выручки ÷ ${restRevenue.toLocaleString()} ₽ ресторана × 100`
          : null,
      },
      shifts_timeline: timeline,
      compare_to_role_median: {
        hours_total_median: null,
        revenue_per_hour_median: null,
        avg_check_median: null,
      },
      period: { start: v.start, end: v.end, days: v.daysInPeriod, fact_end: v.factEnd, days_fact: v.daysFact },
      meta: { mock: false, pipeline_status: 'Phase 2.9.1' },
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[staff-detail] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed', detail: err.message }, request, 500);
  }
}

// -----------------------------------------------------------------------------
// GET /api/staff-groups — Block 3
// -----------------------------------------------------------------------------
export async function handleStaffGroups(request: Request, env: Env): Promise<Response> {
  try {
    const v = await validateCommon(request, env);
    if (v instanceof Response) return v;

    console.log(`[staff-groups] user=${v.user_id} rest=${v.restId} ${v.start}..${v.end} daysFact=${v.daysFact}`);

    const ch = makeClient(env);

    // Агрегат по группам: headcount (уникальных активных), часы, ФОТ
    const sqlGroups = `
      SELECT
        \`Группа\` AS group_name,
        COUNT(DISTINCT \`Имя\`) AS headcount,
        SUM(toFloat64(\`РабВремяЧас\`)) AS hours_total,
        SUM(toFloat64(\`Начислено\`)) AS payroll_total
      FROM db1.\`ЧикоВремя\`
      WHERE toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')
        AND \`Имя\` IS NOT NULL AND \`Имя\` != ''
        AND \`Имя\` IN (
          SELECT \`Имя\` FROM db1.\`ЧикоВремя\`
          WHERE \`Имя\` IS NOT NULL AND \`Имя\` != ''
          GROUP BY \`Имя\`
          HAVING dateDiff('day', MAX(\`Дата\`), toDate32('${v.factEnd}')) <= ${LEFT_STAFF_DAYS}
        )
      GROUP BY \`Группа\`
      ORDER BY hours_total DESC
    `;

    // Ресторан-агрегат: выручка из mart (единый источник с Обзором), ФОТ из Чико4
    const sqlRestDaily = `
      SELECT
        report_date AS date,
        revenue_total_rub AS revenue,
        0 AS payroll
      FROM chicko.mart_restaurant_daily_base
      WHERE dept_id = ${v.restId}
        AND report_date BETWEEN '${v.start}' AND '${v.factEnd}'
      ORDER BY report_date DESC
    `;
    const sqlPayrollDaily = `
      SELECT
        toDate(\`Дата\`) AS date,
        toFloat64(\`Начислено\`) AS payroll
      FROM db1.\`Чико4\`
      WHERE toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')
      ORDER BY date DESC
    `;

    // Часы по дням — для корреляции
    const sqlHoursDaily = `
      SELECT
        toDate(\`Дата\`) AS date,
        SUM(toFloat64(\`РабВремяЧас\`)) AS hours
      FROM db1.\`ЧикоВремя\`
      WHERE toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')
      GROUP BY date
      ORDER BY date DESC
    `;

    const [grpR, restR, payrollDailyR, hoursR] = await Promise.all([
      ch.query(sqlGroups),
      ch.query(sqlRestDaily),
      ch.query(sqlPayrollDaily),
      ch.query(sqlHoursDaily),
    ]);

    const GROUP_MAP: Record<string, { code: string; display: string; revProducer: boolean }> = {
      'Кухня':    { code: 'kitchen',    display: 'Кухня',      revProducer: true  },
      'Зал':      { code: 'hall',       display: 'Зал',        revProducer: false },
      'Бар':      { code: 'bar',        display: 'Бар',        revProducer: true  },
      'Клининг':  { code: 'cleaning',   display: 'Клининг',    revProducer: false },
      '-':        { code: 'management', display: 'Менеджмент', revProducer: false },
    };

    const restDaily = restR.data as Array<Record<string, unknown>>;
    const payrollDaily = payrollDailyR.data as Array<Record<string, unknown>>;
    const revenueTotal = restDaily.reduce((s, r) => s + d(r.revenue), 0);
    const payrollTotalFromDaily = payrollDaily.reduce((s, r) => s + d(r.payroll), 0);

    const groups = (grpR.data as Array<Record<string, unknown>>)
      .map(g => {
        const rawName = String(g.group_name || '-');
        const meta = GROUP_MAP[rawName] || { code: 'other', display: rawName, revProducer: false };
        const headcount = Number(g.headcount);
        const groupHours = d(g.hours_total);
        const groupPayroll = Math.round(d(g.payroll_total));
        const payrollPct = revenueTotal > 0 ? +((groupPayroll / revenueTotal) * 100).toFixed(1) : 0;

        return {
          group_name: meta.display,
          group_code: meta.code,
          headcount,
          hours_total: Math.round(groupHours),
          payroll_total_rub: groupPayroll,
          payroll_pct_of_revenue: payrollPct,
          payroll_pct_formula: `${groupPayroll.toLocaleString()} ₽ ÷ ${Math.round(revenueTotal).toLocaleString()} ₽ × 100`,
          hours_per_person_avg: headcount > 0 ? Math.round(groupHours / headcount) : 0,
          cost_per_hour_rub: groupHours > 0 ? Math.round(groupPayroll / groupHours) : 0,
          revenue_per_hour_group_rub: meta.revProducer && groupHours > 0
            ? Math.round(revenueTotal / groupHours)
            : null,
          turnover_pct: 0, // TODO: посчитать в Phase 2.9.1b
          concentration_top30_pct: 0,
        };
      });

    // Корреляция часов и выручки — Pearson по дням
    const revByDate = new Map<string, number>();
    for (const r of restDaily) revByDate.set(String(r.date), d(r.revenue));
    const hoursByDate = new Map<string, number>();
    for (const r of hoursR.data as Array<Record<string, unknown>>) hoursByDate.set(String(r.date), d(r.hours));

    // Пересечение дат для корреляции
    const commonDates = Array.from(revByDate.keys()).filter(d => hoursByDate.has(d));
    let correlation = 0;
    if (commonDates.length > 2) {
      const xs = commonDates.map(d => hoursByDate.get(d)!);
      const ys = commonDates.map(d => revByDate.get(d)!);
      const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
      const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
      let num = 0, denX = 0, denY = 0;
      for (let i = 0; i < xs.length; i++) {
        const dx = xs[i] - meanX;
        const dy = ys[i] - meanY;
        num += dx * dy;
        denX += dx * dx;
        denY += dy * dy;
      }
      const denom = Math.sqrt(denX * denY);
      correlation = denom > 0 ? +(num / denom).toFixed(2) : 0;
    }

    const scatterDaily = commonDates.map(date => ({
      date,
      hours: +hoursByDate.get(date)!.toFixed(1),
      revenue: Math.round(revByDate.get(date)!),
    }));

    const hoursTotal = hoursR.data.reduce((s, r) => s + d((r as Record<string, unknown>).hours), 0);
    const headcountTotal = groups.reduce((s, g) => s + g.headcount, 0);

    return jsonResponse({
      groups,
      restaurant: {
        active_headcount: headcountTotal,
        payroll_total_rub: Math.round(payrollTotalFromDaily),
        revenue_total_rub: Math.round(revenueTotal),
        hours_total: Math.round(hoursTotal),
        payroll_pct_of_revenue: revenueTotal > 0
          ? +((payrollTotalFromDaily / revenueTotal) * 100).toFixed(1)
          : 0,
        payroll_pct_formula: `${Math.round(payrollTotalFromDaily).toLocaleString()} ₽ ÷ ${Math.round(revenueTotal).toLocaleString()} ₽ × 100`,
        revenue_per_hour_rub: hoursTotal > 0 ? Math.round(revenueTotal / hoursTotal) : 0,
        daily_headcount_avg: v.daysFact > 0 ? +(headcountTotal / 1).toFixed(1) : 0, // TODO точнее
        dormant_count: 0,
        rotation_pct: 0,
        tenure_avg_days: 0,
        days_without_manager: 0,
        correlation_hours_revenue: correlation,
        correlation_formula: `Pearson(дневные часы, дневная выручка) по ${commonDates.length} дням`,
      },
      scatter_daily: scatterDaily,
      period: { start: v.start, end: v.end, days: v.daysInPeriod, fact_end: v.factEnd, days_fact: v.daysFact },
      meta: { mock: false, pipeline_status: 'Phase 2.9.1' },
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[staff-groups] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed', detail: err.message }, request, 500);
  }
}

// -----------------------------------------------------------------------------
// GET /api/staff-performance — Block 4: KS-матрица официантов
// -----------------------------------------------------------------------------
export async function handleStaffPerformance(request: Request, env: Env): Promise<Response> {
  try {
    const v = await validateCommon(request, env);
    if (v instanceof Response) return v;

    console.log(`[staff-performance] user=${v.user_id} rest=${v.restId} ${v.start}..${v.end} daysFact=${v.daysFact}`);

    const ch = makeClient(env);

    // Атрибуция выручки по официантам из ЧикоНов3 + часы из ЧикоВремя.
    // Only officiant roles — они из ЧикоНов3 autoматически.
    // Используем pre-aggregated подзапросы вместо коррелированных (ClickHouse 25.3).
    const sqlPerf = `
      SELECT
        n.employee_name AS employee_name,
        w_role.role_primary AS role_primary,
        n.revenue_total AS revenue_total,
        n.checks_total AS checks_total,
        wh.hours_total AS hours_total,
        wg.last_shift_global AS last_shift_global
      FROM (
        SELECT
          \`Официант\` AS employee_name,
          SUM(toFloat64(\`СреднийЧек\`) * toFloat64(\`КолВоЧеков\`)) AS revenue_total,
          SUM(toFloat64(\`КолВоЧеков\`)) AS checks_total
        FROM db1.\`ЧикоНов3\`
        WHERE toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')
          AND \`Официант\` IS NOT NULL AND \`Официант\` != ''
          AND \`Официант\` NOT LIKE '%iikoTransport%'
          AND \`Официант\` NOT LIKE '%iiko%'
        GROUP BY \`Официант\`
      ) n
      LEFT JOIN (
        SELECT
          \`Имя\` AS employee_name,
          SUM(toFloat64(\`РабВремяЧас\`)) AS hours_total
        FROM db1.\`ЧикоВремя\`
        WHERE toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')
        GROUP BY \`Имя\`
      ) wh ON wh.employee_name = n.employee_name
      LEFT JOIN (
        SELECT
          \`Имя\` AS employee_name,
          MAX(\`Дата\`) AS last_shift_global
        FROM db1.\`ЧикоВремя\`
        GROUP BY \`Имя\`
      ) wg ON wg.employee_name = n.employee_name
      LEFT JOIN (
        SELECT
          \`Имя\` AS employee_name,
          any(\`Роль\`) AS role_primary
        FROM db1.\`ЧикоВремя\`
        GROUP BY \`Имя\`
      ) w_role ON w_role.employee_name = n.employee_name
      WHERE n.revenue_total > 0
    `;

    // Bad/good shifts из Чико4
    const sqlShifts = `
      SELECT
        toDate(\`Дата\`) AS date,
        toFloat64(\`ВыручкаБар\`) + toFloat64(\`ВыручкаКухня\`) + toFloat64(\`ВыручкаДоставка\`) AS revenue,
        toFloat64(\`Начислено\`) AS payroll,
        \`Менеджер\` AS manager
      FROM db1.\`Чико4\`
      WHERE toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')
        AND toFloat64(\`ВыручкаБар\`) + toFloat64(\`ВыручкаКухня\`) + toFloat64(\`ВыручкаДоставка\`) > 0
    `;

    const [perfR, shiftsR] = await Promise.all([
      ch.query(sqlPerf),
      ch.query(sqlShifts),
    ]);

    interface PerfRow {
      employee_name: string;
      role_primary: string;
      revenue_total: string | number;
      checks_total: string | number;
      hours_total: string | number;
      last_shift_global: string;
    }
    const rawPerf = perfR.data as unknown as PerfRow[];

    // Фильтруем left по last_shift.
    // Если last_shift_global пуст (нет данных в ЧикоВремя, но есть продажи
    // в ЧикоНов3) — включаем сотрудника: он работает, просто ещё не в графике.
    const filteredPerf = rawPerf.filter(p => {
      const lastDate = String(p.last_shift_global || '').slice(0, 10);
      if (!lastDate) return true;
      const daysSince = daysBetween(lastDate, v.factEnd);
      return daysSince <= LEFT_STAFF_DAYS;
    });

    const productive = filteredPerf.map((p, idx) => {
      const hours = d(p.hours_total);
      const revenue = d(p.revenue_total);
      const revPerH = hours > 0 ? Math.round(revenue / hours) : 0;
      return {
        employee_id: `perf-${idx + 1}`,
        employee_name: p.employee_name,
        role_primary: p.role_primary || 'Официант',
        hours_total: +hours.toFixed(2),
        revenue_per_hour_rub: revPerH,
        revenue_total_rub: Math.round(revenue),
      };
    });

    // KS-классификация по медианам
    const hoursMedian = median(productive.map(e => e.hours_total));
    const rphMedian = median(productive.map(e => e.revenue_per_hour_rub));

    const matrix = productive.map(e => {
      const highHours = e.hours_total >= hoursMedian;
      const highRph = e.revenue_per_hour_rub >= rphMedian;
      let ksClass: string;
      if (highHours && highRph) ksClass = 'star';
      else if (highHours && !highRph) ksClass = 'plowhorse';
      else if (!highHours && highRph) ksClass = 'puzzle';
      else ksClass = 'dog';
      return { ...e, ks_class: ksClass };
    });

    // Bad/good shifts
    const shiftRows = shiftsR.data as Array<Record<string, unknown>>;
    const sorted = shiftRows.map(r => ({
      date: String(r.date),
      revenue: d(r.revenue),
      payroll: d(r.payroll),
      manager: String(r.manager || 'Отсутствовал'),
      fot_pct: d(r.revenue) > 0 ? +((d(r.payroll) / d(r.revenue)) * 100).toFixed(1) : 0,
    }));

    // Квантили для bad/good
    if (sorted.length > 0) {
      const revenues = sorted.map(s => s.revenue).sort((a, b) => a - b);
      const fotPcts = sorted.map(s => s.fot_pct).sort((a, b) => a - b);
      const rP25 = revenues[Math.floor(revenues.length * 0.25)] || 0;
      const rP75 = revenues[Math.floor(revenues.length * 0.75)] || 0;
      const fP50 = fotPcts[Math.floor(fotPcts.length * 0.50)] || 0;
      const fP75 = fotPcts[Math.floor(fotPcts.length * 0.75)] || 0;

      const badShifts = sorted
        .filter(s => s.revenue < rP25 && s.fot_pct > fP75)
        .sort((a, b) => b.fot_pct - a.fot_pct)
        .slice(0, 5)
        .map(s => ({ report_date: s.date, revenue: Math.round(s.revenue), payroll: Math.round(s.payroll), fot_pct: s.fot_pct, manager: s.manager, headcount: 0 }));
      const goodShifts = sorted
        .filter(s => s.revenue > rP75 && s.fot_pct < fP50)
        .sort((a, b) => a.fot_pct - b.fot_pct)
        .slice(0, 5)
        .map(s => ({ report_date: s.date, revenue: Math.round(s.revenue), payroll: Math.round(s.payroll), fot_pct: s.fot_pct, manager: s.manager, headcount: 0 }));

      return jsonResponse({
        matrix,
        bad_shifts: badShifts,
        good_shifts: goodShifts,
        thresholds: {
          hours_median: Math.round(hoursMedian),
          rph_median: Math.round(rphMedian),
          bad_shift_rule: `ФОТ% > ${fP75.toFixed(1)} И Выручка < ${Math.round(rP25).toLocaleString()} ₽`,
          good_shift_rule: `Выручка > ${Math.round(rP75).toLocaleString()} ₽ И ФОТ% < ${fP50.toFixed(1)}`,
          popularity_rule: 'Часы >= медианы',
          profitability_rule: 'Выручка/час >= медианы',
        },
        summary: {
          total_productive_employees: productive.length,
          bad_shifts_count: badShifts.length,
          good_shifts_count: goodShifts.length,
        },
        period: { start: v.start, end: v.end, days: v.daysInPeriod, fact_end: v.factEnd, days_fact: v.daysFact },
        meta: { mock: false, pipeline_status: 'Phase 2.9.1' },
      }, request);
    }

    return jsonResponse({
      matrix, bad_shifts: [], good_shifts: [],
      thresholds: { hours_median: 0, rph_median: 0 },
      summary: { total_productive_employees: productive.length, bad_shifts_count: 0, good_shifts_count: 0 },
      period: { start: v.start, end: v.end, days: v.daysInPeriod, fact_end: v.factEnd, days_fact: v.daysFact },
      meta: { mock: false, pipeline_status: 'Phase 2.9.1' },
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[staff-performance] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed', detail: err.message }, request, 500);
  }
}

// -----------------------------------------------------------------------------
// GET /api/staff-managers — Block 5
// -----------------------------------------------------------------------------
export async function handleStaffManagers(request: Request, env: Env): Promise<Response> {
  try {
    const v = await validateCommon(request, env);
    if (v instanceof Response) return v;

    console.log(`[staff-managers] user=${v.user_id} rest=${v.restId} ${v.start}..${v.end} daysFact=${v.daysFact}`);

    const ch = makeClient(env);

    // Агрегат по менеджерам за период.
    // Потери персонала = сумма Category A статей.
    // Strong/weak shifts считаются ПОСЛЕ — когда известны p25/p75 выручки.
    const sqlMgrs = `
      SELECT
        IFNULL(\`Менеджер\`, 'Отсутствовал') AS manager_name,
        COUNT(DISTINCT toDate(\`Дата\`)) AS days_as_manager,
        SUM(toFloat64(\`ВыручкаБар\`) + toFloat64(\`ВыручкаКухня\`) + toFloat64(\`ВыручкаДоставка\`)) AS total_revenue,
        SUM(toFloat64(\`Начислено\`)) AS total_payroll,
        SUM(
          toFloat64(\`ПорчаТовараБар\`) + toFloat64(\`ПорчаТовараКухня\`) + toFloat64(\`ПорчаВитрина\`) +
          toFloat64(\`ПорчаПоВинеСотрудника\`) + toFloat64(\`УдалениеБлюдСоСписанием\`) + toFloat64(\`НедостачаИнвентаризации\`)
        ) AS losses_staff,
        avg(toFloat64(\`СрЧекОбщий\`)) AS avg_check_avg,
        avg(toFloat64(\`ФудкостОбщий\`)) AS foodcost_avg,
        avg(toFloat64(\`СкидкаОбщий\`)) AS discount_avg,
        avg(toFloat64(\`Оценка2Гис\`)) AS rating_2gis_avg,
        avg(toFloat64(\`ОценкаЯндекс\`)) AS rating_yandex_avg,
        MAX(toDate(\`Дата\`)) AS last_date_as_manager
      FROM db1.\`Чико4\`
      WHERE toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')
      GROUP BY manager_name
      HAVING days_as_manager > 0
      ORDER BY days_as_manager DESC
    `;

    // Для strong/weak — сначала возьмём все смены, посчитаем p25/p75 выручки и p50/p75 FOT%.
    const sqlAllShifts = `
      SELECT
        toDate(\`Дата\`) AS date,
        IFNULL(\`Менеджер\`, 'Отсутствовал') AS manager_name,
        toFloat64(\`ВыручкаБар\`) + toFloat64(\`ВыручкаКухня\`) + toFloat64(\`ВыручкаДоставка\`) AS revenue,
        toFloat64(\`Начислено\`) AS payroll
      FROM db1.\`Чико4\`
      WHERE toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')
    `;

    const [mgrsR, shiftsR] = await Promise.all([
      ch.query(sqlMgrs),
      ch.query(sqlAllShifts),
    ]);

    const allShifts = (shiftsR.data as Array<Record<string, unknown>>).map(r => ({
      date: String(r.date),
      manager: String(r.manager_name),
      revenue: d(r.revenue),
      payroll: d(r.payroll),
      fot_pct: d(r.revenue) > 0 ? (d(r.payroll) / d(r.revenue)) * 100 : 0,
    }));

    // Квантили
    const revs = allShifts.map(s => s.revenue).filter(x => x > 0).sort((a, b) => a - b);
    const fots = allShifts.map(s => s.fot_pct).filter(x => x > 0).sort((a, b) => a - b);
    const rP25 = revs[Math.floor(revs.length * 0.25)] || 0;
    const rP75 = revs[Math.floor(revs.length * 0.75)] || 0;
    const fP50 = fots[Math.floor(fots.length * 0.50)] || 0;
    const fP75 = fots[Math.floor(fots.length * 0.75)] || 0;

    // Для каждого менеджера считаем strong/weak
    const mgrShiftCounts = new Map<string, { strong: number; weak: number }>();
    for (const s of allShifts) {
      const entry = mgrShiftCounts.get(s.manager) || { strong: 0, weak: 0 };
      if (s.revenue > rP75 && s.fot_pct < fP50) entry.strong++;
      if (s.revenue < rP25 && s.fot_pct > fP75) entry.weak++;
      mgrShiftCounts.set(s.manager, entry);
    }

    // Медианы для классификации
    const rawMgrs = mgrsR.data as Array<Record<string, unknown>>;
    const lossPcts = rawMgrs
      .map(m => {
        const rev = d(m.total_revenue);
        const loss = d(m.losses_staff);
        return rev > 0 ? (loss / rev) * 100 : 0;
      })
      .filter(x => x > 0);
    const lossPctMedian = median(lossPcts);
    const fotPctMedian = median(rawMgrs
      .map(m => {
        const rev = d(m.total_revenue);
        const pay = d(m.total_payroll);
        return rev > 0 ? (pay / rev) * 100 : 0;
      })
      .filter(x => x > 0));
    const revPerDayMedian = median(rawMgrs
      .map(m => d(m.total_revenue) / Math.max(1, Number(m.days_as_manager)))
      .filter(x => x > 0));

    // Строим финальный ответ
    const managers = rawMgrs.map(m => {
      const name = String(m.manager_name);
      const daysAsManager = Number(m.days_as_manager) || 0;
      const totalRevenue = Math.round(d(m.total_revenue));
      const totalPayroll = Math.round(d(m.total_payroll));
      const losses = Math.round(d(m.losses_staff));
      const avgRev = daysAsManager > 0 ? Math.round(totalRevenue / daysAsManager) : 0;
      const fotPct = totalRevenue > 0 ? +((totalPayroll / totalRevenue) * 100).toFixed(2) : 0;
      const lossPct = totalRevenue > 0 ? +((losses / totalRevenue) * 100).toFixed(2) : 0;
      const shifts = mgrShiftCounts.get(name) || { strong: 0, weak: 0 };

      // Классификация
      let classification: string;
      if (name === 'Отсутствовал' || name === '') {
        classification = 'no_manager';
      } else if (daysAsManager < 10) {
        classification = 'insufficient_data';
      } else if (avgRev > revPerDayMedian && fotPct < fotPctMedian && lossPct < lossPctMedian) {
        classification = 'top';
      } else if (lossPct > lossPctMedian * 1.5 || fotPct > fotPctMedian * 1.5) {
        classification = 'concerning';
      } else if (avgRev < revPerDayMedian * 0.7) {
        classification = 'problem';
      } else {
        classification = 'reliable';
      }

      return {
        manager_name: name,
        days_as_manager: daysAsManager,
        days_in_period: v.daysFact,
        days_share_pct: v.daysFact > 0 ? +((daysAsManager / v.daysFact) * 100).toFixed(1) : 0,
        total_revenue_rub: totalRevenue,
        avg_revenue_per_day_rub: avgRev,
        avg_check_rub: Math.round(d(m.avg_check_avg)),
        fot_pct_avg: fotPct,
        fot_pct_formula: `${totalPayroll.toLocaleString()} ₽ ФОТ ÷ ${totalRevenue.toLocaleString()} ₽ выручки × 100`,
        foodcost_pct_avg: +d(m.foodcost_avg).toFixed(2),
        discount_pct_avg: +d(m.discount_avg).toFixed(2),
        rating_2gis_avg: +d(m.rating_2gis_avg).toFixed(1),
        rating_yandex_avg: +d(m.rating_yandex_avg).toFixed(1),
        losses_staff_total_rub: losses,
        losses_formula: `${losses.toLocaleString()} ₽ ÷ ${totalRevenue.toLocaleString()} ₽ × 100`,
        loss_pct_avg: lossPct,
        strong_shifts_count: shifts.strong,
        weak_shifts_count: shifts.weak,
        classification,
      };
    });

    const totalDaysCovered = managers.reduce((s, m) => s + m.days_as_manager, 0);
    const absentRow = managers.find(m => m.manager_name === 'Отсутствовал');
    const daysWithoutManager = absentRow ? absentRow.days_as_manager : 0;

    return jsonResponse({
      managers,
      summary: {
        total_managers: managers.length,
        total_days_covered: totalDaysCovered,
        days_in_period: v.daysFact,
        days_without_manager: daysWithoutManager,
        coverage_pct: v.daysFact > 0 ? +((totalDaysCovered / v.daysFact) * 100).toFixed(1) : 0,
        benchmarks: {
          fot_pct_median: +fotPctMedian.toFixed(1),
          loss_pct_median: +lossPctMedian.toFixed(2),
          revenue_per_day_median: Math.round(revPerDayMedian),
        },
      },
      period: { start: v.start, end: v.end, days: v.daysInPeriod, fact_end: v.factEnd, days_fact: v.daysFact },
      meta: { mock: false, pipeline_status: 'Phase 2.9.1' },
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[staff-managers] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed', detail: err.message }, request, 500);
  }
}

// -----------------------------------------------------------------------------
// GET /api/staff-losses — Block 6
// -----------------------------------------------------------------------------
export async function handleStaffLosses(request: Request, env: Env): Promise<Response> {
  try {
    const v = await validateCommon(request, env);
    if (v instanceof Response) return v;

    console.log(`[staff-losses] user=${v.user_id} rest=${v.restId} ${v.start}..${v.end} daysFact=${v.daysFact}`);

    const ch = makeClient(env);

    // Агрегат ресторана: выручка, потери по категориям A/B/C, инвестиции
    const sqlAgg = `
      SELECT
        SUM(toFloat64(\`ВыручкаБар\`) + toFloat64(\`ВыручкаКухня\`) + toFloat64(\`ВыручкаДоставка\`)) AS revenue_total,
        SUM(toFloat64(\`ПорчаТовараКухня\`)) AS losses_kitchen,
        SUM(toFloat64(\`ПорчаТовараБар\`)) AS losses_bar,
        SUM(toFloat64(\`ПорчаВитрина\`)) AS losses_display,
        SUM(toFloat64(\`ПорчаПоВинеСотрудника\`)) AS losses_employee,
        SUM(toFloat64(\`УдалениеБлюдСоСписанием\`)) AS losses_deletion,
        SUM(toFloat64(\`НедостачаИнвентаризации\`)) AS losses_inventory,
        SUM(
          toFloat64(\`ПорчаТовараКухня\`) + toFloat64(\`ПорчаТовараБар\`) + toFloat64(\`ПорчаВитрина\`) +
          toFloat64(\`ПорчаПоВинеСотрудника\`) + toFloat64(\`УдалениеБлюдСоСписанием\`) + toFloat64(\`НедостачаИнвентаризации\`)
        ) AS category_a_total,
        SUM(toFloat64(\`ПитаниеПерсонала\`)) AS staff_food,
        SUM(toFloat64(\`МотивацияПерсонала\`)) AS motivation,
        SUM(toFloat64(\`ПроработкаБар\`) + toFloat64(\`ПроработкаКухня\`) + toFloat64(\`ПроработкаБрендШеф\`) + toFloat64(\`КлиентскийСервис\`)) AS training,
        SUM(toFloat64(\`Представительские\`)) AS representation,
        COUNT(*) AS days
      FROM db1.\`Чико4\`
      WHERE toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')
    `;

    // Потери по менеджерам
    const sqlByMgr = `
      SELECT
        IFNULL(\`Менеджер\`, 'Отсутствовал') AS manager,
        COUNT(DISTINCT toDate(\`Дата\`)) AS days,
        SUM(toFloat64(\`ВыручкаБар\`) + toFloat64(\`ВыручкаКухня\`) + toFloat64(\`ВыручкаДоставка\`)) AS revenue_rub,
        SUM(
          toFloat64(\`ПорчаТовараКухня\`) + toFloat64(\`ПорчаТовараБар\`) + toFloat64(\`ПорчаВитрина\`) +
          toFloat64(\`ПорчаПоВинеСотрудника\`) + toFloat64(\`УдалениеБлюдСоСписанием\`) + toFloat64(\`НедостачаИнвентаризации\`)
        ) AS losses_total_rub
      FROM db1.\`Чико4\`
      WHERE toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')
      GROUP BY manager
      HAVING days > 0
      ORDER BY losses_total_rub DESC
    `;

    // Потери по дню недели (1=Пн .. 7=Вс в ClickHouse toDayOfWeek)
    const sqlByDow = `
      SELECT
        toDayOfWeek(toDate(\`Дата\`)) AS dow,
        avg(toFloat64(\`ВыручкаБар\`) + toFloat64(\`ВыручкаКухня\`) + toFloat64(\`ВыручкаДоставка\`)) AS avg_revenue,
        avg(
          toFloat64(\`ПорчаТовараКухня\`) + toFloat64(\`ПорчаТовараБар\`) + toFloat64(\`ПорчаВитрина\`) +
          toFloat64(\`ПорчаПоВинеСотрудника\`) + toFloat64(\`УдалениеБлюдСоСписанием\`) + toFloat64(\`НедостачаИнвентаризации\`)
        ) AS avg_losses
      FROM db1.\`Чико4\`
      WHERE toDate(\`Дата\`) BETWEEN toDate('${v.start}') AND toDate('${v.factEnd}')
      GROUP BY dow
      ORDER BY dow
    `;

    const [aggR, byMgrR, byDowR] = await Promise.all([
      ch.query(sqlAgg),
      ch.query(sqlByMgr),
      ch.query(sqlByDow),
    ]);

    const agg = (aggR.data[0] || {}) as Record<string, unknown>;
    const revenueTotal = Math.round(d(agg.revenue_total));
    const lossesStaffTotal = Math.round(d(agg.category_a_total));
    const staffFood = Math.round(d(agg.staff_food));
    const motivation = Math.round(d(agg.motivation));
    const training = Math.round(d(agg.training));
    const representation = Math.round(d(agg.representation));
    const staffInvestment = staffFood + motivation + training + representation;
    const daysCount = Number(agg.days) || 1;
    const shiftsApprox = daysCount * 18; // примерная оценка смен

    const lossesPct = revenueTotal > 0 ? +((lossesStaffTotal / revenueTotal) * 100).toFixed(2) : 0;
    const lossesPerShift = shiftsApprox > 0 ? Math.round(lossesStaffTotal / shiftsApprox) : 0;
    const lossesPer1k = revenueTotal > 0 ? +(lossesStaffTotal / (revenueTotal / 1000)).toFixed(2) : 0;

    const categoryATotal = lossesStaffTotal;
    const breakdown = [
      { item: 'Порча товара кухня', total_rub: Math.round(d(agg.losses_kitchen)) },
      { item: 'Порча товара бар', total_rub: Math.round(d(agg.losses_bar)) },
      { item: 'Порча витрина', total_rub: Math.round(d(agg.losses_display)) },
      { item: 'Порча (по вине сотрудника)', total_rub: Math.round(d(agg.losses_employee)) },
      { item: 'Удаление блюд со списанием', total_rub: Math.round(d(agg.losses_deletion)) },
      { item: 'Недостача инвентаризации', total_rub: Math.round(d(agg.losses_inventory)) },
    ].map(b => ({
      ...b,
      pct_of_category: categoryATotal > 0 ? +((b.total_rub / categoryATotal) * 100).toFixed(1) : 0,
    }));

    const byManager = (byMgrR.data as Array<Record<string, unknown>>).map(m => {
      const losses = Math.round(d(m.losses_total_rub));
      const revenue = Math.round(d(m.revenue_rub));
      const pct = revenue > 0 ? +((losses / revenue) * 100).toFixed(2) : 0;
      return {
        manager: String(m.manager),
        days: Number(m.days),
        losses_total_rub: losses,
        revenue_rub: revenue,
        loss_pct: pct,
        loss_formula: `${losses.toLocaleString()} ₽ ÷ ${revenue.toLocaleString()} ₽ × 100`,
      };
    });

    const dowNames = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const byDow = [1, 2, 3, 4, 5, 6, 7].map(d => {
      const row = (byDowR.data as Array<Record<string, unknown>>).find(r => Number(r.dow) === d);
      const avgRev = Math.round(row ? Number(row.avg_revenue) || 0 : 0);
      const avgLoss = Math.round(row ? Number(row.avg_losses) || 0 : 0);
      return {
        dow: d,
        day_name: dowNames[d],
        avg_revenue_rub: avgRev,
        avg_losses_rub: avgLoss,
        loss_pct: avgRev > 0 ? +((avgLoss / avgRev) * 100).toFixed(2) : 0,
      };
    });

    // Alerts
    const alerts: Array<{ severity: string; code: string; message: string }> = [];
    const medianLossPct = median(byManager.map(m => m.loss_pct).filter(p => p > 0));
    const concerning = byManager.find(m => m.loss_pct > medianLossPct * 1.5 && m.loss_pct > 1.0);
    if (concerning) {
      const delta = medianLossPct > 0 ? Math.round(((concerning.loss_pct - medianLossPct) / medianLossPct) * 100) : 0;
      alerts.push({
        severity: 'yellow',
        code: 'manager_concentrator',
        message: `${concerning.manager}: потери ${concerning.loss_pct}% vs медиана ${medianLossPct.toFixed(2)}% (+${delta}%)`,
      });
    }
    if (lossesPct > 1.5) {
      alerts.push({
        severity: 'red',
        code: 'total_losses_above_norm',
        message: `Общие потери ${lossesPct}% выше нормы 1.5% за период`,
      });
    }

    return jsonResponse({
      kpi: {
        losses_staff_total_rub: lossesStaffTotal,
        losses_staff_pct_of_revenue: lossesPct,
        losses_pct_formula: `${lossesStaffTotal.toLocaleString()} ₽ потерь ÷ ${revenueTotal.toLocaleString()} ₽ выручки × 100`,
        losses_per_shift_avg_rub: lossesPerShift,
        losses_per_shift_formula: `${lossesStaffTotal.toLocaleString()} ₽ ÷ ~${shiftsApprox} смен`,
        losses_per_1k_revenue_rub: lossesPer1k,
        production_losses_rub: 0,
        staff_investment_rub: staffInvestment,
        staff_investment_formula: `Питание ${staffFood.toLocaleString()} + Обучение ${training.toLocaleString()} + Мотивация ${motivation.toLocaleString()} + Предст. ${representation.toLocaleString()} ₽`,
        staff_food_rub: staffFood,
        staff_food_pct_of_revenue: revenueTotal > 0 ? +((staffFood / revenueTotal) * 100).toFixed(2) : 0,
        motivation_spend_rub: motivation,
        training_spend_rub: training,
        revenue_total_rub: revenueTotal,
      },
      category_a_breakdown: breakdown,
      by_manager: byManager,
      by_dow: byDow,
      alerts,
      benchmarks: {
        norm_losses_staff_pct: 1.5,
        industry_staff_food_pct: 1.0,
      },
      period: { start: v.start, end: v.end, days: v.daysInPeriod, fact_end: v.factEnd, days_fact: v.daysFact },
      meta: { mock: false, pipeline_status: 'Phase 2.9.1' },
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[staff-losses] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed', detail: err.message }, request, 500);
  }
}
