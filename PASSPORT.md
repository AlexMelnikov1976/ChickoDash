# Chicko Analytics — Паспорт проекта

**Версия:** v3.40
**Дата обновления:** 25.04.2026  
**Focus:** Phase 2.10 — вкладка Маркетинг (CRM-портрет лояльности Premium Bonus, Калининград)

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
- **Client:** статические файлы `public/dashboard.{html,css,js}` отдаются через Workers Assets, SPA
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
- `GET /api/marketing-overview` — CRM-портрет лояльности (Phase 2.10), только Калининград, один объект со всеми срезами

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

### Phase 2.8 — Dashboard Refactoring + Menu UI ✅ ГОТОВ

**2.8.1 — Рефакторинг dashboard.ts (ce3f18d → 009fae8):**
- Вынос 3400-строчного template literal в отдельные файлы: `public/dashboard.{html,css,js}`
- Настройка Workers Assets в wrangler.toml: `[assets]` binding, `html_handling="none"`  
- Размер Worker bundle: 343 КБ → 83 КБ (-76%), время загрузки: 5720ms → 989ms (-83%)
- **Критический фикс:** html_handling по умолчанию делает 307-редирект на .html файлы

**2.8.2 — Menu Analysis UI (5a → 5d, коммит 8ebef33):**
- **5a:** scaffold вкладки Меню, интеграция с API, loading states
- **5b:** 5 KPI-карточек, breakdown по 8 классам, rotation banner для сетевой ротации меню
- **5c:** канонический Kasavana-Smith 2×2 matrix (Star/Plowhorse/Puzzle/Dog) + action panel с рекомендациями по классам
- **5d:** таблица блюд (9 колонок, сортировка, фильтрация) + detail drawer + интеграция matrix click → table filter

**Итог:** production-ready канонический menu engineering интерфейс, 1000+ строк кода, full-stack интеграция с /api/menu-analysis

### Phase 2.9 — Staff Analysis + Admin + Bugfixes

**2.9.1 — Staff Analysis backend (real ClickHouse):**
- 6 endpoints `/api/staff-{list,detail,groups,performance,managers,losses}`
- Источники: `db1.ЧикоВремя`, `db1.Чико4`, `db1.ЧикоНов3` (Калининград)
- KS-матрица официантов, потери по категориям A/B/C, менеджеры дня
- **Известное ограничение:** таблицы привязаны к одному ресторану, на других франчайзи падает (Phase 2.9.5)

**2.9.3 — Админ-вкладка «📊 Активность» (коммит 46816b3):**
- `GET /api/admin/me` — проверка is_admin (без 403, мягкая)
- `GET /api/admin/activity?window=7|30` — DAU/WAU, sparkline, топ UI/API, таблица пользователей
- Видна только пользователям с `is_admin:true` в KV USERS

**2.9.4 — Фикс menu-analysis 400 + tab persistence + сводная таблица ✅ ГОТОВ (24.04.2026):**

Root cause menu-analysis 400: `loadFullHistory()` через 2 сек после старта фоново подгружает данные с 2024-01-01. При этом `buildCalendars()` **сбрасывал** `CAL_STATE.global` на `{start: MIN_DATE, end: MAX_DATE}` = 844 дня. Бэкенд резал диапазон > 400 дней → 400 "Range too wide". На мобильных пользователи получали **только** ошибки (100% failure rate).

Диагностика: SQL к `user_activity_log` (24 ошибки за 7 дней, 7 пользователей) + диагностический `console.log` в handler (`[menu-diag]`) → подтверждено: `start=2024-01-01 end=2026-04-23`.

Правки в `public/dashboard.js`:
- **Fix A:** `loadFullHistory()` сохраняет/восстанавливает `CAL_STATE.global` вокруг `buildCalendars()` — текущий выбор периода не сбрасывается
- **Fix B:** `loadMenuAnalysis()` автоматически обрезает диапазон > 365 дней до последних 90 дней (defense-in-depth, KS-анализ за 2+ года бессмыслен)
- **Fix C:** `goTab()` сохраняет вкладку в `sessionStorage`, восстановление при загрузке страницы — рефреш оставляет на текущей вкладке
- **Fix D:** Сводная таблица «Показатели ресторанов за период» на вкладке Обзор:
  - 6 колонок: выручка (сумма), ср.чек (среднее), чеки (сумма), фудкост% (среднее), скидка% (среднее), доставка% (среднее)
  - Сортировка по клику на заголовок (дефолт: desc для «больше=лучше», asc для «меньше=лучше»)
  - Подсветка: лучший по метрике — зелёный, худший — красный
  - Текущий ресторан выделен золотым, клик на строку → переключение ресторана
  - Динамически обновляется при смене периода и ресторана
  - Колонка «Глубина» (позиций в чеке) отложена — нет данных в `mart_restaurant_daily_base`, требуется расширение пайплайна n8n

