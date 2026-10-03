import React, { useEffect, useState } from 'react';
import { GitMerge, Trash2, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';

/**
 * Alias de búsquedas: une variantes de escritura de un mismo destino
 * ("sian kan" / "Sian Kaan") para que el reporte las cuente juntas. Las
 * sugerencias salen por parecido (migración alias_de_busquedas) y nada se une
 * sin que el superadmin lo apruebe.
 */

interface Sugerencia {
  termino: string;
  llave: string;
  busquedas: number;
  sugerencia: string;
  llave_sugerida: string;
  fuente: 'catalogo' | 'busquedas';
  similitud: number;
}

interface Alias {
  alias_key: string;
  canonical_key: string;
  canonical_label: string;
  created_at: string;
}

interface Props {
  dias: number;
  /** Se llama tras unir/quitar para que la tabla de términos se recargue. */
  onCambio: () => void;
}

const AdminDemandAliases: React.FC<Props> = ({ dias, onCambio }) => {
  const [version, setVersion] = useState(0);
  const [datos, setDatos] = useState<{
    clave: string; error: string | null; sugerencias: Sugerencia[]; alias: Alias[];
  } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [variante, setVariante] = useState('');
  const [formaCorrecta, setFormaCorrecta] = useState('');

  const periodo = Math.max(dias, 90);
  const clave = `${periodo}|${version}`;

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const [sug, ali] = await Promise.all([
        supabase.rpc('admin_demand_alias_suggestions', { p_days: periodo, p_limit: 30 }),
        supabase.rpc('admin_search_aliases'),
      ]);
      if (cancelado) return;
      if (sug.error || ali.error) {
        console.error('AdminDemandAliases: no se pudieron cargar los alias', sug.error ?? ali.error);
        setDatos({ clave, error: 'No se pudieron cargar los alias.', sugerencias: [], alias: [] });
        return;
      }
      setDatos({
        clave,
        error: null,
        sugerencias: (sug.data as Sugerencia[] | null) ?? [],
        alias: (ali.data as Alias[] | null) ?? [],
      });
    })();
    return () => { cancelado = true; };
  }, [periodo, clave]);

  const cargando = datos?.clave !== clave;

  const ejecutar = async (accion: () => PromiseLike<{ error: unknown }>, exito: string) => {
    setOcupado(true);
    setMensaje(null);
    const { error } = await accion();
    setOcupado(false);
    if (error) {
      console.error('AdminDemandAliases: la acción falló', error);
      setMensaje({ tipo: 'error', texto: 'No se pudo guardar el cambio.' });
      return;
    }
    setMensaje({ tipo: 'ok', texto: exito });
    setVersion((v) => v + 1);
    onCambio();
  };

  const unir = (alias: string, canonica: string) =>
    ejecutar(
      () => supabase.rpc('admin_set_search_alias', { p_alias: alias, p_canonical: canonica }),
      `Listo: «${alias}» ahora cuenta como «${canonica}».`,
    );

  const quitar = (a: Alias) =>
    ejecutar(
      () => supabase.rpc('admin_remove_search_alias', { p_alias_key: a.alias_key }),
      `Se separó «${a.alias_key}».`,
    );

  const descartar = (s: Sugerencia) =>
    ejecutar(
      () => supabase.rpc('admin_dismiss_alias_suggestion', { p_alias_key: s.llave, p_candidate_key: s.llave_sugerida }),
      'Anotado: no vuelvo a sugerir esa pareja.',
    );

  const unirManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!variante.trim() || !formaCorrecta.trim()) return;
    await unir(variante.trim(), formaCorrecta.trim());
    setVariante('');
    setFormaCorrecta('');
  };

  const sugerencias = cargando ? [] : datos?.sugerencias ?? [];
  const alias = cargando ? [] : datos?.alias ?? [];

  return (
    <section className="mt-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
      <header className="border-b border-gray-100 px-5 py-4">
        <h2 className="flex items-center gap-2 font-semibold text-gray-900">
          <GitMerge className="w-4 h-4 text-primary-600" />
          Variantes de escritura
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          Los viajeros escriben los nombres de muchas formas. Une las que son el mismo destino para que cuenten juntas
          en el reporte (también el de las agencias) y en los avisos «Avísame». Nada se une solo.
        </p>
      </header>

      {mensaje && (
        <div className={`px-5 py-2 text-sm ${mensaje.tipo === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {mensaje.texto}
        </div>
      )}
      {datos?.error && !cargando && <p className="px-5 py-4 text-sm text-red-700">{datos.error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
        <div className="p-5">
          <h3 className="mb-3 text-sm font-medium text-gray-900">Sugerencias por parecido</h3>
          {cargando ? (
            <div className="flex justify-center py-6">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
            </div>
          ) : sugerencias.length === 0 ? (
            <p className="text-sm text-gray-500">No hay variantes parecidas por revisar.</p>
          ) : (
            <ul className="space-y-3">
              {sugerencias.map((s) => (
                <li key={`${s.llave}|${s.llave_sugerida}`} className="rounded-lg border border-gray-100 p-3 text-sm">
                  <p className="text-gray-800">
                    «<strong>{s.termino}</strong>» ({s.busquedas}) se parece a «<strong>{s.sugerencia}</strong>»
                    <span className="ml-1 text-xs text-gray-400">
                      {s.fuente === 'catalogo' ? 'destino del catálogo' : 'otra búsqueda'} · {Math.round(s.similitud * 100)}%
                    </span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" disabled={ocupado} onClick={() => unir(s.termino, s.sugerencia)}
                      className="px-2.5 py-1 text-xs font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
                      Es lo mismo: contar como «{s.sugerencia}»
                    </button>
                    {s.fuente === 'busquedas' && (
                      <button type="button" disabled={ocupado} onClick={() => unir(s.sugerencia, s.termino)}
                        className="px-2.5 py-1 text-xs font-medium rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                        Mejor contar como «{s.termino}»
                      </button>
                    )}
                    <button type="button" disabled={ocupado} onClick={() => descartar(s)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-50">
                      <X className="w-3 h-3" /> No son lo mismo
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={unirManual} className="mt-5 border-t border-gray-100 pt-4">
            <h3 className="mb-2 text-sm font-medium text-gray-900">Unir a mano</h3>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input value={variante} onChange={(e) => setVariante(e.target.value)} maxLength={80}
                placeholder="Como lo escribió el viajero"
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              <input value={formaCorrecta} onChange={(e) => setFormaCorrecta(e.target.value)} maxLength={80}
                placeholder="Cómo debe contarse"
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              <button type="submit" disabled={ocupado || !variante.trim() || !formaCorrecta.trim()}
                className="px-3 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
                Unir
              </button>
            </div>
          </form>
        </div>

        <div className="p-5">
          <h3 className="mb-3 text-sm font-medium text-gray-900">Uniones activas</h3>
          {cargando ? null : alias.length === 0 ? (
            <p className="text-sm text-gray-500">Todavía no hay uniones.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {alias.map((a) => (
                <li key={a.alias_key} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-gray-800">
                    «{a.alias_key}» <span className="text-gray-400">→</span> <strong>{a.canonical_label}</strong>
                  </span>
                  <button type="button" disabled={ocupado} onClick={() => quitar(a)}
                    className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 hover:text-red-600 disabled:opacity-50"
                    title="Separar">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
};

export default AdminDemandAliases;
