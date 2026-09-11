-- ============================================================================
-- Soportes de un gasto: el PDF de la factura y lo que haga falta
-- ============================================================================
--
-- QUE FALTABA
--
-- El XML del CFDI se guarda entero desde `20260910240000` (`cfdi_xml`), pero:
--
--   * no hay donde poner un PDF. La factura de Claude, por ejemplo, llega SOLO
--     en PDF: no hay CFDI que capturar y hoy el gasto se queda sin respaldo;
--   * cuando SI hay CFDI, el PDF del proveedor tampoco tiene donde vivir, ni el
--     comprobante de la transferencia, ni el contrato que ampara el servicio.
--
-- POR QUE UNA TABLA Y NO UNA COLUMNA
--
-- Una columna `pdf_path` alcanza para un archivo. Un gasto real junta varios —
-- factura, comprobante de pago, contrato— y cuando eso pasa, la columna se
-- convierte en `pdf_path_2`. La tabla lo resuelve de una vez y encima deja
-- rastro de QUIEN subio cada cosa y CUANDO.
--
-- LO QUE NO GUARDA: EL ARCHIVO
--
-- Los bytes van a Storage, en un bucket PRIVADO. La tabla guarda la ruta. Es lo
-- que ya hace el resto del repo (`agency-documents`, `signed-contracts`) y es
-- lo correcto: un `bytea` de 3 MB por gasto infla cada backup y cada consulta
-- que haga `select *` — y la pantalla de gastos hace exactamente eso.
--
-- El bucket es privado A PROPOSITO. Una factura trae RFC, domicilio fiscal y
-- razon social; un bucket publico la deja a un `curl` de distancia para
-- cualquiera que adivine la ruta. Se lee con URL firmada y caducidad.
--
-- EL PDF GENERICO NO VIVE AQUI
--
-- El que ToursRed arma a partir del XML se genera al vuelo en el navegador y no
-- se guarda: sale del XML cada vez, asi que no puede desincronizarse del
-- original ni ocupa almacenamiento. Aqui solo entra lo que ALGUIEN SUBE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. El bucket
-- ---------------------------------------------------------------------------
-- 10 MB: un PDF de factura pesa decenas de KB, pero un escaneo de contrato se
-- va a varios MB. El mismo limite que `agency-documents` y `signed-contracts`.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'gastos-comprobantes', 'gastos-comprobantes', false, 10485760,
  -- XML incluido: un gasto puede traer el CFDI como archivo aparte del que ya
  -- se guarda en `cfdi_xml`, y hay proveedores que mandan el respaldo en
  -- imagen (un ticket fotografiado).
  ARRAY['application/pdf', 'text/xml', 'application/xml',
        'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. La tabla
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.soportes_de_gasto (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gasto_id    uuid NOT NULL REFERENCES public.gastos_operacion(id) ON DELETE CASCADE,
  -- Ruta DENTRO del bucket, sin el nombre del bucket. Unica para que dos filas
  -- no puedan apuntar al mismo objeto: borrar una dejaria a la otra colgando.
  ruta        text NOT NULL UNIQUE,
  nombre      text NOT NULL,
  tipo_mime   text,
  bytes       bigint,
  subido_por  uuid REFERENCES public.users(id) DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT soportes_ruta_no_vacia   CHECK (length(btrim(ruta)) > 0),
  CONSTRAINT soportes_nombre_no_vacio CHECK (length(btrim(nombre)) > 0),
  -- Coherente con el limite del bucket. Si alguien inserta la fila sin haber
  -- subido el archivo, al menos no puede mentir sobre su tamano.
  CONSTRAINT soportes_bytes_razonable CHECK (bytes IS NULL OR (bytes > 0 AND bytes <= 10485760))
);

-- `ON DELETE CASCADE` borra la FILA cuando se borra el gasto, pero NO el
-- objeto en Storage: Postgres no sabe de buckets. Un gasto registrado no se
-- borra nunca (se cancela), asi que en la practica no pasa; si algun dia se
-- permite, hay que barrer el bucket en el mismo camino.
COMMENT ON TABLE public.soportes_de_gasto IS
  'Archivos que respaldan un gasto de operacion: el PDF de la factura, el comprobante de pago, un contrato. Los bytes viven en el bucket privado gastos-comprobantes; aqui solo la ruta. El PDF que ToursRed genera a partir del XML NO se guarda: se arma al vuelo.';

CREATE INDEX IF NOT EXISTS soportes_de_gasto_por_gasto
  ON public.soportes_de_gasto(gasto_id);

ALTER TABLE public.soportes_de_gasto ENABLE ROW LEVEL SECURITY;

-- Mismo permiso que gobierna los gastos: si puedes ver el gasto, puedes ver su
-- respaldo. No se inventa un permiso nuevo.
DROP POLICY IF EXISTS soportes_de_gasto_lectura ON public.soportes_de_gasto;
CREATE POLICY soportes_de_gasto_lectura ON public.soportes_de_gasto
  FOR SELECT TO authenticated
  USING (public.puede_gestionar_gastos());

DROP POLICY IF EXISTS soportes_de_gasto_alta ON public.soportes_de_gasto;
CREATE POLICY soportes_de_gasto_alta ON public.soportes_de_gasto
  FOR INSERT TO authenticated
  WITH CHECK (public.puede_gestionar_gastos());

-- Se puede BORRAR un soporte (subiste el archivo equivocado) pero no EDITARLO:
-- cambiar la `ruta` de una fila existente la separaria del objeto que apunta.
-- Borrar y volver a subir deja rastro; editar no.
DROP POLICY IF EXISTS soportes_de_gasto_baja ON public.soportes_de_gasto;
CREATE POLICY soportes_de_gasto_baja ON public.soportes_de_gasto
  FOR DELETE TO authenticated
  USING (public.puede_gestionar_gastos());

REVOKE ALL ON public.soportes_de_gasto FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.soportes_de_gasto TO authenticated;
GRANT ALL ON public.soportes_de_gasto TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Las politicas del bucket
-- ---------------------------------------------------------------------------
-- Las cuatro apuntan al MISMO permiso. Sin la de SELECT no se pueden firmar
-- URLs y los archivos quedan inalcanzables aunque su fila exista.
DROP POLICY IF EXISTS gastos_comprobantes_lectura ON storage.objects;
CREATE POLICY gastos_comprobantes_lectura ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'gastos-comprobantes' AND public.puede_gestionar_gastos());

