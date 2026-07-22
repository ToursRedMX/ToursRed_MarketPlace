import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Headphones as HeadphonesIcon, CheckCircle, ArrowLeft, Loader, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { SupportCategory, SupportSubcategory } from '../../types';
import SupportFileUpload, { UploadedFile } from '../../components/support/SupportFileUpload';

interface FormData {
  nombre: string;
  email: string;
  category_id: string;
  subcategory_id: string;
  descripcion: string;
}

const INITIAL_FORM: FormData = {
  nombre: '',
  email: '',
  category_id: '',
  subcategory_id: '',
  descripcion: '',
};

const APEL_CATEGORY_NAME_FRAGMENT = 'pelac'; // matches 'apelacón'

const SupportGeneralPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const isApelacion = searchParams.get('tipo') === 'apelacion';
  const preselectedCategoryId = searchParams.get('categoria') ?? '';

  const [form, setForm] = useState<FormData>({ ...INITIAL_FORM, category_id: preselectedCategoryId });
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [categories, setCategories] = useState<SupportCategory[]>([]);
  const [subcategories, setSubcategories] = useState<SupportSubcategory[]>([]);
  const [filteredSubs, setFilteredSubs] = useState<SupportSubcategory[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [folio, setFolio] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowAttachments, setAllowAttachments] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data: cats } = await supabase.from('support_categories').select('*').eq('activa', true).order('nombre');
      const { data: subs } = await supabase.from('support_subcategories').select('*').eq('activa', true).order('nombre');
      setCategories(cats ?? []);
      // Include 'agency' categories in addition to 'general' for the general page
      // so that APEL-type appeals (aplica_a = ['agency']) show here when redirected
      const generalAndAgencySubs = (subs ?? []).filter(s =>
        s.aplica_a?.includes('general') || s.aplica_a?.includes('agency')
      );
      setSubcategories(generalAndAgencySubs);

      // Auto-detect APEL category by name fragment if no preselection
      if (!preselectedCategoryId && isApelacion) {
        const apelCat = (cats ?? []).find((c: SupportCategory) =>
          c.nombre?.toLowerCase().includes(APEL_CATEGORY_NAME_FRAGMENT)
        );
        if (apelCat) setForm(prev => ({ ...prev, category_id: apelCat.id }));
      }
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (form.category_id) {
      const filtered = subcategories.filter(s => s.category_id === form.category_id);
      setFilteredSubs(filtered);
      setForm(prev => ({ ...prev, subcategory_id: '' }));
    } else {
      setFilteredSubs([]);
    }
  }, [form.category_id, subcategories]);

  useEffect(() => {
    if (form.subcategory_id) {
      const sub = subcategories.find(s => s.id === form.subcategory_id);
      setAllowAttachments(sub?.permite_adjuntos ?? true);
      if (!sub?.permite_adjuntos) setFiles([]);
    }
  }, [form.subcategory_id, subcategories]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nombre.trim() || !form.email.trim() || !form.subcategory_id || !form.descripcion.trim()) {
      setError('Por favor completa todos los campos requeridos.');
      return;
    }
    const hasFileErrors = files.some(f => f.error);
    if (hasFileErrors) {
      setError('Hay archivos con errores. Por favor eliminalos antes de continuar.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const formData = new FormData();
      formData.append('data', JSON.stringify({
        tipo: 'general',
        subcategory_id: form.subcategory_id,
        solicitante_nombre: form.nombre,
        solicitante_email: form.email,
        descripcion: form.descripcion,
        extra_data: isApelacion ? { ticket_type: 'apelacion_rechazo' } : undefined,
      }));
      files.forEach(f => formData.append('files', f.file));

      const res = await fetch(`${supabaseUrl}/functions/v1/support-create-ticket`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supabaseAnonKey}` },
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? 'Error al crear el ticket');
      setFolio(result.folio);
    } catch (err: any) {
      setError(err.message ?? 'Ocurrio un error inesperado');
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
          <p className="text-gray-600 mb-4">Tu solicitud de soporte ha sido registrada exitosamente.</p>
          <div className="bg-gray-50 rounded-xl p-4 mb-6">
            <p className="text-sm text-gray-500 mb-1">Tu folio de seguimiento es:</p>
            <p className="text-2xl font-bold text-primary-600 font-mono">{folio}</p>
          </div>
          <p className="text-sm text-gray-500 mb-6">
            Recibirás un correo en <strong>{form.email}</strong> con los detalles de tu ticket.
            Un agente se pondra en contacto contigo.
          </p>
          <div className="flex flex-col gap-3">
            <Link to="/" className="btn btn-primary">
              Volver al inicio
            </Link>
            <Link to="/soporte" className="btn btn-secondary">
              Crear otro ticket
            </Link>
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
            <div className="w-10 h-10 bg-accent-100 rounded-xl flex items-center justify-center">
              <HeadphonesIcon className="h-5 w-5 text-accent-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Soporte General</h1>
              <p className="text-gray-500 text-sm">Problemas de acceso, registro y dudas generales</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container-custom py-8 max-w-2xl">
        {/* Apelación banner */}
        {isApelacion && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-900">Estás enviando una apelación de rechazo de registro</p>
              <p className="text-sm text-amber-800 mt-0.5">
                Explica en detalle por qué consideras que el rechazo fue incorrecto y adjunta cualquier documento o evidencia relevante. Nuestro equipo revisará tu caso.
              </p>
            </div>
          </div>
        )}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nombre completo <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="nombre"
                  value={form.nombre}
                  onChange={handleChange}
                  className="input"
                  placeholder="Tu nombre"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Correo electronico <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  className="input"
                  placeholder="tu@correo.com"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Categoria <span className="text-red-500">*</span>
              </label>
              <select
                name="category_id"
                value={form.category_id}
                onChange={handleChange}
                className="input"
                required
              >
                <option value="">Selecciona una categoria</option>
                {availableCategories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.nombre}</option>
                ))}
              </select>
            </div>

            {form.category_id && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tipo de problema <span className="text-red-500">*</span>
                </label>
                <select
                  name="subcategory_id"
                  value={form.subcategory_id}
                  onChange={handleChange}
                  className="input"
                  required
                >
                  <option value="">Selecciona el tipo de problema</option>
                  {filteredSubs.map(sub => (
                    <option key={sub.id} value={sub.id}>{sub.nombre}</option>
                  ))}
                </select>
                {filteredSubs.length === 0 && (
                  <p className="text-xs text-gray-400 mt-1">No hay subcategorias disponibles para esta seleccion.</p>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Descripcion del problema <span className="text-red-500">*</span>
              </label>
              <textarea
                name="descripcion"
                value={form.descripcion}
                onChange={handleChange}
                rows={5}
                className="input resize-none"
                placeholder="Describe con detalle el problema que estas experimentando..."
                required
              />
              <p className="text-xs text-gray-400 mt-1">Minimo 20 caracteres. {form.descripcion.length} caracteres.</p>
            </div>

            {allowAttachments && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Evidencias o adjuntos (opcional)
                </label>
                <SupportFileUpload files={files} onChange={setFiles} disabled={submitting} />
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || form.descripcion.length < 20}
              className="btn btn-primary w-full flex items-center justify-center gap-2"
            >
              {submitting ? (
                <><Loader className="h-4 w-4 animate-spin" /> Enviando...</>
              ) : (
                'Enviar solicitud de soporte'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default SupportGeneralPage;