### Phase 2.10 — Marketing Tab (CRM-портрет лояльности) ✅ ГОТОВ (25.04.2026)

Первая аналитическая вкладка по программе лояльности **Premium Bonus** (CRM-системе ресторана). Доступна только для Калининграда — Premium Bonus подключён к одной точке. На UI закрыто баннером, бэкенд читает единый mart без фильтра по ресторану.

**Полная спецификация — в Приложении Д. Здесь — обзор пайплайна и итераций.**

#### Источники данных (raw)

Загружены через curl HTTP API из ChickoBonus (CRM на базе Premium Bonus):

| Таблица | Строк | Что |
|---|---|---|
| `chicko.premiumbonus_clients` | 4 456 | Per-client снапшот CRM на 22.04.2026: ФИО, телефон, email, ДР, баланс (gift/accumulated/promo), группа лояльности, LTV, дата последней покупки |
| `chicko.premiumbonus_detail` | 10 301 | Журнал чеков с 01.05.2025 по 24.04.2026 (phone, purchase_date, payment_sum) — ровно тот же датасет что mart использует для исторической реконструкции |

**Findings из EDA на raw:**
- 16.5 млн ₽ суммарного LTV, медиана 2 274 ₽
- **58% клиентов (2 593) сделали ровно 1 чек** — главная утечка воронки
- 1.08 млн ₽ зависших подарочных бонусов
- Группы лояльности: Новичок 4134 / Трейни 192 / Айдол 77 / Легенда 53
- Email есть у 62.1%, ДР у 92.6%, пол у 6.6% (не используем)
- 257 телефонов в чеках но **отсутствуют** в текущем CRM — удалённые/очищенные клиенты. Это объясняет расхождение ~225 строк между реконструкцией 21.04 (4 681) и снапшотом 22.04 (4 456).

#### Mart-слой

Две таблицы, обе с `snapshot_date` для накопления истории:

- **`chicko.mart_crm_clients`** — per-client снапшот с RFM-сегментом, флагами триггерных кампаний (`is_burning_gift`, `is_second_visit_target`, `is_winback_target`, `is_birthday_7d`, `is_birthday_30d`), мардж raw `premiumbonus_clients` + LTV из `premiumbonus_detail`. Используется для будущих CSV-экспортов сегментов.
- **`chicko.mart_crm_overview`** — per-day агрегат с 39 полями: KPI, воронка, RFM-распределение, балансы, кампании, здоровье CRM. Одна строка на день, partition by month. **112 строк сейчас** (01.01.2026 — 22.04.2026).

#### RFM-сегментация

Приоритет (один клиент → один сегмент):
1. **vip** — checks_total ≥ 5 AND recency ≤ 60д → **233**
2. **at_risk** — checks_total ≥ 3 AND recency 61-120д → **181**  
3. **new_first_purchase** — checks_total = 1 AND recency ≤ 30д → **181**
4. **dormant_valuable** — recency 90-180д AND revenue ≥ ltv_median → **457**
5. **lost_one_time** — checks_total = 1 AND recency > 180д → **1 484**
6. **other** → 1 920

#### Триггерные кампании (флаги)

| Флаг | Условие | Клиентов | Сумма |
|---|---|---|---|
| is_burning_gift | bal_gift > 0 AND recency > 60д | 3 019 | **1 030 700 ₽** |
| is_second_visit_target | checks = 1 AND recency 7-30д | 152 | — |
| is_winback_target | recency 90-180д AND revenue ≥ ltv_median | 536 | — |
| is_birthday_7d / _30d | ДР через 7 / 30 дней | 100 / 332 | — |

#### Хронология итераций

**2.10.1 — Raw + mart DDL + первый INSERT.** Загружены `premiumbonus_clients` (4 456 строк через `curl --data-binary @clients_seed.ndjson`) и `premiumbonus_detail` (10 301 строка). Создан DDL для двух mart-таблиц (`mart_crm_clients`, `mart_crm_overview`). INSERT...SELECT с RFM-логикой проверен — все цифры сошлись с EDA.

