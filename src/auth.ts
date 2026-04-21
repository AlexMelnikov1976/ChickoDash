import { sign, verify, decode } from '@tsndr/cloudflare-worker-jwt';

export interface JWTPayload {
  user_id: string;
  email: string;
  exp: number;
}

export async function generateToken(
  payload: Omit<JWTPayload, 'exp'>,
  secret: string
): Promise<string> {
  // TTL 7 дней (Phase 2.4a, audit #11). До 21.04.2026 было 30 дней —
  // клиент в index.ts получал expires_in=7d, но внутри JWT exp оставался 30d.
  // Симптом: токен формально жил месяц вопреки аудиту.
  const exp = Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 7); // 7 days
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

export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.substring(7);
}
