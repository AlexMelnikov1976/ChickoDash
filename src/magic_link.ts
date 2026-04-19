// Magic-link authentication module.
// Handles token generation, KV storage, validation, and sending emails via Resend.

export interface MagicLinkData {
  email: string;
  created_at: number;
}

/**
 * Generate a cryptographically random token (32 bytes = 256 bits).
 * Returns a URL-safe hex string (64 chars).
 */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Store a magic-link token in KV with TTL 15 minutes.
 * Key: "token:<token>", value: JSON with email and created_at.
 */
export async function storeToken(
  kv: KVNamespace,
  token: string,
  email: string
): Promise<void> {
  const data: MagicLinkData = {
    email,
    created_at: Date.now(),
  };
  await kv.put(`token:${token}`, JSON.stringify(data), {
    expirationTtl: 15 * 60, // 15 minutes
  });
}

/**
 * Validate a magic-link token and consume it (delete from KV so it cannot be reused).
 * Returns email if valid, null if invalid/expired.
 */
export async function consumeToken(
  kv: KVNamespace,
  token: string
): Promise<string | null> {
  const raw = await kv.get(`token:${token}`);
  if (!raw) return null;

  try {
    const data = JSON.parse(raw) as MagicLinkData;
    // Delete immediately (one-time use)
    await kv.delete(`token:${token}`);
    return data.email;
  } catch {
    return null;
  }
}

/**
 * Check if an email is in the allowed users whitelist (USERS KV).
 * Returns user_id if allowed, null otherwise.
 * Key format in USERS KV: "user:<email>" -> JSON { user_id: "..." }
 */
export async function isAllowedUser(
  kv: KVNamespace,
  email: string
): Promise<string | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const raw = await kv.get(`user:${normalizedEmail}`);
  if (!raw) return null;

  try {
    const data = JSON.parse(raw) as { user_id: string };
    return data.user_id || null;
  } catch {
    return null;
  }
}

/**
 * Rate limit: allow only one magic-link request per email per 60 seconds.
 * Returns true if request allowed, false if rate-limited.
 */
export async function checkRateLimit(
  kv: KVNamespace,
  email: string
): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  const key = `ratelimit:${normalizedEmail}`;
  const existing = await kv.get(key);
  if (existing) return false;

  await kv.put(key, '1', { expirationTtl: 60 }); // 60 seconds
  return true;
}

/**
 * Send magic-link email via Resend API.
 * Returns true if email sent successfully, false otherwise (caller logs the error).
 */
export async function sendMagicLinkEmail(
  resendApiKey: string,
  toEmail: string,
  magicLinkUrl: string
): Promise<{ success: boolean; error?: string }> {
  const subject = 'Вход в Chicko Analytics';
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 560px; margin: 0 auto; padding: 32px 24px;">
  <h2 style="color: #1a1a1a; margin-bottom: 24px;">Вход в Chicko Analytics</h2>

  <p>Здравствуйте!</p>

  <p>Нажмите кнопку ниже, чтобы войти в дашборд:</p>

  <p style="margin: 32px 0;">
    <a href="${magicLinkUrl}"
       style="display: inline-block; background: #1a1a1a; color: #fff; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: 500;">
      Войти в дашборд
    </a>
  </p>

  <p style="color: #666; font-size: 14px;">Или скопируйте ссылку в браузер:<br>
    <a href="${magicLinkUrl}" style="color: #0066cc; word-break: break-all;">${magicLinkUrl}</a>
  </p>

  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 32px 0;">

  <p style="color: #999; font-size: 13px;">
    Ссылка действительна 15 минут и может быть использована только один раз.<br>
    Если вы не запрашивали вход — просто проигнорируйте это письмо.
  </p>

  <p style="color: #999; font-size: 13px; margin-top: 24px;">
    — Chicko Analytics
  </p>
</body>
</html>
  `.trim();

  const text = `
Здравствуйте!

Перейдите по ссылке, чтобы войти в дашборд Chicko Analytics:

${magicLinkUrl}

Ссылка действительна 15 минут и может быть использована только один раз.
Если вы не запрашивали вход — просто проигнорируйте это письмо.

— Chicko Analytics
  `.trim();

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Chicko Analytics <noreply@business-360.ru>',
        to: [toEmail],
        subject,
        html,
        text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Resend ${response.status}: ${errorText}` };
    }

    return { success: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
}
