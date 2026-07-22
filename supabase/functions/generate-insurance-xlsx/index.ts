import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";
import * as XLSX from "npm:xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function formatDateMX(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr + "T12:00:00");
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return dateStr;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { booking_id } = await req.json();
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Obtener datos de la reserva
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        booking_code,
        travel_insurance_included,
        tour:tours(name, start_date, end_date),
        agency:agencies(name)
      `)
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      throw new Error("Reserva no encontrada");
    }

    if (!booking.travel_insurance_included) {
      return new Response(JSON.stringify({ error: "Esta reserva no incluye seguro de viajero" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Obtener viajeros (excluyendo mascotas)
    const { data: travelers, error: travelersError } = await supabase
      .from("booking_travelers")
      .select("*")
      .eq("booking_id", booking_id)
      .neq("categoria_viajero", "mascota")
      .eq("is_cancelled", false)
      .order("created_at", { ascending: true });

    if (travelersError) {
      throw new Error("Error al obtener viajeros: " + travelersError.message);
    }

    // Encabezados del template de Universal Assistance
    const headers = [
      "Nombre",
      "Apellido",
      "País",
      "Tipo de documento",
      "Número de documento",
      "Fecha de nacimiento",
      "Email",
      "Nombre contacto emergencia",
      "Teléfono contacto emergencia",
    ];

    const rows = (travelers || []).map((t) => {
      const nameParts = (t.nombre || "").trim().split(/\s+/);
      // Heurística: primer token = nombre, el resto = apellido
      const nombre = nameParts[0] || "";
      const apellido = nameParts.slice(1).join(" ") || "";
      const tipoDoc = t.documento_tipo === "pasaporte" ? "PASAPORTE" : "CURP";

      return [
        nombre,
        apellido,
        "México",
        tipoDoc,
        (t.documento_numero || "").toUpperCase(),
        formatDateMX(t.fecha_nacimiento),
        t.email || "",
        t.emergency_contact_name || "",
        t.emergency_contact_phone || "",
      ];
    });

    const worksheetData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(worksheetData);

    // Estilo de columnas (anchos)
    ws["!cols"] = [
      { wch: 20 }, // Nombre
      { wch: 25 }, // Apellido
      { wch: 12 }, // País
      { wch: 18 }, // Tipo de documento
      { wch: 22 }, // Número de documento
      { wch: 18 }, // Fecha de nacimiento
      { wch: 30 }, // Email
      { wch: 30 }, // Nombre contacto emergencia
      { wch: 22 }, // Teléfono contacto emergencia
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pasajeros");

    // Segunda hoja con metadatos de la reserva
    const metaWs = XLSX.utils.aoa_to_sheet([
      ["Campo", "Valor"],
      ["Código de reserva", booking.booking_code],
      ["Tour", (booking.tour as any)?.name || ""],
      ["Agencia", (booking.agency as any)?.name || ""],
      ["Fecha inicio", formatDateMX((booking.tour as any)?.start_date)],
      ["Fecha fin", formatDateMX((booking.tour as any)?.end_date)],
      ["Total viajeros asegurados", rows.length],
    ]);
    metaWs["!cols"] = [{ wch: 25 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, metaWs, "Reserva");

    const xlsxBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const base64 = btoa(String.fromCharCode(...new Uint8Array(xlsxBuffer)));

    const filename = `seguro_${booking.booking_code}_pasajeros.xlsx`;

    return new Response(
      JSON.stringify({ success: true, base64, filename }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("generate-insurance-xlsx error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
