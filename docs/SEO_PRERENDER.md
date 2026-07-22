# SEO — Fase 2: Prerendering (Netlify Prerender Extension)

## Estado: ACTIVO

La extensión nativa **Prerender** de Netlify está instalada y activa desde el dashboard (manualmente, por Axel). Esta extensión reemplaza el feature legacy de "Prerendering" en Netlify settings, que está **deprecado desde el 20 de enero de 2026** y no debe usarse.

## Qué hace

Cuando un bot/crawler (Googlebot, Bingbot, GPTBot, PerplexityBot, ClaudeBot, etc.) solicita una URL, la extensión ejecuta un headless browser que renderiza la SPA, espera a que el contenido esté disponible, y devuelve el HTML completo — no el shell vacío `<div id="root"></div>`.

## Fix de Realtime aplicado (2026-07-21)

### Problema

TourDetailPage y sus componentes hijos abren **tres suscripciones WebSocket** (Supabase Realtime) durante la carga inicial:

1. `TourDetailPage.tsx` — canal `tour_detail_availability` sobre `bookings`
2. `BookingForm.tsx` — canal `tour_availability` sobre `bookings`
3. `AnnouncementPopup.tsx` — canal global sobre `platform_settings`

Los WebSockets se mantienen abiertos indefinidamente, lo que puede impedir que el prerenderer considere la página como "lista" (network idle) y forzar un timeout o entregar HTML incompleto.

### Solución

Se creó `src/utils/isCrawler.ts` que detecta bots por `navigator.userAgent` (Googlebot, Bingbot, GPTBot, PerplexityBot, ClaudeBot, Netlify Prerender, HeadlessChrome, Puppeteer, etc.).

En los tres componentes, la suscripción WebSocket se **omite por completo** cuando `isCrawler()` retorna `true`. La consulta inicial de datos (RPC/SELECT) se ejecuta igual — el bot ve el contenido completo, solo sin actualizaciones en tiempo real que no necesita.

Si el prerenderer no manda un user-agent identificable de forma consistente y el problema persiste, el fallback sería un `setTimeout` de 2-3s antes de abrir el WebSocket — pero esa mitigación basada en tiempo no es garantizada y sería el primer sospechoso a revisar si los bots siguen recibiendo contenido incompleto en el futuro.

## Verificación manual (post-deploy)

Probar con un slug real:

```bash
# Debe devolver HTML con contenido del tour (título, precio, descripción),
# no un shell vacío con solo <div id="root"></div>
curl -sS -A "Googlebot/2.1 (+http://www.google.com/bot.html)" \
  https://toursredmx.netlify.app/tours/islas-marias-aventourax \
  | grep -i "islas\|precio\|tour"
```

También puedes probar desde Chrome DevTools:
1. DevTools → Network conditions → User agent → "Googlebot Smartphone"
2. Recarga la página
3. View page source — debe contener el contenido del tour, no solo el shell

Si el HTML sigue llegando vacío tras el fix de Realtime, revisar el timeout configurado en la extensión Prerender desde el dashboard de Netlify (puede aumentarse).

## Limpieza de og:image (index.html)

Se reemplazaron los placeholders de `https://bolt.new/static/og_default.png` en `og:image` y `twitter:image` por `/LogoFinal.jpg` (imagen de marca real de ToursRed). Esto es relevante porque el prerenderer sirve ese HTML a los bots y scrapers de redes sociales.
