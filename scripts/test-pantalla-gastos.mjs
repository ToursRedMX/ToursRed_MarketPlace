#!/usr/bin/env node
/**
 * Contrato de la pantalla de captura de gastos.
 *
 * ============================================================================
 * QUE CUBRE Y POR QUE NO ES UNA PRUEBA DE TIPOS
 * ============================================================================
 *
 * `test-gastos-operacion.sql` ya prueba la base de datos y `test-cfdi-xml.mjs`
 * el lector de CFDI. Lo que NINGUNO de los dos puede probar son tres promesas
 * que solo viven en la pantalla, y que son justo las que Axel pidio:
 *
 *   1. El total en pesos se CALCULA solo pero se puede EDITAR. Si un dia
 *      alguien lo vuelve de solo lectura "para que no se descuadre", el gasto
 *      deja de poder asentar lo que de verdad salio del banco.
 *
 *   2. El XML PROPONE, no decide. Los campos que rellena el CFDI siguen siendo
 *      editables y el XML completo se guarda.
 *
 *   3. La cuenta contable se elige de una lista de cuentas de GASTO. Si el
 *      selector dejara de filtrar por `account_type`, la pantalla ofreceria
 *      Bancos y el trigger de la base rechazaria el guardado sin que nadie
 *      entienda por que.
 *
 * Es una prueba de contrato sobre el fuente, igual que
 * `test-mfa-challenge-fresco.mjs` y `test-reporte-maestro-contrato.mjs`: el
 * repo no tiene runner de componentes y montar uno no es parte de esto.
 * Comprueba lo que se puede comprobar sin renderizar, que es mas de cero.
 *
 *   node scripts/test-pantalla-gastos.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tsx = readFileSync('src/pages/admin/AdminGastos.tsx', 'utf8');
const casos = [];

// --- 1. El total en pesos es editable --------------------------------------
casos.push(() => {
  // El campo tiene onChange. Un `readOnly` o un `disabled` aqui rompe la
  // promesa entera.
  const campo = tsx.match(/value=\{totalMxnVisible\}[^/]*/s)?.[0] ?? '';
  assert.ok(campo, 'el campo del total en pesos ya no muestra totalMxnVisible');
  assert.ok(/onChange=/.test(campo), 'el total en pesos dejo de ser editable');
  assert.ok(!/readOnly|disabled/.test(campo), 'el total en pesos se volvio de solo lectura');
});

// --- 2. Y se calcula mientras nadie lo toque -------------------------------
casos.push(() => {
  assert.ok(/totalMxnPropuesto\s*=\s*useMemo/.test(tsx),
    'debe existir el total propuesto como total x tipo de cambio');
  assert.ok(/redondear\(totalDivisa \* aNumero\(form\.tipo_cambio\)\)/.test(tsx),
    'la formula del total en pesos cambio');
  assert.ok(/totalMxnAMano \? redondear\(aNumero\(form\.total_mxn\)\) : totalMxnPropuesto/.test(tsx),
    'lo que se guarda debe ser el valor editado si lo hubo, y la formula si no');
  assert.ok(/setTotalMxnAMano\(false\)/.test(tsx),
    'debe haber forma de volver al total calculado');
});

// --- 3. El XML propone: los campos siguen editables ------------------------
casos.push(() => {
  // Los cuatro campos que rellena el CFDI. Ninguno puede quedar bloqueado
  // "porque ya lo dijo la factura".
  for (const campo of ['proveedor', 'descripcion', 'subtotal', 'iva']) {
    const re = new RegExp(`value=\\{form\\.${campo}\\}[^/]*?onChange`, 's');
    assert.ok(re.test(tsx), `el campo ${campo} dejo de ser editable tras cargar el XML`);
  }
});

// --- 4. El XML completo se guarda ------------------------------------------
casos.push(() => {
  // La promesa es poder volver a derivar un monto del original si manana
  // alguien duda de una cifra capturada.
  assert.ok(/cfdi_xml: texto/.test(tsx), 'ya no se guarda el XML completo del CFDI');
  assert.ok(/form\.cfdi_xml \? \{ cfdi_xml: form\.cfdi_xml \}/.test(tsx),
    'el XML debe ir en el insert/update cuando lo hay');
});

