-- ===========================================================================
-- Soportes de un gasto: bucket privado y tabla con RLS
-- ===========================================================================
--
-- LO QUE SE PRUEBA Y POR QUE
--
-- Una factura de proveedor trae RFC, domicilio fiscal y razon social. Si el
-- bucket queda PUBLICO, ese documento esta a un `curl` de distancia de
-- cualquiera que adivine la ruta. El caso 1 lo afirma explicitamente, porque es
-- el unico error de esta migracion que no se nota usando la pantalla: todo
-- funcionaria igual de bien, y de mas.
--
-- El resto son las reglas que impiden que la tabla y el bucket se separen: dos
-- filas apuntando al mismo objeto, una fila sin archivo, un gasto borrado
-- dejando soportes colgando.
--
--   psql -v ON_ERROR_STOP=1 -f test-soportes-de-gasto.sql
-- ===========================================================================

BEGIN;

\ir fixture-movimientos.sql

-- El esquema `storage` de Supabase no existe en un Postgres pelado. Se simula
-- con las DOS tablas que la migracion toca, y con las columnas que usa. No es
-- una copia fiel de Supabase: es lo justo para que las politicas se puedan
-- crear y contar, que es lo que aqui se afirma.
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id), name text, owner uuid);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

\ir ../supabase/migrations/20260910080000_vista_movimientos_financieros.sql
\ir ../supabase/migrations/20260910200000_corregir_membresia_y_pasivo_por_comisiones.sql
\ir ../supabase/migrations/20260910240000_captura_de_gastos_de_operacion.sql
\ir ../supabase/migrations/20260910250000_tipo_de_cambio_pendiente_en_recurrentes.sql
\ir ../supabase/migrations/20260911020000_autor_del_gasto_por_defecto.sql
\ir ../supabase/migrations/20260911040000_pagar_gasto_en_parcialidades.sql
\ir ../supabase/migrations/20260911050000_pago_de_gasto_no_toca_la_poliza.sql
\ir ../supabase/migrations/20260911060000_el_pago_del_gasto_lleva_su_fecha.sql
-- La que se prueba.
\ir ../supabase/migrations/20260911070000_soportes_de_gasto.sql

-- ===========================================================================
-- 1. EL BUCKET ES PRIVADO
-- ===========================================================================
DO $$
DECLARE v_pub boolean; v_limite bigint; v_mimes text[];
BEGIN
  SELECT public, file_size_limit, allowed_mime_types
  INTO v_pub, v_limite, v_mimes
  FROM storage.buckets WHERE id = 'gastos-comprobantes';

  IF v_pub IS NULL THEN RAISE EXCEPTION 'Caso 1: el bucket no se creo'; END IF;
  IF v_pub THEN
    RAISE EXCEPTION 'Caso 1: el bucket quedo PUBLICO. Una factura trae RFC y domicilio fiscal.';
  END IF;
  IF v_limite <> 10485760 THEN
    RAISE EXCEPTION 'Caso 1: el limite de tamano es %, se esperaba 10485760', v_limite;
  END IF;
  IF NOT ('application/pdf' = ANY(v_mimes)) THEN
    RAISE EXCEPTION 'Caso 1: el bucket no acepta PDF, que es justo el caso de Claude';
  END IF;
  RAISE NOTICE 'Caso 1 OK';
END $$;

-- ===========================================================================
-- 2. Volver a correr la migracion no re-abre el bucket
-- ===========================================================================
-- El INSERT trae `ON CONFLICT DO UPDATE`. Si alguien abriera el bucket a mano,
-- la siguiente corrida tiene que cerrarlo, no respetarlo.
DO $$
DECLARE v_pub boolean;
BEGIN
  UPDATE storage.buckets SET public = true WHERE id = 'gastos-comprobantes';

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('gastos-comprobantes','gastos-comprobantes', false, 10485760,
          ARRAY['application/pdf'])
  ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

  SELECT public INTO v_pub FROM storage.buckets WHERE id = 'gastos-comprobantes';
  IF v_pub THEN
    RAISE EXCEPTION 'Caso 2: re-aplicar la migracion dejo el bucket publico';
  END IF;
  RAISE NOTICE 'Caso 2 OK';
END $$;

