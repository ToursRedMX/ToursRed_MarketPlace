import React from 'react';
import {
  Plus, ArrowRightLeft, AlertTriangle, UserCheck, Building2,
  MessageSquare, MessageCircle, CheckCircle, Lock, User
} from 'lucide-react';
import { SupportTicketHistoryEvent, SupportTicketComment } from '../../types';

interface TimelineItem {
  id: string;
  tipo: string;
  descripcion: string;
  actor_name: string | null;
  created_at: string;
  isInternal?: boolean;
  isUserComment?: boolean;
}

interface Props {
  history: SupportTicketHistoryEvent[];
  comments: SupportTicketComment[];
  showInternal?: boolean;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('es-MX', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function getEventIcon(tipo: string) {
  switch (tipo) {
    case 'creacion': return <Plus className="h-4 w-4 text-green-600" />;
    case 'cambio_status': return <ArrowRightLeft className="h-4 w-4 text-blue-600" />;
    case 'cambio_prioridad': return <AlertTriangle className="h-4 w-4 text-orange-500" />;
    case 'asignacion_agente':
    case 'reasignacion_agente': return <UserCheck className="h-4 w-4 text-primary-600" />;
    case 'asignacion_agencia':
    case 'reasignacion_agencia': return <Building2 className="h-4 w-4 text-primary-600" />;
    case 'comentario_interno': return <Lock className="h-4 w-4 text-yellow-600" />;
    case 'respuesta_usuario': return <MessageCircle className="h-4 w-4 text-blue-600" />;
    case 'comentario_usuario': return <User className="h-4 w-4 text-gray-500" />;
    case 'cierre': return <CheckCircle className="h-4 w-4 text-green-600" />;
    default: return <MessageSquare className="h-4 w-4 text-gray-400" />;
  }
}

function getEventBg(tipo: string) {
  if (tipo === 'comentario_interno') return 'bg-yellow-50 border-l-4 border-yellow-300';
  if (tipo === 'respuesta_usuario') return 'bg-blue-50 border-l-4 border-blue-300';
  if (tipo === 'comentario_usuario') return 'bg-gray-50 border-l-4 border-gray-300';
  return '';
}

const TicketTimeline: React.FC<Props> = ({ history, comments, showInternal = false }) => {
  const items: TimelineItem[] = [
    ...history
      .filter(h => h.tipo_evento !== 'respuesta_usuario' && h.tipo_evento !== 'comentario_interno' && h.tipo_evento !== 'comentario_usuario')
      .map(h => ({
        id: h.id,
        tipo: h.tipo_evento,
        descripcion: h.descripcion,
        actor_name: h.actor_name,
        created_at: h.created_at,
        isInternal: false,
      })),
    ...comments
      .filter(c => showInternal || c.tipo === 'respuesta_usuario')
      .map(c => ({
        id: c.id,
        tipo: c.tipo === 'interno' ? 'comentario_interno' : c.tipo === 'respuesta_usuario' ? 'respuesta_usuario' : 'comentario_usuario',
        descripcion: c.contenido,
        actor_name: c.author_name,
        created_at: c.created_at,
        isInternal: c.tipo === 'interno',
        isUserComment: c.tipo !== 'interno' && c.tipo !== 'respuesta_usuario',
      })),
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        No hay eventos registrados aun.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, idx) => (
        <div key={item.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white border-2 border-gray-200 flex items-center justify-center">
              {getEventIcon(item.tipo)}
            </div>
            {idx < items.length - 1 && (
              <div className="w-0.5 flex-1 bg-gray-200 mt-1" />
            )}
          </div>
          <div className={`flex-1 pb-3 ${idx < items.length - 1 ? '' : ''}`}>
            <div className={`rounded-lg p-3 ${getEventBg(item.tipo)}`}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-gray-600">
                  {item.actor_name ?? 'Sistema'}
                  {item.isInternal && (
                    <span className="ml-2 text-xs text-yellow-600 font-semibold">[Interno]</span>
                  )}
                </span>
                <span className="text-xs text-gray-400 flex-shrink-0">{formatDate(item.created_at)}</span>
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{item.descripcion}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default TicketTimeline;
