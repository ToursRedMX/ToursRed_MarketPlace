import React, { useState, useEffect, useMemo } from 'react';
import { X, AlertCircle, CheckCircle, ChevronDown, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface ChartAccount {
  id: string;
  code: string;
  name: string;
  account_type: 'activo' | 'pasivo' | 'capital' | 'ingreso' | 'gasto' | 'costo';
  parent_code: string | null;
  level: number;
  nature: 'deudora' | 'acreedora';
  is_system: boolean;
  is_active: boolean;
  description: string;
  sat_group_code: string;
}

interface Props {
  account?: ChartAccount | null;
  allAccounts: ChartAccount[];
  onClose: () => void;
  onSaved: () => void;
}

const ACCOUNT_TYPES = [
  { value: 'activo', label: 'Activo' },
  { value: 'pasivo', label: 'Pasivo' },
  { value: 'capital', label: 'Capital' },
  { value: 'ingreso', label: 'Ingreso' },
  { value: 'gasto', label: 'Gasto' },
  { value: 'costo', label: 'Costo' },
] as const;

const DEFAULT_NATURE: Record<string, 'deudora' | 'acreedora'> = {
  activo: 'deudora',
  gasto: 'deudora',
  costo: 'deudora',
  pasivo: 'acreedora',
  capital: 'acreedora',
  ingreso: 'acreedora',
};

function suggestNextCode(parentCode: string, siblings: ChartAccount[]): string {
  const children = siblings.filter(a => a.parent_code === parentCode);
  if (children.length === 0) return `${parentCode}.01`;
  const nums = children
    .map(a => {
      const parts = a.code.split('.');
      return parseInt(parts[parts.length - 1], 10);
    })
    .filter(n => !isNaN(n));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  const next = String(max + 1).padStart(2, '0');
  return `${parentCode}.${next}`;
}

const AccountCatalogModal: React.FC<Props> = ({ account, allAccounts, onClose, onSaved }) => {
  const isEdit = !!account;
  const hasMovements = false; // will be determined on submit if needed

  const [code, setCode] = useState(account?.code ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [accountType, setAccountType] = useState<string>(account?.account_type ?? 'activo');
  const [nature, setNature] = useState<'deudora' | 'acreedora'>(account?.nature ?? 'deudora');
  const [parentCode, setParentCode] = useState<string>(account?.parent_code ?? '');
  const [satGroup, setSatGroup] = useState(account?.sat_group_code ?? '');
  const [description, setDescription] = useState(account?.description ?? '');
  const [isActive, setIsActive] = useState(account?.is_active ?? true);

  const [parentSearch, setParentSearch] = useState('');
  const [showParentDropdown, setShowParentDropdown] = useState(false);
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(isEdit);
  const [codeTaken, setCodeTaken] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Eligible parent accounts (not self, not children of self)
  const parentOptions = useMemo(() => {
    const selfCode = account?.code ?? '';
    return allAccounts.filter(a =>
      a.code !== selfCode &&
      !a.code.startsWith(selfCode + '.') &&
      a.is_active
    );
  }, [allAccounts, account]);

  const filteredParents = parentOptions.filter(a =>
    !parentSearch ||
    a.code.toLowerCase().includes(parentSearch.toLowerCase()) ||
    a.name.toLowerCase().includes(parentSearch.toLowerCase())
  );

  const selectedParent = parentOptions.find(a => a.code === parentCode);

  // Auto-suggest code when parent changes
  useEffect(() => {
    if (isEdit || codeManuallyEdited || !parentCode) return;
    const suggested = suggestNextCode(parentCode, allAccounts);
    setCode(suggested);
  }, [parentCode, allAccounts, isEdit, codeManuallyEdited]);

  // Auto-suggest sat_group from parent
  useEffect(() => {
    if (!parentCode || isEdit) return;
    const parent = allAccounts.find(a => a.code === parentCode);
    if (parent && !satGroup) setSatGroup(parent.sat_group_code);
  }, [parentCode, allAccounts, isEdit]);

  // Auto-set nature when type changes (only if user hasn't touched it manually or it's new)
  useEffect(() => {
    if (!isEdit) setNature(DEFAULT_NATURE[accountType] ?? 'deudora');
  }, [accountType, isEdit]);

  // Check code uniqueness (debounced)
  useEffect(() => {
    if (!code || (isEdit && code === account?.code)) { setCodeTaken(false); return; }
    const exists = allAccounts.some(a => a.code === code && a.id !== account?.id);
    setCodeTaken(exists);
  }, [code, allAccounts, isEdit, account]);

  const handleSubmit = async () => {
    setError(null);
    if (!code.trim()) { setError('El codigo es obligatorio.'); return; }
    if (!name.trim()) { setError('El nombre es obligatorio.'); return; }
    if (codeTaken) { setError('Ese codigo ya existe.'); return; }

    const level = parentCode
      ? (allAccounts.find(a => a.code === parentCode)?.level ?? 1) + 1
      : (code.includes('.') ? code.split('.').length : 1);

    setSaving(true);
    try {
      if (isEdit) {
        const { error: upErr } = await supabase
          .from('chart_of_accounts')
          .update({
            name: name.trim(),
            account_type: accountType,
            nature,
            parent_code: parentCode || null,
            sat_group_code: satGroup.trim(),
            description: description.trim(),
            is_active: isActive,
            level,
            updated_at: new Date().toISOString(),
          })
          .eq('id', account!.id);
        if (upErr) throw upErr;
      } else {
        const { error: insErr } = await supabase
          .from('chart_of_accounts')
          .insert({
            code: code.trim(),
            name: name.trim(),
            account_type: accountType,
            nature,
            parent_code: parentCode || null,
            sat_group_code: satGroup.trim(),
            description: description.trim(),
            is_active: isActive,
            level,
          });
        if (insErr) throw insErr;
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message ?? 'Error al guardar la cuenta.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {isEdit ? 'Editar cuenta' : 'Nueva cuenta'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Catalogo de cuentas contables</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Cuenta padre */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
              Cuenta padre <span className="text-gray-400 font-normal normal-case">(opcional)</span>
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowParentDropdown(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-sm border border-gray-200 rounded-lg hover:border-sky-300 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-100 bg-white text-left"
              >
                <span className={selectedParent ? 'text-gray-800' : 'text-gray-400'}>
                  {selectedParent ? `${selectedParent.code} — ${selectedParent.name}` : 'Seleccionar cuenta padre...'}
                </span>
                <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
              </button>
              {showParentDropdown && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                  <div className="p-2 border-b border-gray-100">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                      <input
                        autoFocus
                        value={parentSearch}
                        onChange={e => setParentSearch(e.target.value)}
                        placeholder="Buscar..."
                        className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-sky-400"
                      />
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    <button
                      type="button"
                      onClick={() => { setParentCode(''); setParentSearch(''); setShowParentDropdown(false); }}
                      className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-gray-50 border-b border-gray-50"
                    >
                      Sin cuenta padre
                    </button>
                    {filteredParents.map(a => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => { setParentCode(a.code); setParentSearch(''); setShowParentDropdown(false); }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-sky-50 flex items-center gap-2"
                      >
                        <span className="font-mono font-semibold text-sky-700 w-16 flex-shrink-0">{a.code}</span>
                        <span className="text-gray-700 truncate">{a.name}</span>
                      </button>
                    ))}
                    {filteredParents.length === 0 && (
                      <p className="text-xs text-gray-400 text-center py-4">Sin resultados</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Codigo */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
              Codigo <span className="text-red-400">*</span>
            </label>
            <input
              value={code}
              onChange={e => { setCode(e.target.value); setCodeManuallyEdited(true); }}
              disabled={isEdit && account?.is_system}
              placeholder="Ej: 102.04"
              className={`w-full px-3 py-2.5 text-sm border rounded-lg outline-none font-mono transition-colors
                ${codeTaken ? 'border-red-300 bg-red-50' : 'border-gray-200'}
                focus:border-sky-400 focus:ring-1 focus:ring-sky-100
                disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed`}
            />
            {codeTaken && (
              <p className="text-xs text-red-500 mt-1">Ese codigo ya existe en el catalogo.</p>
            )}
            {!isEdit && parentCode && !codeManuallyEdited && (
              <p className="text-xs text-gray-400 mt-1">Codigo sugerido automaticamente. Puedes editarlo.</p>
            )}
          </div>

          {/* Nombre */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
              Nombre <span className="text-red-400">*</span>
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ej: Cuenta bancaria BBVA"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-100"
            />
          </div>

          {/* Tipo y Naturaleza */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                Tipo <span className="text-red-400">*</span>
              </label>
              <select
                value={accountType}
                onChange={e => setAccountType(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-100 bg-white"
              >
                {ACCOUNT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                Naturaleza <span className="text-red-400">*</span>
              </label>
              <select
                value={nature}
                onChange={e => setNature(e.target.value as 'deudora' | 'acreedora')}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-100 bg-white"
              >
                <option value="deudora">Deudora</option>
                <option value="acreedora">Acreedora</option>
              </select>
            </div>
          </div>

          {/* Agrupador SAT */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
              Agrupador SAT
            </label>
            <input
              value={satGroup}
              onChange={e => setSatGroup(e.target.value)}
              placeholder="Ej: 102-01"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-100 font-mono"
            />
          </div>

          {/* Descripcion */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
              Descripcion <span className="text-gray-400 font-normal normal-case">(opcional)</span>
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              placeholder="Describe el uso de esta cuenta..."
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-100 resize-none"
            />
          </div>

          {/* Estado activo */}
          <div className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-gray-700">Cuenta activa</p>
              <p className="text-xs text-gray-400">Las cuentas inactivas no aparecen en los selectores</p>
            </div>
            <button
              type="button"
              onClick={() => setIsActive(v => !v)}
              className={`relative w-11 h-6 rounded-full transition-colors ${isActive ? 'bg-emerald-500' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isActive ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || codeTaken}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Guardando...
              </span>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                {isEdit ? 'Guardar cambios' : 'Crear cuenta'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AccountCatalogModal;
