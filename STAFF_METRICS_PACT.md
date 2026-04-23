# Chicko Analytics — Раздел «Персонал», пакт метрик v2

**Статус:** v2 утверждён 2026-04-23, Phase 2.9 (session 9.2)
**Предыдущая версия:** v1 (session 9.1) — дополнена блоками 5-6 (Менеджеры, Потери), словарём ролей, флагом валидности payroll
**Зависимости:** `mart_restaurant_daily_base.is_anomaly_day`, источник iikoWeb через n8n

## Что нового в v2

Относительно v1:
- **+ Block 5 «Менеджеры и качество смен»** — раздел 13
- **+ Block 6 «Потери и риск-профиль персонала»** — раздел 14
- **+ Приложение А: словарь нормализации ролей** (`dim_role`) — раздел 15, 50 raw ролей → 15 нормализованных
- **+ Приложение Б: флаг валидности payroll** — раздел 16, payroll валиден с `2024-07-01`
- UI реструктурирован с 3 подсекций на **6 блоков**
- План фаз расширен с 2.9.0-2.9.4 на 2.9.0-2.9.6

---

## 1. Периметр и соглашения

### Входные параметры эндпойнтов

```
GET /api/staff-list        ?restaurant_id=N&start=YYYY-MM-DD&end=YYYY-MM-DD
GET /api/staff-detail      ?restaurant_id=N&employee_id=X&start=...&end=...
GET /api/staff-groups      ?restaurant_id=N&start=...&end=...
GET /api/staff-performance ?restaurant_id=N&start=...&end=...
GET /api/staff-managers    ?restaurant_id=N&start=...&end=...   -- Block 5
GET /api/staff-losses      ?restaurant_id=N&start=...&end=...   -- Block 6
```

Phase 2.9 — только single-restaurant. `network=1` — в Phase 2.10 после появления 2+ ресторанов в пайплайне.

### Фильтры источника (SQL-уровень)

Смена попадает в анализ, если:
1. `dept_uuid` совпадает с uuid выбранного ресторана
2. `report_date BETWEEN start AND end`
3. В `mart_restaurant_daily_base` для `(dept_uuid, report_date)` стоит `is_anomaly_day = 0`
4. `role NOT IN ('ТЕХ_WEB_Инвентаризация', 'iikoweb_отчеты', 'INVENTORY_IIKO_WEB')`
   *Это технические учётки, не сотрудники*
5. `employee_name != ''` — исключает пустые записи

Максимальный диапазон — `MAX_DATE_RANGE_DAYS = 400` (как в остальных endpoint-ах).

### Группы

Значения `group_name`:
- `Кухня` / `Зал` / `Бар` / `Клининг` — production-группы, показываются в UI с KPI
- `-` (прочерк) — франшиза-менеджмент, хосты, управляющие. В UI называется **«Менеджмент»**. Включается в общий ФОТ и headcount, но **не в производственные KPI** (ФОТ группы Кухня/Зал/Бар/Клининг).

### Ключ сотрудника

Развилка, зависит от наличия iiko UUID:

**Вариант А (iiko UUID):** `(employee_uuid, dept_uuid)`. Имя меняется свободно.

**Вариант Б (fallback на имя):** `employee_id = sha1(lower(strip(employee_name)) + ':' + dept_uuid)`. Нормализация имени — в пайплайне.

### Аномальные смены

Помечаем флагом `is_anomaly_shift = 1` (не удаляем), если:
- `hours_worked < 1` или `hours_worked > 20`
- `payroll_accrued_rub = 0` при `hours_worked > 0` **И** роль не из списка «бесплатных»: `Франшиза менеджер*`, `Франшиза управляющий`, `Хост` (эти получают не сдельно, а по прочим схемам)

В UI показываются отдельным тэгом, не попадают в базовые агрегаты.

---

## 2. Классификация сотрудника (5 классов)

Приоритет сверху вниз, первое совпадение фиксирует класс:

| Класс | Условие | Порог |
|---|---|---|
| `new` | Первая смена в ресторане (за всю историю) < 30 дней от `end` | `NEW_STAFF_DAYS = 30` |
| `dormant` | Дней с последней смены > 14 **и** стаж > 60 дней | `DORMANT_STAFF_DAYS = 14`, `TENURE_MIN_DAYS = 60` |
| `core` | Часов в периоде ≥ P75 по своей группе **и** стаж ≥ 60 дней | — |
| `occasional` | Смен в периоде < `0.3 × days_in_period` | `OCCASIONAL_RATIO = 0.3` |
| `regular` | Всё остальное | — |

**Почему dormant требует `tenure > 60`:** иначе всех новичков, которые вышли на 1-2 смены и не вернулись, будет считать dormant — это не информативно. Dormant — это **старичок, который слился**.

---

## 3. Сотрудник — 18 метрик

Всё считается за период `[start..end]`, кроме явно отмеченного.

### Идентификация

| # | Поле | Расчёт |
|---|---|---|
| 1.1 | `employee_name` | как есть |
| 1.2 | `role_primary` | `mode(role)` за период (если ничья — берём роль с большим `SUM(hours)`) |
| 1.3 | `group_primary` | `mode(group_name)` по тому же правилу |
| 1.4 | `tenure_days` | `end - min(report_date)` по **всей истории**, не только в периоде |

### Активность

