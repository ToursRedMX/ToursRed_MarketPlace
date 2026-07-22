import React, { useState, useEffect, useRef } from 'react';
import { Send, MoreVertical, Edit, Trash2, Clock, Check, CheckCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { useFormPersistence } from '../../hooks/useFormPersistence';
import { usePreventUnload } from '../../hooks/usePreventUnload';

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: string;
  attachment_url?: string;
  attachment_name?: string;
  is_edited: boolean;
  edited_at?: string;
  created_at: string;
  sender?: {
    first_name?: string;
    last_name?: string;
    email: string;
    role: string;
    agency_name?: string;
  };
}

interface MessageThreadProps {
  conversationId: string;
  conversationTitle?: string;
}

const MessageThread: React.FC<MessageThreadProps> = ({
  conversationId,
  conversationTitle
}) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const newMessagePersistence = useFormPersistence(
    { newMessage },
    { key: `message_new_${conversationId}`, expirationHours: 24 }
  );

  const editMessagePersistence = useFormPersistence(
    { editContent },
    { key: `message_edit_${editingMessageId || 'none'}`, expirationHours: 24 }
  );

  usePreventUnload(newMessage.length > 0 || editContent.length > 0);

  useEffect(() => {
    if (conversationId) {
      const savedData = newMessagePersistence.loadFromStorage();
      if (savedData?.newMessage) {
        newMessagePersistence.setIsRestoring(true);
        setNewMessage(savedData.newMessage);
        setTimeout(() => newMessagePersistence.setIsRestoring(false), 100);
      }
      fetchMessages();
      markAsRead();
    }
  }, [conversationId]);

  const fetchMessages = async () => {
    try {
      setIsLoading(true);
      setError('');

      const { data: messagesData, error } = await supabase.rpc('get_conversation_messages', {
        p_conversation_id: conversationId
      });

      if (error) {
        throw new Error(error.message);
      }

      const enrichedMessages = messagesData?.map(msg => ({
        ...msg,
        sender: {
          first_name: msg.sender_first_name,
          last_name: msg.sender_last_name,
          email: msg.sender_email,
          role: msg.sender_role,
          profile_picture: msg.sender_profile_picture,
          agency_name: msg.agency_name
        }
      }));

      setMessages(enrichedMessages || []);
    } catch (err: any) {
      console.error('Error fetching messages:', err);
      setError(err.message || 'Error al cargar mensajes');
    } finally {
      setIsLoading(false);
    }
  };

  const markAsRead = async () => {
    try {
      await supabase.rpc('mark_conversation_read', {
        p_conversation_id: conversationId
      });
    } catch (err: any) {
      console.error('Error marking messages as read:', err);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || isSending) return;

    try {
      setIsSending(true);

      const { data: messageId, error } = await supabase.rpc('send_message', {
        p_conversation_id: conversationId,
        p_content: newMessage.trim(),
        p_message_type: 'text'
      });

      if (error) {
        throw new Error(error.message);
      }

      newMessagePersistence.clearStorage();
      setNewMessage('');
      await fetchMessages();
    } catch (err: any) {
      console.error('Error sending message:', err);
      setError(err.message || 'Error al enviar mensaje');
    } finally {
      setIsSending(false);
    }
  };

  const startEdit = (message: Message) => {
    setEditingMessageId(message.id);
    setEditContent(message.content);
  };

  const saveEdit = async () => {
    if (!editContent.trim() || !editingMessageId) return;

    try {
      const { error } = await supabase
        .from('messages')
        .update({ content: editContent.trim() })
        .eq('id', editingMessageId);

      if (error) {
        throw new Error(error.message);
      }

      setMessages(prev => prev.map(msg =>
        msg.id === editingMessageId
          ? { ...msg, content: editContent.trim(), is_edited: true, edited_at: new Date().toISOString() }
          : msg
      ));

      editMessagePersistence.clearStorage();
      setEditingMessageId(null);
      setEditContent('');
    } catch (err: any) {
      console.error('Error editing message:', err);
      setError(err.message || 'Error al editar mensaje');
    }
  };

  const cancelEdit = () => {
    editMessagePersistence.clearStorage();
    setEditingMessageId(null);
    setEditContent('');
  };

  const deleteMessage = async (messageId: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar este mensaje?')) return;

    try {
      const { error } = await supabase
        .from('messages')
        .delete()
        .eq('id', messageId);

      if (error) {
        throw new Error(error.message);
      }

      setMessages(prev => prev.filter(msg => msg.id !== messageId));
    } catch (err: any) {
      console.error('Error deleting message:', err);
      setError(err.message || 'Error al eliminar mensaje');
    }
  };


  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('es-ES', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Hoy';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Ayer';
    } else {
      return date.toLocaleDateString('es-ES', { 
        day: '2-digit', 
        month: '2-digit',
        year: 'numeric'
      });
    }
  };

  const getUserDisplayName = (message: Message) => {
    if (message.sender?.agency_name) {
      return message.sender.agency_name;
    }
    if (message.sender?.first_name || message.sender?.last_name) {
      return `${message.sender.first_name || ''} ${message.sender.last_name || ''}`.trim();
    }
    return message.sender?.email || 'Usuario';
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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-white">
        <h2 className="text-lg font-semibold">
          {conversationTitle || 'Conversación'}
        </h2>
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <div className="bg-error-50 text-error-600 p-3 rounded-md text-sm">
            {error}
          </div>
        )}

        {messages.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <p>No hay mensajes en esta conversación.</p>
            <p className="text-sm mt-1">¡Sé el primero en escribir!</p>
          </div>
        ) : (
          <>
            {messages.map((message, index) => {
              const isOwnMessage = message.sender_id === user?.id;
              const showDate = index === 0 || 
                formatDate(message.created_at) !== formatDate(messages[index - 1].created_at);

              return (
                <div key={message.id}>
                  {showDate && (
                    <div className="text-center text-xs text-gray-500 my-4">
                      <span className="bg-gray-100 px-3 py-1 rounded-full">
                        {formatDate(message.created_at)}
                      </span>
                    </div>
                  )}

                  <div className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs lg:max-w-md ${isOwnMessage ? 'order-2' : 'order-1'}`}>
                      {!isOwnMessage && (
                        <div className="flex items-center mb-1">
                          <span className="text-sm font-medium text-gray-900">
                            {getUserDisplayName(message)}
                          </span>
                          <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${getRoleColor(message.sender?.role || '')}`}>
                            {getRoleLabel(message.sender?.role || '')}
                          </span>
                        </div>
                      )}

                      <div className="group relative">
                        <div
                          className={`px-4 py-2 rounded-lg ${
                            isOwnMessage
                              ? 'bg-primary-600 text-white'
                              : 'bg-gray-100 text-gray-900'
                          }`}
                        >
                          {editingMessageId === message.id ? (
                            <div className="space-y-2">
                              <textarea
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded text-gray-900 text-sm"
                                rows={2}
                              />
                              <div className="flex space-x-2">
                                <button
                                  onClick={saveEdit}
                                  className="text-xs bg-green-600 text-white px-2 py-1 rounded"
                                >
                                  Guardar
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  className="text-xs bg-gray-600 text-white px-2 py-1 rounded"
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                              {message.is_edited && (
                                <p className={`text-xs mt-1 ${isOwnMessage ? 'text-primary-200' : 'text-gray-500'}`}>
                                  (editado)
                                </p>
                              )}
                            </>
                          )}
                        </div>

                        {isOwnMessage && editingMessageId !== message.id && (
                          <div className="absolute top-0 right-0 -mr-8 opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="flex space-x-1">
                              <button
                                onClick={() => startEdit(message)}
                                className="p-1 text-gray-400 hover:text-gray-600"
                                title="Editar mensaje"
                              >
                                <Edit className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => deleteMessage(message.id)}
                                className="p-1 text-gray-400 hover:text-red-600"
                                title="Eliminar mensaje"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        )}

                        <div className={`text-xs mt-1 ${isOwnMessage ? 'text-right text-primary-200' : 'text-gray-500'}`}>
                          <Clock className="inline h-3 w-3 mr-1" />
                          {formatTime(message.created_at)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Message Input */}
      <div className="p-4 border-t border-gray-200 bg-white">
        <div className="flex space-x-2">
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Escribe tu mensaje..."
            className="flex-1 p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
            rows={1}
            disabled={isSending}
          />
          <button
            onClick={sendMessage}
            disabled={!newMessage.trim() || isSending}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {isSending ? (
              <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Presiona Enter para enviar, Shift+Enter para nueva línea
        </p>
      </div>
    </div>
  );
};

export default MessageThread;