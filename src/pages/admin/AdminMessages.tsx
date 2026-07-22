import React, { useState, useEffect } from 'react';
import { MessageCircle, Users, Calendar, Search, Filter, Eye, Archive, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import MessageThread from '../../components/messaging/MessageThread';

interface AdminConversation {
  id: string;
  title: string;
  type: string;
  status: string;
  booking_id?: string;
  tour_id?: string;
  created_at: string;
  last_message_at: string;
  created_by_name: string;
  created_by_email: string;
  created_by_role: string;
  message_count: number;
  participant_count: number;
  related_tour_name?: string;
}

const AdminMessages: React.FC = () => {
  const [conversations, setConversations] = useState<AdminConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'booking' | 'general' | 'support'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'closed' | 'archived'>('all');

  useEffect(() => {
    fetchConversations();
  }, []);

  const fetchConversations = async () => {
    try {
      setIsLoading(true);
      setError('');

      const { data, error } = await supabase
        .from('admin_conversations')
        .select('*')
        .order('last_message_at', { ascending: false });

      if (error) {
        throw new Error(error.message);
      }

      setConversations(data || []);
    } catch (err: any) {
      console.error('Error fetching admin conversations:', err);
      setError(err.message || 'Error al cargar conversaciones');
    } finally {
      setIsLoading(false);
    }
  };

  const updateConversationStatus = async (conversationId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('conversations')
        .update({ status: newStatus })
        .eq('id', conversationId);

      if (error) {
        throw new Error(error.message);
      }

      setConversations(prev => prev.map(conv => 
        conv.id === conversationId 
          ? { ...conv, status: newStatus }
          : conv
      ));
    } catch (err: any) {
      console.error('Error updating conversation status:', err);
      setError(err.message || 'Error al actualizar estado');
    }
  };

  const filteredConversations = conversations.filter(conv => {
    const matchesSearch = 
      conv.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      conv.created_by_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      conv.created_by_email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      conv.related_tour_name?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesType = filterType === 'all' || conv.type === filterType;
    const matchesStatus = filterStatus === 'all' || conv.status === filterStatus;

    return matchesSearch && matchesType && matchesStatus;
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'booking':
        return '🎫';
      case 'support':
        return '🆘';
      default:
        return '💬';
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'booking':
        return 'Reserva';
      case 'support':
        return 'Soporte';
      case 'general':
        return 'General';
      default:
        return type;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">Activa</span>;
      case 'closed':
        return <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800 rounded-full">Cerrada</span>;
      case 'archived':
        return <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">Archivada</span>;
      default:
        return <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800 rounded-full">{status}</span>;
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'text-red-600';
      case 'agency':
        return 'text-blue-600';
      default:
        return 'text-green-600';
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin':
        return 'Admin';
      case 'agency':
        return 'Agencia';
      default:
        return 'Viajero';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 24) {
      return date.toLocaleTimeString('es-ES', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    } else if (diffInHours < 168) { // 7 days
      return date.toLocaleDateString('es-ES', { 
        weekday: 'short',
        day: '2-digit',
        month: '2-digit'
      });
    } else {
      return date.toLocaleDateString('es-ES', { 
        day: '2-digit', 
        month: '2-digit',
        year: '2-digit'
      });
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-gray-50">
      {/* Sidebar - Admin Conversation List */}
      <div className="w-1/3 bg-white border-r border-gray-200 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-semibold flex items-center">
            <MessageCircle className="h-5 w-5 mr-2" />
            Gestión de Mensajes
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {conversations.length} conversaciones totales
          </p>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-gray-200 space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar conversaciones..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
            />
          </div>

          {/* Type Filter */}
          <div className="flex items-center space-x-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="all">Todos los tipos</option>
              <option value="booking">Reservas</option>
              <option value="general">General</option>
              <option value="support">Soporte</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center space-x-2">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="all">Todos los estados</option>
              <option value="active">Activas</option>
              <option value="closed">Cerradas</option>
              <option value="archived">Archivadas</option>
            </select>
          </div>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="p-4 text-center text-error-600 text-sm">
              {error}
            </div>
          )}

          {filteredConversations.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              <MessageCircle className="h-8 w-8 mx-auto mb-2 text-gray-400" />
              <p className="text-sm">
                {conversations.length === 0 
                  ? 'No hay conversaciones'
                  : 'No se encontraron conversaciones'
                }
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {filteredConversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                    selectedConversationId === conversation.id
                      ? 'bg-primary-50 border-r-2 border-primary-500'
                      : ''
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center">
                      <span className="text-sm mr-2">
                        {getTypeIcon(conversation.type)}
                      </span>
                      <h3 className="text-sm font-medium text-gray-900 truncate">
                        {conversation.title || `Conversación ${getTypeLabel(conversation.type)}`}
                      </h3>
                    </div>
                    {getStatusBadge(conversation.status)}
                  </div>

                  <div className="text-xs text-gray-600 mb-2">
                    <div className="flex items-center">
                      <span className="font-medium">Creada por:</span>
                      <span className="ml-1">{conversation.created_by_name}</span>
                      <span className={`ml-2 px-1 py-0.5 rounded text-xs ${getRoleColor(conversation.created_by_role)}`}>
                        {getRoleLabel(conversation.created_by_role)}
                      </span>
                    </div>
                    <div className="text-gray-500">{conversation.created_by_email}</div>
                  </div>

                  {conversation.related_tour_name && (
                    <div className="text-xs text-blue-600 mb-2">
                      Tour: {conversation.related_tour_name}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center space-x-3">
                      <span className="flex items-center">
                        <MessageCircle className="h-3 w-3 mr-1" />
                        {conversation.message_count}
                      </span>
                      <span className="flex items-center">
                        <Users className="h-3 w-3 mr-1" />
                        {conversation.participant_count}
                      </span>
                    </div>
                    <span>{formatDate(conversation.last_message_at)}</span>
                  </div>

                  <div className="flex space-x-2 mt-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedConversationId(conversation.id);
                      }}
                      className="text-xs bg-primary-600 text-white px-2 py-1 rounded hover:bg-primary-700"
                    >
                      <Eye className="h-3 w-3 inline mr-1" />
                      Ver
                    </button>
                    
                    {conversation.status === 'active' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          updateConversationStatus(conversation.id, 'closed');
                        }}
                        className="text-xs bg-gray-600 text-white px-2 py-1 rounded hover:bg-gray-700"
                      >
                        Cerrar
                      </button>
                    )}
                    
                    {conversation.status === 'closed' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          updateConversationStatus(conversation.id, 'archived');
                        }}
                        className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
                      >
                        <Archive className="h-3 w-3 inline mr-1" />
                        Archivar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Content - Message Thread */}
      <div className="flex-1 flex flex-col">
        {selectedConversationId ? (
          <MessageThread
            conversationId={selectedConversationId}
            conversationTitle="Moderación de Conversación"
          />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center">
              <AlertTriangle className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Panel de Moderación
              </h3>
              <p className="text-gray-500 mb-4">
                Selecciona una conversación para moderar y resolver disputas
              </p>
              <div className="text-sm text-gray-400">
                <p>• Puedes ver todas las conversaciones de la plataforma</p>
                <p>• Cerrar conversaciones problemáticas</p>
                <p>• Archivar conversaciones resueltas</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminMessages;