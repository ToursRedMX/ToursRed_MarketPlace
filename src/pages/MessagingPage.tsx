import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import ConversationList from '../components/messaging/ConversationList';
import MessageThread from '../components/messaging/MessageThread';
import CreateConversationModal from '../components/messaging/CreateConversationModal';
import { MessageCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const MessagingPage: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [conversationTitle] = useState<string>('');
  const [preselectedUserId, setPreselectedUserId] = useState<string | null>(null);
  const [preselectedBookingId, setPreselectedBookingId] = useState<string | null>(null);
  const [preselectedTourId, setPreselectedTourId] = useState<string | null>(null);

  useEffect(() => {
    const conversationFromUrl = searchParams.get('conversation');
    const newConversationUserId = searchParams.get('newConversation');

    if (conversationFromUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedConversationId(conversationFromUrl);
      // Entrar por enlace ("Contactar agencia", "enviar mensaje") a una conversacion
      // que el usuario habia eliminado la vuelve a mostrar en su lista. Si no estaba
      // oculta, o no participa (un admin), no afecta ninguna fila.
      if (user) {
        void supabase
          .from('message_participants')
          .update({ is_active: true })
          .eq('conversation_id', conversationFromUrl)
          .eq('user_id', user.id)
          .eq('is_active', false)
          .select('id')
          .then(({ data }) => {
            if (data && data.length > 0) {
              void queryClient.invalidateQueries({ queryKey: ['user-conversations'] });
            }
          });
      }
    } else if (newConversationUserId) {
      setPreselectedUserId(newConversationUserId);
      setPreselectedBookingId(searchParams.get('booking'));
      setPreselectedTourId(searchParams.get('tour'));
      setIsCreateModalOpen(true);
    }
  }, [searchParams, user, queryClient]);

  const handleSelectConversation = (conversationId: string) => {
    setSelectedConversationId(conversationId);
    // You could fetch conversation details here to set the title
  };

  // Al ocultarla se cierra el hilo y se quita ?conversation= de la URL, para que
  // recargar no vuelva a abrir una conversacion que ya no se ve en la lista.
  const handleConversationHidden = () => {
    setSelectedConversationId(null);
    setSearchParams({}, { replace: true });
  };

  const handleCreateConversation = () => {
    setIsCreateModalOpen(true);
  };

  const handleConversationCreated = (conversationId: string) => {
    setSelectedConversationId(conversationId);
    setIsCreateModalOpen(false);
  };

  return (
    <div className="h-screen flex bg-gray-50">
      {/* Sidebar - Conversation List */}
      <div className="w-1/3 bg-white border-r border-gray-200">
        <ConversationList
          onSelectConversation={handleSelectConversation}
          selectedConversationId={selectedConversationId || undefined}
          onCreateConversation={handleCreateConversation}
        />
      </div>

      {/* Main Content - Message Thread */}
      <div className="flex-1 flex flex-col">
        {selectedConversationId ? (
          <MessageThread
            conversationId={selectedConversationId}
            conversationTitle={conversationTitle}
            onConversationHidden={handleConversationHidden}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center">
              <MessageCircle className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Selecciona una conversación
              </h3>
              <p className="text-gray-500">
                Elige una conversación de la lista para comenzar a chatear
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Create Conversation Modal */}
      <CreateConversationModal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          setPreselectedUserId(null);
          setPreselectedBookingId(null);
          setPreselectedTourId(null);
        }}
        onConversationCreated={handleConversationCreated}
        preselectedUserId={preselectedUserId || undefined}
        preselectedBookingId={preselectedBookingId || undefined}
        preselectedTourId={preselectedTourId || undefined}
      />
    </div>
  );
};

export default MessagingPage;