-- ===========================================================================
-- 3. Las politicas existen, en la tabla Y en el bucket
-- ===========================================================================
-- Sin la de SELECT sobre storage.objects no se pueden firmar URLs: los
-- archivos quedan inalcanzables aunque su fila exista. Es un fallo silencioso
-- desde el lado de la base.
DO $$
DECLARE v_n integer; v_falta text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_policies
  WHERE schemaname='public' AND tablename='soportes_de_gasto';
  IF v_n <> 3 THEN RAISE EXCEPTION 'Caso 3: % politicas en soportes_de_gasto, se esperaban 3', v_n; END IF;

  -- Y que sean las tres que son: lectura, alta y baja. Sin UPDATE.
  SELECT string_agg(cmd, ',' ORDER BY cmd) INTO v_falta FROM pg_policies
  WHERE schemaname='public' AND tablename='soportes_de_gasto';
  IF v_falta <> 'DELETE,INSERT,SELECT' THEN
    RAISE EXCEPTION 'Caso 3: las politicas de la tabla son (%), se esperaban DELETE,INSERT,SELECT', v_falta;
  END IF;

  SELECT string_agg(cmd, ',' ORDER BY cmd) INTO v_falta FROM pg_policies
  WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'gastos_comprobantes%';
  IF v_falta IS DISTINCT FROM 'DELETE,INSERT,SELECT' THEN
    RAISE EXCEPTION 'Caso 3: las politicas del bucket son (%), se esperaban DELETE,INSERT,SELECT', v_falta;
  END IF;
  RAISE NOTICE 'Caso 3 OK';
END $$;

-- ===========================================================================
-- 4. RLS esta ENCENDIDO en la tabla
-- ===========================================================================
-- Tener politicas y no tener RLS es peor que no tener ninguna de las dos: se
-- ve seguro y no lo es.
DO $$
DECLARE v_rls boolean;
BEGIN
  SELECT relrowsecurity INTO v_rls FROM pg_class
  WHERE oid = 'public.soportes_de_gasto'::regclass;
  IF NOT coalesce(v_rls, false) THEN
    RAISE EXCEPTION 'Caso 4: soportes_de_gasto tiene politicas pero RLS apagado';
  END IF;
  RAISE NOTICE 'Caso 4 OK';
END $$;

-- ===========================================================================
-- 5. Dos filas NO pueden apuntar al mismo objeto
-- ===========================================================================
-- Si pudieran, borrar una dejaria a la otra apuntando a un archivo que ya no
-- existe, y la pantalla mostraria un enlace roto sin saberlo.
DO $$
DECLARE v_g uuid; v_error boolean := false;
BEGIN
  INSERT INTO public.gastos_operacion
    (fecha, cuenta_contable, proveedor, descripcion, moneda, tipo_cambio,
     subtotal, iva, total, total_mxn)
  VALUES ('2026-07-01','602','CLAUDE','Suscripcion','MXN',1,100,16,116,116)
  RETURNING id INTO v_g;

  INSERT INTO public.soportes_de_gasto (gasto_id, ruta, nombre, tipo_mime, bytes)
  VALUES (v_g, v_g || '/factura.pdf', 'factura.pdf', 'application/pdf', 5000);

  BEGIN
    INSERT INTO public.soportes_de_gasto (gasto_id, ruta, nombre)
    VALUES (v_g, v_g || '/factura.pdf', 'otra.pdf');
  EXCEPTION WHEN unique_violation THEN v_error := true;
  END;

  IF NOT v_error THEN
    RAISE EXCEPTION 'Caso 5: dos soportes quedaron apuntando al mismo objeto';
  END IF;
  RAISE NOTICE 'Caso 5 OK';
END $$;

-- ===========================================================================
-- 6. Una fila sin ruta o sin nombre no entra
-- ===========================================================================
DO $$
DECLARE v_g uuid; v_n integer := 0;
BEGIN
  SELECT id INTO v_g FROM public.gastos_operacion WHERE proveedor='CLAUDE';

  BEGIN
    INSERT INTO public.soportes_de_gasto (gasto_id, ruta, nombre)
    VALUES (v_g, '   ', 'x.pdf');
  EXCEPTION WHEN check_violation THEN v_n := v_n + 1;
  END;

  BEGIN
    INSERT INTO public.soportes_de_gasto (gasto_id, ruta, nombre)
    VALUES (v_g, 'a/b.pdf', '');
  EXCEPTION WHEN check_violation THEN v_n := v_n + 1;
  END;

  -- Y un tamano que el bucket jamas habria aceptado.
  BEGIN
    INSERT INTO public.soportes_de_gasto (gasto_id, ruta, nombre, bytes)
    VALUES (v_g, 'a/enorme.pdf', 'enorme.pdf', 20000000);
  EXCEPTION WHEN check_violation THEN v_n := v_n + 1;
  END;

  IF v_n <> 3 THEN
    RAISE EXCEPTION 'Caso 6: se esperaban 3 rechazos y hubo %', v_n;
  END IF;
  RAISE NOTICE 'Caso 6 OK';
