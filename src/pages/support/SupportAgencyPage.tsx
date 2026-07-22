import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, CheckCircle, ArrowLeft, Loader, TicketCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { SupportCategory, SupportSubcategory } from '../../types';
import SupportFileUpload, { UploadedFile } from '../../components/support/SupportFileUpload';
import { useAgencyId } from '../../hooks/useAgencyId';

const SupportAgencyPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { agencyId } = useAgencyId();
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [categories, setCategories] = useState<SupportCategory[]>([]);
  const [subcategories, setSubcategories] = useState<SupportSubcategory[]>([]);
  const [filteredSubs, setFilteredSubs] = useState<SupportSubcategory[]>([]);
  const [allowAttachments, setAllowAttachments] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [folio, setFolio] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agencyName, setAgencyName] = useState('');

  useEffect(() => {
    const load = async () => {
      const [catsRes, subsRes] = await Promise.all([
        supabase.from('support_categories').select('*').eq('activa', true).order('nombre'),
        supabase.from('support_subcategories').select('*').eq('activa', true).order('nombre'),
      ]);
      setCategories(catsRes.data ?? []);
      setSubcategories((subsRes.data ?? []).filter(s => s.aplica_a?.includes('agency')));

      if (agencyId) {
        const { data: agency } = await supabase
          .from('agencies')
          .select('name')
          .eq('id', agencyId)
          .maybeSingle();
        if (agency) setAgencyName(agency.name);
      }
    };
    load();
  }, [agencyId]);

  useEffect(() => {
    if (categoryId) {
      setFilteredSubs(subcategories.filter(s => s.category_id === categoryId));
      setSubcategoryId('');
    } else {
      setFilteredSubs([]);
    }
  }, [categoryId, subcategories]);

  useEffect(() => {
    if (subcategoryId) {
      const sub = subcategories.find(s => s.id === subcategoryId);
      setAllowAttachments(sub?.permite_adjuntos ?? true);
      if (!sub?.permite_adjuntos) setFiles([]);
    }
  }, [subcategoryId, subcategories]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subcategoryId || descripcion.length < 20) return;
    if (files.some(f => f.error)) { setError('Hay archivos con errores.'); return; }

    setSubmitting(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

      const formData = new FormData();
      formData.append('data', JSON.stringify({
        tipo: 'agency',
        subcategory_id: subcategoryId,
        solicitante_nombre: agencyName || user?.email,
        solicitante_email: user?.email,
        descripcion,
        user_id: user?.id,
      }));
      files.forEach(f => formData.append('files', f.file));

      const res = await fetch(`${supabaseUrl}/functions/v1/support-create-ticket`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? 'Error al crear el ticket');
      setFolio(result.folio);
    } catch (err: any) {
      setError(err.message ?? 'Error inesperado');
    } finally {
      setSubmitting(false);
    }
  };

  if (folio) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Ticket creado</h2>
          <div className="bg-gray-50 rounded-xl p-4 mb-4">
            <p className="text-sm text-gray-500 mb-1">Tu folio es:</p>
            <p className="text-2xl font-bold text-primary-600 font-mono">{folio}</p>
          </div>
          <div className="flex flex-col gap-3">
            <button onClick={() => navigate('/agency/soporte')} className="btn btn-primary flex items-center justify-center gap-2">
              <TicketCheck className="h-4 w-4" /> Ver mis tickets
            </button>
            <Link to="/soporte" className="btn btn-secondary">Crear otro ticket</Link>
          </div>
        </div>
      </div>
    );
  }

  const availableCategories = categories.filter(cat =>
    subcategories.some(s => s.category_id === cat.id)
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="container-custom py-8">
          <Link to="/soporte" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4">
            <ArrowLeft className="h-4 w-4" /> Volver al centro de soporte
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-secondary-100 rounded-xl flex items-center justify-center">
              <Building2 className="h-5 w-5 text-secondary-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Soporte para Agencias</h1>
              <p className="text-gray-500 text-sm">{agencyName || user?.email}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container-custom py-8 max-w-2xl">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Categoria <span className="text-red-500">*</span>
              </label>
              <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="input" required>
                <option value="">Selecciona una categoria</option>
                {availableCategories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.nombre}</option>
                ))}
              </select>
            </div>

            {categoryId && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tipo de problema <span className="text-red-500">*</span>
                </label>
                <select value={subcategoryId} onChange={e => setSubcategoryId(e.target.value)} className="input" required>
                  <option value="">Selecciona el tipo</option>
                  {filteredSubs.map(sub => (
                    <option key={sub.id} value={sub.id}>{sub.nombre}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Descripcion <span className="text-red-500">*</span>
              </label>
              <textarea
                value={descripcion}
                onChange={e => setDescripcion(e.target.value)}
                rows={5}
                className="input resize-none"
                placeholder="Describe detalladamente el problema..."
                required
              />
              <p className="text-xs text-gray-400 mt-1">{descripcion.length} caracteres (minimo 20)</p>
            </div>

            {allowAttachments && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Adjuntos (opcional)</label>
                <SupportFileUpload files={files} onChange={setFiles} disabled={submitting} />
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
            )}

            <button
              type="submit"
              disabled={submitting || !subcategoryId || descripcion.length < 20}
              className="btn btn-primary w-full flex items-center justify-center gap-2"
            >
              {submitting ? <><Loader className="h-4 w-4 animate-spin" /> Enviando...</> : 'Enviar ticket'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default SupportAgencyPage;
