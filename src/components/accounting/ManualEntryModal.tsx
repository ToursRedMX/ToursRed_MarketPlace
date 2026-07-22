import React, { useState, useEffect } from 'react';
import {
  X, ArrowUpRight, ArrowDownLeft, BookMarked, Plus, Trash2,
  AlertCircle, CheckCircle, FileText, CreditCard, Banknote, Building2
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChartAccount {
  id: string;
  code: string;
  name: string;
  account_type: 'activo' | 'pasivo' | 'capital' | 'ingreso' | 'gasto' | 'costo';
  nature: 'deudora' | 'acreedora';
  is_active: boolean;
  level: number;
}

type EntryKind = 'ingreso' | 'egreso' | 'diario';

interface JournalLine {
  id: string;
  account_code: string;
  description: string;
  debit: string;
  credit: string;
  cfdi_uuid: string;
}

interface Props {
  year: number;
  month: number;
  onClose: () => void;
  onSaved: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PAYMENT_METHODS = [
  { code: '102.01', label: 'Transferencia SPEI', icon: Building2 },
  { code: '101.01', label: 'Efectivo en caja', icon: Banknote },
  { code: '102.03', label: 'Tarjeta (Terminal)', icon: CreditCard },
];

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function newLine(): JournalLine {
  return { id: crypto.randomUUID(), account_code: '', description: '', debit: '', credit: '', cfdi_uuid: '' };
}

// ─── Component ───────────────────────────────────────────────────────────────

const ManualEntryModal: React.FC<Props> = ({ year, month, onClose, onSaved }) => {
  const [step, setStep] = useState<'kind' | 'form'>('kind');
  const [kind, setKind] = useState<EntryKind>('ingreso');

  // Common fields
  const today = new Date();
  const defaultDate = `${year}-${String(month).padStart(2,'0')}-${String(Math.min(today.getDate(), new Date(year, month, 0).getDate())).padStart(2,'0')}`;
  const [date, setDate] = useState(defaultDate);
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [cfdiUuid, setCfdiUuid] = useState('');

  // Ingreso / Egreso specific
  const [accountCode, setAccountCode] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('102.01');

  // Diario lines
  const [lines, setLines] = useState<JournalLine[]>([newLine(), newLine()]);

  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase
      .from('chart_of_accounts')
      .select('id, code, name, account_type, nature, is_active, level')
      .eq('is_active', true)
      .order('code')
      .then(({ data }) => setAccounts(data ?? []));
  }, []);

  // Filtered account lists
  const incomeAccounts = accounts.filter(a => a.account_type === 'ingreso');
  const expenseAccounts = accounts.filter(a => ['gasto', 'costo'].includes(a.account_type));

  // Diario balance check
  const totalDebit = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0;

  const selectKind = (k: EntryKind) => {
    setKind(k);
    setStep('form');
    setError('');
    setAccountCode('');
    setAmount('');
    setLines([newLine(), newLine()]);
  };

  const updateLine = (id: string, field: keyof JournalLine, value: string) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  const addLine = () => setLines(prev => [...prev, newLine()]);
  const removeLine = (id: string) => setLines(prev => prev.filter(l => l.id !== id));

  const validate = (): string => {
    if (!date) return 'La fecha es requerida.';
    if (!description.trim()) return 'El concepto es requerido.';

    const [y, m] = date.split('-').map(Number);
    if (y !== year || m !== month) return `La fecha debe estar dentro del periodo ${MONTHS[month-1]} ${year}.`;

    if (kind !== 'diario') {
      if (!accountCode) return 'Selecciona una cuenta contable.';
      const amt = parseFloat(amount);
      if (!amt || amt <= 0) return 'El monto debe ser mayor a cero.';
    } else {
      for (const l of lines) {
        if (!l.account_code) return 'Todas las partidas deben tener una cuenta.';
        if (!l.description.trim()) return 'Todas las partidas deben tener una descripcion.';
        const d = parseFloat(l.debit) || 0;
        const c = parseFloat(l.credit) || 0;
        if (d === 0 && c === 0) return 'Cada partida debe tener un cargo o un abono.';
        if (d > 0 && c > 0) return 'Cada partida tiene solo cargo O abono, no ambos.';
      }
      if (!isBalanced) return 'Los cargos y abonos deben ser iguales (poliza cuadrada).';
    }
    return '';
  };

  const handleSave = async (post: boolean) => {
    const err = validate();
    if (err) { setError(err); return; }
    setError('');
    setSaving(true);

    try {
      const entryType: EntryKind = kind === 'egreso' ? 'egreso' : kind === 'ingreso' ? 'ingreso' : 'diario';

      // Generate entry number via DB function
      const { data: numData, error: numErr } = await supabase
        .rpc('generate_entry_number', { p_type: entryType, p_year: year, p_month: month });
      if (numErr) throw numErr;
      const entryNumber = numData as string;

      // Insert header
      const { data: entry, error: entryErr } = await supabase
        .from('accounting_entries')
        .insert({
          entry_number: entryNumber,
          entry_type: entryType,
          entry_date: date,
          period_year: year,
          period_month: month,
          description: description.trim(),
          source_type: 'manual',
          is_posted: post,
          posted_at: post ? new Date().toISOString() : null,
        })
        .select('id')
        .single();

      if (entryErr) throw entryErr;

      // Build lines
      let linesPayload: object[] = [];
      const amt = parseFloat(amount) || 0;

      if (kind === 'ingreso') {
        const acc = accounts.find(a => a.code === accountCode);
        linesPayload = [
          {
            entry_id: entry.id,
            line_number: 1,
            account_code: paymentMethod,
            description: description.trim(),
            debit: amt,
            credit: 0,
            cfdi_uuid: cfdiUuid.trim() || null,
          },
          {
            entry_id: entry.id,
            line_number: 2,
            account_code: accountCode,
            description: acc?.name ?? description.trim(),
            debit: 0,
            credit: amt,
            cfdi_uuid: cfdiUuid.trim() || null,
          },
        ];
      } else if (kind === 'egreso') {
        const acc = accounts.find(a => a.code === accountCode);
        linesPayload = [
          {
            entry_id: entry.id,
            line_number: 1,
            account_code: accountCode,
            description: acc?.name ?? description.trim(),
            debit: amt,
            credit: 0,
            cfdi_uuid: cfdiUuid.trim() || null,
          },
          {
            entry_id: entry.id,
            line_number: 2,
            account_code: paymentMethod,
            description: description.trim(),
            debit: 0,
            credit: amt,
            cfdi_uuid: cfdiUuid.trim() || null,
          },
        ];
      } else {
        linesPayload = lines.map((l, i) => ({
          entry_id: entry.id,
          line_number: i + 1,
          account_code: l.account_code,
          description: l.description.trim(),
          debit: parseFloat(l.debit) || 0,
          credit: parseFloat(l.credit) || 0,
          cfdi_uuid: l.cfdi_uuid.trim() || null,
        }));
      }

      const { error: linesErr } = await supabase
        .from('accounting_entry_lines')
        .insert(linesPayload);

      if (linesErr) {
        // Rollback header
        await supabase.from('accounting_entries').delete().eq('id', entry.id);
        throw linesErr;
      }

      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message ?? 'Error al guardar el movimiento.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Nuevo Movimiento Manual</h2>
            <p className="text-xs text-gray-500 mt-0.5">{MONTHS[month-1]} {year}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step 1: Kind selector */}
        {step === 'kind' && (
          <div className="p-6">
            <p className="text-sm text-gray-600 mb-5 font-medium">Selecciona el tipo de movimiento:</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <KindCard
                kind="ingreso"
                title="Ingreso"
                desc="Consultoria, comisiones de mayoristas, ingresos de agencia"
                icon={<ArrowUpRight className="w-7 h-7 text-emerald-600" />}
                border="border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50/40"
                onClick={() => selectKind('ingreso')}
              />
              <KindCard
                kind="egreso"
                title="Gasto"
                desc="Servicios, operativos, viaticos, otros gastos"
                icon={<ArrowDownLeft className="w-7 h-7 text-red-500" />}
                border="border-red-200 hover:border-red-400 hover:bg-red-50/40"
                onClick={() => selectKind('egreso')}
              />
              <KindCard
                kind="diario"
                title="Asiento de Diario"
                desc="Ajuste libre con cargos y abonos personalizados"
                icon={<BookMarked className="w-7 h-7 text-sky-500" />}
                border="border-sky-200 hover:border-sky-400 hover:bg-sky-50/40"
                onClick={() => selectKind('diario')}
              />
            </div>
          </div>
        )}

        {/* Step 2: Form */}
        {step === 'form' && (
          <div className="p-6 space-y-5">

            {/* Back link */}
            <button onClick={() => setStep('kind')} className="text-sm text-sky-600 hover:underline flex items-center gap-1">
              ← Cambiar tipo
            </button>

            {/* Kind badge */}
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
              kind === 'ingreso' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
              kind === 'egreso' ? 'bg-red-50 text-red-700 border border-red-200' :
              'bg-sky-50 text-sky-700 border border-sky-200'
            }`}>
              {kind === 'ingreso' && <ArrowUpRight className="w-4 h-4" />}
              {kind === 'egreso' && <ArrowDownLeft className="w-4 h-4" />}
              {kind === 'diario' && <BookMarked className="w-4 h-4" />}
              {kind === 'ingreso' ? 'Ingreso' : kind === 'egreso' ? 'Gasto' : 'Asiento de Diario'}
            </div>

            {/* Common fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Fecha <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-100"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Referencia / Folio</label>
                <input
                  type="text"
                  value={reference}
                  onChange={e => setReference(e.target.value)}
                  placeholder="Num. factura, recibo..."
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-100"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Concepto <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={
                  kind === 'ingreso' ? 'Ej: Consultoria enero 2026, Comision mayorista XYZ...' :
                  kind === 'egreso' ? 'Ej: Renta oficina enero, Viaticos CDMX...' :
                  'Concepto del asiento contable'
                }
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-100"
              />
            </div>

            {/* CFDI UUID (ingreso: obligatorio, egreso: opcional) */}
            {kind !== 'diario' && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  UUID CFDI {kind === 'ingreso' ? <span className="text-red-500">*</span> : <span className="text-gray-400">(opcional)</span>}
                  <span className="ml-1 font-normal text-gray-400">— para vinculacion SAT</span>
                </label>
                <div className="relative">
                  <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={cfdiUuid}
                    onChange={e => setCfdiUuid(e.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="w-full pl-9 pr-3 py-2 text-sm font-mono border border-gray-200 rounded-lg outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-100"
                  />
                </div>
              </div>
            )}

            {/* Ingreso / Egreso: account + amount + payment method */}
            {kind !== 'diario' && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      {kind === 'ingreso' ? 'Cuenta de Ingreso' : 'Cuenta de Gasto'} <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={accountCode}
                      onChange={e => setAccountCode(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-100"
                    >
                      <option value="">-- Seleccionar --</option>
                      {(kind === 'ingreso' ? incomeAccounts : expenseAccounts).map(a => (
                        <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Monto (MXN) <span className="text-red-500">*</span></label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-2">
                    {kind === 'ingreso' ? 'Forma de cobro' : 'Forma de pago'} <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {PAYMENT_METHODS.map(pm => {
                      const Icon = pm.icon;
                      const selected = paymentMethod === pm.code;
                      return (
                        <button
                          key={pm.code}
                          type="button"
                          onClick={() => setPaymentMethod(pm.code)}
                          className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border-2 text-xs font-medium transition-all ${
                            selected
                              ? 'border-sky-500 bg-sky-50 text-sky-700'
                              : 'border-gray-200 bg-white text-gray-600 hover:border-sky-300 hover:bg-sky-50/40'
                          }`}
                        >
                          <Icon className={`w-5 h-5 ${selected ? 'text-sky-600' : 'text-gray-400'}`} />
                          {pm.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Preview of generated lines */}
                {accountCode && parseFloat(amount) > 0 && (
                  <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Vista previa de partidas</p>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400 border-b border-gray-200">
                          <th className="text-left pb-2">Cuenta</th>
                          <th className="text-right pb-2">Cargo</th>
                          <th className="text-right pb-2">Abono</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kind === 'ingreso' ? (
                          <>
                            <tr>
                              <td className="py-1.5 font-mono text-sky-700">{paymentMethod} — {PAYMENT_METHODS.find(p => p.code === paymentMethod)?.label}</td>
                              <td className="py-1.5 text-right font-semibold text-gray-800">${parseFloat(amount).toFixed(2)}</td>
                              <td className="py-1.5 text-right text-gray-400">—</td>
                            </tr>
                            <tr>
                              <td className="py-1.5 font-mono text-sky-700">{accountCode} — {accounts.find(a => a.code === accountCode)?.name}</td>
                              <td className="py-1.5 text-right text-gray-400">—</td>
                              <td className="py-1.5 text-right font-semibold text-gray-800">${parseFloat(amount).toFixed(2)}</td>
                            </tr>
                          </>
                        ) : (
                          <>
                            <tr>
                              <td className="py-1.5 font-mono text-sky-700">{accountCode} — {accounts.find(a => a.code === accountCode)?.name}</td>
                              <td className="py-1.5 text-right font-semibold text-gray-800">${parseFloat(amount).toFixed(2)}</td>
                              <td className="py-1.5 text-right text-gray-400">—</td>
                            </tr>
                            <tr>
                              <td className="py-1.5 font-mono text-sky-700">{paymentMethod} — {PAYMENT_METHODS.find(p => p.code === paymentMethod)?.label}</td>
                              <td className="py-1.5 text-right text-gray-400">—</td>
                              <td className="py-1.5 text-right font-semibold text-gray-800">${parseFloat(amount).toFixed(2)}</td>
                            </tr>
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* Diario: manual lines */}
            {kind === 'diario' && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Partidas contables</label>
                  <div className={`text-xs font-medium px-2 py-1 rounded-full ${
                    isBalanced ? 'bg-emerald-50 text-emerald-700' :
                    totalDebit > 0 || totalCredit > 0 ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {isBalanced ? 'Poliza cuadrada' : `Diferencia: $${Math.abs(totalDebit - totalCredit).toFixed(2)}`}
                  </div>
                </div>

                <div className="space-y-2">
                  {lines.map((l, idx) => (
                    <div key={l.id} className="grid grid-cols-12 gap-2 items-start bg-gray-50 rounded-lg p-3 border border-gray-100">
                      <div className="col-span-12 sm:col-span-4">
                        <select
                          value={l.account_code}
                          onChange={e => updateLine(l.id, 'account_code', e.target.value)}
                          className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-sky-400 bg-white"
                        >
                          <option value="">-- Cuenta --</option>
                          {accounts.map(a => (
                            <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-12 sm:col-span-4">
                        <input
                          type="text"
                          value={l.description}
                          onChange={e => updateLine(l.id, 'description', e.target.value)}
                          placeholder="Descripcion de la partida"
                          className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-sky-400 bg-white"
                        />
                      </div>
                      <div className="col-span-5 sm:col-span-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={l.debit}
                          onChange={e => updateLine(l.id, 'debit', e.target.value)}
                          placeholder="Cargo"
                          className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-sky-400 bg-white text-right"
                        />
                      </div>
                      <div className="col-span-5 sm:col-span-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={l.credit}
                          onChange={e => updateLine(l.id, 'credit', e.target.value)}
                          placeholder="Abono"
                          className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-sky-400 bg-white text-right"
                        />
                      </div>
                      <div className="col-span-2 sm:col-span-1 flex justify-end">
                        {lines.length > 2 && (
                          <button
                            type="button"
                            onClick={() => removeLine(l.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      {/* CFDI per line */}
                      <div className="col-span-12">
                        <input
                          type="text"
                          value={l.cfdi_uuid}
                          onChange={e => updateLine(l.id, 'cfdi_uuid', e.target.value)}
                          placeholder="UUID CFDI (opcional)"
                          className="w-full px-2 py-1.5 text-xs font-mono border border-gray-100 rounded-lg outline-none focus:border-sky-400 bg-white"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={addLine}
                  className="mt-3 flex items-center gap-2 text-sm text-sky-600 hover:text-sky-800 font-medium transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Agregar partida
                </button>

                {/* Totals row */}
                <div className="mt-4 bg-gray-100 rounded-lg px-4 py-3 flex justify-between text-sm font-semibold text-gray-700">
                  <span>Total Cargos: <span className="text-gray-900">${totalDebit.toFixed(2)}</span></span>
                  <span>Total Abonos: <span className="text-gray-900">${totalCredit.toFixed(2)}</span></span>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => handleSave(false)}
                disabled={saving}
                className="flex-1 px-4 py-2.5 text-sm font-medium bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Guardando...' : 'Guardar como Borrador'}
              </button>
              <button
                type="button"
                onClick={() => handleSave(true)}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50 transition-colors"
              >
                <CheckCircle className="w-4 h-4" />
                {saving ? 'Guardando...' : 'Guardar y Confirmar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const KindCard: React.FC<{
  kind: EntryKind;
  title: string;
  desc: string;
  icon: React.ReactNode;
  border: string;
  onClick: () => void;
}> = ({ title, desc, icon, border, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex flex-col items-center text-center gap-3 p-5 rounded-xl border-2 bg-white transition-all duration-150 cursor-pointer ${border}`}
  >
    <div className="p-3 rounded-full bg-gray-50">{icon}</div>
    <div>
      <p className="font-semibold text-gray-800 text-sm">{title}</p>
      <p className="text-xs text-gray-500 mt-1 leading-relaxed">{desc}</p>
    </div>
  </button>
);

export default ManualEntryModal;
