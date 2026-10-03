// Los 11 generadores automaticos de CFDI mandan `payment_method: "PUE"` a
// FacturAPI en cada timbrado, pero nunca lo guardaban en
// `cfdi_invoices.payment_method_sat` -- medido el 03-oct-2026: 72 de 72
// filas en NULL (pendiente 7 de la entrada 33). `generate-manual-cfdi` si lo
// guardaba (admite PPD, por eso lo necesitaba), y es el unico de los 12 que
// no tenia el hueco.
//
// El valor ya se conocia en el momento del UPDATE que marca `status:
// "stamped"` -- es literal, no requiere una llamada nueva. Esta guardia
// falla si algun generador vuelve a quedarse sin guardarlo junto al status.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const generadoresAutomaticos = [
  'generate-booking-cfdi',
  'generate-booking-installment-cfdi',
  'generate-cancellation-commission-cfdi',
  'generate-commission-cfdi',
  'generate-credit-note-for-item-cancellation',
  'generate-featured-slot-cfdi',
  'generate-membership-cfdi',
  'generate-optional-service-cfdi',
  'generate-post-booking-insurance-cfdi',
  'generate-supplement-cfdi',
  'substitute-cfdi-for-partial-cancellation',
];

for (const nombre of generadoresAutomaticos) {
  const fuente = readFileSync(`supabase/functions/${nombre}/index.ts`, 'utf8');
  assert.ok(
    /payment_method:\s*["']PUE["']/.test(fuente),
    `${nombre}: se esperaba que siguiera mandando payment_method: "PUE" a FacturAPI`
  );
  // El UPDATE que marca status: "stamped" debe incluir payment_method_sat a
  // pocas lineas de distancia (mismo objeto), no en cualquier parte del archivo.
  const cercaDelStamp = /status:\s*["']stamped["'][^}]{0,80}payment_method_sat:\s*["']PUE["']/.test(fuente);
  assert.ok(cercaDelStamp, `${nombre}: payment_method_sat no esta junto al UPDATE que marca status: "stamped"`);
}

// generate-manual-cfdi admite PPD, no solo PUE: su valor viene del request,
// no es un literal fijo. Confirma que sigue siendo dinamico y no se congelo
// a "PUE" por error al tocar los otros 11.
{
  const fuente = readFileSync('supabase/functions/generate-manual-cfdi/index.ts', 'utf8');
  assert.ok(/payment_method_sat:\s*paymentMethod/.test(fuente), 'generate-manual-cfdi deberia seguir guardando el payment_method dinamico (PUE o PPD)');
}

console.log(`OK: los ${generadoresAutomaticos.length} generadores automaticos guardan payment_method_sat junto al status stamped; generate-manual-cfdi sigue siendo dinamico.`);
