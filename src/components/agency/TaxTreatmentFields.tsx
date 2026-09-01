import React, { useEffect, useMemo, useState } from 'react';
import { Info, AlertTriangle } from 'lucide-react';
import {
  calculateTaxBreakdown,
  deriveExemptRatio,
  type TaxTreatment,
} from '../../utils/taxBreakdown';
import { formatCurrencyMXN } from '../../utils/formatCurrency';

/**
 * Captura del tratamiento fiscal de IVA. Uno solo para las TRES entidades
 * (tour, suplemento, servicio opcional) porque el formulario es identico; lo
 * unico que cambia es el precio de referencia sobre el que se capturan los
 * pesos.
 *
 * El valor que persiste es la PROPORCION exenta, no los pesos. En `tours` eso
 * importa: el ratio capturado sobre precio_adulto se aplica solo a las otras
 * cuatro tarifas y al anticipo. Los pesos son la forma de capturar, no el dato.
 */

export interface TaxTreatmentValue {
  taxTreatment: TaxTreatment;
  exemptRatio: number;
}

interface Props {
  value: TaxTreatmentValue;
  /** tours: precio_adulto · supplements: price · optional services: price_per_person */
  referencePrice: number;
  onChange: (next: TaxTreatmentValue) => void;
  /** Se llama con false cuando la captura de 'mixed' no cuadra, para bloquear el guardado. */
  onValidityChange?: (valid: boolean) => void;
  /** Distingue los ids cuando hay varias instancias en la misma pantalla. */
  idPrefix: string;
  referenceLabel?: string;
  compact?: boolean;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const TaxTreatmentFields: React.FC<Props> = ({
  value,
  referencePrice,
  onChange,
  onValidityChange,
  idPrefix,
  referenceLabel = 'Precio de referencia',
  compact = false,
}) => {
  // Los pesos son la forma de capturar; lo que se guarda es la proporcion.
  //
  // Mientras el usuario no toca los campos, lo mostrado se DERIVA del ratio y
  // del precio de referencia en cada render. Sincronizarlo con un useEffect
  // seria un setState dentro de un efecto (react-hooks/set-state-in-effect):
  // un render extra en cascada cada vez que cambia el precio del tour, que es
  // en cada tecla. Derivarlo no cuesta nada y no dispara renders.
  const [typed, setTyped] = useState<{ exempt: string; taxable: string } | null>(null);

  const derived = useMemo(() => {
    if (!(referencePrice > 0) || !value.exemptRatio) return { exempt: '', taxable: '' };
    const exempt = round2(referencePrice * value.exemptRatio);
    return { exempt: exempt.toFixed(2), taxable: round2(referencePrice - exempt).toFixed(2) };
  }, [referencePrice, value.exemptRatio]);

  const exemptInput = typed ? typed.exempt : derived.exempt;
  const taxableInput = typed ? typed.taxable : derived.taxable;
  const setExemptInput = (v: string) => setTyped({ exempt: v, taxable: taxableInput });
  const setTaxableInput = (v: string) => setTyped({ exempt: exemptInput, taxable: v });

  const parsed = useMemo(() => {
    const exempt = parseFloat(exemptInput);
    const taxable = parseFloat(taxableInput);
    return {
      exempt: Number.isFinite(exempt) ? exempt : NaN,
      taxable: Number.isFinite(taxable) ? taxable : NaN,
    };
  }, [exemptInput, taxableInput]);

  const mixedError = useMemo(() => {
    if (value.taxTreatment !== 'mixed') return null;
    if (!(referencePrice > 0)) return 'Captura primero el precio para poder distribuirlo.';
    if (!Number.isFinite(parsed.exempt) || !Number.isFinite(parsed.taxable)) {
      return 'Captura el importe exento y el gravado.';
    }
    if (parsed.exempt < 0 || parsed.taxable < 0) return 'Los importes no pueden ser negativos.';
    const sum = parsed.exempt + parsed.taxable;
    if (Math.abs(sum - referencePrice) > 0.01) {
      return `La suma (${formatCurrencyMXN(sum)}) debe ser igual al precio (${formatCurrencyMXN(referencePrice)}).`;
    }
    if (parsed.exempt <= 0 || parsed.taxable <= 0) {
      return 'En mixto ambas partes deben ser mayores a cero. Si una es cero, usa Exento o IVA 16%.';
    }
    return null;
  }, [value.taxTreatment, parsed, referencePrice]);

  useEffect(() => {
    onValidityChange?.(mixedError === null);
  }, [mixedError, onValidityChange]);

  // Propaga el ratio derivado solo cuando la captura cuadra.
  useEffect(() => {
    if (value.taxTreatment !== 'mixed' || mixedError) return;
    try {
      const ratio = deriveExemptRatio(parsed.exempt, parsed.taxable, referencePrice);
      if (Math.abs(ratio - value.exemptRatio) > 1e-9) {
        onChange({ taxTreatment: 'mixed', exemptRatio: ratio });
      }
    } catch {
      /* mixedError ya lo cubre */
    }
    // onChange se omite a proposito: la identidad del callback cambia en cada
    // render del padre y volveria a disparar el efecto en bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.exempt, parsed.taxable, referencePrice, mixedError, value.taxTreatment, value.exemptRatio]);

  const handleTreatment = (t: TaxTreatment) => {
    // Al cambiar de tratamiento se vuelve a derivar de props: lo tecleado para
    // el tratamiento anterior ya no aplica.
    setTyped(null);
    if (t === 'taxable_16') onChange({ taxTreatment: 'taxable_16', exemptRatio: 0 });
    else if (t === 'exempt') onChange({ taxTreatment: 'exempt', exemptRatio: 1 });
    else onChange({ taxTreatment: 'mixed', exemptRatio: value.exemptRatio > 0 && value.exemptRatio < 1 ? value.exemptRatio : 0.5 });
  };

  const preview = useMemo(() => {
    if (!(referencePrice > 0)) return null;
    if (value.taxTreatment === 'mixed' && mixedError) return null;
    try {
      return calculateTaxBreakdown({
        grossAmount: referencePrice,
        taxTreatment: value.taxTreatment,
        exemptRatio: value.taxTreatment === 'mixed'
          ? deriveExemptRatio(parsed.exempt, parsed.taxable, referencePrice)
          : value.exemptRatio,
      });
    } catch {
      return null;
    }
  }, [referencePrice, value, parsed, mixedError]);

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div>
        <label htmlFor={`${idPrefix}-tax-treatment`} className="block text-xs font-medium text-gray-600 mb-1.5">
          Tratamiento fiscal
        </label>
        <select
          id={`${idPrefix}-tax-treatment`}
          value={value.taxTreatment}
          onChange={(e) => handleTreatment(e.target.value as TaxTreatment)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
        >
          <option value="taxable_16">IVA 16%</option>
          <option value="exempt">Exento</option>
          <option value="mixed">Mixto</option>
        </select>
        <p className="mt-1 text-xs text-gray-400 flex items-start gap-1">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          Indica cómo se distribuye fiscalmente el precio. Consulta a tu contador si no conoces
          el tratamiento fiscal aplicable.
        </p>
      </div>

      {value.taxTreatment === 'mixed' && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
          <p className="text-xs text-gray-500">
            {referenceLabel}: <strong>{formatCurrencyMXN(referencePrice || 0)}</strong>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${idPrefix}-exempt`} className="block text-xs font-medium text-gray-600 mb-1">
                Importe exento
              </label>
              <input
                id={`${idPrefix}-exempt`}
                type="number" step="0.01" min="0" inputMode="decimal"
                value={exemptInput}
                onChange={(e) => setExemptInput(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
            <div>
              <label htmlFor={`${idPrefix}-taxable`} className="block text-xs font-medium text-gray-600 mb-1">
                Importe gravado al 16% (IVA incluido)
              </label>
              <input
                id={`${idPrefix}-taxable`}
                type="number" step="0.01" min="0" inputMode="decimal"
                value={taxableInput}
                onChange={(e) => setTaxableInput(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
          </div>

          {mixedError && (
            <p className="text-xs text-red-600 flex items-start gap-1">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {mixedError}
            </p>
          )}
        </div>
      )}

      {preview && value.taxTreatment !== 'taxable_16' && (
        <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-xs font-mono text-gray-700 space-y-0.5">
          <div className="flex justify-between"><span>Precio final:</span><strong>{formatCurrencyMXN(referencePrice)}</strong></div>
          <div className="flex justify-between"><span>Exento:</span><span>{formatCurrencyMXN(preview.exemptAmount)}</span></div>
          {preview.exemptRatio < 1 && (
            <>
              <div className="flex justify-between">
                <span>Gravado IVA incluido:</span>
                <span>{formatCurrencyMXN(round2(preview.taxableBase + preview.vatAmount))}</span>
              </div>
              <div className="flex justify-between text-gray-500"><span>├ Base IVA 16%:</span><span>{formatCurrencyMXN(preview.taxableBase)}</span></div>
              <div className="flex justify-between text-gray-500"><span>└ IVA:</span><span>{formatCurrencyMXN(preview.vatAmount)}</span></div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default TaxTreatmentFields;
