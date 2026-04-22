# Chicko Analytics — Паспорт проекта

**Версия:** v3.35
**Дата обновления:** 22.04.2026, день-7, вечер
**Коммит:** Phase 2.7.3 — menu-analysis backend v4 готов, closes backend work for Menu tab
**Focus:** Следующий шаг — рефакторинг dashboard.ts (Вариант A) и UI вкладки «Меню»

---

## Контекст проекта

Аналитический дашборд для сети ресторанов Chicko. Основной пользователь — франчайзи. Использование: контроль KPI своего ресторана, сравнение с сетью, прогноз выручки, анализ меню, рекомендации для роста.

Презентация франчайзи состоялась 22.04.2026 (сегодня/вчера, день-6). Сейчас готовимся к пилоту. Критические функции должны работать стабильно, новые фичи добавляются без поломки существующих.

## Продакшн и инфраструктура

- **Prod URL:** https://chicko-api-proxy.chicko-api.workers.dev
- **Repo:** github.com/AlexMelnikov1976/chicko-api-proxy
- **Локальный путь:** `~/Developer/chicko-api-proxy`
- **Хост для Worker:** Cloudflare Workers (free tier + Custom domain в планах)
- **База данных:** ClickHouse в Yandex Cloud MDB
- **KV хранилище:** два Cloudflare KV namespace — USERS (whitelist), MAGIC_LINKS (токены, rate-limits, CSP reports)
- **Email:** Resend API (отправка magic-link писем)
- **AI:** Anthropic API (Claude Sonnet 4) — для `/api/ai-insight`
- **Оркестрация:** n8n (загрузка данных из Chicko POS в ClickHouse)

Окружение разработки: macOS / zsh, Claude Max plan.

## Стек

- **Worker:** TypeScript + `@cloudflare/workers-types`
- **Deploy:** `wrangler deploy` (из CLI)
- **Auth:** JWT (`@tsndr/cloudflare-worker-jwt`) + HttpOnly session cookie, TTL 7 дней
- **Data fetch:** ClickHouse HTTP interface, `FORMAT JSON`
- **Client:** статический HTML/CSS/JS, отдаётся Worker'ом из `dashboard.ts` как one-page app
- **Charts:** Chart.js (загружается из CDN)

## Архитектура эндпойнтов

**Публичные (без auth):**
- `POST /api/auth/request-link` — запросить magic-link
- `GET /api/auth/verify` — верифицировать токен, выдать session cookie
- `POST /api/csp-report` — приём CSP violation reports
- `GET /` — отдаёт DASHBOARD_HTML (SPA)

**Авторизованные (требуют chicko_session cookie):**
- `POST /api/auth/logout` — очистить сессию
- `GET /api/restaurants?full_history=0|1` — список ресторанов и их time-series
- `GET /api/benchmarks?start=…&end=…` — медиана и топ-10 сети за период
- `GET /api/restaurant-meta?restaurant_id=N` — скор + рекомендации
- `GET /api/dow-profiles?restaurant_id=N` — 90-дневный DOW-профиль
- `GET /api/forecast?restaurant_id=N | network=1` — прогноз месяца через Алгоритм Г
- `GET /api/menu-analysis?…` — анализ меню по Kasavana-Smith (подробно ниже)
- `POST /api/ai-insight` — AI-анализ ресторана через Claude (временно отключён на UI)
- `POST /api/feedback` — обратная связь от пользователей

Все авторизованные эндпойнты:
- Читают `chicko_session` cookie, валидируют JWT
- Проходят rate-limit (60/мин для data, 5/5мин для AI, 10/мин для feedback)
- Пишут в `chicko.user_activity_log` через `ctx.waitUntil` (не блокирует ответ)
- Возвращают CORS-заголовки с явным `Access-Control-Allow-Credentials: true`

## Что задеплоено (по фазам)

### Phase 1 — MVP
Базовый дашборд с выборкой ресторана, KPI, графиками, списком рекомендаций. К моменту презентации был на проде. Работает на реальных данных 64 ресторанов.

### Phase 2.1-2.2 — DOW profiles, Forecast на сервер
Перенесены с клиента на сервер расчёт DOW-профилей (медианы по дням недели за 90 дней) и прогноз месяца (Алгоритм Г — гибрид: медианы текущего месяца / прошлогодние × YoY / 90-дневный DOW-fallback).

