import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TicketCheck, Search, RefreshCw, Filter, Eye, ChevronDown, ChevronUp, Tag, Headphones as HeadphonesIcon, Clock, User, Building2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { SupportTicket, SupportCategory, SupportSubcategory, SupportTicketStatus, SupportTicketPriority, SupportTicketType } from '../../types';
import TicketStatusBadge from '../../components/support/TicketStatusBadge';
import TicketPriorityBadge from '../../components/support/TicketPriorityBadge';

const PAGE_SIZE = 20;

type SortColumn = 'folio' | 'tipo' | 'prioridad' | 'status' | 'solicitante_nombre' | 'created_at' | 'agente_asignado_id' | 'sla';
type SortDir = 'asc' | 'desc';

const SORT_COL_MAP: Partial<Record<SortColumn, string>> = {
  sla: 'sla_deadline',
};

interface AgentOption {
  id: string;
  first_name: string;
  last_name: string;
}

const AdminServiceDesk: React.FC = () => {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<SupportTicketStatus | ''>('');
  const [filterPriority, setFilterPriority] = useState<SupportTicketPriority | ''>('');
  const [filterType, setFilterType] = useState<SupportTicketType | ''>('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSubcategory, setFilterSubcategory] = useState('');
  const [filterAgente, setFilterAgente] = useState('');   // '' = todos | 'unassigned' | uuid del agente
  const [showFilters, setShowFilters] = useState(false);
  const [categories, setCategories] = useState<SupportCategory[]>([]);
  const [subcategories, setSubcategories] = useState<SupportSubcategory[]>([]);
  const [agentes, setAgentes] = useState<AgentOption[]>([]);
  const [sortCol, setSortCol] = useState<SortColumn>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    supabase.from('support_categories').select('*').order('nombre').then(r => setCategories(r.data ?? []));
    supabase.from('support_subcategories').select('*').order('nombre').then(r => setSubcategories(r.data ?? []));
    // Cargar agentes de soporte para el filtro
    supabase
      .from('users')
      .select('id, first_name, last_name')
      .eq('role', 'admin')
      .order('first_name')
      .then(r => setAgentes(r.data ?? []));
  }, []);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    const dbSortCol = SORT_COL_MAP[sortCol] ?? sortCol;

    let query = supabase
      .from('support_tickets')
      .select(`
        *,
        category:support_categories(id, nombre),
        subcategory:support_subcategories(id, nombre, sla_horas),
        agente:users!support_tickets_agente_asignado_id_fkey(id, first_name, last_name),
        agencia:agencies!support_tickets_agencia_asignada_id_fkey(id, name)
      `, { count: 'exact' })
      .order(dbSortCol, {
        ascending: sortDir === 'asc',
        nullsFirst: sortCol === 'agente_asignado_id' ? sortDir === 'asc' : undefined,
      })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (filterStatus) query = query.eq('status', filterStatus);
    if (filterPriority) query = query.eq('prioridad', filterPriority);
    if (filterType) query = query.eq('tipo', filterType);
    if (filterCategory) query = query.eq('category_id', filterCategory);
    if (filterSubcategory) query = query.eq('subcategory_id', filterSubcategory);
    if (filterAgente === 'unassigned') {
      query = query.is('agente_asignado_id', null);
    } else if (filterAgente) {
      query = query.eq('agente_asignado_id', filterAgente);
    }
    if (search) {
      query = query.or(
        `folio.ilike.%${search}%,solicitante_nombre.ilike.%${search}%,solicitante_email.ilike.%${search}%,descripcion.ilike.%${search}%`
      );
    }

    const { data, count } = await query;
    setTickets(data ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [page, search, filterStatus, filterPriority, filterType, filterCategory, filterSubcategory, filterAgente, sortCol, sortDir]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  const handleSort = (col: SortColumn) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
    setPage(0);
  };

  const SortIcon = ({ col }: { col: SortColumn }) => {
    if (sortCol !== col) return <ArrowUpDown className="h-3.5 w-3.5 text-gray-300 ml-1 flex-shrink-0" />;
    return sortDir === 'asc'
      ? <ArrowUp className="h-3.5 w-3.5 text-primary-500 ml-1 flex-shrink-0" />
      : <ArrowDown className="h-3.5 w-3.5 text-primary-500 ml-1 flex-shrink-0" />;
  };

  const slaStatus = (ticket: any) => {
    const closed = ticket.status === 'resuelto' || ticket.status === 'cancelado' || ticket.status === 'duplicado';
    if (closed) return null;
    if (!ticket.sla_deadline) return null;
    const remaining = new Date(ticket.sla_deadline).getTime() - Date.now();
    if (remaining <= 0) return <span className="text-xs text-red-600 font-medium">SLA vencido</span>;
    const hours = Math.floor(remaining / 3600000);
    if (hours < 2) return <span className="text-xs text-orange-600 font-medium">{hours}h</span>;
    if (hours < 24) return <span className="text-xs text-yellow-600">{hours}h</span>;
    return <span className="text-xs text-gray-400">{Math.floor(hours / 24)}d</span>;
  };

  const filteredSubcategories = filterCategory
    ? subcategories.filter(s => s.category_id === filterCategory)
    : subcategories;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const resetFilters = () => {
    setFilterStatus('');
    setFilterPriority('');
    setFilterType('');
    setFilterCategory('');
    setFilterSubcategory('');
    setFilterAgente('');
    setSearch('');
    setPage(0);
  };

  const activeFiltersCount = [filterStatus, filterPriority, filterType, filterCategory, filterSubcategory, search, filterAgente]
    .filter(Boolean).length;



  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="container-custom py-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
                <HeadphonesIcon className="h-5 w-5 text-primary-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Service Desk</h1>
                <p className="text-sm text-gray-500">{total} tickets en total</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link to="/admin/service-desk/categorias" className="btn btn-secondary flex items-center gap-2 text-sm">
                <Tag className="h-4 w-4" /> Categorias
              </Link>
              <Link to="/admin/service-desk/agentes" className="btn btn-secondary flex items-center gap-2 text-sm">
                <HeadphonesIcon className="h-4 w-4" /> Agentes
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="container-custom py-6">
        {/* Search + filters toggle */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Folio, nombre, correo o descripcion..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              className="input pl-9"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`btn flex items-center gap-2 text-sm ${activeFiltersCount > 0 ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Filter className="h-4 w-4" />
            Filtros
            {activeFiltersCount > 0 && (
              <span className="bg-white text-primary-600 rounded-full w-5 h-5 text-xs flex items-center justify-center font-bold">
                {activeFiltersCount}
              </span>
            )}
            {showFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button onClick={fetchTickets} className="btn btn-secondary">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {/* Filters panel */}
        {showFilters && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Estado</label>
                <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value as any); setPage(0); }} className="input text-sm">
                  <option value="">Todos</option>
                  <option value="sin_atender">Sin Atender</option>
                  <option value="en_proceso">En Proceso</option>
                  <option value="escalado">Escalado</option>
                  <option value="resuelto">Resuelto</option>
                  <option value="cancelado">Cancelado</option>
                  <option value="duplicado">Duplicado</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Prioridad</label>
                <select value={filterPriority} onChange={e => { setFilterPriority(e.target.value as any); setPage(0); }} className="input text-sm">
                  <option value="">Todas</option>
                  <option value="baja">Baja</option>
                  <option value="media">Media</option>
                  <option value="alta">Alta</option>
                  <option value="urgente">Urgente</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Tipo</label>
                <select value={filterType} onChange={e => { setFilterType(e.target.value as any); setPage(0); }} className="input text-sm">
                  <option value="">Todos</option>
                  <option value="traveler">Viajero</option>
                  <option value="agency">Agencia</option>
                  <option value="general">General</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Asignado a</label>
                <select value={filterAgente} onChange={e => { setFilterAgente(e.target.value); setPage(0); }} className="input text-sm">
                  <option value="">Todos</option>
                  <option value="unassigned">Sin asignar</option>
                  {agentes.map(a => (
                    <option key={a.id} value={a.id}>{a.first_name} {a.last_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Categoria</label>
                <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setFilterSubcategory(''); setPage(0); }} className="input text-sm">
                  <option value="">Todas</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Subcategoria</label>
                <select value={filterSubcategory} onChange={e => { setFilterSubcategory(e.target.value); setPage(0); }} className="input text-sm">
                  <option value="">Todas</option>
                  {filteredSubcategories.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </div>
            </div>
            {activeFiltersCount > 0 && (
              <button onClick={resetFilters} className="mt-3 text-sm text-red-600 hover:text-red-700">
                Limpiar filtros
              </button>
            )}
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600" />
          </div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
            <TicketCheck className="mx-auto h-12 w-12 text-gray-300 mb-3" />
            <p className="text-gray-500">No se encontraron tickets con los filtros actuales.</p>
            {activeFiltersCount > 0 && (
              <button onClick={resetFilters} className="mt-3 btn btn-secondary text-sm">Limpiar filtros</button>
            )}
          </div>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 transition-colors" onClick={() => handleSort('folio')}>
                        <span className="flex items-center">Folio <SortIcon col="folio" /></span>
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 transition-colors" onClick={() => handleSort('tipo')}>
                        <span className="flex items-center">Tipo <SortIcon col="tipo" /></span>
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Subcategoria
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 transition-colors" onClick={() => handleSort('prioridad')}>
                        <span className="flex items-center">Prioridad <SortIcon col="prioridad" /></span>
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 transition-colors" onClick={() => handleSort('status')}>
                        <span className="flex items-center">Estado <SortIcon col="status" /></span>
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 transition-colors" onClick={() => handleSort('solicitante_nombre')}>
                        <span className="flex items-center">Solicitante <SortIcon col="solicitante_nombre" /></span>
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 transition-colors" onClick={() => handleSort('agente_asignado_id')}>
                        <span className="flex items-center">Asignado a <SortIcon col="agente_asignado_id" /></span>
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 transition-colors" onClick={() => handleSort('sla')}>
                        <span className="flex items-center">SLA <SortIcon col="sla" /></span>
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 transition-colors" onClick={() => handleSort('created_at')}>
                        <span className="flex items-center">Fecha <SortIcon col="created_at" /></span>
                      </th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {tickets.map(ticket => (
                      <tr key={ticket.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-mono font-bold text-primary-600">{ticket.folio}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                            ticket.tipo === 'traveler' ? 'bg-blue-100 text-blue-700' :
                            ticket.tipo === 'agency' ? 'bg-green-100 text-green-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {ticket.tipo === 'traveler' ? <User className="h-3 w-3" /> :
                             ticket.tipo === 'agency' ? <Building2 className="h-3 w-3" /> :
                             <Tag className="h-3 w-3" />}
                            {ticket.tipo === 'traveler' ? 'Viajero' : ticket.tipo === 'agency' ? 'Agencia' : 'General'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {(ticket.subcategory as any)?.nombre ?? '-'}
                        </td>
                        <td className="px-4 py-3">
                          <TicketPriorityBadge priority={ticket.prioridad} />
                        </td>
                        <td className="px-4 py-3">
                          <TicketStatusBadge status={ticket.status} />
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-gray-800 font-medium truncate max-w-[120px]">{ticket.solicitante_nombre}</p>
                            <p className="text-gray-400 text-xs truncate max-w-[120px]">{ticket.solicitante_email}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs">
                          {(ticket.agente as any) ? (
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {(ticket.agente as any).first_name}
                            </span>
                          ) : (ticket.agencia as any) ? (
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              {(ticket.agencia as any).name}
                            </span>
                          ) : (
                            <span className="text-gray-300">Sin asignar</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-gray-300" />
                            {slaStatus(ticket)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          {new Date(ticket.created_at).toLocaleDateString('es-MX')}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => navigate(`/admin/service-desk/tickets/${ticket.id}`)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-gray-500">
                  Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="btn btn-secondary text-sm disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="btn btn-secondary text-sm disabled:opacity-50"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default AdminServiceDesk;