DROP POLICY IF EXISTS gastos_comprobantes_alta ON storage.objects;
CREATE POLICY gastos_comprobantes_alta ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'gastos-comprobantes' AND public.puede_gestionar_gastos());

DROP POLICY IF EXISTS gastos_comprobantes_baja ON storage.objects;
CREATE POLICY gastos_comprobantes_baja ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'gastos-comprobantes' AND public.puede_gestionar_gastos());

-- Sin UPDATE a proposito: sobrescribir un objeto cambiaria el contenido del
-- respaldo dejando la fila intacta. Para corregir, se borra y se sube de nuevo.

-- ---------------------------------------------------------------------------
-- 4. Aserciones
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_publico boolean;
  v_politicas integer;
BEGIN
  SELECT public INTO v_publico FROM storage.buckets WHERE id = 'gastos-comprobantes';
  IF v_publico IS NULL THEN
    RAISE EXCEPTION 'El bucket gastos-comprobantes no quedo creado.';
  END IF;
  IF v_publico THEN
    RAISE EXCEPTION 'El bucket gastos-comprobantes quedo PUBLICO: una factura trae RFC y domicilio fiscal.';
  END IF;

  SELECT count(*) INTO v_politicas FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname LIKE 'gastos_comprobantes%';
  IF v_politicas <> 3 THEN
    RAISE EXCEPTION 'Se esperaban 3 politicas de storage y hay %.', v_politicas;
  END IF;

  SELECT count(*) INTO v_politicas FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'soportes_de_gasto';
  IF v_politicas <> 3 THEN
    RAISE EXCEPTION 'Se esperaban 3 politicas en soportes_de_gasto y hay %.', v_politicas;
  END IF;

  RAISE NOTICE 'OK: bucket privado gastos-comprobantes y soportes_de_gasto con RLS';
END $$;