**2.10.2 — n8n cron `Chicko_CRM_Mart_Refresh_v4`.** Workflow обновляет mart ежедневно 06:45 Europe/Moscow:
- Schedule → Get Latest Date → Set: latest_date → IF: дата валидна → DROP PARTITION (mart_crm_clients) + DELETE day (mart_crm_overview) → INSERT mart_crm_clients → INSERT mart_crm_overview → Verify → Telegram OK
- Критический паттерн для YC ClickHouse через HTTP node: SQL в URL parameter `query`, body пустой для SELECT/DROP/DELETE, `allowUnauthorizedCerts:true`, `response.fullResponse:true`, ответ читается из `$json.data` (не `$json.body`).
- 4 итерации: v1 упала на TLS handshake, v2 фиксила структуру, v3-v4 финально починили `$json.data` references в Set-нодах.

**2.10.3 — Endpoint `/api/marketing-overview` v1.** Один объект со всеми срезами (kpi/funnel/rfm/loyalty/campaigns/balances/money/health/sparkline/meta), 5-минутный private cache, auth через cookie. Sparkline_dau тогда содержал только 14 дней истории, 4 поля.

**2.10.4 — Историческая реконструкция (backfill 111 дней).** ALTER mart_crm_overview перевёл 19 полей в Nullable (бонусы, лояльность, ДР, health CRM — этих данных в чеках нет). Исторический INSERT восстановил клиентские метрики (clients_total, active_30d, repeat_rate, LTV, RFM, registrations, second_visit, winback) за 01.01.2026 — 21.04.2026 из `premiumbonus_detail`. 

Технически: первая попытка через `JOIN dates × detail ON purchase_date <= snapshot_date` упала с `INVALID_JOIN_ON_EXPRESSION` — ClickHouse в JOIN поддерживает только equality. Перепишен на `arrayJoin(arrayMap(d -> purchase_date + d, range(...)))` — для каждого чека генерируем массив дней `[purchase_date .. 2026-04-21]`, потом GROUP BY (snapshot_date, phone). Без join'а, один проход по детали.

Результат: 112 точек истории (111 реконструкция + 1 CRM-снапшот за 22.04). Проверено — clients_total плавно растёт с 3 782 до 4 681, repeat_rate с 36.6% до 38.7%.

**2.10.5 — Frontend: вкладка «💎 Маркетинг» в dashboard.** В `dashboard.html`/`css`/`js`:
- Новый ntab `marketing` справа от Персонала
- Вкладка Персонал помечена `locked` + lock-badge 🔒, контент заменён на заглушку «Скоро / Q2 2026»
- Новая panel `p-marketing` с баннером о Калининграде, period selector (7/14/30/90/120/365д), 7 секций (KPI, что бросается в глаза, воронка+RFM, динамика 4 графика, триггерные кампании 6 карточек, балансы+LTV+health, footer)
- Кнопки кампаний визуально присутствуют, но без onclick — будут активированы после интеграции с каналом отправки
- ~543 строки JS добавлено в `dashboard.js`: `renderMarketing()`, `mktDraw()`, `mktSetPeriod()`, `mktDrawDynamics()` + 7 хелперов

**2.10.6 — Баги после деплоя:**

*Баг A — попытка залочить шапку при активной marketing-вкладке.* Скрывал `#selWrap`, `#netToggle`, `#globalCalWrap` через `body.marketing-mode` + плашка `::after`. После деплоя группировки на других вкладках сломались (точная причина не установлена — возможно конфликт CSS). **Откачено целиком.** Решение про блокировку шапки отложено.

*Баг B — плашки KPI показывали одинаковую дельту для всех периодов.* Endpoint v1 возвращал `sparkline_dau` всего за 14 дней с 4 полями. Фронт делал `slice.slice(-365)` на массиве из 14 элементов и получал те же 14 элементов — дельта `last - first` одинаковая, менялась только подпись. Repeat rate и LTV вообще не апдейтились (полей не было в sparkline).

*Фикс v2 endpoint:* расширили history до 365 дней через второй параллельный запрос, добавили `repeat_rate_pct` и `ltv_median` в каждую точку. Имена полей выровнены с макетом и mart_crm_overview.

*Фикс mktDrawDynamics:* читает новое `data.sparkline` (fallback на `sparkline_dau` для совместимости), считает дельты для всех 4 KPI, подписывает реальной длиной slice (`realDays = slice.length - 1`) — если истории меньше чем выбранный период, не врёт о «365д».

