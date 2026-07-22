import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ValidateGiftCardRequest {
  code: string;
  action: "validate" | "redeem";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;

    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (!authError && user) {
        userId = user.id;
      }
    }

    const { code, action }: ValidateGiftCardRequest = await req.json();

    if (!code) {
      return new Response(
        JSON.stringify({ error: "Gift card code is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const cleanCode = code.toUpperCase().replace(/\s+/g, "");

    const { data: giftCard, error: giftCardError } = await supabase
      .from("gift_cards")
      .select("*")
      .eq("code", cleanCode)
      .single();

    const ipAddress = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
    const userAgent = req.headers.get("user-agent") || "unknown";

    if (giftCardError || !giftCard) {
      await supabase.from("gift_card_redemption_attempts").insert({
        gift_card_id: null,
        code_entered: cleanCode,
        user_id: userId,
        ip_address: ipAddress,
        user_agent: userAgent,
        success: false,
        failure_reason: "Code not found",
      });

      return new Response(
        JSON.stringify({
          valid: false,
          error: "Código de tarjeta de regalo inválido"
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (giftCard.status === "redeemed") {
      await supabase.from("gift_card_redemption_attempts").insert({
        gift_card_id: giftCard.id,
        code_entered: cleanCode,
        user_id: userId,
        ip_address: ipAddress,
        user_agent: userAgent,
        success: false,
        failure_reason: "Already redeemed",
      });

      return new Response(
        JSON.stringify({
          valid: false,
          error: "Esta tarjeta de regalo ya ha sido canjeada"
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (giftCard.status === "expired" || new Date(giftCard.expires_at) < new Date()) {
      await supabase.from("gift_card_redemption_attempts").insert({
        gift_card_id: giftCard.id,
        code_entered: cleanCode,
        user_id: userId,
        ip_address: ipAddress,
        user_agent: userAgent,
        success: false,
        failure_reason: "Expired",
      });

      return new Response(
        JSON.stringify({
          valid: false,
          error: "Esta tarjeta de regalo ha expirado"
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (giftCard.status === "cancelled") {
      await supabase.from("gift_card_redemption_attempts").insert({
        gift_card_id: giftCard.id,
        code_entered: cleanCode,
        user_id: userId,
        ip_address: ipAddress,
        user_agent: userAgent,
        success: false,
        failure_reason: "Cancelled",
      });

      return new Response(
        JSON.stringify({
          valid: false,
          error: "Esta tarjeta de regalo ha sido cancelada"
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (action === "validate") {
      return new Response(
        JSON.stringify({
          valid: true,
          amount: giftCard.amount,
          currency: giftCard.currency,
          expiresAt: giftCard.expires_at,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (action === "redeem") {
      if (!userId) {
        return new Response(
          JSON.stringify({
            error: "Debes iniciar sesión para canjear esta tarjeta de regalo",
            requiresAuth: true,
          }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const { data: user, error: userError } = await supabase
        .from("users")
        .select("id, role")
        .eq("id", userId)
        .single();

      if (userError || !user || user.role !== "traveler") {
        return new Response(
          JSON.stringify({
            error: "Solo los viajeros pueden canjear tarjetas de regalo"
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const { data: wallet, error: walletError } = await supabase
        .from("toursred_cash_wallets")
        .select("id, balance")
        .eq("user_id", userId)
        .eq("is_active", true)
        .single();

      if (walletError || !wallet) {
        return new Response(
          JSON.stringify({
            error: "No se pudo encontrar tu monedero ToursRed Cash"
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const { error: updateBalanceError } = await supabase.rpc("update_wallet_balance", {
        p_user_id: userId,
        p_amount: giftCard.amount,
        p_type: "gift_card",
        p_description: `Tarjeta de regalo canjeada: ${giftCard.code}`,
        p_reference_id: giftCard.id,
        p_reference_type: "gift_card",
      });

      if (updateBalanceError) {
        console.error("Error updating wallet balance:", updateBalanceError);

        await supabase.from("gift_card_redemption_attempts").insert({
          gift_card_id: giftCard.id,
          code_entered: cleanCode,
          user_id: userId,
          ip_address: ipAddress,
          user_agent: userAgent,
          success: false,
          failure_reason: "Wallet update failed",
        });

        return new Response(
          JSON.stringify({
            error: "Error al actualizar tu monedero. Por favor intenta nuevamente"
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const { error: updateGiftCardError } = await supabase
        .from("gift_cards")
        .update({
          status: "redeemed",
          redeemed_by: userId,
          redeemed_at: new Date().toISOString(),
        })
        .eq("id", giftCard.id);

      if (updateGiftCardError) {
        console.error("Error updating gift card:", updateGiftCardError);
      } else {
        // Poliza contable: canje de gift card
        await supabase.rpc("create_accounting_entry_for_gift_card_redemption", { p_gift_card_id: giftCard.id });
      }

      await supabase.from("gift_card_redemption_attempts").insert({
        gift_card_id: giftCard.id,
        code_entered: cleanCode,
        user_id: userId,
        ip_address: ipAddress,
        user_agent: userAgent,
        success: true,
        failure_reason: null,
      });

      const { data: updatedWallet } = await supabase
        .from("toursred_cash_wallets")
        .select("balance")
        .eq("id", wallet.id)
        .single();

      return new Response(
        JSON.stringify({
          success: true,
          amount: giftCard.amount,
          currency: giftCard.currency,
          newBalance: updatedWallet?.balance || wallet.balance + giftCard.amount,
          message: `¡Tarjeta de regalo canjeada exitosamente! Se han agregado $${giftCard.amount} MXN a tu ToursRed Cash.`,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in redeem-gift-card function:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
