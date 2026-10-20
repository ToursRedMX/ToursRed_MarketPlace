import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mail, RefreshCw, Filter, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import {
  FILTROS_VACIOS,
  aplicarFiltros,
  contarFiltrosActivos,
  estadoDeEntrega,
  etiquetaClase,
  etiquetaEvento,
  etiquetaProveedor,
  type EstadoEntrega,
  type FiltrosBitacora,
} from '../../lib/bitacoraCorreo';

interface EnvioCorreo {
  id: string;
  envio_id: string;
  creado_en: string;
  proveedor: string;
  es_respaldo: boolean;
  aceptado: boolean;
  clase: string | null;
  codigo: string | null;
  http_status: number | null;
  id_proveedor: string | null;
  destinatarios: string[];
  asunto: string | null;
}

interface EventoCorreo {
  id: string;
  recibido_en: string;
  proveedor: string;
  tipo: string;
  referencia: string | null;
  destinatario: string | null;
  detalle: string | null;
}

const TAMANO_PAGINA = 25;

const TONOS: Record<EstadoEntrega['tono'], string> = {
  verde: 'bg-green-50 text-green-700 border border-green-200',
  azul: 'bg-blue-50 text-blue-700 border border-blue-200',
  amarillo: 'bg-amber-50 text-amber-700 border border-amber-200',
  rojo: 'bg-red-50 text-red-700 border border-red-200',
  gris: 'bg-gray-50 text-gray-600 border border-gray-200',
};

const fechaLarga = (iso: string) => format(new Date(iso), "d MMM yyyy, HH:mm:ss", { locale: es });

