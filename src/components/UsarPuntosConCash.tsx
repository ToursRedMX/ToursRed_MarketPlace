import { Award } from 'lucide-react';
import { formatCurrencyMXN } from '../utils/formatCurrency';
import { PUNTOS_POR_PESO, maxPuntosPermitidos, puntosAAplicar } from '../lib/puntosConTope';

// Casilla de puntos ToursRed para suplementos, extras y mensualidades (regla de
// Axel, 16-oct-2026): los puntos cubren como maximo el 50% de un pago y, por
// ahora, se combinan con ToursRed Cash o con tarjeta (Stripe). Es la misma casilla que el flujo de
// reserva (BookingFlowStep4): marcada aplica min(saldo, tope). El tope vive en
// src/lib/puntosConTope.ts y el servidor lo vuelve a validar.

interface Props {
  saldoPuntos: number;
  /** Lo que se puede pagar con puntos: subtotal del suplemento/extra o el abono. */
  baseMxn: number;
  usar: boolean;
  onChange: (usar: boolean) => void;
}

export default function UsarPuntosConCash({ saldoPuntos, baseMxn, usar, onChange }: Props) {
  const max = maxPuntosPermitidos(baseMxn);
  if (saldoPuntos <= 0 || max <= 0) return null;

  const aplicados = puntosAAplicar(usar, saldoPuntos, baseMxn);

  return (
    <div className="mt-3">
      <label className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${usar ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`}>
        <input
          type="checkbox"
          checked={usar}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 text-amber-600"
        />
        <Award className="w-4 h-4 text-amber-600" />
        <div className="flex-1">
          <span className="text-sm font-medium text-gray-800">
            Usar {Math.min(saldoPuntos, max).toLocaleString('es-MX')} puntos ToursRed
          </span>
          <p className="text-xs text-gray-500">
            100 puntos = $1 MXN · máximo 50% del pago ({max.toLocaleString('es-MX')} pts)
          </p>
        </div>
      </label>
      {usar && aplicados > 0 && (
        <p className="text-xs text-gray-600 mt-2">
          Se aplicarán {aplicados.toLocaleString('es-MX')} puntos ({formatCurrencyMXN(aplicados / PUNTOS_POR_PESO)});
          el resto se cobra con el método que elegiste.
        </p>
      )}
    </div>
  );
}
