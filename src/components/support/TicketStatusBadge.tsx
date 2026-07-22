import React from 'react';
import { SupportTicketStatus } from '../../types';

interface Props {
  status: SupportTicketStatus;
  size?: 'sm' | 'md';
}

const STATUS_CONFIG: Record<SupportTicketStatus, { label: string; classes: string }> = {
  sin_atender: { label: 'Sin Atender', classes: 'bg-gray-100 text-gray-700' },
  en_proceso:  { label: 'En Proceso',  classes: 'bg-blue-100 text-blue-700' },
  escalado:    { label: 'Escalado',    classes: 'bg-orange-100 text-orange-700' },
  resuelto:    { label: 'Resuelto',    classes: 'bg-green-100 text-green-700' },
  cancelado:   { label: 'Cancelado',   classes: 'bg-red-100 text-red-700' },
  duplicado:   { label: 'Duplicado',   classes: 'bg-slate-100 text-slate-600' },
};

const TicketStatusBadge: React.FC<Props> = ({ status, size = 'sm' }) => {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.sin_atender;
  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${sizeClass} ${config.classes}`}>
      {config.label}
    </span>
  );
};

export default TicketStatusBadge;
