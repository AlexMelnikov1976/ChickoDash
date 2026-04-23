// Chicko Analytics — Staff Analysis endpoints (Phase 2.9.0 skeleton)
// © 2026 System360 by Alex Melnikov. All rights reserved.
// Proprietary software — unauthorized copying or distribution prohibited.
//
// Реализация раздела «Персонал». Полная спецификация — в STAFF_METRICS_PACT.md.
//
// 6 endpoints, все требуют session cookie (chicko_session, HttpOnly),
// rate-limit 60/min/user через MAGIC_LINKS KV:
//
//   GET /api/staff-list        — Block 1+2: overview + состав (таблица сотрудников)
//   GET /api/staff-detail      — drawer отдельного сотрудника: история смен + KPI
//   GET /api/staff-groups      — Block 3: 4 карточки групп + ресторанные агрегаты
//   GET /api/staff-performance — Block 4: KS-матрица + bad/good shifts
//   GET /api/staff-managers    — Block 5: рейтинг менеджеров дня
//   GET /api/staff-losses      — Block 6: потери + риск-профиль
//
// ⚠️ PHASE 2.9.0 ЗАГЛУШКИ: все endpoints возвращают моковые данные, имитирующие
// ожидаемую форму ответа. Реальные SQL-запросы будут подключены в Phase 2.9.1
// после наполнения chicko.staff_shifts и остальных таблиц через n8n pipeline.
// Моки построены на реальных цифрах из анализа Chiko_worktime/Chiko3/Chiko4.

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

// --- Общие пороги (см. пакт раздел 2) ---
const NEW_STAFF_DAYS = 30;
const DORMANT_STAFF_DAYS = 14;
const TENURE_MIN_DAYS = 60;
const OCCASIONAL_RATIO = 0.3;

// --- Общая валидация параметров ---
interface ValidatedInput {
  restId: number;
  start: string;
  end: string;
  user_id: string;
  email: string;
}

/**
 * Единая валидация: auth + rate-limit + restaurant_id + даты + диапазон.
 * Возвращает либо валидные значения, либо готовый Response с ошибкой.
 * Используется всеми 6 handlers — DRY.
 */
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

  const span = daysBetween(start, end);
  if (span > MAX_DATE_RANGE_DAYS) {
    return jsonResponse({ error: `Date range too wide (max ${MAX_DATE_RANGE_DAYS} days, got ${span})` }, request, 400);
  }

  return { restId, start, end, user_id: a.user_id, email: a.email };
}

