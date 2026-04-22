// Chicko Analytics — AI Insight endpoint (Phase 2.6)
// © 2026 System360 by Alex Melnikov. All rights reserved.
//
// POST /api/ai-insight
// Принимает KPI ресторана, отправляет в Claude API,
// возвращает структурированный анализ от "совета директоров".

import {
  authFromCookie,
  corsHeadersFor,
  rateLimitOrResponse,
} from './security';
import type { Env } from './index';

interface InsightRequest {
  restaurant: string;
  city: string;
  period: string;
  kpi: {
    revenue: number;
    avgCheck: number;
    checks: number;
    foodcost: number;
    discount: number;
    deliveryPct: number;
    score: number;
    rank: number;
    rankTotal: number;
  };
  growth: {
    revVsYoy: number;
    checksVsYoy: number;
    checkVsYoy: number;
  };
  net: {
    revenue: number;
    avgCheck: number;
    checks: number;
    foodcost: number;
    discount: number;
  };
}

const RATE_LIMIT_AI = { limit: 5, windowSec: 300 }; // 5 per 5 min

const SYSTEM_PROMPT = `Ты — совет директоров ресторана сети Chicko. Анализируешь KPI одного ресторана за выбранный период.

Дай анализ от лица трёх ролей, затем итого. Формат ответа — строго JSON:
{
  "operations": { "title": "Операционный директор", "emoji": "🏢", "text": "2-3 предложения" },
  "finance": { "title": "Финансовый директор", "emoji": "💰", "text": "2-3 предложения" },
  "commercial": { "title": "Коммерческий директор", "emoji": "📈", "text": "2-3 предложения" },
  "actions": ["действие 1", "действие 2", "действие 3"]
}

Правила:
- Пиши по-русски, конкретно, с цифрами из данных
- Не хвали просто так — ищи точки роста
- actions — это конкретные действия на неделю, не общие советы
- Учитывай сезон (март-август = сезон, сен-февраль = несезон)
- Сравнивай с медианой сети где это уместно
- Отвечай ТОЛЬКО JSON, без markdown и пояснений`;

export async function handleAiInsight(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const a = await authFromCookie(request, env);
    if (a instanceof Response) return a;

    const rl = await rateLimitOrResponse(env.MAGIC_LINKS, `ai:${a.user_id}`, RATE_LIMIT_AI, request);
    if (rl) return rl;

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'AI not configured' }),
        { status: 503, headers: { 'Content-Type': 'application/json', ...corsHeadersFor(request) } },
      );
    }

    const body = await request.json() as InsightRequest;
    if (!body.restaurant || !body.kpi) {
      return new Response(
        JSON.stringify({ error: 'Invalid request' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeadersFor(request) } },
      );
    }

    const userMessage = `Ресторан: ${body.restaurant} (${body.city})
Период: ${body.period}
Скор: ${body.kpi.score}/100 (ранг #${body.kpi.rank} из ${body.kpi.rankTotal})

KPI за период:
- Выручка/день: ${Math.round(body.kpi.revenue).toLocaleString()} ₽ (сеть: ${Math.round(body.net.revenue).toLocaleString()} ₽)
- Средний чек: ${Math.round(body.kpi.avgCheck)} ₽ (сеть: ${Math.round(body.net.avgCheck)} ₽)
- Чеков/день: ${Math.round(body.kpi.checks)} (сеть: ${Math.round(body.net.checks)})
- Фудкост: ${body.kpi.foodcost.toFixed(1)}% (сеть: ${body.net.foodcost.toFixed(1)}%, норма: 18-21%)
- Скидки: ${body.kpi.discount.toFixed(1)}% (сеть: ${body.net.discount.toFixed(1)}%)
- Доставка: ${body.kpi.deliveryPct.toFixed(1)}%

Динамика vs прошлый год:
- Выручка: ${body.growth.revVsYoy > 0 ? '+' : ''}${body.growth.revVsYoy.toFixed(1)}%
- Чеки: ${body.growth.checksVsYoy > 0 ? '+' : ''}${body.growth.checksVsYoy.toFixed(1)}%
- Средний чек: ${body.growth.checkVsYoy > 0 ? '+' : ''}${body.growth.checkVsYoy.toFixed(1)}%`;

    console.log(`[ai-insight] user=${a.user_id} restaurant=${body.restaurant}`);

    const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!apiResp.ok) {
      const errText = await apiResp.text();
      console.error(`[ai-insight] API error: ${apiResp.status} ${errText}`);
      return new Response(
        JSON.stringify({ error: 'AI request failed' }),
        { status: 502, headers: { 'Content-Type': 'application/json', ...corsHeadersFor(request) } },
      );
    }

    const apiData = await apiResp.json() as { content?: Array<{ type: string; text?: string }> };
    const text = apiData.content?.find(b => b.type === 'text')?.text || '';

    // Parse JSON from response (strip markdown fences if any)
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      console.error(`[ai-insight] JSON parse failed: ${clean.slice(0, 200)}`);
      parsed = { error: 'Failed to parse AI response', raw: clean.slice(0, 500) };
    }

    return new Response(
      JSON.stringify(parsed),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeadersFor(request) } },
    );
  } catch (error) {
    const err = error as Error;
    console.error(`[ai-insight] error: ${err.message}`, err.stack);
    return new Response(
      JSON.stringify({ error: 'Request failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeadersFor(request) } },
    );
  }
}
