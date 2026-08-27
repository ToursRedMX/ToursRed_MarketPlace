-- Pieza F: executive_commissions guarda la URL privada del PAC como unico id.
--
-- A diferencia de cfdi_invoices —que tiene pac_invoice_id y donde download-cfdi:127
-- deriva la URL de ahi— esta tabla no tenia donde guardar el id de FacturAPI, asi
-- que download-executive-cfdi:109 lo extraia PARSEANDO la URL almacenada:
--
--     const match = storedUrl.match(/\/invoices\/([^\/]+)\//);
--
-- Por eso la migracion 20260826033731 anulo las URLs privadas en cfdi_invoices pero
-- dejo intacta esta tabla: aqui la URL no era vestigial, era load-bearing.
--
-- La columna cfdi_xml_url ademas carga DOS semanticas incompatibles:
--   1. URL privada de FacturAPI, escrita por generate-executive-commission-cfdi.
--   2. URL publica de Supabase Storage, escrita por ExecutiveComisiones.tsx:239
--      cuando el ejecutivo sube su CFDI a mano.
-- download-executive-cfdi trataba a las dos igual, asi que para (2) el regex no
-- matcheaba y devolvia 422 — y el front se lo tragaba en silencio
-- (`if (!res.ok) return`), asi que el boton no hacia nada y no decia nada.
--
-- Esta migracion agrega las dos columnas que faltaban. NO borra ni vacia
-- cfdi_xml_url / cfdi_pdf_url: quedan como estan. Vaciarlas es una decision
-- aparte y no hace falta para arreglar nada.
--
-- Estado de la tabla al escribir esto (verificado contra la BD, 26-ago):
--   3 filas | 1 con CFDI de FacturAPI | 0 subidas a mano | 2 pending sin CFDI
-- El backfill toca exactamente 1 fila. Que todavia no existan filas manuales es
-- la mejor ventana posible para separar las dos semanticas: nace limpio.

alter table public.executive_commissions
  add column if not exists pac_invoice_id text,
  add column if not exists cfdi_source    text;

-- NULL permitido: las filas sin CFDI no declaran origen. El CHECK solo restringe
-- los valores no nulos.
alter table public.executive_commissions
  drop constraint if exists executive_commissions_cfdi_source_check;

alter table public.executive_commissions
  add constraint executive_commissions_cfdi_source_check
  check (cfdi_source is null or cfdi_source in ('pac', 'manual'));

comment on column public.executive_commissions.pac_invoice_id is
  'Id de la factura en FacturAPI. Unica via para descargar XML/PDF de un CFDI '
  'timbrado por el PAC. Antes se extraia parseando cfdi_xml_url.';

comment on column public.executive_commissions.cfdi_source is
  'Origen del CFDI: pac = timbrado por generate-executive-commission-cfdi; '
  'manual = XML subido por el ejecutivo a Supabase Storage. Determina como '
  'download-executive-cfdi resuelve el archivo.';

-- Backfill 1: CFDIs timbrados por el PAC. Se extrae el id con el MISMO regex que
-- usaba download-executive-cfdi, para no perder los que ya estan.
update public.executive_commissions
set pac_invoice_id = substring(coalesce(cfdi_xml_url, cfdi_pdf_url) from '/invoices/([^/]+)/'),
    cfdi_source    = 'pac'
where coalesce(cfdi_xml_url, cfdi_pdf_url) like '%facturapi.io%'
  and substring(coalesce(cfdi_xml_url, cfdi_pdf_url) from '/invoices/([^/]+)/') is not null;

-- Backfill 2: subidas manuales (0 filas hoy; queda para las historicas si aparecen).
update public.executive_commissions
set cfdi_source = 'manual'
where cfdi_source is null
  and cfdi_xml_url is not null
  and cfdi_xml_url not like '%facturapi.io%';
