import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// =============================================
// ACCOUNTING PROVIDER INTERFACE (provider-agnostic)
// To add a new provider (Odoo, QuickBooks, etc.):
//   1. Implement the AccountingAdapter interface below
//   2. Add a case in the getAdapter() factory function
//   3. Update the accounting_provider check constraint in the DB
// =============================================

interface StandardContact {
  id: string;
  type: "agency" | "traveler";
  name: string;
  email?: string;
  phone?: string;
  rfc?: string;
  razon_social?: string;
  regimen_fiscal?: string;
  codigo_postal?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
}

interface StandardLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  tax_percentage?: number;
  account_key?: string;
}

interface StandardJournal {
  id: string;
  journal_type?: "income" | "vendor_payment"; // income = reservas (default), vendor_payment = pagos a agencias
  customer_id?: string;
  date: string;
  reference?: string;
  notes?: string;
  // Campos para journal de ingresos (reservas)
  tour_subtotal?: number;
  service_subtotal?: number;
  iva_total?: number;
  total?: number;
  // Campos para journal de egreso (pago a proveedor)
  net_amount?: number;       // monto neto pagado a agencia (sale del banco)
  commission_amount?: number; // comisión retenida por la plataforma
  gross_amount?: number;     // monto bruto (net + commission)
  currency?: string;
}

// Kept for adapter interface compatibility (Odoo/QuickBooks stubs)
interface StandardInvoice {
  id: string;
  contact_external_id: string;
  date: string;
  due_date?: string;
  currency?: string;
  reference?: string;
  notes?: string;
  line_items: StandardLineItem[];
  tax_total?: number;
  subtotal?: number;
  total: number;
  account_key?: string;
}

interface StandardBill {
  id: string;
  vendor_external_id: string;
  date: string;
  due_date?: string;
  currency?: string;
  reference?: string;
  notes?: string;
  line_items: StandardLineItem[];
  total: number;
  account_key?: string;
}

interface StandardExpense {
  id: string;
  vendor_external_id?: string;
  date: string;
  amount: number;
  currency?: string;
  reference?: string;
  notes?: string;
  account_key?: string;
}

interface StandardPayment {
  id: string;
  contact_external_id: string;
  invoice_external_id?: string;
  bill_external_id?: string;
  payment_type: "received" | "made";
  date: string;
  amount: number;
  currency?: string;
  payment_method?: string;
  reference?: string;
  bank_account_key?: string;
}

interface AccountingResult {
  external_entity_type: string;
  external_entity_id: string;
}

interface AccountingAdapter {
  syncContact(contact: StandardContact): Promise<AccountingResult>;
  syncJournal(journal: StandardJournal): Promise<AccountingResult>;
  syncInvoice(invoice: StandardInvoice): Promise<AccountingResult>;
  syncBill(bill: StandardBill): Promise<AccountingResult>;
  syncExpense(expense: StandardExpense): Promise<AccountingResult>;
  syncPayment(payment: StandardPayment): Promise<AccountingResult>;
  healthCheck(): Promise<boolean>;
}

// =============================================
// ZOHO BOOKS — Mexico tax regime mapper
// Maps SAT regimen fiscal codes/descriptions to Zoho Books enum values.
// Zoho allowed values (Mexico edition):
//   general_legal_person, legal_entities_non_profit, resident_abroad,
//   production_cooperative_societies, agricultural_livestock,
//   optional_group_of_companies, coordinated, simplified_trust,
//   wages_salaries_income, lease, property_disposal_acquisition,
//   other_income, divident_income, individual_business_professional,
//   interest_income, income_obtaining_price, no_tax_obligation,
//   tax_incorporation, income_through_technology_platform
// =============================================
function mapRegimenToZoho(regimen: string): string {
  if (!regimen) return "general_legal_person";
  const r = regimen.toLowerCase();

  // SAT code prefixes like "601", "612", etc.
  if (r.startsWith("601") || r.includes("general de ley personas morales")) return "general_legal_person";
  if (r.startsWith("603") || r.includes("personas morales con fines no lucrativos")) return "legal_entities_non_profit";
  if (r.startsWith("605") || r.includes("sueldos y salarios")) return "wages_salaries_income";
  if (r.startsWith("606") || r.includes("arrendamiento")) return "lease";
  if (r.startsWith("607") || r.includes("enajenación o adquisición de bienes")) return "property_disposal_acquisition";
  if (r.startsWith("608") || r.includes("demás ingresos")) return "other_income";
  if (r.startsWith("609") || r.includes("consolidación")) return "optional_group_of_companies";
  if (r.startsWith("610") || r.includes("residentes en el extranjero")) return "resident_abroad";
  if (r.startsWith("611") || r.includes("ingresos por dividendos")) return "divident_income";
  if (r.startsWith("612") || r.includes("personas físicas con actividades empresariales")) return "individual_business_professional";
  if (r.startsWith("614") || r.includes("ingresos por intereses")) return "interest_income";
  if (r.startsWith("615") || r.includes("régimen de los ingresos por obtención de premios")) return "income_obtaining_price";
  if (r.startsWith("616") || r.includes("sin obligaciones fiscales")) return "no_tax_obligation";
  if (r.startsWith("620") || r.includes("sociedades cooperativas de producción")) return "production_cooperative_societies";
  if (r.startsWith("621") || r.includes("incorporación fiscal")) return "tax_incorporation";
  if (r.startsWith("622") || r.includes("actividades agrícolas")) return "agricultural_livestock";
  if (r.startsWith("623") || r.includes("opcional para grupos de sociedades")) return "optional_group_of_companies";
  if (r.startsWith("624") || r.includes("coordinados")) return "coordinated";
  if (r.startsWith("625") || r.includes("plataformas tecnológicas") || r.includes("tecnologicas")) return "income_through_technology_platform";
  if (r.startsWith("626") || r.includes("simplificado de confianza")) return "simplified_trust";

  // Fallback: if the value is already a valid Zoho enum key, return it as-is
  const zohoValues = [
    "general_legal_person", "legal_entities_non_profit", "resident_abroad",
    "production_cooperative_societies", "agricultural_livestock",
    "optional_group_of_companies", "coordinated", "simplified_trust",
    "wages_salaries_income", "lease", "property_disposal_acquisition",
    "other_income", "divident_income", "individual_business_professional",
    "interest_income", "income_obtaining_price", "no_tax_obligation",
    "tax_incorporation", "income_through_technology_platform",
  ];
  if (zohoValues.includes(r)) return r;

  // Default for personas morales
  return "general_legal_person";
}

