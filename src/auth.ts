import { sign, verify, decode } from '@tsndr/cloudflare-worker-jwt';

export interface JWTPayload {
  user_id: string;
  tenant_id: string;
  email: string;
  permissions: string[];
  exp: number;
}

export async function generateToken(
  payload: Omit<JWTPayload, 'exp'>,
  secret: string
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + (60 * 60 * 24); // 24 hours
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
    // decode() returns { header, payload } object — we need .payload.
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
