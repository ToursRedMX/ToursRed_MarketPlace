import React, { useState, useEffect, useCallback } from 'react';
import {
  FilePlus2, FileText, FileX, CreditCard, Search, Plus, Trash2,
  ChevronDown, ChevronUp, Download, ExternalLink, XCircle, CheckCircle,
  AlertCircle, Clock, RefreshCw, Users, BookOpen, Save
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCurrencyMXN } from '../../utils/formatCurrency';

// ─── Catalogos SAT ────────────────────────────────────────────────────────────

const REGIMENES_FISCALES = [
  { code: '601', label: '601 - General de Ley Personas Morales' },
  { code: '603', label: '603 - Personas Morales con Fines no Lucrativos' },
  { code: '605', label: '605 - Sueldos y Salarios' },
  { code: '606', label: '606 - Arrendamiento' },
  { code: '607', label: '607 - Enajenación de bienes' },
  { code: '608', label: '608 - Demas ingresos' },
  { code: '612', label: '612 - Personas Físicas con Actividades Empresariales' },
  { code: '616', label: '616 - Sin Obligaciones Fiscales' },
  { code: '621', label: '621 - Incorporacion Fiscal' },
  { code: '625', label: '625 - Actividades Agricolas, Ganaderas, Silvicolas y Pesqueras' },
  { code: '626', label: '626 - RESICO (Simplificado de Confianza)' },
];

const USOS_CFDI = [
  { code: 'G01', label: 'G01 - Adquisicion de mercancias' },
  { code: 'G02', label: 'G02 - Devoluciones, descuentos o bonificaciones' },
  { code: 'G03', label: 'G03 - Gastos en general' },
  { code: 'I01', label: 'I01 - Construcciones' },
  { code: 'I02', label: 'I02 - Mobilario y equipo de oficina' },
  { code: 'I03', label: 'I03 - Equipo de transporte' },
  { code: 'I04', label: 'I04 - Equipo de computo y accesorios' },
  { code: 'I06', label: 'I06 - Comunicaciones telefonicas' },
  { code: 'I08', label: 'I08 - Otra maquinaria y equipo' },
  { code: 'D01', label: 'D01 - Honorarios medicos, dentales y gastos hospitalarios' },
  { code: 'P01', label: 'P01 - Por definir' },
  { code: 'S01', label: 'S01 - Sin efectos fiscales' },
  { code: 'CP01', label: 'CP01 - Pagos' },
];

const FORMAS_PAGO = [
  { code: '01', label: '01 - Efectivo' },
  { code: '02', label: '02 - Cheque nominativo' },
  { code: '03', label: '03 - Transferencia electronica de fondos' },
  { code: '04', label: '04 - Tarjeta de credito' },
  { code: '05', label: '05 - Monedero electronico' },
  { code: '06', label: '06 - Dinero electronico' },
  { code: '08', label: '08 - Vales de despensa' },
  { code: '12', label: '12 - Dacion en pago' },
  { code: '13', label: '13 - Pago por subrogacion' },
  { code: '14', label: '14 - Pago por consignacion' },
  { code: '15', label: '15 - Condonacion' },
  { code: '17', label: '17 - Compensacion' },
  { code: '23', label: '23 - Novacion' },
  { code: '24', label: '24 - Confusion' },
  { code: '25', label: '25 - Remision de deuda' },
  { code: '26', label: '26 - Prescripcion o caducidad' },
  { code: '27', label: '27 - A satisfaccion del acreedor' },
  { code: '28', label: '28 - Tarjeta de debito' },
  { code: '29', label: '29 - Tarjeta de servicios' },
  { code: '30', label: '30 - Aplicacion de anticipos' },
  { code: '31', label: '31 - Intermediario pagos' },
  { code: '99', label: '99 - Por definir' },
];

const CLAVES_PROD_SERV = [
  { code: '90121502', label: '90121502 - Agencias de viajes' },
  { code: '90121500', label: '90121500 - Agentes de viajes' },
  { code: '90121501', label: '90121501 - Servicios de organizacion de excursiones' },
  { code: '80141628', label: '80141628 - Servicio de distribuidores por comision' },
  { code: '80141600', label: '80141600 - Servicios de administracion de negocios' },
  { code: '80111500', label: '80111500 - Servicios de consultoria de negocios' },
  { code: '84121500', label: '84121500 - Servicios de contabilidad' },
  { code: '84121900', label: '84121900 - Servicios de auditoria' },
  { code: '80101501', label: '80101501 - Gestion de proyectos' },
  { code: '78111800', label: '78111800 - Servicios de reservacion de transporte' },
  { code: '92101500', label: '92101500 - Servicios de publicidad' },
];

const CLAVES_UNIDAD = [
  { code: 'E48', label: 'E48 - Unidad de servicio' },
  { code: 'H87', label: 'H87 - Pieza' },
  { code: 'ACT', label: 'ACT - Actividad' },
  { code: 'MES', label: 'MES - Mes' },
  { code: 'DIA', label: 'DIA - Dia' },
  { code: 'HUR', label: 'HUR - Hora' },
  { code: 'MTK', label: 'MTK - Metro cuadrado' },
];

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Concepto {
  id: string;
  descripcion: string;
  clave_prod_serv: string;
  clave_unidad: string;
  cantidad: number;
  valor_unitario: number;
  descuento: number;
}

