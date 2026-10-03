// La cancelacion total repartia la penalizacion 60/40 (agencia/plataforma) y
// la parcial 70/30 -- la unica diferencia entre los dos caminos de
// cancelacion de reservas. Decision de Axel el 03-oct-2026 (pendiente 8 de
// la entrada 33): homologar a 70/30 en ambos, que ya era el estandar de la
// parcial.
//
// Esta guardia falla si alguno de los dos vuelve a desviarse del 70/30, o si
// las dos partes de cualquiera de los dos dejan de sumar 1 (dinero que se
// perderia o se duplicaria en el reparto).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const total = readFileSync('supabase/functions/process-traveler-cancellation/index.ts', 'utf8');
const matchAgencia = total.match(/PENALTY_AGENCY_SHARE\s*=\s*([\d.]+)/);
const matchPlataforma = total.match(/PENALTY_PLATFORM_SHARE\s*=\s*([\d.]+)/);
assert.ok(matchAgencia && matchPlataforma, 'process-traveler-cancellation: no se encontraron PENALTY_AGENCY_SHARE/PENALTY_PLATFORM_SHARE');
const agenciaTotal = Number(matchAgencia[1]);
const plataformaTotal = Number(matchPlataforma[1]);

const parcial = readFileSync('supabase/functions/process-partial-cancellation/index.ts', 'utf8');
// penaltyAmount * 0.7 (agencia) y penaltyAmount * 0.3 (plataforma), en ese
// orden de aparicion -- son las dos ramas de amountToAgency/amountToPlatform
// cuando refundPct > 0 (la otra rama, refundPct === 0, usa commissionRate y
// no es parte de este pendiente: no se toca ni se afirma aqui).
const matchesParcial = [...parcial.matchAll(/penaltyAmount \* ([\d.]+)/g)].map(m => Number(m[1]));
assert.equal(matchesParcial.length, 2, `process-partial-cancellation: se esperaban 2 usos de "penaltyAmount * N", se encontraron ${matchesParcial.length}`);
const [agenciaParcial, plataformaParcial] = matchesParcial;

assert.equal(agenciaTotal, 0.7, `process-traveler-cancellation: PENALTY_AGENCY_SHARE deberia ser 0.7, es ${agenciaTotal}`);
assert.equal(plataformaTotal, 0.3, `process-traveler-cancellation: PENALTY_PLATFORM_SHARE deberia ser 0.3, es ${plataformaTotal}`);
assert.equal(agenciaParcial, 0.7, `process-partial-cancellation: el multiplicador de agencia deberia ser 0.7, es ${agenciaParcial}`);
assert.equal(plataformaParcial, 0.3, `process-partial-cancellation: el multiplicador de plataforma deberia ser 0.3, es ${plataformaParcial}`);

assert.equal(agenciaTotal + plataformaTotal, 1, 'process-traveler-cancellation: agencia + plataforma debe sumar 1 (sin perder ni duplicar dinero)');
assert.equal(agenciaParcial + plataformaParcial, 1, 'process-partial-cancellation: agencia + plataforma debe sumar 1 (sin perder ni duplicar dinero)');

console.log('OK: cancelacion total y parcial reparten la penalizacion 70/30 por igual, y cada una suma 1.');
