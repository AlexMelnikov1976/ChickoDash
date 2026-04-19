# Паспорт проекта: Chicko Analytics

> **Живой документ.** Обновляется после каждой значимой сессии работы.
> История изменений — в разделе [Changelog](#10-changelog) внизу.
> Если что-то здесь противоречит коду в репо — прав код, этот документ надо обновить.

**Последнее обновление:** 19.04.2026, день (14:00 MSK) — Magic-link auth в проде, протестирован end-to-end
**Версия паспорта:** 3.12 (консолидирует v3.3–v3.11 + результаты дня 19.04)

---

## 1. Что это и зачем

**Chicko Analytics** — аналитическая платформа для франчайзи сети ресторанов Chicko. Показывает ключевые метрики (выручка, средний чек, foodcost, дисконт, доля доставки), сравнивает каждый ресторан с сетью и Top-10, строит динамику и выдаёт рекомендации.

**Пользователи:** все 42 франчайзи сети Chicko + управляющая компания.

**Особенность продукта:** все видят данные всей сети. Это не баг, это **фича** — сравнение внутри сети, бенчмарки, соревнование рестораторов.

**Текущее поколение (v4):** статический HTML-дашборд с hardcoded подключением к ClickHouse.

**Целевое поколение:** тот же дашборд + логин по magic-link на email + API отдаёт данные. **API и auth работают в проде.** Фронтенд (M4) — следующий шаг.

---

## 2. Моментальный снимок

| Поле | Значение |
|---|---|
| **Production API** | https://chicko-api-proxy.chicko-api.workers.dev 🟢 |
| **GitHub (private)** | github.com/AlexMelnikov1976/chicko-api-proxy |
| **Локально (Mac)** | `~/Developer/chicko-api-proxy` |
| **Общий прогресс** | ~70% от плана (Волна 1 ✅, Волна 2 на 75% ✅, Волна 2.5 ✅, backend end-to-end работает) |
| **Активный блокер** | Нет. API + auth работают, протестировано с реальными данными. |
| **Ближайший milestone** | M4: Frontend v4 на API + первые франчайзи имеют доступ — ETA 21-22.04 |
| **Автодеплой** | ✅ GitHub Actions: **11 зелёных деплоев за сутки** |
| **n8n proxy** | ✅ Active |
| **Мониторинг (uptime)** | ✅ n8n healthcheck каждые 3 часа → Telegram |
| **Мониторинг (логи)** | ✅ Cloudflare Observability |
| **Email-инфра** | ✅ Resend + `business-360.ru` verified |
| **Auth** | ✅ **Magic-link end-to-end работает**, тест 19.04 13:46 успешен |
| **KV storage** | ✅ `USERS` (whitelist) + `MAGIC_LINKS` (активные токены) |
| **В проде пользователей** | 1 (тест: melnikov181076@gmail.com) |
| **Срочный долг** | 🔴 Ротация пароля `dashboard_ro` — уже 3-й день переносится |
| **Ответственный** | Aleksey Melnikov |

---

## 3. Инфраструктура (где что физически живёт)

| Компонент | Платформа | URL / Путь | Как доступаюсь |
|---|---|---|---|
| Исходный код | GitHub (private) | `github.com/AlexMelnikov1976/chicko-api-proxy` | SSH key на MacBook |
| Backend API | Cloudflare Workers | `chicko-api-proxy.chicko-api.workers.dev` | `wrangler login` |
| База данных | Yandex Managed ClickHouse | `rc1d-3r30isjr73k4uue8.mdb.yandexcloud.net:8443` | Через n8n proxy |
| Proxy / оркестратор | n8n self-hosted | `melnikov.app.n8n.cloud` | Web UI |
| n8n workflow: ClickHouse Proxy | n8n | `/webhook/clickhouse-proxy` | Active |
| n8n workflow: Healthcheck | n8n | cron 3h | Active |
| CI/CD | GitHub Actions | `.github/workflows/deploy.yml` | Auto на push в main |
| Observability (логи Worker'а) | Cloudflare Workers Logs | dash → Worker → Observability | Встроенный UI |
| Email-провайдер | Resend | `resend.com` | API key (в wrangler secrets) |
| Sender domain | `business-360.ru` (reg.ru) | DNS: DKIM+SPF+DMARC verified | Resend verified 19.04 |
| KV: `USERS` | Cloudflare Workers KV | id `6f095f10194a45ec9cdcc98129fb2426` | `wrangler kv key` |
| KV: `MAGIC_LINKS` | Cloudflare Workers KV | id `5519cb41b5554c51bf248dbecee1aa6a` | `wrangler kv key` |
| Локальная разработка | MacBook Air (macOS, zsh) | `~/Developer/chicko-api-proxy` | Терминал |
| Старый дашборд (v4) | Один HTML файл | `chiko_dashboard_v4__19_.html` | Раздаётся вручную (пока) |

**Рабочее окружение:** Node v25.9.0, npm 11.12.1, Git 2.39.5, wrangler 3.114 (update available: 4.x — не критично).

---

## 4. Архитектура

```
┌──────────────────┐
│  User's Email    │ ◄──── Resend (noreply@business-360.ru)
│  (любой провайдер)│
└────────┬─────────┘
         │ Click magic link
         ▼
┌──────────────────────────┐
│  Cloudflare Workers      │◄─── GitHub Actions (auto-deploy on push)
│  chicko-api-proxy        │◄─── n8n Healthcheck (3h cron)
│                          │───► Cloudflare Observability
│  Public endpoints:       │
│    /health               │
│    /api/auth/request-link (POST email → rate limit → whitelist → Resend)
│    /auth/callback        (GET token → HTML с JWT, temporary до M4)
│    /api/auth/verify      (POST token → JWT как JSON, для фронта)
│                          │
│  Protected:              │
│    /api/query (JWT Bearer) ──► n8n proxy ──► ClickHouse
│                          │
│  KV bindings:            │
│    USERS (whitelist)     │
│    MAGIC_LINKS (tokens)  │
└──────────────────────────┘
```

**Auth flow (протестировано end-to-end 19.04 13:46-13:50):**

1. POST `/api/auth/request-link` с email
2. Worker: rate limit (1 req/60s), whitelist check, token generation (32 bytes hex), KV put с TTL 15 min, Resend send
3. Пользователь получает email (в inbox, не в спаме — DKIM/SPF/DMARC работают)
4. Клик по ссылке → GET `/auth/callback?token=...`
5. Worker: consume token (get + delete одним махом), whitelist check, JWT generation (30 дней)
6. HTML-страница с JWT (пока нет фронта)
7. Пользователь копирует JWT, использует в Bearer для `/api/query`
8. Worker валидирует JWT, исполняет SQL через n8n proxy, возвращает данные

**Без RLS** — все залогиненные пользователи видят все данные. Это продуктовое решение (5.14).

---

## 5. Архитектурные решения (почему именно так)

### 5.1–5.12 — предыдущие решения (см. v3.10, v3.11)

### 5.13 Magic-link вместо password/OAuth (19.04.2026) — **реализовано**

См. v3.11. Реализация:
- Токены через `crypto.getRandomValues(new Uint8Array(32))` → 64 hex chars
- KV `MAGIC_LINKS`, key `token:<hex>`, TTL 15 min
- Consume = get + delete (одноразовые)
- Rate limit: key `ratelimit:<email>`, TTL 60 сек
- User enumeration protection: `/api/auth/request-link` всегда возвращает 200, даже для неразрешённых email

### 5.14 НЕТ row-level security (19.04.2026) — **реализовано**

RLS-регекс удалён из `src/clickhouse.ts`. Функция `applyRowLevelSecurity()` и параметр `tenantId` в `query()` убраны. Клиент стал тонким wrapper'ом над HTTP API ClickHouse.

### 5.15 Resend как email-провайдер (19.04.2026) — **реализовано и работает**

3000 писем/мес бесплатно, eu-west-1 Ireland, простой API. Первое письмо дошло в inbox (не спам) — DNS настроены корректно.

### 5.16 Домен `business-360.ru` для email (19.04.2026) — **реализовано**

DNS в reg.ru:
- `resend._domainkey` TXT — DKIM public key
- `send` MX — feedback-smtp.eu-west-1.amazonses.com priority 10
- `send` TXT — v=spf1 include:amazonses.com ~all
- `_dmarc` TXT — v=DMARC1; p=none;

Verified 19.04 в 12:58 (12 минут от «добавить домен» до «verified»).

### 5.17 JWT 30 дней (19.04.2026) — **реализовано**

### 5.18 Защита от user enumeration (19.04.2026) — **реализовано**

`/api/auth/request-link` **всегда возвращает 200** даже если email не в whitelist. Иначе злоумышленник мог бы перебирать email'ы и узнавать кто зарегистрирован. Стандартная практика безопасности.

Сам email тихо не отправляется, но клиент не знает об этом.

### 5.19 Rate limit 1/60s на email (19.04.2026) — **реализовано**

KV `MAGIC_LINKS` хранит одновременно и активные токены (`token:<hex>`), и rate-limit счётчики (`ratelimit:<email>`, TTL 60 сек). Одно namespace — экономим на квотах.

Защита от: случайного абуза (кто-то написал скрипт в цикле), исчерпания Resend free tier (3000 писем/мес).

Не защищает от: распределённого абуза (1 запрос/мин × 1000 email'ов). Этого защитить не сможем без Workers Rate Limiting API — долг на Волну 5.

### 5.20 Временная HTML-страница на `/auth/callback` (19.04.2026)

Пока нет фронтенда (M4), клик по ссылке в письме ведёт на Worker endpoint `/auth/callback?token=...`, который возвращает **HTML-страницу** с текстом «Вход выполнен» и JWT-токеном для ручного копирования.

Когда появится фронт (M4) — эта страница будет делать redirect на `https://chicko-dashboard.pages.dev/auth?token=<magic-token>`, где фронт сделает POST на `/api/auth/verify` и сохранит JWT в localStorage.

Сейчас это **не красиво, но функционально** — позволяет тестировать бэкенд и раздавать доступ франчайзи даже без фронта.

---

## 6. Credentials — журнал ротаций

| Дата | Что | Действие | Причина | Кто сделал |
|---|---|---|---|---|
| 19.04.2026 утро | `RESEND_API_KEY` (Cloudflare secret) | Создан | Отправка magic-link писем | Aleksey |
| 19.04.2026 утро | Resend domain `business-360.ru` | Добавлен, DNS прописан, verified | Кастомный sender-домен | Aleksey |
| 19.04.2026 утро | KV namespaces `USERS` + `MAGIC_LINKS` | Созданы | Whitelist пользователей + временные токены | Aleksey |
| 19.04.2026 день | Первый пользователь в KV `USERS` | `user:melnikov181076@gmail.com` → `{"user_id":"user_001"}` | Для теста end-to-end | Aleksey |
| 18.04.2026 вечер | `CLICKHOUSE_HOST` | Обновлён на webhook URL n8n | Переключение на n8n-прокси | Aleksey |
| 18.04.2026 | Cloudflare API Token (для CI) | Создан (bounded scope) | GitHub Actions | Aleksey |
| 🔴 **TBD URGENT** | ClickHouse `dashboard_ro` пароль | **Ротация обязательна** | Пароль `chiko_dash_2026` засветился в 4+ местах | Ожидает (3-й день переносится) |
| 🟠 TBD | iiko passwords | Ротация рекомендуется | Слабые и засвечены в n8n export | Ожидает |

### Где живут credentials

| Значение | Где лежит | Кто видит |
|---|---|---|
| `CLICKHOUSE_PASSWORD` production | Cloudflare Workers secrets | Только `wrangler secret` |
| `CLICKHOUSE_HOST` production | Cloudflare Workers secrets | Только `wrangler secret` |
| `JWT_SECRET` production | Cloudflare Workers secrets | Только `wrangler secret` |
| `RESEND_API_KEY` production | Cloudflare Workers secrets | Только `wrangler secret` |
| `CLOUDFLARE_API_TOKEN` (для CI) | GitHub Secrets | Только GitHub Actions |
| Telegram bot credential `Chicko` | n8n Credentials vault | Только через n8n UI |
| ClickHouse `dashboard_ro` credentials | Yandex Cloud + менеджер паролей | Только Aleksey |
| Resend credentials | Личный gmail Aleksey | Только Aleksey |
| Reg.ru credentials (DNS) | Личный mail.ru Aleksey | Только Aleksey |
| Users whitelist | KV `USERS` (Cloudflare) | Только Aleksey через `wrangler kv key` |
| Magic-link tokens (временные, 15 мин) | KV `MAGIC_LINKS` (Cloudflare) | Автоматически удаляются |
| SSH-ключ к GitHub | `~/.ssh/id_ed25519` на MacBook | Только Aleksey |

---

## 7. Структура проекта

```
~/Developer/chicko-api-proxy/
├── src/
│   ├── index.ts              # Main: 4 endpoints + structured logging + HTML templates
│   ├── auth.ts               # JWT 30 дней, payload {user_id, email, exp}
│   ├── clickhouse.ts         # Тонкий клиент, RLS удалён
│   └── magic_link.ts         # Tokens + KV + Resend send
├── infra/
│   └── n8n/
│       ├── clickhouse_proxy.json   # ✅
│       └── healthcheck.json        # ✅
├── docs/
│   ├── PASSPORT.md           # Этот файл
│   └── archive/              # TODO
├── .github/
│   └── workflows/
│       └── deploy.yml        # GitHub Actions
├── .gitignore
├── .dev.vars                 # Gitignored
├── README.md                 # TODO: обновить с новыми endpoints
├── package.json
├── package-lock.json
├── tsconfig.json
└── wrangler.toml             # observability + kv_namespaces (IaC)
```

---

## 8. План развития — Волны инфраструктуры

### ✅ Волна 1: Критическая инфраструктура (17.04.2026)

### 🟠 Волна 2: Автоматизация deploy и мониторинга (75% готово)

| Шаг | Статус |
|---|---|
| GitHub Actions автодеплой | ✅ 18.04 |
| Cloudflare API Token → GitHub Secrets | ✅ 18.04 |
| Активация n8n proxy (M3) | ✅ 18.04 |
| Экспорт n8n workflows в git | ✅ 18.04 |
| n8n healthcheck + Telegram | ✅ 18.04 |
| Cloudflare Workers Logs | ✅ 18.04 |
| wrangler.toml IaC (observability) | ✅ 18.04 |
| Фикс JWT decode | ✅ 19.04 утро |
| 🔴 **Ротация пароля ClickHouse** | ⏳ ПЕРЕНОСИТСЯ 3-Й ДЕНЬ |
| Sentry | ⏸ (заменено Cloudflare Logs) |

### ✅ Волна 2.5: Magic-link authentication (ЗАКРЫТА 19.04)

| Шаг | Статус |
|---|---|
| Google OAuth проверен и отвергнут | ✅ 19.04 |
| Resend + домен business-360.ru verified | ✅ 19.04 |
| DNS-записи в reg.ru | ✅ 19.04 |
| `RESEND_API_KEY` в secrets | ✅ 19.04 |
| KV namespaces | ✅ 19.04 |
| `wrangler.toml` с kv_namespaces | ✅ 19.04 |
| `src/magic_link.ts` написан | ✅ 19.04 |
| `src/auth.ts` упрощён (JWT 30 дней) | ✅ 19.04 |
| RLS удалён из `src/clickhouse.ts` | ✅ 19.04 |
| `src/index.ts` переписан (новые endpoints) | ✅ 19.04 |
| Тестовый пользователь в KV `USERS` | ✅ 19.04 |
| **End-to-end тест** | ✅ **19.04 13:46-13:50: письмо → клик → JWT → /api/query → 26 666 строк данных** |

### 🟠 Волна 3: M4 — Frontend v4 на API (**главная задача недели**)

| Шаг | Оценка |
|---|---|
| Проанализировать существующий HTML-дашборд v4 | 30 мин |
| Добавить форму логина (email input) | 30 мин |
| Реализовать flow: email → request-link → инструкция «проверьте почту» | 40 мин |
| На страницу-callback после клика — redirect на фронт с token | 20 мин |
| Фронт делает `/api/auth/verify`, сохраняет JWT в localStorage | 30 мин |
| Все fetch-запросы к ClickHouse заменить на `/api/query` с Bearer JWT | 1-2 часа |
| Cloudflare Pages для автодеплоя из отдельного репо `chicko-dashboard` | 30 мин |
| Тест: полный цикл на себе | 30 мин |
| Раздать доступ 3-5 франчайзи | 20 мин |
| **ИТОГО** | **~5 часов сфокусированной работы** |

### 🟠 Волна 3.5: Usage tracking (параллельно с M4)

| Шаг | Цель |
|---|---|
| Новый endpoint `/api/track` или встроить в `/api/query` логирование | Знать кто когда заходит |
| Таблица в ClickHouse: `dashboard_access_log` (user_id, email, timestamp, action) | Analytics about analytics |
| Простой отчёт раз в неделю: сколько уникальных пользователей, сколько сессий | Понимание adoption |

### 🟡 Волна 4: Автоматизация бизнес-процесса

- Cloudflare Pages автодеплой дашборда из git
- n8n daily-rebuild дашборда из Google Sheets
- n8n metrics-alerts
- AI-инсайты в дашборд

### ⚪ Волна 5: Полировка

- Workers Rate Limiting API (защита от распределённого абуза)
- Unit + integration tests
- CORS whitelist
- wrangler 3.114 → 4.x
- Миграция healthcheck на UptimeRobot
- iiko-потоки → Credentials

---

## 9. Открытые вопросы и блокеры

**Активные:**

1. 🔴 **URGENT: Ротация пароля ClickHouse `dashboard_ro`** — 3-й день переносится
2. 🟠 **Ротация iiko passwords**
3. 🟡 **M4 (frontend) не начат** — главный фокус на оставшуюся часть недели

**Закрытые (для истории):**

- ~~JWT decode bug~~ ✅ 19.04 утро
- ~~RLS vs реальная схема~~ ✅ 19.04 утро (RLS удалён)
- ~~user=undefined в логах~~ ✅ 19.04 утро
- ~~Magic-link инфра не готова~~ ✅ 19.04 утро
- ~~Magic-link код не написан~~ ✅ 19.04 день
- ~~End-to-end тест magic-link~~ ✅ 19.04 13:46

---

## 10. Changelog

### 19.04.2026, день (~2ч работы, 13:00-15:00)

**Волна 2.5 ЗАКРЫТА. Magic-link auth работает в проде end-to-end.**

Написаны 5 файлов одним коммитом:
- `wrangler.toml` — добавлены блоки `[[kv_namespaces]]` для USERS и MAGIC_LINKS
- `src/magic_link.ts` (NEW) — модуль: generate/store/consume tokens, whitelist check, rate limit, Resend send с HTML + text email template (на русском)
- `src/auth.ts` — JWT 30 дней (было 24h), минимальный payload `{user_id, email, exp}` (убраны tenant_id, permissions, dept_uuid)
- `src/clickhouse.ts` — RLS удалён. Функция `applyRowLevelSecurity` и параметр `tenantId` в `query()` убраны. Тонкий клиент.
- `src/index.ts` — routing:
  - ❌ `/api/auth/login` удалён (password flow)
  - ✅ `/api/auth/request-link` POST — rate limit + whitelist + Resend send
  - ✅ `/auth/callback` GET — token → HTML с JWT (временная страница до M4)
  - ✅ `/api/auth/verify` POST — token → JWT как JSON (для фронта)
  - 🔄 `/api/query` — без RLS, только JWT auth

Коммит `44c5cc5` — 11-й автодеплой, зелёный за ~24 сек.

**Первый пользователь добавлен** в KV `USERS`:
```
user:melnikov181076@gmail.com → {"user_id":"user_001"}
```

**End-to-end тест (13:46-13:50):**
1. `curl POST /api/auth/request-link` с email → `{"success":true,"message":"Link sent."}`
2. Gmail получил письмо от `Chicko Analytics <noreply@business-360.ru>` с темой «Вход в Chicko Analytics» — **в inbox, не в спаме** (DKIM+SPF+DMARC работают)
3. Клик по кнопке «Войти в дашборд» → открылась страница «Вход выполнен ✅», показан JWT
4. Copy JWT → `curl POST /api/query` с `Authorization: Bearer <JWT>` и query `SELECT count() FROM mart_restaurant_daily_base`
5. Ответ: `{"status":"success","data":[{"total":"26666"}],"rows":1,"statistics":{"elapsed":0.0122,...},"user_id":"user_001","email":"melnikov181076@gmail.com"}`

**Это означает:** 26 666 строк реальных данных из ClickHouse через полный flow Workers → n8n → ClickHouse. ~12 миллисекунд на запрос. JWT валидно декодируется, email корректно в ответе.

**Весь backend готов для M4.** Осталось только фронт написать.

### 19.04.2026, утро (~3ч работы)

См. v3.11. Кратко:
- Fix JWT decode (verify returns boolean, decode returns payload)
- Серия разворотов auth-стратегии
- Инфра magic-link: Resend, домен, KV, secrets

### 18.04.2026, ночь

См. v3.10. Cloudflare Observability + structured logging.

### 18.04.2026, поздний вечер

См. v3.8-v3.9. M3 закрыт, n8n proxy, healthcheck.

### 18.04.2026, вечер

См. v3.7. GitHub Actions автодеплой.

### 17.04.2026

Волна 1 завершена. См. v3.5.

---

## 11. Контакты и доступы

- **Production API:** https://chicko-api-proxy.chicko-api.workers.dev
- **Observability:** Cloudflare Dashboard → `chicko-api-proxy` → Observability → Events
- **n8n webhook (внутренний):** https://melnikov.app.n8n.cloud/webhook/clickhouse-proxy
- **Resend dashboard:** https://resend.com/domains
- **Reg.ru (DNS):** https://www.reg.ru/ → `business-360.ru`
- **Google Cloud (OAuth, не используется):** проект `Pron8n-478909`
- **Cloudflare Dashboard:** https://dash.cloudflare.com
- **GitHub Actions:** https://github.com/AlexMelnikov1976/chicko-api-proxy/actions
- **n8n:** https://melnikov.app.n8n.cloud/
- **ClickHouse (Yandex Cloud Console):** https://console.cloud.yandex.ru/
- **GitHub:** https://github.com/AlexMelnikov1976/chicko-api-proxy

**Тестовый пользователь в KV `USERS`:**
- Email: `melnikov181076@gmail.com`
- user_id: `user_001`

**Как добавить нового пользователя:**
```bash
npx wrangler kv key put \
  --namespace-id=6f095f10194a45ec9cdcc98129fb2426 \
  "user:имя@домен.ru" \
  '{"user_id":"user_NNN"}'
```

**Как запросить magic-link (для тестов):**
```bash
curl -X POST https://chicko-api-proxy.chicko-api.workers.dev/api/auth/request-link \
  -H "Content-Type: application/json" \
  -d '{"email":"имя@домен.ru"}'
```

**Тестовый end-to-end запрос после получения JWT:**
```bash
JWT="<токен со страницы /auth/callback>"

curl -X POST https://chicko-api-proxy.chicko-api.workers.dev/api/query \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT count() as total FROM mart_restaurant_daily_base"}'
```

Все curl-команды на одной строке, без переносов строк с `\` (с переносами ломается в zsh).

---

## 12. Где что искать

- **Как задеплоить код** → `git push origin main` (автоматически)
- **Как посмотреть логи** → Cloudflare → `chicko-api-proxy` → Observability
- **Как добавить пользователя** → раздел [11](#11-контакты-и-доступы)
- **Как работает magic-link** → раздел [4](#4-архитектура) + [5.13, 5.18, 5.19](#5-архитектурные-решения-почему-именно-так)
- **Журнал паролей** → раздел [6](#6-credentials--журнал-ротаций)
- **Что делать дальше (M4)** → раздел [8](#8-план-развития--волны-инфраструктуры), «Волна 3»
- **Исторические документы** → `docs/archive/`

---

## 13. Как поддерживать этот документ

Всё как в v3.10-3.11:
- После Волны/milestone — [8] + [10]
- После ротации — [6]
- После решения — [5]
- После разблокировки — [9] + [10]

**Коммит:** `docs(passport): [что изменил кратко]`

---

**Авторы:** Aleksey Melnikov + Claude
**Версии паспорта:** v3.3 → ... → v3.10 → v3.11 → **v3.12** (текущая, фиксирует magic-link в проде end-to-end, 19.04.2026 день)