// -----------------------------------------------------------------------------
// GET /api/staff-list
// -----------------------------------------------------------------------------
// Block 1 (Overview KPI) + Block 2 (таблица сотрудников).
// Возвращает список активных сотрудников за период + summary.
// См. пакт разделы 3-5, 17 (Block 1, Block 2).
export async function handleStaffList(request: Request, env: Env): Promise<Response> {
  try {
    const v = await validateCommon(request, env);
    if (v instanceof Response) return v;

    console.log(`[staff-list] user=${v.user_id} rest=${v.restId} ${v.start}..${v.end}`);

    // ⚠️ MOCK: цифры взяты из анализа Chiko_worktime.xlsx за последние 30 дней
    const mockEmployees = [
      {
        employee_id: 'mock-1', employee_name: 'Рустамова Умеда',
        role_primary: 'Повар', group_primary: 'Кухня',
        tenure_days: 480, shifts_count: 24, hours_total: 271.68,
        hours_avg_per_shift: 11.32, attendance_rate: 0.80, days_since_last_shift: 4,
        status: 'core',
        payroll_total_rub: 102966.72, rate_effective_rub_per_hour: 379, pay_type: 'hourly',
        rate_vs_tariff_pct: 72.3,
        revenue_per_hour_rub: null, checks_per_hour: null, avg_check_rub: null, items_per_check: null,
      },
      {
        employee_id: 'mock-2', employee_name: 'Полникова Анастасия',
        role_primary: 'Франшиза менеджер', group_primary: '-',
        tenure_days: 720, shifts_count: 16, hours_total: 196.20,
        hours_avg_per_shift: 12.26, attendance_rate: 0.53, days_since_last_shift: 5,
        status: 'core',
        payroll_total_rub: 0, rate_effective_rub_per_hour: 0, pay_type: 'franchise',
        rate_vs_tariff_pct: null,
        revenue_per_hour_rub: 11925, checks_per_hour: 8.8, avg_check_rub: 1411, items_per_check: 5.9,
      },
      {
        employee_id: 'mock-3', employee_name: 'Емельянова Анастасия',
        role_primary: 'Франшиза менеджер', group_primary: '-',
        tenure_days: 650, shifts_count: 16, hours_total: 193.37,
        hours_avg_per_shift: 12.09, attendance_rate: 0.53, days_since_last_shift: 0,
        status: 'core',
        payroll_total_rub: 0, rate_effective_rub_per_hour: 0, pay_type: 'franchise',
        rate_vs_tariff_pct: null,
        revenue_per_hour_rub: 10850, checks_per_hour: 7.9, avg_check_rub: 1491, items_per_check: 6.2,
      },
      {
        employee_id: 'mock-4', employee_name: 'Ларионова Полина',
        role_primary: 'Бармен', group_primary: 'Бар',
        tenure_days: 380, shifts_count: 17, hours_total: 202.72,
        hours_avg_per_shift: 11.92, attendance_rate: 0.57, days_since_last_shift: 4,
        status: 'core',
        payroll_total_rub: 70575, rate_effective_rub_per_hour: 348, pay_type: 'hourly',
        rate_vs_tariff_pct: 58.2,
        revenue_per_hour_rub: null, checks_per_hour: null, avg_check_rub: null, items_per_check: null,
      },
      {
        employee_id: 'mock-5', employee_name: 'Сенина Анна',
        role_primary: 'Кассир', group_primary: 'Зал',
        tenure_days: 210, shifts_count: 20, hours_total: 167.28,
        hours_avg_per_shift: 8.36, attendance_rate: 0.67, days_since_last_shift: 4,
        status: 'core',
        payroll_total_rub: 48009, rate_effective_rub_per_hour: 287, pay_type: 'hourly',
        rate_vs_tariff_pct: 43.5,
        revenue_per_hour_rub: 8930, checks_per_hour: 6.1, avg_check_rub: 1463, items_per_check: 5.2,
      },
    ];

    return jsonResponse({
      employees: mockEmployees,
      summary: {
        active_headcount: 35,
        total_hours: 4205,
        total_payroll: 1578340,
        status_counts: { core: 12, regular: 14, new: 3, occasional: 4, dormant: 2 },
        group_counts: { 'Кухня': 15, 'Зал': 8, 'Бар': 3, 'Клининг': 5, '-': 4 },
      },
      kpi: {
        // Block 1 — 5 главных KPI
        payroll_pct_of_revenue: 13.0,
        active_headcount: 35,
        revenue_per_hour_rub: 2832,
        rotation_pct: 14,
        days_without_manager: 7,
      },
      period: { start: v.start, end: v.end, days: daysBetween(v.start, v.end) },
      meta: {
        mock: true,
        pipeline_status: 'Phase 2.9.0 skeleton — data pipeline not yet connected',
        payroll_data_valid_from: '2024-07-01',
      },
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[staff-list] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed' }, request, 500);
  }
}

// -----------------------------------------------------------------------------
// GET /api/staff-detail?employee_id=X
// -----------------------------------------------------------------------------
// Drawer отдельного сотрудника: полная карточка + история смен + графики.
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

    return jsonResponse({
      employee: {
        employee_id: employeeId,
        employee_name: 'Полникова Анастасия',
        role_primary: 'Франшиза менеджер',
        group_primary: '-',
        tenure_days: 720,
        first_shift_ever: '2024-05-11',
        last_shift: '2026-04-18',
        status: 'core',
      },
      kpi_period: {
        shifts_count: 16,
        hours_total: 196.20,
        hours_avg_per_shift: 12.26,
        days_since_last_shift: 5,
        payroll_total_rub: 0,
        rate_effective_rub_per_hour: 0,
        revenue_per_hour_rub: 11925,
        checks_per_hour: 8.8,
        avg_check_rub: 1411,
      },
      shifts_timeline: [
        // ⚠️ MOCK: пример 3 последних смен
        { date: '2026-04-18', role: 'Франшиза менеджер', hours: 11.98, payroll: 0, revenue_attributed: 142830, checks: 89 },
        { date: '2026-04-17', role: 'Франшиза менеджер', hours: 12.15, payroll: 0, revenue_attributed: 168250, checks: 112 },
        { date: '2026-04-15', role: 'Франшиза менеджер', hours: 12.28, payroll: 0, revenue_attributed: 155900, checks: 98 },
      ],
      compare_to_role_median: {
        hours_total_median: 180,
        revenue_per_hour_median: 10800,
        avg_check_median: 1380,
      },
      meta: { mock: true, pipeline_status: 'Phase 2.9.0 skeleton' },
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[staff-detail] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed' }, request, 500);
  }
}

// -----------------------------------------------------------------------------
// GET /api/staff-groups
// -----------------------------------------------------------------------------
// Block 3: метрики по 4 группам + ресторанные агрегаты (ФОТ%, корреляция).
// См. пакт раздел 4 (группа) и раздел 5 (ресторан).
export async function handleStaffGroups(request: Request, env: Env): Promise<Response> {
  try {
    const v = await validateCommon(request, env);
    if (v instanceof Response) return v;

    console.log(`[staff-groups] user=${v.user_id} rest=${v.restId} ${v.start}..${v.end}`);

    // ⚠️ MOCK: 4 production-группы + 1 карточка Менеджмента
    const mockGroups = [
      {
        group_name: 'Кухня', group_code: 'kitchen',
        headcount: 15, hours_total: 2100, payroll_total_rub: 850000,
        payroll_pct_of_revenue: 8.3, hours_per_person_avg: 140,
        cost_per_hour_rub: 404, revenue_per_hour_group_rub: 4900,
        turnover_pct: 13.3, concentration_top30_pct: 62,
      },
      {
        group_name: 'Зал', group_code: 'hall',
        headcount: 8, hours_total: 820, payroll_total_rub: 245000,
        payroll_pct_of_revenue: 2.4, hours_per_person_avg: 102,
        cost_per_hour_rub: 299, revenue_per_hour_group_rub: null,
        turnover_pct: 25.0, concentration_top30_pct: 58,
      },
      {
        group_name: 'Бар', group_code: 'bar',
        headcount: 3, hours_total: 480, payroll_total_rub: 160000,
        payroll_pct_of_revenue: 1.6, hours_per_person_avg: 160,
        cost_per_hour_rub: 333, revenue_per_hour_group_rub: 8200,
        turnover_pct: 0, concentration_top30_pct: 71,
      },
      {
        group_name: 'Клининг', group_code: 'cleaning',
        headcount: 5, hours_total: 620, payroll_total_rub: 195000,
        payroll_pct_of_revenue: 1.9, hours_per_person_avg: 124,
        cost_per_hour_rub: 315, revenue_per_hour_group_rub: null,
        turnover_pct: 20.0, concentration_top30_pct: 55,
      },
      {
        group_name: 'Менеджмент', group_code: 'management',
        headcount: 4, hours_total: 640, payroll_total_rub: 230000,
        payroll_pct_of_revenue: 2.2, hours_per_person_avg: 160,
        cost_per_hour_rub: 359, revenue_per_hour_group_rub: null,
        turnover_pct: 0, concentration_top30_pct: 80,
      },
    ];

    return jsonResponse({
      groups: mockGroups,
      restaurant: {
        active_headcount: 35,
        payroll_total_rub: 2100000,
        revenue_total_rub: 16200000,
        payroll_pct_of_revenue: 13.0,
        revenue_per_hour_rub: 2832,
        daily_headcount_avg: 18.6,
        daily_headcount_dow: { '1': 17, '2': 18, '3': 18, '4': 19, '5': 22, '6': 24, '7': 21 },
        dormant_count: 2,
        rotation_pct: 14,
        tenure_avg_days: 245,
        days_without_manager: 3,
        correlation_hours_revenue: 0.72,
      },
      scatter_daily: [
        // ⚠️ MOCK: 5 точек для scatter hours × revenue (3.11)
        { date: '2026-04-14', hours: 189, revenue: 340000 },
        { date: '2026-04-15', hours: 215, revenue: 410000 },
        { date: '2026-04-16', hours: 198, revenue: 385000 },
        { date: '2026-04-17', hours: 243, revenue: 475000 },
        { date: '2026-04-18', hours: 260, revenue: 520000 },
      ],
      period: { start: v.start, end: v.end, days: daysBetween(v.start, v.end) },
      meta: { mock: true, pipeline_status: 'Phase 2.9.0 skeleton' },
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[staff-groups] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed' }, request, 500);
  }
}

// -----------------------------------------------------------------------------
// GET /api/staff-performance
// -----------------------------------------------------------------------------
// Block 4: KS-матрица для productive ролей (официанты/кассиры/бармены)
// + bad/good shifts.
// См. пакт раздел 6 (KS-матрица) и раздел 7 (плохие/хорошие смены).
export async function handleStaffPerformance(request: Request, env: Env): Promise<Response> {
  try {
    const v = await validateCommon(request, env);
    if (v instanceof Response) return v;

    console.log(`[staff-performance] user=${v.user_id} rest=${v.restId} ${v.start}..${v.end}`);

    // ⚠️ MOCK: KS-матрица по 5 сотрудникам с атрибуцией выручки
    const mockMatrix = [
      {
        employee_id: 'mock-2', employee_name: 'Полникова Анастасия', role_primary: 'Менеджер смены',
        hours_total: 196, hours_rank: 1, revenue_per_hour_rub: 11925, rev_per_hour_rank: 1,
        ks_class: 'star',
      },
      {
        employee_id: 'mock-3', employee_name: 'Емельянова Анастасия', role_primary: 'Менеджер смены',
        hours_total: 193, hours_rank: 2, revenue_per_hour_rub: 10850, rev_per_hour_rank: 2,
        ks_class: 'star',
      },
      {
        employee_id: 'mock-5', employee_name: 'Сенина Анна', role_primary: 'Кассир',
        hours_total: 167, hours_rank: 3, revenue_per_hour_rub: 8930, rev_per_hour_rank: 4,
        ks_class: 'plowhorse',
      },
      {
        employee_id: 'mock-6', employee_name: 'Моравец Лаура', role_primary: 'Кассир',
        hours_total: 143, hours_rank: 4, revenue_per_hour_rub: 9850, rev_per_hour_rank: 3,
        ks_class: 'star',
      },
      {
        employee_id: 'mock-7', employee_name: 'Кахановская Алиса', role_primary: 'Официант',
        hours_total: 98, hours_rank: 5, revenue_per_hour_rub: 7650, rev_per_hour_rank: 5,
        ks_class: 'dog',
      },
    ];

    const mockBadShifts = [
      { report_date: '2026-04-10', revenue: 120000, payroll: 58000, fot_pct: 48.3,
        manager: 'Гусева Кристина', headcount: 22 },
      { report_date: '2026-04-03', revenue: 145000, payroll: 61000, fot_pct: 42.1,
        manager: 'Долорет Флоренс', headcount: 24 },
    ];

    const mockGoodShifts = [
      { report_date: '2026-04-18', revenue: 520000, payroll: 58000, fot_pct: 11.2,
        manager: 'Амоян Али Игоревич', headcount: 20 },
      { report_date: '2026-04-11', revenue: 495000, payroll: 56000, fot_pct: 11.3,
        manager: 'Амоян Али Игоревич', headcount: 19 },
    ];

    return jsonResponse({
      matrix: mockMatrix,
      bad_shifts: mockBadShifts,
      good_shifts: mockGoodShifts,
      summary: {
        ks_counts_by_role: {
          'Менеджер смены': { star: 2, plowhorse: 0, puzzle: 0, dog: 0, too_small_role: 0 },
          'Кассир': { star: 1, plowhorse: 1, puzzle: 0, dog: 0, too_small_role: 0 },
          'Официант': { star: 0, plowhorse: 0, puzzle: 0, dog: 1, too_small_role: 2 },
        },
        total_productive_employees: 5,
        bad_shifts_count: 2,
        good_shifts_count: 2,
      },
      thresholds: {
        ks_popularity_threshold: 'fair_share * 0.70',  // см. пакт 6
        bad_shift: 'fot_pct > p75 AND revenue < p25',
        good_shift: 'revenue > p75 AND fot_pct < p50',
      },
      period: { start: v.start, end: v.end, days: daysBetween(v.start, v.end) },
      meta: { mock: true, pipeline_status: 'Phase 2.9.0 skeleton' },
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[staff-performance] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed' }, request, 500);
  }
}

// -----------------------------------------------------------------------------
// GET /api/staff-managers
// -----------------------------------------------------------------------------
// Block 5: рейтинг менеджеров дня + классификация top/reliable/concerning/problem.
// См. пакт раздел 13.
export async function handleStaffManagers(request: Request, env: Env): Promise<Response> {
  try {
    const v = await validateCommon(request, env);
    if (v instanceof Response) return v;

    console.log(`[staff-managers] user=${v.user_id} rest=${v.restId} ${v.start}..${v.end}`);

    // ⚠️ MOCK: реальные цифры из Chiko4 за всю историю
    const mockManagers = [
      {
        manager_name: 'Амоян Али Игоревич',
        days_as_manager: 234, total_revenue_rub: 97996857,
        avg_revenue_per_day_rub: 418789, avg_check_rub: 1377,
        fot_pct_avg: 12.84, foodcost_pct_avg: 25.61, discount_pct_avg: 3.57,
        rating_2gis_avg: 4.8, rating_yandex_avg: 5.0,
        losses_staff_total_rub: 816755, loss_pct_avg: 0.79,
        strong_shifts_count: 45, weak_shifts_count: 8,
        classification: 'reliable',
      },
      {
        manager_name: 'Емельянова Анастасия',
        days_as_manager: 200, total_revenue_rub: 63018616,
        avg_revenue_per_day_rub: 315093, avg_check_rub: 1438,
        fot_pct_avg: 15.50, foodcost_pct_avg: 22.99, discount_pct_avg: 4.05,
        rating_2gis_avg: 4.8, rating_yandex_avg: 5.0,
        losses_staff_total_rub: 331285, loss_pct_avg: 0.61,
        strong_shifts_count: 38, weak_shifts_count: 12,
        classification: 'reliable',
      },
      {
        manager_name: 'Долорет Флоренс',
        days_as_manager: 159, total_revenue_rub: 75931252,
        avg_revenue_per_day_rub: 477555, avg_check_rub: 1250,
        fot_pct_avg: 9.13, foodcost_pct_avg: 28.20, discount_pct_avg: 3.38,
        rating_2gis_avg: 4.8, rating_yandex_avg: 5.0,
        losses_staff_total_rub: 977471, loss_pct_avg: 1.45,
        strong_shifts_count: 52, weak_shifts_count: 18,
        // Аномально низкий FOT% (9%) + высокие потери (1.45%, 2× медианы) → concerning
        classification: 'concerning',
      },
      {
        manager_name: 'Полникова Анастасия',
        days_as_manager: 61, total_revenue_rub: 15113290,
        avg_revenue_per_day_rub: 247758, avg_check_rub: 1518,
        fot_pct_avg: 15.25, foodcost_pct_avg: 22.77, discount_pct_avg: 6.61,
        rating_2gis_avg: 4.8, rating_yandex_avg: 5.0,
        losses_staff_total_rub: 68398, loss_pct_avg: 0.52,
        strong_shifts_count: 15, weak_shifts_count: 6,
        classification: 'reliable',
      },
      {
        manager_name: 'Голубцова Римма',
        days_as_manager: 42, total_revenue_rub: 10197743,
        avg_revenue_per_day_rub: 242803, avg_check_rub: 1374,
        fot_pct_avg: 17.33, foodcost_pct_avg: 21.57, discount_pct_avg: 5.00,
        rating_2gis_avg: 4.8, rating_yandex_avg: 5.0,
        losses_staff_total_rub: 64409, loss_pct_avg: 0.74,
        strong_shifts_count: 8, weak_shifts_count: 5,
        classification: 'reliable',
      },
      {
        manager_name: 'Гусева Кристина',
        days_as_manager: 16, total_revenue_rub: 8872372,
        avg_revenue_per_day_rub: 554523, avg_check_rub: 1109,
        fot_pct_avg: 1.59, foodcost_pct_avg: 28.09, discount_pct_avg: 2.29,
        rating_2gis_avg: 4.8, rating_yandex_avg: 5.0,
        losses_staff_total_rub: 119901, loss_pct_avg: 1.38,
        strong_shifts_count: 4, weak_shifts_count: 1,
        // FOT 1.6% — скорее всего данные payroll неполны в её дни → insufficient
        classification: 'insufficient_data',
      },
      {
        manager_name: 'Отсутствовал',
        days_as_manager: 7, total_revenue_rub: 2770424,
        avg_revenue_per_day_rub: 395774, avg_check_rub: 1359,
        fot_pct_avg: 12.92, foodcost_pct_avg: 27.21, discount_pct_avg: 4.41,
        rating_2gis_avg: 4.8, rating_yandex_avg: 5.0,
        losses_staff_total_rub: 21471, loss_pct_avg: 0.90,
        strong_shifts_count: 2, weak_shifts_count: 1,
        // Особый статус — дни без менеджера
        classification: 'no_manager',
      },
      {
        manager_name: 'Менеджер доставки',
        days_as_manager: 1, total_revenue_rub: 221814,
        avg_revenue_per_day_rub: 221814, avg_check_rub: 1419,
        fot_pct_avg: 17.31, foodcost_pct_avg: 22.08, discount_pct_avg: 9.59,
        rating_2gis_avg: 4.8, rating_yandex_avg: 5.0,
        losses_staff_total_rub: 1479, loss_pct_avg: 0.67,
        strong_shifts_count: 0, weak_shifts_count: 0,
        classification: 'insufficient_data',
      },
    ];

    return jsonResponse({
      managers: mockManagers,
      summary: {
        total_managers: 8,
        total_days: 720,
        days_without_manager: 7,
        benchmarks: {
          fot_pct_median: 13.0,
          loss_pct_median: 0.82,
          revenue_per_day_median: 380000,
        },
      },
      period: { start: v.start, end: v.end, days: daysBetween(v.start, v.end) },
      meta: { mock: true, pipeline_status: 'Phase 2.9.0 skeleton' },
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[staff-managers] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed' }, request, 500);
  }
}

// -----------------------------------------------------------------------------
// GET /api/staff-losses
// -----------------------------------------------------------------------------
// Block 6: потери по 3 категориям (A/B/C), разрезы по менеджерам и дням недели.
// См. пакт раздел 14.
export async function handleStaffLosses(request: Request, env: Env): Promise<Response> {
  try {
    const v = await validateCommon(request, env);
    if (v instanceof Response) return v;

    console.log(`[staff-losses] user=${v.user_id} rest=${v.restId} ${v.start}..${v.end}`);

    // ⚠️ MOCK: агрегаты из Chiko4 за всю историю 720 дней
    return jsonResponse({
      kpi: {
        losses_staff_total_rub: 2553488,
        losses_staff_pct_of_revenue: 1.11,
        losses_per_shift_avg_rub: 188,
        losses_per_1k_revenue_rub: 11.10,
        production_losses_rub: 179760,
        staff_investment_rub: 2568719,
        staff_food_pct_of_revenue: 0.80,
        motivation_spend_rub: 81874,
        training_spend_rub: 602864,
      },
      category_a_breakdown: [
        { item: 'Порча товара кухня', total_rub: 1477812, pct_of_category: 57.9 },
        { item: 'Порча товара бар', total_rub: 822707, pct_of_category: 32.2 },
        { item: 'Порча витрина', total_rub: 155316, pct_of_category: 6.1 },
        { item: 'Порча (по вине сотрудника)', total_rub: 87311, pct_of_category: 3.4 },
        { item: 'Удаление блюд со списанием', total_rub: 13340, pct_of_category: 0.5 },
        { item: 'Недостача инвентаризации', total_rub: 0, pct_of_category: 0 },
      ],
      by_manager: [
        { manager: 'Долорет Флоренс', losses_total_rub: 977471, loss_pct: 1.45, days: 159 },
        { manager: 'Амоян Али Игоревич', losses_total_rub: 816755, loss_pct: 0.79, days: 234 },
        { manager: 'Емельянова Анастасия', losses_total_rub: 331285, loss_pct: 0.61, days: 200 },
        { manager: 'Гусева Кристина', losses_total_rub: 119901, loss_pct: 1.38, days: 16 },
        { manager: 'Полникова Анастасия', losses_total_rub: 68398, loss_pct: 0.52, days: 61 },
        { manager: 'Голубцова Римма', losses_total_rub: 64409, loss_pct: 0.74, days: 42 },
        { manager: 'Отсутствовал', losses_total_rub: 21471, loss_pct: 0.90, days: 7 },
        { manager: 'Менеджер доставки', losses_total_rub: 1479, loss_pct: 0.67, days: 1 },
      ],
      by_dow: [
        // ⚠️ MOCK: среднее потерь по дню недели (1=Пн..7=Вс)
        { dow: 1, day_name: 'Пн', avg_losses_rub: 2500, avg_revenue_rub: 280000, loss_pct: 0.89 },
        { dow: 2, day_name: 'Вт', avg_losses_rub: 2700, avg_revenue_rub: 295000, loss_pct: 0.92 },
        { dow: 3, day_name: 'Ср', avg_losses_rub: 2900, avg_revenue_rub: 310000, loss_pct: 0.94 },
        { dow: 4, day_name: 'Чт', avg_losses_rub: 3200, avg_revenue_rub: 340000, loss_pct: 0.94 },
        { dow: 5, day_name: 'Пт', avg_losses_rub: 4500, avg_revenue_rub: 480000, loss_pct: 0.94 },
        { dow: 6, day_name: 'Сб', avg_losses_rub: 5200, avg_revenue_rub: 560000, loss_pct: 0.93 },
        { dow: 7, day_name: 'Вс', avg_losses_rub: 4100, avg_revenue_rub: 420000, loss_pct: 0.98 },
      ],
      alerts: [
        // ⚠️ MOCK: пример сигналов из пакта 14.5
        { severity: 'yellow', code: 'manager_concentrator',
          message: 'Долорет Флоренс: потери 1.45% vs медиана 0.82% (+77%)' },
      ],
      benchmarks: {
        norm_losses_staff_pct: 1.5,
        industry_staff_food_pct: 1.0,
      },
      period: { start: v.start, end: v.end, days: daysBetween(v.start, v.end) },
      meta: { mock: true, pipeline_status: 'Phase 2.9.0 skeleton' },
    }, request);
  } catch (error) {
    const err = error as Error;
    console.error(`[staff-losses] error: ${err.message}`, err.stack);
    return jsonResponse({ error: 'Request failed' }, request, 500);
  }
}