/** Detalle de un envío: todo lo que se sabe de él y lo que el proveedor contó después. */
const DetalleDeEnvio: React.FC<{ envio: EnvioCorreo }> = ({ envio }) => {
  const { data, isFetching } = useQuery({
    queryKey: ['admin-bitacora-correo-detalle', envio.id],
    queryFn: async () => {
      const [intentos, eventos] = await Promise.all([
        supabase.from('bitacora_envio_correo').select('*').eq('envio_id', envio.envio_id).order('creado_en', { ascending: true }),
        supabase.from('bitacora_evento_correo').select('id, recibido_en, proveedor, tipo, referencia, destinatario, detalle')
          .eq('referencia', envio.id).order('recibido_en', { ascending: true }),
      ]);
      if (intentos.error || eventos.error) {
        console.error('Bitácora de correo: no se pudo leer el detalle', intentos.error ?? eventos.error);
        throw new Error('No se pudo leer el detalle de este envío');
      }
      return { intentos: (intentos.data ?? []) as EnvioCorreo[], eventos: (eventos.data ?? []) as EventoCorreo[] };
    },
  });

  if (isFetching && !data) return <div className="p-4 text-sm text-gray-500">Cargando detalle…</div>;
  if (!data) return <div className="p-4 text-sm text-red-600">No se pudo leer el detalle de este envío.</div>;

  return (
    <div className="grid gap-4 p-4 md:grid-cols-2 bg-gray-50">
      <div>
        <h4 className="text-xs font-semibold uppercase text-gray-500 mb-2">Intentos de este correo</h4>
        <ul className="space-y-2">
          {data.intentos.map((i) => (
            <li key={i.id} className={`text-sm rounded-lg border p-2 bg-white ${i.id === envio.id ? 'border-blue-300' : 'border-gray-200'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{etiquetaProveedor(i.proveedor)}</span>
                {i.es_respaldo && <span className="text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">respaldo</span>}
                <span className={i.aceptado ? 'text-green-700' : 'text-red-700'}>{i.aceptado ? 'aceptado' : 'no aceptado'}</span>
                {i.http_status != null && <span className="text-xs text-gray-500">HTTP {i.http_status}</span>}
              </div>
              {!i.aceptado && (
                <div className="text-xs text-red-700 mt-1">
                  {etiquetaClase(i.clase)}{i.codigo ? ` · ${i.codigo}` : ''}
                </div>
              )}
              <div className="text-xs text-gray-500 mt-1">{fechaLarga(i.creado_en)}</div>
              {i.id_proveedor && <div className="text-xs text-gray-400 mt-1 break-all">id del proveedor: {i.id_proveedor}</div>}
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-400 mt-2 break-all">Referencia de este intento: {envio.id}</p>
      </div>
      <div>
        <h4 className="text-xs font-semibold uppercase text-gray-500 mb-2">Lo que avisó el proveedor</h4>
        {data.eventos.length === 0 ? (
          <p className="text-sm text-gray-500">
            Sin eventos todavía. Solo Zoho los manda (entregado, abierto, rebote); de SendGrid y SMTP2GO solo se sabe
            que aceptaron el correo.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.eventos.map((e) => (
              <li key={e.id} className="text-sm rounded-lg border border-gray-200 bg-white p-2">
                <div className="font-medium">{etiquetaEvento(e.tipo)}</div>
                {e.detalle && <div className="text-xs text-gray-600 mt-1">{e.detalle}</div>}
                <div className="text-xs text-gray-500 mt-1">{fechaLarga(e.recibido_en)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const AdminBitacoraCorreo: React.FC = () => {
  const { permissions, isSuperAdmin } = useAuth();
  const puedeVer = isSuperAdmin || permissions?.canManageSettings;

  const [pagina, setPagina] = useState(0);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<FiltrosBitacora>(FILTROS_VACIOS);
  const [aplicados, setAplicados] = useState<FiltrosBitacora>(FILTROS_VACIOS);

  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ['admin-bitacora-correo', pagina, aplicados],
    enabled: Boolean(puedeVer),
    queryFn: async () => {
      const consulta = aplicarFiltros(
        supabase.from('bitacora_envio_correo').select('*', { count: 'exact' }),
        aplicados,
      )
        .order('creado_en', { ascending: false })
        .range(pagina * TAMANO_PAGINA, pagina * TAMANO_PAGINA + TAMANO_PAGINA - 1);
      const { data: filas, count, error: errorEnvios } = await consulta;
      if (errorEnvios) {
        console.error('Bitácora de correo: no se pudo leer', errorEnvios);
        throw new Error('No se pudo leer la bitácora de correo');
      }
      const envios = (filas ?? []) as EnvioCorreo[];

      // Los eventos de esta página, para el estado de entrega de cada fila.
      const tiposPorEnvio = new Map<string, string[]>();
      if (envios.length > 0) {
        const { data: eventos, error: errorEventos } = await supabase
          .from('bitacora_evento_correo')
          .select('referencia, tipo')
          .in('referencia', envios.map((e) => e.id));
        if (errorEventos) {
          // Los envíos se muestran igual; sin eventos solo se sabe que el proveedor aceptó el correo.
          console.error('Bitácora de correo: no se pudieron leer los eventos', errorEventos);
        }
        for (const ev of (eventos ?? []) as { referencia: string; tipo: string }[]) {
          tiposPorEnvio.set(ev.referencia, [...(tiposPorEnvio.get(ev.referencia) ?? []), ev.tipo]);
        }
      }
      return { envios, total: count ?? 0, tiposPorEnvio };
    },
  });

  // Últimas 24 horas: cuatro conteos baratos (head: true, sin traer filas).
  const { data: resumen } = useQuery({
    queryKey: ['admin-bitacora-correo-resumen'],
    enabled: Boolean(puedeVer),
    queryFn: async () => {
      const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const contar = async (consulta: PromiseLike<{ count: number | null; error: unknown }>) => {
        const { count, error: e } = await consulta;
        if (e) console.error('Bitácora de correo: no se pudo contar', e);
        return count ?? 0;
      };
      const [intentos, rechazados, respaldo, rebotes] = await Promise.all([
        contar(supabase.from('bitacora_envio_correo').select('id', { count: 'exact', head: true }).gte('creado_en', desde)),
        contar(supabase.from('bitacora_envio_correo').select('id', { count: 'exact', head: true }).gte('creado_en', desde).eq('aceptado', false)),
        contar(supabase.from('bitacora_envio_correo').select('id', { count: 'exact', head: true }).gte('creado_en', desde).eq('es_respaldo', true)),
        contar(supabase.from('bitacora_evento_correo').select('id', { count: 'exact', head: true }).gte('recibido_en', desde).in('tipo', ['hardbounce', 'softbounce'])),
      ]);
      return { intentos, rechazados, respaldo, rebotes };
    },
  });

  if (!puedeVer) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Acceso Denegado</h2>
          <p className="text-gray-600">No tienes permiso para ver la bitácora de correo.</p>
        </div>
      </div>
    );
  }

  const envios = data?.envios ?? [];
  const total = data?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / TAMANO_PAGINA));
  const activos = contarFiltrosActivos(aplicados);

  const aplicar = () => {
    setPagina(0);
    setAplicados(filtros);
  };
  const limpiar = () => {
    setPagina(0);
    setFiltros(FILTROS_VACIOS);
    setAplicados(FILTROS_VACIOS);
  };

  const tarjetas: { titulo: string; valor: number | undefined; alerta?: boolean }[] = [
    { titulo: 'Intentos (24 h)', valor: resumen?.intentos },
    { titulo: 'No aceptados', valor: resumen?.rechazados, alerta: (resumen?.rechazados ?? 0) > 0 },
    { titulo: 'Salieron por el respaldo', valor: resumen?.respaldo, alerta: (resumen?.respaldo ?? 0) > 0 },
    { titulo: 'Rebotes (24 h)', valor: resumen?.rebotes, alerta: (resumen?.rebotes ?? 0) > 0 },
  ];

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center">
              <Mail className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Bitácora de correo</h1>
              <p className="text-sm text-gray-500">
                {total.toLocaleString()} intentos de envío · se conservan 90 días · no se guarda el cuerpo de los correos
              </p>
            </div>
          </div>
          <button
            onClick={() => { void refetch(); }}
            className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {tarjetas.map((t) => (
            <div key={t.titulo} className={`rounded-xl border p-4 bg-white ${t.alerta ? 'border-amber-300' : 'border-gray-200'}`}>
              <div className="text-xs text-gray-500">{t.titulo}</div>
              <div className={`text-2xl font-bold ${t.alerta ? 'text-amber-700' : 'text-gray-900'}`}>
                {t.valor === undefined ? '—' : t.valor.toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Filtros</span>
            {activos > 0 && <span className="bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">{activos}</span>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <input
              type="text"
              placeholder="Correo del destinatario (exacto)"
              value={filtros.destinatario}
              onChange={(e) => setFiltros((f) => ({ ...f, destinatario: e.target.value }))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2"
            />
            <input
              type="text"
              placeholder="Asunto contiene…"
              value={filtros.asunto}
              onChange={(e) => setFiltros((f) => ({ ...f, asunto: e.target.value }))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2"
            />
            <select
              value={filtros.proveedor}
              onChange={(e) => setFiltros((f) => ({ ...f, proveedor: e.target.value as FiltrosBitacora['proveedor'] }))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2"
            >
              <option value="">Todos los proveedores</option>
              <option value="zoho">Zoho Mail</option>
              <option value="sendgrid">SendGrid</option>
              <option value="smtp2go">SMTP2GO</option>
            </select>
            <select
              value={filtros.estado}
              onChange={(e) => setFiltros((f) => ({ ...f, estado: e.target.value as FiltrosBitacora['estado'] }))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2"
            >
              <option value="">Aceptados y no aceptados</option>
              <option value="aceptado">Solo aceptados</option>
              <option value="rechazado">Solo no aceptados</option>
            </select>
            <input
              type="date"
              aria-label="Desde"
              value={filtros.desde}
              onChange={(e) => setFiltros((f) => ({ ...f, desde: e.target.value }))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2"
            />
            <input
              type="date"
              aria-label="Hasta"
              value={filtros.hasta}
              onChange={(e) => setFiltros((f) => ({ ...f, hasta: e.target.value }))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2"
            />
            <label className="flex items-center gap-2 text-sm text-gray-700 px-1">
              <input
                type="checkbox"
                checked={filtros.soloRespaldo}
                onChange={(e) => setFiltros((f) => ({ ...f, soloRespaldo: e.target.checked }))}
              />
              Solo los que salieron por el respaldo
            </label>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={aplicar} className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm hover:bg-slate-700">Aplicar</button>
            <button onClick={limpiar} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Limpiar</button>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error instanceof Error ? error.message : 'No se pudo leer la bitácora de correo'}
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Asunto</th>
                  <th className="px-4 py-3">Para</th>
                  <th className="px-4 py-3">Proveedor</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {envios.length === 0 && !isFetching && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500">No hay envíos con estos filtros.</td></tr>
                )}
                {envios.map((envio) => {
                  const estado = estadoDeEntrega(envio.aceptado, data?.tiposPorEnvio.get(envio.id) ?? []);
                  const estaAbierto = abierto === envio.id;
                  return (
                    <React.Fragment key={envio.id}>
                      <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => setAbierto(estaAbierto ? null : envio.id)}>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{fechaLarga(envio.creado_en)}</td>
                        <td className="px-4 py-3 max-w-xs truncate" title={envio.asunto ?? ''}>{envio.asunto}</td>
                        <td className="px-4 py-3 max-w-xs truncate" title={envio.destinatarios.join(', ')}>{envio.destinatarios.join(', ')}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {etiquetaProveedor(envio.proveedor)}
                          {envio.es_respaldo && <span className="ml-2 text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">respaldo</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`text-xs font-medium px-2 py-1 rounded-full ${TONOS[estado.tono]}`}>{estado.texto}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-400">{estaAbierto ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</td>
                      </tr>
                      {estaAbierto && (
                        <tr><td colSpan={6} className="p-0"><DetalleDeEnvio envio={envio} /></td></tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-600">
            <span>Página {pagina + 1} de {totalPaginas}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPagina((p) => Math.max(0, p - 1))}
                disabled={pagina === 0}
                className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                onClick={() => setPagina((p) => Math.min(totalPaginas - 1, p + 1))}
                disabled={pagina >= totalPaginas - 1}
                className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40"
              >
                Siguiente
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminBitacoraCorreo;
