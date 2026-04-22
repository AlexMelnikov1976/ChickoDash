// Chicko Analytics — User activity logging (Phase 2.5)
// © 2026 System360 by Alex Melnikov. All rights reserved.
//
// Асинхронная запись в ClickHouse через waitUntil.
// Не блокирует ответ пользователю. Fail-silent: ошибки
// логируются в console.error, но не ронят запрос.

import type { Env } from './index';

export interface ActivityEntry {
  user_id: string;
  email: string;
  endpoint: string;
  method: string;
  restaurant_id: number | null;
  response_status: number;
  response_ms: number;
  user_agent: string;
}

export async function logActivity(env: Env, entry: ActivityEntry): Promise<void> {
  try {
    const row = [
      `now()`,
      esc(entry.user_id),
      esc(entry.email),
      esc(entry.endpoint),
      esc(entry.method),
      entry.restaurant_id !== null ? String(entry.restaurant_id) : 'NULL',
      String(entry.response_status),
      String(entry.response_ms),
      esc(entry.user_agent),
    ].join(',');

    const sql = `INSERT INTO chicko.user_activity_log (ts, user_id, email, endpoint, method, restaurant_id, response_status, response_ms, user_agent) VALUES (${row})`;

    const url = `${env.CLICKHOUSE_HOST}?user=${env.CLICKHOUSE_USER}&password=${encodeURIComponent(env.CLICKHOUSE_PASSWORD)}&database=chicko&query=${encodeURIComponent(sql)}`;

    const resp = await fetch(url, { method: 'POST' });
    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[activity-log] CH error: ${resp.status} ${text}`);
    }
  } catch (e) {
    console.error(`[activity-log] failed: ${(e as Error).message}`);
  }
}

function esc(s: string): string {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}
