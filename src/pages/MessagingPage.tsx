import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import ConversationList from '../components/messaging/ConversationList';
import MessageThread from '../components/messaging/MessageThread';
import CreateConversationModal from '../components/messaging/CreateConversationModal';
import { MessageCircle } from 'lucide-react';

const MessagingPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [conversationTitle, setConversationTitle] = useState<string>('');
  const [preselectedUserId, setPreselectedUserId] = useState<string | null>(null);

  useEffect(() => {
    const conversationFromUrl = searchParams.get('conversation');
    const newConversationUserId = searchParams.get('newConversation');

    if (conversationFromUrl) {
      setSelectedConversationId(conversationFromUrl);
    } else if (newConversationUserId) {
      setPreselectedUserId(newConversationUserId);
      setIsCreateModalOpen(true);
    }
  }, [searchParams]);

  const handleSelectConversation = (conversationId: string) => {
    setSelectedConversationId(conversationId);
    // You could fetch conversation details here to set the title
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
        }}
        onConversationCreated={handleConversationCreated}
        preselectedUserId={preselectedUserId || undefined}
      />
    </div>
  );
};

export default MessagingPage;