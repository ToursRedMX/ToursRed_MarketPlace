import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function buildDomicilio(a: {
  street?: string | null;
  exterior_number?: string | null;
  interior_number?: string | null;
  colony?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
}): string {
  const parts: string[] = [];
  if (a.street) parts.push(a.street);
  if (a.exterior_number) parts.push(`#${a.exterior_number}`);
  if (a.interior_number) parts.push(`Int. ${a.interior_number}`);
  const streetLine = parts.join(" ");
  const rest: string[] = [];
  if (a.colony) rest.push(a.colony);
  if (a.city) rest.push(a.city);
  if (a.state) rest.push(a.state);
  if (a.postal_code) rest.push(a.postal_code);
  if (a.country) rest.push(a.country);
  return [streetLine, rest.join(", ")].filter(Boolean).join(", ") || "A confirmar";
}

function generateFolio(agencyId: string): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(2)))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `TRG-${Date.now()}-${hex}`;
}


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });

    // Must be admin or account_executive
    const { data: actorUser } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
    const actorRole = actorUser?.role;
    if (!["admin", "super_admin", "account_executive"].includes(actorRole)) {
      return new Response(JSON.stringify({ error: "Acceso denegado" }), { status: 403, headers: corsHeaders });
    }

    const body = await req.json();
    // action: 'approve' | 'reject' | 'resign'
    const { agency_id, action } = body;
    const document_ids: string[] | undefined = body.document_ids;
    const rejectionReason: string | undefined = body.rejection_reason;
    const newCommissionPct: number | undefined = body.new_commission_percentage;

    if (!agency_id || !action) {
      return new Response(JSON.stringify({ error: "Faltan campos requeridos" }), { status: 400, headers: corsHeaders });
    }

    if (!["approve", "reject", "resign"].includes(action)) {
      return new Response(JSON.stringify({ error: "Acción inválida" }), { status: 400, headers: corsHeaders });
    }

    // approve/reject require document_ids
    if (action !== "resign" && !document_ids?.length) {
      return new Response(JSON.stringify({ error: "Faltan campos requeridos: document_ids" }), { status: 400, headers: corsHeaders });
    }

    if (action === "reject" && !rejectionReason) {
      return new Response(JSON.stringify({ error: "Se requiere motivo de rechazo" }), { status: 422, headers: corsHeaders });
    }

    if (action === "resign" && (newCommissionPct === undefined || newCommissionPct === null)) {
      return new Response(JSON.stringify({ error: "Se requiere new_commission_percentage para resign" }), { status: 400, headers: corsHeaders });
    }

    // ── RESIGN: initiate commission amendment for an active agency ───────────
    if (action === "resign") {
      const { data: agency } = await supabase
        .from("agencies")
        .select("id, user_id, razon_social, rfc, representante_legal_nombre, name, contact_email, commission_percentage, onboarding_status, street, exterior_number, interior_number, colony, city, state, postal_code, country")
        .eq("id", agency_id)
        .maybeSingle();

      if (!agency) return new Response(JSON.stringify({ error: "Agencia no encontrada" }), { status: 404, headers: corsHeaders });

      if (agency.onboarding_status !== "active") {
        return new Response(
          JSON.stringify({ error: "Solo se puede iniciar una enmienda para agencias activas" }),
          { status: 409, headers: corsHeaders }
        );
      }

      // Validate required contract fields
      const missingFields: string[] = [];
      if (!agency.razon_social?.trim())               missingFields.push("razon_social");
      if (!agency.rfc?.trim())                        missingFields.push("rfc");
      if (!agency.street?.trim())                    missingFields.push("street");
      if (!agency.postal_code?.trim())               missingFields.push("postal_code");
      if (!agency.representante_legal_nombre?.trim()) missingFields.push("representante_legal_nombre");

      if (missingFields.length > 0) {
        return new Response(
          JSON.stringify({ error: `Campos faltantes en perfil: ${missingFields.join(", ")}`, missing_fields: missingFields }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Load platform default commission
      const { data: platformSettings } = await supabase
        .from("platform_settings")
        .select("agency_commission_percentage")
        .limit(1)
        .maybeSingle();

      const platformDefault = platformSettings?.agency_commission_percentage ?? 15;

      // Supersede any existing pending amendment before creating a new one
      await supabase.from("contract_acceptances")
        .update({ status: "superseded" })
        .eq("agency_id", agency_id)
        .eq("status", "pending");

      const folio = generateFolio(agency_id);
      const nowDate = new Date();
      const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

      const specialClause = newCommissionPct !== platformDefault
        ? `No obstante lo dispuesto en la Cláusula Quinta, las partes acuerdan que la comisión aplicable a "${agency.razon_social ?? agency.name}" será del ${newCommissionPct}% conforme a negociación particular formalizada en la aprobación de su expediente.`
        : undefined;

      const contractData: ContractData = {
        razonSocial:           agency.razon_social ?? agency.name ?? "Sin nombre",
        rfcAgencia:            agency.rfc!,
        domicilioFiscal:       buildDomicilio(agency),
        representanteLegal:    agency.representante_legal_nombre!,
        emailContacto:         agency.contact_email ?? "",
        folioContrato:         folio,
        fechaDia:              String(nowDate.getDate()).padStart(2, "0"),
        fechaMes:              MESES[nowDate.getMonth()],
        fechaAnio:             String(nowDate.getFullYear()),
        versionContrato:       "2.0",
        commissionPercentage:  newCommissionPct,
        specialCommissionClause: specialClause,
      };

      // Generate amendment PDF
      // deno-lint-ignore no-explicit-any
      const printer  = new (PdfPrinter as any)(await getFonts());
      const docDef   = buildContractDocDefinition(contractData);
      const pdfDoc   = printer.createPdfKitDocument(docDef);
      const pdfBytes = await pdfDocToBytes(pdfDoc);

      const pdfPath = `${agency_id}/contrato_agencia/enmienda_comision_${Date.now()}.pdf`;
      const { error: uploadErr } = await supabase.storage
        .from("agency-documents")
        .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });

      if (uploadErr) {
        console.error("Amendment PDF upload error:", uploadErr.message);
        return new Response(JSON.stringify({ error: "Error al generar el PDF de enmienda" }), { status: 500, headers: corsHeaders });
      }

      // Supersede prior contrato_agencia documents
      await supabase.from("agency_documents")
        .update({ is_current: false, status: "superseded" })
        .eq("agency_id", agency_id)
        .eq("document_type_key", "contrato_agencia")
        .eq("is_current", true);

      // Insert new contrato_agencia document (the amendment PDF)
      await supabase.from("agency_documents").insert({
        agency_id:         agency_id,
        document_type_key: "contrato_agencia",
        storage_path:      pdfPath,
        file_name:         `Enmienda_Comision_${folio}.pdf`,
        mime_type:         "application/pdf",
        is_current:        true,
        status:            "pending_review",
        uploaded_by:       user.id,
      });

      // Create the amendment contract_acceptances record
      const { data: newAcceptance, error: insertErr } = await supabase
        .from("contract_acceptances")
        .insert({
          agency_id:                    agency_id,
          contract_version:             "2.0",
          folio_contrato:               folio,
          status:                       "pending",
          amendment_type:               "commission_change",
          commission_percentage_proposed: newCommissionPct,
        })
        .select("id")
        .single();

      if (insertErr || !newAcceptance) {
        console.error("Insert contract_acceptances error:", insertErr?.message);
        return new Response(JSON.stringify({ error: "Error al crear el registro de enmienda" }), { status: 500, headers: corsHeaders });
      }

      // Point agencies.pending_amendment_id to the new record — do NOT touch onboarding_status
      await supabase.from("agencies")
        .update({ pending_amendment_id: newAcceptance.id })
        .eq("id", agency_id);

      // Audit log
      await supabase.from("audit_logs").insert({
        actor_id:   user.id,
        event_type: "commission_amendment_initiated",
        severity:   "info",
        old_values: { commission_percentage: agency.commission_percentage },
        new_values: { commission_percentage: newCommissionPct },
        metadata:   { agency_id, folio, amendment_id: newAcceptance.id },
      }).select();

      // Notify agency user
      if (agency.user_id) {
        await supabase.from("notifications").insert({
          user_id: agency.user_id,
          type:    "agency_documents_approved",
          title:   "Enmienda de comisión — Firma requerida",
          message: `Se ha generado una enmienda a tu contrato con una nueva comisión del ${newCommissionPct}%. Revísala y firma para que entre en vigor.`,
        }).select();
      }

      return new Response(
        JSON.stringify({ ok: true, folio, amendment_id: newAcceptance.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── APPROVE / REJECT individual documents ───────────────────────────────
    if (!document_ids?.length) {
      return new Response(JSON.stringify({ error: "Faltan document_ids" }), { status: 400, headers: corsHeaders });
    }

    const newDocStatus = action === "approve" ? "approved" : "rejected";

    const { error: updateErr } = await supabase
      .from("agency_documents")
      .update({
        status:           newDocStatus,
        rejection_reason: action === "reject" ? rejectionReason : null,
        reviewed_by:      action === "reject" ? null : user.id,
        reviewed_at:      action === "reject" ? null : new Date().toISOString(),
      })
      .in("id", document_ids)
      .eq("agency_id", agency_id);

    if (updateErr) {
      console.error("Update error:", updateErr);
      return new Response(JSON.stringify({ error: "Error al actualizar documentos" }), { status: 500, headers: corsHeaders });
    }

    if (action === "approve") {
      // Get agency persona_type to filter required documents
      const { data: agencyRow } = await supabase
        .from("agencies")
        .select("persona_type")
        .eq("id", agency_id)
        .maybeSingle();

      const personaType = agencyRow?.persona_type ?? "persona_fisica";

      const { data: reqTypes } = await supabase
        .from("document_types")
        .select("key, applies_to")
        .eq("required", true)
        .neq("key", "contrato_agencia");

      const requiredKeys = (reqTypes ?? [])
        .filter((r: any) => r.applies_to === "ambas" || r.applies_to === personaType)
        .map((r: any) => r.key);

      // All required current docs that are APPROVED (not just "not rejected")
      const { data: currentDocs } = await supabase
        .from("agency_documents")
        .select("document_type_key")
        .eq("agency_id", agency_id)
        .eq("is_current", true)
        .eq("status", "approved")
        .neq("document_type_key", "contrato_agencia");

      const presentKeys = (currentDocs ?? []).map((d: any) => d.document_type_key);
      const allPresent = requiredKeys.every((k: string) => presentKeys.includes(k));

      if (allPresent) {
        const { data: agency } = await supabase
          .from("agencies")
          .select("id, user_id, razon_social, rfc, representante_legal_nombre, name, contact_email, commission_percentage, street, exterior_number, interior_number, colony, city, state, postal_code, country")
          .eq("id", agency_id)
          .maybeSingle();

        if (!agency) return new Response(JSON.stringify({ error: "Agencia no encontrada" }), { status: 404, headers: corsHeaders });

        const missingFields: string[] = [];
        if (!agency.razon_social?.trim())               missingFields.push("razon_social");
        if (!agency.rfc?.trim())                        missingFields.push("rfc");
        if (!agency.street?.trim())                    missingFields.push("street");
        if (!agency.postal_code?.trim())               missingFields.push("postal_code");
        if (!agency.representante_legal_nombre?.trim()) missingFields.push("representante_legal_nombre");

        if (missingFields.length > 0) {
          return new Response(
            JSON.stringify({ error: `No se puede generar el contrato. Campos faltantes: ${missingFields.join(", ")}`, missing_fields: missingFields }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Idempotency: if a pending contract_acceptances already exists, skip
        const { data: existingAcceptance } = await supabase
          .from("contract_acceptances")
          .select("id, folio_contrato")
          .eq("agency_id", agency_id)
          .eq("status", "pending")
          .maybeSingle();

        if (existingAcceptance) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const folio = generateFolio(agency_id);

        // Create contract_acceptances record — PDF is generated at signing time (verify-contract-otp)
        await supabase.from("contract_acceptances").insert({
          agency_id:        agency_id,
          contract_version: "1.0",
          folio_contrato:   folio,
          status:           "pending",
          amendment_type:   "initial",
        });

        await supabase
          .from("agencies")
          .update({ onboarding_status: "pending_signature" })
          .eq("id", agency_id)
          .in("onboarding_status", ["pending_documents", "pending_review"]);

        if (agency.user_id) {
          await supabase.from("notifications").insert({
            user_id: agency.user_id,
            type:    "agency_documents_approved",
            title:   "Documentos aprobados — contrato listo para firmar",
            message: "Tus documentos han sido verificados. Ya puedes revisar y firmar tu contrato de colaboración con ToursRed.",
          }).select();
        }

        // Send approval email via smtp2go
        if (agency.contact_email) {
          try {
            const { data: emailSettings } = await supabase
              .from("email_settings")
              .select("smtp_api_key, contact_email")
              .maybeSingle();

            const { data: platformSettings } = await supabase
              .from("platform_settings")
              .select("platform_url")
              .maybeSingle();

            if (emailSettings?.smtp_api_key) {
              const fromEmail = emailSettings.contact_email || "contacto@toursred.com";
              const appUrl    = platformSettings?.platform_url || "https://toursredmx.netlify.app";
              const logoUrl   = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/images/email-logo.png`;
              const agencyName = agency.name ?? agency.razon_social ?? "tu agencia";
              const toEmail    = agency.contact_email as string;

              const htmlContent = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f3f4f6;">
  <table role="presentation" style="width:100%;border-collapse:collapse;">
    <tr><td align="center" style="padding:40px 20px;">
      <table role="presentation" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#ffffff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.07);">
        <tr>
          <td style="padding:36px 40px 28px 40px;text-align:center;background:linear-gradient(135deg,#059669 0%,#047857 100%);border-radius:12px 12px 0 0;">
            <img src="${logoUrl}" alt="ToursRed" style="max-width:160px;height:auto;margin-bottom:16px;background:white;padding:8px 16px;border-radius:8px;" />
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">Documentos aprobados</h1>
            <p style="margin:8px 0 0 0;color:rgba(255,255,255,0.85);font-size:15px;">${agencyName}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px 40px 40px;">
            <p style="margin:0 0 20px 0;color:#374151;font-size:16px;line-height:28px;">
              Hola,<br><br>
              Hemos revisado y <strong>aprobado</strong> todos los documentos de tu agencia <strong>${agencyName}</strong>. Tu expediente esta completo y verificado.
            </p>
            <div style="background-color:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:20px 24px;margin:0 0 28px 0;">
              <p style="margin:0;color:#065f46;font-size:15px;line-height:24px;">
                El siguiente paso es <strong>revisar y firmar tu contrato de colaboracion</strong> con ToursRed. Ingresa a la plataforma para leer el borrador del contrato y proceder a la firma electronica.
              </p>
            </div>
            <div style="text-align:center;margin-bottom:32px;">
              <a href="${appUrl}/agencia/onboarding"
                 style="display:inline-block;padding:15px 48px;background-color:#059669;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">
                Revisar y firmar contrato
              </a>
            </div>
            <p style="margin:0;color:#6b7280;font-size:14px;line-height:22px;">
              Si tienes dudas, contactanos en <a href="mailto:${fromEmail}" style="color:#059669;text-decoration:none;">${fromEmail}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px;background-color:#f9fafb;border-radius:0 0 12px 12px;text-align:center;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#d1d5db;font-size:12px;">&copy; ${new Date().getFullYear()} ToursRed. Todos los derechos reservados.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

              await fetch("https://api.smtp2go.com/v3/email/send", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Smtp2go-Api-Key": emailSettings.smtp_api_key },
                body: JSON.stringify({
                  sender:    fromEmail,
                  to:        [toEmail],
                  subject:   `Documentos aprobados — Firma tu contrato — ToursRed`,
                  html_body: htmlContent,
                }),
              });
            }
          } catch (emailErr) {
            console.error("Error sending approval email:", emailErr);
          }
        }
      }
    } else {
      // Reject
      // Cancel any pending contract_acceptances before reverting status
      await supabase
        .from("contract_acceptances")
        .update({ status: "failed" })
        .eq("agency_id", agency_id)
        .eq("status", "pending");

      // Clear pending_amendment_id so the agency doesn't see a stale amendment
      await supabase
        .from("agencies")
        .update({ onboarding_status: "pending_documents", pending_amendment_id: null, documents_submitted_at: null })
        .eq("id", agency_id)
        .in("onboarding_status", ["pending_review", "pending_documents", "pending_signature"]);

      const { data: agencyRow } = await supabase
        .from("agencies")
        .select("user_id, name, contact_email")
        .eq("id", agency_id)
        .maybeSingle();

      // Fetch the rejected documents' type keys
      const { data: rejectedDocs } = await supabase
        .from("agency_documents")
        .select("document_type_key")
        .in("id", document_ids)
        .eq("agency_id", agency_id);

      // Fetch labels for those document types
      const rejectedKeys = (rejectedDocs ?? []).map((d: any) => d.document_type_key);
      let docLabels: string[] = rejectedKeys;
      if (rejectedKeys.length > 0) {
        const { data: docTypes } = await supabase
          .from("document_types")
          .select("key, label")
          .in("key", rejectedKeys);
        const labelMap: Record<string, string> = {};
        for (const dt of docTypes ?? []) labelMap[dt.key] = dt.label;
        docLabels = rejectedKeys.map((k: string) => labelMap[k] || k);
      }

      const docList = docLabels.length > 0 ? docLabels.join(", ") : "Documento(s)";

      if (agencyRow?.user_id) {
        await supabase.from("notifications").insert({
          user_id: agencyRow.user_id,
          type:    "agency_documents_rejected",
          title:   "Documentos requieren corrección",
          message: `Los siguientes documentos fueron rechazados: ${docList}. Motivo: ${rejectionReason}. Por favor súbelos nuevamente.`,
        }).select();

        // Send rejection email via smtp2go
        if (agencyRow.contact_email) {
          try {
            const { data: emailSettings } = await supabase
              .from("email_settings")
              .select("smtp_api_key, contact_email")
              .maybeSingle();

            const { data: platformSettings } = await supabase
              .from("platform_settings")
              .select("platform_url")
              .maybeSingle();

            if (emailSettings?.smtp_api_key) {
              const fromEmail    = emailSettings.contact_email || "contacto@toursred.com";
              const appUrl       = platformSettings?.platform_url || "https://toursredmx.netlify.app";
              const logoUrl      = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/images/email-logo.png`;
              const agencyName   = agencyRow.name ?? "tu agencia";
              const toEmail      = agencyRow.contact_email as string;

              // Build list items HTML for rejected documents
              const docListHtml = docLabels
                .map((label: string) => `<li style="color:#7f1d1d;font-size:15px;line-height:24px;padding:4px 0;">${label}</li>`)
                .join("");

              const htmlContent = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f3f4f6;">
  <table role="presentation" style="width:100%;border-collapse:collapse;">
    <tr><td align="center" style="padding:40px 20px;">
      <table role="presentation" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#ffffff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.07);">
        <tr>
          <td style="padding:36px 40px 28px 40px;text-align:center;background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);border-radius:12px 12px 0 0;">
            <img src="${logoUrl}" alt="ToursRed" style="max-width:160px;height:auto;margin-bottom:16px;background:white;padding:8px 16px;border-radius:8px;" />
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">Documentos requieren corrección</h1>
            <p style="margin:8px 0 0 0;color:rgba(255,255,255,0.85);font-size:15px;">${agencyName}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px 40px 40px;">
            <p style="margin:0 0 20px 0;color:#374151;font-size:16px;line-height:28px;">
              Hola,<br><br>
              Hemos revisado los documentos de tu agencia <strong>${agencyName}</strong> y el siguiente documento(s) requiere(n) ser corregido(s) o resubido(s):
            </p>
            <div style="background-color:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:20px 24px;margin:0 0 28px 0;">
              <p style="margin:0 0 10px 0;color:#991b1b;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Documento(s) rechazado(s)</p>
              <ul style="margin:0;padding:0 0 0 20px;">${docListHtml}</ul>
            </div>
            <div style="background-color:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:20px 24px;margin:0 0 28px 0;">
              <p style="margin:0 0 8px 0;color:#92400e;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Motivo del rechazo</p>
              <p style="margin:0;color:#78350f;font-size:15px;line-height:24px;">${rejectionReason || "El documento no cumple con los requisitos solicitados."}</p>
            </div>
            <div style="text-align:center;margin-bottom:32px;">
              <a href="${appUrl}/agencia/onboarding"
                 style="display:inline-block;padding:15px 48px;background-color:#dc2626;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">
                Corregir mis documentos
              </a>
            </div>
            <p style="margin:0;color:#6b7280;font-size:14px;line-height:22px;">
              Si tienes dudas, contáctanos en <a href="mailto:${fromEmail}" style="color:#dc2626;text-decoration:none;">${fromEmail}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px;background-color:#f9fafb;border-radius:0 0 12px 12px;text-align:center;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#d1d5db;font-size:12px;">&copy; ${new Date().getFullYear()} ToursRed. Todos los derechos reservados.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

              await fetch("https://api.smtp2go.com/v3/email/send", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Smtp2go-Api-Key": emailSettings.smtp_api_key },
                body: JSON.stringify({
                  sender:    fromEmail,
                  to:        [toEmail],
                  subject:   `Documento(s) rechazado(s) en "${agencyName}" — ToursRed`,
                  html_body: htmlContent,
                }),
              });
            }
          } catch (emailErr) {
            console.error("Error sending rejection email:", emailErr);
          }
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Error interno del servidor" }), { status: 500, headers: corsHeaders });
  }
});
