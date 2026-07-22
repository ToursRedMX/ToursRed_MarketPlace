import React, { useState, useEffect } from 'react';
import { X, Search, Users, MessageCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

interface User {
  id: string;
  first_name?: string;
  last_name?: string;
  email: string;
  role: string;
}

interface Tour {
  id: string;
  name: string;
  destination: string;
}

interface Booking {
  id: string;
  tour_id: string;
  tours: Tour;
}

interface CreateConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConversationCreated: (conversationId: string) => void;
  preselectedBookingId?: string;
  preselectedTourId?: string;
  preselectedUserId?: string;
}

const CreateConversationModal: React.FC<CreateConversationModalProps> = ({
  isOpen,
  onClose,
  onConversationCreated,
  preselectedBookingId,
  preselectedTourId,
  preselectedUserId
}) => {
  const { user, isAgency, isTraveler } = useAuth();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'general' | 'booking' | 'support'>('general');
  const [selectedBookingId, setSelectedBookingId] = useState(preselectedBookingId || '');
  const [selectedTourId, setSelectedTourId] = useState(preselectedTourId || '');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(preselectedUserId ? [preselectedUserId] : []);
  const [searchTerm, setSearchTerm] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [tours, setTours] = useState<Tour[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, user]);

  useEffect(() => {
    if (preselectedBookingId) {
      setSelectedBookingId(preselectedBookingId);
      setType('booking');
    }
    if (preselectedTourId) {
      setSelectedTourId(preselectedTourId);
    }
    if (preselectedUserId) {
      setSelectedUserIds([preselectedUserId]);
    }
  }, [preselectedBookingId, preselectedTourId, preselectedUserId]);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      setError('');

      // Fetch users (excluding current user)
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('id, first_name, last_name, email, role')
        .neq('id', user?.id);

      if (usersError) {
        throw new Error(usersError.message);
      }

      setUsers(usersData || []);

      // Fetch bookings if user is agency or traveler
      if (isAgency) {
        // Get bookings for agency's tours
        const { data: agencyData } = await supabase
          .from('agencies')
          .select('id')
          .eq('user_id', user?.id)
          .single();

        if (agencyData) {
          const { data: bookingsData } = await supabase
            .from('bookings')
            .select(`
              id,
              tour_id,
              tours(id, name, destination)
            `)
            .eq('agency_id', agencyData.id);

          setBookings(bookingsData || []);
        }

        // Get agency's tours
        const { data: toursData } = await supabase
          .from('tours')
          .select('id, name, destination')
          .eq('agency_id', agencyData?.id);

        setTours(toursData || []);
      } else if (isTraveler) {
        // Get user's bookings
        const { data: bookingsData } = await supabase
          .from('bookings')
          .select(`
            id,
            tour_id,
            tours(id, name, destination)
          `)
          .eq('user_id', user?.id);

        setBookings(bookingsData || []);
      }
    } catch (err: any) {
      console.error('Error fetching data:', err);
      setError(err.message || 'Error al cargar datos');
    } finally {
      setIsLoading(false);
    }
  };

  const createConversation = async () => {
    if (!title.trim() || selectedUserIds.length === 0) {
      setError('Por favor completa todos los campos requeridos');
      return;
    }

    try {
      setIsCreating(true);
      setError('');

      const { data, error } = await supabase.rpc('create_conversation_with_participants', {
        p_title: title.trim(),
        p_type: type,
        p_booking_id: selectedBookingId || null,
        p_tour_id: selectedTourId || null,
        p_participant_ids: selectedUserIds
      });

      if (error) {
        throw new Error(error.message);
      }

      onConversationCreated(data);
      onClose();
      resetForm();
    } catch (err: any) {
      console.error('Error creating conversation:', err);
      setError(err.message || 'Error al crear conversación');
    } finally {
      setIsCreating(false);
    }
  };

  const resetForm = () => {
    setTitle('');
    setType('general');
    setSelectedBookingId('');
    setSelectedTourId('');
    setSelectedUserIds([]);
    setSearchTerm('');
    setError('');
  };

  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds(prev => 
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const getUserDisplayName = (user: User) => {
    if (user.first_name || user.last_name) {
      return `${user.first_name || ''} ${user.last_name || ''}`.trim();
    }
    return user.email;
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

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-red-100 text-red-800';
      case 'agency':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-green-100 text-green-800';
    }
  };

  const filteredUsers = users.filter(user =>
    getUserDisplayName(user).toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-full max-w-2xl shadow-lg rounded-md bg-white">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-gray-900 flex items-center">
            <MessageCircle className="h-5 w-5 mr-2" />
            Nueva Conversación
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {error && (
          <div className="mb-4 bg-error-50 text-error-600 p-3 rounded-md text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Título de la conversación *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input"
              placeholder="Ej: Consulta sobre tour a Cancún"
              required
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tipo de conversación
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as any)}
              className="input"
            >
              <option value="general">General</option>
              <option value="booking">Relacionada con reserva</option>
              <option value="support">Soporte</option>
            </select>
          </div>

          {/* Booking Selection */}
          {type === 'booking' && bookings.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reserva relacionada
              </label>
              <select
                value={selectedBookingId}
                onChange={(e) => setSelectedBookingId(e.target.value)}
                className="input"
              >
                <option value="">Seleccionar reserva...</option>
                {bookings.map((booking) => (
                  <option key={booking.id} value={booking.id}>
                    {booking.tours.name} - {booking.tours.destination}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Tour Selection */}
          {tours.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tour relacionado (opcional)
              </label>
              <select
                value={selectedTourId}
                onChange={(e) => setSelectedTourId(e.target.value)}
                className="input"
              >
                <option value="">Seleccionar tour...</option>
                {tours.map((tour) => (
                  <option key={tour.id} value={tour.id}>
                    {tour.name} - {tour.destination}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Participants */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Participantes * ({selectedUserIds.length} seleccionados)
            </label>
            
            {/* Search */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar usuarios..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            {/* Users List */}
            <div className="border border-gray-300 rounded-md max-h-48 overflow-y-auto">
              {isLoading ? (
                <div className="p-4 text-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-primary-600 mx-auto"></div>
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="p-4 text-center text-gray-500">
                  No se encontraron usuarios
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {filteredUsers.map((user) => (
                    <div
                      key={user.id}
                      className="p-3 hover:bg-gray-50 cursor-pointer"
                      onClick={() => toggleUserSelection(user.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <input
                            type="checkbox"
                            checked={selectedUserIds.includes(user.id)}
                            onChange={() => toggleUserSelection(user.id)}
                            className="mr-3"
                          />
                          <div>
                            <div className="font-medium text-gray-900">
                              {getUserDisplayName(user)}
                            </div>
                            <div className="text-sm text-gray-500">
                              {user.email}
                            </div>
                          </div>
                        </div>
                        <span className={`px-2 py-1 text-xs rounded-full ${getRoleColor(user.role)}`}>
                          {getRoleLabel(user.role)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-4 mt-6">
          <button
            onClick={onClose}
            className="btn btn-outline"
            disabled={isCreating}
          >
            Cancelar
          </button>
          <button
            onClick={createConversation}
            className="btn btn-primary"
            disabled={!title.trim() || selectedUserIds.length === 0 || isCreating}
          >
            {isCreating ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-2"></div>
                Creando...
              </>
            ) : (
              <>
                <Users className="h-4 w-4 mr-2" />
                Crear Conversación
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateConversationModal;