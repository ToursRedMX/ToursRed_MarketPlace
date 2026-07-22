import React, { useState, useEffect } from 'react';
import { MessageCircle, Clock, Users, Search, Filter, Plus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

interface Conversation {
  conversation_id: string;
  title: string;
  type: string;
  status: string;
  booking_id?: string;
  tour_id?: string;
  tour_title?: string;
  last_message_at: string;
  unread_count: number;
  last_message_content?: string;
  last_message_sender?: string;
  participant_count: number;
  other_participant_id?: string;
  other_participant_name?: string;
  other_participant_email?: string;
  other_participant_role?: string;
}

interface ConversationListProps {
  onSelectConversation: (conversationId: string) => void;
  selectedConversationId?: string;
  onCreateConversation?: () => void;
}

const ConversationList: React.FC<ConversationListProps> = ({
  onSelectConversation,
  selectedConversationId,
  onCreateConversation
}) => {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'booking' | 'general' | 'support'>('all');

  useEffect(() => {
    if (user?.id) {
      fetchConversations();
    }
  }, [user]);

  const fetchConversations = async () => {
    try {
      setIsLoading(true);
      setError('');

      const { data, error } = await supabase.rpc('get_user_conversations');

      if (error) {
        throw new Error(error.message);
      }

      setConversations(data || []);
    } catch (err: any) {
      console.error('Error fetching conversations:', err);
      setError(err.message || 'Error al cargar conversaciones');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredConversations = conversations.filter(conv => {
    const matchesSearch = 
      conv.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      conv.last_message_content?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      conv.last_message_sender?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesFilter = filterType === 'all' || conv.type === filterType;

    return matchesSearch && matchesFilter;
  });

  const formatTime = (dateString: string) => {
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
        weekday: 'short' 
      });
    } else {
      return date.toLocaleDateString('es-ES', { 
        day: '2-digit', 
        month: '2-digit' 
      });
    }
  };

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

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center">
            <MessageCircle className="h-5 w-5 mr-2" />
            Mensajes
          </h2>
          {onCreateConversation && (
            <button
              onClick={onCreateConversation}
              className="btn btn-primary btn-sm"
            >
              <Plus className="h-4 w-4 mr-1" />
              Nuevo
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar conversaciones..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
          />
        </div>

        {/* Filter */}
        <div className="flex items-center space-x-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="all">Todas</option>
            <option value="booking">Reservas</option>
            <option value="general">General</option>
            <option value="support">Soporte</option>
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
                ? 'No tienes conversaciones aún'
                : 'No se encontraron conversaciones'
              }
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredConversations.map((conversation) => (
              <div
                key={conversation.conversation_id}
                onClick={() => onSelectConversation(conversation.conversation_id)}
                className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                  selectedConversationId === conversation.conversation_id
                    ? 'bg-primary-50 border-r-2 border-primary-500'
                    : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center mb-1">
                      <span className="text-sm mr-2">
                        {getTypeIcon(conversation.type)}
                      </span>
                      <h3 className="text-sm font-medium text-gray-900 truncate">
                        {conversation.title || `Conversación ${getTypeLabel(conversation.type)}`}
                      </h3>
                      {conversation.unread_count > 0 && (
                        <span className="ml-2 bg-primary-600 text-white text-xs rounded-full px-2 py-0.5 min-w-[1.25rem] text-center">
                          {conversation.unread_count > 99 ? '99+' : conversation.unread_count}
                        </span>
                      )}
                    </div>
                    
                    {conversation.last_message_content && (
                      <p className="text-sm text-gray-600 truncate">
                        {conversation.last_message_sender && (
                          <span className="font-medium">
                            {conversation.last_message_sender}: 
                          </span>
                        )}
                        {conversation.last_message_content}
                      </p>
                    )}
                    
                    <div className="flex items-center mt-1 text-xs text-gray-500">
                      <Clock className="h-3 w-3 mr-1" />
                      <span>{formatTime(conversation.last_message_at)}</span>
                      <Users className="h-3 w-3 ml-3 mr-1" />
                      <span>{conversation.participant_count}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ConversationList;