### Phase 2.3 — Server-side data endpoints
`/api/restaurants`, `/api/benchmarks`, `/api/restaurant-meta`. До этого клиент лез в ClickHouse через общий `/api/query` — убран из соображений безопасности.

### Phase 2.4 (a/b/c/d) — Security hardening (post-audit)
- **2.4a:** `requireJwtSecret`, строгий парсинг ID и дат (`parsePositiveIntStrict`, `parseIsoDate`), ограничение диапазона (`MAX_DATE_RANGE_DAYS = 400`)
- **2.4b:** rate-limiting через KV fixed-window counters, fail-open
- **2.4c:** CSP report endpoint с дедупликацией в KV (прежде чем переключать на enforce-режим)
- **2.4d:** миграция с `Authorization: Bearer` на HttpOnly session cookie; `checkOrigin` для state-changing POST

### Phase 2.5 — User activity log
Клиентский `trackUI()` + серверный `logActivity` в `chicko.user_activity_log` (ClickHouse). Пишется через `ctx.waitUntil`, fail-silent. Позволяет понять реальное поведение франчайзи в дашборде.

### Phase 2.6 — AI insight
`POST /api/ai-insight` принимает KPI ресторана, отправляет в Claude Sonnet 4 с system prompt «совет директоров». Возвращает структурированный JSON с анализом от лица операционного, финансового и коммерческого директоров + действия на неделю.

**На UI кнопка временно отключена** — контроль расходов до пилота. Будет включена, когда пилот заработает и появится понимание нагрузки.

### Phase 2.7 — Menu Analysis Backend (Kasavana-Smith) ✅ ГОТОВ

**История итераций:**
- **2.7.0 (first shot):** базовая Kasavana-Smith классификация по всему меню. Провал попытки добавить UI → решено допиливать backend до состояния, когда он один будет давать всю нужную франчайзи информацию.
- **2.7.1 (v2):** классификация внутри `dish_group`, класс `too_small`, фильтр аномалий через INNER JOIN, три ранга, сетевой бенчмарк по `dish_code`.
- **2.7.2 (v3):** даты жизни блюда (first_sold_at, last_sold_at, days_in_menu, days_since_last_sale), новые классы `event`/`dormant`/`new`, фильтр `dish_group = 'Архив'` на SQL-уровне, фикс бага `network_covered`.
- **2.7.3 (v4):** `dormant_reason` (replaced/seasonal/retired), параметры API `include_dormant`, `include_event`, `include_too_small`.

**Полная спецификация логики — в Приложении А.**

## Архитектурный долг

### dashboard.ts: 3400 строк template literal

`src/dashboard.ts` содержит `export const DASHBOARD_HTML = \`...\`` на 3400 строк. Внутри backtick-строки: HTML с атрибутами, CSS (двойные кавычки в свойствах), JavaScript (одинарные, двойные, backticks), кириллица, эмодзи (2-4 байта UTF-8), escape-последовательности для выхода из template literal.

**Почему это риск:** любая автоматическая многострочная правка через sed/awk/python/Python-скрипты даёт невалидный JS внутри строки. TypeScript такое не ловит — template literal всегда валиден как строка, что бы в нём ни было. `wrangler deploy` успешно деплоит broken HTML. Проявляется только в браузере при жёстком Cmd+Shift+R — DOM не рендерит, и ошибка может быть тихой (скрытые элементы, свалившаяся система вкладок).

22.04.2026 две попытки добавить UI вкладки «Меню» (Python heredoc и sed+awk) сломали dashboard.ts именно таким образом. Уроки зафиксированы.

**План: Вариант A — внешние файлы** (следующая сессия):

- `public/dashboard.html` — чистый HTML без JS/inline-CSS
- `public/dashboard.css` — стили
- `public/dashboard.js` — весь клиентский JS
- `dashboard.ts` — минимальный handler: читает файлы из assets и отдаёт клиенту

Нужно настроить Cloudflare Workers assets (либо Site, либо [assets] в wrangler.toml). После этого правки UI — обычный веб-разработка без template literal.

## Следующий шаг — сессия 8

**Этап 8.1 (приоритет):** рефакторинг dashboard.ts — Вариант A из плана выше. Ориентир — 2-3 часа.

**Этап 8.2:** UI вкладки «Меню». Дизайн экрана планируется:
- Верх: selector периода + сводные KPI-блоки (общая выручка меню, средняя маржа, структура по классам)
- Центр: KS-матрица 2×2 (star/plowhorse/puzzle/dog) как scatter-plot (популярность × маржа), точки — блюда, размер точки = выручка, цвет = класс
- Низ: таблица 171 блюд с фильтрами (класс, группа, dormant_reason), с сетевыми колонками (сколько блюд ниже/выше сети)
- Боковая панель: детали конкретного блюда при клике (история продаж, сравнение с сетью, позиция в группе)

Чёткий визуальный дизайн проработаем отдельным брейнштормом в начале сессии 8.

**Этап 8.3:** включить AI-кнопку в UI, когда backend меню уже в проде.

**Будущие задачи (backlog):**
- Рефакторинг: выделить общие хелперы из `data_endpoints.ts`/`dow_profiles.ts`/`forecast.ts`/`menu_analysis.ts`
- Починка пайплайна `dish_sales`: данные заканчиваются 2025-11-20, нужно обновление до текущей даты
- Сетевая ротация меню 1 сентября — предупреждение в UI о смешении двух меню в выбранном периоде
- Расширение `replaced`-детекции: fuzzy-match по `dish_name` поверх группового поиска
- Пересчёт `dormant` reason с учётом `dish_category` (сейчас только `dish_group`)

---

## Приложение А: логика анализа меню (Phase 2.7.3 / v4)

Это ядро аналитической части проекта. Документирую максимально подробно, чтобы через полгода не гадать, почему блюдо попало в тот или иной класс.

### Вход

**URL:** `GET /api/menu-analysis`

**Query-параметры:**
- `restaurant_id` (обязательный, положительное целое) — dept_id ресторана
- `start`, `end` (обязательные, YYYY-MM-DD) — границы окна анализа, диапазон ≤ 400 дней
- `include_dormant` (опц., default `1`) — показывать dormant-блюда в выдаче
- `include_event` (опц., default `1`) — показывать event-блюда
- `include_too_small` (опц., default `1`) — показывать too_small

Auth — session cookie `chicko_session`. Rate-limit — 60/мин на пользователя.

### Выход

Полная JSON-структура:

```json
{
  "dishes": [{ ...ClassifiedDish }],
  "summary": {
    "total_dishes": 171,
    "total_revenue": 34015375,
    "total_qty": 88245,
    "total_margin": 27641930,
    "avg_margin_pct": 81.3,
    "ks_counts": { "star": 31, "plowhorse": 29, "puzzle": 17,
                   "dog": 20, "too_small": 9, "event": 29,
                   "dormant": 36, "new": 0 },
    "dormant_reasons": { "replaced": 7, "seasonal": 9, "retired": 20 },
    "network_covered": 171
  },
  "filters": { "include_dormant": true, "include_event": true, "include_too_small": true },
  "thresholds": {
    "new_threshold_days": 30,
    "dormant_threshold_days": 14,
    "seasonal_window_days": 30
  }
}
```

Каждое блюдо в `dishes[]`:

```
{
  dish_code, dish_name, dish_category, dish_group,
  total_qty, total_revenue, total_foodcost, total_margin,
  margin_per_unit, avg_price, avg_foodcost_pct,
  first_sold_at, last_sold_at, days_in_menu, days_since_last_sale,
  menu_mix_pct, menu_mix_pct_group,
  ks_class, dormant_reason,
  rank, rank_in_class, rank_in_group,
  network: { margin_p50_net, mix_pct_p50_net, n_rests } | null
}
```

### Фильтры на SQL уровне (что вообще попадает в выборку)

Блюдо попадает в анализ, если:
1. `dept_uuid` совпадает с uuid выбранного ресторана (lookup по `dept_id` в `mart_restaurant_daily_base`)
2. Дата продажи попадает в окно `start..end` (`BETWEEN` включительно)
3. Для этого `(dept_uuid, report_date)` в `mart_restaurant_daily_base` стоит `is_anomaly_day = 0` (INNER JOIN, отсекает аномальные дни)
4. `qty > 0`
5. `revenue_rub > 0` (исключает комплименты, 100%-скидки)
6. `dish_code != ''` (исключает позиции без стабильного SKU)
7. `dish_group != 'Архив'` (исключает снятые с меню позиции)

### Метрики периода (SQL-агрегаты)

Считаются группировкой по `dish_code`, через `any()` для текстовых полей (у одного кода может быть несколько названий — ~44 случая из 1515 в прод-данных):

- **total_qty** = `SUM(qty)` за период
- **total_revenue** = `SUM(revenue_rub)` за период
- **total_foodcost** = `SUM(foodcost_rub)` за период
- **total_margin** = `total_revenue − total_foodcost` (абсолютная маржа)
- **margin_per_unit** = `total_margin / total_qty` (маржа ₽ с одной продажи — ключевой показатель для KS)
- **avg_price** = `total_revenue / total_qty`
- **avg_foodcost_pct** = `total_foodcost / total_revenue × 100` (фудкост %)

### Исторические метрики (отдельный CTE `history`)

Считаются по ВСЕЙ истории блюда в этом ресторане **до конца периода** (не только за окно start..end). Фильтр Архива и аномалий применяется так же:

- **first_sold_at** = `min(report_date)` — самая ранняя продажа блюда в этом ресторане
- **last_sold_at** = `max(report_date)` — самая свежая
- **days_in_menu** = `dateDiff('day', first_sold_at, end)` — сколько дней блюдо в меню на конец периода
- **days_since_last_sale** = `dateDiff('day', last_sold_at, end)` — сколько дней прошло с последней продажи

Важно: **референсная точка отсчёта — `end` периода**, не `today()`. Если пользователь анализирует август-ноябрь 2025, то «сейчас» для классификации — конец ноября 2025, а не текущая дата. Это делает бэктестинг воспроизводимым.

### Классификация: 8 классов с приоритетом

Для каждого блюда проверка идёт **сверху вниз**, первое совпадение фиксирует класс:

**1. event** — если `dish_category.toLowerCase().startsWith('ивент')`

Покрывает все ивент-категории в данных («ИВЕНТ», «Ивент Бар», «Ивент Десерты»). Event-блюда заведомо временные (промо, коллаборации, сезонные события), сравнивать их с постоянным меню по KS некорректно — короткое окно, специальные цены для ажиотажа.

**2. dormant** — если `days_since_last_sale > 14`

Блюдо в период попало (иначе его бы не было в выборке), но уже 14+ дней не продаётся. Фактически выведено из меню, какими бы красивыми ни были исторические цифры.

**3. new** — если `days_in_menu < 30`

Блюдо младше 30 дней от первой продажи до конца периода. Недостаточно накопленной статистики для честного KS — классификация несправедлива.

**4. too_small** — если в `dish_group` < 3 KS-кандидатов

После отсеивания шагов 1-3 считаем, сколько блюд в группе осталось под KS. Если < 3 — класс `too_small`. KS-матрица на 1-2 блюдах вырождается: 2 блюда делят меню 50/50, всё автоматом оказывается «популярным».

**5-8. Классическая матрица Kasavana-Smith внутри `dish_group`**

Только для блюд, переживших шаги 1-4:
- **star** — популярно И прибыльно
- **plowhorse** — популярно, но НЕ прибыльно
- **puzzle** — НЕ популярно, но прибыльно
- **dog** — НЕ популярно И НЕ прибыльно

**Пороги KS считаются внутри каждой dish_group, только среди KS-кандидатов** (event/dormant/new/too_small в знаменателях не участвуют):

- **Популярность:** блюдо популярно, если его доля qty среди KS-кандидатов группы ≥ `(1/n_ks_group) × 0.70 × 100` процентов. Это каноническая формула Kasavana-Smith: 70% от «справедливой доли» равномерного распределения. Если в группе 10 KS-кандидатов — «справедливая доля» = 10%, порог = 7%. Блюдо с долей ≥ 7% — популярное.

- **Прибыльность:** блюдо прибыльное, если его `margin_per_unit` ≥ средней маржи на единицу среди KS-кандидатов группы (= сумма margin KS-кандидатов / сумма qty KS-кандидатов).

Популярность оценивается **в рублях с порции**, не в процентах маржи. Это важное решение: внутри одной группы (все роллы, все напитки) ценники сопоставимы, и рубль/штука когнитивно прозрачнее для франчайзи — «это блюдо приносит мне больше рублей с порции, чем среднее в своей категории».

### dormant_reason — подкласс для dormant-блюд

Вычисляется только для блюд с `ks_class === 'dormant'`. Проверяется в порядке:

**1. replaced** — если в той же `dish_group` существует другое блюдо, у которого `first_sold_at >= last_sold_at` проверяемого блюда.

Смысл: кто-то появился в группе после того, как это блюдо перестало продаваться → его заменили. Алгоритм ограничен поиском в своей группе, поэтому межгрупповые замены (например, когда всю группу закрыли и запустили новую группу) не детектируются.

**2. seasonal** — если этот же `dish_code` продавался в этом же ресторане в окне **±30 дней от календарного года назад** (отдельный SQL-запрос `sqlSeasonal`).

Смысл: блюдо бывает сезонным (клубничные десерты летом, глинтвейн зимой). Если продавалось ровно в этом календарном периоде год назад — скорее всего вернётся. Порог 30 дней — компромисс между точностью и учётом смещений в датах сезонных меню год от года.

**3. retired** — иначе.

Реально снятое с меню блюдо, без явной замены в той же группе и без прошлогодних продаж в этом окне.

### Сетевой бенчмарк (SQL #2)

Параллельно основному запросу (`Promise.all`) считается медиана по другим ресторанам сети — для каждого `dish_code` из моего меню.

**Ключевые решения:**

- Матчим блюда **по `dish_code`** (стабильный SKU из справочника номенклатуры), не по `dish_name`. Имя может отличаться — в базе 1515 уникальных кодов и 1471 уникальных имён, т.е. у ~44 кодов есть по 2+ названий.
- **Исключаем из бенчмарка сам ресторан** — берём только `dept_uuid != deptUuid`
- **Исключаем архив** и **аномальные дни** — та же логика, что в основном запросе
- **Порог `n_rests >= 3`** — если блюдо есть меньше чем у трёх других ресторанов, медиана ненадёжна → `null` в поле `network`

**Структура (3 CTE):**

- `valid_days` — валидные дни (is_anomaly_day=0) в окне
- `mine` — список dish_code из моего меню (после всех фильтров)
- `per_rest_dish` — для каждого другого ресторана и каждого dish_code из mine: SUM qty и margin_per_unit
- `per_rest_total` — для каждого другого ресторана: полный SUM qty по всему его меню (знаменатель для mix_pct, чтобы считать честную долю)

**Финальный SELECT:**
- `margin_p50_net` = медиана `margin_per_unit` по другим ресторанам
- `mix_pct_p50_net` = медиана `(q / total_q × 100)` по другим ресторанам (доля этого блюда в меню того ресторана)
- `n_rests` = `count(DISTINCT dept_uuid)`

Результат кладётся в `Map<dish_code, NetworkBenchmark>` и привязывается к каждому классифицированному блюду (`dishes[i].network`).

### menu_mix_pct — два разных поля

В ответе возвращаются две доли:
- **menu_mix_pct** = `qty / total_qty_всего_меню × 100` — доля блюда во всём меню (включая все классы)
- **menu_mix_pct_group** = `qty / total_qty_группы × 100` — доля в своей `dish_group` (включая event/dormant/new — т.е. по всей группе)

**Третье значение** — доля внутри KS-кандидатов группы — используется только для расчёта KS-популярности внутри `classifyKS` и не возвращается в API. Это честный знаменатель для KS-матрицы, но в API мы отдаём «интуитивный» mix_pct_group по всей группе, как ожидает пользователь.

### Ранги (считаются ПОСЛЕ применения include_* фильтров)

Важно: если `include_event=0`, ранги считаются по оставшимся блюдам — `rank=1` будет у самого дорогого из не-event блюд, а не у event-лидера, которого в выдаче уже нет.

- **rank** — по `total_revenue DESC` среди всех блюд в выдаче
- **rank_in_class** — по `total_revenue DESC` внутри блюд того же `ks_class`
- **rank_in_group** — по `total_revenue DESC` внутри блюд той же `dish_group`

Применение в UI: «топ-5 dog по выручке» (кандидаты на исключение), «топ-3 puzzle с высокой маржой» (кандидаты на промо), «лидер plowhorse» (якорь трафика, не трогать).

### Полный SQL-пайплайн (3 параллельных запроса)

1. **sqlMain** — основной: per-dish агрегаты за период + history (first/last sold) → 171 блюдо
2. **sqlNet** — сетевой бенчмарк по dish_code из mine → Map с n_rests ≥ 3
3. **sqlSeasonal** — dish_code, у которых были продажи в этом ресторане в окне `[start-1год-30дн .. end-1год+30дн]` → Set для dormant_reason

