import { createClient } from "npm:@supabase/supabase-js@2.39.6";

// ── OpenPay API client (server-side only) ──────────────────────

const SANDBOX_URL = "https://sandbox-api.openpay.mx/v1";
const PRODUCTION_URL = "https://api.openpay.mx/v1";

export function getBaseUrl(): string {
  const env = Deno.env.get("OPENPAY_ENV") || "sandbox";
  return env === "production" ? PRODUCTION_URL : SANDBOX_URL;
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
}

// ── Create or reuse customer ───────────────────────────────────

export async function createOrReuseCustomer(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  userRecord: { first_name?: string; last_name?: string; email: string; phone_number?: string }
): Promise<string> {
  // Check if customer already exists
  const { data: existing } = await supabase
    .from("users")
    .select("openpay_customer_id")
    .eq("id", userId)
    .maybeSingle();

  if (existing?.openpay_customer_id) {
    return existing.openpay_customer_id;
  }

  // Create new customer in OpenPay
  const baseUrl = getBaseUrl();
  const merchantId = getMerchantId();
  const auth = getAuthHeader();

  const customerBody: OpenPayCustomer = {
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

  // Save customer ID — handle race condition with unique constraint
  const { error: updateError } = await supabase
    .from("users")
    .update({ openpay_customer_id: customer.id })
    .eq("id", userId)
    .is("openpay_customer_id", null);

  if (updateError) {
    // Another request may have already set it — re-read
    const { data: refetched } = await supabase
      .from("users")
      .select("openpay_customer_id")
      .eq("id", userId)
      .maybeSingle();
    if (refetched?.openpay_customer_id) {
      return refetched.openpay_customer_id;
    }
  }

  return customer.id;
}

// ── Create SPEI bank charge ────────────────────────────────────

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

// ── Create CODI QR charge ──────────────────────────────────────

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

// ── Get charge status from OpenPay ─────────────────────────────

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

// ── Create card checkout charge (3DS redirect) ────────────────

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
    console.error("OpenPay card checkout charge error:", charge);
    throw new Error(charge.description || "No fue posible crear el cargo con tarjeta");
  }

  return charge as OpenPayCharge;
}
