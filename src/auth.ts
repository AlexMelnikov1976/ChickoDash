import { sign, verify, decode } from '@tsndr/cloudflare-worker-jwt';

export interface JWTPayload {
  user_id: string;
  email: string;
  exp: number;
}

/**
 * Session TTL в секундах. Единый источник правды для двух мест:
 *   - exp внутри JWT (generateToken)
 *   - Max-Age cookie (buildSessionCookie)
 * До Phase 2.4d эти значения дублировались в разных файлах, что уже
 * однажды приводило к расхождению (audit #11, 30d vs 7d).
 */
export const SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

/**
 * Имя session cookie. HttpOnly, Secure, SameSite=Lax — ставится сервером,
 * JavaScript его не видит. Заменяет localStorage['chicko_jwt'] из Phase 2.3.
 */
export const SESSION_COOKIE_NAME = 'chicko_session';

export async function generateToken(
  payload: Omit<JWTPayload, 'exp'>,
  secret: string
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  return await sign({ ...payload, exp }, secret);
}

export async function validateToken(
  token: string,
  secret: string
): Promise<JWTPayload | null> {
  try {
    const isValid = await verify(token, secret);
    if (!isValid) return null;

    // verify() returns boolean. To get payload we use decode().
    const decoded = decode(token);
    if (!decoded || !decoded.payload) return null;

    return decoded.payload as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Устаревший helper, используется только legacy-путями до Phase 2.4d.
 * Оставлен на время миграции на cookie-auth — удалим, когда подтвердим,
 * что ни один клиент больше не шлёт Authorization: Bearer.
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.substring(7);
}

// --- Cookie-based session (Phase 2.4d, 2026-04-21) ------------------------
//
// HttpOnly cookie закрывает #3 аудита: XSS-кража токена из localStorage
// больше невозможна — JavaScript физически не видит HttpOnly cookie.
// SameSite=Lax защищает от основных CSRF-векторов (cross-site POST не
// прикладывает cookie). Дополнительно на POST-endpoints проверяется Origin.

/**
 * Парсит `Cookie: a=1; chicko_session=...; b=2` и возвращает значение
 * session cookie или null. Не использует split('='), чтобы корректно
 * обрабатывать значения, содержащие `=` (JWT base64 иногда с padding).
 */
export function extractTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === SESSION_COOKIE_NAME) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

/**
 * Строка для заголовка Set-Cookie при успешной аутентификации.
 *
 * HttpOnly  — JS не видит cookie (главная цель Phase 2.4d)
 * Secure    — только HTTPS (wrangler dev на http:// cookie не получит,
 *             но Alex деплоит напрямую в prod)
 * SameSite=Lax — cookie не уходит с cross-site POST (CSRF-защита),
 *             но уходит с top-level GET — это ок, ответ атакующий
 *             не прочитает из-за CORS
 * Path=/    — cookie доступен для всех endpoints
 * Max-Age   — синхронизирован с exp JWT
 */
export function buildSessionCookie(jwt: string): string {
  return `${SESSION_COOKIE_NAME}=${jwt}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SEC}`;
}

/**
 * Строка Set-Cookie для logout: пустое значение + Max-Age=0 → браузер
 * немедленно удаляет cookie. Все атрибуты должны совпадать с теми, с
 * которыми cookie ставился, иначе некоторые браузеры не удалят его.
 */
export function buildClearCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
