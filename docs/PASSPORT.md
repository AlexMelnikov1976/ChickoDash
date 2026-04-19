# Паспорт проекта: Chicko Analytics

> **Живой документ.** Обновляется после каждой значимой сессии работы.
> История изменений — в разделе [Changelog](#10-changelog) внизу.
> Если что-то здесь противоречит коду в репо — прав код, этот документ надо обновить.

**Последнее обновление:** 19.04.2026, 15:30 MSK — M4 в проде, дашборд с JWT и реальными данными
**Версия паспорта:** 3.13 (консолидирует v3.12 + M4 frontend + обнаруженные проблемы Safari)

---

## 1. Что это и зачем

**Chicko Analytics** — аналитическая платформа для франчайзи сети ресторанов Chicko. Показывает ключевые метрики (выручка, средний чек, foodcost, дисконт, доля доставки), сравнивает каждый ресторан с сетью и Top-10, строит динамику и выдаёт AI-рекомендации.

**Пользователи:** все 42 франчайзи сети Chicko + управляющая компания.

**Особенность:** все видят данные всей сети. Сравнение внутри сети — продуктовая фича, не баг.

**Состояние:** **полностью работающий продукт в проде**. Backend + Auth + Frontend развернуты на одном URL. Пользователи уже могут получать доступ.

---

## 2. Моментальный снимок

| Поле | Значение |
|---|---|
| **Production URL** | https://chicko-api-proxy.chicko-api.workers.dev 🟢 |
| **Что это** | HTML-дашборд + API + magic-link auth на одном URL |
| **GitHub** | github.com/AlexMelnikov1976/chicko-api-proxy |
| **Локально** | `~/Developer/chicko-api-proxy` |
| **Общий прогресс** | ~85% от MVP (backend ✅, auth ✅, frontend ✅, первый тест ✅) |
| **Активный блокер** | Нет, продукт работает |
| **Следующая цель** | Раздать доступ 5 тестовым франчайзи (M5) |
| **Автодеплой** | ✅ GitHub Actions — 12 зелёных деплоев |
| **Пользователей в проде** | 1 (сам, для теста) |
| **Срочный долг** | 🔴 Ротация пароля `dashboard_ro` — не делается по решению владельца |
| **Новая проблема** | 🟠 Safari + workers.dev на некоторых сетях рвёт соединение (см. [раздел 9.2](#92-safari--workersdev-нестабильное-соединение)) |
| **Ответственный** | Aleksey Melnikov |

---

## 3. Инфраструктура

| Компонент | Платформа | URL / Путь |
|---|---|---|
| **Frontend (HTML dashboard)** | Cloudflare Workers `GET /` | chicko-api-proxy.chicko-api.workers.dev |
| **Backend API** | Cloudflare Workers `/api/*`, `/auth/*` | тот же URL |
| Исходный код | GitHub (private) | github.com/AlexMelnikov1976/chicko-api-proxy |
| База данных | Yandex Managed ClickHouse | `rc1d-3r30isjr73k4uue8.mdb.yandexcloud.net:8443` через n8n |
| Proxy | n8n self-hosted | `/webhook/clickhouse-proxy` — Active |
| Healthcheck | n8n cron 3h | Telegram при падении |
| CI/CD | GitHub Actions | push → deploy за ~25 сек |
| Observability | Cloudflare Workers Logs | Structured logging |
| Email | Resend + `business-360.ru` | DKIM+SPF+DMARC verified |
| KV: USERS | `6f095f10194a45ec9cdcc98129fb2426` | Whitelist |
| KV: MAGIC_LINKS | `5519cb41b5554c51bf248dbecee1aa6a` | Tokens + rate limit |
| Локально | MacBook Air (macOS, zsh) | `~/Developer/chicko-api-proxy` |

---

## 4. Архитектура

```
┌────────────────────────┐
│     User (любой        │
│     браузер/email)     │
└────────┬───────────────┘
         │
         │ 1. GET / → дашборд HTML + JS
         │ 2. Если нет JWT → login screen
         │ 3. Email → POST /api/auth/request-link
         ▼
┌────────────────────────┐     Resend API
│  Cloudflare Workers    │─────────────────► Email user's inbox
│  (один URL на всё)     │                    (noreply@business-360.ru)
│                        │
│  Endpoints:            │     Клик по ссылке в письме
│   GET  /               │←──────────────────────────┐
│   GET  /health         │                           │
│   POST /api/auth/      │                           │
│        request-link    │    4. /auth/callback?token=xxx
│   GET  /auth/callback  │                           │
│   POST /api/auth/verify│    5. 302 → /?login_token=xxx
│   POST /api/query      │                           │
│                        │    6. JS → POST /api/auth/verify
│  KV bindings:          │    7. Получает JWT, сохраняет в localStorage
│   USERS                │    8. Дашборд грузит данные через /api/query
│   MAGIC_LINKS          │
└─────────┬──────────────┘
          │
          │ /api/query → SQL forwarded
          ▼
┌────────────────────────┐
│       n8n proxy        │
│  /webhook/clickhouse   │
└─────────┬──────────────┘
          │
          ▼
┌────────────────────────┐
│  Yandex ClickHouse     │
│  DB: chicko            │
│  Tables:               │
│   mart_restaurant_     │
│   daily_base           │
│   (26666 rows)         │
│   mart_benchmarks_     │
│   daily                │
│   mart_restaurant_     │
│   scores               │
│   mart_recommendations │
└────────────────────────┘
```

**M4 Frontend flow (протестирован в Chrome 19.04 14:23):**

1. Пользователь открывает `/` → Worker отдаёт HTML (130 КБ)
2. JS проверяет localStorage → если `chicko_jwt` есть, прячет login-screen и запускает `init()`
3. `init()` делает 4 запроса через `fetchCK()` → каждый идёт на `/api/query` с Bearer JWT
4. Worker валидирует JWT, проксирует SQL в n8n → ClickHouse
5. Данные возвращаются, Chart.js рисует графики, метрики рассчитываются

---

## 5. Архитектурные решения

### 5.1–5.20 — предыдущие (см. v3.12)

### 5.21 Frontend в том же Worker, не на Cloudflare Pages (19.04.2026)

**Решение:** HTML дашборда хранится в `src/dashboard.ts` как экспортируемая строка (130 КБ), `GET /` отдаёт её как `text/html`. Один URL на всё.

**Почему не Pages:**
- Pages требует отдельного проекта, дополнительных минут настройки
- Cross-origin CORS issues между Pages и Worker
- Для MVP `chicko-api-proxy.chicko-api.workers.dev` — один URL, одно место деплоя

**Минусы текущего подхода (для Волны 5):**
- HTML как TypeScript template literal — нужно экранировать `${` и `` ` `` (сделано скриптом)
- Правка UI требует пересборки `dashboard.ts` через Python-трансформацию или вручную
- Worker bundle тяжелее (130 КБ), но это нормально для Workers (лимит 1 МБ)

### 5.22 Минимальные правки v4 вместо переписывания (19.04.2026)

Из 2055 строк HTML v4 изменены только три места:
1. CSS login-screen — **+20 строк** в `<head>`
2. HTML login-form — **+10 строк** после `<body>`
3. JS: `fetchCK()` переписан + добавлены 3 новые функции (`getJWT`, `showLogin`, `bootAuth`) — **+80 строк JS**

**Не трогалось:** 2000+ строк — логика графиков, расчёт метрик, календарь, селекторы, Chart.js-конфиги. Всё это работает как раньше.

### 5.23 `/auth/callback` делает 302 redirect, а не возвращает HTML (19.04.2026)

**Было (до M4):** `/auth/callback?token=xxx` отдавал HTML-страницу с JWT для ручного копирования пользователем.

**Стало:** `/auth/callback?token=xxx` → HTTP 302 → `/?login_token=xxx`. Фронтенд видит параметр, делает POST `/api/auth/verify`, получает JWT, сохраняет в localStorage, убирает параметр из URL.

**Важно:** токен НЕ потребляется на стадии `/auth/callback` (только redirect). Потребляется только когда фронт делает POST `/api/auth/verify`. Это одноразовый токен, и после потребления его нельзя использовать повторно.

### 5.24 JWT в localStorage, не в HttpOnly cookie (19.04.2026)

**Выбрано:** `localStorage.setItem('chicko_jwt', ...)`.

**Почему не cookies:**
- Cookies требуют правильного CORS + `SameSite` + `credentials: 'include'` — больше шагов
- В MVP XSS-риск низкий (нет пользовательского input, который рендерится)
- localStorage проще для текущего архитектурного решения (`GET /` + `/api/*` на одном домене)

**Минусы (для Wave 5):**
- Уязвимо к XSS, если таковой возникнет
- Нельзя использовать `HttpOnly` защиту

**Митигация:** CSP-заголовки (пока не настроены — долг), вся логика клиентская, user input только в форме email которая проходит через Resend.

---

## 6. Credentials — журнал ротаций

| Дата | Что | Действие | Статус |
|---|---|---|---|
| 🔴 **ПЕРЕНЕСЕНО** | ClickHouse `dashboard_ro` пароль | Явно отклонена ротация владельцем | Решение: не ротировать, т.к. HTML v4 только на локальном Mac владельца |
| 19.04.2026 день | Первый пользователь `melnikov181076@gmail.com` | Добавлен в KV USERS | ✅ Тестовый запрос 14:23 прошёл успешно |
| 19.04.2026 утро | `RESEND_API_KEY` + домен `business-360.ru` | Созданы | ✅ Письма в inbox |
| 19.04.2026 утро | KV USERS + MAGIC_LINKS | Созданы | ✅ |
| 18.04.2026 вечер | `CLICKHOUSE_HOST` | Обновлён на webhook n8n | ✅ |
| 18.04.2026 | Cloudflare API Token для CI | Создан | ✅ |
| 🟠 TBD | iiko passwords | Ротация рекомендуется | Ожидает |

### Где живут credentials

| Что | Где |
|---|---|
| `CLICKHOUSE_PASSWORD/HOST/USER` | Cloudflare Workers secrets |
| `JWT_SECRET` | Cloudflare Workers secrets |
| `RESEND_API_KEY` | Cloudflare Workers secrets |
| `CLOUDFLARE_API_TOKEN` | GitHub Secrets (только для Actions) |
| Users whitelist | KV USERS namespace |
| Magic-link tokens | KV MAGIC_LINKS namespace (TTL 15 мин) |
| SSH-ключ | `~/.ssh/id_ed25519` на MacBook |

---

## 7. Структура проекта

```
~/Developer/chicko-api-proxy/
├── src/
│   ├── index.ts              # Main: routing + 5 endpoints + structured logging
│   ├── auth.ts               # JWT 30 дней, payload {user_id, email, exp}
│   ├── clickhouse.ts         # Тонкий клиент, RLS удалён
│   ├── magic_link.ts         # Tokens + KV + Resend send
│   └── dashboard.ts          # M4: HTML дашборда (130 КБ template literal)
├── infra/
│   └── n8n/
│       ├── clickhouse_proxy.json
│       └── healthcheck.json
├── docs/
│   ├── PASSPORT.md           # Этот файл
│   └── archive/              # TODO
├── .github/workflows/deploy.yml
├── wrangler.toml             # observability + kv_namespaces (IaC)
├── package.json / tsconfig.json
├── .gitignore + .dev.vars
└── README.md                 # TODO: обновить под M4
```

---

## 8. План развития — Волны

### ✅ Волна 1: Критическая инфраструктура (17.04.2026)

### ✅ Волна 2: Автоматизация deploy и мониторинга (18.04.2026)

### ✅ Волна 2.5: Magic-link authentication (19.04.2026 утро)

### ✅ Волна 3 (M4): Frontend — ЗАКРЫТА 19.04.2026 день

| Шаг | Статус |
|---|---|
| Анализ HTML v4 (2055 строк, 131 КБ) | ✅ 19.04 |
| Python-трансформация: login CSS/HTML + fetchCK переписан | ✅ 19.04 |
| `src/dashboard.ts` создан (130 КБ экспортируемая строка) | ✅ 19.04 |
| `src/index.ts`: `GET /` → дашборд, `/auth/callback` → 302 redirect | ✅ 19.04 |
| 12-й автодеплой зелёный | ✅ 19.04 |
| **End-to-end тест в Chrome** | ✅ **19.04 14:23: Благовещенск, 3.5 месяца данных, все метрики, все графики** |
| Тест login-screen в Safari | ✅ 19.04 14:58 (форма показалась, Chrome-проверка обойдена) |
| Тест magic-link в Safari | 🟠 19.04 15:09 — VPN + сетевые проблемы Safari+workers.dev (см. [9.2](#92)) |

### 🟢 Волна 4 (M5): Пилот с франчайзи (следующий шаг)

| Шаг | Оценка |
|---|---|
| Добавить 3-5 тестовых франчайзи в KV USERS | 5 мин |
| Отправить им URL и инструкцию «вбейте email, проверьте почту» | 10 мин |
| Собрать feedback: баги, UX, что непонятно | 3-7 дней ожидания |
| Fix критичных багов по feedback | 1-2 сессии |
| Объявить всем 42 франчайзи | После пилота |

### 🟡 Волна 5: Стабилизация и безопасность (параллельно с пилотом)

| Шаг | Приоритет | Причина |
|---|---|---|
| **Custom domain** (`dashboard.business-360.ru`) | 🔴 Высокий | Решает Safari+workers.dev проблему (см. [9.2](#92)) |
| Retry логика в fetch (network errors) | 🔴 Высокий | Митигирует нестабильность сети пользователей |
| Понятные сообщения об ошибках вместо `Load failed` | 🟠 Средний | UX для пользователей |
| `<link rel="preconnect">` в HEAD | 🟠 Средний | Оптимизация первой загрузки |
| Fix calendar `renderDayGrid` undefined bug | 🟠 Средний | Не блокирует, но некрасиво |
| CSP-заголовки + HttpOnly cookie для JWT | 🟡 Низкий | Security hardening |
| Usage tracking (кто когда заходит) | 🟡 Низкий | Analytics about analytics |
| Rate limiting распределённый (Workers Rate Limiting API) | 🟡 Низкий | Защита от абуза |
| Unit + integration tests | 🟡 Низкий | Стабильность кодовой базы |
| Ротация iiko passwords | 🟡 Низкий | Hygiene |
| Миграция wrangler 3.x → 4.x | 🟡 Низкий | Несрочно |
| Миграция healthcheck n8n → UptimeRobot | 🟡 Низкий | При 10+ пользователях |

### ⚪ Волна 6: Расширение продукта

- AI-агент в дашборде (запросы на естественном языке)
- Cloudflare Pages + отдельный репо для frontend (если Worker-HTML станет bottleneck)
- Экспорт отчётов в PDF / Excel
- Мобильная версия
- Email-дайджесты по расписанию
- n8n daily-rebuild дашборда из Google Sheets
- Следующая вертикаль: Lumen Film (сеть кинотеатров)

---

## 9. Открытые вопросы и блокеры

### 9.1 Срочные долги

| № | Что | Приоритет | Комментарий |
|---|---|---|---|
| 1 | Ротация iiko passwords | 🟠 Средний | Слабые и засвечены в n8n |
| 2 | Обновить README под M4 (добавить `GET /` endpoint + frontend flow) | 🟠 Средний | Документация отстаёт от кода |

### 9.2 Safari + workers.dev — нестабильное соединение

**Симптомы (воспроизводимо 19.04.2026 15:09-15:22 на MacBook):**
- Safari при POST на `/api/auth/request-link` показывает `Ошибка: Load failed` **после** того как запрос уже дошёл до сервера (письмо приходит)
- Safari при GET на `/?login_token=...` показывает `Safari не может открыть страницу... сервер неожиданно отключился` — причём redirect прошёл корректно (URL в адресной строке правильный)
- В Chrome на том же MacBook — всё работает без ошибок
- Проблема частично спровоцирована VPN, но сохраняется и без него
- curl из того же терминала работает — значит не провайдер, а именно браузер

**Гипотеза о причине:**
- Shared infrastructure `.workers.dev` поддоменов Cloudflare
- Safari делает HTTP/3 (QUIC) соединение к Cloudflare
- Где-то на пути (MTU? промежуточный фильтр?) QUIC-пакеты теряются
- Safari не fallback-ается на HTTP/2 корректно

**Митигации (от дешёвой к дорогой):**

1. **Custom domain** (`dashboard.business-360.ru` → Cloudflare Workers Custom Domain) — скорее всего уберёт проблему, так как custom domain имеет своё routing и IP
2. **Retry в JS** — при `TypeError: Load failed` / `AbortError` автоматически повторить запрос через 200мс, до 3 попыток
3. **Preconnect link** в HEAD — заранее устанавливает TCP+TLS
4. **Дольше таймаут + явное сообщение пользователю**: «Если не пришло — обновите страницу через 10 секунд»

**Решение для пилота:**
Проблема **не блокирует** продукт — Chrome/Edge/Firefox всё работают. Большинство франчайзи на Windows → Chrome/Edge. iPhone/iPad/Safari mac — меньшинство, у них может быть та же проблема.

В инструкциях пилоту написать: **«При ошибке Safari попробуйте Chrome»**. В Волне 5 решить через custom domain.

### 9.3 Вопросы к обсуждению

**Нужна ли ротация пароля ClickHouse перед раздачей?**
Владелец отклонил — HTML v4 только на его маке, новый фронт не содержит пароля. **Принято: не ротировать сейчас.** При появлении 10+ франчайзи — вернуться к вопросу.

**Включать ли sign-in-with-Google как опцию для Gmail-пользователей?**
Пока нет. Magic-link универсальнее и проще. Можно добавить в Волне 6 если будет feedback.

**Публичный `/health` без auth — нормально?**
Да. Это стандартная практика. Нет чувствительных данных, только статус+timestamp.

---

## 10. Changelog

### 19.04.2026, день (15:00-15:30) — M4 в проде

**Что сделано за сессию (~1 час):**
- Проанализирован `chiko_dashboard_v4__19_.html` (2055 строк, 131 КБ)
- Найдено 7 строк в оригинале с hardcoded ClickHouse credentials (`CK_URL`/`CK_USER`/`CK_PASS`)
- Найдена единая точка `fetchCK()` через которую идут все 4 SQL-запроса
- Написан Python-скрипт для трансформации HTML: добавил login screen (CSS + HTML + JS для form submit + bootAuth IIFE)
- Весь HTML упакован в TypeScript template literal с экранированием `${` и `` ` `` (116 и 103 вхождений соответственно)
- `src/dashboard.ts` создан (~130 КБ, 2190 строк)
- `src/index.ts` обновлён: новый endpoint `GET /`, `/auth/callback` теперь делает 302 redirect с `login_token` параметром

**Коммит:** 12-й автодеплой (~35 сек).

**Тестирование:**
- ✅ Chrome на Mac (14:23): Благовещенск, 3.5 месяца данных, score 61/100 #22 из 43, все графики, AI-инсайты, рейтинг сети — **дашборд полностью функционирует**
- ✅ Safari Mac (14:58): login-screen появился, форма работает
- 🟠 Safari Mac (15:09-15:22): при POST на `/api/auth/request-link` — `Load failed`, но письмо приходит; при GET `/?login_token=` — "сервер неожиданно отключился". В Chrome тот же URL работает.
- ✅ Chrome на Windows: дашборд отрендерился, форма логина показалась (отличие: в localStorage нет JWT → login-screen)

**Обнаружены проблемы:**
1. Safari + workers.dev нестабильный на MacBook владельца (**см. [9.2](#92)**)
2. VPN усугубляет проблему, но не источник
3. Остаётся calendar bug из оригинала v4 (не критично)

**Решения:**
- Отложить фикс Safari до Волны 5 через custom domain
- Пилот — Chrome-first, Safari — "попробуйте Chrome если ошибка"
- Retry-логика в fetch — тоже Волна 5

### 19.04.2026, 13:00-15:00 — Волна 2.5 + M4 start

См. v3.12 полностью.

### 18.04.2026

Волна 2 (GitHub Actions, Cloudflare Logs, n8n healthcheck). См. v3.10.

### 17.04.2026

Волна 1 завершена. См. v3.5.

---

## 11. Контакты и доступы

- **Дашборд:** https://chicko-api-proxy.chicko-api.workers.dev/
- **API:** тот же URL + `/api/*`, `/auth/*`, `/health`
- **Observability:** Cloudflare → `chicko-api-proxy` → Observability
- **n8n webhook:** https://melnikov.app.n8n.cloud/webhook/clickhouse-proxy
- **Resend:** https://resend.com/domains
- **DNS:** https://www.reg.ru/ → `business-360.ru`
- **GitHub:** https://github.com/AlexMelnikov1976/chicko-api-proxy
- **GitHub Actions:** https://github.com/AlexMelnikov1976/chicko-api-proxy/actions

**Добавить нового пользователя:**
```bash
npx wrangler kv key put \
  --namespace-id=6f095f10194a45ec9cdcc98129fb2426 \
  "user:email@домен.ru" \
  '{"user_id":"user_NNN"}'
```

**Инструкция для пилотного франчайзи:**
1. Открыть в Chrome/Edge/Firefox: https://chicko-api-proxy.chicko-api.workers.dev/
2. Ввести свой email
3. Проверить почту (в т.ч. папку Спам при первой отправке)
4. Кликнуть «Войти в дашборд»
5. Если Safari показывает ошибку — использовать Chrome/Edge

---

## 12. Где что искать

- **Как задеплоить** → `git push origin main` (автоматически)
- **Как посмотреть логи Worker** → Cloudflare → Observability
- **Как добавить пользователя** → [раздел 11](#11-контакты-и-доступы)
- **Как работает auth** → [раздел 4](#4-архитектура)
- **Почему Safari глючит** → [9.2](#92-safari--workersdev-нестабильное-соединение)
- **Что делать следующим шагом** → [Волна 4 (M5)](#-волна-4-m5-пилот-с-франчайзи-следующий-шаг)

---

## 13. Как поддерживать документ

- После Волны/milestone — [8] + [10]
- После ротации — [6]
- После решения — [5]
- После разблокировки — [9] + [10]
- После бага — [9.X] (новый подраздел) + описание для [Волны 5](#-волна-5-стабилизация-и-безопасность)

**Коммит:** `docs(passport): [что изменил кратко]`

---

**Авторы:** Aleksey Melnikov + Claude
**Версии:** v3.3 → ... → v3.12 → **v3.13** (M4 в проде, 19.04.2026 день)
