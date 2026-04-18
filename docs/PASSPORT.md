# Паспорт проекта: Chicko Analytics

> **Живой документ.** Обновляется после каждой значимой сессии работы.
> История изменений — в разделе [Changelog](#10-changelog) внизу.
> Если что-то здесь противоречит коду в репо — прав код, этот документ надо обновить.

**Последнее обновление:** 18.04.2026, вечер — Волна 2 шаг 1 завершён (GitHub Actions автодеплой)
**Версия паспорта:** 3.7 (консолидирует v3.3–v3.6 + результаты 18.04 вечер)

---

## 1. Что это и зачем

**Chicko Analytics** — аналитическая платформа для франчайзи сети ресторанов Chicko. Показывает ключевые метрики (выручка, средний чек, foodcost, дисконт, доля доставки), сравнивает каждый ресторан с сетью и Top-10, строит динамику и выдаёт рекомендации.

**Пользователи:** владельцы франчайзи-ресторанов (видят свой ресторан), управляющая компания (видит всю сеть).

**Текущее поколение (v4):** статический HTML-дашборд с hardcoded подключением к ClickHouse. Работает, но не масштабируется: каждый новый франчайзи должен получить свой экспорт HTML + credentials засвечены.

**Целевое поколение:** тот же дашборд, но данные приходят через защищённый API с JWT + row-level security. Один URL для всех, каждый видит только свои данные.

---

## 2. Моментальный снимок

| Поле | Значение |
|---|---|
| **Production API** | https://chicko-api-proxy.chicko-api.workers.dev 🟢 |
| **GitHub (private)** | github.com/AlexMelnikov1976/chicko-api-proxy |
| **Локально (Mac)** | `~/Developer/chicko-api-proxy` |
| **Общий прогресс** | ~40% от плана (Волна 1 инфры ✅, Волна 2 шаг 1 ✅, API 75%, Dashboard 0%) |
| **Активный блокер** | n8n proxy не подключён → `/api/query` не работает end-to-end |
| **Ближайший milestone** | M3: ClickHouse через n8n работает — ETA 18.04 |
| **Автодеплой** | ✅ GitHub Actions: push в main → wrangler deploy (~24 сек) |
| **Ответственный** | Aleksey Melnikov |

---

## 3. Инфраструктура (где что физически живёт)

| Компонент | Платформа | URL / Путь | Как доступаюсь |
|---|---|---|---|
| Исходный код | GitHub (private) | `github.com/AlexMelnikov1976/chicko-api-proxy` | SSH key на MacBook |
| Backend API | Cloudflare Workers | `chicko-api-proxy.chicko-api.workers.dev` | `wrangler login` |
| База данных | Yandex Managed ClickHouse | `rc1d-3r30isjr73k4uue8.mdb.yandexcloud.net:8443` | Через n8n (прямое из Workers не работает) |
| Proxy / оркестратор | n8n self-hosted | `melnikov.app.n8n.cloud` | Web UI |
| CI/CD | GitHub Actions | `.github/workflows/deploy.yml` | Auto на push в main |
| Локальная разработка | MacBook Air (macOS, zsh) | `~/Developer/chicko-api-proxy` | Терминал |
| Старый дашборд (v4) | Один HTML файл | `chiko_dashboard_v4__19_.html` | Раздаётся вручную |

**Рабочее окружение:** Node v25.9.0, npm 11.12.1, Git 2.39.5 (Apple Git), wrangler 3.52.

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
         ▼
┌──────────────────────────┐
│  n8n Workflow            │    (SSL cert + ACL настроены)
│  ClickHouse Proxy        │
└────────┬─────────────────┘
         │  HTTPS, URL-параметры
         ▼
┌──────────────────────────┐
│  Yandex Managed          │
│  ClickHouse              │
│  БД: chicko              │
│  user: dashboard_ro (RO) │
└──────────────────────────┘
```

---

## 5. Архитектурные решения (почему именно так)

Эта секция — **для будущего себя**. Чтобы через полгода не задавать вопрос "а почему мы вообще не сделали X?".

### 5.1 Почему n8n proxy, а не прямое подключение Workers → ClickHouse?

**Пробовали. Не работает:**
- HTTPS порт 8443 → SSL error 526 (Yandex использует самоподписанный сертификат, Cloudflare не доверяет)
- HTTP порт 8123 → Connection timeout 522 (ACL закрыт для внешних)

**n8n решает обе проблемы:**
- n8n уже имеет рабочее подключение к этому ClickHouse (`allowUnauthorizedCerts: true`)
- Cloudflare Workers свободно общается с любым HTTPS-эндпоинтом n8n

**Плата:** +50-100мс latency, зависимость от второго сервиса.

**Альтернативы, которые отмели:**
- VPN из Workers в Yandex → Cloudflare Workers не поддерживает исходящий VPN
- Собственный прокси на EC2/VPS → плати $5-10/мес и мейнтейнь ещё один сервер
- Миграция ClickHouse на другой провайдер → дорого и не решает корневую проблему

### 5.2 Почему Cloudflare Workers, а не обычный Node.js backend?

- Бесплатный тир покрывает наши нужды (100k req/day)
- Глобальный edge → ~20мс до API из любой точки
- Нет infrastructure-as-a-service-headache: не надо следить за uptime сервера
- Секреты управляются через `wrangler secret put`, не файлами на сервере
- Цена за ошибку в prod-коде минимальна — мгновенный rollback через deploy

### 5.3 Почему JWT 24h, а не sessions в БД?

- Workers stateless по архитектуре, session store потребовал бы KV или внешний Redis
- 24h — компромисс: удобно для аналитической BI-задачи (франчайзи открывает дашборд раз в день), но не вечность
- Ротация секрета (`JWT_SECRET`) разом разлогинивает всех → есть kill switch

### 5.4 Почему row-level security регексом, а не view в ClickHouse?

- Регекс даёт контроль внутри API-слоя: logging, multi-tenant dashboards в будущем
- Views в ClickHouse требуют DDL-доступа и усложняют схему
- Минус регекса — уязвим к малфорсу SQL; митигируется тем, что `dashboard_ro` — read-only, и `tenant_id` всегда берётся из JWT, не из body

### 5.5 Почему документация в git (этот паспорт), а не в Notion?

- **Оба варианта правильные.** В git — для технических деталей (архитектура, credentials-rotation-log, deploy-процедуры). В Notion — для оперативных задач и трекинга (kanban, дедлайны, статусы).
- Ошибка прошлой версии: 4 MD-файла (`PROGRESS_FINAL`, `GANTT_UPDATED`, `README_API`, `TRANSFER_CHECKLIST`) повторяли друг друга на 70% и синхронизировались вручную. Консолидированы в `README.md` + этот `PASSPORT.md`.

### 5.6 Почему GitHub Actions, а не `wrangler deploy` руками (решение 18.04.2026)

- Устраняет риск "забыл задеплоить после коммита" — push и deploy становятся одной операцией
- Аудит-лог: кто/когда деплоил, виден в GitHub Actions (раньше — никак)
- Воспроизводимость: каждый деплой идёт из чистой Ubuntu с `npm ci` (строго по lockfile), не из локального окружения с возможными артефактами
- Нулевой риск для prod: если workflow упал на шаге deploy — prod не трогается. Сломанный workflow не может сломать работающий сервис
- Стоимость: бесплатно в приватном репо (2000 мин/мес бесплатного тира GitHub Actions, наш deploy занимает ~24 сек)

---

## 6. Credentials — журнал ротаций

**Это самый важный раздел для безопасности.** Каждая смена пароля/ключа — отдельная запись.

| Дата | Что | Действие | Причина | Кто сделал |
|---|---|---|---|---|
| 18.04.2026 | Cloudflare API Token (для CI) | Создан новый токен (scope: Edit Cloudflare Workers) | Нужен для GitHub Actions автодеплоя. Сохранён в GitHub Secrets как `CLOUDFLARE_API_TOKEN` | Aleksey |
| 17.04.2026 | ClickHouse `dashboard_ro` | Плановая ротация — TODO | Старый пароль (`chiko_dash_2026`) был захардкожен в HTML-дашборде v4. Пароль попадал в открытый код любому, у кого был HTML-файл | Ожидает выполнения |
| 17.04.2026 | Локальный `.dev.vars` | Удалён старый пароль, placeholder `TODO-replace-when-n8n-ready` | Подготовка к ротации, чтобы случайно не закоммитить | Aleksey |
| 17.04.2026 | Wrangler secrets (production) | Пока не тронуты — ждут плановой ротации | Связаны с ротацией ClickHouse | Ожидает |
| TBD | `JWT_SECRET` (production) | Ротация при переходе к real users | Текущий — dev-level, для MVP-теста | Ожидает |

### Где живут credentials

| Значение | Где лежит | Кто видит |
|---|---|---|
| `CLICKHOUSE_PASSWORD` production | Cloudflare Workers secrets | Только `wrangler secret` на авторизованной машине |
| `CLICKHOUSE_PASSWORD` локально | `~/Developer/chicko-api-proxy/.dev.vars` | Только на MacBook (в `.gitignore`) |
| `JWT_SECRET` production | Cloudflare Workers secrets | Так же как password |
| `CLOUDFLARE_API_TOKEN` (для CI) | GitHub Secrets (`Settings → Secrets → Actions`) | Только GitHub Actions workflow во время выполнения |
| ClickHouse `dashboard_ro` credentials | Yandex Cloud Console + менеджер паролей Aleksey | Только Aleksey |
| SSH-ключ к GitHub | `~/.ssh/id_ed25519` на MacBook | Только Aleksey |

**Правила:**
- Никогда не коммитить в git (защищено `.gitignore`, но ответственность остаётся)
- При смене — **сначала** обновить в менеджере паролей, **потом** в Cloudflare secrets, **потом** в n8n HTTP-ноде, **потом** в `.dev.vars`
- После каждой ротации — запись в таблицу выше

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
│       └── clickhouse_proxy.json   # n8n workflow (версионируется!)
├── docs/
│   ├── PASSPORT.md       # Этот файл
│   └── archive/          # Старые MD-файлы (4 штуки)
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
- Запись в базе Проектов Notion обновлена под Волну 2 (Next Action + Blockers)
- Скилл chiko-franchise-dashboard обновлён до v1.1: добавлен контекст экосистемы, ссылка на этот паспорт, явное разделение поколений v4/v5
- Раздел 8 паспорта переписан с учётом существующей базы Проектов в Notion (Волна 3 теперь не создаёт новую базу, а расширяет существующую)



### ✅ Волна 1: Критическая инфраструктура (завершена 17.04.2026 вечером)

| Шаг | Статус |
|---|---|
| Проект перенесён с Google Drive → `~/Developer/chicko-api-proxy` | ✅ |
| `git init` + `.gitignore` + первый коммит (9 файлов, секреты НЕ попали) | ✅ |
| GitHub private repo `AlexMelnikov1976/chicko-api-proxy` создан и запушен | ✅ |
| SSH-ключ сгенерирован и добавлен в GitHub | ✅ |
| Git identity настроена (`melnikov181076@gmail.com`) | ✅ |
| 4 старых MD-файла консолидированы в README.md + этот паспорт | ✅ |
| n8n workflow JSON перенесён в `infra/n8n/` как versioned infrastructure | ⏳ (нужно сделать move + commit) |
| `docs/archive/` с историей старой документации | ⏳ (нужно создать и commit) |

### 🟠 Волна 2: Автоматизация deploy и мониторинга (план: 1-2 вечера)

| Шаг | Время | Экономия | Статус |
|---|---|---|---|
| GitHub Actions workflow `.github/workflows/deploy.yml` — автодеплой на push в main | ~40 мин | 3-5 мин × каждый deploy | ✅ **18.04.2026** |
| Cloudflare API Token → GitHub Secrets | ~10 мин | Часть выше | ✅ **18.04.2026** |
| **Ротация ClickHouse пароля** — полный цикл (Yandex → менеджер паролей → wrangler → n8n → `.dev.vars`) | ~15 мин | Закрытие security-риска | ⏳ Next |
| **Активация n8n proxy** — импорт workflow, активация, update `CLICKHOUSE_HOST` secret | ~20 мин | Разблокировка `/api/query` | ⏳ Next |
| n8n healthcheck workflow (cron каждые 5 мин → Telegram при падении `/health`) | ~20 мин | Знаешь о падении до того как клиент позвонит | ⏸ |
| Sentry в Workers (DSN в secret + `init()` в `index.ts`) | ~20 мин | Stack-trace любой 500-ки в prod | ⏸ |

### 🟡 Волна 3: Трекинг и процесс (план: 1 день)

| Шаг | Цель |
|---|---|
| Notion database "Chicko Tasks" (поля: Stage/Status/ETA/Actual/Blockers) | Единый source of truth для задач |
| Миграция задач из `GANTT_UPDATED.md` → Notion | One-time |
| `docs/archive/` для 4 старых MD-файлов | Очистка корня |
| n8n workflow: GitHub webhook → Notion update при закрытии PR | Автообновление статусов |
| Google Calendar events с milestones M3-M6 | Дедлайны видны в календаре |

### 🟢 Волна 4: Автоматизация бизнес-процесса (план: 2-3 дня)

| Шаг | Цель |
|---|---|
| Cloudflare Pages для HTML-дашборда + автодеплой из git | URL вместо раздачи HTML вручную |
| n8n daily-rebuild: Google Sheets xlsx → skill `chiko-franchise-dashboard` → Pages deploy → Telegram | Дашборд обновляется сам каждое утро |
| n8n metrics-alerts: утренний ClickHouse query аномалий → Telegram | Проактивный мониторинг |
| Cloudflare Workers Cron Trigger: warm-cache benchmarks в KV | Dashboard загружается за 50мс |
| AI-инсайты в Chicko (из рекомендации #2 Advisor от 18.04) | Умные комментарии к метрикам |

### ⚪ Волна 5: Полировка (по мере появления времени)

- Rate limiting через Workers KV (100 req/hour/user)
- Unit + integration tests (JWT + RLS-injection)
- CORS whitelist вместо `*` для production
- Dashboard usage analytics

---

## 9. Открытые вопросы и блокеры

**Активные:**

1. **n8n proxy не активирован** — workflow JSON готов, но ещё не импортирован и не активирован. Блокирует `/api/query` end-to-end. ETA: Волна 2 (следующий шаг).
2. **ClickHouse пароль не ротирован** — лежит в старом HTML v4 в открытом виде. Security-риск. ETA: Волна 2 (следующий шаг).
3. ~~**Нет автодеплоя**~~ — ✅ Закрыто 18.04.2026. GitHub Actions работает, `git push` → prod за ~24 сек.
4. **Нет мониторинга** — если API ляжет, узнаем от пользователей. ETA: Волна 2 (healthcheck + Sentry).

**Вопросы на решение:**

- **Стоит ли HTML-дашборд v4 трогать сейчас?** После активации API было бы правильно перевести дашборд на JWT-auth и ротировать пароль. Но v4 продолжает работать как fallback. Решение: после успеха Волны 2, отдельной задачей.
- **Rate limit — в MVP или можно позже?** По первоначальному плану — в MVP. По факту user base маленький, абьюз маловероятен. Решение: перенести в Волну 5.
- **Multi-tenant или пока один Chicko?** Row-level security уже написан с прицелом на множественные tenants. Но пока только `tenant_chicko`. Решение: оставить код, реально добавлять tenants по запросу.

---

## 10. Changelog (что реально сделано, по датам)

### 18.04.2026, вечер (~40 мин работы)

**Волна 2, шаг 1 — GitHub Actions автодеплой:**
- Создан Cloudflare API-токен (шаблон `Edit Cloudflare Workers`, bounded scope — только Workers, без биллинга и прочего)
- Токен сохранён в GitHub Secrets как `CLOUDFLARE_API_TOKEN`
- Добавлен `.github/workflows/deploy.yml`: checkout → setup-node@v4 (Node 20) → npm ci → cloudflare/wrangler-action@v3
- Первый push прошёл зелёным за 24 секунды, `/health` возвращает `{"status":"ok"}`
- Петля «git push → prod» замкнута: ручной `wrangler deploy` больше не нужен

**Что это разблокирует:**
- Любые будущие правки кода едут на prod автоматически при push в main
- Снижается риск забыть deploy после коммита
- Появился аудит-лог: кто и когда деплоил, видно в GitHub → Actions
- Воспроизводимость: деплой идёт с чистой Ubuntu-машины, не с локального окружения

**Что в очереди (Волна 2 продолжение):**
- Ротация пароля ClickHouse + активация n8n proxy → разблокирует `/api/query`
- n8n healthcheck workflow с Telegram-алертом
- Sentry в Workers для stack-trace в prod

**Параллельно в экосистеме:**
- Weekly Automation Advisor прислал 4 рекомендации, разобраны: #1 применена (max_tokens в Sonnet Briefer 4096→2500), #2 отложена в Волну 4 Chicko (AI-инсайты), #3 отброшена, #4 в Notion-карточку Puls
- Cowork ночью перекладывал Downloads → _archive (статус не проверен)
- Паспорт доведён до v3.6 с учётом контекста экосистемы n8n

### 17.04.2026, вечер (~2ч работы)

**Волна 1 инфраструктуры завершена:**
- Проект перенесён с `C:\Users\User\chicko-api-proxy` (Google Drive на старом PC) → `~/Developer/chicko-api-proxy` (MacBook Air)
- Создан локальный git-репозиторий, настроен `.gitignore` (исключает `node_modules`, `.dev.vars`, build-артефакты)
- Настроена git identity: `Aleksey Melnikov <melnikov181076@gmail.com>`
- Сгенерирован SSH-ключ ed25519, добавлен в GitHub
- Создан приватный repo `github.com/AlexMelnikov1976/chicko-api-proxy`, `git push -u origin main --force` (затёр GitHub-овский auto-README)
- Консолидированы 4 старых MD-файла в `README.md` (техдок) + `docs/PASSPORT.md` (этот документ)
- `.dev.vars` очищен от старого пароля ClickHouse (placeholder до ротации)

**Что не успели, но в очереди:**
- Переместить `clickhouse_proxy_n8n.json` в `infra/n8n/` и commit
- Архивировать старые MD-файлы в `docs/archive/` и commit
- Всё из Волны 2

### 17.04.2026, утро (~14ч работы за прошлые дни по факту в докладе v3.x)

- Backend API на Cloudflare Workers deployed (`/health`, `/api/auth/login`, `/api/query`)
- JWT generation + validation (24h TTL, payload: user_id, tenant_id, email, permissions)
- Row-level security (автоматическая инъекция `WHERE tenant_id='...'`)
- Mock-клиент ClickHouse для локальной разработки
- Выявлен блокер: прямое подключение Workers → ClickHouse не работает (SSL + ACL)
- Принято решение: n8n как прокси. Workflow JSON подготовлен.

### 15-16.04.2026

- Анализ существующего HTML-дашборда v4
- Архитектурный план (Workers + JWT + RLS + n8n)
- Первая версия Gantt
- Зафиксирован режим обучения в памяти Claude: Socratic-метод, предсказание результатов, объяснение обратно. Учебный трек — отдельный Project "Tech Literacy".
---

## 11. Контакты и доступы

- **Production API:** https://chicko-api-proxy.chicko-api.workers.dev
- **Cloudflare Dashboard:** https://dash.cloudflare.com
- **GitHub Actions:** https://github.com/AlexMelnikov1976/chicko-api-proxy/actions
- **n8n:** https://melnikov.app.n8n.cloud/
- **ClickHouse (прямой доступ через Yandex Cloud Console):** https://console.cloud.yandex.ru/
- **GitHub:** https://github.com/AlexMelnikov1976/chicko-api-proxy

**Тестовые credentials (только для dev):**
- Email: `admin@chicko.ru`
- Password: `demo123`
- Tenant: `tenant_chicko`

---

## 12. Где что искать

- **Как задеплоить код** → `git push origin main` (автоматически через GitHub Actions). Руками: [README.md — Deployment](../README.md#deployment)
- **Как работает API** → [README.md — API Reference](../README.md#api-reference)
- **Как поднять проект с нуля на новой машине** → [README.md — Quick Start](../README.md#quick-start-новый-компьютер)
- **Архитектура и почему так** → раздел [5 этого паспорта](#5-архитектурные-решения-почему-именно-так)
- **Журнал паролей** → раздел [6](#6-credentials--журнал-ротаций)
- **Что делать дальше** → раздел [8](#8-план-развития--волны-инфраструктуры)
- **Исторические документы (v3.x)** → `docs/archive/`

---

## 13. Как поддерживать этот документ

**Когда обновлять:**
- После каждой завершённой Волны — обновить раздел [8](#8-план-развития--волны-инфраструктуры), добавить запись в [10](#10-changelog)
- После ротации любого пароля — новая запись в [6](#6-credentials--журнал-ротаций)
- После архитектурного решения — абзац в [5](#5-архитектурные-решения-почему-именно-так)
- После разблокировки блокера — удалить из [9](#9-открытые-вопросы-и-блокеры), записать в changelog

**Правила:**
- Если что-то здесь противоречит коду в репо — прав **код**, документ обновляется
- Не дублировать содержимое README.md — он про "как", этот файл про "что/почему/когда"
- Не плодить новые markdown-файлы рядом (ошибка v3.x) — расширяй паспорт или README

**Коммит-сообщение для обновлений:**
```
docs(passport): [что изменил кратко]
```

---

**Авторы:** Aleksey Melnikov + Claude
**Версии паспорта:** v3.3 → v3.4 → v3.5 → v3.6 → **v3.7** (текущая, фиксирует GitHub Actions автодеплой 18.04.2026)