interface Receptor {
  rfc: string;
  nombre: string;
  domicilio_fiscal_receptor: string;
  regimen_fiscal_receptor: string;
  uso_cfdi: string;
}

interface ManualRecipient {
  id: string;
  name: string;
  rfc: string;
  razon_social: string;
  regimen_fiscal: string;
  uso_cfdi: string;
  codigo_postal: string;
  email: string | null;
  notes: string | null;
}

interface CfdiManualRecord {
  id: string;
  cfdi_type: 'I' | 'E' | 'P';
  receptor_rfc: string;
  receptor_razon_social: string | null;
  subtotal: number;
  iva_amount: number;
  total: number;
  status: string;
  uuid_fiscal: string | null;
  folio: string | null;
  serie: string | null;
  source_notes: string | null;
  accounting_account_code: string | null;
  created_at: string;
  stamped_at: string | null;
  error_message: string | null;
}

interface PpdInvoice {
  id: string;
  uuid_fiscal: string;
  folio: string | null;
  serie: string | null;
  receptor_rfc: string;
  receptor_razon_social: string | null;
  receptor_regimen_fiscal: string;
  receptor_uso_cfdi: string;
  receptor_codigo_postal: string;
  total: number;
  stamped_at: string | null;
}

interface AccountOption {
  code: string;
  name: string;
  account_type: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const newConcepto = (): Concepto => ({
  id: crypto.randomUUID(),
  descripcion: '',
  clave_prod_serv: '90121502',
  clave_unidad: 'E48',
  cantidad: 1,
  valor_unitario: 0,
  descuento: 0,
});

const calcConcepto = (c: Concepto) => {
  const base = Math.round((c.valor_unitario - c.descuento) * c.cantidad * 100) / 100;
  const iva = Math.round(base * 0.16 * 100) / 100;
  return { base, iva, total: Math.round((base + iva) * 100) / 100 };
};

const calcTotals = (conceptos: Concepto[]) => {
  let subtotal = 0;
  let iva = 0;
  for (const c of conceptos) {
    const r = calcConcepto(c);
    subtotal += r.base;
    iva += r.iva;
  }
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    iva: Math.round(iva * 100) / 100,
    total: Math.round((subtotal + iva) * 100) / 100,
  };
};

