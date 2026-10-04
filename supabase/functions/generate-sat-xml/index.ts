import "jsr:@supabase/functions-js@2.112.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import * as Sentry from "npm:@sentry/deno@9.47.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    release: Deno.env.get("SENTRY_RELEASE"),
    tracesSampleRate: 0.1,
  });
}

interface ChartAccount {
  code: string;
  sat_group_code: string | null;
  name: string;
  level: number;
  nature: string;
  account_type?: string;
}

interface TrialBalanceRow {
  code: string;
  nature: string;
  opening_debit: number | null;
  opening_credit: number | null;
  period_debit: number | null;
  period_credit: number | null;
  closing_debit: number | null;
  closing_credit: number | null;
}

interface AccountingEntryRow {
  id: string;
  entry_number: string;
  entry_type: string;
  entry_date: string;
  description: string | null;
}

interface AccountingEntryLine {
  entry_id: string;
  account_code: string;
  description: string | null;
  debit: number | null;
  credit: number | null;
  cfdi_uuid: string | null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function xmlEscape(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatAmount(n: number | null | undefined): string {
  return Number(n ?? 0).toFixed(2);
}

// XML Catalogo de Cuentas — CT_RFC_AAAAMM.xml
function buildCatalogXml(accounts: ChartAccount[], rfc: string, year: number, month: number): string {
  const rows = accounts.map((a) => {
    const tipo = a.nature === "deudora" ? "D" : "A";
    return `    <catalogocuentas:Ctas CodAgrup="${xmlEscape(a.sat_group_code)}" NumCta="${xmlEscape(a.code)}" Desc="${xmlEscape(a.name)}" Nivel="${a.level}" Natur="${tipo}"/>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<catalogocuentas:Catalogo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:catalogocuentas="http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/CatalogoCuentas"
  xsi:schemaLocation="http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/CatalogoCuentas http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/CatalogoCuentas/CatalogoCuentas_1_3.xsd"
  RFC="${xmlEscape(rfc)}" Mes="${pad2(month)}" Anio="${year}" TipoEnvio="N" Version="1.3">
${rows.join("\n")}
</catalogocuentas:Catalogo>`;
}

// XML Balanza de Comprobacion — BC_RFC_AAAAMM.xml
//
// get_trial_balance regresa opening_debit/opening_credit y
// closing_debit/closing_credit BRUTOS, sin netear por naturaleza de cuenta
// (confirmado leyendo la funcion SQL: son sumas de movimientos, cualquier
// cuenta puede traer los dos lados con datos). SaldoIni/SaldoFin del
// esquema del SAT son UN solo numero por cuenta -el saldo neto del lado
// natural de la cuenta-, no el lado deudor a secas. Antes de este fix se
// imprimia siempre formatAmount(r.opening_debit)/(r.closing_debit): para
// cualquier cuenta acreedora (pasivo, capital, ingreso -la mayoria del
// catalogo-) el saldo real vive del lado acreedor, asi que salia en 0.00 o
// incompleto en el XML que se sube al SAT.
//
// Misma regla que ya usa get_account_balances_full (CASE WHEN nature =
// 'deudora' THEN debit-credit ELSE credit-debit END), no una nueva.
function buildTrialBalanceXml(rows: TrialBalanceRow[], rfc: string, year: number, month: number): string {
  const cuentas = rows.map((r) => {
    const esDeudora = r.nature === "deudora";
    const saldoIni = esDeudora
      ? Number(r.opening_debit || 0) - Number(r.opening_credit || 0)
      : Number(r.opening_credit || 0) - Number(r.opening_debit || 0);
    const debe = formatAmount(r.period_debit);
    const haber = formatAmount(r.period_credit);
    const saldoFin = esDeudora
      ? Number(r.closing_debit || 0) - Number(r.closing_credit || 0)
      : Number(r.closing_credit || 0) - Number(r.closing_debit || 0);
    return `    <BCE:Ctas NumCta="${xmlEscape(r.code)}" SaldoIni="${formatAmount(saldoIni)}" Debe="${debe}" Haber="${haber}" SaldoFin="${formatAmount(saldoFin)}"/>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<BCE:Balanza xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:BCE="http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/BalanzaComprobacion"
  xsi:schemaLocation="http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/BalanzaComprobacion http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/BalanzaComprobacion/BalanzaComprobacion_1_3.xsd"
  RFC="${xmlEscape(rfc)}" Mes="${pad2(month)}" Anio="${year}" TipoEnvio="N" Version="1.3">
${cuentas.join("\n")}
</BCE:Balanza>`;
}

// XML Polizas — PL_RFC_AAAAMM.xml
function buildJournalXml(entries: AccountingEntryRow[], lines: AccountingEntryLine[], rfc: string, year: number, month: number): string {
  const linesMap = new Map<string, AccountingEntryLine[]>();
  for (const l of lines) {
    if (!linesMap.has(l.entry_id)) linesMap.set(l.entry_id, []);
    linesMap.get(l.entry_id)!.push(l);
  }

  const polizas = entries.map((e) => {
    const tipo = e.entry_type === "ingreso" ? "I" : e.entry_type === "egreso" ? "E" : "D";
    const eLines = (linesMap.get(e.id) ?? []).map((l) => {
      const cfdiAttr = l.cfdi_uuid ? ` UUID="${xmlEscape(l.cfdi_uuid)}"` : "";
      return `        <PLZ:Transaccion NumCta="${xmlEscape(l.account_code)}" Concepto="${xmlEscape(l.description)}" Debe="${formatAmount(l.debit)}" Haber="${formatAmount(l.credit)}"${cfdiAttr}/>`;
    });
    return `    <PLZ:Poliza NumUnIdenPol="${xmlEscape(e.entry_number)}" Fecha="${e.entry_date}" Concepto="${xmlEscape(e.description)}" TipoPoliza="${tipo}">
${eLines.join("\n")}
    </PLZ:Poliza>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<PLZ:Polizas xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:PLZ="http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/PolizasPeriodo"
  xsi:schemaLocation="http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/PolizasPeriodo http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/PolizasPeriodo/PolizasPeriodo_1_3.xsd"
  RFC="${xmlEscape(rfc)}" Mes="${pad2(month)}" Anio="${year}" TipoSolicitud="AF" Version="1.3">
${polizas.join("\n")}
</PLZ:Polizas>`;
}

// Simple ZIP builder (stored, no compression) usando Web APIs
// Uint8Array<ArrayBuffer>, no Uint8Array a secas: desde que el tipo es
// generico, el default es Uint8Array<ArrayBufferLike> y BodyInit exige que el
// buffer sea un ArrayBuffer de verdad, asi que `new Response(zipBytes)` no
// compilaba. Todos los buffers de aqui salen de `new Uint8Array(n)`, que ya es
// Uint8Array<ArrayBuffer>; solo faltaba decirlo.
async function buildZip(files: { name: string; content: string }[]): Promise<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder();
  const localHeaders: Uint8Array[] = [];
  const centralHeaders: Uint8Array[] = [];
  let offset = 0;

  function u16le(n: number): Uint8Array {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n, true);
    return b;
  }
  function u32le(n: number): Uint8Array {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return b;
  }
  function concat(...arrays: Uint8Array[]): Uint8Array {
    const len = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(len);
    let pos = 0;
    for (const a of arrays) { out.set(a, pos); pos += a.length; }
    return out;
  }

  // CRC32 table
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[i] = c;
  }
  function crc32(data: Uint8Array): number {
    let crc = 0xFFFFFFFF;
    for (const b of data) crc = crcTable[(crc ^ b) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  for (const file of files) {
    const data = encoder.encode(file.content);
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(data);
    const size = data.length;

    const local = concat(
      new Uint8Array([0x50, 0x4B, 0x03, 0x04]), // signature
      u16le(20),   // version needed
      u16le(0),    // flags
      u16le(0),    // compression (stored)
      u16le(0), u16le(0), // mod time/date
      u32le(crc),
      u32le(size), u32le(size),
      u16le(nameBytes.length),
      u16le(0),    // extra length
      nameBytes,
      data,
    );

    const central = concat(
      new Uint8Array([0x50, 0x4B, 0x01, 0x02]), // signature
      u16le(20), u16le(20),
      u16le(0), u16le(0),
      u16le(0), u16le(0),
      u32le(crc),
      u32le(size), u32le(size),
      u16le(nameBytes.length),
      u16le(0), u16le(0), u16le(0), u16le(0),
      u32le(0),
      u32le(offset),
      nameBytes,
    );

    localHeaders.push(local);
    centralHeaders.push(central);
    offset += local.length;
  }

  const centralStart = offset;
  const centralSize = centralHeaders.reduce((s, a) => s + a.length, 0);

  function concat2(...arrays: Uint8Array[]): Uint8Array<ArrayBuffer> {
    const len = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(len);
    let pos = 0;
    for (const a of arrays) { out.set(a, pos); pos += a.length; }
    return out;
  }

  const eocd = concat2(
    new Uint8Array([0x50, 0x4B, 0x05, 0x06]),
    u16le(0), u16le(0),
    u16le(files.length), u16le(files.length),
    u32le(centralSize),
    u32le(centralStart),
    u16le(0),
  );

  return concat2(...localHeaders, ...centralHeaders, eocd);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userData } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (!userData || !["admin", "accountant"].includes(userData.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const year = parseInt(url.searchParams.get("year") ?? String(new Date().getFullYear()));
    const month = parseInt(url.searchParams.get("month") ?? String(new Date().getMonth() + 1));

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return new Response(JSON.stringify({ error: "Parametros year y month invalidos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Obtener RFC del emisor
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("pac_issuer_rfc")
      .maybeSingle();

    const rfc = settings?.pac_issuer_rfc ?? "TRG250711JWA";

    // 1. Catalogo de cuentas
    const { data: accounts, error: acctErr } = await supabase
      .from("chart_of_accounts")
      .select("code, sat_group_code, name, level, nature, account_type")
      .eq("is_active", true)
      .order("code");

    if (acctErr) throw acctErr;

    // 2. Balanza de comprobacion
    const { data: trialBalance, error: tbErr } = await supabase
      .rpc("get_trial_balance", { p_year: year, p_month: month });

    if (tbErr) throw tbErr;

    // 3. Polizas del periodo
    const { data: entries, error: entErr } = await supabase
      .from("accounting_entries")
      .select("id, entry_number, entry_type, entry_date, description")
      .eq("period_year", year)
      .eq("period_month", month)
      .eq("is_posted", true)
      .order("entry_date");

    if (entErr) throw entErr;

    let lines: AccountingEntryLine[] = [];
    if (entries && entries.length > 0) {
      const entryIds = entries.map((e) => e.id);
      const { data: linesData, error: linesErr } = await supabase
        .from("accounting_entry_lines")
        .select("entry_id, account_code, description, debit, credit, cfdi_uuid")
        .in("entry_id", entryIds)
        .order("line_number");

      if (linesErr) throw linesErr;
      lines = linesData ?? [];
    }

    const ym = `${year}${pad2(month)}`;
    const catalogXml = buildCatalogXml(accounts ?? [], rfc, year, month);
    const balanceXml = buildTrialBalanceXml(trialBalance ?? [], rfc, year, month);
    const journalXml = buildJournalXml(entries ?? [], lines, rfc, year, month);

    const zipBytes = await buildZip([
      { name: `CT_${rfc}_${ym}.xml`, content: catalogXml },
      { name: `BC_${rfc}_${ym}.xml`, content: balanceXml },
      { name: `PL_${rfc}_${ym}.xml`, content: journalXml },
    ]);

    return new Response(zipBytes, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="ContabilidadElectronica_${rfc}_${ym}.zip"`,
      },
    });
  } catch (err) {
    if (sentryDsn) {
      Sentry.captureException(err, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