END $$;

-- ===========================================================================
-- 7. Un gasto en borrador tambien acepta soportes
-- ===========================================================================
-- Es el flujo que se pidio: cargar XML en masa como borradores y DESPUES
-- colgarle a cada uno su PDF. Si la tabla exigiera un gasto registrado, ese
-- camino no existiria.
DO $$
DECLARE v_g uuid; v_estado text; v_n integer;
BEGIN
  INSERT INTO public.gastos_operacion
    (fecha, cuenta_contable, proveedor, descripcion, moneda, tipo_cambio,
     subtotal, iva, total, total_mxn)
  VALUES ('2026-07-02','602','EN BORRADOR','Algo','MXN',1,50,8,58,58)
  RETURNING id INTO v_g;

  SELECT estado INTO v_estado FROM public.gastos_operacion WHERE id = v_g;
  IF v_estado <> 'borrador' THEN
    RAISE EXCEPTION 'Caso 7: el gasto nuevo deberia nacer en borrador y nacio %', v_estado;
  END IF;

  INSERT INTO public.soportes_de_gasto (gasto_id, ruta, nombre)
  VALUES (v_g, v_g || '/soporte.pdf', 'soporte.pdf');

  SELECT count(*) INTO v_n FROM public.soportes_de_gasto WHERE gasto_id = v_g;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Caso 7: un borrador no acepto su soporte';
  END IF;
  RAISE NOTICE 'Caso 7 OK';
END $$;

-- ===========================================================================
-- 8. Borrar el gasto se lleva sus filas de soporte
-- ===========================================================================
-- OJO: se lleva las FILAS, no los objetos del bucket. Postgres no sabe de
-- Storage. Un gasto registrado no se borra nunca (se cancela), asi que en la
-- practica no pasa; si algun dia se permite, hay que barrer el bucket tambien.
DO $$
DECLARE v_g uuid; v_n integer;
BEGIN
  SELECT id INTO v_g FROM public.gastos_operacion WHERE proveedor='EN BORRADOR';
  DELETE FROM public.gastos_operacion WHERE id = v_g;

  SELECT count(*) INTO v_n FROM public.soportes_de_gasto WHERE gasto_id = v_g;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Caso 8: quedaron % soportes colgando de un gasto borrado', v_n;
  END IF;
  RAISE NOTICE 'Caso 8 OK';
END $$;

-- ===========================================================================
-- 9. El autor se sella solo
-- ===========================================================================
DO $$
DECLARE v_g uuid; v_autor uuid;
BEGIN
  -- El fixture lee la identidad de `prueba.usuario`, no del claim del JWT.
  PERFORM set_config('prueba.usuario', 'c0000000-0000-0000-0000-0000000000a1', true);
  SELECT id INTO v_g FROM public.gastos_operacion WHERE proveedor='CLAUDE';

  INSERT INTO public.soportes_de_gasto (gasto_id, ruta, nombre)
  VALUES (v_g, v_g || '/contrato.pdf', 'contrato.pdf');

  SELECT subido_por INTO v_autor FROM public.soportes_de_gasto
  WHERE ruta = v_g || '/contrato.pdf';

  IF v_autor IS DISTINCT FROM 'c0000000-0000-0000-0000-0000000000a1'::uuid THEN
    RAISE EXCEPTION 'Caso 9: el soporte no quedo sellado con su autor, quedo %', v_autor;
  END IF;
  RAISE NOTICE 'Caso 9 OK';
END $$;

-- ===========================================================================
-- 10. Nada de esto cambio la vista de movimientos
-- ===========================================================================
-- Los soportes son papeles, no dinero. Si asomaran a la vista serian un
-- movimiento financiero inventado.
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.vista_movimientos_financieros
  WHERE origen_tabla = 'soportes_de_gasto';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Caso 10: los soportes se asomaron a la vista de movimientos';
  END IF;

  SELECT count(*) INTO v_n FROM public.vista_movimientos_financieros
  WHERE abs(caja - (pasivo + ingreso)) > 0.01;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Caso 10: % filas descuadradas', v_n;
  END IF;
  RAISE NOTICE 'Caso 10 OK';
END $$;

ROLLBACK;

\echo 'Soportes de gasto: 10/10 casos OK'
