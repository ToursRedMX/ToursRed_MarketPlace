import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const CHARGE_CONTEXT_TO_REFERENCE_TYPE: Record<string, string> = {
  booking_deposit: "booking",
  payment_plan_installment: "payment_plan",
  supplement: "supplement",
  insurance: "insurance_payment",
  optional_service: "optional_service_payment",
  membership: "membership",
  featured_slot: "featured_slot",
};

const NON_REFUNDABLE_METHODS = ["OXXO", "Transferencia Bancaria", "Efectivo"];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "No authorization header" }, 401);
    }

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userErr || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Verify admin role
    const { data: userData, error: profileErr } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profileErr || !userData) {
      return jsonResponse({ error: "User profile not found" }, 403);
    }
    const isAdmin =
      userData.role === "super_admin" ||
      userData.role === "admin" ||
      userData.role === "account_executive";
    if (!isAdmin) {
      return jsonResponse({ error: "Admin access required" }, 403);
    }

    const body = await req.json();
    const { booking_id } = body;
    if (!booking_id) {
      return jsonResponse({ error: "booking_id is required" }, 400);
    }

    // Fetch all succeeded payment transactions for this booking
    const { data: transactions, error: txErr } = await supabase
      .from("payment_transactions")
      .select("*")
      .eq("booking_id", booking_id)
      .eq("status", "succeeded")
      .order("created_at", { ascending: true });

    if (txErr) {
      console.error("Error fetching payment_transactions:", txErr);
      return jsonResponse({ error: "Failed to fetch transactions" }, 500);
    }

    if (!transactions || transactions.length === 0) {
      return jsonResponse({ lines: [] });
    }

    // Fetch existing refunds for these transactions
    const txIds = transactions.map((t) => t.id);
    const { data: existingRefunds } = await supabase
      .from("payment_refunds")
      .select("id, payment_transaction_id, status, requested_amount, processor_refund_id, failure_reason")
      .in("payment_transaction_id", txIds)
      .order("created_at", { ascending: false });

    // Build a map: txId -> latest refund (first one since we ordered desc)
    const refundMap: Record<string, any> = {};
    for (const r of existingRefunds || []) {
      if (!refundMap[r.payment_transaction_id]) {
        refundMap[r.payment_transaction_id] = r;
      }
    }

    // Collect all charge_reference_ids for points lookup
    const referenceIds = transactions
      .filter((t) => t.charge_reference_id)
      .map((t) => t.charge_reference_id);

    // For booking_deposit lines without charge_reference_id, points are stored
    // with reference_id = booking_id. Include it so we can look them up.
    const bookingDepositTxWithoutRef = transactions.filter(
      (t) => (!t.charge_context || t.charge_context === "booking_deposit") && !t.charge_reference_id
    );
    if (bookingDepositTxWithoutRef.length > 0) {
      referenceIds.push(booking_id);
    }

    // Fetch points earned per reference_id
    let pointsMap: Record<string, number> = {};
    if (referenceIds.length > 0) {
      const { data: pointsTx } = await supabase
        .from("toursred_points_transactions")
        .select("reference_id, amount, type")
        .in("reference_id", referenceIds)
        .eq("type", "earned");

      for (const pt of pointsTx || []) {
        const key = String(pt.reference_id);
        pointsMap[key] = (pointsMap[key] || 0) + Number(pt.amount || 0);
      }

      // Subtract already-clawed-back (deducted) points
      const { data: pointsDeducted } = await supabase
        .from("toursred_points_transactions")
        .select("reference_id, amount, type")
        .in("reference_id", referenceIds)
        .in("type", ["deducted", "clawback", "refund_deduction"]);

      for (const pt of pointsDeducted || []) {
        const key = String(pt.reference_id);
        pointsMap[key] = (pointsMap[key] || 0) - Number(pt.amount || 0);
      }
    }

    // Fetch supplement names for descriptions
    const supplementRefIds = transactions
      .filter((t) => t.charge_context === "supplement" && t.charge_reference_id)
      .map((t) => t.charge_reference_id);

    let supplementNames: Record<string, string> = {};
    if (supplementRefIds.length > 0) {
      const { data: supps } = await supabase
        .from("booking_supplements")
        .select("id, tour_supplements(name)")
        .in("id", supplementRefIds);
      for (const s of supps || []) {
        supplementNames[String(s.id)] = (s as any).tour_supplements?.name || "Suplemento";
      }
    }

    // Fetch optional service names for descriptions
    const optionalRefIds = transactions
      .filter((t) => t.charge_context === "optional_service" && t.charge_reference_id)
      .map((t) => t.charge_reference_id);

    let optionalNames: Record<string, string> = {};
    if (optionalRefIds.length > 0) {
      const { data: opts } = await supabase
        .from("booking_optional_services")
        .select("id, description, tour_optional_services(name)")
        .in("id", optionalRefIds);
      for (const o of opts || []) {
        const name = (o as any).tour_optional_services?.name || o.description || "Servicio opcional";
        optionalNames[String(o.id)] = name;
      }
    }

    // Fetch installment labels for descriptions
    const installmentRefIds = transactions
      .filter((t) => t.charge_context === "payment_plan_installment" && t.charge_reference_id)
      .map((t) => t.charge_reference_id);

    let installmentLabels: Record<string, string> = {};
    if (installmentRefIds.length > 0) {
      const { data: installments } = await supabase
        .from("booking_payment_plan_installments")
        .select("id, installment_number, label")
        .in("id", installmentRefIds);
      for (const inst of installments || []) {
        installmentLabels[String(inst.id)] =
          inst.label || `Parcialidad ${inst.installment_number}`;
      }
    }

    // Legacy fallback for payment_plan_installment lines: points may be stored
    // with reference_id = plan_id (not the transaction id). Replicates the same
    // fallback logic as claw_back_points_for_refund().
    const installmentTxIds = transactions
      .filter((t) => t.charge_context === "payment_plan_installment" && t.charge_reference_id)
      .map((t) => String(t.charge_reference_id));

    let planPointsMap: Record<string, number> = {};
    let planTotalAmountMap: Record<string, number> = {};
    let txToPlanIdMap: Record<string, string> = {};

    if (installmentTxIds.length > 0) {
      const { data: planTxRows } = await supabase
        .from("booking_payment_plan_transactions")
        .select("id, plan_id, amount, status")
        .in("id", installmentTxIds);

      const planIds = [...new Set((planTxRows || []).map((r: any) => r.plan_id))];
      txToPlanIdMap = {};
      for (const r of (planTxRows || [])) {
        txToPlanIdMap[String((r as any).id)] = String((r as any).plan_id);
      }

      if (planIds.length > 0) {
        // Net points per plan_id (earned - clawed back)
        const { data: planEarned } = await supabase
          .from("toursred_points_transactions")
          .select("reference_id, amount, type")
          .in("reference_id", planIds)
          .eq("reference_type", "payment_plan")
          .eq("type", "earned");

        const { data: planDeducted } = await supabase
          .from("toursred_points_transactions")
          .select("reference_id, amount, type")
          .in("reference_id", planIds)
          .eq("reference_type", "payment_plan")
          .in("type", ["deducted", "clawback", "refund_deduction"]);

        for (const pt of (planEarned || [])) {
          const key = String(pt.reference_id);
          planPointsMap[key] = (planPointsMap[key] || 0) + Number(pt.amount || 0);
        }
        for (const pt of (planDeducted || [])) {
          const key = String(pt.reference_id);
          planPointsMap[key] = (planPointsMap[key] || 0) - Number(pt.amount || 0);
        }

        // Total completed amount per plan_id for proportional allocation
        const { data: allPlanTx } = await supabase
          .from("booking_payment_plan_transactions")
          .select("plan_id, amount, status")
          .in("plan_id", planIds)
          .eq("status", "completed");

        for (const r of (allPlanTx || [])) {
          const key = String((r as any).plan_id);
          planTotalAmountMap[key] = (planTotalAmountMap[key] || 0) + Number((r as any).amount || 0);
        }
      }
    }

    // Build line descriptions
    const lines = transactions.map((tx) => {
      const ctx = tx.charge_context || "booking_deposit";
      const refId = tx.charge_reference_id ? String(tx.charge_reference_id) : null;
      let description = "Pago";
      switch (ctx) {
        case "booking_deposit":
          description = "Anticipo de reserva";
          break;
        case "payment_plan_installment":
          description = installmentLabels[refId || ""] || "Parcialidad";
          break;
        case "supplement":
          description = `Suplemento: ${supplementNames[refId || ""] || "N/A"}`;
          break;
        case "insurance":
          description = "Seguro de viaje";
          break;
        case "optional_service":
          description = `Servicio opcional: ${optionalNames[refId || ""] || "N/A"}`;
          break;
        case "membership":
          description = "Membresía ToursRed Plus";
          break;
        case "featured_slot":
          description = "Destacado de tour";
          break;
        default:
          description = "Pago";
      }

      // For booking_deposit without charge_reference_id, points are stored
      // with reference_id = booking_id (via award_points_for_booking trigger)
      const pointsLookupKey = refId || (ctx === "booking_deposit" ? booking_id : null);
      let pointsEarned = pointsLookupKey ? pointsMap[pointsLookupKey] || 0 : 0;
      let pointsEstimated = false;

      // Legacy fallback: if no direct points found and this is a payment plan
      // installment, look up points via plan_id
      if (pointsEarned === 0 && ctx === "payment_plan_installment" && refId) {
        const planId = txToPlanIdMap[refId];
        if (planId) {
          const netPlanPoints = planPointsMap[planId] || 0;
          const totalPlanAmount = planTotalAmountMap[planId] || 0;
          if (netPlanPoints > 0 && totalPlanAmount > 0) {
            pointsEarned = Math.floor((Number(tx.amount) / totalPlanAmount) * netPlanPoints);
            pointsEstimated = true;
          }
        }
      }

      const existingRefund = refundMap[tx.id];
      const isNonRefundable =
        NON_REFUNDABLE_METHODS.includes(tx.payment_method_type || "") ||
        !tx.payment_processor;

      return {
        payment_transaction_id: tx.id,
        description,
        amount: Number(tx.amount),
        currency: tx.currency || "mxn",
        payment_processor: tx.payment_processor,
        payment_method_type: tx.payment_method_type,
        charge_context: ctx,
        charge_reference_id: tx.charge_reference_id,
        points_earned: pointsEarned,
        points_earned_is_estimated: pointsEstimated,
        refundable_to_original: !isNonRefundable,
        existing_refund: existingRefund
          ? {
              payment_refund_id: existingRefund.id,
              status: existingRefund.status,
              requested_amount: Number(existingRefund.requested_amount),
              processor_refund_id: existingRefund.processor_refund_id,
              failure_reason: existingRefund.failure_reason,
            }
          : null,
        created_at: tx.created_at,
      };
    });

    return jsonResponse({ lines });
  } catch (err: any) {
    console.error("get-refundable-lines error:", err);
    return jsonResponse({ error: err.message || "Internal server error" }, 500);
  }
});