// =============================================
// ZOHO BOOKS ADAPTER
// =============================================

async function getZohoAccessToken(supabase: ReturnType<typeof createClient>): Promise<{ token: string; apiDomain: string }> {
  const { data: tokenRow } = await supabase
    .from("zoho_oauth_tokens")
    .select("access_token, refresh_token, access_token_expires_at, api_domain")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tokenRow) throw new Error("No Zoho OAuth token found. Please authorize Zoho Books in Admin Settings.");

  const expiresAt = new Date(tokenRow.access_token_expires_at).getTime();
  const nowMs = Date.now();
  const bufferMs = 5 * 60 * 1000;

  if (expiresAt - nowMs > bufferMs) {
    return { token: tokenRow.access_token, apiDomain: tokenRow.api_domain };
  }

  const { data: settings } = await supabase
    .from("platform_settings")
    .select("zoho_client_id, zoho_client_secret, zoho_region")
    .maybeSingle();

  if (!settings?.zoho_client_id || !settings?.zoho_client_secret) {
    throw new Error("Zoho client credentials not configured.");
  }

  const region = settings.zoho_region || "com";
  const tokenUrl = `https://accounts.zoho.${region}/oauth/v2/token`;

  const body = new URLSearchParams({
    refresh_token: tokenRow.refresh_token,
    client_id: settings.zoho_client_id,
    client_secret: settings.zoho_client_secret,
    grant_type: "refresh_token",
  });

  const res = await fetch(tokenUrl, { method: "POST", body });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Zoho token refresh failed: ${err}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error(`Zoho token refresh returned no access_token: ${JSON.stringify(data)}`);

  const newExpiry = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();
  const newApiDomain = data.api_domain ?? tokenRow.api_domain;

  await supabase.from("zoho_oauth_tokens").update({
    access_token: data.access_token,
    access_token_expires_at: newExpiry,
    api_domain: newApiDomain,
  }).eq("refresh_token", tokenRow.refresh_token);

  return { token: data.access_token, apiDomain: newApiDomain };
}

