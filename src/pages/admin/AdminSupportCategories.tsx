import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Tag, Plus, ChevronDown, ChevronRight, CreditCard as Edit2, Trash2, ToggleLeft, ToggleRight, X, Save, AlertCircle, ArrowLeft } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { SupportCategory, SupportSubcategory, SupportTicketPriority } from '../../types';

const APLICA_OPTIONS = [
  { value: 'general', label: 'Soporte General' },
  { value: 'traveler', label: 'Viajeros' },
  { value: 'agency', label: 'Agencias' },
];

const PRIORITY_OPTIONS: { value: SupportTicketPriority; label: string }[] = [
  { value: 'baja', label: 'Baja' },
  { value: 'media', label: 'Media' },
  { value: 'alta', label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
];

interface CategoryForm { nombre: string; descripcion: string; activa: boolean; aplica_a: string[]; }
interface SubcategoryForm {
  nombre: string; descripcion: string; nomenclatura: string;
  prioridad_default: SupportTicketPriority; sla_horas: number;
  aplica_a: string[]; permite_adjuntos: boolean; activa: boolean;
}

const INITIAL_CAT: CategoryForm = { nombre: '', descripcion: '', activa: true, aplica_a: ['general', 'traveler', 'agency'] };
const INITIAL_SUB: SubcategoryForm = {
  nombre: '', descripcion: '', nomenclatura: '', prioridad_default: 'media',
  sla_horas: 24, aplica_a: ['general'], permite_adjuntos: true, activa: true,
};

const AdminSupportCategories: React.FC = () => {
  const [categories, setCategories] = useState<SupportCategory[]>([]);
  const [subcategories, setSubcategories] = useState<SupportSubcategory[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Category modal
  const [catModal, setCatModal] = useState<{ open: boolean; editing: SupportCategory | null }>({ open: false, editing: null });
  const [catForm, setCatForm] = useState<CategoryForm>(INITIAL_CAT);

  // Subcategory modal
  const [subModal, setSubModal] = useState<{ open: boolean; editing: SupportSubcategory | null; categoryId: string }>({ open: false, editing: null, categoryId: '' });
  const [subForm, setSubForm] = useState<SubcategoryForm>(INITIAL_SUB);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [catsRes, subsRes] = await Promise.all([
      supabase.from('support_categories').select('*').order('nombre'),
      supabase.from('support_subcategories').select('*').order('nombre'),
    ]);
    setCategories(catsRes.data ?? []);
    setSubcategories(subsRes.data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // --- Category CRUD ---
  const openCatModal = (cat?: SupportCategory) => {
    setCatModal({ open: true, editing: cat ?? null });
    setCatForm(cat ? { nombre: cat.nombre, descripcion: cat.descripcion, activa: cat.activa, aplica_a: cat.aplica_a ?? ['general', 'traveler', 'agency'] } : INITIAL_CAT);
    setError(null);
  };

  const toggleCatAplicaA = (value: string) => {
    setCatForm(prev => ({
      ...prev,
      aplica_a: prev.aplica_a.includes(value)
        ? prev.aplica_a.filter(v => v !== value)
        : [...prev.aplica_a, value],
    }));
  };

  const saveCat = async () => {
    if (!catForm.nombre.trim()) { setError('El nombre es requerido.'); return; }
    if (catForm.aplica_a.length === 0) { setError('Selecciona al menos un tipo de aplicacion.'); return; }
    setSaving(true); setError(null);
    if (catModal.editing) {
      await supabase.from('support_categories').update(catForm).eq('id', catModal.editing.id);
    } else {
      await supabase.from('support_categories').insert(catForm);
    }
    await load();
    setCatModal({ open: false, editing: null });
    setSaving(false);
  };

  const toggleCatActive = async (cat: SupportCategory) => {
    await supabase.from('support_categories').update({ activa: !cat.activa }).eq('id', cat.id);
    await load();
  };

  const deleteCat = async (cat: SupportCategory) => {
    if (!confirm(`¿Eliminar la categoria "${cat.nombre}"? Se eliminaran tambien sus subcategorias.`)) return;
    await supabase.from('support_categories').delete().eq('id', cat.id);
    await load();
  };

  // --- Subcategory CRUD ---
  const openSubModal = (categoryId: string, sub?: SupportSubcategory) => {
    setSubModal({ open: true, editing: sub ?? null, categoryId });
    setSubForm(sub ? {
      nombre: sub.nombre, descripcion: sub.descripcion, nomenclatura: sub.nomenclatura,
      prioridad_default: sub.prioridad_default, sla_horas: sub.sla_horas,
      aplica_a: sub.aplica_a, permite_adjuntos: sub.permite_adjuntos, activa: sub.activa,
    } : INITIAL_SUB);
    setError(null);
  };

  const saveSub = async () => {
    if (!subForm.nombre.trim()) { setError('El nombre es requerido.'); return; }
    if (!subForm.nomenclatura.trim()) { setError('La nomenclatura es requerida.'); return; }
    if (!/^[A-Z]{2,6}$/.test(subForm.nomenclatura)) {
      setError('La nomenclatura debe ser 2-6 letras mayusculas (ej: PAG, REG).');
      return;
    }
    if (subForm.aplica_a.length === 0) { setError('Selecciona al menos un tipo de aplicacion.'); return; }
    setSaving(true); setError(null);
    const payload = { ...subForm, category_id: subModal.categoryId };
    if (subModal.editing) {
      await supabase.from('support_subcategories').update(payload).eq('id', subModal.editing.id);
    } else {
      await supabase.from('support_subcategories').insert(payload);
    }
    await load();
    setSubModal({ open: false, editing: null, categoryId: '' });
    setSaving(false);
  };

  const toggleSubActive = async (sub: SupportSubcategory) => {
    await supabase.from('support_subcategories').update({ activa: !sub.activa }).eq('id', sub.id);
    await load();
  };

  const deleteSub = async (sub: SupportSubcategory) => {
    if (!confirm(`¿Eliminar "${sub.nombre}"?`)) return;
    await supabase.from('support_subcategories').delete().eq('id', sub.id);
    await load();
  };

  const toggleAplicaA = (value: string) => {
    setSubForm(prev => ({
      ...prev,
      aplica_a: prev.aplica_a.includes(value)
        ? prev.aplica_a.filter(v => v !== value)
        : [...prev.aplica_a, value],
    }));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="container-custom py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link to="/admin/service-desk" className="text-gray-400 hover:text-gray-600">
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
                <Tag className="h-5 w-5 text-primary-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Categorias de Soporte</h1>
                <p className="text-sm text-gray-500">{categories.length} categorias, {subcategories.length} subcategorias</p>
              </div>
            </div>
            <button onClick={() => openCatModal()} className="btn btn-primary flex items-center gap-2">
              <Plus className="h-4 w-4" /> Nueva Categoria
            </button>
          </div>
        </div>
      </div>

      <div className="container-custom py-6 max-w-4xl">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600" />
          </div>
        ) : categories.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
            <Tag className="mx-auto h-12 w-12 text-gray-300 mb-3" />
            <p className="text-gray-500 mb-4">No hay categorias creadas.</p>
            <button onClick={() => openCatModal()} className="btn btn-primary">Crear primera categoria</button>
          </div>
        ) : (
          <div className="space-y-3">
            {categories.map(cat => {
              const catSubs = subcategories.filter(s => s.category_id === cat.id);
              const isExpanded = expanded.has(cat.id);
              return (
                <div key={cat.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between p-4">
                    <button
                      onClick={() => toggleExpand(cat.id)}
                      className="flex items-center gap-2 flex-1 text-left"
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-800">{cat.nombre}</span>
                          {!cat.activa && <span className="text-xs text-gray-400">(inactiva)</span>}
                          {(cat.aplica_a ?? []).map(a => (
                            <span key={a} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                              {a === 'general' ? 'General' : a === 'traveler' ? 'Viajero' : 'Agencia'}
                            </span>
                          ))}
                        </div>
                        {cat.descripcion && <p className="text-xs text-gray-500 mt-0.5">{cat.descripcion}</p>}
                      </div>
                      <span className="ml-2 text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
                        {catSubs.length} subcategorias
                      </span>
                    </button>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => openSubModal(cat.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50" title="Agregar subcategoria">
                        <Plus className="h-4 w-4" />
                      </button>
                      <button onClick={() => openCatModal(cat)} className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50">
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button onClick={() => toggleCatActive(cat)} className={`p-1.5 rounded-lg transition-colors ${cat.activa ? 'text-green-500 hover:bg-green-50' : 'text-gray-300 hover:bg-gray-50'}`}>
                        {cat.activa ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5" />}
                      </button>
                      <button onClick={() => deleteCat(cat)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-gray-100 bg-gray-50 p-3 space-y-2">
                      {catSubs.length === 0 ? (
                        <div className="text-center py-4 text-sm text-gray-400">
                          No hay subcategorias.
                          <button onClick={() => openSubModal(cat.id)} className="ml-2 text-primary-600 hover:underline">Agregar una</button>
                        </div>
                      ) : (
                        catSubs.map(sub => (
                          <div key={sub.id} className="bg-white rounded-lg border border-gray-200 p-3 flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-gray-800 text-sm">{sub.nombre}</span>
                                <span className="font-mono text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded">{sub.nomenclatura}</span>
                                <span className="text-xs text-gray-400">SLA: {sub.sla_horas}h</span>
                                {!sub.activa && <span className="text-xs text-gray-400">(inactiva)</span>}
                              </div>
                              <div className="flex gap-2 mt-1 flex-wrap">
                                {sub.aplica_a.map(a => (
                                  <span key={a} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                    {a === 'general' ? 'General' : a === 'traveler' ? 'Viajero' : 'Agencia'}
                                  </span>
                                ))}
                                {sub.permite_adjuntos && <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">Adjuntos</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button onClick={() => openSubModal(cat.id, sub)} className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50">
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => toggleSubActive(sub)} className={`p-1.5 rounded transition-colors ${sub.activa ? 'text-green-500 hover:bg-green-50' : 'text-gray-300 hover:bg-gray-50'}`}>
                                {sub.activa ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5" />}
                              </button>
                              <button onClick={() => deleteSub(sub)} className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Category modal */}
      {catModal.open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">
                {catModal.editing ? 'Editar Categoria' : 'Nueva Categoria'}
              </h2>
              <button onClick={() => setCatModal({ open: false, editing: null })} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre <span className="text-red-500">*</span></label>
                <input type="text" value={catForm.nombre} onChange={e => setCatForm(p => ({ ...p, nombre: e.target.value }))} className="input" placeholder="Ej: Pagos y Facturacion" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descripcion</label>
                <textarea value={catForm.descripcion} onChange={e => setCatForm(p => ({ ...p, descripcion: e.target.value }))} rows={2} className="input resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Aplica a <span className="text-red-500">*</span></label>
                <div className="flex flex-wrap gap-2">
                  {APLICA_OPTIONS.map(opt => (
                    <label key={opt.value} className="flex items-center gap-2 cursor-pointer bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 hover:border-primary-300">
                      <input
                        type="checkbox"
                        checked={catForm.aplica_a.includes(opt.value)}
                        onChange={() => toggleCatAplicaA(opt.value)}
                        className="rounded text-primary-600"
                      />
                      <span className="text-sm text-gray-700">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={catForm.activa} onChange={e => setCatForm(p => ({ ...p, activa: e.target.checked }))} className="rounded text-primary-600" />
                <span className="text-sm text-gray-700">Activa</span>
              </label>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
            <div className="flex gap-3 p-5 border-t border-gray-200">
              <button onClick={() => setCatModal({ open: false, editing: null })} className="btn btn-secondary flex-1">Cancelar</button>
              <button onClick={saveCat} disabled={saving} className="btn btn-primary flex-1 flex items-center justify-center gap-2">
                {saving ? <span className="animate-spin h-4 w-4 border-t-2 border-white rounded-full" /> : <Save className="h-4 w-4" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subcategory modal */}
      {subModal.open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">
                {subModal.editing ? 'Editar Subcategoria' : 'Nueva Subcategoria'}
              </h2>
              <button onClick={() => setSubModal({ open: false, editing: null, categoryId: '' })} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nombre <span className="text-red-500">*</span></label>
                  <input type="text" value={subForm.nombre} onChange={e => setSubForm(p => ({ ...p, nombre: e.target.value }))} className="input" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nomenclatura <span className="text-red-500">*</span>
                    <span className="ml-1 text-xs text-gray-400">(2-6 letras mayusc.)</span>
                  </label>
                  <input
                    type="text"
                    value={subForm.nomenclatura}
                    onChange={e => setSubForm(p => ({ ...p, nomenclatura: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') }))}
                    className="input font-mono uppercase"
                    placeholder="PAG"
                    maxLength={6}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">SLA (horas)</label>
                  <input type="number" value={subForm.sla_horas} onChange={e => setSubForm(p => ({ ...p, sla_horas: Number(e.target.value) }))} className="input" min={1} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prioridad por defecto</label>
                  <select value={subForm.prioridad_default} onChange={e => setSubForm(p => ({ ...p, prioridad_default: e.target.value as SupportTicketPriority }))} className="input">
                    {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descripcion</label>
                <textarea value={subForm.descripcion} onChange={e => setSubForm(p => ({ ...p, descripcion: e.target.value }))} rows={2} className="input resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Aplica a <span className="text-red-500">*</span></label>
                <div className="flex flex-wrap gap-2">
                  {APLICA_OPTIONS.map(opt => (
                    <label key={opt.value} className="flex items-center gap-2 cursor-pointer bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 hover:border-primary-300">
                      <input
                        type="checkbox"
                        checked={subForm.aplica_a.includes(opt.value)}
                        onChange={() => toggleAplicaA(opt.value)}
                        className="rounded text-primary-600"
                      />
                      <span className="text-sm text-gray-700">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={subForm.permite_adjuntos} onChange={e => setSubForm(p => ({ ...p, permite_adjuntos: e.target.checked }))} className="rounded text-primary-600" />
                  <span className="text-sm text-gray-700">Permite adjuntos</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={subForm.activa} onChange={e => setSubForm(p => ({ ...p, activa: e.target.checked }))} className="rounded text-primary-600" />
                  <span className="text-sm text-gray-700">Activa</span>
                </label>
              </div>
              {error && (
                <div className="flex items-center gap-2 text-red-600 text-sm">
                  <AlertCircle className="h-4 w-4" /> {error}
                </div>
              )}
            </div>
            <div className="flex gap-3 p-5 border-t border-gray-200">
              <button onClick={() => setSubModal({ open: false, editing: null, categoryId: '' })} className="btn btn-secondary flex-1">Cancelar</button>
              <button onClick={saveSub} disabled={saving} className="btn btn-primary flex-1 flex items-center justify-center gap-2">
                {saving ? <span className="animate-spin h-4 w-4 border-t-2 border-white rounded-full" /> : <Save className="h-4 w-4" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminSupportCategories;
