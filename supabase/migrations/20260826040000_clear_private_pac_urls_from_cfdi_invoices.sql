-- Limpieza de las URLs privadas del PAC guardadas en cfdi_invoices.
--
-- Las 13 funciones que timbran CFDIs construian a mano
--     https://www.facturapi.io/v2/invoices/{id}/pdf
-- —la API PRIVADA de FacturAPI, que exige Authorization con la API key secreta—
-- y la guardaban en xml_url / pdf_url. send-cfdi-email las ponia como href en los
-- botones del correo, asi que para el destinatario daban 401. Las 12 que escriben
-- a esta tabla ya dejaron de guardarlas (commit a581dcd) y send-cfdi-email ahora
-- manda el comprobante adjunto.
--
-- Este backfill limpia las filas que ya existian. Es seguro porque:
--
--   1. Ningun consumidor las lee. download-cfdi:127 siempre derivo la URL de
--      pac_invoice_id, y el front las declara en interfaces sin renderizarlas.
--   2. Las 35 filas afectadas tienen pac_invoice_id, verificado antes de aplicar:
--      no se pierde la unica via para recuperar el archivo.
--
-- Se anulan en vez de eliminar las columnas: TravelerInvoices.tsx todavia las
-- incluye en sus 7 SELECT, y un DROP romperia esas consultas. Quitar las columnas
-- es una limpieza posterior, despues de sacarlas del front.
--
-- NO se tocan executive_commissions.cfdi_xml_url / cfdi_pdf_url. Ahi la URL SI es
-- load-bearing: esa tabla no tiene pac_invoice_id y download-executive-cfdi:108
-- extrae el id de la factura parseando la URL guardada. Ademas
-- ExecutiveComisiones.tsx:239 guarda ahi una URL publica de Supabase Storage para
-- los CFDIs subidos a mano, que si funciona. Ver pieza F en PENDIENTES.
--
-- Verificado en ROLLBACK contra la BD real:
--   afectadas=35 | quedan con url=0 | con pac_invoice_id=35 | con uuid_fiscal=35

UPDATE public.cfdi_invoices
   SET xml_url = NULL,
       pdf_url = NULL
 WHERE xml_url IS NOT NULL
    OR pdf_url IS NOT NULL;