| # | Поле | Расчёт |
|---|---|---|
| 1.5 | `shifts_count` | `count(DISTINCT report_date)` |
| 1.6 | `hours_total` | `SUM(hours_worked)` |
| 1.7 | `hours_avg_per_shift` | `hours_total / shifts_count` |
| 1.8 | `attendance_rate` | `shifts_count / days_in_period` (0..1, где 1 = каждый день) |
| 1.9 | `days_since_last_shift` | `end - max(report_date)` |
| 1.10 | `status` | `new / dormant / core / occasional / regular` — см. раздел 2 |

### Деньги

| # | Поле | Расчёт |
|---|---|---|
| 1.11 | `payroll_total_rub` | `SUM(payroll_accrued_rub)` |
| 1.12 | `rate_effective_rub_per_hour` | `payroll_total / hours_total`. Для фикс-оклада — `monthly_salary / hours_total_in_period` (показываем "эквивалентную" ставку) |
| 1.13 | `pay_type` | `hourly` / `fixed` / `mixed` — из справочника ставок |
| 1.14 | `rate_vs_tariff_pct` | Для `hourly`: `(rate_effective - rate_tariff) / rate_tariff × 100`. `rate_tariff` — из Лист5/справочника. `NULL` для `fixed` |

### Производительность (только для ролей с атрибуцией выручки)

Применимо к ролям, которые есть в sales-таблице (`staff_sales_attribution`): Официант*, Кассир*, Бармен*, Франшиза менеджер (он тоже закрывает чеки).

| # | Поле | Расчёт |
|---|---|---|
| 1.15 | `revenue_per_hour_rub` | `SUM(rev_bar + rev_kitchen) / SUM(hours_worked)`. JOIN по `(employee_id, report_date)` |
| 1.16 | `checks_per_hour` | `SUM(checks) / SUM(hours_worked)` |
| 1.17 | `avg_check_rub` | `SUM(revenue) / SUM(checks)` — **не** среднее от средних чеков |
| 1.18 | `items_per_check` | `SUM(items) / SUM(checks)` — взвешенно, тоже не среднее от средних |

Для ролей без атрибуции выручки все 1.15-1.18 возвращаются как `NULL`, в UI колонки для них показывают «—».

---

## 4. Группа — 9 метрик

Считается по 4 группам: `Кухня / Зал / Бар / Клининг`. Группа `-` (Менеджмент) показывается отдельной карточкой с упрощённым набором (только 2.1, 2.2, 2.3).

| # | Поле | Расчёт |
|---|---|---|
| 2.1 | `headcount` | `count(DISTINCT employee_id)` с ≥1 сменой в периоде |
| 2.2 | `hours_total` | `SUM(hours_worked)` |
| 2.3 | `payroll_total_rub` | `SUM(payroll_accrued_rub)` |
| 2.4 | `payroll_pct_of_revenue` | `payroll_total / restaurant_revenue_in_period × 100` |
| 2.5 | `hours_per_person_avg` | `hours_total / headcount` |
| 2.6 | `cost_per_hour_rub` | `payroll_total / hours_total` |
| 2.7 | `revenue_per_hour_group_rub` | `restaurant_revenue / hours_total_group`. **Только для Кухня и Бар** (они непосредственно создают выручку). Для Зала и Клининга — NULL. |
| 2.8 | `turnover_pct` | `(new_in_period + leavers_in_period) / avg_headcount × 100`. `new` — `min(report_date) ∈ [start..end]`. `leavers` — `max(report_date) < end - 14` но есть смены в `[start..end]` |
| 2.9 | `concentration_top30_pct` | Отсортировать сотрудников по `hours_total` убыв., взять топ-30% по числу, посчитать их сумму часов / общая. >60% = «высокая концентрация» |

---

## 5. Ресторан — 11 метрик

| # | Поле | Расчёт |
|---|---|---|
| 3.1 | `active_headcount` | `count(DISTINCT employee_id)`, status ∈ {core, regular, occasional, new} |
| 3.2 | `payroll_total_rub` | `SUM(payroll)` включая Fix_ЗП за период (месячная/30 × дни_в_периоде) |
| 3.3 | **`payroll_pct_of_revenue`** (ФОТ%) | `payroll_total / revenue_total × 100`. Революционная цифра — у Chicko ~13%, норма в отрасли 20-25% |
| 3.4 | `revenue_per_hour_rub` | `revenue_total / hours_total` |
| 3.5 | `daily_headcount_avg` | `mean(count_distinct_employees_per_day)` |
| 3.6 | `daily_headcount_dow` | `median(daily_headcount) GROUP BY dow` — профиль Пн..Вс |
| 3.7 | `dormant_count` | `count(employees WHERE status = 'dormant')` |
| 3.8 | `rotation_pct` | `(new + leavers) / active_headcount × 100` — ротация за период |
| 3.9 | `tenure_avg_days` | `mean(tenure_days)` по активным |
| 3.10 | `days_without_manager` | `count(days WHERE manager_of_the_day = 'Отсутствовал')` из `staff_day_manager` |
| 3.11 | `correlation_hours_revenue` | `pearson(daily_hours_total, daily_revenue_total)`. Ожидаем 0.5-0.8. <0.3 — проблема планирования. |

---

## 6. Матрица «Performance» — KS-аналог для сотрудников

**Применяется только к ролям с атрибуцией выручки** (см. 1.15-1.18).

Внутри **каждой роли** (не всей роли сразу — группируем по `role_primary`) считаем ранги:

- По оси **X — часы в периоде**: `rank(hours_total)` внутри роли
- По оси **Y — rev/hour**: `rank(revenue_per_hour)` внутри роли

Пороги — по аналогии с KS:
- **Популярность (X):** ≥ `(1/n_in_role) × 0.70 × 100` процент часов внутри роли = «много работает»
- **Прибыльность (Y):** `rev_per_hour ≥ mean(rev_per_hour)` внутри роли = «эффективно»

Квадранты:

| Класс | Много часов | Высокая rev/h | Смысл |
|---|---|---|---|
| `star` | ✓ | ✓ | Много работает и эффективно — береги |
| `plowhorse` | ✓ | ✗ | Много часов, но rev/h низкий. Возможно — днём / в слабые смены / в hall management |
| `puzzle` | ✗ | ✓ | Эффективный, но работает мало. Давай больше смен |
| `dog` | ✗ | ✗ | Мало работает и неэффективен. Кандидат на ротацию |

**Минимум для применения:** если в роли меньше 3 сотрудников с атрибуцией — матрица не строится, класс `too_small_role` (аналог KS `too_small`).

---

## 7. Плохие / хорошие смены (метрика 4.3)

Считается по дням периода. Вычисляем 4 перцентиля на уровне ресторана:

- `fot_pct_p75` — 75-й перцентиль ФОТ% по дням
- `fot_pct_p50` — медиана
- `revenue_p75` / `revenue_p25` — перцентили дневной выручки

Классификация дня:

| Класс | Условие | Цвет в UI |
|---|---|---|
| `bad` | `fot_pct > fot_pct_p75` **и** `revenue < revenue_p25` | красный |
| `good` | `revenue > revenue_p75` **и** `fot_pct < fot_pct_p50` | зелёный |
| `neutral` | всё остальное | серый |

В UI показываем таблицу **топ-5 bad и top-5 good** с колонками: дата / ФОТ день / выручка / ФОТ% / менеджер / число людей. Клик по строке → детализация смены (кто работал, какие роли).

---

## 8. Схема ClickHouse (предложение)

### Новые таблицы

```sql
-- Основная таблица смен (аналог chicko.dish_sales)
CREATE TABLE chicko.staff_shifts (
  report_date       Date,
  dept_uuid         String,
  dept_id           Int32,
  restaurant_name   String,
  employee_id       String,            -- UUID из iiko ИЛИ sha1(name+dept)
  employee_name     String,
  role              String,
  group_name        String,             -- Кухня/Зал/Бар/Клининг/-
  shift_start       Nullable(DateTime),
  shift_end         Nullable(DateTime),
  hours_worked      Float64,
  rate_rub_per_hour Nullable(Float64),  -- NULL для фикс-окладов
  payroll_accrued_rub Float64,
  pay_type          Enum8('hourly'=1, 'fixed'=2, 'free'=3),
  is_anomaly_shift  UInt8 DEFAULT 0,
  inserted_at       DateTime DEFAULT now(),
  source_system     String DEFAULT 'iikoweb+n8n'
) ENGINE = ReplacingMergeTree(inserted_at)
ORDER BY (dept_uuid, report_date, employee_id);

-- Атрибуция выручки по сотрудникам (аналог Chiko3)
CREATE TABLE chicko.staff_sales_attribution (
  report_date       Date,
  dept_uuid         String,
  employee_id       String,
  employee_name     String,
  revenue_bar_rub   Float64,
  revenue_kitchen_rub Float64,
  checks            Int32,
  items             Int32,             -- ИЛИ хранить avg_items_per_check
  inserted_at       DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(inserted_at)
ORDER BY (dept_uuid, report_date, employee_id);

-- Справочник фикс-окладов (Fix_ЗП)
CREATE TABLE chicko.staff_fixed_salaries (
  employee_id       String,
  dept_uuid         String,
  employee_name     String,
  role              String,
  monthly_salary_rub Float64,
  valid_from        Date,
  valid_to          Nullable(Date),    -- NULL = действует сейчас
  inserted_at       DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(inserted_at)
ORDER BY (dept_uuid, employee_id, valid_from);

-- Справочник тарифов по ролям (Лист5)
CREATE TABLE chicko.staff_role_tariffs (
  dept_uuid         String,
  role              String,
  tariff_rub_per_hour Nullable(Float64),
  tariff_monthly_rub  Nullable(Float64),
  valid_from        Date,
  inserted_at       DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(inserted_at)
ORDER BY (dept_uuid, role, valid_from);

-- Менеджер дня (из Chiko4.Менеджер)
CREATE TABLE chicko.staff_day_manager (
  report_date       Date,
  dept_uuid         String,
  manager_employee_id Nullable(String),
  manager_name      String,            -- может быть 'Отсутствовал'
  is_absent         UInt8 DEFAULT 0,
  inserted_at       DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(inserted_at)
ORDER BY (dept_uuid, report_date);
```

### Почему ReplacingMergeTree

Пайплайн n8n грузит с overwrites (вчерашний день может прилететь ещё раз с поправкой). `ReplacingMergeTree(inserted_at)` оставит самую свежую строку по ключу сортировки.

---

## 9. API — контракт ответов

### `GET /api/staff-list`

```json
{
  "employees": [
    {
      "employee_id": "abc123",
      "employee_name": "Полникова Анастасия",
      "role_primary": "Франшиза менеджер (Свободный график)",
      "group_primary": "-",
      "tenure_days": 680,
      "shifts_count": 16,
      "hours_total": 196.2,
      "hours_avg_per_shift": 12.26,
      "attendance_rate": 0.53,
      "days_since_last_shift": 5,
      "status": "core",
      "payroll_total_rub": 0,
      "rate_effective_rub_per_hour": 0,
      "pay_type": "free",
      "rate_vs_tariff_pct": null,
      "revenue_per_hour_rub": 11925,
      "checks_per_hour": 8.8,
      "avg_check_rub": 1411,
      "items_per_check": 5.9
    }
  ],
  "summary": {
    "active_headcount": 35,
    "total_hours": 4205,
    "total_payroll": 1578340,
    "status_counts": {"core": 12, "regular": 14, "new": 3, "occasional": 4, "dormant": 2},
    "group_counts": {"Кухня": 15, "Зал": 8, "Бар": 3, "Клининг": 5, "-": 4}
  }
}
```

### `GET /api/staff-groups`

```json
{
  "groups": [
    {
      "group_name": "Кухня",
      "headcount": 15, "hours_total": 2100, "payroll_total_rub": 850000,
      "payroll_pct_of_revenue": 8.3, "hours_per_person_avg": 140,
      "cost_per_hour_rub": 404, "revenue_per_hour_group_rub": 4900,
      "turnover_pct": 13.3, "concentration_top30_pct": 62
    }
  ],
  "restaurant": {
    "active_headcount": 35,
    "payroll_total_rub": 2100000,
    "revenue_total_rub": 16200000,
    "payroll_pct_of_revenue": 13.0,
    "revenue_per_hour_rub": 2832,
    "daily_headcount_avg": 18.6,
    "daily_headcount_dow": {"1": 17, "2": 18, "3": 18, "4": 19, "5": 22, "6": 24, "7": 21},
    "dormant_count": 2, "rotation_pct": 14, "tenure_avg_days": 245,
    "days_without_manager": 3,
    "correlation_hours_revenue": 0.72
  }
}
```

### `GET /api/staff-performance`

```json
{
  "matrix_dishes_equivalent": [
    {
      "employee_id": "abc", "employee_name": "Полникова Анастасия",
      "role_primary": "Франшиза менеджер (Свободный график)",
      "hours_total": 196, "revenue_per_hour_rub": 11925,
      "ks_class": "star"
    }
  ],
  "bad_shifts": [
    {"report_date": "2026-04-10", "revenue": 120000, "payroll": 58000, "fot_pct": 48.3,
     "manager": "Гусева Кристина", "headcount": 22}
  ],
  "good_shifts": [...],
  "summary": {
    "ks_counts_by_role": {
      "Официант": {"star": 3, "plowhorse": 5, "puzzle": 2, "dog": 4, "too_small_role": 0}
    }
  }
}
```

---

## 10. План реализации Phase 2.9

| Подфаза | Что делаем | Критерий готовности |
|---|---|---|
| 2.9.0 | Скелет `staff.ts` с 4 endpoints, заглушки данных в KV | `curl /api/staff-list` возвращает JSON с демо-данными |
| 2.9.1 | Пайплайн n8n: iikoWeb → `staff_shifts`, `staff_sales_attribution`, `staff_fixed_salaries`, `staff_day_manager` | `SELECT count() FROM chicko.staff_shifts` ≥ 13 000 |
| 2.9.2 | UI таб «Персонал» — **Состав** (таблица + drawer) | Тип смен отображается, клик → история |
| 2.9.3 | UI — **Группы** (4 карточки + корреляция scatter) | ФОТ% видно, scatter рисуется |
| 2.9.4 | UI — **Производительность** (KS-матрица + плохие смены) | Клик по квадранту → фильтр таблицы |
| **2.9.5** | UI — **Менеджеры** (Block 5) — 8 карточек менеджеров дня | Рейтинг менеджеров + «сильные/слабые смены» |
| **2.9.6** | UI — **Потери** (Block 6) — риск-профиль, 10+ статей | Разрезы: по менеджеру / дню недели / группе |
| 2.10 | Network-mode + бенчмарки сети | `network=1` возвращает агрегаты, UI показывает vs сеть |
| 2.11 | Прогнозный модуль (норматив, «переперсонал/недоперсонал») | При плановой выручке X → нужен Y-состав и Z-ФОТ |

---

## 11. Backlog (не делаем в Phase 2.9)

1. Скоринг сотрудников (как `mart_restaurant_scores` для ресторанов) — нужны 3+ месяца истории и обратная связь от франчайзи
2. Корреляция NPS × менеджер — в Chiko4 есть оценки 2Гис/Яндекс, можно посчитать
3. Погода × персонал (в Chiko4 есть «Темп», «Дождь/Ясно»)
4. Подсказка «оптимальный состав смены» — ML, не сейчас
5. Чаевые — данных нет
6. Больничные/отпуска — нужна отдельная интеграция с HR
7. Миграция staff_id с sha1(name) на iiko UUID — если пайплайн изначально на именах

---

## 12. Открытые вопросы на ревью

1. **Роль «Франшиза менеджер»** — они не получают почасовую оплату, но работают много. Куда их относить: в `pay_type=fixed` (правда, fixed-salary у них нет в Fix_ЗП) или создать новый класс `pay_type=revenue_share` и пометить «получают % от выручки ресторана»? Сейчас классифицированы как `free`.
2. **Группа `-`** — точно ли все франшиза-менеджеры там? В данных вижу: Франшиза управляющий, Франшиза менеджер, Менеджер франшиза, Хост. Последние (хосты) — это всё-таки Зал функционально. Решение: оставляем как есть, в UI отдельная карточка «Менеджмент».
3. **Пересечение имён между files** — «ШЕК Виктория» есть в Chiko3 (sales), но нет в worktime. Ошибка? Уволилась? Или ошибка в iiko? Пока обрабатываем как `revenue_orphan` — атрибуция выручки без привязки к смене.
4. **Fix_ЗП в ФОТ%** — учитываем прорейт за период (monthly/30 × days_in_period), но это даёт размытую цифру. Альтернатива — показывать ФОТ% в двух вариантах: «операционный» (только сдельные) и «полный» (вкл. Fix_ЗП).

Эти вопросы закрываем на ревью перед Phase 2.9.0.

---

## 13. Block 5 — Менеджеры и качество смен

Источник: Chiko4 колонка `Менеджер` — по одному менеджеру на день ресторана. В данных 8 уникальных значений, включая `Отсутствовал` (дни без менеджера).

### 13.1 Эндпойнт

```
GET /api/staff-managers?restaurant_id=N&start=YYYY-MM-DD&end=YYYY-MM-DD
```

### 13.2 Метрики по менеджеру

За период `[start..end]`, по дням, где `(dept_uuid, report_date).is_anomaly_day = 0`:

| # | Поле | Формула |
|---|---|---|
| 5.1 | `manager_name` | as-is |
| 5.2 | `days_as_manager` | `count(DISTINCT report_date)` |
| 5.3 | `total_revenue_rub` | `SUM(revenue_bar + revenue_kitchen + revenue_delivery)` |
| 5.4 | `avg_revenue_per_day_rub` | `total_revenue / days_as_manager` |
| 5.5 | `avg_check_rub` | `SUM(revenue) / SUM(checks)` — взвешенно, не mean(avg_check) |
| 5.6 | `fot_pct_avg` | `mean(daily_payroll / daily_revenue × 100)` |
| 5.7 | `foodcost_pct_avg` | `mean(Фудкост общий, %)` по его дням |
| 5.8 | `discount_pct_avg` | `mean(Скидка общий, %)` |
| 5.9 | `rating_2gis_avg` | `mean(Оценка 2Гис)` в его дни |
| 5.10 | `rating_yandex_avg` | `mean(Оценка Яндекс)` |
| 5.11 | `losses_staff_total_rub` | `SUM(порча_бар + порча_кухня + порча_сотрудник + недостача + удаление_блюд)` |
| 5.12 | `loss_pct_avg` | `losses_total / revenue_total × 100` |
| 5.13 | `strong_shifts_count` | `count(days WHERE revenue > p75 AND fot_pct < p50)` — число «хороших» смен |
| 5.14 | `weak_shifts_count` | `count(days WHERE revenue < p25 AND fot_pct > p75)` — число «плохих» смен |

### 13.3 Реперные цифры из данных (период 2024-05..2026-04)

Для ориентира, как это выглядит на реальных данных твоего ресторана:

| Менеджер | Дни | Ср.выручка/день | ФОТ% | Потери% | Ср.чек |
|---|---|---|---|---|---|
| Амоян Али Игоревич | 234 | 419к ₽ | 12.8% | 0.79% | 1377 |
| Емельянова Анастасия | 200 | 315к ₽ | 15.5% | 0.61% | 1438 |
| Долорет Флоренс | 159 | 478к ₽ | 9.1% | 1.45% | 1250 |
| Полникова Анастасия | 61 | 248к ₽ | 15.2% | 0.52% | 1518 |
| Голубцова Римма | 42 | 243к ₽ | 17.3% | 0.74% | 1374 |
| Гусева Кристина | 16 | 555к ₽ | 1.6% | 1.38% | 1109 |
| **Отсутствовал** | **7** | 396к ₽ | 12.9% | 0.90% | 1359 |
| Менеджер доставки | 1 | 222к ₽ | 17.3% | 0.67% | 1419 |

**Интересные наблюдения**, которые UI должен подсвечивать:
- Долорет — высокая выручка, но FOT% аномально низкий (9%) **и** потери в 2× больше медианы
- Гусева — один из двух топов по выручке, но FOT 1.6% — сильно похоже на **данные неполны** в её дни
- 7 дней «Отсутствовал» — прямая метрика 3.10 (`days_without_manager`)

### 13.4 Классификация менеджера

| Класс | Условие | Цвет |
|---|---|---|
| `top` | `avg_revenue > p75` **и** `fot_pct < median` **и** `loss_pct < median` | зелёный |
| `reliable` | все 3 метрики в интерквартильном размахе | серый |
| `concerning` | любые 2 из: `fot_pct > p75`, `loss_pct > p75`, `rating < median` | жёлтый |
| `problem` | `avg_revenue < p25` **или** все 3 вышеперечисленные в красной зоне | красный |

**Важно:** классификация требует ≥ 10 дней как менеджер, иначе класс `insufficient_data`.

### 13.5 UI

Таблица 8 карточек менеджеров (по числу значений в данных), сортировка по `days_as_manager` убыв. Клик по карточке → **drawer** с:
- Список «сильных смен» (топ-10 по выручке)
- Список «слабых смен» (топ-10 по FOT% или потерям)
- Scatter `daily_revenue × fot_pct` с его точками
- Тренд выручки/день по его сменам
- Сравнение с медианой всех менеджеров

---

## 14. Block 6 — Потери и риск-профиль

Источник: Chiko4, 10+ статей расходов, которые прямо или косвенно завязаны на персонал. Chiko4 отдаёт ежедневные суммы рублей по статьям.

### 14.1 Эндпойнт

```
GET /api/staff-losses?restaurant_id=N&start=YYYY-MM-DD&end=YYYY-MM-DD
```

