import "jsr:@supabase/functions-js@2.112.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import * as Sentry from "npm:@sentry/deno@9.47.1";
import { mensajeDeError } from "../_shared/errores.ts";
import { opcionesConContexto, sinUserAgentDeNavegador } from "../_shared/contextoAuditoria.ts";
import { autorizadoPorToken, filasDeWebhookZoho } from "../_shared/correo/webhookZoho.ts";

// Receptor del webhook de Zoho (correos transaccionales): rebotes, aperturas, clics. Guarda cada evento en
// `bitacora_evento_correo` para poder rastrear lo que paso con un correo DESPUES de que Zoho lo acepto.
//
// En el agente de Zoho: Webhooks -> Agregar webhook, URL `.../functions/v1/zoho-email-webhook`, y un encabezado de
// autorizacion con clave `Authorization` y valor `Bearer <ZOHO_WEBHOOK_TOKEN>` (el mismo valor del secreto). Zoho exige
// que la URL responda 200, asi que a todo lo que reciba autorizado se le contesta 200 aunque no se reconozca.

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    release: Deno.env.get("SENTRY_RELEASE"),
    tracesSampleRate: 0.1,
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (cuerpo: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Método no permitido" }, 405);
  }

  // Zoho "Verificar" la URL ANTES de guardar el encabezado de autorizacion: la documentacion dice que
  // comprueba que el endpoint "is reachable and returns status code 200", y el formulario avisa que «la llamada
  // de API no debe estar autenticada». Con un 401 el formulario no deja agregar el webhook (19-oct-2026). Una
  // llamada SIN cabecera Authorization no hace nada (ni lee el cuerpo ni toca la base) y responde 200: es el
  // ping de Zoho y no necesita credenciales. Una cabecera PRESENTE pero incorrecta si es 401, para que un token
  // mal copiado se note en vez de fallar en silencio.
  if (!req.headers.get("Authorization")) {
    return json({ recibido: 0, autorizado: false }, 200);
  }

  // Sin secreto configurado el receptor NO acepta nada: no queda abierto por olvido.
  const esperado = Deno.env.get("ZOHO_WEBHOOK_TOKEN");
  if (!esperado) {
    console.error("zoho-email-webhook: falta el secreto ZOHO_WEBHOOK_TOKEN");
    return json({ error: "Webhook no configurado" }, 503);
  }
  if (!autorizadoPorToken(req.headers.get("Authorization"), esperado)) {
    return json({ error: "No autorizado" }, 401);
  }

  try {
    const cuerpo = await req.json().catch(() => null);
    const filas = filasDeWebhookZoho(cuerpo);
    if (filas.length === 0) {
      // Prueba de Zoho o formato desconocido: se responde 200 (lo exige Zoho) sin guardar nada.
      return json({ recibido: 0 }, 200);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      sinUserAgentDeNavegador(opcionesConContexto(req)),
    );
    const { error } = await supabase.from("bitacora_evento_correo").insert(filas);
    if (error) {
      // Se registra el codigo, nunca el cuerpo: lleva destinatarios.
      console.error(`zoho-email-webhook: no se pudieron guardar los eventos (codigo ${error.code ?? "?"})`);
      return json({ error: "No se pudieron guardar los eventos" }, 500);
    }
    return json({ recibido: filas.length }, 200);
  } catch (error) {
    console.error("zoho-email-webhook: error", mensajeDeError(error));
    if (sentryDsn) Sentry.captureException(error);
    return json({ error: "Error interno" }, 500);
  }
});
