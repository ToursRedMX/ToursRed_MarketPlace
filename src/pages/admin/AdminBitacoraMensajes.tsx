import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare, RefreshCw, Filter, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { mensajeDeError } from '../../lib/errores';
import {
  ESTADOS_FILTRABLES,
  ETIQUETAS_CANAL,
  ETIQUETAS_CATEGORIA,
  ETIQUETAS_PROVEEDOR,
  FILTROS_VACIOS,
  TAMANO_PAGINA,
  contarFiltrosActivos,
  costoEstimadoTexto,
  costoRealTexto,
  estadoDeMensaje,
  etiquetaCanal,
  etiquetaCategoria,
  etiquetaEvento,
  etiquetaProveedor,
  nombreDelDestinatario,
  parametrosDelListado,
  textoCorto,
  totalesDelResumen,
  type EstadoMensaje,
  type FilaResumen,
  type FiltrosMensajes,
  type MensajeSaliente,
} from '../../lib/bitacoraMensajes';

const TONOS: Record<EstadoMensaje['tono'], string> = {
  verde: 'bg-green-50 text-green-700 border border-green-200',
  azul: 'bg-blue-50 text-blue-700 border border-blue-200',
  amarillo: 'bg-amber-50 text-amber-700 border border-amber-200',
  rojo: 'bg-red-50 text-red-700 border border-red-200',
  gris: 'bg-gray-50 text-gray-600 border border-gray-200',
};

const fechaLarga = (iso: string) => format(new Date(iso), 'd MMM yyyy, HH:mm:ss', { locale: es });

