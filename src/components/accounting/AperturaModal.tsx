import React, { useState, useEffect, useMemo } from 'react';
import {
  X, AlertCircle, CheckCircle, Plus, Trash2, BookOpen, Info
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChartAccount {
  id: string;
  code: string;
  name: string;
  account_type: 'activo' | 'pasivo' | 'capital' | 'ingreso' | 'gasto' | 'costo';
  nature: 'deudora' | 'acreedora';
  is_active: boolean;
  level: number;
}

interface AperturaLine {
  id: string;
  account_code: string;
  description: string;
  debit: string;
  credit: string;
}

interface Props {
  year: number;
  month: number;
  onClose: () => void;
  onSaved: () => void;
}

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function newLine(debit = '', credit = ''): AperturaLine {
  return { id: crypto.randomUUID(), account_code: '', description: '', debit, credit };
}

function fmt(n: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
}

// ─── Component ────────────────────────────────────────────────────────────────

const AperturaModal: React.FC<Props> = ({ year, month, onClose, onSaved }) => {
  const defaultDate = `${year}-${String(month).padStart(2,'0')}-01`;
  const [date, setDate] = useState(defaultDate);
  const [description, setDescription] = useState(`Apertura de ejercicio ${year}`);
  const [lines, setLines] = useState<AperturaLine[]>([
    newLine('', ''),
    newLine('', ''),
  ]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [duplicateExists, setDuplicateExists] = useState(false);

  useEffect(() => {
    supabase
      .from('chart_of_accounts')
      .select('id, code, name, account_type, nature, is_active, level')
      .eq('is_active', true)
      .order('code')
      .then(({ data }) => setAccounts(data ?? []));

    // Check if apertura already exists for this year
    setCheckingDuplicate(true);
    supabase
      .from('accounting_entries')
      .select('id', { count: 'exact', head: true })
      .eq('entry_type', 'apertura')
      .eq('period_year', year)
      .then(({ count }) => {
        setDuplicateExists((count ?? 0) > 0);
        setCheckingDuplicate(false);
      });
  }, [year]);

  // Group accounts by type for the selector
  const assetAccounts = useMemo(() => accounts.filter(a => a.account_type === 'activo' && a.level >= 3), [accounts]);
  const liabilityAccounts = useMemo(() => accounts.filter(a => a.account_type === 'pasivo' && a.level >= 3), [accounts]);
  const capitalAccounts = useMemo(() => accounts.filter(a => a.account_type === 'capital' && a.level >= 3), [accounts]);
  const allBsAccounts = useMemo(() => [...assetAccounts, ...liabilityAccounts, ...capitalAccounts], [assetAccounts, liabilityAccounts, capitalAccounts]);

  const totalDebit = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const diff = Math.abs(totalDebit - totalCredit);
  const isBalanced = diff < 0.01 && totalDebit > 0;
  const ecuacionOk = Math.abs(totalDebit - totalCredit) < 0.01;

  const updateLine = (id: string, field: keyof AperturaLine, value: string) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  const addLine = () => setLines(prev => [...prev, newLine()]);
  const removeLine = (id: string) => setLines(prev => prev.filter(l => l.id !== id));

  // Auto-fill description when account is selected
  const handleAccountChange = (lineId: string, code: string) => {
    const acc = accounts.find(a => a.code === code);
    updateLine(lineId, 'account_code', code);
    if (acc && !lines.find(l => l.id === lineId)?.description) {
      updateLine(lineId, 'description', `Saldo inicial — ${acc.name}`);
    }
  };

  const validate = (): string => {
    if (!date) return 'La fecha es requerida.';
    if (!description.trim()) return 'El concepto es requerido.';
    for (const l of lines) {
      if (!l.account_code) return 'Todas las partidas deben tener una cuenta contable.';
      if (!l.description.trim()) return 'Todas las partidas deben tener una descripcion.';
      const d = parseFloat(l.debit) || 0;
      const c = parseFloat(l.credit) || 0;
      if (d === 0 && c === 0) return 'Cada partida debe tener un cargo o un abono mayor a cero.';
      if (d > 0 && c > 0) return 'Cada partida debe tener solo cargo O abono, no ambos.';
    }
    if (!isBalanced) return `La poliza no cuadra. Diferencia: ${fmt(diff)}. Total cargos debe ser igual a total abonos.`;
    return '';
  };

  const handleSave = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    setError('');
    setSaving(true);

    try {
      const { data: numData, error: numErr } = await supabase
        .rpc('generate_entry_number', { p_type: 'apertura', p_year: year, p_month: month });
      if (numErr) throw numErr;

      const { data: entry, error: entryErr } = await supabase
        .from('accounting_entries')
        .insert({
          entry_number: numData as string,
          entry_type: 'apertura',
          entry_date: date,
          period_year: year,
          period_month: month,
          description: description.trim(),
          source_type: 'apertura',
          is_posted: true,
          posted_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (entryErr) throw entryErr;

      const linesPayload = lines.map((l, i) => ({
        entry_id: entry.id,
        line_number: i + 1,
        account_code: l.account_code,
        description: l.description.trim(),
        debit: parseFloat(l.debit) || 0,
        credit: parseFloat(l.credit) || 0,
        cfdi_uuid: null,
      }));

      const { error: linesErr } = await supabase
        .from('accounting_entry_lines')
        .insert(linesPayload);

      if (linesErr) {
        await supabase.from('accounting_entries').delete().eq('id', entry.id);
        throw linesErr;
      }

      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message ?? 'Error al guardar la poliza de apertura.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-sky-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Poliza de Apertura</h2>
              <p className="text-xs text-gray-500 mt-0.5">Saldos iniciales del ejercicio — {MONTHS[month-1]} {year}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Info box */}
          <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 flex gap-3">
            <Info className="w-4 h-4 text-sky-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-sky-800 space-y-1">
              <p className="font-semibold">¿Como llenar la apertura?</p>
              <p>Registra los saldos con los que inicia el ejercicio. Las cuentas de <strong>Activo (deudoras)</strong> van en <strong>Cargo</strong>. Las cuentas de <strong>Pasivo y Capital (acreedoras)</strong> van en <strong>Abono</strong>. La ecuacion contable debe cumplirse: <strong>Activo = Pasivo + Capital</strong>.</p>
              <p>Para registrar la <strong>Utilidad o Perdida del ejercicio anterior</strong>, usa la cuenta <strong>303 — Utilidad / Perdida del ejercicio</strong>.</p>
            </div>
          </div>

          {/* Duplicate warning */}
          {duplicateExists && !checkingDuplicate && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 font-medium">Ya existe una poliza de apertura para el ejercicio {year}. Registrar otra puede generar duplicados contables. Revisa primero en la lista de Polizas.</p>
            </div>
          )}

          {/* Date and description */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Fecha de apertura <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-100"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Concepto <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-100"
              />
            </div>
          </div>

          {/* Lines */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Partidas de apertura</label>
              <div className={`text-xs font-medium px-3 py-1 rounded-full ${
                isBalanced ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                totalDebit > 0 || totalCredit > 0 ? 'bg-red-50 text-red-600 border border-red-200' :
                'bg-gray-100 text-gray-500'
              }`}>
                {isBalanced
                  ? 'Poliza cuadrada — Ecuacion contable OK'
                  : ecuacionOk && totalDebit === 0
                    ? 'Agrega al menos una partida'
                    : `Diferencia: ${fmt(diff)}`}
              </div>
            </div>

            {/* Column headers */}
            <div className="grid grid-cols-12 gap-2 mb-1 px-1">
              <div className="col-span-12 sm:col-span-4 text-xs font-semibold text-gray-400 uppercase">Cuenta</div>
              <div className="col-span-12 sm:col-span-4 text-xs font-semibold text-gray-400 uppercase">Descripcion</div>
              <div className="col-span-5 sm:col-span-2 text-xs font-semibold text-gray-400 uppercase text-right">Cargo</div>
              <div className="col-span-5 sm:col-span-2 text-xs font-semibold text-gray-400 uppercase text-right">Abono</div>
            </div>

            <div className="space-y-2">
              {lines.map((l) => {
                const acc = accounts.find(a => a.code === l.account_code);
                const isDeudora = acc?.nature === 'deudora';
                const isAcreedora = acc?.nature === 'acreedora';
                return (
                  <div key={l.id} className={`grid grid-cols-12 gap-2 items-center rounded-xl p-3 border transition-colors ${
                    isDeudora ? 'bg-sky-50/40 border-sky-100' :
                    isAcreedora ? 'bg-amber-50/40 border-amber-100' :
                    'bg-gray-50 border-gray-100'
                  }`}>
                    <div className="col-span-12 sm:col-span-4">
                      <select
                        value={l.account_code}
                        onChange={e => handleAccountChange(l.id, e.target.value)}
                        className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-sky-400 bg-white"
                      >
                        <option value="">-- Cuenta --</option>
                        <optgroup label="ACTIVO (Cargo)">
                          {assetAccounts.map(a => (
                            <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                          ))}
                        </optgroup>
                        <optgroup label="PASIVO (Abono)">
                          {liabilityAccounts.map(a => (
                            <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                          ))}
                        </optgroup>
                        <optgroup label="CAPITAL (Abono)">
                          {capitalAccounts.map(a => (
                            <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                          ))}
                        </optgroup>
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
                        disabled={!!l.credit && parseFloat(l.credit) > 0}
                        className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-sky-400 bg-white text-right disabled:bg-gray-50 disabled:text-gray-400"
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
                        disabled={!!l.debit && parseFloat(l.debit) > 0}
                        className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-sky-400 bg-white text-right disabled:bg-gray-50 disabled:text-gray-400"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-0 flex justify-end">
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
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={addLine}
              className="mt-3 flex items-center gap-2 text-sm text-sky-600 hover:text-sky-800 font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              Agregar partida
            </button>

            {/* Totals */}
            <div className="mt-4 bg-gray-100 rounded-xl px-5 py-3 grid grid-cols-3 gap-4 text-sm">
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-1">Total Cargos</p>
                <p className="font-bold text-gray-900">{fmt(totalDebit)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-1">Total Abonos</p>
                <p className="font-bold text-gray-900">{fmt(totalCredit)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-1">Diferencia</p>
                <p className={`font-bold ${isBalanced ? 'text-emerald-600' : 'text-red-500'}`}>
                  {isBalanced ? 'Cuadrado' : fmt(diff)}
                </p>
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm font-medium bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !isBalanced}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <CheckCircle className="w-4 h-4" />
            {saving ? 'Guardando...' : 'Registrar Apertura'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AperturaModal;