const TIPO_CONFIG = {
  I: { label: 'Factura de Ingreso', icon: FilePlus2, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-300', desc: 'Para comisiones de mayoristas, consultoria, servicios' },
  E: { label: 'Nota de Credito', icon: FileX, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-300', desc: 'Devoluciones, descuentos o bonificaciones' },
  P: { label: 'Complemento de Pago', icon: CreditCard, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-300', desc: 'Para cobrar una factura PPD emitida previamente' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  stamped: { label: 'Timbrado', color: 'bg-green-100 text-green-700', icon: <CheckCircle size={13} /> },
  pending: { label: 'Procesando', color: 'bg-yellow-100 text-yellow-700', icon: <Clock size={13} /> },
  error: { label: 'Error', color: 'bg-red-100 text-red-700', icon: <AlertCircle size={13} /> },
  cancelled: { label: 'Cancelado', color: 'bg-gray-100 text-gray-500', icon: <XCircle size={13} /> },
};

const rfcValid = (rfc: string) => /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(rfc.trim());

const downloadCfdi = async (cfdiId: string, fileType: 'xml' | 'pdf') => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-cfdi?cfdi_id=${cfdiId}&file_type=${fileType}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (!res.ok) return;
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  if (fileType === 'pdf') { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  else a.download = `cfdi-manual-${cfdiId}.xml`;
  a.click();
  URL.revokeObjectURL(objectUrl);
};

// ─── Subcomponente: selector de receptor ────────────────────────────────────

const ReceptorSelector: React.FC<{
  receptor: Receptor;
  onChange: (r: Receptor) => void;
  recipients: ManualRecipient[];
  onSave: () => void;
}> = ({ receptor, onChange, recipients, onSave }) => {
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const filtered = query.length >= 2
    ? recipients.filter(r =>
        r.name.toLowerCase().includes(query.toLowerCase()) ||
        r.rfc.toLowerCase().includes(query.toLowerCase())
      )
    : [];

  const selectRecipient = (r: ManualRecipient) => {
    onChange({
      rfc: r.rfc,
      nombre: r.razon_social,
      domicilio_fiscal_receptor: r.codigo_postal,
      regimen_fiscal_receptor: r.regimen_fiscal,
      uso_cfdi: r.uso_cfdi,
    });
    setQuery(r.name);
    setShowDropdown(false);
  };

  return (
    <div className="space-y-4">
      {/* Buscador */}
      <div className="relative">
        <label className="block text-sm font-medium text-gray-700 mb-1">Buscar receptor frecuente</label>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            placeholder="Nombre o RFC..."
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {showDropdown && filtered.length > 0 && (
          <div className="absolute z-20 mt-1 w-full bg-white rounded-xl shadow-lg border border-gray-200 max-h-52 overflow-y-auto">
            {filtered.map(r => (
              <button
                key={r.id}
                onClick={() => selectRecipient(r)}
                className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0"
              >
                <div className="font-medium text-sm text-gray-800">{r.name}</div>
                <div className="text-xs text-gray-400 font-mono">{r.rfc} · CP {r.codigo_postal}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Campos del receptor */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">RFC *</label>
          <input
            type="text"
            value={receptor.rfc}
            onChange={e => onChange({ ...receptor, rfc: e.target.value.toUpperCase() })}
            placeholder="RFC123456789"
            className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono ${
              receptor.rfc && !rfcValid(receptor.rfc) ? 'border-red-300 bg-red-50' : 'border-gray-200'
            }`}
          />
          {receptor.rfc && !rfcValid(receptor.rfc) && (
            <p className="text-xs text-red-500 mt-0.5">Formato de RFC invalido</p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Razon Social / Nombre *</label>
          <input
            type="text"
            value={receptor.nombre}
            onChange={e => onChange({ ...receptor, nombre: e.target.value })}
            placeholder="EMPRESA SA DE CV"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Codigo Postal Fiscal *</label>
          <input
            type="text"
            value={receptor.domicilio_fiscal_receptor}
            onChange={e => onChange({ ...receptor, domicilio_fiscal_receptor: e.target.value })}
            placeholder="06600"
            maxLength={5}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Regimen Fiscal *</label>
          <select
            value={receptor.regimen_fiscal_receptor}
            onChange={e => onChange({ ...receptor, regimen_fiscal_receptor: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {REGIMENES_FISCALES.map(r => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Uso CFDI *</label>
          <select
            value={receptor.uso_cfdi}
            onChange={e => onChange({ ...receptor, uso_cfdi: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {USOS_CFDI.map(u => (
              <option key={u.code} value={u.code}>{u.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Guardar receptor */}
      {receptor.rfc && rfcValid(receptor.rfc) && receptor.nombre && (
        <button
          onClick={onSave}
          className="flex items-center gap-2 text-xs text-blue-600 hover:text-blue-700 transition-colors"
        >
          <Save size={12} />
          Guardar como receptor frecuente
        </button>
      )}
    </div>
  );
};

// ─── Subcomponente: tabla de conceptos ───────────────────────────────────────

const CUSTOM_MARKER = '__custom__';

const ConceptosTable: React.FC<{
  conceptos: Concepto[];
  onChange: (list: Concepto[]) => void;
  extraClaves: { code: string; label: string }[];
  onSaveClave: (code: string, label: string) => void;
}> = ({ conceptos, onChange, extraClaves, onSaveClave }) => {
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const allClaves = [...CLAVES_PROD_SERV, ...extraClaves];

  const update = (id: string, field: keyof Concepto, value: string | number) => {
    onChange(conceptos.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const handleClaveSelect = (id: string, value: string) => {
    if (value === CUSTOM_MARKER) {
      setCustomInputs(prev => ({ ...prev, [id]: '' }));
      update(id, 'clave_prod_serv', CUSTOM_MARKER);
    } else {
      setCustomInputs(prev => { const n = { ...prev }; delete n[id]; return n; });
      update(id, 'clave_prod_serv', value);
    }
  };

  const handleCustomInput = (id: string, raw: string) => {
    const val = raw.toUpperCase().replace(/\s/g, '');
    setCustomInputs(prev => ({ ...prev, [id]: val }));
    update(id, 'clave_prod_serv', val || CUSTOM_MARKER);
  };

  const handleCustomBlur = (id: string, val: string) => {
    const trimmed = val.trim();
    if (trimmed && trimmed !== CUSTOM_MARKER && !allClaves.find(k => k.code === trimmed)) {
      onSaveClave(trimmed, trimmed);
      update(id, 'clave_prod_serv', trimmed);
      setCustomInputs(prev => { const n = { ...prev }; delete n[id]; return n; });
    }
  };

  const isCustom = (id: string, clave: string) =>
    clave === CUSTOM_MARKER || (id in customInputs);

  const totals = calcTotals(conceptos);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">Descripcion</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">Clave SAT</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">Unidad</th>
              <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500">Cant.</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500">P. Unitario</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500">Descuento</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500">Subtotal</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500">IVA</th>
              <th className="px-2 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {conceptos.map(c => {
              const r = calcConcepto(c);
              return (
                <tr key={c.id} className="group">
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={c.descripcion}
                      onChange={e => update(c.id, 'descripcion', e.target.value)}
                      placeholder="Descripcion del concepto"
                      className="w-full min-w-[180px] px-2 py-1 text-sm border border-transparent group-hover:border-gray-200 rounded focus:outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-300"
                    />
                  </td>
                  <td className="px-3 py-2">
                    {isCustom(c.id, c.clave_prod_serv) ? (
                      <input
                        type="text"
                        autoFocus
                        value={customInputs[c.id] ?? (c.clave_prod_serv !== CUSTOM_MARKER ? c.clave_prod_serv : '')}
                        onChange={e => handleCustomInput(c.id, e.target.value)}
                        onBlur={e => handleCustomBlur(c.id, e.target.value)}
                        placeholder="Ej: 84111500"
                        maxLength={12}
                        className="w-full min-w-[130px] px-2 py-1 text-xs border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono bg-blue-50"
                      />
                    ) : (
                      <select
                        value={allClaves.find(k => k.code === c.clave_prod_serv) ? c.clave_prod_serv : CUSTOM_MARKER}
                        onChange={e => handleClaveSelect(c.id, e.target.value)}
                        className="w-full min-w-[160px] px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                      >
                        {allClaves.map(k => (
                          <option key={k.code} value={k.code}>{k.label}</option>
                        ))}
                        <option value={CUSTOM_MARKER}>Otra (escribir)</option>
                      </select>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={c.clave_unidad}
                      onChange={e => update(c.id, 'clave_unidad', e.target.value)}
                      className="px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                    >
                      {CLAVES_UNIDAD.map(u => (
                        <option key={u.code} value={u.code}>{u.code}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={1}
                      value={c.cantidad}
                      onChange={e => update(c.id, 'cantidad', parseFloat(e.target.value) || 1)}
                      className="w-16 text-center px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={c.valor_unitario}
                      onChange={e => update(c.id, 'valor_unitario', parseFloat(e.target.value) || 0)}
                      className="w-28 text-right px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={c.descuento}
                      onChange={e => update(c.id, 'descuento', parseFloat(e.target.value) || 0)}
                      className="w-24 text-right px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                    />
                  </td>
                  <td className="px-3 py-2 text-right text-sm text-gray-700 whitespace-nowrap font-medium">
                    {formatCurrencyMXN(r.base)}
                  </td>
                  <td className="px-3 py-2 text-right text-sm text-gray-500 whitespace-nowrap">
                    {formatCurrencyMXN(r.iva)}
                  </td>
                  <td className="px-2 py-2">
                    {conceptos.length > 1 && (
                      <button
                        onClick={() => onChange(conceptos.filter(x => x.id !== c.id))}
                        className="p-1 text-gray-300 hover:text-red-400 transition-colors rounded"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-gray-50 border-t border-gray-200">
            <tr>
              <td colSpan={6} className="px-3 py-2.5 text-xs font-medium text-gray-500 text-right">Totales</td>
              <td className="px-3 py-2.5 text-right text-sm font-semibold text-gray-900">{formatCurrencyMXN(totals.subtotal)}</td>
              <td className="px-3 py-2.5 text-right text-sm font-semibold text-gray-700">{formatCurrencyMXN(totals.iva)}</td>
              <td />
            </tr>
            <tr>
              <td colSpan={7} className="px-3 pb-2.5 text-right text-xs text-gray-500">Total con IVA</td>
              <td className="px-3 pb-2.5 text-right text-base font-bold text-blue-700">{formatCurrencyMXN(totals.total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <button
        onClick={() => onChange([...conceptos, newConcepto()])}
        className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
      >
        <Plus size={16} />
        Agregar concepto
      </button>
    </div>
  );
};

// ─── Componente principal ─────────────────────────────────────────────────────

const AdminCfdiManual: React.FC = () => {
  const [cfdiType, setCfdiType] = useState<'I' | 'E' | 'P'>('I');
  const [receptor, setReceptor] = useState<Receptor>({
    rfc: '', nombre: '', domicilio_fiscal_receptor: '',
    regimen_fiscal_receptor: '601', uso_cfdi: 'G03',
  });
  const [conceptos, setConceptos] = useState<Concepto[]>([newConcepto()]);
  const [paymentForm, setPaymentForm] = useState('03');
  const [paymentMethod, setPaymentMethod] = useState<'PUE' | 'PPD'>('PUE');
  const [accountCode, setAccountCode] = useState('407');
  const [notes, setNotes] = useState('');

  // Claves SAT personalizadas (se persisten en localStorage)
  const [extraClaves, setExtraClaves] = useState<{ code: string; label: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem('cfdi_extra_claves') ?? '[]'); } catch { return []; }
  });

  const handleSaveClave = (code: string, label: string) => {
    setExtraClaves(prev => {
      if (prev.find(k => k.code === code)) return prev;
      const next = [...prev, { code, label }];
      localStorage.setItem('cfdi_extra_claves', JSON.stringify(next));
      return next;
    });
  };

  // Complemento de pago
  const [selectedPpd, setSelectedPpd] = useState<PpdInvoice | null>(null);
  const [ppdSearch, setPpdSearch] = useState('');
  const [ppdList, setPpdList] = useState<PpdInvoice[]>([]);
  const [parcialidad, setParcialidad] = useState(1);
  const [saldoAnterior, setSaldoAnterior] = useState(0);
  const [importePagado, setImportePagado] = useState(0);

  // Datos de apoyo
  const [recipients, setRecipients] = useState<ManualRecipient[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [history, setHistory] = useState<CfdiManualRecord[]>([]);

  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [saveRecipientName, setSaveRecipientName] = useState('');
  const [showSaveRecipient, setShowSaveRecipient] = useState(false);
  const [cancelModal, setCancelModal] = useState<{ id: string; uuid: string } | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [ppdShowDropdown, setPpdShowDropdown] = useState(false);

  const fetchSupportData = useCallback(async () => {
    const [recipientsRes, accountsRes, historyRes] = await Promise.all([
      supabase.from('manual_cfdi_recipients').select('*').eq('is_active', true).order('name'),
      supabase.from('chart_of_accounts')
        .select('code, name, account_type')
        .in('account_type', ['ingreso', 'gasto', 'activo', 'pasivo'])
        .eq('is_active', true)
        .in('level', [3, 4])
        .order('code'),
      supabase.from('cfdi_invoices')
        .select('id, cfdi_type, receptor_rfc, receptor_razon_social, subtotal, iva_amount, total, status, uuid_fiscal, folio, serie, source_notes, accounting_account_code, created_at, stamped_at, error_message')
        .eq('is_manual', true)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    if (recipientsRes.data) setRecipients(recipientsRes.data as ManualRecipient[]);
    if (accountsRes.data) setAccounts(accountsRes.data as AccountOption[]);
    if (historyRes.data) setHistory(historyRes.data as CfdiManualRecord[]);
    setIsLoadingHistory(false);
  }, []);

  useEffect(() => { fetchSupportData(); }, [fetchSupportData]);

  // Buscar facturas PPD al escribir RFC
  useEffect(() => {
    if (cfdiType !== 'P' || ppdSearch.length < 3) { setPpdList([]); return; }
    const load = async () => {
      const { data } = await supabase
        .from('cfdi_invoices')
        .select('id, uuid_fiscal, folio, serie, receptor_rfc, receptor_razon_social, receptor_regimen_fiscal, receptor_uso_cfdi, receptor_codigo_postal, total, stamped_at')
        .eq('status', 'stamped')
        .eq('payment_method_sat', 'PPD')
        .ilike('receptor_rfc', `%${ppdSearch}%`)
        .order('stamped_at', { ascending: false })
        .limit(20);
      if (data) setPpdList(data as PpdInvoice[]);
    };
    load();
  }, [ppdSearch, cfdiType]);

  const selectPpd = (inv: PpdInvoice) => {
    setSelectedPpd(inv);
    setSaldoAnterior(inv.total);
    setImportePagado(inv.total);
    setReceptor({
      rfc: inv.receptor_rfc,
      nombre: inv.receptor_razon_social ?? '',
      domicilio_fiscal_receptor: inv.receptor_codigo_postal,
      regimen_fiscal_receptor: inv.receptor_regimen_fiscal,
      uso_cfdi: 'CP01',
    });
    setPpdSearch(inv.receptor_rfc);
    setPpdShowDropdown(false);
  };

  const saldoInsoluto = Math.max(0, Math.round((saldoAnterior - importePagado) * 100) / 100);

  const totals = cfdiType === 'P'
    ? { subtotal: importePagado, iva: 0, total: importePagado }
    : calcTotals(conceptos);

  const isFormValid = () => {
    if (!rfcValid(receptor.rfc) || !receptor.nombre || !receptor.domicilio_fiscal_receptor) return false;
    if (cfdiType === 'P') return !!selectedPpd && importePagado > 0;
    return conceptos.every(c => c.descripcion && c.valor_unitario > 0 && c.clave_prod_serv && c.clave_prod_serv !== CUSTOM_MARKER);
  };

  const handleSubmit = async () => {
    if (!isFormValid()) return;
    setIsSubmitting(true);
    setMessage(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const body: Record<string, unknown> = {
        cfdi_type: cfdiType,
        receptor,
        conceptos: cfdiType === 'P' ? [] : conceptos.map(c => ({
          clave_prod_serv: c.clave_prod_serv,
          cantidad: c.cantidad,
          clave_unidad: c.clave_unidad,
          descripcion: c.descripcion,
          valor_unitario: c.valor_unitario,
          descuento: c.descuento || undefined,
        })),
        payment_form: paymentForm,
        payment_method: cfdiType === 'P' ? 'PUE' : paymentMethod,
        accounting_account_code: accountCode || undefined,
        source_notes: notes || undefined,
        ...(cfdiType === 'P' && selectedPpd ? {
          payment_complement: {
            related_uuid: selectedPpd.uuid_fiscal,
            num_parcialidad: parcialidad,
            imp_saldo_ant: saldoAnterior,
            imp_pagado: importePagado,
            imp_saldo_insoluto: saldoInsoluto,
          },
        } : {}),
      };

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-manual-cfdi`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify(body),
        }
      );

      const result = await res.json();
      if (!res.ok) throw new Error(result.detail ?? result.error ?? 'Error al timbrar');

      setMessage({ type: 'success', text: `CFDI timbrado exitosamente — UUID: ${result.uuid_fiscal}` });
      setShowPreview(false);
      // Reset form
      setConceptos([newConcepto()]);
      setReceptor({ rfc: '', nombre: '', domicilio_fiscal_receptor: '', regimen_fiscal_receptor: '601', uso_cfdi: 'G03' });
      setNotes('');
      setSelectedPpd(null);
      fetchSupportData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message ?? 'Error desconocido' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveRecipient = async () => {
    if (!saveRecipientName.trim()) return;
    await supabase.from('manual_cfdi_recipients').upsert({
      name: saveRecipientName,
      rfc: receptor.rfc,
      razon_social: receptor.nombre,
      regimen_fiscal: receptor.regimen_fiscal_receptor,
      uso_cfdi: receptor.uso_cfdi,
      codigo_postal: receptor.domicilio_fiscal_receptor,
    }, { onConflict: 'rfc' });
    setShowSaveRecipient(false);
    setSaveRecipientName('');
    fetchSupportData();
  };

  const handleCancelCfdi = async () => {
    if (!cancelModal) return;
    setIsCancelling(true);
    try {
      const { error } = await supabase.functions.invoke('cancel-cfdi', {
        body: { cfdi_invoice_id: cancelModal.id, motivo: '02' },
      });
      if (error) throw error;
      setMessage({ type: 'success', text: 'CFDI cancelado correctamente' });
      setCancelModal(null);
      fetchSupportData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message ?? 'Error al cancelar' });
    } finally {
      setIsCancelling(false);
    }
  };

  const stamped = history.filter(h => h.status === 'stamped');
  const kpiTotal = stamped.reduce((s, h) => s + h.total, 0);
  const kpiByType = { I: stamped.filter(h => h.cfdi_type === 'I').length, E: stamped.filter(h => h.cfdi_type === 'E').length, P: stamped.filter(h => h.cfdi_type === 'P').length };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

        {/* ── Header ── */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FilePlus2 className="text-blue-600" size={26} />
            CFDI Manual
          </h1>
          <p className="text-sm text-gray-500 mt-1">Emite facturas, notas de credito y complementos de pago para mayoristas y proveedores</p>
        </div>

        {message && (
          <div className={`p-4 rounded-xl flex items-start gap-3 text-sm ${message.type === 'success' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
            {message.type === 'success' ? <CheckCircle size={16} className="shrink-0 mt-0.5" /> : <AlertCircle size={16} className="shrink-0 mt-0.5" />}
            <span className="flex-1">{message.text}</span>
            <button onClick={() => setMessage(null)}><XCircle size={15} className="text-gray-400 hover:text-gray-600" /></button>
          </div>
        )}

        {/* ── Formulario ── */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">

          {/* Panel A: tipo de comprobante */}
          <div className="p-6 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">Tipo de Comprobante</h2>
            <div className="grid grid-cols-3 gap-3">
              {(['I', 'E', 'P'] as const).map(t => {
                const cfg = TIPO_CONFIG[t];
                const Icon = cfg.icon;
                const active = cfdiType === t;
                return (
                  <button
                    key={t}
                    onClick={() => { setCfdiType(t); setShowPreview(false); setSelectedPpd(null); }}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                      active ? `${cfg.bg} ${cfg.border} ${cfg.color}` : 'border-gray-200 hover:border-gray-300 text-gray-600'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <Icon size={20} />
                      <span className="font-semibold text-sm">{cfg.label}</span>
                      <span className={`ml-auto text-xs font-bold px-1.5 py-0.5 rounded ${active ? 'bg-white/60' : 'bg-gray-100'}`}>{t}</span>
                    </div>
                    <p className={`text-xs ${active ? '' : 'text-gray-400'}`}>{cfg.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Panel B: receptor */}
          <div className="p-6 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Users size={14} />
              Datos del Receptor
            </h2>

            {/* Si es tipo P, buscar factura PPD primero */}
            {cfdiType === 'P' && (
              <div className="mb-5 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                <p className="text-sm font-medium text-emerald-800 mb-3">Selecciona la factura PPD a cobrar</p>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={ppdSearch}
                    onChange={e => { setPpdSearch(e.target.value); setPpdShowDropdown(true); }}
                    onFocus={() => setPpdShowDropdown(true)}
                    placeholder="Buscar por RFC del receptor..."
                    className="w-full pl-9 pr-4 py-2 text-sm border border-emerald-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                  {ppdShowDropdown && ppdList.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full bg-white rounded-xl shadow-lg border border-gray-200 max-h-48 overflow-y-auto">
                      {ppdList.map(inv => (
                        <button key={inv.id} onClick={() => selectPpd(inv)}
                          className="w-full text-left px-4 py-3 hover:bg-emerald-50 transition-colors border-b border-gray-50 last:border-0">
                          <div className="flex justify-between items-start">
                            <div>
                              <span className="font-medium text-sm text-gray-800">{inv.receptor_rfc}</span>
                              {inv.receptor_razon_social && (
                                <span className="text-xs text-gray-500 ml-2">{inv.receptor_razon_social}</span>
                              )}
                              <div className="text-xs text-gray-400 font-mono mt-0.5">
                                {inv.serie}{inv.folio} · {inv.uuid_fiscal?.substring(0, 18)}...
                              </div>
                            </div>
                            <span className="font-semibold text-sm text-gray-900 shrink-0 ml-3">{formatCurrencyMXN(inv.total)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {selectedPpd && (
                  <div className="mt-3 p-3 bg-white rounded-lg border border-emerald-300 text-sm space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Factura original:</span>
                      <span className="font-mono text-xs text-gray-700">{selectedPpd.serie}{selectedPpd.folio}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">UUID:</span>
                      <span className="font-mono text-xs text-gray-500">{selectedPpd.uuid_fiscal?.substring(0, 28)}...</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total original:</span>
                      <span className="font-semibold text-gray-900">{formatCurrencyMXN(selectedPpd.total)}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 pt-2 border-t border-gray-100">
                      <div>
                        <label className="text-xs text-gray-500">Num. Parcialidad</label>
                        <input type="number" min={1} value={parcialidad}
                          onChange={e => setParcialidad(parseInt(e.target.value) || 1)}
                          className="w-full mt-1 px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-emerald-400" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Saldo Anterior</label>
                        <input type="number" min={0} step="0.01" value={saldoAnterior}
                          onChange={e => setSaldoAnterior(parseFloat(e.target.value) || 0)}
                          className="w-full mt-1 px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-emerald-400" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Importe Pagado</label>
                        <input type="number" min={0} step="0.01" value={importePagado}
                          onChange={e => setImportePagado(parseFloat(e.target.value) || 0)}
                          className="w-full mt-1 px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-emerald-400" />
                      </div>
                    </div>
                    <div className="flex justify-between pt-1">
                      <span className="text-xs text-gray-500">Saldo Insoluto:</span>
                      <span className={`text-sm font-semibold ${saldoInsoluto > 0 ? 'text-amber-600' : 'text-green-600'}`}>{formatCurrencyMXN(saldoInsoluto)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            <ReceptorSelector
              receptor={receptor}
              onChange={setReceptor}
              recipients={recipients}
              onSave={() => setShowSaveRecipient(true)}
            />

            {/* Modal guardar receptor */}
            {showSaveRecipient && (
              <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                <p className="text-sm font-medium text-blue-800 mb-2">Nombre para identificar al receptor</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={saveRecipientName}
                    onChange={e => setSaveRecipientName(e.target.value)}
                    placeholder="Ej: Mega Travel"
                    className="flex-1 px-3 py-1.5 text-sm border border-blue-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <button onClick={handleSaveRecipient}
                    className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                    Guardar
                  </button>
                  <button onClick={() => setShowSaveRecipient(false)}
                    className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Panel C: conceptos (solo I y E) */}
          {cfdiType !== 'P' && (
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                <FileText size={14} />
                Conceptos
              </h2>
              <ConceptosTable conceptos={conceptos} onChange={setConceptos} extraClaves={extraClaves} onSaveClave={handleSaveClave} />
            </div>
          )}

          {/* Panel D: datos financieros */}
          <div className="p-6 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
              <BookOpen size={14} />
              Datos Financieros y Contables
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Forma de Pago</label>
                <select value={paymentForm} onChange={e => setPaymentForm(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {FORMAS_PAGO.map(f => (
                    <option key={f.code} value={f.code}>{f.label}</option>
                  ))}
                </select>
              </div>
              {cfdiType !== 'P' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Metodo de Pago</label>
                  <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as 'PUE' | 'PPD')}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="PUE">PUE - Pago en una sola exhibicion</option>
                    <option value="PPD">PPD - Pago en parcialidades o diferido</option>
                  </select>
                  {paymentMethod === 'PPD' && (
                    <p className="text-xs text-amber-600 mt-1">Con PPD, despues deberas emitir un Complemento de Pago (tipo P)</p>
                  )}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Cuenta Contable Destino</label>
                <select value={accountCode} onChange={e => setAccountCode(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <optgroup label="Ingresos">
                    {accounts.filter(a => a.account_type === 'ingreso').map(a => (
                      <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Gastos">
                    {accounts.filter(a => a.account_type === 'gasto').map(a => (
                      <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Activo">
                    {accounts.filter(a => a.account_type === 'activo').map(a => (
                      <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Pasivo">
                    {accounts.filter(a => a.account_type === 'pasivo').map(a => (
                      <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                    ))}
                  </optgroup>
                </select>
              </div>
              <div className="lg:col-span-3">
                <label className="block text-xs font-medium text-gray-600 mb-1">Nota Interna (no aparece en el CFDI)</label>
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Ej: Comision enero 2026 — Mega Travel"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          </div>

          {/* Panel E: Vista previa y accion */}
          <div className="p-6">
            <button
              onClick={() => setShowPreview(!showPreview)}
              disabled={!isFormValid()}
              className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700 disabled:text-gray-300 transition-colors mb-4"
            >
              {showPreview ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              {showPreview ? 'Ocultar' : 'Ver'} vista previa del CFDI
            </button>

            {showPreview && isFormValid() && (
              <div className="mb-6 p-5 bg-gray-50 rounded-xl border border-gray-200 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Tipo</span>
                  <span className="font-semibold text-gray-900">{TIPO_CONFIG[cfdiType].label} ({cfdiType})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Receptor</span>
                  <div className="text-right">
                    <div className="font-semibold text-gray-900">{receptor.nombre}</div>
                    <div className="text-xs text-gray-400 font-mono">{receptor.rfc}</div>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Forma de pago</span>
                  <span className="text-gray-800">{FORMAS_PAGO.find(f => f.code === paymentForm)?.label}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Cuenta contable</span>
                  <span className="text-gray-800">{accountCode} — {accounts.find(a => a.code === accountCode)?.name}</span>
                </div>
                <hr className="border-gray-200" />
                <div className="flex justify-between">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="text-gray-800">{formatCurrencyMXN(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">IVA (16%)</span>
                  <span className="text-gray-800">{formatCurrencyMXN(totals.iva)}</span>
                </div>
                <div className="flex justify-between text-base font-bold">
                  <span>Total</span>
                  <span className="text-blue-700">{formatCurrencyMXN(totals.total)}</span>
                </div>
                {notes && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">Nota interna</span>
                    <span className="text-gray-500">{notes}</span>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleSubmit}
                disabled={!isFormValid() || isSubmitting}
                className="px-6 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {isSubmitting ? (
                  <><RefreshCw size={16} className="animate-spin" /> Timbrando...</>
                ) : (
                  <><FilePlus2 size={16} /> Timbrar CFDI</>
                )}
              </button>
              {!isFormValid() && (
                <p className="text-xs text-gray-400">Completa todos los campos requeridos</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Historial ── */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Historial de CFDIs Manuales</h2>
              <p className="text-xs text-gray-400 mt-0.5">{history.length} comprobantes emitidos</p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              {/* KPIs rápidos */}
              <div className="text-center">
                <div className="font-bold text-gray-900">{kpiByType.I}</div>
                <div className="text-xs text-gray-400">Ingresos</div>
              </div>
              <div className="text-center">
                <div className="font-bold text-gray-900">{kpiByType.E}</div>
                <div className="text-xs text-gray-400">Notas</div>
              </div>
              <div className="text-center">
                <div className="font-bold text-gray-900">{kpiByType.P}</div>
                <div className="text-xs text-gray-400">Pagos</div>
              </div>
              <div className="text-center">
                <div className="font-bold text-blue-700">{formatCurrencyMXN(kpiTotal)}</div>
                <div className="text-xs text-gray-400">Total timbrado</div>
              </div>
              <button onClick={fetchSupportData} className="p-2 text-gray-400 hover:text-gray-600 transition-colors rounded-lg hover:bg-gray-100">
                <RefreshCw size={15} />
              </button>
            </div>
          </div>

          {isLoadingHistory ? (
            <div className="flex justify-center py-12">
              <RefreshCw className="animate-spin text-gray-300" size={24} />
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <FilePlus2 size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Aun no hay CFDIs manuales emitidos</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Tipo', 'Receptor', 'Serie-Folio', 'UUID', 'Total', 'Cuenta', 'Nota', 'Estado', 'Fecha', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {history.map(inv => {
                    const cfg = TIPO_CONFIG[inv.cfdi_type];
                    const Icon = cfg.icon;
                    const st = STATUS_CONFIG[inv.status] ?? STATUS_CONFIG.pending;
                    return (
                      <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.color}`}>
                            <Icon size={12} />
                            {inv.cfdi_type}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-gray-800 max-w-[140px] truncate">{inv.receptor_razon_social ?? '—'}</div>
                          <div className="text-xs text-gray-400 font-mono">{inv.receptor_rfc}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">
                          {inv.serie && inv.folio ? `${inv.serie}-${inv.folio}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-gray-400">
                          {inv.uuid_fiscal ? `${inv.uuid_fiscal.substring(0, 16)}…` : '—'}
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">
                          {formatCurrencyMXN(inv.total)}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">{inv.accounting_account_code ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-400 max-w-[120px] truncate">{inv.source_notes ?? '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>
                            {st.icon}{st.label}
                          </span>
                          {inv.status === 'error' && inv.error_message && (
                            <div className="text-xs text-red-500 mt-0.5 max-w-[120px] truncate" title={inv.error_message}>
                              {inv.error_message.substring(0, 40)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                          {new Date(inv.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {inv.status === 'stamped' && (
                              <>
                                <button onClick={() => downloadCfdi(inv.id, 'xml')} title="Descargar XML"
                                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                                  <Download size={14} />
                                </button>
                                <button onClick={() => downloadCfdi(inv.id, 'pdf')} title="Ver PDF"
                                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                                  <ExternalLink size={14} />
                                </button>
                                <button onClick={() => setCancelModal({ id: inv.id, uuid: inv.uuid_fiscal ?? '' })} title="Cancelar"
                                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                                  <XCircle size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Modal cancelacion ── */}
      {cancelModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Cancelar CFDI Manual</h3>
            <p className="text-sm text-gray-500 mb-4 font-mono">{cancelModal.uuid.substring(0, 36)}</p>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700 mb-5">
              Esta accion es irreversible. El CFDI quedara cancelado ante el SAT con motivo 02 (errores sin relacion).
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setCancelModal(null)} disabled={isCancelling}
                className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
                Cerrar
              </button>
              <button onClick={handleCancelCfdi} disabled={isCancelling}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center gap-2">
                {isCancelling ? <><RefreshCw size={14} className="animate-spin" /> Cancelando...</> : 'Cancelar CFDI'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


export default AdminCfdiManual;