*Баг C — endpoint падал в 503 «no_data».* В первой версии `marketing.ts` написал свой `chQuery` который слал SQL через body POST. CH такой паттерн принимал как пустой запрос → 0 строк → 503. **Исправлено:** перешли на `ClickHouseClient` из общего `clickhouse.ts` (тот же что используют все остальные endpoint'ы) — SQL через URL parameter, `FORMAT JSON`, парсинг через `result.data`.

*Баг D — TypeScript compile error на `auth.ok`.* Угадал неправильную сигнатуру `authFromCookie` — он возвращает `Response | AuthContext`, не `{ok}`. Правильный паттерн как в `index.ts`: `if (auth instanceof Response) return auth`.

#### Что сейчас работает

- Эндпойнт `GET /api/marketing-overview` — возвращает 112 дней истории + полный снапшот, ~30кб JSON, кэш 5 мин
- Вкладка «💎 Маркетинг» в UI с живыми данными
- Графики динамики корректно реагируют на выбор периода (7/14/30/90/120/365д), все 4 KPI пересчитывают дельты
- n8n cron 06:45 ежедневно обновляет mart, шлёт OK в Telegram «Chicko»

#### Известные ограничения / TODO

- Кнопки кампаний неактивны — нужна интеграция с каналом отправки (Premium Bonus push API? SMS-сервис? — пока не определено)
- Endpoint не фильтрует по `dept_uuid` — bake-in для Калининграда. При подключении Premium Bonus к другим точкам потребуется параметр `?restaurant_id=` и фильтр в SQL
- Скрытие селектора ресторана при активной вкладке Маркетинг отложено (после фейла Бага A)
- CSV-экспорт сегментов из mart_crm_clients не реализован — `is_burning_gift`, `is_winback_target` и др. лежат в mart, но endpoint для скачивания списков ещё не написан

## Техническая инфраструктура

### Workers Assets (Phase 2.8.1)

`wrangler.toml` настроен с `[assets]` binding:
- `directory = "./public"` — статические файлы dashboard.{html,css,js}  
- `binding = "ASSETS"` — доступ через `env.ASSETS.fetch()`
- `html_handling = "none"` — **критично**: без этого env.ASSETS.fetch('/dashboard.html') возвращает 307 redirect
- `run_worker_first = true` — Worker обрабатывает routes первым, затем assets

**Результат:** clean separation клиентского и серверного кода, быстрые деплои UI без пересборки Worker.

## Следующие шаги — post Phase 2.10

**Приоритет 1:** Активация кнопок «Запустить рассылку» / «Скачать список» на вкладке Маркетинг. Решения нет — нужно определить канал коммуникации (Premium Bonus push, SMS-сервис, email). Backend-endpoint для CSV-экспорта сегментов из `mart_crm_clients` (~50 строк) — самый быстрый «нулевой» шаг (маркетолог скачивает список → грузит в Premium Bonus вручную).

**Приоритет 2:** Фикс staff-* для мульти-франчайзи (Phase 2.9.5). Текущие endpoints жёстко привязаны к таблицам одного ресторана Калининграда (`db1.ЧикоВремя`, `db1.Чико4`, `db1.ЧикоНов3`). На других франчайзи падают с 500/400 (7 пользователей затронуты). Быстрый фикс: graceful degradation (501 + заглушка на фронте). Правильный фикс: нормализация таблиц с `dept_id`/`dept_uuid`. На вкладке временно стоит замок 🔒 + заглушка «Скоро» (Phase 2.10).

**Приоритет 3:** Re-enable AI кнопки в UI (Phase 2.8.3). Backend `/api/ai-insight` готов, временно отключен для контроля расходов. Включить после стабилизации пилота.

**Приоритет 4:** Фикс пайплайна `dish_sales`. Данные заканчиваются 2025-11-20, нужно обновление до 2026 г. Влияет на актуальность menu analysis.

**Backlog (в порядке важности):**
- **Marketing v2:** CSV-экспорт сегментов (`/api/marketing-segment-export?segment=burning_gift`), активация кнопок «Скачать список»
- **Marketing v3:** интеграция с каналом отправки (Premium Bonus push? SMS?) — после выбора канала
- **Marketing v4:** скрытие/блокировка глобального селектора ресторана и календаря на marketing-вкладке (после фейла Бага 2.10.6.A — нужен другой подход)
- Добавить `avg_items_per_check` в `mart_restaurant_daily_base` + пайплайн n8n → колонка «Глубина» в сводной таблице
- Сетевая ротация меню 1 сентября — UI warning при выборе периода, который захватывает ротацию  
- Расширение `replaced`-детекции: fuzzy-match по `dish_name` поверх группового поиска
- Пересчёт `dormant` reason с учётом `dish_category` (сейчас только `dish_group`)
- Рефакторинг: выделить общие хелперы из `data_endpoints.ts`/`dow_profiles.ts`/`forecast.ts`/`menu_analysis.ts`
- Дедупликация `corsHeadersFor` и `ALLOWED_ORIGINS` между `index.ts` и `security.ts`
- Удалить диагностический `[menu-diag]` console.log из `src/menu_analysis.ts`

**Пилот:** основные функции готовы. Menu Analysis — ключевая дифференциация продукта для франчайзи.

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

**chicko.premiumbonus_clients** (Phase 2.10) — per-client снапшот CRM Premium Bonus:
- phone (PK), full_name, email, birth_date, gender
- bal_total, bal_gift, bal_accumulated, bal_promo
- loyalty_group ('Новичок 3%' | 'Трейни 5%' | 'Айдол 10%' | 'Легенда 7%')
- ltv_total, checks_count, last_purchase_at, registered_at
- snapshot_date — дата выгрузки из CRM
- 4 456 строк за 22.04.2026, только Калининград

**chicko.premiumbonus_detail** (Phase 2.10) — журнал чеков из Premium Bonus:
- phone, purchase_date, payment_sum, dept_uuid (всегда Калининград)
- 10 301 строк, 01.05.2025 .. 24.04.2026

**chicko.mart_crm_clients** (Phase 2.10) — per-client mart с RFM и кампаниями:
- phone (PK), snapshot_date
- Всё из `premiumbonus_clients` +
- recency_days, rfm_segment ('vip'|'at_risk'|'new_first_purchase'|'dormant_valuable'|'lost_one_time'|'other')
- is_burning_gift, is_second_visit_target, is_winback_target, is_birthday_7d, is_birthday_30d (булевы флаги)
- partition by toYYYYMM(snapshot_date), накапливает историю

**chicko.mart_crm_overview** (Phase 2.10) — per-day агрегат для KPI и истории:
- snapshot_date (PK), dept_uuid='kaliningrad', computed_at
- KPI: clients_total, clients_active_30d, clients_active_90d, clients_active_180d, clients_dormant_180_plus, clients_one_check, clients_repeat, clients_loyal_5_plus, repeat_rate_pct
- Money: ltv_total, ltv_mean, ltv_median, ltv_p75, avg_check_network
- Balances (Nullable, только сегодня): bal_total_sum, bal_gift_sum, bal_accumulated_sum, bal_promo_sum, clients_with_gift, clients_with_accumulated
- RFM-сегменты: rfm_vip, rfm_at_risk, rfm_dormant_valuable, rfm_lost_one_time, rfm_new_first_purchase, rfm_other
- Loyalty (Nullable): loyalty_novichok, loyalty_treyni, loyalty_idol, loyalty_legenda, loyalty_other
- Campaigns: camp_burning_gift_clients (Nullable), camp_burning_gift_amount (Nullable), camp_second_visit_clients, camp_winback_clients, camp_birthday_7d_clients (Nullable), camp_birthday_30d_clients (Nullable)
- Health (Nullable): pct_with_email, pct_with_birth_date, pct_with_gender, anomaly_zero_revenue_with_balance
- new_registrations_today
- 112 строк (01.01.2026 — 22.04.2026), partition by toYYYYMM, обновляется n8n cron 06:45

Поля помечены `Nullable` — те, которых не было в исторической реконструкции из чеков (бонусы, лояльность, ДР, health). Реальные значения только начиная со снапшота 22.04.2026.

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

**wrangler.toml:**
- `html_handling = "none"` — **критично** для Workers Assets, иначе .html файлы возвращают 307 redirect

---

## Приложение Д: Marketing Tab — спецификация (Phase 2.10)

Полное описание пайплайна вкладки «💎 Маркетинг» — от загрузки CRM до отрисовки на фронте. Документирую максимально подробно, чтобы через полгода понять логику каждой цифры.

### Источники и пайплайн

```
ChickoBonus CRM (Premium Bonus, only Калининград)
        │
        │  ручная выгрузка → curl --data-binary @clients_seed.ndjson
        ▼
chicko.premiumbonus_clients (4 456 строк, snapshot_date)
chicko.premiumbonus_detail  (10 301 строк, журнал чеков)
        │
        │  n8n cron 06:45 ежедневно (Chicko_CRM_Mart_Refresh_v4)
        │  DROP PARTITION current → INSERT...SELECT
        ▼
chicko.mart_crm_clients   (per-client + RFM + флаги, накапливает историю)
chicko.mart_crm_overview  (per-day агрегат, 39 полей, 112 точек)
        │
        │  GET /api/marketing-overview (auth, cache 5min)
        │  Двa параллельных SQL: snapshot + history 365д
        ▼
{kpi, funnel, rfm, loyalty, campaigns, balances, money, health, sparkline, meta}
        │
        │  renderMarketing() в dashboard.js, кэш в MKT_STATE.data
        ▼
Вкладка «💎 Маркетинг»
```

### RFM-сегментация (приоритетная классификация)

Каждый клиент попадает ровно в один сегмент. Проверка идёт сверху вниз, первое совпадение выигрывает:

```
1. vip                  ← checks_total >= 5 AND recency_days <= 60
2. at_risk              ← checks_total >= 3 AND recency_days BETWEEN 61 AND 120
3. new_first_purchase   ← checks_total = 1 AND recency_days <= 30
4. dormant_valuable     ← recency_days BETWEEN 90 AND 180
                          AND revenue_total >= ltv_median (на дату снапшота)
5. lost_one_time        ← checks_total = 1 AND recency_days > 180
6. other                ← всё остальное
```

`ltv_median` пересчитывается на каждый snapshot_date — это медиана `revenue_total` всей базы на этот день. На 22.04.2026 = 2 274 ₽.

Распределение на 22.04.2026:
- vip: 233 (5.2%)
- at_risk: 181 (4.1%)
- dormant_valuable: 457 (10.3%)
- new_first_purchase: 181 (4.1%)
- lost_one_time: 1 484 (33.3%)
- other: 1 920 (43.0%)

### Триггерные кампании (булевы флаги)

Считаются на стороне mart_crm_clients, в `mart_crm_overview` агрегируются как `count_if(flag)`:

| Флаг | SQL-условие | На 22.04.2026 |
|---|---|---|
| `is_burning_gift` | `bal_gift > 0 AND recency_days > 60` | 3 019 клиентов / 1 030 700 ₽ |
| `is_second_visit_target` | `checks_total = 1 AND recency_days BETWEEN 7 AND 30` | 152 |
| `is_winback_target` | `recency_days BETWEEN 90 AND 180 AND revenue_total >= ltv_median` | 536 |
| `is_birthday_7d` | `birth_date в ближайшие 7 дней (по дню/месяцу)` | 100 |
| `is_birthday_30d` | `birth_date в ближайшие 30 дней` | 332 |

Обрати внимание: `is_winback_target` и RFM-сегмент `dormant_valuable` имеют близкие, но **не одинаковые** условия. RFM учитывает приоритет (если клиент уже vip/at_risk/new — он не попадёт в dormant_valuable), а `is_winback_target` — независимый флаг. Поэтому 536 vs 457.

### Историческая реконструкция (backfill 111 дней)

01.01.2026 — 21.04.2026 восстановлены из `premiumbonus_detail` через одно arrayJoin:

```sql
WITH client_state AS (
  SELECT
    arrayJoin(arrayMap(
      d -> toDate(purchase_date) + d,
      range(toUInt32(toDate('2026-04-21') - toDate(purchase_date) + 1))
    )) AS snapshot_date,
    phone,
    countIf(purchase_date <= snapshot_date) AS checks_total,
    sumIf(payment_sum, purchase_date <= snapshot_date) AS revenue_total,
    ...
  FROM chicko.premiumbonus_detail
  WHERE purchase_date <= toDate('2026-04-21')
  GROUP BY snapshot_date, phone
  HAVING snapshot_date >= toDate('2026-01-01')
)
SELECT ... FROM client_state JOIN medians USING (snapshot_date) GROUP BY snapshot_date
```

Для каждого чека массив дат `[purchase_date .. 2026-04-21]` развёртывается в snapshot-картину. ClickHouse не поддерживает inequality join, поэтому первая попытка `JOIN dates × detail ON purchase_date <= snapshot_date` упала с `INVALID_JOIN_ON_EXPRESSION`.

**Что реконструировано (real history):** clients_total, active_30d/90d/180d, repeat_rate, ltv_*, RFM, new_registrations_today, second_visit / winback campaigns.

**Что NULL для исторических дат** (нет в чеках): bonuses, loyalty groups, birthday campaigns, health CRM, anomaly_zero_revenue_with_balance. Для этих полей в DDL стоит `Nullable(...)`.

**Расхождение 21.04 vs 22.04 в clients_total** (4 681 vs 4 456 = разница 225): на 21.04 — все когда-либо купившие за всё время до даты, на 22.04 — снапшот текущей CRM (без 257 клиентов которые удалены/очищены). Это нормально, не баг. На фронте отмечено пометкой «только сейчас» для полей где доступен лишь снапшот.

### Endpoint /api/marketing-overview

**Архитектура:** один объект, два параллельных SQL.

```typescript
SQL 1 (snapshot):  SELECT * FROM mart_crm_overview
                   WHERE snapshot_date = (SELECT max(snapshot_date) FROM ...)

SQL 2 (history):   SELECT toString(snapshot_date) AS date,
                          clients_total, clients_active_30d,
                          repeat_rate_pct, ltv_median,
                          new_registrations_today
                   FROM mart_crm_overview
                   WHERE snapshot_date >= today() - 365
                   ORDER BY snapshot_date ASC
```

**Ответ (~30 КБ):**
```json
{
  "kpi":        {"clients_total", "clients_active_30d", "repeat_rate_pct", "ltv_median", "bal_total_sum"},
  "funnel":     {"clients_total", "clients_repeat", "clients_active_90d", "clients_active_30d", "clients_loyal_5_plus", "clients_one_check"},
  "rfm":        {"vip", "at_risk", "dormant_valuable", "lost_one_time", "new_first_purchase", "other"},
  "loyalty":    {"novichok", "treyni", "idol", "legenda", "other"},
  "campaigns":  {"burning_gift_clients", "burning_gift_amount", "second_visit_clients", "winback_clients", "birthday_7d_clients", "birthday_30d_clients"},
  "balances":   {"total", "gift", "accumulated", "promo", "clients_with_gift", "clients_with_accumulated"},
  "money":      {"ltv_total", "ltv_mean", "ltv_median", "ltv_p75", "avg_check"},
  "health":     {"pct_with_email", "pct_with_birth_date", "pct_with_gender", "anomaly_zero_revenue_with_balance", "clients_dormant_180_plus"},
  "sparkline":  [{date, clients_total, clients_active_30d, repeat_rate_pct, ltv_median, new_registrations_today}, ...112],
  "meta":       {"snapshot_date", "history_days", "source", "scope"}
}
```

**Headers:** `cache-control: private, max-age=300` (5 минут). Mart обновляется раз в сутки, более свежий кэш бесполезен.

**Auth:** через `authFromCookie` (тот же паттерн что у других endpoints). Без cookie → 401, фронт показывает login.

**Используемая обёртка:** `ClickHouseClient` из `clickhouse.ts` (общая для проекта, SQL через URL parameter, `FORMAT JSON`). **Не писать свой `chQuery` через body POST** — CH воспринимает body иначе, может вернуть 0 строк (Баг 2.10.6.C).

### Frontend: вкладка «💎 Маркетинг»

**Файлы:** `dashboard.html` (новая panel `p-marketing`), `dashboard.css` (~80 строк префикс `.mkt-*`), `dashboard.js` (~543 строки в конце файла).

**Состояние:** глобальный объект `MKT_STATE = {data, period:90, charts:{}, loading, error}`. Кэшируется — повторное открытие вкладки не делает fetch.

**Точка входа:** `renderMarketing()` вызывается из `goTab()` при `tab === 'marketing'`. Делает `fetch(API_BASE + '/api/marketing-overview', {credentials:'include'})`, кладёт в `MKT_STATE.data`, вызывает `mktDraw()`.

**`mktDraw()` рендерит** (в порядке сверху вниз):
1. Шапка с названием, snapshot_date, period selector (7/14/30/90/120/365 дней)
2. 5 KPI-карточек (база, активны 30д, repeat rate, медиана LTV, бонусы)
3. Блок «🔔 Что бросается в глаза» — до 4 алертов (`mktBuildInsights()` строит условно: красный про сгорание, жёлтый про второй визит, синий про 1-чек 58%, золотой про ДР)
4. Воронка удержания (5 шагов от 100% до loyal 5+) + RFM сегменты + Группы лояльности (двухколоночный grid g21)
5. Динамика — 4 линейных графика Chart.js (`mktDrawDynamics()`): рост базы, активные 30д, repeat rate, новые регистрации
6. Триггерные кампании — 6 карточек (3+3 grid g3), кнопки **неактивны** (стиль `cursor:not-allowed`, текст «скоро · скачать список →»)
7. Балансы + LTV распределение + Здоровье CRM (3 карточки)
8. Footer с источником и пометкой «только сейчас»

**Period switching:** `mktSetPeriod(days, btnEl)` обновляет `MKT_STATE.period` и вызывает только `mktDrawDynamics()` (карточки KPI не перерисовываются полностью, только дельты).

**`mktDrawDynamics()`:**
- Берёт `data.sparkline` (fallback на `data.sparkline_dau` для совместимости со старым endpoint v1)
- `slice = sparkline.slice(-days)` — последние N дней
- `realDays = slice.length - 1` — фактическое расстояние first→last в днях. Используется для подписи дельт — если истории меньше чем выбранный период (например, год запрошен но есть только 112 точек), показываем «за 111д», не врём.
- Отрисовывает 4 Chart.js линий с градиентным fill
- Считает 4 дельты: `dTotal`, `dActive`, `dRepeat`, `dLtv`. `dRepeat` через `mktUpdateDeltaPct` (формат «+2.1 п.п.»), остальные через `mktUpdateDelta`.

**Что заблокировано на UI:**
- Вкладка Персонал — locked + lock-badge 🔒, контент «Скоро / Q2 2026», `goTab` для locked-вкладок не вызывает рендер
- Кнопки кампаний — присутствуют визуально, но без `onclick`, `cursor:not-allowed`, opacity 0.6

### Telegram-нотификации

Workflow `Chicko_CRM_Mart_Refresh_v4` после каждого успешного refresh шлёт в чат `Chicko` (chat_id=-1003396450964) сообщение:

```
✅ CRM mart обновлён 2026-04-25
Клиентов: 4 456
Активны 30д: 541
Repeat rate: 41.67%
Сгорающие бонусы: 3 019 клиентов / 1 030 700 ₽
```

При ошибке (no_data, pipeline_error) — отдельное сообщение в тот же чат.



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

- **v3.40 (25.04.2026)** — Phase 2.10 closed: Marketing Tab. Загружены `premiumbonus_clients` (4 456) + `premiumbonus_detail` (10 301) из ChickoBonus, создан mart-слой (`mart_crm_clients` per-client + `mart_crm_overview` per-day, 39 полей). Реализована RFM-сегментация (6 сегментов) и 5 триггерных кампаний (сгорание бонусов 1 030 700 ₽ у 3 019 клиентов, второй визит, winback, ДР). Backfill 111 дней истории через arrayJoin (CH не поддерживает inequality JOIN). n8n cron 06:45 ежедневно. Endpoint `/api/marketing-overview` через `ClickHouseClient` (после факапа со своим chQuery → 503). Frontend: вкладка «💎 Маркетинг» + замок на «Персонал». 4 бага в процессе: попытка локализации шапки откачена, дельты KPI не пересчитывались (sparkline 14д → расширен до 365д с 5 полями), 503 на body POST, TS error на auth.ok. Полная спецификация в Приложении Д.
- **v3.39 (24.04.2026)** — Phase 2.9.4 дополнена: сводная таблица ресторанов на Обзоре (6 метрик, сортировка, подсветка best/worst), выручка/чеки = сумма за период, остальные = среднее. Колонка «Глубина» отложена (нет данных в пайплайне).
- **v3.38 (24.04.2026)** — Phase 2.9.4 closed: фикс menu-analysis 400 (root cause: loadFullHistory сбрасывал CAL_STATE.global на 844-дневный диапазон), defense-in-depth cap 365→90 дней в loadMenuAnalysis, tab persistence через sessionStorage. Добавлены Phase 2.9.1/2.9.3 в паспорт. Обновлены приоритеты: staff-* мульти-франчайзи → приоритет 1.
- **v3.36 (22.04.2026, день-7 поздний вечер)** — Phase 2.8.2 closed: полная вкладка Menu Analysis (1000+ строк кода), рефакторинг dashboard.ts в Workers Assets, production-ready Kasavana-Smith интерфейс. Убран архитектурный долг, обновлён план следующих фаз.
- **v3.35 (22.04.2026, день-7 вечер)** — Phase 2.7.3 closed: full menu-analysis spec (Приложение А), архитектурный долг по dashboard.ts, план сессии 8
- **v3.34 (22.04.2026, день-6)** — Phase 2.6 AI insight deployed (UI disabled); Phase 2.7 backend menu-analysis с Kasavana-Smith deployed; UI меню не добавлен из-за архитектурной хрупкости template literal — требуется рефакторинг
- **v3.33 (22.04.2026, день-6 днём)** — Phase 2.5 user_activity_log; score v2.0 гибрид «Здоровье (60%) + Рост YoY (40%)»
- **v3.32 (22.04.2026, день-6 утром)** — Fix #77 login form (inline onsubmit)
- **v3.3..v3.31** — см. git log (Phase 2.1-2.4 цепочка: DOW-profiles, forecast, data endpoints, auth hardening)
