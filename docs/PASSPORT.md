# Паспорт проекта: Chicko Analytics

> **Живой документ.** Обновляется после каждой значимой сессии работы.
> История изменений — в разделе [Changelog](#10-changelog) внизу.
> Если что-то здесь противоречит коду в репо — прав код, этот документ надо обновить.

**Последнее обновление:** 18.04.2026, поздний вечер — M3 закрыт (n8n proxy активирован, /api/query работает end-to-end)
**Версия паспорта:** 3.8 (консолидирует v3.3–v3.7 + результаты 18.04 поздний вечер)

---

## 1. Что это и зачем

**Chicko Analytics** — аналитическая платформа для франчайзи сети ресторанов Chicko. Показывает ключевые метрики (выручка, средний чек, foodcost, дисконт, доля доставки), сравнивает каждый ресторан с сетью и Top-10, строит динамику и выдаёт рекомендации.

**Пользователи:** владельцы франчайзи-ресторанов (видят свой ресторан), управляющая компания (видит всю сеть).

**Текущее поколение (v4):** статический HTML-дашборд с hardcoded подключением к ClickHouse. Работает, но не масштабируется.

**Целевое поколение:** тот же дашборд, но данные приходят через защищённый API с JWT + row-level security. **API теперь работает end-to-end** — следующий шаг M4, интеграция старого HTML-дашборда с этим API.

---

## 2. Моментальный снимок

| Поле | Значение |
|---|---|
| **Production API** | https://chicko-api-proxy.chicko-api.workers.dev 🟢 |
| **GitHub (private)** | github.com/AlexMelnikov1976/chicko-api-proxy |
| **Локально (Mac)** | `~/Developer/chicko-api-proxy` |
| **Общий прогресс** | ~50% от плана (Волна 1 ✅, Волна 2 на 50% ✅, API end-to-end работает, Dashboard 0%) |
| **Активный блокер** | Нет. `/api/query` работает end-to-end (Workers → n8n → ClickHouse). |
| **Ближайший milestone** | M4: Frontend-дашборд v4 переведён на JWT API — ETA 20.04 |
| **Автодеплой** | ✅ GitHub Actions: push в main → wrangler deploy (~24 сек) |
| **n8n proxy** | ✅ Active, webhook `/webhook/clickhouse-proxy`, тест end-to-end прошёл |
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
| n8n workflow ClickHouse Proxy | n8n | `/webhook/clickhouse-proxy` | Active с 18.04.2026 |
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
│  chicko-api-proxy        │
│    • JWT validate        │
│    • Row-level security  │
│    • Rate limiting (TBD) │
└────────┬─────────────────┘
         │  POST /webhook/clickhouse-proxy
         │  ?user=X&password=Y&database=chicko&query=SQL
         ▼
┌──────────────────────────┐
│  n8n Workflow            │  ✅ ACTIVE (18.04.2026)
│  ClickHouse Proxy        │  Webhook → HTTP Request → Respond
│  allowUnauthorizedCerts  │
└────────┬─────────────────┘
         │  HTTPS, query params forwarded
         ▼
┌──────────────────────────┐
│  Yandex Managed          │
│  ClickHouse              │
│  БД: chicko              │
│  user: dashboard_ro (RO) │
└──────────────────────────┘
```

**Проверено работающим end-to-end 18.04.2026 вечером:** curl → Workers → n8n → ClickHouse → ответ `SELECT 1` за ~30мс round-trip (из которых 1.2мс — сам ClickHouse).

---

## 5. Архитектурные решения (почему именно так)

### 5.1 Почему n8n proxy, а не прямое подключение Workers → ClickHouse?

**Пробовали. Не работает:**
- HTTPS порт 8443 → SSL error 526 (Yandex использует самоподписанный сертификат, Cloudflare не доверяет)
- HTTP порт 8123 → Connection timeout 522 (ACL закрыт для внешних)

**n8n решает обе проблемы:**
- n8n уже имеет рабочее подключение к этому ClickHouse (`allowUnauthorizedCerts: true`)
- Cloudflare Workers свободно общается с любым HTTPS-эндпоинтом n8n

**Плата:** +50-100мс latency, зависимость от второго сервиса. **Проверено на практике 18.04:** реальное round-trip ~30мс, приемлемо.

### 5.2 Почему Cloudflare Workers, а не обычный Node.js backend?

- Бесплатный тир покрывает наши нужды (100k req/day)
- Глобальный edge → ~20мс до API из любой точки
- Нет infrastructure-as-a-service-headache
- Секреты управляются через `wrangler secret put`
- Zero-downtime secret updates: обновление секрета не требует рестарта, текущие запросы доходят со старой конфигурацией, новые — с новой

### 5.3 Почему JWT 24h, а не sessions в БД?

- Workers stateless, session store потребовал бы KV или внешний Redis
- 24h — компромисс: удобно для аналитической BI-задачи, но не вечность
- Ротация `JWT_SECRET` разом разлогинивает всех → есть kill switch

### 5.4 Почему row-level security регексом, а не view в ClickHouse?

- Регекс даёт контроль внутри API-слоя: logging, multi-tenant dashboards в будущем
- Views в ClickHouse требуют DDL-доступа и усложняют схему
- `tenant_id` всегда берётся из JWT, не из body → нельзя обойти RLS

### 5.5 Почему документация в git (этот паспорт), а не в Notion?

- В git — для технических деталей (архитектура, credentials-rotation-log, deploy-процедуры). В Notion — для оперативных задач и трекинга.
- Ошибка прошлой версии: 4 MD-файла повторяли друг друга на 70% и синхронизировались вручную. Консолидированы в `README.md` + этот `PASSPORT.md`.

### 5.6 Почему GitHub Actions, а не `wrangler deploy` руками (решение 18.04.2026)

- Устраняет риск "забыл задеплоить после коммита"
- Аудит-лог: кто/когда деплоил, виден в GitHub Actions
- Воспроизводимость: каждый деплой идёт из чистой Ubuntu с `npm ci`
- Нулевой риск для prod: если workflow упал на шаге deploy — prod не трогается
- Стоимость: бесплатно в приватном репо

### 5.7 Почему n8n workflow авторизуется через URL query params, а не body/headers (18.04.2026, долг)

- **Исторически:** Workers-код писал SQL и креды как query-params, потому что ClickHouse HTTP API это поддерживает из коробки
- **Проблема:** пароль попадает в логи n8n на каждом запросе
- **Почему не переделали сразу:** правило «не менять две вещи разом». Сначала собрать работающий proxy (18.04), отдельно перевести auth на headers/body (долг).
- **План:** после ротации пароля — отрефакторить `src/clickhouse.ts` на отправку credentials в body, обновить n8n workflow соответственно.

---

## 6. Credentials — журнал ротаций

**Это самый важный раздел для безопасности.** Каждая смена пароля/ключа — отдельная запись.

| Дата | Что | Действие | Причина | Кто сделал |
|---|---|---|---|---|
| 18.04.2026 вечер | `CLICKHOUSE_HOST` (Cloudflare secret) | Обновлён: `rc1d-...:8443` → `https://melnikov.app.n8n.cloud/webhook/clickhouse-proxy` | Переключение с прямого адреса ClickHouse на n8n-прокси | Aleksey |
| 18.04.2026 | Cloudflare API Token (для CI) | Создан новый токен (scope: Edit Cloudflare Workers) | Нужен для GitHub Actions автодеплоя. Сохранён в GitHub Secrets как `CLOUDFLARE_API_TOKEN` | Aleksey |
| 🔴 TBD URGENT | ClickHouse `dashboard_ro` пароль | **Ротация обязательна** | Старый пароль `chiko_dash_2026` засветился в: (1) старом HTML-дашборде v4, (2) shell history MacBook, (3) истории чата с Claude, (4) в логах n8n execution history. Было "когда-нибудь", стало "срочно". | Ожидает |
| 17.04.2026 | Локальный `.dev.vars` | Удалён старый пароль, placeholder `TODO-replace-when-n8n-ready` | Подготовка к ротации | Aleksey |
| TBD | `JWT_SECRET` (production) | Ротация при переходе к real users | Текущий — dev-level, для MVP-теста | Ожидает |

### Где живут credentials

| Значение | Где лежит | Кто видит |
|---|---|---|
| `CLICKHOUSE_PASSWORD` production | Cloudflare Workers secrets | Только `wrangler secret` на авторизованной машине |
| `CLICKHOUSE_PASSWORD` локально | `~/Developer/chicko-api-proxy/.dev.vars` | Только на MacBook (в `.gitignore`) |
| `CLICKHOUSE_HOST` production | Cloudflare Workers secrets (теперь = webhook URL n8n) | Только `wrangler secret` |
| `JWT_SECRET` production | Cloudflare Workers secrets | Так же как password |
| `CLOUDFLARE_API_TOKEN` (для CI) | GitHub Secrets (`Settings → Secrets → Actions`) | Только GitHub Actions workflow |
| ClickHouse `dashboard_ro` credentials | Yandex Cloud Console + менеджер паролей Aleksey | Только Aleksey |
| SSH-ключ к GitHub | `~/.ssh/id_ed25519` на MacBook | Только Aleksey |

**Правила:**
- Никогда не коммитить в git (защищено `.gitignore`, но ответственность остаётся)
- При смене — **сначала** обновить в менеджере паролей, **потом** в Cloudflare secrets, **потом** в n8n, **потом** в `.dev.vars`
- После каждой ротации — запись в таблицу выше
- **Не пересылать пароли в текстовых каналах** (чат с LLM, Slack, email). Если случайно попал — ротировать следующим же действием.

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
│       └── clickhouse_proxy.json   # n8n workflow (TODO: экспортировать из n8n и закоммитить)
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
| n8n workflow JSON в `infra/n8n/` | ⏳ (экспортировать из n8n и commit) |
| `docs/archive/` с историей старой документации | ⏳ |

### 🟠 Волна 2: Автоматизация deploy и мониторинга (50% готово)

| Шаг | Время | Экономия | Статус |
|---|---|---|---|
| GitHub Actions workflow `.github/workflows/deploy.yml` | ~40 мин | 3-5 мин × каждый deploy | ✅ **18.04.2026** |
| Cloudflare API Token → GitHub Secrets | ~10 мин | Часть выше | ✅ **18.04.2026** |
| **Активация n8n proxy** — workflow собран с нуля, импортирован, активирован | ~60 мин | Разблокировка `/api/query` (M3) | ✅ **18.04.2026** |
| **Обновление `CLICKHOUSE_HOST` secret** на webhook URL n8n | ~5 мин | Часть выше | ✅ **18.04.2026** |
| 🔴 **Ротация пароля ClickHouse** — URGENT после компрометации | ~20 мин | Закрытие security-риска | ⏳ NEXT |
| Экспорт n8n workflow JSON в `infra/n8n/` + commit | ~10 мин | Versioning инфры | ⏳ |
| n8n healthcheck workflow (cron каждые 5 мин → Telegram) | ~20 мин | Знаешь о падении до того как клиент позвонит | ⏸ |
| Sentry в Workers | ~20 мин | Stack-trace любой 500-ки в prod | ⏸ |
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
| n8n metrics-alerts | Проактивный мониторинг |
| Cloudflare Workers Cron Trigger: warm-cache benchmarks в KV | Dashboard загружается за 50мс |
| AI-инсайты в Chicko (рекомендация #2 Advisor 18.04) | Умные комментарии к метрикам |

### ⚪ Волна 5: Полировка

- Rate limiting через Workers KV (100 req/hour/user)
- Unit + integration tests (JWT + RLS-injection)
- CORS whitelist вместо `*` для production
- Dashboard usage analytics
- Обновление wrangler 3.114 → 4.x

---

## 9. Открытые вопросы и блокеры

**Активные:**

1. 🔴 **URGENT: Ротация пароля ClickHouse `dashboard_ro`** — скомпрометирован: был захардкожен в HTML v4, попал в shell history MacBook, в историю чата с Claude, в n8n execution logs. Делается следующим действием.
2. ~~**n8n proxy не активирован**~~ — ✅ Закрыто 18.04.2026. Workflow собран с нуля, активирован, end-to-end тест успешен.
3. ~~**Нет автодеплоя**~~ — ✅ Закрыто 18.04.2026. GitHub Actions работает.
4. **Нет мониторинга** — если API ляжет, узнаем от пользователей. ETA: Волна 2 (healthcheck + Sentry).
5. **n8n workflow JSON не в git** — собранный сегодня workflow существует только в n8n cloud. Если n8n упадёт, нужно пересобирать с нуля. ETA: ближайший удобный момент.

**Вопросы на решение:**

- **Стоит ли HTML-дашборд v4 трогать сейчас?** После закрытия M3 — да, это и есть M4. ETA: 20.04.
- **Rate limit — в MVP или позже?** Решение: перенести в Волну 5 (user base маленький).
- **Multi-tenant или пока один Chicko?** RLS уже написан с прицелом на множественные tenants. Пока только `tenant_chicko`. Добавлять по запросу.

---

## 10. Changelog (что реально сделано, по датам)

### 18.04.2026, поздний вечер (~1.5ч работы)

**Волна 2, шаг 2 — n8n proxy для ClickHouse активирован. M3 закрыт.**

- Написан n8n workflow `ClickHouse Proxy for Chicko` с нуля (старого JSON не было найдено). Три ноды: Webhook → HTTP Request → Respond to Webhook
- JSON сгенерирован Claude, импортирован в n8n через "Import from File", сохранён, активирован
- Обнаружен и удалён старый workflow с таким же webhook path ("ClickHouse Proxy for Chicko API") — конфликтовал
- Тест прокси напрямую (через curl с `SELECT 1`) прошёл: ClickHouse вернул корректный JSON за 3мс
- Обновлён Cloudflare secret `CLICKHOUSE_HOST`: `rc1d-...:8443` → `https://melnikov.app.n8n.cloud/webhook/clickhouse-proxy`. Zero-downtime update, redeploy не потребовался
- **End-to-end тест** через production API прошёл успешно: curl → Cloudflare Workers (JWT validate + RLS) → n8n (webhook → HTTP Request → Respond) → ClickHouse (1.2мс elapsed) → обратно. **Первый в жизни проекта успешный полный раунд-трип `/api/query`.**

**Что это разблокирует:**
- Фронтенд теперь может дёргать `/api/query` с реальными запросами → готовы к M4
- Архитектурное решение с n8n-proxy подтверждено практикой (не гипотеза)
- Можно начинать разрабатывать dynamic benchmarks (M5)

**Что в очереди (приоритеты):**
1. 🔴 **Ротация пароля ClickHouse** (пароль засветился в shell/чате, теперь обязательно)
2. Экспорт n8n workflow JSON в `infra/n8n/` + commit (version control инфры)
3. Frontend v4 → JWT API (M4, планируется на 20.04)
4. n8n healthcheck + Sentry (остаток Волны 2)

**Технические долги зафиксированы:**
- Пароль ClickHouse идёт в URL query string → попадает в логи n8n. Решение (5.7): после ротации переписать clickhouse.ts на body/headers.
- wrangler 3.114 → 4.x update available (не критично, в Волну 5)

### 18.04.2026, вечер (~40 мин работы)

**Волна 2, шаг 1 — GitHub Actions автодеплой:**
- Создан Cloudflare API-токен (шаблон `Edit Cloudflare Workers`, bounded scope)
- Токен сохранён в GitHub Secrets как `CLOUDFLARE_API_TOKEN`
- Добавлен `.github/workflows/deploy.yml`: checkout → setup-node@v4 (Node 20) → npm ci → cloudflare/wrangler-action@v3
- Первый push прошёл зелёным за 24 секунды, `/health` возвращает `{"status":"ok"}`
- Петля «git push → prod» замкнута

**Параллельно в экосистеме:**
- Weekly Automation Advisor прислал 4 рекомендации, разобраны: #1 применена (max_tokens в Sonnet Briefer 4096→2500), #2 отложена в Волну 4 Chicko, #3 отброшена, #4 в карточку Puls
- Cowork ночью перекладывал Downloads → _archive (статус не проверен)
- Паспорт доведён до v3.6 с учётом контекста экосистемы n8n

### 17.04.2026, вечер (~2ч работы)

**Волна 1 инфраструктуры завершена:**
- Проект перенесён с `C:\Users\User\chicko-api-proxy` (Google Drive на старом PC) → `~/Developer/chicko-api-proxy` (MacBook Air)
- Создан локальный git-репозиторий, настроен `.gitignore`
- Настроена git identity
- Сгенерирован SSH-ключ ed25519, добавлен в GitHub
- Создан приватный repo, первый push
- Консолидированы 4 старых MD-файла в `README.md` + `docs/PASSPORT.md`
- `.dev.vars` очищен от старого пароля ClickHouse (placeholder до ротации)

### 17.04.2026, утро (~14ч работы за прошлые дни по факту в докладе v3.x)

- Backend API на Cloudflare Workers deployed (`/health`, `/api/auth/login`, `/api/query`)
- JWT generation + validation (24h TTL)
- Row-level security (автоматическая инъекция `WHERE tenant_id='...'`)
- Mock-клиент ClickHouse для локальной разработки
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
- **ClickHouse (прямой доступ через Yandex Cloud Console):** https://console.cloud.yandex.ru/
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

- **Как задеплоить код** → `git push origin main` (автоматически через GitHub Actions)
- **Как работает API** → [README.md — API Reference](../README.md#api-reference)
- **Архитектура и почему так** → раздел [5 этого паспорта](#5-архитектурные-решения-почему-именно-так)
- **Журнал паролей** → раздел [6](#6-credentials--журнал-ротаций)
- **Что делать дальше** → раздел [8](#8-план-развития--волны-инфраструктуры)
- **Исторические документы (v3.x)** → `docs/archive/`

---

## 13. Как поддерживать этот документ

**Когда обновлять:**
- После каждой завершённой Волны или milestone — обновить раздел [8](#8-план-развития--волны-инфраструктуры), добавить запись в [10](#10-changelog)
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
**Версии паспорта:** v3.3 → v3.4 → v3.5 → v3.6 → v3.7 → **v3.8** (текущая, фиксирует закрытие M3: n8n proxy activated, /api/query working end-to-end 18.04.2026)
