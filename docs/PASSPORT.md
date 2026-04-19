# Паспорт проекта: Chicko Analytics

> **Живой документ.** Обновляется после каждой значимой сессии работы.
> История изменений — в разделе [Changelog](#10-changelog) внизу.
> Если что-то здесь противоречит коду в репо — прав код, этот документ надо обновить.

**Последнее обновление:** 19.04.2026, день (13:00) — готова инфраструктура для magic-link auth, код пишем в следующей сессии
**Версия паспорта:** 3.11 (консолидирует v3.3–v3.10 + результаты 19.04 утром/днём)

---

## 1. Что это и зачем

**Chicko Analytics** — аналитическая платформа для франчайзи сети ресторанов Chicko. Показывает ключевые метрики (выручка, средний чек, foodcost, дисконт, доля доставки), сравнивает каждый ресторан с сетью и Top-10, строит динамику и выдаёт рекомендации.

**Пользователи:** владельцы франчайзи-ресторанов. На старте — 42 пользователя.

**Продуктовое решение (принято 19.04.2026):**
- Каждый франчайзи логинится своим email (любым — Gmail, Yandex, Mail.ru, корпоративный)
- После входа видит **все данные всей сети** — это и есть ключевая фишка продукта («сравнение внутри сети»)
- Никакой фильтрации данных по пользователю (RLS в API нет)
- Login нужен только для контроля доступа, аудита и будущих ролей
- Продукт — vertical SaaS для ресторанного бизнеса, стратегия: Chicko → другие сети ресторанов → кинотеатры (июньская конференция)

---

## 2. Моментальный снимок

| Поле | Значение |
|---|---|
| **Production API** | https://chicko-api-proxy.chicko-api.workers.dev 🟢 |
| **GitHub (private)** | github.com/AlexMelnikov1976/chicko-api-proxy |
| **Локально (Mac)** | `~/Developer/chicko-api-proxy` |
| **Общий прогресс** | ~65% от плана (Волна 1 ✅, Волна 2 на 85% ✅, auth-инфра готова, код следующей сессией) |
| **Активный блокер** | Нет |
| **Ближайший milestone** | M4: Frontend-дашборд + magic-link auth — ETA 20-21.04 |
| **Автодеплой** | ✅ GitHub Actions, 9 подряд зелёных деплоев |
| **n8n proxy** | ✅ Active |
| **Мониторинг** | ✅ Healthcheck + Cloudflare Observability + structured logging |
| **Auth infrastructure** | ✅ Готова: Resend + business-360.ru, 2 KV namespaces созданы |
| **Срочный долг** | 🔴 Ротация пароля `dashboard_ro` |
| **Следующий шаг** | Сгенерировать код magic-link auth (следующая сессия) |
| **Ответственный** | Aleksey Melnikov |

---

## 3. Инфраструктура (где что физически живёт)

| Компонент | Платформа | URL / Путь | Как доступаюсь |
|---|---|---|---|
| Исходный код | GitHub (private) | `github.com/AlexMelnikov1976/chicko-api-proxy` | SSH key на MacBook |
| Backend API | Cloudflare Workers | `chicko-api-proxy.chicko-api.workers.dev` | `wrangler login` |
| База данных | Yandex Managed ClickHouse | `rc1d-3r30isjr73k4uue8.mdb.yandexcloud.net:8443` | Только через n8n proxy |
| Proxy / оркестратор | n8n self-hosted | `melnikov.app.n8n.cloud` | Web UI |
| n8n workflow: ClickHouse Proxy | n8n | `/webhook/clickhouse-proxy` | Active с 18.04.2026 |
| n8n workflow: Healthcheck | n8n | cron 3h | Active с 18.04.2026 |
| CI/CD | GitHub Actions | `.github/workflows/deploy.yml` | Auto на push в main |
| Observability | Cloudflare Workers Logs | dash → Worker → Observability | Встроенный UI |
| **Email provider** | **Resend** | `resend.com`, домен `business-360.ru` | Добавлен 19.04.2026 |
| **Auth domain** | **business-360.ru** (Reg.ru) | DNS настроен (DKIM+SPF+MX+DMARC) | Reg.ru панель |
| **Workers KV: USERS** | Cloudflare KV | id `6f095f10194a45ec9cdcc98129fb2426` | Whitelist email'ов |
| **Workers KV: MAGIC_LINKS** | Cloudflare KV | id `5519cb41b5554c51bf248dbecee1aa6a` | Активные magic-link токены |
| Локальная разработка | MacBook Air (macOS, zsh) | `~/Developer/chicko-api-proxy` | Терминал |
| Старый дашборд (v4) | Один HTML файл | `chiko_dashboard_v4__19_.html` | Раздаётся вручную |

**Рабочее окружение:** Node v25.9.0, npm 11.12.1, Git 2.39.5, wrangler 3.114 (долг: обновить до 4.x).

---

## 4. Архитектура

```
┌──────────────────┐
│  Frontend        │    (v4 HTML → Cloudflare Pages в M4)
│  Dashboard       │    + форма magic-link логина
└────────┬─────────┘
         │  HTTPS
         │
         ├──── POST /api/auth/request-link { email }
         │      → Worker проверяет whitelist в KV:USERS
         │      → генерирует токен, кладёт в KV:MAGIC_LINKS (TTL 15 мин)
         │      → Resend посылает письмо на email
         │
         ├──── POST /api/auth/verify { token }
         │      → Worker достаёт токен из KV:MAGIC_LINKS
         │      → удаляет токен (одноразовый)
         │      → выдаёт JWT (30 дней)
         │
         └──── POST /api/query { query } + Authorization: Bearer JWT
                → Worker проверяет JWT, выполняет SQL без RLS
         ▼
┌──────────────────────────┐
│  Cloudflare Workers      │◄─── GitHub Actions (auto-deploy on push)
│  chicko-api-proxy        │◄─── n8n Healthcheck (GET /health, 3h cron)
│    • JWT validate        │───► Cloudflare Observability
│    • NO RLS              │───► Resend API (send magic links)
│    • Structured logging  │
└────────┬─────────────────┘
         │  POST /webhook/clickhouse-proxy
         ▼
┌──────────────────────────┐
│  n8n Workflow            │  ✅ ACTIVE
│  ClickHouse Proxy        │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│  Yandex Managed          │
│  ClickHouse (chicko DB)  │
└──────────────────────────┘
```

---

## 5. Архитектурные решения (почему именно так)

### 5.1 Почему n8n proxy, а не прямое подключение Workers → ClickHouse?

Прямое подключение не работает: HTTPS 8443 → SSL error 526, HTTP 8123 → Connection timeout 522. n8n уже имеет рабочее подключение (`allowUnauthorizedCerts: true`). Плата: +~30мс latency.

### 5.2 Почему Cloudflare Workers?

Бесплатный тир, глобальный edge, zero-downtime secret updates, встроенная Observability.

### 5.3 Почему JWT 30 дней (не 24h)

24h — было для MVP-теста с одним admin-пользователем. Для реальных франчайзи 30 дней удобнее: открывают закладку — сразу данные. Не надо каждый день получать magic link. Ротация `JWT_SECRET` разом разлогинивает всех → есть kill switch.

### 5.4 Row-level security регексом — ВЫКИНУТО 19.04.2026

Исторически код имел RLS-регекс с `tenant_id`. Обнаружено утром 19.04:
- В реальной схеме `mart_restaurant_daily_base` **нет колонки `tenant_id`**. RLS ломался на любом реальном SQL.
- Продуктовое решение: франчайзи Chicko **видят все данные всей сети**. RLS не нужен.
- Решение: убрать RLS-регекс из `clickhouse.ts`. Все залогиненные видят всё.
- Multi-tenancy (когда появятся другие клиенты помимо Chicko) будет реализован через **отдельные deployments**, не через row-level фильтры в одной базе.

### 5.5 Почему документация в git (паспорт)

В git — технические детали. В Notion — оперативные задачи.

### 5.6 Почему GitHub Actions

Устраняет "забыл задеплоить", аудит-лог, воспроизводимость.

### 5.7 Почему credentials в URL query params (долг)

ClickHouse HTTP API поддерживает query params из коробки. Проблема: пароль в логах n8n. План: после ротации — рефакторинг на body/headers.

### 5.8 Почему healthcheck 3 часа, а не 5 минут

Экономим лимит n8n executions. UptimeRobot — долгосрочное решение.

### 5.9 Почему healthcheck проверяет только HTTP status code

Принцип: меньше зависимостей — меньше багов.

### 5.10 Почему Cloudflare Workers Logs, а не Sentry

Sentry sign-up возвращал 403 со всех IP/браузеров — гео-блокировка. Workers Logs — встроенная альтернатива.

### 5.11 wrangler.toml как IaC для observability

Всё, что влияет на работу системы, должно быть в git.

### 5.12 Structured logging с префиксами

Единые префиксы `[request]`, `[login]`, `[query]` позволяют фильтровать в Observability UI.

### 5.13 Почему magic-link через email, а не пароли или OAuth (решение 19.04.2026)

**Серия разворотов на 19.04:**
1. Password + KV → рассматривали. Хранить пароли — security-долг.
2. Google OAuth → пробовали. Google Cloud регистрация прошла, но **половина франчайзи на не-Gmail адресах** (Yandex, Mail.ru, корпоратив). OAuth через Google ломает UX для них.
3. Публичный URL без логина → рассматривали. Отброшено: нужен контроль доступа для будущего аудита.
4. **Magic-link через email** → финальный выбор:
   - Работает с **любым email** (Gmail, Yandex, Mail.ru, корпоратив)
   - Не зависит от страны или провайдера
   - Мы не храним пароли
   - Не нужна «забыл пароль» функциональность
   - UX: форма email → ссылка в письме → 30 дней сессия

### 5.14 Почему Resend для email (19.04.2026)

- Бесплатный тир: 3000 писем/мес (нам хватит на 42 пользователя × ~1 письмо/мес)
- Простой REST API, легко интегрируется с Workers
- Работает из РФ без VPN (американская компания, но без гео-блокировок для API)
- EU-регион (Ireland) → низкая latency к РФ

### 5.15 Почему domain business-360.ru (19.04.2026)

- Универсальное нейтральное имя — подходит и для Chicko, и для кинотеатров, и для будущих проектов
- Уже зарегистрирован на reg.ru
- DNS (SPF+DKIM+MX+DMARC) настроен 19.04, Resend verified за 10 минут

---

## 6. Credentials — журнал ротаций

| Дата | Что | Действие | Причина | Кто |
|---|---|---|---|---|
| 19.04.2026 | `RESEND_API_KEY` (Cloudflare secret) | Добавлен | Magic-link auth для франчайзи | Aleksey |
| 19.04.2026 | DNS записи `business-360.ru` (SPF/DKIM/MX/DMARC в Reg.ru) | Добавлены | Verification домена в Resend | Aleksey |
| 18.04.2026 | `CLICKHOUSE_HOST` | Обновлён на webhook URL n8n | Переключение на proxy | Aleksey |
| 18.04.2026 | Cloudflare API Token | Создан (scope: Edit Cloudflare Workers) | GitHub Actions | Aleksey |
| 🔴 TBD URGENT | ClickHouse `dashboard_ro` пароль | **Ротация обязательна** | Засветился в shell history, чате, n8n logs | Ожидает |
| 🟠 TBD | iiko passwords (`1234567890`, `79062181048`) | Ротация | Слабые и засвеченные | Ожидает |
| TBD | `JWT_SECRET` (production) | Ротация при переходе к real users | Dev-level для MVP | Ожидает |

### Где живут credentials

| Значение | Где лежит | Кто видит |
|---|---|---|
| `CLICKHOUSE_PASSWORD` production | Cloudflare Workers secrets | Только `wrangler secret` |
| `CLICKHOUSE_PASSWORD` локально | `~/Developer/chicko-api-proxy/.dev.vars` | Только на MacBook (gitignored) |
| `CLICKHOUSE_HOST` production | Cloudflare Workers secrets (webhook URL n8n) | Только `wrangler secret` |
| `JWT_SECRET` production | Cloudflare Workers secrets | Только `wrangler secret` |
| `RESEND_API_KEY` production | Cloudflare Workers secrets | Только `wrangler secret` |
| `CLOUDFLARE_API_TOKEN` (CI) | GitHub Secrets | Только GitHub Actions |
| Telegram bot credential `Chicko` (n8n) | n8n Credentials vault | Только через n8n UI |
| ClickHouse `dashboard_ro` | Yandex Cloud + менеджер паролей | Только Aleksey |
| SSH-ключ к GitHub | `~/.ssh/id_ed25519` на MacBook | Только Aleksey |

---

## 7. Структура проекта

```
~/Developer/chicko-api-proxy/
├── src/
│   ├── index.ts              # Main worker: routing + CORS + structured logging
│   ├── auth.ts               # JWT generation / validation (fix JWT decode bug 19.04)
│   └── clickhouse.ts         # ClickHouse client (RLS-регекс УБЕРЁМ в следующей сессии)
├── infra/
│   └── n8n/
│       ├── clickhouse_proxy.json   # ✅ в git с 18.04.2026
│       └── healthcheck.json        # ✅ в git с 18.04.2026
├── docs/
│   ├── PASSPORT.md           # Этот файл
│   └── archive/              # Старые MD-файлы (TODO)
├── .github/
│   └── workflows/
│       └── deploy.yml        # ✅ GitHub Actions автодеплой
├── .gitignore
├── .dev.vars                 # Gitignored. Локальные секреты
├── README.md
├── package.json
├── package-lock.json
├── tsconfig.json
└── wrangler.toml             # ✅ включает [observability] (следующим шагом: kv_namespaces)
```

**Что не в git:** `node_modules/`, `.wrangler/`, `.dev.vars`, `dist/`.

---

## 8. План развития — Волны инфраструктуры

### ✅ Волна 1: Критическая инфраструктура (закрыта 17.04.2026)

### 🟠 Волна 2: Автоматизация deploy и мониторинга (85% готово)

| Шаг | Время | Статус |
|---|---|---|
| GitHub Actions workflow | ~40 мин | ✅ 18.04 |
| Cloudflare API Token → GitHub Secrets | ~10 мин | ✅ 18.04 |
| Активация n8n proxy (M3) | ~60 мин | ✅ 18.04 |
| Обновление `CLICKHOUSE_HOST` secret | ~5 мин | ✅ 18.04 |
| Экспорт n8n workflows (ClickHouse Proxy + Healthcheck) в git | ~15 мин | ✅ 18.04 |
| n8n healthcheck workflow | ~40 мин | ✅ 18.04 |
| Cloudflare Workers Logs + structured logging | ~30 мин | ✅ 18.04 |
| wrangler.toml с `[observability]` (IaC) | — | ✅ 18.04 |
| Фикс JWT validateToken (decode вместо verify для payload) | ~15 мин | ✅ 19.04 |
| **Resend + business-360.ru DNS + API key** | ~30 мин | ✅ 19.04 |
| **2 KV namespaces (USERS, MAGIC_LINKS)** | ~5 мин | ✅ 19.04 |
| 🔴 **Ротация пароля ClickHouse** | ~20 мин | ⏳ NEXT |
| Выкинуть RLS из clickhouse.ts | ~10 мин | ⏳ (со следующим кодом) |
| **Написать magic-link auth код** (auth.ts + index.ts + wrangler.toml с kv_namespaces) | ~60 мин | ⏳ (следующая сессия) |

### 🟡 Волна 3: Трекинг и процесс (план: 1 день)

| Шаг | Цель |
|---|---|
| Notion database "Chicko Tasks" | Единый source of truth для задач |
| Миграция задач в Notion | One-time |
| `docs/archive/` для старых MD-файлов | Очистка корня |
| n8n workflow: GitHub webhook → Notion update | Автообновление статусов |
| Google Calendar events с milestones M4-M6 | Дедлайны в календаре |
| **Usage tracking в дашборде** | Метрика «кто реально заходит», измерение adoption |

### 🟢 Волна 4: Автоматизация бизнес-процесса

| Шаг | Цель |
|---|---|
| Cloudflare Pages для HTML-дашборда | URL вместо раздачи HTML |
| n8n daily-rebuild | Дашборд обновляется сам |
| n8n metrics-alerts | Проактивный мониторинг |
| Cloudflare Workers Cron Trigger: warm-cache | Dashboard за 50мс |
| **AI-инсайты в дашборд** | «Что будет», не «что было» — ключевая фишка |

### ⚪ Волна 5: Полировка

- Rate limiting через Workers KV
- Unit + integration tests
- CORS whitelist
- Dashboard usage analytics (продуктовое)
- Обновление wrangler 3.114 → 4.x
- Миграция healthcheck с n8n на UptimeRobot
- Перевод iiko-потоков на Credentials

---

## 9. Открытые вопросы и блокеры

**Активные:**

1. 🔴 **URGENT: Ротация пароля ClickHouse `dashboard_ro`**
2. 🟠 **Ротация iiko passwords**
3. **Домен business-360.ru** сейчас указывает на `95.163.244.138` (A-запись). Неизвестно что там стоит — возможно старый сайт. Если ничего важного — можно использовать `business-360.ru` для дашборда (`dashboard.business-360.ru` поддомен). Надо проверить.

**Вопросы на решение:**

- **Где хостить frontend?** Cloudflare Pages + собственный subdomain `dashboard.business-360.ru` или `chicko-dashboard.pages.dev`. Решим в следующей сессии при M4.
- **Доступ УК** (управляющей компании) — отдельная роль или тот же флоу? Пока — тот же флоу, все видят всё.

---

## 10. Changelog (что реально сделано, по датам)

### 19.04.2026, утро/день (~4ч работы)

**Утро началось с одной задачи и превратилось в архитектурный разбор.**

**Баги и архитектурные открытия:**
1. Найден **критический баг в `validateToken`**: `verify()` возвращает boolean, код кастил его как JWTPayload → `user_id = undefined` во всех запросах. Исправлено заменой на `decode()` после успешного `verify()`. Коммит `fix(auth): properly decode JWT payload`.
2. После фикса всплыла **вторая проблема**: RLS-регекс вставлял `WHERE tenant_id='tenant_chicko'` в каждый SQL. В реальной схеме `mart_restaurant_daily_base` **нет колонки `tenant_id`** — проверил через DataGrip прямым запросом к ClickHouse. RLS-регекс блокировал любой реальный запрос с ошибкой `Missing columns: 'tenant_id'`.
3. Схема `mart_restaurant_daily_base` — 45 колонок: `dept_id`, `dept_uuid`, `restaurant_name`, метрики выручки, foodcost, discount, delivery. Идентификатор ресторана — `dept_uuid`.

**Серия архитектурных разворотов (это важно, чтобы не повторять):**
- Начал переделывать RLS на фильтр по `dept_uuid` → остановил: user'ы не должны идентифицироваться для фильтра данных
- Предложил публичный URL без логина → отброшено: нужен контроль доступа
- Решили: каждый логинится своим email, но все видят все данные сети
- Сначала выбрали Workers KV + hashed passwords → ты предложил Google OAuth
- Пошли в Google Cloud Console → регистрация прошла, OAuth client создан. Переименовал app из `n8n` в `Chicko Analytics`. **НО:** половина франчайзи использует не-Gmail (Yandex, Mail.ru) → отброшено.
- **Финальный выбор:** magic-link через email (универсальный подход, работает с любым email-провайдером)

**Инфраструктура для magic-link настроена:**
- Зарегистрирован аккаунт в **Resend** (email-провайдер, 3000 писем/мес бесплатно, EU-регион Ireland)
- Домен **business-360.ru** (на Reg.ru) добавлен в Resend
- **4 DNS-записи прописаны в панели Reg.ru:**
  - TXT `resend._domainkey` — DKIM подпись
  - MX `send` → `feedback-smtp.eu-west-1.amazonses.com` priority 10
  - TXT `send` → `v=spf1 include:amazonses.com ~all`
  - TXT `_dmarc` → `v=DMARC1; p=none;` (опциональная)
- **Domain verified в Resend за ~10 минут** — можно слать письма
- API key создан в Resend (permission: Sending access, bound to business-360.ru)
- `RESEND_API_KEY` сохранён в Cloudflare Workers secrets
- Созданы 2 Workers KV namespaces:
  - `USERS` (id `6f095f10194a45ec9cdcc98129fb2426`) — whitelist разрешённых email
  - `MAGIC_LINKS` (id `5519cb41b5554c51bf248dbecee1aa6a`) — временные magic-link токены (TTL 15 мин)

**Что получено по результатам критического разбора стратегии:**
- Проект признан разумным. Distribution есть (42 франчайзи + конференция кинотеатров в июне).
- Риски: bus-factor 1, зависимость от iiko, UX adoption ≠ интерес на демо.
- Совет: не ждать полной полировки. M4 (frontend на API) — приоритет недели. Дать доступ нескольким франчайзи на следующей неделе, собрать реальный feedback.
- Добавить **usage tracking** в дашборд с первого дня пользования — без него не узнаешь реальный adoption.

**Что в очереди (следующая сессия):**
1. 🔴 Ротация пароля ClickHouse (обязательно до выдачи доступа франчайзи)
2. Сгенерировать весь код magic-link auth:
   - `src/auth.ts` — magic-link generation + JWT 30 дней
   - `src/index.ts` — endpoints /api/auth/request-link, /api/auth/verify
   - `src/clickhouse.ts` — без RLS
   - `wrangler.toml` — kv_namespaces blocks
3. CLI инструкция как добавить первого тестового пользователя в whitelist
4. Тест end-to-end: ввожу свой email → получаю письмо → кликаю → залогинен → `/api/query` работает
5. M4: frontend v4 перевести на новый API
6. Проверить что стоит на `business-360.ru:95.163.244.138` — возможно ли использовать поддомен `dashboard.business-360.ru`

### 18.04.2026, ночь (~1ч работы)

**Волна 2, шаг 4 — Cloudflare Workers Observability.**

- Попытка Sentry провалилась (403 Forbidden — гео-блокировка через браузерный fingerprint, VPN не помогает)
- Переключились на Cloudflare Workers Logs
- Включили Observability → Logs (sampling 100%)
- В `wrangler.toml` добавлен блок `[observability]` + `[observability.logs]` (IaC)
- В `src/index.ts` добавлено structured logging: `[request]`, `[login]`, `[query]` префиксы. `console.error` со stack trace в catch. Sensitive data (пароли, JWT, SQL) НЕ логируется.
- Протестировано 3 curl'ами → 10 строк логов в Observability UI

### 18.04.2026, поздний вечер (~1ч работы)

**Волна 2, шаг 3 — n8n healthcheck workflow активен.**

- Workflow: Schedule (3h) → HTTP GET `/health` → Evaluate state → IF notify? → Telegram
- State tracking через `$getWorkflowStaticData` — алерт только при переходе UP↔DOWN
- Протестировано искусственным падением (temp URL change): DOWN алерт пришёл
- Workflow JSON закоммичен в `infra/n8n/healthcheck.json`

### 18.04.2026, поздний вечер (~1.5ч работы)

**Волна 2, шаг 2 — n8n proxy. M3 закрыт.**

- Workflow `Chicko API: ClickHouse Proxy` написан с нуля, активирован
- `CLICKHOUSE_HOST` обновлён на webhook URL n8n. Zero-downtime
- End-to-end `/api/query` успешно: ~30мс round-trip
- Workflow JSON в `infra/n8n/clickhouse_proxy.json`

### 18.04.2026, вечер (~40 мин работы)

**Волна 2, шаг 1 — GitHub Actions автодеплой.**

### 17.04.2026, вечер (~2ч работы)

**Волна 1 инфраструктуры завершена:** git init, GitHub, SSH, консолидация MD-файлов.

### 17.04.2026, утро (~14ч работы за прошлые дни)

Backend API на Workers: `/health`, `/api/auth/login`, `/api/query`. JWT, RLS (выкинем), mock-клиент.

### 15-16.04.2026

Архитектурный план. Режим обучения в памяти Claude.

---

## 11. Контакты и доступы

- **Production API:** https://chicko-api-proxy.chicko-api.workers.dev
- **Production query endpoint:** `POST /api/query` (JWT required)
- **Observability:** Cloudflare Dashboard → `chicko-api-proxy` → Observability
- **n8n webhook (внутренний):** https://melnikov.app.n8n.cloud/webhook/clickhouse-proxy
- **Cloudflare Dashboard:** https://dash.cloudflare.com
- **GitHub Actions:** https://github.com/AlexMelnikov1976/chicko-api-proxy/actions
- **n8n:** https://melnikov.app.n8n.cloud/
- **ClickHouse (Yandex Cloud Console):** https://console.cloud.yandex.ru/
- **GitHub:** https://github.com/AlexMelnikov1976/chicko-api-proxy
- **Resend:** https://resend.com/domains
- **Reg.ru (DNS):** https://www.reg.ru/user/account/card/118339981/nss/

**Тестовые credentials (только для dev, до выдачи access франчайзи):**
- Email: `admin@chicko.ru`
- Password: `demo123`

**Тестовый end-to-end запрос:**
```bash
TOKEN=$(curl -s -X POST https://chicko-api-proxy.chicko-api.workers.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@chicko.ru","password":"demo123"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

curl -X POST https://chicko-api-proxy.chicko-api.workers.dev/api/query \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT 1 as test"}'
```

(⚠️ В следующей сессии: после внедрения magic-link auth этот тестовый endpoint будет заменён. Пока — для проверки проходимости pipeline.)

---

## 12. Где что искать

- **Как задеплоить код** → `git push origin main`
- **Как работает API** → [README.md](../README.md#api-reference)
- **Как посмотреть логи** → Cloudflare → Observability
- **Архитектура и почему так** → раздел [5](#5-архитектурные-решения-почему-именно-так)
- **Журнал паролей** → раздел [6](#6-credentials--журнал-ротаций)
- **Что делать дальше** → раздел [8](#8-план-развития--волны-инфраструктуры)
- **Тестовый end-to-end запрос** → раздел [11](#11-контакты-и-доступы)

---

## 13. Как поддерживать этот документ

**Когда обновлять:**
- После каждой завершённой Волны/milestone — [8] + [10]
- После ротации пароля — [6]
- После архитектурного решения — [5]
- После разблокировки блокера — [9] + [10]

**Правила:**
- Если противоречит коду — прав код, документ обновляется
- Не дублировать README.md
- Не плодить новые markdown-файлы

**Коммит:**
```
docs(passport): [что изменил кратко]
```

---

**Авторы:** Aleksey Melnikov + Claude
**Версии паспорта:** v3.3 → v3.4 → v3.5 → v3.6 → v3.7 → v3.8 → v3.9 → v3.10 → **v3.11** (текущая, фиксирует готовность инфраструктуры magic-link + 2 KV namespaces, 19.04.2026 день)
