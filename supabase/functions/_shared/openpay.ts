import type { SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";
import type { SupabaseClient as LegacySupabaseClient } from "npm:@supabase/supabase-js@2.39.6";

type OpenPayClient = Pick<SupabaseClient, "from"> | Pick<LegacySupabaseClient, "from">;

// Minimal database contract shared by consumers using different SDK versions.
interface OpenPayDatabase {
  from(table: "users"): {
    select(columns: "openpay_customer_id"): {
      eq(column: "id", value: string): {
        maybeSingle(): PromiseLike<{
          data: unknown;
          error: unknown;
        }>;
      };
    };
    update(values: { openpay_customer_id: string }): {
      eq(column: "id", value: string): {
        is(column: "openpay_customer_id", value: null): PromiseLike<{ error: unknown }>;
      };
    };
  };
}

function persistedCustomerId(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("openpay_customer_id" in value)) return null;
  const id = value.openpay_customer_id;
  return typeof id === "string" && id.trim() ? id : null;
}

// ── OpenPay API client (server-side only) ────────────────────────

const SANDBOX_URL = "https://sandbox-api.openpay.mx/v1";
const PRODUCTION_URL = "https://api.openpay.mx/v1";
const SANDBOX_DASHBOARD = "https://sandbox-dashboard.openpay.mx";
const PRODUCTION_DASHBOARD = "https://dashboard.openpay.mx";

export function getBaseUrl(): string {
  const env = Deno.env.get("OPENPAY_ENV") || "sandbox";
  return env === "production" ? PRODUCTION_URL : SANDBOX_URL;
}

export function getDashboardUrl(): string {
  const env = Deno.env.get("OPENPAY_ENV") || "sandbox";
  return env === "production" ? PRODUCTION_DASHBOARD : SANDBOX_DASHBOARD;
}

export function getMerchantId(): string {
  const id = Deno.env.get("OPENPAY_MERCHANT_ID");
  if (!id) throw new Error("OPENPAY_MERCHANT_ID secret is not configured");
  return id;
}

export function getAuthHeader(): string {
  const privateKey = Deno.env.get("OPENPAY_PRIVATE_KEY");
  if (!privateKey) throw new Error("OPENPAY_PRIVATE_KEY secret is not configured");
  return `Basic ${btoa(`${privateKey}:`)}`;
}

export function isConfigured(): boolean {
  return !!(Deno.env.get("OPENPAY_MERCHANT_ID") && Deno.env.get("OPENPAY_PRIVATE_KEY"));
}

export interface OpenPayCustomer {
  id: string;
  name: string;
  last_name?: string;
  email: string;
  phone_number?: string;
  requires_account: boolean;
}

export interface OpenPayPaymentMethod {
  url?: string | null;
  type: string;
  agreement?: string;
  clabe?: string;
  name?: string;
  bank?: string;
  reference?: string;
  barcode_url?: string;
  qr_url?: string;
  qr_image?: string;
}

export interface OpenPayCharge {
  due_date?: string | null;
  id: string;
  authorization: string | null;
  operation_type: string;
  method: string;
  transaction_type: string;
  status: string;
  conciliated: boolean;
  creation_date: string;
  operation_date?: string;
  description: string;
  error_message: string | null;
  order_id: string;
  amount: number;
  currency: string;
  payment_method: OpenPayPaymentMethod | null;
  customer_id?: string;
  /**
   * Comision que cobra OpenPay. Solo viene en los cargos ya liquidados
   * (charge.succeeded); en charge.created y transaction.expired no existe.
   *
   * Forma verificada el 08-sep-2026 contra los payloads reales guardados en
   * openpay_webhook_events: `amount` es la comision SIN IVA y `tax` es el IVA
   * (236.81 x 0.16 = 37.89 en los tres cargos revisados). No confundir con
   * `fee_details`, que es de MercadoPago y OpenPay nunca manda.
   */
  fee?: {
    amount?: number | null;
    tax?: number | null;
    currency?: string | null;
    surcharge?: number | null;
    base_commission?: number | null;
  } | null;
}

// ── Create or reuse customer ─────────────────────────

export async function createOrReuseCustomer(
  supabase: OpenPayClient,
  userId: string,
  userRecord: { first_name?: string; last_name?: string; email: string; phone_number?: string }
): Promise<string> {
  // Both SDK versions implement this query subset. Normalize their incompatible
  // generic builders at this boundary; database results remain unknown/validated.
  const database = supabase as unknown as OpenPayDatabase;
  // Check if customer already exists
  const { data: existing, error: lookupError } = await database
    .from("users")
    .select("openpay_customer_id")
    .eq("id", userId)
    .maybeSingle();

  if (lookupError || !existing) {
    throw new Error("No fue posible verificar el cliente de OpenPay");
  }

  const existingId = persistedCustomerId(existing);
  if (existingId) return existingId;

  // Create new customer in OpenPay
  const baseUrl = getBaseUrl();
  const merchantId = getMerchantId();
  const auth = getAuthHeader();

  const customerBody: Omit<OpenPayCustomer, "id"> = {
    name: userRecord.first_name || "Cliente",
    last_name: userRecord.last_name || undefined,
    email: userRecord.email,
    phone_number: userRecord.phone_number || undefined,
    requires_account: false,
  };

  const response = await fetch(`${baseUrl}/${merchantId}/customers`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(customerBody),
  });

  const customer = await response.json();

  if (!response.ok) {
    console.error("OpenPay customer creation error:", customer);
    throw new Error(customer.description || "No fue posible crear el cliente en OpenPay");
  }

  if (!customer || typeof customer.id !== "string" || !customer.id.trim()) {
    throw new Error("Respuesta de cliente OpenPay invalida");
  }

  // Save customer ID — handle race condition with unique constraint
  const { error: updateError } = await database
    .from("users")
    .update({ openpay_customer_id: customer.id })
    .eq("id", userId)
    .is("openpay_customer_id", null);

  // A concurrent update can affect zero rows without returning an error.
  // Always use the persisted ID, including when another request won the race.
  const { data: refetched, error: readError } = await database
    .from("users")
    .select("openpay_customer_id")
    .eq("id", userId)
    .maybeSingle();
  const savedId = persistedCustomerId(refetched);
  if (!readError && savedId) return savedId;
  if (updateError) {
    throw new Error("No fue posible guardar el cliente de OpenPay");
  }
  throw new Error("No fue posible confirmar el cliente de OpenPay");
}

// ── Create SPEI bank charge ────────────────────────

export async function createSpeiCharge(
  customerId: string,
  amount: number,
  orderId: string,
  description: string
): Promise<OpenPayCharge> {
  const baseUrl = getBaseUrl();
  const merchantId = getMerchantId();
  const auth = getAuthHeader();

  const body = {
    method: "bank_account",
    amount,
    currency: "MXN",
    description,
    order_id: orderId,
  };

  const response = await fetch(`${baseUrl}/${merchantId}/customers/${customerId}/charges`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const charge = await response.json();

  if (!response.ok) {
    console.error("OpenPay SPEI charge error:", charge);
    throw new Error(charge.description || "No fue posible generar la transferencia SPEI");
  }

  return charge as OpenPayCharge;
}

// ── Create CODI QR charge ──────────────────────────

export async function createCodiCharge(
  customerId: string,
  amount: number,
  orderId: string,
  description: string
): Promise<OpenPayCharge> {
  const baseUrl = getBaseUrl();
  const merchantId = getMerchantId();
  const auth = getAuthHeader();

  const body = {
    method: "codi",
    amount,
    currency: "MXN",
    description,
    order_id: orderId,
    codi_options: {
      mode: "QR_CODE",
    },
  };

  const response = await fetch(`${baseUrl}/${merchantId}/customers/${customerId}/charges`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const charge = await response.json();

  if (!response.ok) {
    console.error("OpenPay CODI charge error:", charge);
    throw new Error(charge.description || "No fue posible generar el codigo QR de CoDi");
  }

  return charge as OpenPayCharge;
}

// ── Create cash charge (store reference) ─────────────────

export async function createCashCharge(
  customerId: string,
  amount: number,
  orderId: string,
  description: string
): Promise<OpenPayCharge> {
  const baseUrl = getBaseUrl();
  const merchantId = getMerchantId();
  const auth = getAuthHeader();

  const body = {
    method: "store",
    amount,
    currency: "MXN",
    description,
    order_id: orderId,
  };

  const response = await fetch(`${baseUrl}/${merchantId}/customers/${customerId}/charges`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const charge = await response.json();

  if (!response.ok) {
    console.error("OpenPay cash charge error:", charge);
    throw new Error(charge.description || "No fue posible generar la referencia de pago en efectivo");
  }

  return charge as OpenPayCharge;
}

// ── Get charge status from OpenPay ─────────────────────

export async function getCharge(
  customerId: string,
  chargeId: string
): Promise<OpenPayCharge> {
  const baseUrl = getBaseUrl();
  const merchantId = getMerchantId();
  const auth = getAuthHeader();

  const response = await fetch(
    `${baseUrl}/${merchantId}/customers/${customerId}/charges/${chargeId}`,
    {
      method: "GET",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
    }
  );

  const charge = await response.json();

  if (!response.ok) {
    console.error("OpenPay getCharge error:", charge);
    throw new Error(charge.description || "No fue posible consultar el cargo en OpenPay");
  }

  return charge as OpenPayCharge;
}

// ── Get charge status from OpenPay (merchant-level, no customer) ──

export async function getChargeMerchant(
  chargeId: string
): Promise<OpenPayCharge> {
  const baseUrl = getBaseUrl();
  const merchantId = getMerchantId();
  const auth = getAuthHeader();

  const response = await fetch(
    `${baseUrl}/${merchantId}/charges/${chargeId}`,
    {
      method: "GET",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
    }
  );

  const charge = await response.json();

  if (!response.ok) {
    console.error("OpenPay getChargeMerchant error:", charge);
    throw new Error(charge.description || "No fue posible consultar el cargo en OpenPay");
  }

  return charge as OpenPayCharge;
}

// ── Create card checkout charge (3DS redirect) ────────────

export async function createCardCheckoutCharge(
  customerId: string,
  amount: number,
  orderId: string,
  description: string,
  redirectUrl: string,
  metadata: Record<string, string>
): Promise<OpenPayCharge> {
  const baseUrl = getBaseUrl();
  const merchantId = getMerchantId();
  const auth = getAuthHeader();

  const body = {
    method: "card",
    amount,
    currency: "MXN",
    description,
    order_id: orderId,
    confirm: false,
    redirect_url: redirectUrl,
    metadata,
  };

  const response = await fetch(`${baseUrl}/${merchantId}/customers/${customerId}/charges`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const charge = await response.json();

  if (!response.ok) {
    console.error("OpenPay getChargeMerchant error:", charge);
    throw new Error(charge.description || "No fue posible consultar el cargo en OpenPay");
  }

  return charge as OpenPayCharge;
}
