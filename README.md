# Chicko API Proxy

Secure backend API для Chicko Analytics Dashboard. Cloudflare Workers + JWT + Row-Level Security + ClickHouse через n8n proxy.

**Production:** https://chicko-api-proxy.chicko-api.workers.dev  
**Status:** 🟢 Live (query endpoint требует n8n proxy)  
**Version:** v1.0

---

## Архитектура

```
Frontend Dashboard
      │  fetch() + JWT
      ▼
┌──────────────────────────┐
│  Cloudflare Workers      │
│  chicko-api-proxy        │
│    • JWT validation      │
│    • Row-level security  │
│    • Rate limiting (TBD) │
└──────────────┬───────────┘
               │  POST /webhook/clickhouse-proxy
               ▼
┌──────────────────────────┐
│  n8n Workflow            │
│  (SSL cert + ACL ready)  │
└──────────────┬───────────┘
               │  HTTPS
               ▼
┌──────────────────────────┐
│  Yandex Managed          │
│  ClickHouse              │
└──────────────────────────┘
```

**Почему n8n в середине:** Cloudflare Workers не может напрямую подключиться к Yandex Managed ClickHouse (self-signed SSL + closed firewall). n8n уже имеет рабочее подключение, поэтому используется как прокси.

---

## Quick Start (новый компьютер)

```bash
# 1. Клонируй репозиторий
git clone <repo-url> chicko-api-proxy
cd chicko-api-proxy

# 2. Установи зависимости
npm install

# 3. Создай .dev.vars для локальной разработки
cat > .dev.vars <<'EOF'
CLICKHOUSE_HOST=https://melnikov.app.n8n.cloud/webhook/clickhouse-proxy
CLICKHOUSE_USER=dashboard_ro
CLICKHOUSE_PASSWORD=<ask-team>
JWT_SECRET=your-local-dev-secret-min-32-chars
EOF

# 4. Залогинься в Cloudflare (только для deploy)
npx wrangler login

# 5. Запусти локально
npm run dev   # http://127.0.0.1:8787
```

> `.dev.vars` в `.gitignore` — **никогда не коммить**. Пароль и JWT_SECRET получи у команды или из Cloudflare dashboard → Workers → Settings → Variables.

---

## Статус проекта

