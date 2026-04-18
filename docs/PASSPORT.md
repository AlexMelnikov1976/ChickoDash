# Паспорт проекта: Chicko Analytics

> **Живой документ.** Обновляется после каждой значимой сессии работы.
> История изменений — в разделе [Changelog](#10-changelog) внизу.
> Если что-то здесь противоречит коду в репо — прав код, этот документ надо обновить.

**Последнее обновление:** 18.04.2026, ночь — healthcheck активен, Волна 2 на 65%
**Версия паспорта:** 3.9 (консолидирует v3.3–v3.8 + результаты 18.04 ночь)

---

## 1. Что это и зачем

**Chicko Analytics** — аналитическая платформа для франчайзи сети ресторанов Chicko. Показывает ключевые метрики (выручка, средний чек, foodcost, дисконт, доля доставки), сравнивает каждый ресторан с сетью и Top-10, строит динамику и выдаёт рекомендации.

**Пользователи:** владельцы франчайзи-ресторанов (видят свой ресторан), управляющая компания (видит всю сеть).

**Текущее поколение (v4):** статический HTML-дашборд с hardcoded подключением к ClickHouse. Работает, но не масштабируется.

**Целевое поколение:** тот же дашборд, но данные приходят через защищённый API с JWT + row-level security. **API работает end-to-end, мониторинг активен.** Следующий шаг M4 — интеграция старого HTML-дашборда с API.

---

## 2. Моментальный снимок

| Поле | Значение |
|---|---|
| **Production API** | https://chicko-api-proxy.chicko-api.workers.dev 🟢 |
| **GitHub (private)** | github.com/AlexMelnikov1976/chicko-api-proxy |
| **Локально (Mac)** | `~/Developer/chicko-api-proxy` |
| **Общий прогресс** | ~55% от плана (Волна 1 ✅, Волна 2 на 65% ✅, API end-to-end работает, Dashboard 0%) |
| **Активный блокер** | Нет. `/api/query` работает end-to-end (Workers → n8n → ClickHouse). |
| **Ближайший milestone** | M4: Frontend-дашборд v4 переведён на JWT API — ETA 20.04 |
| **Автодеплой** | ✅ GitHub Actions: push в main → wrangler deploy (~24 сек) |
| **n8n proxy** | ✅ Active, webhook `/webhook/clickhouse-proxy`, тест end-to-end прошёл |
| **Мониторинг** | ✅ Healthcheck каждые 3 часа → Telegram алерт при падении/восстановлении |
| **Срочный долг** | 🔴 Ротация пароля `dashboard_ro` — засветился в shell history и в истории чата с Claude |
| **Ответственный** | Aleksey Melnikov |

---

## 3. Инфраструктура (где что физически живёт)

| Компонент | Платформа | URL / Путь | Как доступаюсь |
|---|---|---|---|
| Исходный код | GitHub (private) | `github.com/AlexMelnikov1976/chicko-api-proxy` | SSH key на MacBook |
| Backend API | Cloudflare Workers | `chicko-api-proxy.chicko-api.workers.dev` | `wrangler login` |
| База данных | Yandex Managed ClickHouse | `rc1d-3r30isjr73k4uue8.mdb.yandexcloud.net:8443` | Только через n8n proxy (прямое из Workers не работает) |
| Proxy / оркестратор | n8n self-hosted | `melnikov.app.n8n.cloud` | Web UI |
| n8n workflow: ClickHouse Proxy | n8n | `/webhook/clickhouse-proxy` | Active с 18.04.2026 |
| n8n workflow: Healthcheck | n8n | cron каждые 3 часа | Active с 18.04.2026 |
| CI/CD | GitHub Actions | `.github/workflows/deploy.yml` | Auto на push в main |
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
│    • JWT validate        │
│    • Row-level security  │
└────────┬─────────────────┘
         │  POST /webhook/clickhouse-proxy
         │  ?user=X&password=Y&database=chicko&query=SQL
         ▼
┌──────────────────────────┐
│  n8n Workflow            │  ✅ ACTIVE
│  ClickHouse Proxy        │  Webhook → HTTP Request → Respond
│  allowUnauthorizedCerts  │
└────────┬─────────────────┘
         │  HTTPS
         ▼
┌──────────────────────────┐
│  Yandex Managed          │
│  ClickHouse (chicko DB)  │
└──────────────────────────┘

Telegram alerts ◄──── n8n Healthcheck (UP↔DOWN transitions only)
```

**Проверено работающим end-to-end 18.04.2026:** curl → Workers → n8n → ClickHouse → ответ `SELECT 1` за ~30мс round-trip.

**Healthcheck протестирован 18.04.2026:** сломал URL → пришёл 🔴 DOWN, вернул URL → при следующем прогоне логика правильно промолчала (state cleared после reimport).

---

## 5. Архитектурные решения (почему именно так)

### 5.1 Почему n8n proxy, а не прямое подключение Workers → ClickHouse?

**Пробовали. Не работает:**
- HTTPS порт 8443 → SSL error 526 (Yandex использует самоподписанный сертификат, Cloudflare не доверяет)
- HTTP порт 8123 → Connection timeout 522 (ACL закрыт для внешних)

**n8n решает обе проблемы:**
- n8n уже имеет рабочее подключение к этому ClickHouse (`allowUnauthorizedCerts: true`)
- Cloudflare Workers свободно общается с любым HTTPS-эндпоинтом n8n

**Плата:** +50-100мс latency. **Проверено 18.04:** реальное round-trip ~30мс, приемлемо.

### 5.2 Почему Cloudflare Workers, а не обычный Node.js backend?

- Бесплатный тир покрывает наши нужды (100k req/day)
- Глобальный edge → ~20мс до API из любой точки
- Нет infrastructure-as-a-service-headache
- Zero-downtime secret updates

### 5.3 Почему JWT 24h, а не sessions в БД?

- Workers stateless, session store потребовал бы KV или внешний Redis
- 24h — компромисс для аналитической BI-задачи
- Ротация `JWT_SECRET` разом разлогинивает всех → есть kill switch

### 5.4 Почему row-level security регексом, а не view в ClickHouse?

- Регекс даёт контроль внутри API-слоя
- `tenant_id` всегда берётся из JWT, не из body → нельзя обойти RLS

### 5.5 Почему документация в git (этот паспорт), а не в Notion?

- В git — технические детали. В Notion — оперативные задачи и трекинг.
- Ошибка прошлой версии: 4 MD-файла повторяли друг друга на 70%. Консолидированы в `README.md` + `PASSPORT.md`.

### 5.6 Почему GitHub Actions, а не `wrangler deploy` руками (18.04.2026)

- Устраняет риск "забыл задеплоить после коммита"
- Аудит-лог: кто/когда деплоил
- Воспроизводимость: чистая Ubuntu + `npm ci`
- Нулевой риск для prod: упавший workflow не трогает prod

### 5.7 Почему credentials в URL query params, а не body/headers (долг)

- **Исторически:** ClickHouse HTTP API поддерживает query params из коробки
- **Проблема:** пароль попадает в логи n8n
- **План:** после ротации пароля — рефакторинг `src/clickhouse.ts` на body/headers

### 5.8 Почему healthcheck через n8n, а не UptimeRobot (18.04.2026, долг)

- **Сейчас:** n8n делает GET `/health` каждые 3 часа (8 запусков/день = 240/месяц — комфортно для любого тарифа)
- **Плата:** о падении узнаешь в среднем через 1.5 часа (в худшем случае — 3 часа)
- **Почему не 5 минут:** n8n Cloud Starter лимит 2500 executions/мес. Healthcheck каждые 5 минут = 8640/мес, сожрал бы весь лимит за 9 дней
- **Правильный долгосрочный инструмент:** UptimeRobot (бесплатный dedicated-сервис для healthcheck'ов, проверка каждые 5 минут, алерты в Telegram). Мигрируем когда проект будет иметь реальных пользователей и 1.5 часа downtime станет неприемлемо.
- **Урок:** workflow-движки не оптимизированы под частые простые запросы. n8n — для оркестрации, UptimeRobot — для uptime. Используй правильный инструмент.

### 5.9 Почему healthcheck проверяет только HTTP status code, а не body (18.04.2026)

- Первая версия проверяла `statusCode === 200 && body.status === 'ok'`
- Ловили ложные алерты: при неожиданном формате ответа (HTML-страница 404) body не парсился как JSON, `isHealthy` становился false
- Упрощено до `statusCode >= 200 && statusCode < 300`. Для `/health` достаточно.
- Принцип: **меньше зависимостей — меньше багов**

---

## 6. Credentials — журнал ротаций

**Это самый важный раздел для безопасности.** Каждая смена пароля/ключа — отдельная запись.

| Дата | Что | Действие | Причина | Кто сделал |
|---|---|---|---|---|
| 18.04.2026 вечер | `CLICKHOUSE_HOST` (Cloudflare secret) | Обновлён: `rc1d-...:8443` → `https://melnikov.app.n8n.cloud/webhook/clickhouse-proxy` | Переключение с прямого адреса ClickHouse на n8n-прокси | Aleksey |
| 18.04.2026 | Cloudflare API Token (для CI) | Создан новый токен (scope: Edit Cloudflare Workers) | Нужен для GitHub Actions. Сохранён в GitHub Secrets как `CLOUDFLARE_API_TOKEN` | Aleksey |
| 🔴 TBD URGENT | ClickHouse `dashboard_ro` пароль | **Ротация обязательна** | Старый пароль `chiko_dash_2026` засветился в: (1) старом HTML-дашборде v4, (2) shell history MacBook, (3) истории чата с Claude, (4) в логах n8n execution history. | Ожидает (утро 19.04) |
| 🟠 TBD | iiko passwords (`1234567890`, `79062181048`) | Ротация рекомендуется | Засветились при экспорте полного n8n workspace 18.04. Плюс оба слабые. | Ожидает |
| 17.04.2026 | Локальный `.dev.vars` | Удалён старый пароль, placeholder | Подготовка к ротации | Aleksey |
| TBD | `JWT_SECRET` (production) | Ротация при переходе к real users | Текущий — dev-level | Ожидает |

### Где живут credentials

| Значение | Где лежит | Кто видит |
|---|---|---|
| `CLICKHOUSE_PASSWORD` production | Cloudflare Workers secrets | Только `wrangler secret` |
| `CLICKHOUSE_PASSWORD` локально | `~/Developer/chicko-api-proxy/.dev.vars` | Только на MacBook (в `.gitignore`) |
| `CLICKHOUSE_HOST` production | Cloudflare Workers secrets (webhook URL n8n) | Только `wrangler secret` |
| `JWT_SECRET` production | Cloudflare Workers secrets | Только `wrangler secret` |
| `CLOUDFLARE_API_TOKEN` (для CI) | GitHub Secrets | Только GitHub Actions |
| Telegram bot credential `Chicko` (n8n) | n8n Credentials vault | Только через n8n UI |
| ClickHouse `dashboard_ro` credentials | Yandex Cloud + менеджер паролей Aleksey | Только Aleksey |
| SSH-ключ к GitHub | `~/.ssh/id_ed25519` на MacBook | Только Aleksey |

**Правила:**
- Никогда не коммитить в git
- При смене — **сначала** менеджер паролей, **потом** Cloudflare secrets, **потом** n8n, **потом** `.dev.vars`
- После каждой ротации — запись в таблицу выше
- **Не пересылать пароли в текстовых каналах** (чат с LLM, Slack, email). Если попали — ротировать следующим же действием.

---

## 7. Структура проекта

```
~/Developer/chicko-api-proxy/
├── src/
│   ├── index.ts          # Main worker: routing + CORS
│   ├── auth.ts           # JWT generation / validation
│   └── clickhouse.ts     # ClickHouse client + row-level security
├── infra/
│   └── n8n/
│       └── clickhouse_proxy.json   # ✅ n8n workflow (в git с 18.04.2026)
├── docs/
│   ├── PASSPORT.md       # Этот файл
│   └── archive/          # Старые MD-файлы
├── .github/
│   └── workflows/
│       └── deploy.yml    # ✅ GitHub Actions автодеплой (с 18.04.2026)
├── .gitignore
├── .dev.vars             # Gitignored. Локальные секреты
├── README.md             # Краткий техдок + API reference
├── package.json
├── package-lock.json
├── tsconfig.json
└── wrangler.toml
```

**Что не в git:** `node_modules/`, `.wrangler/`, `.dev.vars`, `dist/`.

**TODO:** экспортировать Healthcheck workflow в `infra/n8n/healthcheck.json` следующей сессией.

---

## 8. План развития — Волны инфраструктуры

**Синхронизация с экосистемой n8n:**
- USER_CONTEXT в Weekly Advisor расширен блоком про стек Chicko Analytics
- Запись в базе Проектов Notion обновлена
- Скилл chiko-franchise-dashboard обновлён до v1.1



### ✅ Волна 1: Критическая инфраструктура (завершена 17.04.2026 вечером)

| Шаг | Статус |
|---|---|
| Проект перенесён с Google Drive → `~/Developer/chicko-api-proxy` | ✅ |
| `git init` + `.gitignore` + первый коммит | ✅ |
| GitHub private repo + SSH key | ✅ |
| Git identity настроена | ✅ |
| 4 старых MD-файла консолидированы в README.md + паспорт | ✅ |
| n8n workflow JSON в `infra/n8n/` | ✅ (18.04.2026) |
| `docs/archive/` с историей старой документации | ⏳ |

### 🟠 Волна 2: Автоматизация deploy и мониторинга (65% готово)

| Шаг | Время | Экономия | Статус |
|---|---|---|---|
| GitHub Actions workflow `.github/workflows/deploy.yml` | ~40 мин | 3-5 мин × каждый deploy | ✅ **18.04.2026** |
| Cloudflare API Token → GitHub Secrets | ~10 мин | Часть выше | ✅ **18.04.2026** |
| **Активация n8n proxy** — workflow собран с нуля, импортирован, активирован | ~60 мин | Разблокировка `/api/query` (M3) | ✅ **18.04.2026** |
| **Обновление `CLICKHOUSE_HOST` secret** на webhook URL n8n | ~5 мин | Часть выше | ✅ **18.04.2026** |
| Экспорт n8n ClickHouse Proxy в `infra/n8n/` + git commit | ~10 мин | Versioning инфры | ✅ **18.04.2026** |
| **n8n healthcheck workflow** (3h cron → Telegram при падении/восстановлении) | ~40 мин | Узнаёшь о падении до того как клиент позвонит | ✅ **18.04.2026** |
| 🔴 **Ротация пароля ClickHouse** — URGENT после компрометации | ~20 мин | Закрытие security-риска | ⏳ NEXT (утро 19.04) |
| Экспорт n8n Healthcheck в `infra/n8n/healthcheck.json` + commit | ~5 мин | Versioning | ⏳ |
| Sentry в Workers (DSN в secret + `init()` в `index.ts`) | ~20 мин | Stack-trace любой 500-ки в prod | ⏸ |
| Рефакторинг clickhouse.ts: credentials в body, не в URL (см. 5.7) | ~30 мин | Password больше не в логах | ⏸ (после ротации) |

### 🟡 Волна 3: Трекинг и процесс (план: 1 день)

| Шаг | Цель |
|---|---|
| Notion database "Chicko Tasks" | Единый source of truth для задач |
| Миграция задач в Notion | One-time |
| `docs/archive/` для 4 старых MD-файлов | Очистка корня |
| n8n workflow: GitHub webhook → Notion update | Автообновление статусов |
| Google Calendar events с milestones M4-M6 | Дедлайны в календаре |

### 🟢 Волна 4: Автоматизация бизнес-процесса (план: 2-3 дня)

| Шаг | Цель |
|---|---|
| Cloudflare Pages для HTML-дашборда + автодеплой из git | URL вместо раздачи HTML вручную |
| n8n daily-rebuild: Google Sheets → skill → Pages → Telegram | Дашборд обновляется сам каждое утро |
| n8n metrics-alerts | Проактивный мониторинг бизнес-метрик |
| Cloudflare Workers Cron Trigger: warm-cache benchmarks в KV | Dashboard загружается за 50мс |
| AI-инсайты в Chicko (рекомендация #2 Advisor 18.04) | Умные комментарии к метрикам |

### ⚪ Волна 5: Полировка

- Rate limiting через Workers KV (100 req/hour/user)
- Unit + integration tests (JWT + RLS-injection)
- CORS whitelist вместо `*` для production
- Dashboard usage analytics
- Обновление wrangler 3.114 → 4.x
- **Миграция healthcheck с n8n на UptimeRobot** (см. 5.8) — когда появятся реальные пользователи и 1.5 ч downtime станет неприемлемо
- Перевод iiko-потоков n8n с `passPlain` на Credentials (чтобы export был безопасным для git)

---

## 9. Открытые вопросы и блокеры

**Активные:**

1. 🔴 **URGENT: Ротация пароля ClickHouse `dashboard_ro`** — скомпрометирован. Делается утром 19.04.
2. 🟠 **Ротация iiko passwords** — слабые пароли, засветились. Делается по возможности в ближайшие дни.
3. ~~**n8n proxy не активирован**~~ — ✅ Закрыто 18.04.2026
4. ~~**Нет автодеплоя**~~ — ✅ Закрыто 18.04.2026
5. ~~**Нет мониторинга**~~ — ✅ Закрыто 18.04.2026 (healthcheck)
6. **Healthcheck не в git** — workflow живёт только в n8n cloud. Нужно экспортировать в `infra/n8n/healthcheck.json`. ETA: следующая сессия.

**Вопросы на решение:**

- **Стоит ли HTML-дашборд v4 трогать сейчас?** После закрытия M3 — да, это и есть M4. ETA: 20.04.
- **Rate limit — в MVP или позже?** Решение: перенести в Волну 5 (user base маленький).
- **Multi-tenant или пока один Chicko?** RLS уже написан с прицелом на множественные tenants. Добавлять по запросу.

---

## 10. Changelog (что реально сделано, по датам)

### 18.04.2026, ночь (~1ч работы)

**Волна 2, шаг 3 — n8n healthcheck workflow активен.**

- Создан workflow `Chicko API Healthcheck` в n8n: Schedule (каждые 3 часа) → HTTP GET `/health` → Evaluate state → IF notify? → Telegram
- Первая версия использовала проверку `statusCode === 200 && body.status === 'ok'` — оказалось багом: при неожиданном формате ответа body не парсился
- Упрощена до `statusCode >= 200 && statusCode < 300` — принцип "good enough > perfect"
- State tracking через `$getWorkflowStaticData` — отправляет алерт только при переходе UP↔DOWN, не на каждом прогоне
- Протестировано временной поломкой URL (`/health-broken-for-test`): 🔴 DOWN алерт пришёл корректно
- При исправлении URL и повторном прогоне логика молчит (state был reset при переимпорте workflow v2)
- Workflow активирован, следующий прогон автоматически через 3 часа
- Решение про интервал 3 часа (а не 5 минут) см. 5.8 — бережём лимит n8n executions, долг на миграцию в UptimeRobot зафиксирован
- Алерты летят в тот же Telegram-чат `-1003396450964`, что и остальные ChickoGroup-потоки, credentials `Chicko` переиспользованы

**Что это разблокирует:**
- О падении API узнаешь в Telegram в среднем через 1.5 часа, а не от звонка клиента
- Психологическая «свобода»: пока телефон молчит — система жива
- Появился канал алертов, в который можно складывать и другие события (завтра — алерты про ETL-ошибки, ошибки в Workers через Sentry и т.д.)

**Что в очереди (приоритеты):**
1. 🔴 Ротация пароля ClickHouse (утром 19.04)
2. Экспорт healthcheck workflow в `infra/n8n/healthcheck.json`
3. Sentry в Workers
4. M4: Frontend v4 → JWT API

### 18.04.2026, поздний вечер (~1.5ч работы)

**Волна 2, шаг 2 — n8n proxy для ClickHouse активирован. M3 закрыт.**

- Написан n8n workflow `ClickHouse Proxy for Chicko` с нуля (старого JSON не было). Три ноды: Webhook → HTTP Request → Respond to Webhook
- Импортирован в n8n, сохранён, активирован
- Обнаружен и удалён старый конфликтующий workflow с таким же webhook path
- Тест прокси напрямую (через curl с `SELECT 1`) прошёл: ClickHouse вернул корректный JSON за 3мс
- Обновлён Cloudflare secret `CLICKHOUSE_HOST`: `rc1d-...:8443` → `https://melnikov.app.n8n.cloud/webhook/clickhouse-proxy`. Zero-downtime update
- **End-to-end тест** через production API прошёл успешно. Первый в жизни проекта успешный полный раунд-трип `/api/query` (~30мс).
- Workflow JSON экспортирован из n8n и закоммичен в `infra/n8n/clickhouse_proxy.json` — IaC для n8n теперь есть

**Технические долги зафиксированы:**
- Пароль ClickHouse идёт в URL query string → попадает в логи n8n. Решение (5.7): после ротации переписать clickhouse.ts на body/headers.
- iiko-потоки хранят `passPlain` в Set-нодах вместо Credentials — экспорт не безопасен для git. Решение (Волна 5): перевести на Credentials.

### 18.04.2026, вечер (~40 мин работы)

**Волна 2, шаг 1 — GitHub Actions автодеплой:**
- Создан Cloudflare API-токен (шаблон `Edit Cloudflare Workers`, bounded scope)
- Токен сохранён в GitHub Secrets как `CLOUDFLARE_API_TOKEN`
- Добавлен `.github/workflows/deploy.yml`: checkout → setup-node@v4 → npm ci → cloudflare/wrangler-action@v3
- Первый push прошёл зелёным за 24 секунды
- Петля «git push → prod» замкнута

**Параллельно в экосистеме:**
- Weekly Advisor прислал 4 рекомендации, разобраны (см. ранее)
- Cowork ночью перекладывал Downloads → _archive
- Паспорт доведён до v3.6 с учётом контекста экосистемы n8n

### 17.04.2026, вечер (~2ч работы)

**Волна 1 инфраструктуры завершена:**
- Проект перенесён с `C:\Users\User\chicko-api-proxy` (Google Drive на старом PC) → `~/Developer/chicko-api-proxy` (MacBook Air)
- git init, `.gitignore`, git identity
- SSH-ключ ed25519, приватный GitHub repo, первый push
- Консолидированы 4 старых MD-файла в `README.md` + `docs/PASSPORT.md`
- `.dev.vars` очищен от старого пароля ClickHouse

### 17.04.2026, утро (~14ч работы за прошлые дни)

- Backend API на Cloudflare Workers deployed (`/health`, `/api/auth/login`, `/api/query`)
- JWT generation + validation (24h TTL)
- Row-level security (автоматическая инъекция `WHERE tenant_id='...'`)
- Выявлен блокер: прямое подключение Workers → ClickHouse не работает (SSL + ACL)
- Принято решение: n8n как прокси

### 15-16.04.2026

- Анализ существующего HTML-дашборда v4
- Архитектурный план (Workers + JWT + RLS + n8n)
- Первая версия Gantt
- Зафиксирован режим обучения в памяти Claude

---

## 11. Контакты и доступы

- **Production API:** https://chicko-api-proxy.chicko-api.workers.dev
- **Production query endpoint:** `POST /api/query` (JWT required)
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
- **Как работает API** → [README.md — API Reference](../README.md#api-reference)
- **Архитектура и почему так** → раздел [5](#5-архитектурные-решения-почему-именно-так)
- **Журнал паролей** → раздел [6](#6-credentials--журнал-ротаций)
- **Что делать дальше** → раздел [8](#8-план-развития--волны-инфраструктуры)
- **Как проверить что всё работает** → раздел [11](#11-контакты-и-доступы), «Тестовый end-to-end запрос»
- **Исторические документы (v3.x)** → `docs/archive/`

---

## 13. Как поддерживать этот документ

**Когда обновлять:**
- После каждой завершённой Волны или milestone — раздел [8](#8-план-развития--волны-инфраструктуры) + запись в [10](#10-changelog)
- После ротации любого пароля — новая запись в [6](#6-credentials--журнал-ротаций)
- После архитектурного решения — абзац в [5](#5-архитектурные-решения-почему-именно-так)
- После разблокировки блокера — удалить/зачеркнуть из [9](#9-открытые-вопросы-и-блокеры), записать в changelog

**Правила:**
- Если что-то здесь противоречит коду в репо — прав **код**, документ обновляется
- Не дублировать содержимое README.md
- Не плодить новые markdown-файлы рядом — расширяй паспорт или README

**Коммит-сообщение для обновлений:**
```
docs(passport): [что изменил кратко]
```

---

**Авторы:** Aleksey Melnikov + Claude
**Версии паспорта:** v3.3 → v3.4 → v3.5 → v3.6 → v3.7 → v3.8 → **v3.9** (текущая, фиксирует healthcheck active + n8n workflow в git, 18.04.2026 ночь)