### 14.2 Учитываемые статьи

**Категория A — «прямые потери персонала»** (входят в `losses_staff`):

| Статья Chiko4 | Что это |
|---|---|
| `Порча (по вине сотрудника)` | Явно персональная ответственность. **Ключевая метрика** |
| `Порча товара бар ` | Коллективная, но группа ясная |
| `Порча товара кухня` | — |
| `Недостача инвентаризации` | Коллективная ответственность смены |
| `Удаление блюд со списанием` | Ошибки персонала при приёме заказов |
| `Порча витрина` | Зал |

**Категория B — «неизбежные производственные потери»** (показываются отдельно):

| Статья | Что это |
|---|---|
| `ПРОИЗВОДСТВЕННЫЕ ПОТЕРИ` | Естественный ужар/обрезь |
| `Списания ивент бар`, `Списания ивент кухня` | Нераспроданные ивент-блюда |
| `Дегустация бар`, `Дегустация кухня` | Дегустации новых позиций |

**Категория C — «инвестиции в персонал»** (не потери, но расход связан):

| Статья | Что это |
|---|---|
| `Питание персонала` | Стаф |
| `Мотивация персонала` | Бонусы, премии |
| `Проработка Бренд-шеф`, `Проработка Бар`, `Проработка кухня ` | Обучение/ротация новых блюд |
| `Клиентский сервис` | Тренинги, обучение |

### 14.3 Метрики

Все считаются за период:

| # | Поле | Формула | Категория |
|---|---|---|---|
| 6.1 | `losses_staff_total_rub` | `SUM(категория A)` | A |
| 6.2 | `losses_staff_pct_of_revenue` | `losses_staff / revenue × 100` | A |
| 6.3 | `losses_per_shift_avg_rub` | `losses_staff / total_shifts` | A |
| 6.4 | `losses_per_1k_revenue_rub` | `losses_staff / (revenue / 1000)` | A |
| 6.5 | `production_losses_rub` | `SUM(категория B)` | B |
| 6.6 | `staff_investment_rub` | `SUM(категория C)` | C |
| 6.7 | `staff_food_pct_of_revenue` | `Питание персонала / revenue × 100` | C |
| 6.8 | `motivation_spend_rub` | `Мотивация персонала` | C |
| 6.9 | `training_spend_rub` | `SUM(Проработка* + Клиентский сервис)` | C |

### 14.4 Разрезы (UI)

1. **По менеджеру дня** — table `manager × losses_staff_total`, сортировка по сумме убыв.
2. **По дню недели** — bar chart `dow (1..7) × avg_losses_per_day`
3. **По группе** — разделение `Порча бар` / `Порча кухня` / `Порча по вине сотрудника` → аттрибуция по группам
4. **По месяцам** — тренд losses/1k revenue, скользящее среднее 4 недели
5. **Тепловая карта** — `manager × category_A_item` по месяцам

### 14.5 Сигналы (автоматические флаги)

В UI карточке «Потери» наверху — список тревог:

| Сигнал | Условие |
|---|---|
| 🔴 `losses_staff_pct > 2%` за последние 30 дней | выше нормы |
| 🟡 `losses_staff_pct > median + 1σ` в отдельный день | выброс |
| 🔴 `Порча (по вине сотрудника) > 0` 3+ дня подряд | систематическая проблема |
| 🟡 Конкретный менеджер выше сети/среднего по ресторану на 50%+ | «концентратор потерь» |

### 14.6 Реперные цифры из данных (2024-05..2026-04)

Суммарно за 720 дней:
- Потери категории A: **~2.55 млн ₽** (Порча бар 823к + Порча кухня 1478к + Порча-сотрудник 87к + Удаления 13к + Витрина 155к)
- Производственные потери (B): **~180к ₽**
- Инвестиции в персонал (C): **~2.57 млн ₽** (Питание 1.83 млн + Клиентский сервис 453к + Проработки 150к + Мотивация 82к + Представительские 51к)

Относительно выручки 230 млн:
- **losses_staff_pct ≈ 1.1%** по всей истории (**норма < 1.5%**)
- **staff_investment_pct ≈ 1.1%** от выручки

Это **базовые значения** для сравнения при выборе периода — «твой месяц vs среднее по истории».

---

## 15. Приложение А: словарь нормализации ролей

Исходные 50 ролей в worktime нормализуются в **15 канонических**. Словарь живёт в ClickHouse-таблице `chicko.staff_role_dictionary` с возможностью перегенерации при появлении новых ролей.

### 15.1 Схема таблицы

```sql
CREATE TABLE chicko.staff_role_dictionary (
  role_raw           String,         -- точное значение из iiko
  role_normalized    String,         -- каноническое
  pay_type           Enum8('hourly'=1, 'fixed'=2, 'free'=3, 'franchise'=4),
  group_canonical    Enum8('Kitchen'=1, 'Hall'=2, 'Bar'=3, 'Cleaning'=4, 'Management'=5, 'Tech'=6),
  seniority          Enum8('junior'=1, 'mid'=2, 'senior'=3, 'lead'=4),
  is_productive      UInt8,          -- участвует ли в KS-матрице (выручка атрибутируется)
  is_excluded        UInt8,          -- ТЕХ_WEB и т.п. — скрывать из UI
  valid_from         Date DEFAULT '2024-01-01',
  inserted_at        DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(inserted_at)
ORDER BY (role_raw);
```

### 15.2 Словарь (seed)

