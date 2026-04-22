// Chicko Analytics Dashboard — HTML handler
// © 2026 System360 by Alex Melnikov. All rights reserved.
// Proprietary software — unauthorized copying or distribution prohibited.
//
// До Phase 2.8 (session 8.1, 22.04.2026) здесь жил
//   export const DASHBOARD_HTML = `<!DOCTYPE html>...`
// длиной 3436 строк. Вынесено в public/dashboard.{html,css,js} и отдаётся
// через Cloudflare Workers Static Assets (env.ASSETS).
//
// Security headers навешиваем именно здесь, чтобы они применились к HTML-
// ответу независимо от того, как Cloudflare серверит исходный файл.
// /dashboard.html в обход этого handler'а заблокирован редиректом в index.ts.

export async function handleDashboard(
  request: Request,
  assets: Fetcher,
  securityHeaders: Record<string, string>,
): Promise<Response> {
  const url = new URL(request.url);
  const assetUrl = new URL(url);
  assetUrl.pathname = '/dashboard.html';

  const r = await assets.fetch(new Request(assetUrl.toString(), request));
  if (r.status !== 200) {
    // Ассета нет или внутренняя ошибка — отдаём как есть без модификаций.
    // Это защита от ситуации, когда public/dashboard.html случайно не
    // задеплоился: не хотим оверрайдить заголовки 404/500-ответа.
    return r;
  }

  const headers = new Headers(r.headers);
  headers.set('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(securityHeaders)) {
    headers.set(k, v);
  }
  return new Response(r.body, { status: r.status, headers });
}