/** Todo lo que se sabe de un intento: la línea de tiempo que avisó el proveedor y sus identificadores. */
const DetalleDeMensaje: React.FC<{ m: MensajeSaliente }> = ({ m }) => (
  <div className="bg-gray-50 border-t border-gray-100 px-4 py-3 text-sm space-y-3">
    <div>
      <div className="text-xs font-medium text-gray-500 mb-1">Mensaje</div>
      <p className="whitespace-pre-wrap text-gray-900">{m.texto ?? 'No guardado: el texto se empezó a guardar el 23-oct-2026.'}</p>
      {m.categoria === 'otp' && m.texto && (
        <p className="mt-1 text-xs text-gray-500">El código de verificación nunca se guarda: va tachado.</p>
      )}
    </div>
    <div>
      <div className="text-xs font-medium text-gray-500 mb-1">Lo que avisó el proveedor</div>
      {m.eventos.length === 0 ? (
        <p className="text-gray-500">Todavía no ha avisado nada.</p>
      ) : (
        <ul className="space-y-1">
          {m.eventos.map((e, i) => (
            <li key={`${e.tipo}-${e.cuando}-${i}`} className="flex flex-wrap gap-x-2">
              <span className="text-gray-500">{fechaLarga(e.cuando)}</span>
              <span className="font-medium text-gray-900">{etiquetaEvento(e.tipo)}</span>
              {e.codigo && <span className="text-gray-500">({e.codigo})</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-600">
      <div><dt className="inline font-medium">Intento: </dt><dd className="inline">{m.numero_intento}{m.es_respaldo ? ' (por el proveedor de respaldo)' : ''}</dd></div>
      <div><dt className="inline font-medium">Segmentos: </dt><dd className="inline">{m.segmentos}</dd></div>
      <div><dt className="inline font-medium">Id del proveedor: </dt><dd className="inline break-all">{m.id_proveedor ?? '—'}</dd></div>
      <div><dt className="inline font-medium">Correlación: </dt><dd className="inline break-all">{m.correlacion ?? '—'}</dd></div>
      {(m.codigo_error || m.clase_fallo) && (
        <div className="sm:col-span-2">
          <dt className="inline font-medium">Falla: </dt>
          <dd className="inline">{[m.codigo_error, m.clase_fallo].filter(Boolean).join(' · ')}</dd>
        </div>
      )}
      {m.simulado && <div className="sm:col-span-2 text-amber-700">Envío simulado: no salió un mensaje real.</div>}
    </dl>
  </div>
);

const AdminBitacoraMensajes: React.FC = () => {
  const { isSuperAdmin, permissions } = useAuth();
  const puedeVer = isSuperAdmin || permissions?.canManageSettings;

  const [filtros, setFiltros] = useState<FiltrosMensajes>(FILTROS_VACIOS);
  const [aplicados, setAplicados] = useState<FiltrosMensajes>(FILTROS_VACIOS);
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [abierto, setAbierto] = useState<string | null>(null);

  const listado = useQuery({
    queryKey: ['admin-bitacora-mensajes', aplicados, pagina],
    enabled: Boolean(puedeVer),
    queryFn: async (): Promise<MensajeSaliente[]> => {
      const { data, error } = await supabase.rpc('listar_mensajes_salientes', parametrosDelListado(aplicados, pagina));
      if (error) throw error;
      return ((data ?? []) as MensajeSaliente[]).map((m) => ({
        ...m,
        segmentos: Number(m.segmentos),
        total: Number(m.total),
        costo_real: m.costo_real === null ? null : Number(m.costo_real),
        costo_estimado_mxn: m.costo_estimado_mxn === null ? null : Number(m.costo_estimado_mxn),
        eventos: Array.isArray(m.eventos) ? m.eventos : [],
      }));
    },
  });

  const resumen = useQuery({
    queryKey: ['admin-bitacora-mensajes-resumen'],
    enabled: Boolean(puedeVer),
    queryFn: async (): Promise<FilaResumen[]> => {
      const { data, error } = await supabase.rpc('resumen_mensajes_salientes', {});
      if (error) throw error;
      return (data ?? []) as FilaResumen[];
    },
  });

  if (!puedeVer) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Acceso Denegado</h2>
          <p className="text-gray-600">No tienes permiso para ver la bitácora de mensajes.</p>
        </div>
      </div>
    );
  }

  const filas = listado.data ?? [];
  const total = filas[0]?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / TAMANO_PAGINA));
  const activos = contarFiltrosActivos(aplicados);
  const totales = totalesDelResumen(resumen.data ?? []);

  const tarjetas: { titulo: string; valor: number; alerta?: boolean }[] = [
    { titulo: 'Enviados (24 h)', valor: totales.enviados },
    { titulo: 'Entregados', valor: totales.entregados },
    { titulo: 'Leídos (WhatsApp)', valor: totales.leidos },
    { titulo: 'Fallidos', valor: totales.fallidos, alerta: totales.fallidos > 0 },
    { titulo: 'Sin confirmar', valor: totales.sinConfirmar, alerta: totales.sinConfirmar > 0 },
  ];

  const aplicar = () => {
    setPagina(0);
    setAbierto(null);
    setAplicados(filtros);
  };
  const limpiar = () => {
    setPagina(0);
    setAbierto(null);
    setFiltros(FILTROS_VACIOS);
    setAplicados(FILTROS_VACIOS);
  };

  const campo = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm';

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Bitácora de mensajes</h1>
              <p className="text-sm text-gray-500">
                {total.toLocaleString()} intentos de envío por SMS y WhatsApp · se conservan 90 días · el código de un OTP nunca se guarda
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              void listado.refetch();
              void resumen.refetch();
            }}
            className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${listado.isFetching ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
          {tarjetas.map((t) => (
            <div key={t.titulo} className={`rounded-xl border p-4 bg-white ${t.alerta ? 'border-amber-300' : 'border-gray-200'}`}>
              <div className="text-xs text-gray-500">{t.titulo}</div>
              <div className={`text-2xl font-bold ${t.alerta ? 'text-amber-700' : 'text-gray-900'}`}>
                {resumen.isPending ? '—' : t.valor.toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 mb-4">
          <button
            onClick={() => setMostrarFiltros((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700"
          >
            <span className="flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Filtros{activos > 0 ? ` (${activos} activos)` : ''}
            </span>
            {mostrarFiltros ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {mostrarFiltros && (
            <div className="border-t border-gray-100 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <label className="text-xs text-gray-600">Desde
                <input type="date" value={filtros.desde} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} className={campo} />
              </label>
              <label className="text-xs text-gray-600">Hasta
                <input type="date" value={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} className={campo} />
              </label>
              <label className="text-xs text-gray-600">Canal
                <select value={filtros.canal} onChange={(e) => setFiltros({ ...filtros, canal: e.target.value as FiltrosMensajes['canal'] })} className={campo}>
                  <option value="">Todos</option>
                  {Object.entries(ETIQUETAS_CANAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-600">Proveedor
                <select value={filtros.proveedor} onChange={(e) => setFiltros({ ...filtros, proveedor: e.target.value })} className={campo}>
                  <option value="">Todos</option>
                  {Object.entries(ETIQUETAS_PROVEEDOR).filter(([k]) => k !== 'mock').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-600">Estado
                <select value={filtros.estado} onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })} className={campo}>
                  <option value="">Todos</option>
                  {ESTADOS_FILTRABLES.map((s) => <option key={s} value={s}>{estadoDeMensaje(s).texto}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-600">Tipo de mensaje
                <select value={filtros.categoria} onChange={(e) => setFiltros({ ...filtros, categoria: e.target.value })} className={campo}>
                  <option value="">Todos</option>
                  {Object.entries(ETIQUETAS_CATEGORIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-600 sm:col-span-2">Buscar (teléfono, nombre, correo o texto)
                <input
                  type="text"
                  value={filtros.busqueda}
                  onChange={(e) => setFiltros({ ...filtros, busqueda: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') aplicar(); }}
                  className={campo}
                />
              </label>
              <div className="sm:col-span-2 lg:col-span-4 flex gap-2">
                <button onClick={aplicar} className="px-4 py-1.5 rounded-md bg-slate-800 text-white text-sm">Aplicar</button>
                <button onClick={limpiar} className="px-4 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700">Limpiar</button>
              </div>
            </div>
          )}
        </div>

        {listado.isError && (
          <div role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {mensajeDeError(listado.error) || 'No se pudo leer la bitácora de mensajes.'}
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {listado.isPending ? (
            <div className="p-8 text-center text-sm text-gray-500">Cargando…</div>
          ) : filas.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">No hay mensajes con esos filtros.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                    <th className="py-2 px-4 font-medium">Fecha</th>
                    <th className="py-2 px-3 font-medium">Canal</th>
                    <th className="py-2 px-3 font-medium">Tipo</th>
                    <th className="py-2 px-3 font-medium">Destinatario</th>
                    <th className="py-2 px-3 font-medium">Mensaje</th>
                    <th className="py-2 px-3 font-medium">Estado</th>
                    <th className="py-2 px-3 font-medium text-right">Costo</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((m) => {
                    const estado = estadoDeMensaje(m.estado);
                    const abierta = abierto === m.intento_id;
                    return (
                      <React.Fragment key={m.intento_id}>
                        <tr
                          onClick={() => setAbierto(abierta ? null : m.intento_id)}
                          className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer align-top"
                        >
                          <td className="py-2 px-4 whitespace-nowrap text-gray-700">{fechaLarga(m.creado_en)}</td>
                          <td className="py-2 px-3">
                            <div className="font-medium text-gray-900">{etiquetaCanal(m.canal)}</div>
                            <div className="text-xs text-gray-500">
                              {etiquetaProveedor(m.proveedor)}{m.es_respaldo ? ' · respaldo' : ''}{m.numero_intento > 1 ? ` · intento ${m.numero_intento}` : ''}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-gray-700">{etiquetaCategoria(m.categoria)}</td>
                          <td className="py-2 px-3">
                            <div className="text-gray-900">{nombreDelDestinatario(m)}</div>
                            <div className="text-xs text-gray-500">{m.telefono ?? 'Sin teléfono'}</div>
                          </td>
                          <td className="py-2 px-3 text-gray-700 max-w-xs">{textoCorto(m.texto)}</td>
                          <td className="py-2 px-3">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${TONOS[estado.tono]}`}>{estado.texto}</span>
                          </td>
                          <td className="py-2 px-3 text-right whitespace-nowrap">
                            <div className="text-gray-900">{costoEstimadoTexto(m)}</div>
                            <div className="text-xs text-gray-500">real: {costoRealTexto(m)}</div>
                          </td>
                        </tr>
                        {abierta && (
                          <tr>
                            <td colSpan={7} className="p-0"><DetalleDeMensaje m={m} /></td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
          <span>Página {pagina + 1} de {totalPaginas}</span>
          <div className="flex gap-2">
            <button
              onClick={() => { setAbierto(null); setPagina((p) => Math.max(0, p - 1)); }}
              disabled={pagina === 0}
              className="px-3 py-1.5 rounded-md border border-gray-300 disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              onClick={() => { setAbierto(null); setPagina((p) => p + 1); }}
              disabled={pagina + 1 >= totalPaginas}
              className="px-3 py-1.5 rounded-md border border-gray-300 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>

        <p className="mt-4 text-xs text-gray-500">
          El costo estimado usa la tarifa configurada en Costos de Mensajería y cuenta solo lo que pasa de los mensajes incluidos en el mes
          (por eso los primeros salen en $0.00); el costo real es el que informa el proveedor y hoy llega vacío en Twilio. Un SMS no tiene
          lectura posible: solo WhatsApp (con los acuses de lectura del destinatario activos).
        </p>
      </div>
    </div>
  );
};

export default AdminBitacoraMensajes;