| role_raw | role_normalized | pay_type | group | seniority | productive | excluded |
|---|---|---|---|---|---|---|
| Повар | Повар | hourly | Kitchen | mid | 0 | 0 |
| Повар (Свободный график) | Повар | hourly | Kitchen | mid | 0 | 0 |
| Повар Суп ТЕСТ КЛГ | Повар | hourly | Kitchen | mid | 0 | 0 |
| Повар Корн-дог ТЕСТ КЛГ | Повар | hourly | Kitchen | mid | 0 | 0 |
| Повар Чикен ТЕСТ КЛГ | Повар | hourly | Kitchen | mid | 0 | 0 |
| Повар Десерт ТЕСТ КЛГ | Повар | hourly | Kitchen | mid | 0 | 0 |
| Повар Ролл ТЕСТ КЛГ | Повар | hourly | Kitchen | mid | 0 | 0 |
| Повар Токпокки ТЕСТ КЛГ | Повар | hourly | Kitchen | mid | 0 | 0 |
| Повар ФК ТЕСТ КЛГ | Повар | hourly | Kitchen | mid | 0 | 0 |
| повар Заготовщик | Повар | hourly | Kitchen | junior | 0 | 0 |
| Су Шеф | Су-шеф | fixed | Kitchen | senior | 0 | 0 |
| Су Шеф (Свободный график) | Су-шеф | fixed | Kitchen | senior | 0 | 0 |
| Шеф повар | Шеф-повар | fixed | Kitchen | lead | 0 | 0 |
| Шеф повар (Свободный график) | Шеф-повар | fixed | Kitchen | lead | 0 | 0 |
| Комплектовщик | Комплектовщик | hourly | Kitchen | mid | 0 | 0 |
| Комплектовщик (Свободный график) | Комплектовщик | hourly | Kitchen | mid | 0 | 0 |
| Бармен | Бармен | hourly | Bar | mid | 1 | 0 |
| Бармен (Свободный график) | Бармен | hourly | Bar | mid | 1 | 0 |
| Старший бармен | Старший бармен | hourly | Bar | senior | 1 | 0 |
| Старший бармен (Свободный график) | Старший бармен | hourly | Bar | senior | 1 | 0 |
| Официант франшиза | Официант | hourly | Hall | mid | 1 | 0 |
| Франшиза официант | Официант | hourly | Hall | mid | 1 | 0 |
| Франшиза официант (Свободный график) | Официант | hourly | Hall | mid | 1 | 0 |
| официант | Официант | hourly | Hall | mid | 1 | 0 |
| НН-1 Официант | Официант | hourly | Hall | junior | 1 | 0 |
| Кассир | Кассир | hourly | Hall | mid | 1 | 0 |
| Кассир Франшиза | Кассир | hourly | Hall | mid | 1 | 0 |
| Франшиза Кассир | Кассир | hourly | Hall | mid | 1 | 0 |
| Франшиза Кассир (Свободный график) | Кассир | hourly | Hall | mid | 1 | 0 |
| Кассир фаст-фуда | Кассир | hourly | Hall | junior | 1 | 0 |
| Стажер Зал | Стажёр зала | hourly | Hall | junior | 0 | 0 |
| Хост | Хост | hourly | Hall | mid | 0 | 0 |
| Хост (Свободный график) | Хост | hourly | Hall | mid | 0 | 0 |
| Посудомойщица | Посудомойщица | hourly | Cleaning | junior | 0 | 0 |
| Сотрудник | Клининг | hourly | Cleaning | mid | 0 | 0 |
| Сотрудник(Свободный график) | Клининг | hourly | Cleaning | mid | 0 | 0 |
| Сотрудник(По расписанию) | Клининг | hourly | Cleaning | mid | 0 | 0 |
| Сотрудник(Оклад) | Клининг | fixed | Cleaning | mid | 0 | 0 |
| Франшиза менеджер | Менеджер смены | franchise | Management | senior | 1 | 0 |
| Франшиза менеджер (Свободный график) | Менеджер смены | franchise | Management | senior | 1 | 0 |
| Менеджер франшиза | Менеджер смены | franchise | Management | senior | 1 | 0 |
| Менеджер | Менеджер смены | fixed | Management | senior | 0 | 0 |
| Франшиза управляющий | Управляющий | franchise | Management | lead | 0 | 0 |
| Управляющий | Управляющий | fixed | Management | lead | 0 | 0 |
| Управляющий франшиза | Управляющий | franchise | Management | lead | 0 | 0 |
| Системный администратор | IT | fixed | Management | mid | 0 | 0 |
| Грузчик | Грузчик | fixed | Management | junior | 0 | 0 |
| ТЕХ_WEB_Инвентаризация | — | — | Tech | — | 0 | **1** |
| iikoweb_отчеты | — | — | Tech | — | 0 | **1** |
| INVENTORY_IIKO_WEB | — | — | Tech | — | 0 | **1** |

### 15.3 Правила применения

1. Все SQL-запросы **всегда** джойнятся с `staff_role_dictionary` по `role_raw`
2. `WHERE is_excluded = 0` — базовый фильтр для всех UI-запросов
3. Группировка в UI — по `role_normalized`, не по `role_raw`
4. При появлении новой роли в iiko (которой нет в словаре) — fallback на `role_normalized = role_raw`, запись попадает в "Требуют разметки" в админ-тулзе (пока не делаем)

### 15.4 pay_type

