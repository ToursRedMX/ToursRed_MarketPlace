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

let ok = 0;
for (const caso of casos) { caso(); ok++; }
console.log(`Contrato de la pantalla de gastos: ${ok}/${casos.length} casos OK`);