Живая версия — в GitHub Projects / Notion (см. раздел [Трекинг](#трекинг)). Ниже — моментальный снимок на момент последнего релиза.

### Этапы

| Этап | Задачи | Статус |
|---|---|---|
| 1. Подготовка | Анализ, архитектура, план | ✅ Done |
| 2. API + Frontend | Backend, JWT, RLS, n8n, Frontend | ⏳ 75% |
| 3. Dashboard updates | Dynamic benchmarks, scoring, tenant switcher | ⏸️ Not started |
| 4. Testing & deploy | Unit/integration/perf tests | ⏸️ Not started |

### Текущий блокер

**n8n Proxy Integration** — workflow JSON готов (`infra/n8n/clickhouse_proxy.json`), требуется импорт в n8n и обновление `CLICKHOUSE_HOST` secret на webhook URL.

### Milestones

| # | Цель | ETA |
|---|---|---|
| M1 | Архитектура готова | ✅ 16.04 |
| M2 | API deployed | ✅ 17.04 |
| M3 | ClickHouse через n8n работает | ⏳ 18.04 |
| M4 | Frontend интеграция | ⏸️ 20.04 |
| M5 | Dynamic benchmarks | ⏸️ 23.04 |
| M6 | Production ready | ⏸️ 26.04 |

---

## API Reference

### `GET /health`

Health check. Не требует авторизации.

```json
{ "status": "ok", "timestamp": "2026-04-17T15:30:00.000Z" }
```

### `POST /api/auth/login`

Возвращает JWT токен (24h TTL).

**Request:**
```json
{ "email": "admin@chicko.ru", "password": "demo123" }
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOi...",
  "expires_in": 86400
}
```

**Payload внутри токена:**
```json
{
  "user_id": "user_001",
  "tenant_id": "tenant_chicko",
  "email": "admin@chicko.ru",
  "permissions": ["read", "write"],
  "exp": 1713398400
}
```

### `POST /api/query`

Выполняет ClickHouse query с автоматической инъекцией `tenant_id` из JWT.

**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Request:**
```json
{ "query": "SELECT * FROM mart_restaurant_daily_base LIMIT 10" }
```

**Что реально выполняется в ClickHouse (Row-Level Security):**
```sql
SELECT * FROM mart_restaurant_daily_base
WHERE tenant_id = 'tenant_chicko'
LIMIT 10
```

**Response:**
```json
{
  "status": "success",
  "data": [ /* rows */ ],
  "rows": 10,
  "statistics": { "elapsed": 0.023, "rows_read": 10 },
  "tenant_id": "tenant_chicko",
  "user_id": "user_001"
}
```

### Quick test из консоли браузера

```javascript
const API = 'https://chicko-api-proxy.chicko-api.workers.dev';

// 1. Login
const { token } = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@chicko.ru', password: 'demo123' })
}).then(r => r.json());

// 2. Query
const data = await fetch(`${API}/api/query`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({ query: 'SELECT 1 as test' })
}).then(r => r.json());

console.log(data);
```

---

## Структура проекта

```
chicko-api-proxy/
├── src/
│   ├── index.ts              # Main worker + routing
│   ├── auth.ts               # JWT generation / validation
│   ├── clickhouse.ts         # Real client (production)
│   └── clickhouse_mock.ts    # Mock client (local dev)
├── infra/
│   └── n8n/
│       └── clickhouse_proxy.json   # n8n workflow для импорта
├── wrangler.toml             # Cloudflare Workers config
├── package.json
├── tsconfig.json
├── .gitignore
├── .dev.vars                 # Local secrets (gitignored)
└── README.md
```

---

## Environment Variables

| Переменная | Описание | Пример |
|---|---|---|
| `CLICKHOUSE_HOST` | n8n webhook URL (не сам ClickHouse!) | `https://melnikov.app.n8n.cloud/webhook/clickhouse-proxy` |
| `CLICKHOUSE_USER` | ClickHouse user | `dashboard_ro` |
| `CLICKHOUSE_PASSWORD` | ClickHouse password | `<из wrangler secrets>` |
| `JWT_SECRET` | Ключ подписи JWT, min 32 chars | `<из wrangler secrets>` |

### Production (Cloudflare)

```bash
# Проверить список
npx wrangler secret list

# Установить / обновить
npx wrangler secret put CLICKHOUSE_HOST
npx wrangler secret put CLICKHOUSE_USER
npx wrangler secret put CLICKHOUSE_PASSWORD
npx wrangler secret put JWT_SECRET
```

### Local dev

Переменные в `.dev.vars` (см. [Quick Start](#quick-start-новый-компьютер)). Не коммитить.

---

## Deployment

```bash
# 1. Убедись, что secrets настроены
npx wrangler secret list

# 2. Deploy
npx wrangler deploy

# 3. Проверь
curl https://chicko-api-proxy.chicko-api.workers.dev/health
```

### Автодеплой через GitHub Actions (рекомендуется)

Добавь `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Cloudflare Workers
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

В GitHub Settings → Secrets → Actions добавь `CLOUDFLARE_API_TOKEN` (создай в Cloudflare → My Profile → API Tokens → "Edit Cloudflare Workers").

---

## Setup n8n Proxy

1. Импортируй `infra/n8n/clickhouse_proxy.json` в n8n (Workflows → Import from File).
2. Активируй workflow.
3. Скопируй Production Webhook URL.
4. Обнови secret:
   ```bash
   npx wrangler secret put CLICKHOUSE_HOST
   # Вставь URL из n8n
   npx wrangler deploy
   ```
5. Протестируй через `/api/query`.

---

## Безопасность

- **tenant_id извлекается из JWT**, не из request body → row-level security нельзя обойти.
- **Single quotes экранируются** (`'` → `''`) перед инъекцией в SQL.
- **CORS**: в dev разрешены все origins; для prod настрой whitelist в `src/index.ts`.
- **JWT_SECRET**: минимум 32 символа, ротируй при компрометации.
- **ClickHouse user** (`dashboard_ro`) имеет read-only права — это страховка на случай SQL injection.

⚠️ **Известная проблема:** старые версии HTML-дашборда содержат hardcoded credentials. После переезда на API сменить пароль `dashboard_ro` в ClickHouse.

---

## Трекинг

Этот README — только снимок. Живой трекинг:

- **Задачи:** Notion workspace → Chicko Analytics DB
- **Код:** GitHub Issues + Projects
- **Deploy:** GitHub Actions
- **Мониторинг:** n8n healthcheck workflow → Telegram

Статус и ETA задач обновляются в Notion/Projects — **не в README**. Если видишь расхождение, прав Notion.

---

## Troubleshooting

**`Module not found` после clone**
```bash
rm -rf node_modules package-lock.json
npm install
```

**`Unauthorized` при `wrangler deploy`**
```bash
npx wrangler logout
npx wrangler login
```

**`401 Unauthorized` на `/api/query`**
1. Проверь формат header: `Authorization: Bearer <token>` (с пробелом).
2. Токен живёт 24 часа — получи новый через `/api/auth/login`.
3. Проверь, что `JWT_SECRET` одинаковый в dev и prod.

**`500 Query execution failed`**
1. Проверь, что `CLICKHOUSE_HOST` указывает на n8n webhook, а **не** на сам ClickHouse.
2. Открой n8n → проверь, что workflow Active.
3. Дерни webhook напрямую через curl — должен вернуть JSON.

**Local dev не подключается к ClickHouse**  
Известный баг Cloudflare Workers с custom ports. Используй mock:
```typescript
// src/index.ts
import { ClickHouseClient } from './clickhouse_mock';  // вместо './clickhouse'
```

---

## Roadmap

### Short-term (эта неделя)
- [ ] n8n proxy интеграция + `CLICKHOUSE_HOST` update
- [ ] Row-level security testing с real data
- [ ] Rate limiting (Workers KV, 100 req/hour/user)
- [ ] Frontend integration старого дашборда на API

### Mid-term (следующая неделя)
- [ ] Dynamic benchmarks
- [ ] Scoring formula sync
- [ ] Real-time data refresh (WebSocket или polling)
- [ ] Tenant switcher UI

### Long-term
- [ ] Unit + integration tests
- [ ] Sentry monitoring
- [ ] Caching strategy (Cloudflare Cache API)
- [ ] Dashboard usage analytics
- [ ] CORS whitelist для production

---

## Dependencies

```json
{
  "@tsndr/cloudflare-worker-jwt": "^2.4.0",
  "wrangler": "^3.0.0",
  "typescript": "^5.0.0"
}
```

---

## Контакты

- **Production API:** https://chicko-api-proxy.chicko-api.workers.dev
- **Cloudflare Dashboard:** https://dash.cloudflare.com
- **n8n:** https://melnikov.app.n8n.cloud/
- **ClickHouse:** https://rc1d-3r30isjr73k4uue8.mdb.yandexcloud.net:8443/ (через VPN/n8n)

---

## License

Proprietary — Chicko Group. All rights reserved.