- **`hourly`** — сдельная, часовая ставка из `Лист5`
- **`fixed`** — оклад из `Fix_ЗП` (9 человек)
- **`franchise`** — франшиза-роли, получают по своей схеме (возможно, % от выручки). В worktime у них `Начислено=0`, ФОТ учитывается отдельно через франшизу-пул. **В Phase 2.9 считаем их ФОТ=0 и флажком выделяем в UI.**
- **`free`** — технические учётки, вообще не платятся

---

## 16. Приложение Б: флаг валидности payroll

### 16.1 Проблема

Анализ worktime показывает, что начисления (`Начислено`) заполнены неоднородно по времени:

| Период | avg_rate ₽/час | Комментарий |
|---|---|---|
| 2024-05 | **12.2** | ❌ Данные битые — ставки нереалистично низкие |
| 2024-06 | **11.6** | ❌ То же |
| 2024-07 → текущая дата | 254-291 | ✅ Нормальные ставки |

Причина: в iikoWeb начисления загружались задним числом, для первых двух месяцев проекта они не попали в выгрузку.

### 16.2 Решение

Ввести per-restaurant константу `payroll_data_valid_from`:

```sql
CREATE TABLE chicko.staff_data_validity (
  dept_uuid                  String,
  dept_id                    Int32,
  payroll_data_valid_from    Date,     -- дата, с которой начисления валидны
  sales_attribution_valid_from Date,   -- дата, с которой Chiko3 атрибуция валидна
  notes                      String,
  inserted_at                DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(inserted_at)
ORDER BY dept_uuid;
```

Для текущего ресторана:
```
payroll_data_valid_from      = 2024-07-01
sales_attribution_valid_from = 2024-05-08  -- первая дата в Chiko3
```

### 16.3 Применение в SQL и UI

**В SQL:** метрики, зависящие от payroll (ФОТ%, cost_per_hour, rate_effective и т.п.):

```sql
SELECT ...
FROM chicko.staff_shifts s
JOIN chicko.staff_data_validity v ON s.dept_uuid = v.dept_uuid
WHERE s.report_date >= v.payroll_data_valid_from
  AND s.report_date BETWEEN @start AND @end
```

Для метрик, не зависящих от payroll (часы, headcount, смены) — фильтр не применяется.

**В UI:** если выбранный период `[start..end]` частично попадает в невалидный диапазон:
- Показываем баннер-предупреждение сверху: «Данные начислений доступны с 2024-07-01. Показатели ФОТ% и эффективной ставки рассчитываются только с этой даты.»
- Метрики, зависящие от payroll, считаются только для валидной части периода
- В summary API ответа — флаг `payroll_data_partial: true` и поле `payroll_valid_from`

### 16.4 Механизм обновления

Когда пайплайн в будущем дольёт недостающие начисления (или выявятся новые «дыры»), Alex вручную обновляет строку в `staff_data_validity`:

```sql
INSERT INTO chicko.staff_data_validity VALUES (
  'uuid-...', 50, '2024-05-01', '2024-05-08',
  'payroll backfilled 2026-05-01, see n8n workflow log', now()
);
```

`ReplacingMergeTree` применит последнюю запись, SQL-запросы автоматически подхватят.

---

## 17. Сводная архитектура 6 блоков UI

Итоговая структура таба «Персонал» в `dashboard.html`:

```
┌─────────────────────────────────────────────────────────────────┐
│ Персонал • Период: [2026-03-01 .. 2026-04-20] • Ресторан: X    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Block 1 — OVERVIEW                                             │
│  ┌───────┬───────┬───────┬───────┬───────┐                      │
│  │ ФОТ%  │ HC    │ ₽/час │ Ротац.│ Без-М │  ← 5 KPI-карточек   │
│  │ 13.0% │  35   │ 2832  │ 14%   │  7 д. │                      │
│  └───────┴───────┴───────┴───────┴───────┘                      │
│  [тренд часов/ФОТ/labor% — line chart]                          │
│  [heatmap: день × неделя]                                       │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Block 2 — ШТАТ И СМЕНЫ                                         │
│  [Таблица 35 активных сотрудников, 9 колонок, фильтры]          │
│  [Матрица роль × день недели]  [Топ переработчиков]             │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Block 3 — ФОТ И ЭКОНОМИКА ТРУДА                                │
│  [4 карточки групп: Кухня / Зал / Бар / Клининг]                │
│  [+ карточка «Менеджмент» (группа `-`)]                         │
│  [Scatter: hours × revenue daily]                               │
│  [labor_per_check, labor_per_1k_revenue]                        │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Block 4 — ПРОИЗВОДИТЕЛЬНОСТЬ (официанты, бармены, кассиры)     │
│  [KS-матрица 2×2 star/plowhorse/puzzle/dog]                     │
│  [Таблица бад-смен / гуд-смен]                                  │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Block 5 — МЕНЕДЖЕРЫ И КАЧЕСТВО СМЕН                            │
│  [Таблица 8 карточек менеджеров дня]                            │
│  [Классификация: top/reliable/concerning/problem]               │
│  Клик → drawer (сильные/слабые смены, scatter)                  │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Block 6 — ПОТЕРИ И РИСК-ПРОФИЛЬ                                │
│  [3 KPI: losses_staff_%, losses/shift, investment_%]            │
│  [Сигналы-алерты 🔴🟡]                                          │
│  [Разрез: по менеджеру × статье] (heatmap)                      │
│  [Тренд losses_pct по месяцам]                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Порядок блоков — от общего к частному, от операционного к аналитическому. Франчайзи-директор скроллит сверху вниз, начиная с KPI, и доходит до потерь только если видит сигнал на верхних уровнях.