// --- 5. Se valida el RFC contra el de la plataforma ------------------------
casos.push(() => {
  assert.ok(/leerCfdiParaGasto\(texto, rfcPlataforma\)/.test(tsx),
    'el CFDI debe leerse contra el RFC de la plataforma, no contra cualquiera');
  assert.ok(/pac_issuer_rfc/.test(tsx),
    'el RFC debe salir de platform_settings.pac_issuer_rfc');
  // Y si el lector rechaza, no se rellena nada.
  assert.ok(/if \(lectura\.error \|\| !lectura\.propuesta\) \{[\s\S]{0,120}return;/.test(tsx),
    'un CFDI rechazado no debe rellenar campos');
});

// --- 6. Solo se ofrecen cuentas de gasto -----------------------------------
casos.push(() => {
  assert.ok(/\.in\('account_type', \['gasto', 'costo'\]\)/.test(tsx),
    'el selector de cuentas debe pedir solo cuentas de gasto o costo');
  assert.ok(/\.eq\('is_active', true\)/.test(tsx),
    'no se deben ofrecer cuentas dadas de baja');
});

// --- 7. Los errores de carga se muestran -----------------------------------
casos.push(() => {
  // Una lista vacia por falta de permisos se lee igual que "no hay gastos".
  // Ese error ya salio caro en otras pantallas del panel.
  assert.ok(/resGastos\.error \|\| resRec\.error \|\| resCuentas\.error/.test(tsx),
    'los errores de las consultas deben mirarse, no ignorarse');
  assert.ok(/No se pudieron cargar los gastos/.test(tsx),
    'un fallo de carga debe decirse, no quedarse en una lista vacia');
});

// --- 8. Registrar pasa por la funcion, no por un UPDATE ---------------------
casos.push(() => {
  // Cambiar `estado` a mano dejaria el gasto registrado SIN asiento. La base
  // lo impide con un CHECK, pero la pantalla no debe siquiera intentarlo.
  assert.ok(/rpc\('registrar_gasto_operacion'/.test(tsx),
    'registrar debe llamar a la funcion que genera el asiento');
  assert.ok(!/update\(\{ estado: 'registrado'/.test(tsx),
    'la pantalla no debe marcar un gasto como registrado por su cuenta');
});

// --- 9. El alta de plantillas existe y valida el dia -----------------------
casos.push(() => {
  assert.ok(/from\('gastos_recurrentes'\)\.insert\(fila\)/.test(tsx),
    'debe poder crearse una plantilla desde la pantalla');
  assert.ok(/from\('gastos_recurrentes'\)\.update\(fila\)/.test(tsx),
    'debe poder editarse una plantilla');
  // Del 1 al 28: un recurrente al 31 no existiria en febrero. La base lo exige
  // con un CHECK; la pantalla debe decirlo antes de chocar contra el.
  assert.ok(/dia < 1 \|\| dia > 28/.test(tsx),
    'el dia del mes debe validarse entre 1 y 28 antes de mandar el insert');
});

// --- 10. Borrar una plantilla que ya genero gastos se rechaza --------------
casos.push(() => {
  // La llave foranea es ON DELETE SET NULL, asi que borrar NO falla... y ese es
  // el problema: los gastos generados pierden el vinculo y salen del indice
  // unico que impide dos borradores del mismo periodo. Recrear la plantilla
  // despues generaria un segundo borrador de un mes ya capturado.
  assert.ok(/count: 'exact', head: true/.test(tsx),
    'antes de borrar hay que contar los gastos que la plantilla genero');
  assert.ok(/\(count \?\? 0\) > 0/.test(tsx),
    'con gastos generados, borrar debe rechazarse');
  assert.ok(/Desactivala en vez de borrarla/.test(tsx),
    'hay que decir que la alternativa es desactivar');
});

// --- 11. Un borrador en moneda extranjera no se registra con el relleno ----
casos.push(() => {
  // Fallo reproducido: el generador inserta `tipo_cambio = 1` sin mirar la
  // moneda, asi que el borrador de Claude salia con 260 USD a TC 1 y se
  // asentaba como 260 pesos -- veinte veces menos que el gasto real, y
  // perfectamente cuadrado, asi que ninguna suma lo cazaba.
  assert.ok(/g\.moneda !== 'MXN' && Number\(g\.tipo_cambio\) === 1/.test(tsx),
    'debe detectarse el tipo de cambio de relleno en moneda extranjera');
  // El bloque del boton se recorta por sus delimitadores y no por una distancia
  // en caracteres: la primera version usaba `[\s\S]{0,400}` y fallaba porque el
  // boton mide 544. Una cota asi se rompe con cualquier reformato y no dice
  // nada sobre el comportamiento.
  const desde = tsx.indexOf('void registrar(g)');
  assert.ok(desde > 0, 'no se encontro el boton de registrar');
  const boton = tsx.slice(desde, tsx.indexOf('</button>', desde));
  assert.ok(/Registrar/.test(boton), 'el boton de registrar cambio de etiqueta');
  assert.ok(/disabled=\{guardando \|\| faltaTipoDeCambio\(g\)\}/.test(boton),
    'registrar debe quedar deshabilitado mientras falte el tipo de cambio');
  assert.ok(/falta el TC/.test(tsx),
    'la fila debe decir que falta el tipo de cambio, no mostrar TC 1 como si fuera un dato');
});

// --- 12. Un gasto fuera del mes visible NO se queda invisible -------------
casos.push(() => {
  // Fallo reproducido en la PRIMERA captura real (11-sep-2026): el lector de
  // CFDI toma la fecha de la FACTURA —una de TikTok del 01-jul— mientras el
  // filtro sigue en el mes actual. La pantalla decia "guardado" y enseguida
  // mostraba la lista vacia, que se lee como que no se guardo nada. La fila si
  // existia, en julio.
  assert.ok(/const periodoDelGasto = form\.fecha\.slice\(0, 7\);/.test(tsx),
    'hay que comparar el mes del gasto contra el del filtro');
  assert.ok(/const cambiaDeMes = periodoDelGasto !== periodo;/.test(tsx),
    'la comparacion es contra el periodo que se esta viendo');

  // Mover el filtro, no solo avisar: el objetivo es VER el gasto.
  assert.ok(/if \(cambiaDeMes\) \{[\s\S]{0,200}setPeriodo\(periodoDelGasto\);/.test(tsx),
    'el filtro tiene que saltar al mes del gasto, no dejar al usuario cambiandolo a mano');

  // Y decir por que se movio, o el salto de mes parece un error de la pantalla.
  assert.ok(/porque esa es su fecha/.test(tsx),
    'hay que explicar por que el gasto quedo en otro mes');

  // `cargar` no se llama dos veces: cambiar `periodo` ya dispara el efecto.
  const desde = tsx.indexOf('const cambiaDeMes');
  const bloque = tsx.slice(desde, tsx.indexOf('const registrar', desde));
  assert.equal((bloque.match(/void cargar\(\)/g) || []).length, 1,
    'al cambiar de mes el efecto de `periodo` ya recarga: llamar a cargar() ademas la pide dos veces');
});

// --- 13. Queda registrado quien captura, sin anular el DEFAULT -------------
casos.push(() => {
  // La columna existia desde el principio y nadie la llenaba: la primera
  // captura real nacio con `creado_por` nulo. Importa porque `gastos_operacion`
  // NO tiene trigger de auditoria y el permiso can_manage_expenses esta hecho
  // para darselo a alguien que no es el super admin.
  assert.ok(/supabase\.auth\.getUser\(\)/.test(tsx),
    'hay que saber quien esta capturando');

  // Se ancla en `const autor =` y no en la expresion completa: la primera
  // version apuntaba a `sesion.user?.id` y se rompio sola al agregarle el
  // manejo de error a getUser(), que volvio la lectura opcional.
  const desde = tsx.indexOf('const autor =');
  assert.ok(desde > 0, 'no se encontro la resolucion del autor');
  assert.ok(/const \{ data: sesion, error: errorSesion \} = await supabase\.auth\.getUser\(\);/.test(tsx),
    'getUser puede fallar y un gasto sin autor no se distingue de uno del cron: hay que desestructurar el error');
  assert.ok(/\[AdminGastos\] no se pudo resolver quien captura el gasto/.test(tsx),
    'si no se puede resolver el autor tiene que quedar en el log, no en silencio');
  const bloque = tsx.slice(desde, tsx.indexOf('setGuardando(false)', desde));

  // LA PARTE QUE IMPORTA: si no hay usuario, la clave se OMITE. En Postgres un
  // NULL explicito ANULA el DEFAULT —solo aplica cuando la columna no viene—,
  // asi que `creado_por: autor ?? null` desactivaria la red de la migracion
  // 20260911020000. Salio al probar la migracion contra Postgres 16.
  assert.ok(/\.\.\.\(autor \? \{ creado_por: autor \} : \{\}\)/.test(bloque),
    'la clave se omite cuando no hay autor; mandar null explicito anula el DEFAULT auth.uid()');
  assert.ok(!/creado_por:\s*\w+\s*\?\?\s*null/.test(bloque),
    'mandar `creado_por: x ?? null` desactiva el DEFAULT de la tabla');

  // Solo en el alta: en una edicion sobrescribiria al autor original.
  assert.ok(/\.update\(fila\)\.eq\('id', form\.id\)/.test(bloque),
    'la edicion no debe tocar creado_por');
});

// --- 14. La migracion del DEFAULT existe y cubre las dos tablas ------------
casos.push(() => {
  const sql = readFileSync(
    'supabase/migrations/20260911020000_autor_del_gasto_por_defecto.sql', 'utf8');
  for (const tabla of ['gastos_operacion', 'gastos_recurrentes']) {
    assert.ok(
      new RegExp(`ALTER TABLE public\\.${tabla}\\s+ALTER COLUMN creado_por SET DEFAULT auth\\.uid\\(\\);`)
        .test(sql),
      `falta el DEFAULT auth.uid() en ${tabla}`);
  }
  // La asercion que hace que un retroceso falle en la migracion y no meses
  // despues con una tabla llena de nulos.
  assert.ok(/RAISE EXCEPTION 'Sin DEFAULT auth\.uid\(\) en: %'/.test(sql),
    'la migracion debe fallar si el DEFAULT no quedo puesto');
  // NOT NULL romperia el generador de recurrentes y las cargas por service role.
  assert.ok(!/SET NOT NULL/.test(sql),
    'poner NOT NULL romperia el cron y el service role, que no tienen auth.uid()');
});

// --- 15. Pagar un gasto registrado, con parcialidades ---------------------
casos.push(() => {
  // Faltaba entero: la pantalla solo ofrecia «Editar» en borrador, y
  // `registrar_gasto_operacion` sale temprano si ya esta registrado. No habia
  // forma de marcar pagado un gasto ya asentado, ni de abonar una parte.
  assert.ok(/rpc\('pagar_gasto_operacion'/.test(tsx),
    'el pago tiene que pasar por la funcion, que genera el asiento 205/102 en la misma transaccion');

  // NUNCA un UPDATE directo a pagado_en: eso separa la vista del libro, porque
  // el bloque 19 decide caja contra pasivo con los pagos y el asiento no
  // existiria. Es la trampa que describia —mal— el comentario de la migracion
  // original.
  assert.ok(!/update\(\{\s*pagado_en/.test(tsx),
    'escribir pagado_en a mano deja el gasto pagado en la vista y sin asiento en el libro');

  // El saldo sale de la SUMA de pagos, no de un si/no.
  assert.ok(/const saldoDe = \(g: Gasto\): number =>/.test(tsx),
    'hace falta el saldo por gasto para poder pagar parcial');
  assert.ok(/pagadoPorGasto/.test(tsx),
    'el abonado se acumula por gasto: un gasto puede tener varios pagos');

  // El monto propuesto es el saldo, no el total: pagar de mas se rechaza.
  assert.ok(/monto: saldoDe\(g\)\.toFixed\(2\)/.test(tsx),
    'el modal debe proponer el SALDO; proponer el total invita al sobrepago');

  // Y se valida antes de ir al servidor, para no mostrar un error de Postgres.
  assert.ok(/excede el saldo pendiente/.test(tsx),
    'el sobrepago debe avisarse en la pantalla, ademas de rechazarlo la base');
});

// --- 16. Los totales entienden un pago parcial ----------------------------
casos.push(() => {
  // La version anterior sumaba el TOTAL de los gastos segun `pagado_en`, asi
  // que un gasto de 232 con 100 abonados mandaba los 232 completos a «por
  // pagar» y cero a «ya pagado». Con parcialidades eso es simplemente falso.
  const desde = tsx.indexOf('const totales = useMemo');
  assert.ok(desde > 0, 'no se encontro el calculo de totales');
  const bloque = tsx.slice(desde, tsx.indexOf('}, [gastos', desde));

  assert.ok(/pagadoPorGasto\.get\(g\.id\)/.test(bloque),
    '«ya pagado» tiene que sumar lo ABONADO, no el total de los marcados pagados');
  assert.ok(/saldoDe\(g\)/.test(bloque),
    '«por pagar» tiene que sumar los SALDOS, no el total de los no marcados');
  assert.ok(!/filter\(\(g\) => g\.pagado_en\)/.test(bloque),
    'partir por pagado_en no sabe representar un pago parcial');
});

let ok = 0;
for (const caso of casos) { caso(); ok++; }
console.log(`Contrato de la pantalla de gastos: ${ok}/${casos.length} casos OK`);
