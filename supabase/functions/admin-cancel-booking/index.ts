import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { markPointsAsClawedBack } from "../_shared/pointsTraceability.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function cancelStampedCfds(
  supabase: ReturnType<typeof createClient>,
  bookingId: string,
  cancellationId: string
): Promise<void> {
  const { data: stampedCfds } = await supabase
    .from("cfdi_invoices")
    .select("id")
    .eq("booking_id", bookingId)
    .in("invoice_type", ["booking", "booking_installment"])
    .eq("status", "stamped");

  for (const cfdi of stampedCfds || []) {
    try {
      await supabase.functions.invoke("cancel-cfdi", {
        body: { cfdi_invoice_id: cfdi.id, motivo: "03", cancellation_id: cancellationId },
      });
    } catch (e) {
      console.error(`Error cancelling CFDI ${cfdi.id} for booking ${bookingId}:`, e);
    }
  }
}

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return err("No authorization header", 401);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return err("Token inválido", 401);

    // Verify caller is super_admin or has can_cancel_bookings permission
    const { data: adminUser } = await supabase
      .from("users")
      .select("id, role, email, first_name, last_name, is_super_admin")
      .eq("id", user.id)
      .maybeSingle();

    if (!adminUser || adminUser.role !== "admin") {
      return err("No tienes permisos para cancelar reservas", 403);
    }

    if (!adminUser.is_super_admin) {
      const { data: perms } = await supabase
        .from("admin_permissions")
        .select("can_cancel_bookings")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!perms?.can_cancel_bookings) {
        return err("No tienes el permiso para cancelar reservas", 403);
      }
    }

    const body = await req.json();
    const {
      booking_id,
      reason_for_traveler,
      reason_for_agency,
      refund_method = "none",
      refund_amount = 0,
      receipt_base64,
      receipt_filename,
      requested_by = "admin_override",
      mode = "full",
      refund_service_charge = false,
    } = body;

    if (!booking_id) return err("booking_id es requerido");
    if (!reason_for_traveler || reason_for_traveler.trim().length < 10)
      return err("El motivo para el viajero debe tener al menos 10 caracteres");
    if (!reason_for_agency || reason_for_agency.trim().length < 10)
      return err("El motivo para la agencia debe tener al menos 10 caracteres");
    if (!["none", "toursred_cash", "bank_transfer", "original_payment_method"].includes(refund_method))
      return err("Método de reembolso inválido");
    if (refund_method === "bank_transfer" && (!receipt_base64 || !receipt_filename))
      return err("El comprobante de transferencia es obligatorio");
    if (!["traveler_default", "traveler_profeco_request", "admin_override"].includes(requested_by))
      return err("requested_by inválido");
    if (!["prepare", "full"].includes(mode))
      return err("mode debe ser 'prepare' o 'full'");

    const isPrepare = mode === "prepare" && refund_method === "original_payment_method";

    // Load booking with related data
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        id, status, payment_status, deposit_amount, service_charge,
        user_id, tour_id, agency_id, booking_code, cancelled_at,
        points_earned, points_used, travel_insurance_included, travel_insurance_cost,
        has_payment_plan,
        tours!bookings_tour_id_fkey(id, name, start_date, end_date),
        agencies!bookings_agency_id_fkey(id, name, contact_email),
        users!bookings_user_id_fkey(id, email, first_name, last_name)
      `)
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) return err("Reserva no encontrada");
    if (booking.cancelled_at || booking.status === "cancelled")
      return err("Esta reserva ya fue cancelada");
    if (booking.status === "cancellation_processing")
      return err("Esta reserva ya tiene una cancelación en proceso. Usa admin-finalize-cancellation para completarla.");

    const tour = (booking as any).tours;
    const agency = (booking as any).agencies;
    const bookingUser = (booking as any).users;

    // Fetch refundable optional services — two-bucket model
    // Each optional (pickup, language, traditional) has its own total_paid bucket.
    // Admin cancellations refund ALL optionals regardless of is_refundable.
    const { data: optionalServices } = await supabase
      .from("booking_optional_services")
      .select("id, service_kind, subtotal, service_charge, total_paid, membership_exemption_used, tour_optional_services(is_refundable)")
      .eq("booking_id", booking_id)
      .eq("is_cancelled", false);

    const insuranceCost = booking.travel_insurance_included
      ? Number(booking.travel_insurance_cost || 0)
      : 0;

    // Calculate total actually paid by traveler.
    // When has_payment_plan, installment 1 ("Anticipo") already represents the
    // deposit — adding deposit_amount on top would double-count it.
    let totalPaidByTraveler = Number(booking.deposit_amount || 0);

    if (booking.has_payment_plan) {
      const { data: installments } = await supabase
        .from("booking_payment_plan_installments")
        .select("installment_number, amount_paid")
        .eq("booking_id", booking_id)
        .in("status", ["paid", "partially_paid"]);

      for (const inst of (installments || [])) {
        if ((inst as any).installment_number > 1) {
          totalPaidByTraveler += Number(inst.amount_paid || 0);
        }
      }

      // Add service charges from completed payment plan transactions
      const { data: ppTransactions } = await supabase
        .from("booking_payment_plan_transactions")
        .select("service_charge")
        .eq("booking_id", booking_id)
        .eq("status", "completed");

      for (const tx of (ppTransactions || [])) {
        totalPaidByTraveler += Number(tx.service_charge || 0);
      }
    }

    // Bucket 1: tour refund (totalPaidByTraveler + insurance — NO optionals)
    const tourRefundBucket = Math.round((totalPaidByTraveler + insuranceCost) * 100) / 100;

    // Bucket 2: optionals refund (sum of each optional's total_paid)
    let optionalsRefundBucket = 0;
    for (const os of (optionalServices || [])) {
      // Admin cancellation: all optionals are refundable
      optionalsRefundBucket += Number((os as any).total_paid || (os as any).subtotal || 0);
    }
    optionalsRefundBucket = Math.round(optionalsRefundBucket * 100) / 100;

    let optionalServicesRefundable = optionalsRefundBucket;
    let optionalServicesServiceCharge = 0;
    for (const os of (optionalServices || [])) {
      optionalServicesServiceCharge += Number((os as any).service_charge || 0);
    }

    // Fetch refundable supplements (paid and cancellable)
    const { data: supplements } = await supabase
      .from("booking_supplements")
      .select("id, total_paid, refund_amount, status, tour_supplements(is_cancellable)")
      .eq("booking_id", booking_id)
      .eq("status", "paid");

    let supplementsRefundable = 0;
    for (const supp of (supplements || [])) {
      if ((supp as any).tour_supplements?.is_cancellable !== false) {
        supplementsRefundable += Number((supp as any).total_paid || 0);
      }
    }

    // Two-bucket suggested refund: tour bucket + optionals bucket + supplements
    // No double refund — optionals are cancelled via cancel_booking_optional_services RPC
    // and their refund_amount is set there; the tour refund is separate.
    const suggestedRefund = Math.round((tourRefundBucket + optionalsRefundBucket + supplementsRefundable) * 100) / 100;

    const now = new Date().toISOString();
    let receiptFilePath: string | null = null;

    // Handle refund based on method
    let transactionId: string | null = null;

    if (refund_method === "toursred_cash" && Number(refund_amount) > 0) {
      // Get or create wallet
      let { data: wallet } = await supabase
        .from("toursred_cash_wallets")
        .select("*")
        .eq("user_id", booking.user_id)
        .maybeSingle();

      if (!wallet) {
        const { data: newWallet, error: wErr } = await supabase
          .from("toursred_cash_wallets")
          .insert({ user_id: booking.user_id, balance: 0, currency: "MXN" })
          .select()
          .single();
        if (wErr || !newWallet) return err("Error creando wallet del viajero");
        wallet = newWallet;
      }

      const newBalance = Number(wallet.balance) + Number(refund_amount);

      const { data: tx, error: txErr } = await supabase
        .from("toursred_cash_transactions")
        .insert({
          wallet_id: wallet.id,
          user_id: booking.user_id,
          amount: Number(refund_amount),
          balance_after: newBalance,
          type: "refund",
          description: `Reembolso por cancelación administrativa - ${tour?.name || ""}`,
          reference_id: booking_id,
          reference_type: "admin_cancellation",
        })
        .select()
        .single();

      if (txErr || !tx) return err("Error creando transacción de reembolso");
      transactionId = tx.id;

      const { error: walletErr } = await supabase
        .from("toursred_cash_wallets")
        .update({ balance: newBalance })
        .eq("id", wallet.id);
      if (walletErr) return err("Error actualizando balance del wallet");
    }

    if (refund_method === "bank_transfer" && receipt_base64 && receipt_filename) {
      const fileExt = receipt_filename.split(".").pop()?.toLowerCase() || "pdf";
      const filePath = `${booking_id}/${Date.now()}_${receipt_filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const contentType = fileExt === "pdf" ? "application/pdf"
        : fileExt === "png" ? "image/png"
        : "image/jpeg";

      const { error: uploadErr } = await supabase.storage
        .from("cancellation-receipts")
        .upload(filePath, decode(receipt_base64), {
          contentType,
          upsert: false,
        });

      if (uploadErr) return err("Error subiendo comprobante: " + uploadErr.message);
      receiptFilePath = filePath;
    }

    // Points: 1 peso = 1 punto. In prepare mode, skip — handled in
    // admin-finalize-cancellation after all refund lines are initiated.
    // For original_payment_method, process-payment-refund does NOT claw back
    // points, so in non-prepare mode we deduct here.
    let pointsDeducted = 0;
    if (refund_method !== "original_payment_method" && !isPrepare) {
      const pointsToDeduct = Math.floor(Number(refund_amount));
      if (pointsToDeduct > 0) {
        try {
          const { error: deductErr } = await supabase.rpc("deduct_points", {
            p_user_id: booking.user_id,
            p_amount: pointsToDeduct,
            p_description: `Puntos revertidos por cancelación administrativa - ${tour?.name || ""}`,
            p_reference_id: booking_id,
            p_reference_type: "admin_cancellation",
          });
          if (deductErr) {
            console.error("Error deducting points:", deductErr);
          } else {
            pointsDeducted = pointsToDeduct;
          }
        } catch (e) {
          console.error("Exception deducting points:", e);
        }
      }
    }

    // Cancel optional services and supplements.
    // In prepare mode, skip — these are handled in admin-finalize-cancellation.
    if (!isPrepare) {
      try {
        await supabase.rpc("cancel_booking_optional_services", {
          p_booking_id: booking_id,
          p_cancelled_by_agency: false,
          p_refund_service_charge: refund_service_charge,
        });
      } catch (e) {
        console.error("Error cancelling optional services:", e);
      }

      try {
        const { data: paidSupplements } = await supabase
          .from("booking_supplements")
          .select("id, tour_supplements(is_cancellable)")
          .eq("booking_id", booking_id)
          .eq("status", "paid");

        for (const supp of (paidSupplements || [])) {
          if ((supp as any).tour_supplements?.is_cancellable !== false) {
            await supabase.from("booking_supplements")
              .update({
                status: "cancelled",
                cancelled_at: new Date().toISOString(),
                cancelled_by: "tour_cancellation",
                refund_amount: (supp as any).total_paid || 0,
                updated_at: new Date().toISOString(),
              })
              .eq("id", supp.id);
          }
        }
      } catch (e) {
        console.error("Error cancelling supplements:", e);
      }
    }

    // Insert admin_booking_cancellations record
    const { data: adminCancellation, error: acErr } = await supabase
      .from("admin_booking_cancellations")
      .insert({
        booking_id,
        admin_user_id: user.id,
        reason_for_traveler: reason_for_traveler.trim(),
        reason_for_agency: reason_for_agency.trim(),
        refund_method,
        refund_amount: Number(refund_amount) || 0,
        receipt_file_path: receiptFilePath,
        points_deducted: pointsDeducted,
        cancelled_at: now,
        service_charge_refunded: Boolean(refund_service_charge),
        service_charge_refunded_amount: refund_service_charge
          ? (Number(booking.service_charge || 0) + (booking.has_payment_plan
              ? (await supabase
                  .from("booking_payment_plan_transactions")
                  .select("service_charge")
                  .eq("booking_id", booking_id)
                  .eq("status", "completed")
                  .then(({ data }: any) => (data || []).reduce((s: number, t: any) => s + Number(t.service_charge || 0), 0)))
              : 0) + optionalServicesServiceCharge)
          : 0,
      })
      .select()
      .single();

    if (acErr || !adminCancellation) {
      return err("Error registrando cancelación administrativa: " + acErr?.message);
    }

    // Insert booking_cancellations record for system compatibility
    const tourStartDate = tour?.start_date || new Date().toISOString().split("T")[0];
    const { data: cancellationRecord, error: bcErr } = await supabase
      .from("booking_cancellations")
      .insert({
        booking_id,
        cancelled_by_user_id: user.id,
        cancelled_at: now,
        tour_start_date: tourStartDate,
        days_before_tour: 0,
        cancellation_policy_type: "admin_cancelled",
        original_deposit_amount: Number(booking.deposit_amount || 0),
        original_service_charge: Number(booking.service_charge || 0) + optionalServicesServiceCharge + (booking.has_payment_plan
          ? (await supabase
              .from("booking_payment_plan_transactions")
              .select("service_charge")
              .eq("booking_id", booking_id)
              .eq("status", "completed")
              .then(({ data }: any) => (data || []).reduce((s: number, t: any) => s + Number(t.service_charge || 0), 0)))
          : 0),
        total_principal_paid: totalPaidByTraveler,
        refund_amount_to_traveler: Number(refund_amount) || 0,
        amount_to_agency: 0,
        amount_to_platform: 0,
        toursred_cash_transaction_id: transactionId,
        refund_processed: Number(refund_amount) > 0,
        cancellation_reason: reason_for_traveler.trim(),
        emails_sent: false,
        service_charge_refunded_amount: refund_service_charge
          ? (Number(booking.service_charge || 0) + (booking.has_payment_plan
              ? (await supabase
                  .from("booking_payment_plan_transactions")
                  .select("service_charge")
                  .eq("booking_id", booking_id)
                  .eq("status", "completed")
                  .then(({ data }: any) => (data || []).reduce((s: number, t: any) => s + Number(t.service_charge || 0), 0)))
              : 0) + optionalServicesServiceCharge)
          : 0,
      })
      .select()
      .single();

    if (bcErr) {
      console.error("Error inserting booking_cancellations record:", bcErr);
    }

    // Cierre de trazabilidad: inserta registros clawback amount=0 por cada
    // fuente de puntos earned, para que un reporte por fuente cuadre.
    // In prepare mode, skip — handled in admin-finalize-cancellation.
    if (refund_method !== "original_payment_method" && !isPrepare && pointsDeducted > 0) {
      await markPointsAsClawedBack(supabase, booking_id, cancellationRecord?.id || null, "administrativa");
    }

    // ============================================================
    // Accounting entry + CFDI cancellation (non-blocking)
    // ============================================================
    if (cancellationRecord && !isPrepare) {
      try {
        await supabase.rpc("create_accounting_entry_for_cancellation", {
          p_cancellation_id: cancellationRecord.id,
          p_cancellation_type: "full",
        });
      } catch (accountingError) {
        console.error("Error generando póliza contable:", accountingError);
      }

      if (Number(refund_amount) > 0) {
        EdgeRuntime.waitUntil(
          cancelStampedCfds(supabase, booking_id, cancellationRecord.id)
        );
      }
    }

    // Status update: in prepare mode, use 'cancellation_processing' instead
    // of 'cancelled'. The booking stays in this intermediate state until
    // admin-finalize-cancellation confirms all refund lines are initiated.
    const newStatus = isPrepare ? "cancellation_processing" : "cancelled";
    const { error: updateErr } = await supabase
      .from("bookings")
      .update({
        status: newStatus,
        cancelled_at: isPrepare ? null : now,
        cancellation_type: "admin_cancelled",
        cancellation_refund_amount: refund_method === "original_payment_method" ? 0 : (Number(refund_amount) || 0),
        admin_cancellation_id: adminCancellation.id,
      })
      .eq("id", booking_id);

    if (updateErr) {
      console.error("Error updating booking:", updateErr);
    }

    // Audit log
    try {
      await supabase.rpc("insert_audit_log", {
        p_tenant_type: "admin",
        p_actor_id: user.id,
        p_actor_email: adminUser.email ?? null,
        p_actor_role: adminUser.role,
        p_target_id: booking_id,
        p_target_table: "bookings",
        p_action: isPrepare ? "admin_cancel_prepare" : "admin_cancel",
        p_severity: "high",
        p_old_values: { status: booking.status },
        p_new_values: { status: newStatus, cancellation_type: "admin_cancelled", refund_method, refund_amount },
        p_metadata: { admin_cancellation_id: adminCancellation.id, points_deducted: pointsDeducted },
      });
    } catch (e) {
      console.error("Error audit log:", e);
    }

    // Get receipt public URL if exists
    let receiptPublicUrl: string | null = null;
    if (receiptFilePath) {
      const { data: urlData } = supabase.storage
        .from("cancellation-receipts")
        .getPublicUrl(receiptFilePath);
      receiptPublicUrl = urlData.publicUrl;
    }

    // ============================================================
    // Notifications: in prepare mode, send only a light notice to the
    // traveler. Full notifications (traveler/agency/admin) are sent by
    // admin-finalize-cancellation once all refunds are confirmed.
    // ============================================================
    if (isPrepare) {
      EdgeRuntime.waitUntil(
        fetch(`${supabaseUrl}/functions/v1/send-cancellation-notification-traveler`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            booking_id,
            cancellation_id: cancellationRecord?.id,
            admin_cancellation: true,
            admin_reason: reason_for_traveler.trim(),
            refund_amount: 0,
            refund_method,
            receipt_url: null,
            receipt_file_path: null,
            is_intermediate_notice: true,
          }),
        }).then(() => {}).catch((e) => console.error("Error notifying traveler (prepare):", e))
      );
    } else {
      // Send full notifications (existing behavior)
      const notificationPromises: Promise<void>[] = [];

      notificationPromises.push(
        fetch(`${supabaseUrl}/functions/v1/send-cancellation-notification-traveler`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            booking_id,
            cancellation_id: cancellationRecord?.id,
            admin_cancellation: true,
            admin_reason: reason_for_traveler.trim(),
            refund_amount: Number(refund_amount) || 0,
            refund_method,
            receipt_url: receiptPublicUrl,
            receipt_file_path: receiptFilePath,
          }),
        }).then(() => {}).catch((e) => console.error("Error notifying traveler:", e))
      );

      if (agency?.contact_email) {
        notificationPromises.push(
          fetch(`${supabaseUrl}/functions/v1/send-cancellation-notification-agency`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              booking_id,
              cancellation_id: cancellationRecord?.id,
              admin_cancellation: true,
              admin_reason: reason_for_agency.trim(),
            }),
          }).then(() => {}).catch((e) => console.error("Error notifying agency:", e))
        );
      }

      notificationPromises.push(
        fetch(`${supabaseUrl}/functions/v1/send-cancellation-notification-admin`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            booking_id,
            cancellation_id: cancellationRecord?.id,
            admin_cancellation: true,
            admin_reason_for_traveler: reason_for_traveler.trim(),
            admin_reason_for_agency: reason_for_agency.trim(),
            refund_amount: Number(refund_amount) || 0,
            refund_method,
            receipt_url: receiptPublicUrl,
          }),
        }).then(() => {}).catch((e) => console.error("Error notifying admin:", e))
      );

      await Promise.allSettled(notificationPromises);

      if (cancellationRecord) {
        await supabase
          .from("booking_cancellations")
          .update({ emails_sent: true })
          .eq("id", cancellationRecord.id);
      }
    }

    return ok({
      success: true,
      message: isPrepare ? "Cancelación preparada. Procede con los reembolsos." : "Reserva cancelada exitosamente",
      admin_cancellation_id: adminCancellation.id,
      refund_method,
      refund_amount: Number(refund_amount) || 0,
      points_deducted: pointsDeducted,
      suggested_refund: suggestedRefund,
      tour_refund_bucket: tourRefundBucket,
      optionals_refund_bucket: optionalsRefundBucket,
      supplements_refundable: supplementsRefundable,
      cancellation_id: cancellationRecord?.id || null,
      booking_status: newStatus,
    });
  } catch (e: any) {
    console.error("admin-cancel-booking error:", e);
    return err(e.message || "Error interno", 500);
  }
});

// Decode base64 to Uint8Array for storage upload
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