Все три запускаются параллельно через `Promise.all`. sqlNet и sqlSeasonal имеют `.catch(() => emptyResult)` — если один из них упадёт, основной ответ всё равно вернётся (сетевые бенчмарки и seasonal-детекция деградируют, но не блокируют).

### Типичный пример классификации на данных ресторана 6

Период август-ноябрь 2025, 171 блюдо на выходе:

- **31 star** — stабильные лидеры, продаются долго, маржа выше среднего в группе
- **29 plowhorse** — трафиковые блюда («Корн-Дог ФРИ» #1 с 8% всего меню, но маржа ниже групповой)
- **17 puzzle** — высокомаржинальные нишевые позиции (кандидаты на промо)
- **20 dog** — «настоящие» собаки, без замен, без сезонности
- **9 too_small** — мелкие группы («Чай в асс.» в группе «Кофе/чай» из одного блюда)
- **29 event** — все ивенты корректно отсеяны (Миядзаки, ATEEZ, Корейская Неделя, ATEEZ 2025 ноябрьский)
- **36 dormant** — сетевая ротация меню 1 сентября 2025:
  - 7 replaced — прямая замена в той же группе
  - 9 seasonal — продавались в ±30 дней год назад (Чиз Рамен, Рамен с говядиной, Меморис, Дынное молоко, Ободок Ушки, Юдзу чай)
  - 20 retired — реально сняты (группа закрыта или нет аналога/истории)
- **0 new** — в прошлые 30 дней от 2025-11-20 новых блюд не было (был ивент 17-20 ноября, но он в `event`)

**Сетевое покрытие:** 171/171 = 100% блюд получили бенчмарк — единый справочник номенклатуры работает.

### Ограничения текущей реализации (известные)

- **replaced detection** ограничен одной `dish_group`. Если всю группу закрыли и запустили новую — это `retired`, хотя в реальности замена есть в другой группе. Fuzzy-match по dish_name — задача на backlog.
- **seasonal window ±30 дней** — компромисс. Слишком узкое окно пропустит смещения сезонности, слишком широкое (±60-90) начнёт давать ложные срабатывания.
- **Данные в dish_sales** обновляются с задержкой. На момент релиза max(report_date) = 2025-11-20 при текущем 2026-04-22. Пайплайн загрузки нужно чинить отдельно.
- **Сетевая ротация 1 сентября 2025** — системная особенность данных. Пользователь с периодом «август-ноябрь» видит смешанное меню. UI должен давать подсказку. На backend не чиним — даём данные как есть.

---

## Приложение Б: схема данных ClickHouse

**chicko.dish_sales** — таблица продаж по блюдам (основной источник для menu-analysis):

```
report_date        Date
dept_uuid          String         -- UUID ресторана
restaurant_name    String
city               String
dish_name          String
dish_code          String         -- стабильный SKU
dish_category      String
dish_group         String
qty                Float64
revenue            Float64        -- в валюте source_currency
foodcost           Float64
avg_price          Float64
foodcost_pct       Float64
margin             Float64
source_currency    String         default 'RUB'
fx_rate_to_rub     Float64        default 1
revenue_rub        Float64        -- canonical, используем везде
foodcost_rub       Float64        -- canonical
inserted_at        DateTime       default now()
source_system      String         default 'n8n'
```

Прод: 2 584 636 строк, 64 ресторана, 1 515 уникальных dish_code, период 2024-01-02 .. 2025-11-20 (локально у некоторых до 2025-12-26).

**chicko.mart_restaurant_daily_base** — дневные агрегаты по ресторанам, аномалии:
- dept_id, dept_uuid, restaurant_name, city, report_date
- revenue_total_rub, revenue_bar_rub, revenue_kitchen_rub, revenue_delivery_rub
- avg_check_total_rub, checks_total, foodcost_total_pct, discount_total_pct, delivery_share_pct
- is_anomaly_day — маркер аномального дня (ML-классификатор)

**chicko.mart_restaurant_scores** — precomputed скоринг ресторанов:
- score_total, risk_level, rank_network, restaurants_in_rank
- score_revenue, score_traffic, score_avg_check, score_foodcost, score_discount, score_delivery, score_margin
- score_window — '7d' / '30d' / '90d'

**chicko.mart_recommendations** — готовые рекомендации:
- recommendation_code, title, description, estimated_effect_rub
- confidence, impact_type, category, priority_score

**chicko.user_activity_log** (Phase 2.5):
- ts, user_id, email, endpoint, method, restaurant_id, response_status, response_ms, user_agent

## Приложение В: логика авторизации (Phase 2.4d)

**Magic-link flow:**
1. Пользователь вводит email → `POST /api/auth/request-link`
2. Сервер проверяет whitelist (USERS KV), rate-limit (1 req/60sec на email), генерирует токен (32 байта hex), сохраняет в MAGIC_LINKS KV с TTL 15 минут, отправляет письмо через Resend
3. Пользователь жмёт ссылку → `GET /api/auth/verify?token=…`
4. Сервер потребляет токен (delete from KV → one-time use), генерирует JWT с TTL 7 дней, ставит `chicko_session` cookie (HttpOnly, Secure, SameSite=Lax, Path=/)
5. Дальше клиент ходит с credentials: include, Worker читает cookie из заголовка

**CSRF-защита:** для state-changing POST (`/api/feedback`, `/api/auth/logout`) — проверка Origin через `checkOrigin`. GET-эндпойнты защищены через SameSite=Lax на уровне браузера.

**XSS-защита:** `chicko_session` HttpOnly — JavaScript не видит cookie. До 2.4d токен хранился в `localStorage['chicko_jwt']` — закрыта дыра #3 аудита.

**CSP:** Content-Security-Policy-Report-Only с отправкой violation reports на `/api/csp-report`. Агрегация в MAGIC_LINKS KV (префикс `csp:`, TTL 7 дней) с дедупликацией по `(directive, blocked-uri)`. Через ~неделю после включения — перевод в enforce-режим.

## Приложение Г: важные константы и настройки

**auth.ts:**
- `SESSION_TTL_SEC = 60 * 60 * 24 * 7` — 7 дней, единый источник для JWT exp и cookie Max-Age
- `SESSION_COOKIE_NAME = 'chicko_session'`

**security.ts:**
- `MAX_DATE_RANGE_DAYS = 400` — защита от слишком широких диапазонов
- `RATE_LIMIT_DATA = { limit: 60, windowSec: 60 }` — 60/мин для data-эндпойнтов
- `RATE_LIMIT_FEEDBACK = { limit: 10, windowSec: 60 }`
- `ALLOWED_ORIGINS = Set(['https://chicko-api-proxy.chicko-api.workers.dev'])`

**ai_insight.ts:**
- `RATE_LIMIT_AI = { limit: 5, windowSec: 300 }` — 5/5мин для AI-запросов
- Model: `claude-sonnet-4-20250514`, max_tokens: 1000

**menu_analysis.ts:**
- `NEW_THRESHOLD_DAYS = 30`
- `DORMANT_THRESHOLD_DAYS = 14`
- `SEASONAL_WINDOW_DAYS = 30` — ±30 дней от календарного года назад
- `EVENT_CATEGORY_PREFIX = 'ивент'` (регистронезависимо)

---

## Рабочий процесс

**Паттерн деплоя:**
- Окно 1: `wrangler tail` — смотрим живой лог
- Окно 2: `wrangler deploy` + `git push` (после `git commit` отдельным шагом)

**Safe revert:**
```bash
cd ~/Developer/chicko-api-proxy
git revert HEAD && npx wrangler deploy
```

**После каждой правки TypeScript:**
```bash
npx tsc --noEmit
```
Должно проходить молча.

**Команды в терминал** — ВСЕГДА начинаем с `cd ~/Developer/chicko-api-proxy`, чтобы не было сюрпризов с PWD.

## Лог версий паспорта

- **v3.35 (22.04.2026, день-7)** — Phase 2.7.3 closed: full menu-analysis spec (Приложение А), архитектурный долг по dashboard.ts, план сессии 8
- **v3.34 (22.04.2026, день-6)** — Phase 2.6 AI insight deployed (UI disabled); Phase 2.7 backend menu-analysis с Kasavana-Smith deployed; UI меню не добавлен из-за архитектурной хрупкости template literal — требуется рефакторинг
- **v3.33 (22.04.2026, день-6 днём)** — Phase 2.5 user_activity_log; score v2.0 гибрид «Здоровье (60%) + Рост YoY (40%)»
- **v3.32 (22.04.2026, день-6 утром)** — Fix #77 login form (inline onsubmit)
- **v3.3..v3.31** — см. git log (Phase 2.1-2.4 цепочка: DOW-profiles, forecast, data endpoints, auth hardening)
