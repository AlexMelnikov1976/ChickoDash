# Паспорт проекта: Chicko Analytics

> **Живой документ.** Обновляется после каждой значимой сессии работы.
> История изменений — в разделе [Changelog](#10-changelog) внизу.
> Если что-то здесь противоречит коду в репо — прав код, этот документ надо обновить.

**Последнее обновление:** 18.04.2026, ночь (23:00 MSK) — Волна 2 на 75%, observability добавлена
**Версия паспорта:** 3.10 (консолидирует v3.3–v3.9 + результаты 18.04 ночь)

---

## 1. Что это и зачем

**Chicko Analytics** — аналитическая платформа для франчайзи сети ресторанов Chicko. Показывает ключевые метрики (выручка, средний чек, foodcost, дисконт, доля доставки), сравнивает каждый ресторан с сетью и Top-10, строит динамику и выдаёт рекомендации.

**Пользователи:** владельцы франчайзи-ресторанов (видят свой ресторан), управляющая компания (видит всю сеть).

**Текущее поколение (v4):** статический HTML-дашборд с hardcoded подключением к ClickHouse.

**Целевое поколение:** тот же дашборд, но данные приходят через защищённый API с JWT + row-level security. **API работает end-to-end, мониторинг активен, структурированные логи пишутся.** Следующий шаг M4 — интеграция старого HTML-дашборда с API.

---

## 2. Моментальный снимок

| Поле | Значение |
|---|---|
| **Production API** | https://chicko-api-proxy.chicko-api.workers.dev 🟢 |
| **GitHub (private)** | github.com/AlexMelnikov1976/chicko-api-proxy |
| **Локально (Mac)** | `~/Developer/chicko-api-proxy` |
| **Общий прогресс** | ~60% от плана (Волна 1 ✅, Волна 2 на 75% ✅, API end-to-end работает, Dashboard 0%) |
| **Активный блокер** | Нет. `/api/query` работает end-to-end. |
| **Ближайший milestone** | M4: Frontend-дашборд v4 переведён на JWT API — ETA 20.04 |
| **Автодеплой** | ✅ GitHub Actions: 7 подряд зелёных деплоев за 18.04 |
| **n8n proxy** | ✅ Active, webhook `/webhook/clickhouse-proxy` |
| **Мониторинг (uptime)** | ✅ n8n healthcheck каждые 3 часа → Telegram алерт при падении/восстановлении |
| **Мониторинг (логи)** | ✅ Cloudflare Observability: все `console.log/error` + invocation logs, retention 3 дня |
| **Срочный долг** | 🔴 Ротация пароля `dashboard_ro` — засветился в shell history и в истории чата с Claude |
| **Косметический баг** | `[query] user=undefined` в логах — неверное имя поля JWT payload в `src/index.ts`, фикс 2 мин |
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
| Observability (логи Worker'а) | Cloudflare Workers Logs | dash → Worker → Observability | Встроенный UI |
| Локальная разработка | MacBook Air (macOS, zsh) | `~/Developer/chicko-api-proxy` | Терминал |
| Старый дашборд (v4) | Один HTML файл | `chiko_dashboard_v4__19_.html` | Раздаётся вручную |

**Рабочее окружение:** Node v25.9.0, npm 11.12.1, Git 2.39.5 (Apple Git), wrangler 3.114 (update available: 4.x — не критично).

---

## 4. Архитектура

```
┌──────────────────┐
│  Frontend        │    (пока — HTML файл v4, будущее — Cloudflare Pages)
│  Dashboard       │
└────────┬─────────┘
         │  HTTPS + JWT Bearer token
         ▼
┌──────────────────────────┐
│  Cloudflare Workers      │◄─── GitHub Actions (auto-deploy on push)
│  chicko-api-proxy        │◄─── n8n Healthcheck (GET /health, 3h cron)
│    • JWT validate        │───► Cloudflare Observability (console.log/error)
│    • Row-level security  │
│    • Structured logging  │
└────────┬─────────────────┘
         │  POST /webhook/clickhouse-proxy
         │  ?user=X&password=Y&database=chicko&query=SQL
         ▼
┌──────────────────────────┐
│  n8n Workflow            │  ✅ ACTIVE
│  ClickHouse Proxy        │
│  allowUnauthorizedCerts  │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│  Yandex Managed          │
│  ClickHouse (chicko DB)  │
└──────────────────────────┘

Telegram alerts ◄──── n8n Healthcheck (UP↔DOWN transitions)
```

**Проверено работающим 18.04.2026:** curl → Workers → n8n → ClickHouse → ответ `SELECT 1` за ~1.1мс (ClickHouse) / ~30мс total round-trip.

**Healthcheck + Observability активны:** healthcheck каждые 3 часа, Observability пишет все request/response + мои структурированные логи с префиксами `[request]`, `[login]`, `[query]`.

---

## 5. Архитектурные решения (почему именно так)

### 5.1 Почему n8n proxy, а не прямое подключение Workers → ClickHouse?

**Пробовали. Не работает:**
- HTTPS порт 8443 → SSL error 526 (Yandex самоподписанный сертификат, Cloudflare не доверяет)
- HTTP порт 8123 → Connection timeout 522 (ACL закрыт для внешних)

**n8n решает:**
- Имеет рабочее подключение к этому ClickHouse (`allowUnauthorizedCerts: true`)
- Cloudflare Workers свободно общается с любым HTTPS-эндпоинтом n8n

**Плата:** +50-100мс latency. Проверено 18.04: реальное round-trip ~30мс, приемлемо.

### 5.2 Почему Cloudflare Workers?

- Бесплатный тир (100k req/day)
- Глобальный edge → ~20мс до API
- Zero-downtime secret updates
- Встроенная Observability (см. 5.10)

### 5.3 Почему JWT 24h?

- Workers stateless
- 24h — удобно для BI-задачи
- Ротация `JWT_SECRET` разом разлогинивает всех

### 5.4 Почему row-level security регексом?

- Контроль внутри API-слоя
- `tenant_id` из JWT, не из body → нельзя обойти RLS

### 5.5 Почему документация в git (паспорт), а не в Notion?

- В git — технические детали. В Notion — оперативные задачи и трекинг.

### 5.6 Почему GitHub Actions (18.04.2026)

- Устраняет "забыл задеплоить"
- Аудит-лог
- Воспроизводимость
- Нулевой риск для prod

### 5.7 Почему credentials в URL query params (долг)

- ClickHouse HTTP API поддерживает query params из коробки
- **Проблема:** пароль в логах n8n
- **План:** после ротации — рефакторинг на body/headers

### 5.8 Почему healthcheck 3 часа, а не 5 минут (18.04.2026, долг на UptimeRobot)

- n8n Cloud имеет лимит executions (2500/мес на Starter)
- Healthcheck каждые 5 мин = 8640/мес, сожрал бы лимит за 9 дней
- **Правильный долгосрочный инструмент:** UptimeRobot (бесплатный dedicated-сервис). Мигрируем когда появятся реальные пользователи.

### 5.9 Почему healthcheck проверяет только HTTP status code (18.04.2026)

- Первая версия проверяла body.status — ловили ложные алерты на Cloudflare 404 HTML
- Упрощено до `statusCode >= 200 && < 300`. Для `/health` достаточно.
- Принцип: **меньше зависимостей — меньше багов**

### 5.10 Почему Cloudflare Workers Logs, а не Sentry (18.04.2026)

- **Попытка зайти в Sentry:** 403 Forbidden на signup-page со всех браузеров, с VPN и без. Сам сайт у них "All Systems Operational" — это не технический сбой, а гео-блокировка на уровне браузерного fingerprint (VPN не помогает).
- **Cloudflare Workers Logs** — встроенная альтернатива. Пишет `console.log/error` + invocation logs каждого request'а. UI в Cloudflare → Worker → Observability.
- **Плата:** нет такого UX как Sentry (группировка issues, release tracking, alert rules). Retention 3 дня на бесплатном тире.
- **Плюсы:** ноль настройки, ноль зависимостей, никакой гео-блокировки.
- **Дальнейший путь:** если Sentry когда-то станет доступен — можно добавить его поверх, `console.error` всё равно попадут и туда и сюда.

### 5.11 wrangler.toml как IaC для observability (18.04.2026)

- Включить Logs можно через UI Cloudflare, но **при следующем `wrangler deploy` настройка UI может перезаписаться тем, что в `wrangler.toml`**
- Поэтому блок `[observability]` + `[observability.logs]` добавлен в `wrangler.toml` — теперь каждый деплой подтверждает включённость
- Принцип: **всё, что влияет на работу системы, должно быть в git**

### 5.12 Structured logging с префиксами (18.04.2026)

- Формат: `[request] POST /api/query`, `[query] user=... tenant=... sql_length=...`, `[login] error: ... stack: ...`
- **Что логируется:** метод, путь, email пользователя, ID tenant'а, длина SQL, время выполнения, код ответа, stack trace при ошибке
- **Что НЕ логируется:** пароли, JWT-токены, содержимое SQL (может содержать PII), данные из ClickHouse
- Единые префиксы в квадратных скобках позволяют фильтровать в Observability UI по категориям

---

## 6. Credentials — журнал ротаций

**Это самый важный раздел для безопасности.** Каждая смена пароля/ключа — отдельная запись.

| Дата | Что | Действие | Причина | Кто сделал |
|---|---|---|---|---|
| 18.04.2026 вечер | `CLICKHOUSE_HOST` (Cloudflare secret) | Обновлён: `rc1d-...:8443` → `https://melnikov.app.n8n.cloud/webhook/clickhouse-proxy` | Переключение на n8n-прокси | Aleksey |
| 18.04.2026 | Cloudflare API Token (для CI) | Создан (scope: Edit Cloudflare Workers) | GitHub Actions. Сохранён как `CLOUDFLARE_API_TOKEN` | Aleksey |
| 🔴 TBD URGENT | ClickHouse `dashboard_ro` пароль | **Ротация обязательна** | Старый пароль `chiko_dash_2026` засветился в: (1) старом HTML-дашборде v4, (2) shell history MacBook, (3) истории чата с Claude, (4) n8n execution history | Ожидает (утро 19.04) |
| 🟠 TBD | iiko passwords (`1234567890`, `79062181048`) | Ротация рекомендуется | Засветились при первом (ошибочном) экспорте n8n workspace 18.04. Плюс оба слабые. | Ожидает |
| 17.04.2026 | Локальный `.dev.vars` | Очищен от старого пароля | Подготовка к ротации | Aleksey |
| TBD | `JWT_SECRET` (production) | Ротация при переходе к real users | Dev-level, для MVP | Ожидает |

### Где живут credentials

| Значение | Где лежит | Кто видит |
|---|---|---|
| `CLICKHOUSE_PASSWORD` production | Cloudflare Workers secrets | Только `wrangler secret` |
| `CLICKHOUSE_PASSWORD` локально | `~/Developer/chicko-api-proxy/.dev.vars` | Только на MacBook (gitignored) |
| `CLICKHOUSE_HOST` production | Cloudflare Workers secrets (webhook URL n8n) | Только `wrangler secret` |
| `JWT_SECRET` production | Cloudflare Workers secrets | Только `wrangler secret` |
| `CLOUDFLARE_API_TOKEN` (для CI) | GitHub Secrets | Только GitHub Actions |
| Telegram bot credential `Chicko` (n8n) | n8n Credentials vault | Только через n8n UI |
| ClickHouse `dashboard_ro` credentials | Yandex Cloud + менеджер паролей | Только Aleksey |
| SSH-ключ к GitHub | `~/.ssh/id_ed25519` на MacBook | Только Aleksey |

**Правила:**
- Никогда не коммитить в git
- При смене — **сначала** менеджер паролей, **потом** Cloudflare secrets, **потом** n8n, **потом** `.dev.vars`
- Не пересылать пароли в текстовых каналах. Если попали — ротировать следующим же действием.

---

## 7. Структура проекта

```
~/Developer/chicko-api-proxy/
├── src/
│   ├── index.ts              # Main worker: routing + CORS + structured logging
│   ├── auth.ts               # JWT generation / validation
│   └── clickhouse.ts         # ClickHouse client + row-level security
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
└── wrangler.toml             # ✅ включает [observability] блок (IaC)
```

**Что не в git:** `node_modules/`, `.wrangler/`, `.dev.vars`, `dist/`.

---

## 8. План развития — Волны инфраструктуры

**Синхронизация с экосистемой n8n:**
- USER_CONTEXT в Weekly Advisor расширен блоком про Chicko
- Запись в базе Проектов Notion обновлена
- Скилл chiko-franchise-dashboard обновлён до v1.1



### ✅ Волна 1: Критическая инфраструктура (завершена 17.04.2026)

Все пункты закрыты в одну сессию. Детали в changelog.

### 🟠 Волна 2: Автоматизация deploy и мониторинга (75% готово)

| Шаг | Время | Статус |
|---|---|---|
| GitHub Actions workflow (автодеплой) | ~40 мин | ✅ **18.04.2026** |
| Cloudflare API Token → GitHub Secrets | ~10 мин | ✅ **18.04.2026** |
| Активация n8n proxy (M3 закрыт) | ~60 мин | ✅ **18.04.2026** |
| Обновление `CLICKHOUSE_HOST` secret | ~5 мин | ✅ **18.04.2026** |
| Экспорт n8n ClickHouse Proxy в `infra/n8n/` | ~10 мин | ✅ **18.04.2026** |
| n8n healthcheck workflow + Telegram | ~40 мин | ✅ **18.04.2026** |
| Экспорт n8n Healthcheck в `infra/n8n/` | ~5 мин | ✅ **18.04.2026** |
| Cloudflare Workers Logs + structured logging | ~30 мин | ✅ **18.04.2026** |
| wrangler.toml с `[observability]` блоком (IaC) | (часть выше) | ✅ **18.04.2026** |
| 🔴 **Ротация пароля ClickHouse** | ~20 мин | ⏳ NEXT (утро 19.04) |
| Фикс `user=undefined` в логах (читаем auth.ts, корректируем field name) | ~5 мин | ⏳ |
| Рефакторинг clickhouse.ts: credentials в body (см. 5.7) | ~30 мин | ⏸ (после ротации) |

### 🟡 Волна 3: Трекинг и процесс

| Шаг | Цель |
|---|---|
| Notion database "Chicko Tasks" | Единый source of truth для задач |
| Миграция задач в Notion | One-time |
| `docs/archive/` для 4 старых MD-файлов | Очистка корня |
| n8n workflow: GitHub webhook → Notion update | Автообновление статусов |
| Google Calendar events с milestones M4-M6 | Дедлайны в календаре |

### 🟢 Волна 4: Автоматизация бизнес-процесса

| Шаг | Цель |
|---|---|
| Cloudflare Pages для HTML-дашборда | URL вместо раздачи HTML |
| n8n daily-rebuild: Sheets → skill → Pages → Telegram | Дашборд обновляется сам |
| n8n metrics-alerts | Проактивный мониторинг метрик |
| Cloudflare Workers Cron Trigger: warm-cache в KV | Dashboard за 50мс |
| AI-инсайты (рекомендация #2 Advisor 18.04) | Умные комментарии к метрикам |

### ⚪ Волна 5: Полировка

- Rate limiting через Workers KV (100 req/hour/user)
- Unit + integration tests
- CORS whitelist вместо `*`
- Dashboard usage analytics
- Обновление wrangler 3.114 → 4.x
- **Миграция healthcheck с n8n на UptimeRobot** (см. 5.8) — когда появятся реальные пользователи
- Перевод iiko-потоков n8n с `passPlain` на Credentials

---

## 9. Открытые вопросы и блокеры

**Активные:**

1. 🔴 **URGENT: Ротация пароля ClickHouse `dashboard_ro`** — скомпрометирован. Делается утром 19.04.
2. 🟠 **Ротация iiko passwords** — слабые и засветились.
3. 🟡 **`user=undefined` в логах** — косметический баг, `payload.user_id` не то поле (смотреть `src/auth.ts`). 5 минут на утро.
4. ~~**Нет мониторинга**~~ — ✅ Закрыто (healthcheck + Workers Logs)
5. ~~**n8n proxy не активирован**~~ — ✅ Закрыто
6. ~~**Нет автодеплоя**~~ — ✅ Закрыто

**Вопросы на решение:**

- **M4 когда?** Все предпосылки готовы. ETA: 20.04 воскресенье.
- **Rate limit** — перенесено в Волну 5.
- **Multi-tenant** — код готов, клиентов пока не подключаем.

---

## 10. Changelog (что реально сделано, по датам)

### 18.04.2026, ночь (23:00 MSK, ~40 мин работы)

**Волна 2, шаг 4 — Cloudflare Workers Observability.**

- Попытка настроить Sentry провалилась: `sentry.io/signup/` возвращает 403 Forbidden со всех браузеров, VPN/без-VPN, mac/Windows. status.sentry.io показывает "All Systems Operational" — это не сбой, это гео-блокировка через браузерный fingerprint (VPN не помогает). Решено не тратить время.
- Переключились на Cloudflare Workers Logs — встроенный UI, без регистраций
- В Cloudflare Dashboard включили **Observability → Logs** (Enabled, sampling 100%)
- В `wrangler.toml` добавлен блок `[observability]` + `[observability.logs]` — теперь настройки Logs описаны как IaC, при каждом деплое подтверждаются
- В `src/index.ts` добавлено structured logging: `[request]`, `[login]`, `[query]` префиксы. `console.error` со stack trace в catch. Sensitive data (пароли, JWT, SQL) НЕ логируется.
- `ENVIRONMENT = "development"` → `"production"` в wrangler.toml (давно надо было)
- Протестировано: 3 curl'а на /health, /api/auth/login, /api/query → в Observability UI увидели все 10 строк логов с правильной группировкой по timestamp

**Что это разблокирует:**
- При падении Worker'а — stack trace сразу виден в Cloudflare UI, без внешних сервисов
- Видно kто когда что делал: `[login] attempt for email=...`, `[query] user=... sql_length=...`
- Теперь можно дебажить prod не только по «упало/живо», но и по «что именно пошло не так»

**Маленький баг замечен и записан как долг:** `[query] user=undefined tenant=undefined` — моё имя поля `payload.user_id` не совпадает с полем в `auth.ts`. Функционал не сломан (JWT валиден, RLS применяется), только лог пишется с `undefined`. Фикс — 5 минут утром.

### 18.04.2026, поздний вечер (~1ч работы)

**Волна 2, шаг 3 — n8n healthcheck workflow активен.**

- Создан workflow `Chicko API Healthcheck` в n8n: Schedule (каждые 3 часа) → HTTP GET `/health` → Evaluate state → IF notify? → Telegram
- Первая версия использовала `body.status === 'ok'` — оказалось багом при неожиданном формате ответа (Cloudflare 404 HTML). Упрощено до `statusCode >= 200 && < 300`
- State tracking через `$getWorkflowStaticData` — алерт только при переходе UP↔DOWN
- Протестировано: временно сломал URL → прилетел 🔴 DOWN алерт. Вернул URL — логика молчит
- Интервал 3 часа (не 5 мин) — экономим лимит n8n executions. Долг на миграцию в UptimeRobot зафиксирован (5.8)
- Алерты в тот же Telegram-чат Chicko, credentials `Chicko` переиспользованы
- **Экспорт workflow в `infra/n8n/healthcheck.json` + commit** — IaC для обоих workflow в git

### 18.04.2026, поздний вечер (~1.5ч работы)

**Волна 2, шаг 2 — n8n proxy для ClickHouse активирован. M3 закрыт.**

- Написан workflow `Chicko API: ClickHouse Proxy` с нуля (старого JSON не было). Три ноды: Webhook → HTTP Request → Respond to Webhook
- Импортирован, сохранён, активирован
- Обнаружен и удалён старый конфликтующий workflow
- Тест прокси (curl с `SELECT 1`) прошёл: ClickHouse вернул корректный JSON за 3мс
- `CLICKHOUSE_HOST` в Cloudflare обновлён на webhook URL n8n. Zero-downtime
- **End-to-end тест** через production API прошёл успешно. Первый в жизни проекта успешный полный раунд-трип `/api/query` (~30мс)
- Workflow JSON экспортирован в `infra/n8n/clickhouse_proxy.json`

**Технические долги зафиксированы:**
- Пароль в URL query string → в логах n8n. Решение (5.7): рефакторинг после ротации
- iiko-потоки хранят `passPlain` в Set-нодах. Решение: Волна 5

### 18.04.2026, вечер (~40 мин работы)

**Волна 2, шаг 1 — GitHub Actions автодеплой:**
- Cloudflare API Token создан (bounded scope)
- Токен в GitHub Secrets как `CLOUDFLARE_API_TOKEN`
- `.github/workflows/deploy.yml`: checkout → setup-node → npm ci → wrangler-action
- Первый push за 24 секунды. Петля «git push → prod» замкнута

**Параллельно в экосистеме:**
- Weekly Advisor → 4 рекомендации, разобраны
- Cowork ночью перекладывал Downloads → _archive
- Паспорт v3.6 с контекстом экосистемы n8n

### 17.04.2026, вечер (~2ч работы)

**Волна 1 инфраструктуры завершена:**
- Проект перенесён с `C:\Users\User\chicko-api-proxy` (Windows/Google Drive) → `~/Developer/chicko-api-proxy` (MacBook Air)
- git init + `.gitignore` + git identity
- SSH-ключ ed25519, приватный GitHub repo
- Консолидация 4 старых MD-файлов в `README.md` + `docs/PASSPORT.md`
- `.dev.vars` очищен от старого пароля

### 17.04.2026, утро

- Backend API на Workers deployed (`/health`, `/api/auth/login`, `/api/query`)
- JWT (24h TTL), row-level security
- Mock-клиент для локальной разработки
- Выявлен блокер: прямое подключение Workers → ClickHouse не работает
- Принято решение: n8n как прокси

### 15-16.04.2026

- Анализ HTML-дашборда v4
- Архитектурный план (Workers + JWT + RLS + n8n)
- Первая версия Gantt
- Режим обучения в памяти Claude

---

## 11. Контакты и доступы

- **Production API:** https://chicko-api-proxy.chicko-api.workers.dev
- **Production query endpoint:** `POST /api/query` (JWT required)
- **Observability:** Cloudflare Dashboard → `chicko-api-proxy` → Observability → Events
- **n8n webhook (внутренний):** https://melnikov.app.n8n.cloud/webhook/clickhouse-proxy
- **Cloudflare Dashboard:** https://dash.cloudflare.com
- **GitHub Actions:** https://github.com/AlexMelnikov1976/chicko-api-proxy/actions
- **n8n:** https://melnikov.app.n8n.cloud/
- **ClickHouse (Yandex Cloud Console):** https://console.cloud.yandex.ru/
- **GitHub:** https://github.com/AlexMelnikov1976/chicko-api-proxy

**Тестовые credentials (только для dev):**
- Email: `admin@chicko.ru`
- Password: `demo123`
- Tenant: `tenant_chicko`

**Тестовый end-to-end запрос (для проверки после деплоев):**
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

---

## 12. Где что искать

- **Как задеплоить код** → `git push origin main` (автоматически)
- **Как работает API** → [README.md](../README.md#api-reference)
- **Как посмотреть логи** → Cloudflare → `chicko-api-proxy` → Observability → Events
- **Архитектура и почему так** → раздел [5](#5-архитектурные-решения-почему-именно-так)
- **Журнал паролей** → раздел [6](#6-credentials--журнал-ротаций)
- **Что делать дальше** → раздел [8](#8-план-развития--волны-инфраструктуры)
- **Как проверить что всё работает** → раздел [11](#11-контакты-и-доступы), тестовый запрос

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
- Не плодить новые markdown-файлы — расширять паспорт

**Коммит-сообщение:**
```
docs(passport): [что изменил кратко]
```

---

**Авторы:** Aleksey Melnikov + Claude
**Версии паспорта:** v3.3 → v3.4 → v3.5 → v3.6 → v3.7 → v3.8 → v3.9 → **v3.10** (текущая, фиксирует Cloudflare Observability + structured logging, 18.04.2026 ночь)
