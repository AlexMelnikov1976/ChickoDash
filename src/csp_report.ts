// Chicko Analytics — CSP violation report endpoint (Phase 2.4c)
// © 2026 System360 by Alex Melnikov. All rights reserved.
// Proprietary software — unauthorized copying or distribution prohibited.
//
// Endpoint: POST /api/csp-report   (public, no auth — reports come from
// unauthenticated browser navigation too)
//
// Принимает CSP violation reports от браузера. Агрегирует в KV
// (namespace MAGIC_LINKS, префикс `csp:`, TTL 7 дней) с дедупликацией
// по паре (directive, blocked-uri) — одна запись на уникальный класс
// нарушения с инкрементируемым счётчиком.
//
// Поддерживаются оба формата:
//   - application/csp-report        (classic, wrapped в "csp-report": {...})
//   - application/reports+json      (Reporting API v1, массив отчётов)
//
// Через ~7 дней после Phase 2.4c:
//   wrangler kv key list --binding MAGIC_LINKS --prefix "csp:"
//   → выбираем топ нарушений по count
//   → составляем enforce-политику
//   → меняем Content-Security-Policy-Report-Only на Content-Security-Policy
//   → удаляем этот endpoint (или оставляем для продолжения мониторинга)

import type { Env } from './index';

// --- Report body shapes ---

interface LegacyCspReportBody {
  'document-uri'?: string;
  'violated-directive'?: string;
  'effective-directive'?: string;
  'blocked-uri'?: string;
  'line-number'?: number;
  'column-number'?: number;
  'source-file'?: string;
  'script-sample'?: string;
  'disposition'?: string;
}

interface LegacyCspReportWrapper {
  'csp-report'?: LegacyCspReportBody;
}

interface ReportingApiCspBody {
  effectiveDirective?: string;
  blockedURL?: string;
  documentURL?: string;
  sourceFile?: string;
  lineNumber?: number;
  columnNumber?: number;
  sample?: string;
  disposition?: string;
}

interface ReportingApiEntry {
  type?: string;
  body?: ReportingApiCspBody;
}

// --- Normalized shape used internally ---

interface NormalizedReport {
  directive: string;
  blocked_uri: string;
  source_file: string;
  line_number: number;
  script_sample: string;
}

// --- Aggregated KV record ---

interface AggregatedRecord {
  count: number;
  first_seen: string;
  last_seen: string;
  directive: string;
  blocked_uri: string;
  sample_source: string;
  sample_line: number;
  sample_script: string;
}

// SHA-1, первые 8 байт → 16-hex-char ключ. Не крипто, только
// стабильный идентификатор класса нарушения.
async function shortHash(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(hash))
    .slice(0, 8)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeFromLegacy(body: LegacyCspReportBody): NormalizedReport {
  return {
    directive: body['effective-directive'] || body['violated-directive'] || 'unknown',
    blocked_uri: body['blocked-uri'] || 'unknown',
    source_file: body['source-file'] || '',
    line_number: body['line-number'] || 0,
    script_sample: (body['script-sample'] || '').slice(0, 200),
  };
}

function normalizeFromReportingApi(body: ReportingApiCspBody): NormalizedReport {
  return {
    directive: body.effectiveDirective || 'unknown',
    blocked_uri: body.blockedURL || 'unknown',
    source_file: body.sourceFile || '',
    line_number: body.lineNumber || 0,
    script_sample: (body.sample || '').slice(0, 200),
  };
}

export async function handleCspReport(request: Request, env: Env): Promise<Response> {
  try {
    // Защита от abuse: ограничиваем размер payload до 10 КБ.
    const contentLength = request.headers.get('Content-Length');
    if (contentLength && parseInt(contentLength, 10) > 10 * 1024) {
      return new Response(null, { status: 413 });
    }

    const contentType = (request.headers.get('Content-Type') || '').toLowerCase();
    const bodyText = await request.text();

    // Дополнительная проверка реального размера (Content-Length не обязателен)
    if (bodyText.length > 10 * 1024) {
      return new Response(null, { status: 413 });
    }

    let normalized: NormalizedReport | null = null;

    if (contentType.includes('application/csp-report') || contentType.includes('application/json')) {
      // Classic CSP report: { "csp-report": {...} }
      try {
        const parsed = JSON.parse(bodyText) as LegacyCspReportWrapper;
        if (parsed['csp-report']) {
          normalized = normalizeFromLegacy(parsed['csp-report']);
        }
      } catch {
        return new Response(null, { status: 400 });
      }
    } else if (contentType.includes('application/reports+json')) {
      // Reporting API: массив отчётов разных типов
      try {
        const parsed = JSON.parse(bodyText) as ReportingApiEntry[];
        const cspEntry = parsed.find(r => r.type === 'csp-violation' && r.body);
        if (cspEntry?.body) {
          normalized = normalizeFromReportingApi(cspEntry.body);
        }
      } catch {
        return new Response(null, { status: 400 });
      }
    } else {
      return new Response(null, { status: 415 });
    }

    if (!normalized) {
      return new Response(null, { status: 400 });
    }

    // Лог в wrangler tail (и Cloudflare dashboard).
    // Формат компактный — одна строка на violation.
    console.log(
      `[csp-report] ${normalized.directive} blocked=${normalized.blocked_uri} ` +
      `src=${normalized.source_file}:${normalized.line_number}`
    );

    // Ключ агрегации: дедуп по (directive, blocked-uri).
    const hashKey = await shortHash(`${normalized.directive}|${normalized.blocked_uri}`);
    const kvKey = `csp:${hashKey}`;

    // Read-modify-write. Последний writer wins — при редких коллизиях
    // потеряем 1-2 инкремента, не критично для observability.
    let existing: AggregatedRecord | null = null;
    try {
      const raw = await env.MAGIC_LINKS.get(kvKey);
      if (raw) {
        existing = JSON.parse(raw) as AggregatedRecord;
      }
    } catch (e) {
      console.error(`[csp-report] KV get failed: ${(e as Error).message}`);
    }

    const now = new Date().toISOString();
    const record: AggregatedRecord = existing
      ? {
          ...existing,
          count: existing.count + 1,
          last_seen: now,
        }
      : {
          count: 1,
          first_seen: now,
          last_seen: now,
          directive: normalized.directive,
          blocked_uri: normalized.blocked_uri,
          sample_source: normalized.source_file,
          sample_line: normalized.line_number,
          sample_script: normalized.script_sample,
        };

    try {
      await env.MAGIC_LINKS.put(kvKey, JSON.stringify(record), {
        expirationTtl: 7 * 24 * 3600, // 7 days
      });
    } catch (e) {
      console.error(`[csp-report] KV put failed: ${(e as Error).message}`);
    }

    // 204 No Content — стандартный ответ на CSP report.
    // Браузер ничего не ждёт, CORS не нужен (same-origin endpoint).
    return new Response(null, { status: 204 });
  } catch (error) {
    const err = error as Error;
    console.error(`[csp-report] error: ${err.message}`, err.stack);
    return new Response(null, { status: 500 });
  }
}
