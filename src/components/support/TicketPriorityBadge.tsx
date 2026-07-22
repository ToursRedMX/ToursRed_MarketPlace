import React from 'react';
import { SupportTicketPriority } from '../../types';

interface Props {
  priority: SupportTicketPriority;
  size?: 'sm' | 'md';
}

const PRIORITY_CONFIG: Record<SupportTicketPriority, { label: string; classes: string }> = {
  baja:    { label: 'Baja',    classes: 'bg-gray-100 text-gray-600' },
  media:   { label: 'Media',   classes: 'bg-yellow-100 text-yellow-700' },
  alta:    { label: 'Alta',    classes: 'bg-orange-100 text-orange-700' },
  urgente: { label: 'Urgente', classes: 'bg-red-100 text-red-700' },
};

const TicketPriorityBadge: React.FC<Props> = ({ priority, size = 'sm' }) => {
  const config = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.media;
  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${sizeClass} ${config.classes}`}>
      {config.label}
    </span>
  );
};

export default TicketPriorityBadge;
