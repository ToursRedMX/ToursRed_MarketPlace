import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const CHARGE_CONTEXT_TO_REFERENCE_TYPE: Record<string, string> = {
  booking_deposit: "booking",
  payment_plan_installment: "payment_plan",
  supplement: "supplement",
  insurance: "insurance_payment",
  optional_service: "optional_service_payment",
  membership: "membership",
  featured_slot: "featured_slot",
};

/**
 * After deduct_points() has already adjusted the wallet balance, this helper
 * inserts informational `clawback` records (amount=0) per earned-points source
 * so that a future "active points by source" report ties out. It does NOT
 * touch the wallet balance or total_used — purely for audit traceability.
 *
 * @param supabase     Service-role Supabase client
 * @param bookingId    The booking UUID
 * @param cancellationId  The booking_cancellations.id (or null if unavailable)
 * @param cancellationLabel  "administrativa" | "self-service" — used in description text
 */
export async function markPointsAsClawedBack(
  supabase: SupabaseClient,
  bookingId: string,
  cancellationId: string | null,
  cancellationLabel: "administrativa" | "self-service",
): Promise<void> {
  try {
    // 1. Fetch all succeeded payment transactions for this booking
    const { data: transactions, error: txErr } = await supabase
      .from("payment_transactions")
      .select("charge_reference_id, charge_context")
      .eq("booking_id", bookingId)
      .eq("status", "succeeded");

    if (txErr || !transactions || transactions.length === 0) return;

    // Collect charge_reference_ids that have an associated reference type
    const refEntries: { reference_id: string; reference_type: string }[] = [];
    for (const tx of transactions) {
      const refId = tx.charge_reference_id;
      const ctx = tx.charge_context || "booking_deposit";
      const refType = CHARGE_CONTEXT_TO_REFERENCE_TYPE[ctx] || "booking";
      if (refId) {
        refEntries.push({ reference_id: String(refId), reference_type: refType });
      }
    }

    if (refEntries.length === 0) return;

    // 2. Fetch all 'earned' points transactions for these reference_ids
    const referenceIds = refEntries.map((e) => e.reference_id);
    const { data: earnedTx, error: earnedErr } = await supabase
      .from("toursred_points_transactions")
      .select("id, wallet_id, user_id, reference_id, reference_type, balance_after")
      .in("reference_id", referenceIds)
      .eq("type", "earned");

    if (earnedErr || !earnedTx || earnedTx.length === 0) return;

    // 3. For each earned record, insert a clawback marker (amount=0)
    const descText = `Marcado como reclamado por cancelación ${cancellationLabel} total` +
      `${cancellationId ? ` (booking_cancellation_id: ${cancellationId})` : ""}` +
      ` — ver deducción real en type=redeemed del mismo booking`;

    const inserts = earnedTx.map((pt) => ({
      wallet_id: pt.wallet_id,
      user_id: pt.user_id,
      amount: 0,
      balance_after: pt.balance_after,
      type: "clawback" as const,
      description: descText,
      reference_id: pt.reference_id,
      reference_type: pt.reference_type,
    }));

    const { error: insertErr } = await supabase
      .from("toursred_points_transactions")
      .insert(inserts);

    if (insertErr) {
      console.error("markPointsAsClawedBack insert error:", insertErr);
    }
  } catch (e) {
    console.error("markPointsAsClawedBack exception:", e);
  }
}