function createZohoBooksAdapter(supabase: ReturnType<typeof createClient>, orgId: string): AccountingAdapter {
  async function zhFetch(path: string, method: string, body?: unknown): Promise<unknown> {
    const { token, apiDomain } = await getZohoAccessToken(supabase);
    const separator = path.includes("?") ? "&" : "?";
    const url = `${apiDomain}/books/v3${path}${separator}organization_id=${orgId}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const rawText = await res.text();
      let zohoMessage = rawText;
      try {
        const parsed = JSON.parse(rawText);
        if (parsed.message) zohoMessage = parsed.message;
      } catch {
        // no es JSON, usar texto crudo
      }
      throw new Error(`Zoho Books: ${zohoMessage}`);
    }
    return res.json();
  }

  async function syncContact(contact: StandardContact): Promise<AccountingResult> {
    const contactType = contact.type === "agency" ? "vendor" : "customer";

    // Build contact_persons array — per Zoho Books API v3, email goes here
    const contactPersons: Record<string, unknown>[] = [];
    if (contact.email || contact.phone) {
      contactPersons.push({
        first_name: contact.name,
        email: contact.email || undefined,
        phone: contact.phone || undefined,
        is_primary_contact: true,
      });
    }

    const payload: Record<string, unknown> = {
      contact_name: contact.razon_social || contact.name,
      company_name: contact.razon_social || contact.name,
      contact_type: contactType,
      contact_persons: contactPersons,
      billing_address: {
        address: contact.address || undefined,
        city: contact.city || undefined,
        state: contact.state || undefined,
        zip: contact.codigo_postal || undefined,
        country: contact.country || "Mexico",
      },
    };

    // Mexico edition fields — only set when values exist
    // tax_treatment is required for tax_reg_no to work in Mexico edition
    // Allowed values: home_country_mexico, border_region_mexico, non_mexico
    payload.tax_treatment = "home_country_mexico";

    if (contact.rfc) {
      // Zoho Mexico edition expects the RFC as a string (12 chars for persona fisica, 13 for moral)
      payload.tax_reg_no = contact.rfc;
    }

    if (contact.razon_social) {
      payload.legal_name = contact.razon_social;
    }

    // tax_regime must be one of Zoho's enum values for Mexico edition.
    // Map the SAT regimen code/description to Zoho's enum value.
    if (contact.regimen_fiscal) {
      payload.tax_regime = mapRegimenToZoho(contact.regimen_fiscal);
    }

    const recordType = contact.type === "agency" ? "contact_agency" : "contact_traveler";

    // 1) Buscar en log local con status synced
    const { data: existingLog } = await supabase
      .from("accounting_sync_log")
      .select("external_entity_id")
      .eq("record_type", recordType)
      .eq("record_id", contact.id)
      .eq("status", "synced")
      .maybeSingle();

    if (existingLog?.external_entity_id) {
      await zhFetch(`/contacts/${existingLog.external_entity_id}`, "PUT", payload);
      return { external_entity_type: "Contact", external_entity_id: existingLog.external_entity_id };
    }

    // 2) Buscar en Zoho por nombre de contacto para recuperar contact_id si ya existe
    // La API de Zoho Books usa contact_name como identificador de unicidad y es el campo
    // correcto para buscar — search_text solo busca en nombre y notas (no en RFC/tax_reg_no)
    let existingContactId: string | null = null;

    const contactName = (contact.razon_social || contact.name).trim();
    const nameSearch = await zhFetch(
      `/contacts?contact_name=${encodeURIComponent(contactName)}`,
      "GET"
    ) as { contacts?: { contact_id: string; contact_name: string; contact_type?: string; tax_reg_no?: string }[] };

    if (nameSearch.contacts && nameSearch.contacts.length > 0) {
      // Filtrar por tipo en cliente (no como query param para evitar errores de Zoho)
      const candidates = nameSearch.contacts.filter((c) => c.contact_type === contactType);
      // Si hay RFC, preferir coincidencia exacta por RFC; si no, tomar el primero por nombre
      const byRfc = contact.rfc ? candidates.find((c) => c.tax_reg_no === contact.rfc) : null;
      const byName = candidates.find(
        (c) => c.contact_name.trim().toLowerCase() === contactName.toLowerCase()
      );
      existingContactId = (byRfc ?? byName)?.contact_id ?? null;
    }

    if (existingContactId) {
      // Contacto existe en Zoho pero no estaba en nuestro log — actualizar y guardar ID
      await zhFetch(`/contacts/${existingContactId}`, "PUT", payload);
      // Persistir en log local para evitar busquedas futuras
      await supabase.from("accounting_sync_log").upsert({
        provider: "zoho_books",
        record_type: recordType,
        record_id: contact.id,
        status: "synced",
        external_entity_type: "Contact",
        external_entity_id: existingContactId,
        synced_at: new Date().toISOString(),
      }, { onConflict: "provider,record_type,record_id" });
      return { external_entity_type: "Contact", external_entity_id: existingContactId };
    }

    // 4) No existe en Zoho — crear nuevo
    const data = await zhFetch("/contacts", "POST", payload) as { contact: { contact_id: string } };
    return { external_entity_type: "Contact", external_entity_id: data.contact.contact_id };
  }

  // Cache de account_ids dentro de la vida de la función para evitar llamadas repetidas
  let cachedAccounts: {
    ar: string; sales: string; service: string; iva: string;
    ap: string; bank: string; commissions: string;
  } | null = null;

  async function resolveAccountIds(): Promise<{
    ar: string; sales: string; service: string; iva: string;
    ap: string; bank: string; commissions: string;
  }> {
    if (cachedAccounts) return cachedAccounts;

    const result = await zhFetch("/chartofaccounts", "GET") as {
      chartofaccounts?: { account_id: string; account_name: string; account_type: string }[];
    };

    const accounts = result.chartofaccounts ?? [];

    // Cuentas por Cobrar (ingresos)
    const arAccount = accounts.find((a) =>
      a.account_type === "accounts_receivable" ||
      a.account_name.toLowerCase().includes("cuentas por cobrar") ||
      a.account_name.toLowerCase().includes("accounts receivable")
    );

    // Ventas / Ingresos por Tours
    const salesAccount = accounts.find((a) =>
      a.account_name.toLowerCase().includes("ventas") ||
      a.account_name.toLowerCase().includes("ingresos por tours") ||
      a.account_name.toLowerCase().includes("sales") ||
      a.account_type === "income"
    );

    // Cargo por Servicio / Comisiones de plataforma
    const serviceAccount = accounts.find((a) =>
      a.account_name.toLowerCase().includes("cargo por servicio") ||
      a.account_name.toLowerCase().includes("comision") ||
      a.account_name.toLowerCase().includes("plataforma") ||
      a.account_name.toLowerCase().includes("service fee") ||
      a.account_name.toLowerCase().includes("service charge")
    ) ?? salesAccount;

    // IVA Trasladado / Tax Payable
    const ivaAccount = accounts.find((a) =>
      a.account_name.toLowerCase().includes("iva trasladado") ||
      a.account_name.toLowerCase().includes("iva por pagar") ||
      a.account_name.toLowerCase().includes("tax payable") ||
      a.account_name.toLowerCase().includes("impuesto")
    );

    // Cuentas por Pagar Agencias (egresos — para journal de pago a proveedor)
    const apAccount = accounts.find((a) =>
      a.account_type === "accounts_payable" ||
      a.account_name.toLowerCase().includes("cuentas por pagar") ||
      a.account_name.toLowerCase().includes("accounts payable")
    );

    // Banco Principal (sale el efectivo al pagar a agencia)
    const bankAccount = accounts.find((a) =>
      a.account_type === "bank" ||
      a.account_name.toLowerCase().includes("banco") ||
      a.account_name.toLowerCase().includes("bank")
    );

    // Pagos a Agencias / Comisiones (gasto por pago a agencia)
    // Busca por nombre específico; si no existe la cuenta en el plan lanza error descriptivo
    const commissionsAccount = accounts.find((a) =>
      a.account_name.toLowerCase().includes("pagos a agencias") ||
      a.account_name.toLowerCase().includes("comisiones a agencias") ||
      a.account_name.toLowerCase().includes("comisiones pagadas") ||
      (a.account_type === "expense" && a.account_name.toLowerCase().includes("agencia")) ||
      (a.account_type === "expense" && a.account_name.toLowerCase().includes("comision"))
    );

    if (!arAccount) throw new Error("No se encontró cuenta de Cuentas por Cobrar en el Plan de Cuentas de Zoho Books.");
    if (!salesAccount) throw new Error("No se encontró cuenta de Ventas/Ingresos en el Plan de Cuentas de Zoho Books.");
    if (!ivaAccount) throw new Error("No se encontró cuenta de IVA Trasladado en el Plan de Cuentas de Zoho Books.");
    if (!apAccount) throw new Error("No se encontró cuenta de Cuentas por Pagar en el Plan de Cuentas de Zoho Books.");
    if (!bankAccount) throw new Error("No se encontró cuenta Bancaria en el Plan de Cuentas de Zoho Books.");
    if (!commissionsAccount) throw new Error("No se encontró cuenta de Pagos a Agencias en el Plan de Cuentas de Zoho Books. Crea una cuenta de tipo Gasto con el nombre 'Pagos a Agencias'.");

    cachedAccounts = {
      ar: arAccount.account_id,
      sales: salesAccount.account_id,
      service: serviceAccount!.account_id,
      iva: ivaAccount.account_id,
      ap: apAccount.account_id,
      bank: bankAccount.account_id,
      commissions: commissionsAccount.account_id,
    };

    return cachedAccounts;
  }

  async function syncJournal(journal: StandardJournal): Promise<AccountingResult> {
    const accounts = await resolveAccountIds();

    type JournalLineItem = { account_id: string; description: string; debit_or_credit: string; amount: number; customer_id?: string };
    let lineItems: JournalLineItem[];

    if (journal.journal_type === "vendor_payment") {
      // Asiento de egreso directo: pago a agencia
      // Debe:  Pagos a Agencias (gasto)    — importe bruto (neto + comisión)
      // Haber: Banco                       — importe neto pagado a la agencia
      // Haber: Cargo por Servicio/Ingresos — comisión retenida por la plataforma
      const netAmount = Math.round((journal.net_amount ?? 0) * 100) / 100;
      const commissionAmount = Math.round((journal.commission_amount ?? 0) * 100) / 100;
      const grossAmount = Math.round((journal.gross_amount ?? netAmount + commissionAmount) * 100) / 100;

      lineItems = [
        {
          account_id: accounts.commissions,
          description: journal.notes || "Pago a agencia por tours realizados",
          debit_or_credit: "debit",
          amount: grossAmount,
        },
        {
          account_id: accounts.bank,
          description: "Monto neto pagado a agencia",
          debit_or_credit: "credit",
          amount: netAmount,
        },
      ];

      if (commissionAmount > 0) {
        lineItems.push({
          account_id: accounts.service,
          description: "Comision plataforma ToursRed retenida",
          debit_or_credit: "credit",
          amount: commissionAmount,
        });
      }
    } else {
      // Asiento de ingreso: reserva de viajero (comportamiento original)
      const tourSubtotal = journal.tour_subtotal ?? 0;
      const serviceSubtotal = journal.service_subtotal ?? 0;
      const ivaTotal = journal.iva_total ?? 0;
      const total = tourSubtotal + serviceSubtotal + ivaTotal;

      lineItems = [
        {
          account_id: accounts.ar,
          description: journal.notes || "Venta de servicio de viaje",
          debit_or_credit: "debit",
          amount: Math.round(total * 100) / 100,
          ...(journal.customer_id ? { customer_id: journal.customer_id } : {}),
        },
      ];

      if (tourSubtotal > 0) {
        lineItems.push({
          account_id: accounts.sales,
          description: "Ingresos por tours",
          debit_or_credit: "credit",
          amount: Math.round(tourSubtotal * 100) / 100,
        });
      }

      if (serviceSubtotal > 0) {
        lineItems.push({
          account_id: accounts.service,
          description: "Cargo por servicio de plataforma",
          debit_or_credit: "credit",
          amount: Math.round(serviceSubtotal * 100) / 100,
        });
      }

      if (ivaTotal > 0) {
        lineItems.push({
          account_id: accounts.iva,
          description: "IVA Trasladado 16%",
          debit_or_credit: "credit",
          amount: Math.round(ivaTotal * 100) / 100,
        });
      }
    }

    const payload = {
      journal_date: journal.date,
      reference_number: journal.reference,
      notes: journal.notes,
      currency_code: journal.currency || "MXN",
      exchange_rate: 1,
      status: "published",
      line_items: lineItems,
    };

    const data = await zhFetch("/journals", "POST", payload) as { journal: { journal_id: string } };
    return { external_entity_type: "Journal", external_entity_id: data.journal.journal_id };
  }

  // syncInvoice conservado para compatibilidad con adaptadores Odoo/QuickBooks
  async function syncInvoice(invoice: StandardInvoice): Promise<AccountingResult> {
    const payload = {
      customer_id: invoice.contact_external_id,
      date: invoice.date,
      due_date: invoice.due_date,
      currency_code: invoice.currency || "MXN",
      reference_number: invoice.reference,
      notes: invoice.notes,
      line_items: invoice.line_items.map((item) => ({
        name: item.description,
        description: item.description,
        quantity: item.quantity,
        rate: item.unit_price,
        tax_percentage: item.tax_percentage ?? 16,
        account_id: item.account_key,
      })),
    };

    const data = await zhFetch("/invoices", "POST", payload) as { invoice: { invoice_id: string } };
    return { external_entity_type: "Invoice", external_entity_id: data.invoice.invoice_id };
  }

  async function syncBill(bill: StandardBill): Promise<AccountingResult> {
    const accounts = await resolveAccountIds();

    // Mapeo de account_key semántico → account_id real de Zoho
    const accountKeyMap: Record<string, string> = {
      comisiones_agencias: accounts.commissions,
      sales: accounts.sales,
      service: accounts.service,
      ar: accounts.ar,
      ap: accounts.ap,
      bank: accounts.bank,
    };

    const payload: Record<string, unknown> = {
      vendor_id: bill.vendor_external_id,
      date: bill.date,
      due_date: bill.due_date,
      currency_code: bill.currency || "MXN",
      notes: bill.notes,
      line_items: bill.line_items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        rate: item.unit_price,
        account_id: item.account_key
          ? (accountKeyMap[item.account_key] ?? item.account_key)
          : accounts.commissions,
      })),
    };

    // Zoho Books distingue bill_number (número de factura del proveedor) y reference_number
    // (referencia interna). El error "Invalid value for bill_number" ocurre cuando se usa
    // reference_number para lo que debería ir en bill_number.
    // Solo se envía bill_number cuando el valor viene desde el campo bill_number del payout.
    if (bill.reference) {
      payload.bill_number = bill.reference.slice(0, 32);
    }

    const data = await zhFetch("/bills", "POST", payload) as { bill: { bill_id: string } };
    return { external_entity_type: "Bill", external_entity_id: data.bill.bill_id };
  }

  async function syncExpense(expense: StandardExpense): Promise<AccountingResult> {
    const accounts = await resolveAccountIds();

    const accountKeyMap: Record<string, string> = {
      comisiones_agencias: accounts.commissions,
      sales: accounts.sales,
      service: accounts.service,
      ar: accounts.ar,
      ap: accounts.ap,
      bank: accounts.bank,
    };

    const accountId = expense.account_key
      ? (accountKeyMap[expense.account_key] ?? expense.account_key)
      : accounts.commissions;

    const payload: Record<string, unknown> = {
      account_id: accountId,
      paid_through_account_id: accounts.bank,
      date: expense.date,
      amount: expense.amount,
      currency_code: expense.currency || "MXN",
      description: expense.notes,
    };

    if (expense.vendor_external_id) {
      payload.vendor_id = expense.vendor_external_id;
    }

    if (expense.reference) {
      payload.reference_number = expense.reference.slice(0, 32);
    }

    const data = await zhFetch("/expenses", "POST", payload) as { expense: { expense_id: string } };
    return { external_entity_type: "Expense", external_entity_id: data.expense.expense_id };
  }

  async function syncPayment(payment: StandardPayment): Promise<AccountingResult> {
    if (payment.payment_type === "received") {
      const payload = {
        customer_id: payment.contact_external_id,
        payment_mode: payment.payment_method || "online",
        amount: payment.amount,
        date: payment.date,
        reference_number: payment.reference,
        invoices: payment.invoice_external_id
          ? [{ invoice_id: payment.invoice_external_id, amount_applied: payment.amount }]
          : [],
      };
      const data = await zhFetch("/customerpayments", "POST", payload) as { payment: { payment_id: string } };
      return { external_entity_type: "CustomerPayment", external_entity_id: data.payment.payment_id };
    } else {
      const payload = {
        vendor_id: payment.contact_external_id,
        payment_mode: payment.payment_method || "online",
        amount: payment.amount,
        date: payment.date,
        reference_number: payment.reference,
        bills: payment.bill_external_id
          ? [{ bill_id: payment.bill_external_id, amount_applied: payment.amount }]
          : [],
      };
      const data = await zhFetch("/vendorpayments", "POST", payload) as { payment: { payment_id: string } };
      return { external_entity_type: "VendorPayment", external_entity_id: data.payment.payment_id };
    }
  }

  async function healthCheck(): Promise<boolean> {
    try {
      await zhFetch("/organizations", "GET");
      return true;
    } catch {
      return false;
    }
  }

  return { syncContact, syncJournal, syncInvoice, syncBill, syncExpense, syncPayment, healthCheck };
}

// =============================================
// ODOO ADAPTER — JSON-2 API (Odoo 19+)
// Docs: https://www.odoo.com/documentation/19.0/developer/reference/external_api.html
// =============================================
function createOdooAdapter(config: { url: string; apiKey: string; database: string }): AccountingAdapter {
  const baseUrl = config.url.replace(/\/$/, "");

  async function odooFetch(model: string, method: string, body: Record<string, unknown>): Promise<unknown> {
    const url = `${baseUrl}/json/2/${model}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `bearer ${config.apiKey}`,
        "Content-Type": "application/json; charset=utf-8",
        "X-Odoo-Database": config.database,
        "User-Agent": "ToursRed/1.0",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Odoo ${model}/${method} ${res.status}: ${errBody}`);
    }
    return res.json();
  }

  // Cache del ID de México y MXN resueltos dinámicamente
  let cachedMexicoId: number | null = null;
  let cachedMxnCurrencyId: number | null = null;

  async function resolveMexicoCountryId(): Promise<number> {
    if (cachedMexicoId) return cachedMexicoId;
    const result = await odooFetch("res.country", "search_read", {
      domain: [["code", "=", "MX"]],
      fields: ["id"],
      limit: 1,
    }) as { id: number }[];
    if (!result.length) throw new Error("No se encontró México (code=MX) en res.country de Odoo");
    cachedMexicoId = result[0].id;
    return cachedMexicoId;
  }

  async function resolveMxnCurrencyId(): Promise<number> {
    if (cachedMxnCurrencyId) return cachedMxnCurrencyId;
    const result = await odooFetch("res.currency", "search_read", {
      domain: [["name", "=", "MXN"]],
      fields: ["id"],
      limit: 1,
    }) as { id: number }[];
    if (!result.length) throw new Error("No se encontró la moneda MXN en res.currency de Odoo");
    cachedMxnCurrencyId = result[0].id;
    return cachedMxnCurrencyId;
  }

  // Cache de IDs de cuentas contables dentro de la vida de la función
  let cachedOdooAccounts: {
    ar: number;      // Cuentas por Cobrar (receivable)
    sales: number;   // Ingresos / Ventas
    service: number; // Cargos por servicio / ingresos de plataforma
    iva: number;     // IVA trasladado
    ap: number;      // Cuentas por Pagar (payable)
    bank: number;    // Banco / Efectivo
    commissions: number; // Gasto - Pagos a Agencias
  } | null = null;

  async function resolveOdooAccountIds() {
    if (cachedOdooAccounts) return cachedOdooAccounts;

    const accounts = await odooFetch("account.account", "search_read", {
      domain: [],
      fields: ["id", "code", "name", "account_type"],
    }) as { id: number; code: string; name: string; account_type: string }[];

    const find = (types: string[], keywords: string[]): number | undefined => {
      const byType = accounts.filter(a => types.includes(a.account_type));
      for (const kw of keywords) {
        const match = byType.find(a =>
          a.name.toLowerCase().includes(kw.toLowerCase()) ||
          a.code.toLowerCase().startsWith(kw.toLowerCase())
        );
        if (match) return match.id;
      }
      return byType[0]?.id;
    };

    const ar = find(["asset_receivable"], ["cobrar", "receivable", "cliente", "101", "113"]);
    const sales = find(["income", "income_other"], ["venta", "ingreso", "sales", "revenue", "400", "401"]);
    const service = find(["income", "income_other"], ["servicio", "cargo", "comision", "service", "platform", "402", "403"]);
    const iva = find(["liability_current", "tax"], ["iva", "impuesto", "tax", "211"]);
    const ap = find(["liability_payable"], ["pagar", "payable", "proveedor", "201", "210"]);
    const bank = find(["asset_cash", "asset_current"], ["banco", "bank", "caja", "efectivo", "cash", "102", "110"]);
    const commissions = find(["expense"], ["agencia", "pago", "comision", "proveedor", "commission", "600", "601", "602"]);

    const missing = [
      !ar && "Cuentas por Cobrar (receivable)",
      !sales && "Ventas/Ingresos (income)",
      !ap && "Cuentas por Pagar (payable)",
      !bank && "Banco/Efectivo (asset_cash)",
      !commissions && "Pagos a Agencias (expense)",
    ].filter(Boolean);

    if (missing.length > 0) {
      throw new Error(`Odoo: No se encontraron cuentas contables requeridas: ${missing.join(", ")}`);
    }

    cachedOdooAccounts = {
      ar: ar!,
      sales: sales ?? ar!,
      service: service ?? (sales ?? ar!),
      iva: iva ?? ap!,
      ap: ap!,
      bank: bank!,
      commissions: commissions!,
    };
    return cachedOdooAccounts;
  }

  async function syncContact(contact: StandardContact): Promise<AccountingResult> {
    const isCompany = contact.type === "agency";
    const mexicoId = await resolveMexicoCountryId();
    const payload = {
      name: contact.razon_social || contact.name,
      email: contact.email ?? false,
      phone: contact.phone ?? false,
      is_company: isCompany,
      customer_rank: contact.type === "traveler" ? 1 : 0,
      supplier_rank: contact.type === "agency" ? 1 : 0,
      vat: contact.rfc ?? false,
      ref: contact.id,
      street: contact.address ?? false,
      city: contact.city ?? false,
      zip: contact.codigo_postal ?? false,
      country_id: mexicoId,
    };

    // Buscar por referencia interna (ref = nuestro UUID)
    const existing = await odooFetch("res.partner", "search_read", {
      domain: [["ref", "=", contact.id]],
      fields: ["id"],
      limit: 1,
    }) as { id: number }[];

    if (existing.length > 0) {
      await odooFetch("res.partner", "write", {
        ids: [existing[0].id],
        vals: payload,
      });
      return { external_entity_type: "Partner", external_entity_id: String(existing[0].id) };
    }

    const created = await odooFetch("res.partner", "create", { vals_list: [payload] }) as number[];
    const newId = Array.isArray(created) ? created[0] : created;
    return { external_entity_type: "Partner", external_entity_id: String(newId) };
  }

  async function syncJournal(journal: StandardJournal): Promise<AccountingResult> {
    const accounts = await resolveOdooAccountIds();
    const moveDate = journal.date;
    const ref = journal.reference || journal.id;

    let lineItems: { account_id: number; name: string; debit: number; credit: number }[];

    if (journal.journal_type === "vendor_payment") {
      const netAmount = Math.round((journal.net_amount ?? 0) * 100) / 100;
      const commissionAmount = Math.round((journal.commission_amount ?? 0) * 100) / 100;
      const grossAmount = Math.round((journal.gross_amount ?? netAmount + commissionAmount) * 100) / 100;

      lineItems = [
        { account_id: accounts.commissions, name: journal.notes || "Pago a agencia por tours realizados", debit: grossAmount, credit: 0 },
        { account_id: accounts.bank, name: "Monto neto pagado a agencia", debit: 0, credit: netAmount },
      ];
      if (commissionAmount > 0) {
        lineItems.push({ account_id: accounts.service, name: "Comision plataforma ToursRed retenida", debit: 0, credit: commissionAmount });
      }
    } else {
      // income: reserva de tour
      const tourSubtotal = Math.round((journal.tour_subtotal ?? 0) * 100) / 100;
      const serviceSubtotal = Math.round((journal.service_subtotal ?? 0) * 100) / 100;
      const ivaTotal = Math.round((journal.iva_total ?? 0) * 100) / 100;
      // Usar la suma exacta de componentes como debito para garantizar balance
      const creditTotal = Math.round((tourSubtotal + serviceSubtotal + ivaTotal) * 100) / 100;

      lineItems = [
        { account_id: accounts.ar, name: journal.notes || "Reserva de tour", debit: creditTotal, credit: 0 },
      ];
      if (tourSubtotal > 0) {
        lineItems.push({ account_id: accounts.sales, name: "Tour / Actividad", debit: 0, credit: tourSubtotal });
      }
      if (serviceSubtotal > 0) {
        lineItems.push({ account_id: accounts.service, name: "Cargo por servicio plataforma", debit: 0, credit: serviceSubtotal });
      }
      if (ivaTotal > 0) {
        lineItems.push({ account_id: accounts.iva, name: "IVA", debit: 0, credit: ivaTotal });
      }
    }

    const createdMove = await odooFetch("account.move", "create", {
      vals_list: [{
        move_type: "entry",
        date: moveDate,
        ref,
        narration: journal.notes ?? "",
        line_ids: lineItems.map(l => [0, 0, {
          account_id: l.account_id,
          name: l.name,
          debit: l.debit,
          credit: l.credit,
        }]),
      }],
    }) as number[];
    const moveId = Array.isArray(createdMove) ? createdMove[0] : createdMove;

    // Confirmar el asiento (pasar a estado "posted")
    await odooFetch("account.move", "action_post", { ids: [moveId] });

    return { external_entity_type: "JournalEntry", external_entity_id: String(moveId) };
  }

  async function syncInvoice(invoice: StandardInvoice): Promise<AccountingResult> {
    const lines = invoice.line_items.map(li => [0, 0, {
      name: li.description,
      quantity: li.quantity,
      price_unit: li.unit_price,
    }]);

    const mxnId = await resolveMxnCurrencyId();
    const createdInvoice = await odooFetch("account.move", "create", {
      vals_list: [{
        move_type: "out_invoice",
        partner_id: Number(invoice.contact_external_id),
        invoice_date: invoice.date,
        invoice_date_due: invoice.due_date ?? invoice.date,
        ref: invoice.reference ?? "",
        narration: invoice.notes ?? "",
        currency_id: mxnId,
        invoice_line_ids: lines,
      }],
    }) as number[];
    const moveId = Array.isArray(createdInvoice) ? createdInvoice[0] : createdInvoice;

    await odooFetch("account.move", "action_post", { ids: [moveId] });
    return { external_entity_type: "Invoice", external_entity_id: String(moveId) };
  }

  async function syncBill(bill: StandardBill): Promise<AccountingResult> {
    const lines = bill.line_items.map(li => [0, 0, {
      name: li.description,
      quantity: li.quantity,
      price_unit: li.unit_price,
    }]);

    const mxnId = await resolveMxnCurrencyId();
    const createdBill = await odooFetch("account.move", "create", {
      vals_list: [{
        move_type: "in_invoice",
        partner_id: Number(bill.vendor_external_id),
        invoice_date: bill.date,
        invoice_date_due: bill.due_date ?? bill.date,
        ref: bill.reference ?? "",
        narration: bill.notes ?? "",
        currency_id: mxnId,
        invoice_line_ids: lines,
      }],
    }) as number[];
    const moveId = Array.isArray(createdBill) ? createdBill[0] : createdBill;

    await odooFetch("account.move", "action_post", { ids: [moveId] });
    return { external_entity_type: "Bill", external_entity_id: String(moveId) };
  }

  async function syncExpense(expense: StandardExpense): Promise<AccountingResult> {
    const accounts = await resolveOdooAccountIds();
    const amount = Math.round(expense.amount * 100) / 100;

    const createdExpense = await odooFetch("account.move", "create", {
      vals_list: [{
        move_type: "entry",
        date: expense.date,
        ref: expense.reference ?? expense.id,
        narration: expense.notes ?? "",
        line_ids: [
          [0, 0, { account_id: accounts.commissions, name: expense.notes || "Gasto", debit: amount, credit: 0 }],
          [0, 0, { account_id: accounts.bank, name: "Pago efectuado", debit: 0, credit: amount }],
        ],
      }],
    }) as number[];
    const moveId = Array.isArray(createdExpense) ? createdExpense[0] : createdExpense;

    await odooFetch("account.move", "action_post", { ids: [moveId] });
    return { external_entity_type: "Expense", external_entity_id: String(moveId) };
  }

  async function syncPayment(payment: StandardPayment): Promise<AccountingResult> {
    const isOutbound = payment.payment_type === "made";
    const createdPayment = await odooFetch("account.payment", "create", {
      vals_list: [{
        payment_type: isOutbound ? "outbound" : "inbound",
        partner_type: isOutbound ? "supplier" : "customer",
        partner_id: Number(payment.contact_external_id),
        amount: payment.amount,
        date: payment.date,
        ref: payment.reference ?? "",
      }],
    }) as number[];
    const paymentId = Array.isArray(createdPayment) ? createdPayment[0] : createdPayment;

    await odooFetch("account.payment", "action_post", { ids: [paymentId] });
    return { external_entity_type: "Payment", external_entity_id: String(paymentId) };
  }

  async function healthCheck(): Promise<boolean> {
    try {
      await odooFetch("res.users", "search_read", {
        domain: [["id", "=", 1]],
        fields: ["name"],
        limit: 1,
      });
      return true;
    } catch {
      return false;
    }
  }

  return { syncContact, syncJournal, syncInvoice, syncBill, syncExpense, syncPayment, healthCheck };
}

// =============================================
// QUICKBOOKS ADAPTER (stub — implement when needed)
// =============================================
function createQuickBooksAdapter(_config: { clientId: string; clientSecret: string; realmId: string }): AccountingAdapter {
  async function notImplemented(_name: string): Promise<AccountingResult> {
    throw new Error(`QuickBooks adapter: ${_name} not yet implemented. See sync-to-accounting/index.ts`);
  }
  return {
    syncContact: (_c) => notImplemented("syncContact"),
    syncJournal: (_j) => notImplemented("syncJournal"),
    syncInvoice: (_i) => notImplemented("syncInvoice"),
    syncBill: (_b) => notImplemented("syncBill"),
    syncExpense: (_e) => notImplemented("syncExpense"),
    syncPayment: (_p) => notImplemented("syncPayment"),
    healthCheck: async () => false,
  };
}

// =============================================
// ACCOUNTING PROVIDER FACTORY (dispatcher)
// Add new providers here as a new case
// =============================================
async function getAdapter(
  provider: string,
  supabase: ReturnType<typeof createClient>,
  settings: Record<string, string>
): Promise<AccountingAdapter> {
  switch (provider) {
    case "zoho_books":
      if (!settings.zoho_org_id) throw new Error("Zoho org_id not configured in platform_settings.");
      return createZohoBooksAdapter(supabase, settings.zoho_org_id);

    case "odoo":
      if (!settings.odoo_url || !settings.odoo_api_key_encrypted || !settings.odoo_database) {
        throw new Error("Odoo credentials (odoo_url, odoo_api_key_encrypted, odoo_database) not configured.");
      }
      return createOdooAdapter({ url: settings.odoo_url, apiKey: settings.odoo_api_key_encrypted, database: settings.odoo_database });

    case "quickbooks":
      if (!settings.qb_client_id || !settings.qb_client_secret || !settings.qb_realm_id) {
        throw new Error("QuickBooks credentials not configured.");
      }
      return createQuickBooksAdapter({ clientId: settings.qb_client_id, clientSecret: settings.qb_client_secret, realmId: settings.qb_realm_id });

    default:
      throw new Error(`Unknown accounting provider: ${provider}. Supported: zoho_books, odoo, quickbooks`);
  }
}

// =============================================
// SYNC LOG HELPERS
// =============================================
async function logSync(
  supabase: ReturnType<typeof createClient>,
  provider: string,
  recordType: string,
  recordId: string,
  status: "pending" | "synced" | "error" | "skipped",
  result?: AccountingResult,
  errorMessage?: string,
  payloadSummary?: Record<string, unknown>
): Promise<string> {
  const { data } = await supabase
    .from("accounting_sync_log")
    .upsert({
      provider,
      record_type: recordType,
      record_id: recordId,
      status,
      external_entity_type: result?.external_entity_type,
      external_entity_id: result?.external_entity_id,
      error_message: errorMessage,
      synced_at: status === "synced" ? new Date().toISOString() : null,
      payload_summary: payloadSummary,
    }, { onConflict: "provider,record_type,record_id", ignoreDuplicates: false })
    .select("id")
    .maybeSingle();
  return data?.id ?? "";
}

async function incrementRetryCount(supabase: ReturnType<typeof createClient>, provider: string, recordType: string, recordId: string) {
  const { error } = await supabase.rpc("increment_accounting_sync_retry_count" as never, {
    p_provider: provider,
    p_record_type: recordType,
    p_record_id: recordId,
  });
  if (error) {
    // Fallback: read current count and increment manually
    const { data } = await supabase
      .from("accounting_sync_log")
      .select("retry_count")
      .eq("provider", provider)
      .eq("record_type", recordType)
      .eq("record_id", recordId)
      .maybeSingle();
    const current = (data?.retry_count ?? 0) + 1;
    await supabase
      .from("accounting_sync_log")
      .update({ retry_count: current })
      .eq("provider", provider)
      .eq("record_type", recordType)
      .eq("record_id", recordId);
  }
}

// =============================================
// MAIN HANDLER
// Accepts: { action, record_type, record_id, data }
// action: "sync_contact" | "sync_invoice" | "sync_bill" | "sync_expense" | "sync_payment" | "health_check" | "retry_errors"
// =============================================
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { action, record_type, record_id, data: payload } = await req.json();

    if (!action) {
      return new Response(JSON.stringify({ error: "action is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: settings } = await supabase
      .from("platform_settings")
      .select("accounting_provider, accounting_sync_enabled, zoho_org_id, zoho_region, zoho_sandbox_mode, odoo_url, odoo_api_key_encrypted, odoo_database")
      .maybeSingle();

    if (action === "health_check") {
      if (!settings?.accounting_provider || settings.accounting_provider === "none") {
        return new Response(JSON.stringify({ healthy: false, message: "No accounting provider configured" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      try {
        const adapter = await getAdapter(settings.accounting_provider, supabase, settings as Record<string, string>);
        const healthy = await adapter.healthCheck();
        return new Response(JSON.stringify({ healthy, provider: settings.accounting_provider }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ healthy: false, error: String(e) }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (!settings?.accounting_sync_enabled || settings.accounting_provider === "none") {
      return new Response(JSON.stringify({ skipped: true, reason: "Accounting sync disabled or no provider configured" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const provider = settings.accounting_provider;
    const adapter = await getAdapter(provider, supabase, settings as Record<string, string>);

    if (action === "retry_errors") {
      const { data: errorRecords } = await supabase
        .from("accounting_sync_log")
        .select("*")
        .eq("provider", provider)
        .eq("status", "error")
        .lt("retry_count", 5)
        .order("created_at", { ascending: true })
        .limit(50);

      let retried = 0, succeeded = 0, failed = 0;
      for (const rec of errorRecords ?? []) {
        retried++;
        try {
          await supabase.functions.invoke("sync-to-accounting", {
            body: { action: `sync_${rec.record_type.replace("contact_agency", "contact").replace("contact_traveler", "contact")}`, record_type: rec.record_type, record_id: rec.record_id },
          });
          succeeded++;
        } catch {
          failed++;
        }
      }
      return new Response(JSON.stringify({ retried, succeeded, failed }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!record_id) {
      return new Response(JSON.stringify({ error: "record_id is required for sync actions" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let result: AccountingResult;
    let recType = "contact_agency";
    let payloadSummary: Record<string, unknown> = {};

    switch (action) {
      case "sync_contact": {
        if (!payload) throw new Error("payload (StandardContact) is required for sync_contact");
        recType = record_type || "contact_agency";
        payloadSummary = { name: payload.name, email: payload.email, rfc: payload.rfc };
        break;
      }
      case "sync_journal": {
        if (!payload) throw new Error("payload (StandardJournal) is required for sync_journal");
        // vendor_payment journals usan record_type "payout_journal" para no colisionar con journals de reservas
        recType = payload.journal_type === "vendor_payment" ? "payout_journal" : "booking";
        payloadSummary = { total: payload.total ?? payload.gross_amount, reference: payload.reference };
        break;
      }
      case "sync_invoice": {
        if (!payload) throw new Error("payload (StandardInvoice) is required for sync_invoice");
        recType = "booking";
        payloadSummary = { total: payload.total, reference: payload.reference };
        break;
      }
      case "sync_bill": {
        if (!payload) throw new Error("payload (StandardBill) is required for sync_bill");
        recType = "payout";
        payloadSummary = { total: payload.total, reference: payload.reference };
        break;
      }
      case "sync_expense": {
        if (!payload) throw new Error("payload (StandardExpense) is required for sync_expense");
        recType = "payout";
        payloadSummary = { amount: payload.amount, reference: payload.reference };
        break;
      }
      case "sync_payment": {
        if (!payload) throw new Error("payload (StandardPayment) is required for sync_payment");
        recType = (payload as StandardPayment).payment_type === "received" ? "booking" : "payout";
        payloadSummary = { amount: payload.amount };
        break;
      }
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    // Para transacciones (no contactos), verificar si ya fue sincronizada exitosamente
    if (action !== "sync_contact") {
      const { data: existingLog } = await supabase
        .from("accounting_sync_log")
        .select("external_entity_id, external_entity_type")
        .eq("provider", provider)
        .eq("record_type", recType)
        .eq("record_id", record_id)
        .eq("status", "synced")
        .maybeSingle();

      if (existingLog?.external_entity_id) {
        return new Response(JSON.stringify({
          success: true,
          skipped: true,
          external_entity_id: existingLog.external_entity_id,
          external_entity_type: existingLog.external_entity_type,
        }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Log as pending before attempting sync
    await logSync(supabase, provider, recType, record_id, "pending", undefined, undefined, payloadSummary);

    try {
      switch (action) {
        case "sync_contact":
          result = await adapter.syncContact(payload as StandardContact);
          break;
        case "sync_journal":
          result = await adapter.syncJournal(payload as StandardJournal);
          break;
        case "sync_invoice":
          result = await adapter.syncInvoice(payload as StandardInvoice);
          break;
        case "sync_bill":
          result = await adapter.syncBill(payload as StandardBill);
          break;
        case "sync_expense":
          result = await adapter.syncExpense(payload as StandardExpense);
          break;
        case "sync_payment":
          result = await adapter.syncPayment(payload as StandardPayment);
          break;
        default:
          result = { external_entity_type: "", external_entity_id: "" };
      }
    } catch (syncErr) {
      const errMsg = String(syncErr);
      console.error(`sync-to-accounting [${action}] ${record_id} failed:`, errMsg);
      await incrementRetryCount(supabase, provider, recType, record_id);
      await logSync(supabase, provider, recType, record_id, "error", undefined, errMsg, payloadSummary);
      // Return 200 with error so bulk sync can detect it without throwing
      return new Response(JSON.stringify({ error: errMsg, record_id, record_type: recType }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await logSync(supabase, provider, recType, record_id, "synced", result, undefined, payloadSummary);

    return new Response(JSON.stringify({ success: true, ...result }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("sync-to-accounting outer error:", err);
    // Usar 200 para que supabase.functions.invoke no oculte el mensaje de error
    // con el genérico "Edge Function returned a non-2xx status code"
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
