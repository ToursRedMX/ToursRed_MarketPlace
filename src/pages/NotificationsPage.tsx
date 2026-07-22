import React, { useState, useEffect } from 'react';
import { Bell, Check, CheckCheck, Clock, X, Filter, Search, Trash2, MessageSquare, Building2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Notification } from '../types';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';

const NotificationsPage: React.FC = () => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [detailNotification, setDetailNotification] = useState<Notification | null>(null);

  useEffect(() => {
    if (user) {
      fetchNotifications();
    }
  }, [user]);

  const fetchNotifications = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      const { data, error } = await supabase
        .from('user_notifications')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) {
        throw new Error(error.message);
      }
      
      setNotifications(data || []);
    } catch (err: any) {
      console.error('Error fetching notifications:', err);
      setError(err.message || 'Error al cargar las notificaciones');
    } finally {
      setIsLoading(false);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      const { error } = await supabase
        .rpc('mark_notification_as_read', { notification_id: notificationId });
      
      if (error) {
        console.error('Error marking notification as read:', error);
      } else {
        // Update local state
        setNotifications(prev => 
          prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
        );
      }
    } catch (err) {
      console.error('Error in markAsRead:', err);
    }
  };

  const markAllAsRead = async () => {
    try {
      const { data, error } = await supabase
        .rpc('mark_all_notifications_as_read');
      
      if (error) {
        console.error('Error marking all notifications as read:', error);
      } else {
        // Update local state
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      }
    } catch (err) {
      console.error('Error in markAllAsRead:', err);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId);
      
      if (error) {
        console.error('Error deleting notification:', error);
      } else {
        // Update local state
        setNotifications(prev => prev.filter(n => n.id !== notificationId));
      }
    } catch (err) {
      console.error('Error in deleteNotification:', err);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      return format(date, 'HH:mm');
    } else if (diffInHours < 48) {
      return 'Ayer';
    } else {
      return format(date, 'dd/MM/yyyy');
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'booking_pending_approval':
        return <Clock className="h-5 w-5 text-yellow-500" />;
      case 'booking_approved':
        return <Check className="h-5 w-5 text-green-500" />;
      case 'booking_rejected':
        return <X className="h-5 w-5 text-red-500" />;
      case 'booking_confirmed':
        return <CheckCheck className="h-5 w-5 text-green-500" />;
      case 'message_received':
        return <MessageSquare className="h-5 w-5 text-blue-500" />;
      case 'tour_announcement':
        return <Building2 className="h-5 w-5 text-blue-600" />;
      case 'system_announcement':
        return <Bell className="h-5 w-5 text-orange-500" />;
      default:
        return <Bell className="h-5 w-5 text-gray-500" />;
    }
  };

  const getNotificationLink = (notification: Notification) => {
    const data = notification.data || {};
    
    switch (notification.type) {
      case 'booking_pending_approval':
        return `/agency/bookings`;
      case 'booking_approved':
      case 'booking_rejected':
      case 'booking_confirmed':
      case 'booking_cancelled':
        return `/traveler/bookings`;
      case 'message_received':
        return `/messages${data.conversation_id ? `?conversation=${data.conversation_id}` : ''}`;
      case 'tour_updated':
        return `/tours/${data.tour_id}`;
      case 'tour_announcement':
      case 'system_announcement':
        return null;
      default:
        return '#';
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'booking_pending_approval':
        return 'Reserva Pendiente';
      case 'booking_approved':
        return 'Reserva Aprobada';
      case 'booking_rejected':
        return 'Reserva Rechazada';
      case 'booking_confirmed':
        return 'Reserva Confirmada';
      case 'booking_cancelled':
        return 'Reserva Cancelada';
      case 'message_received':
        return 'Mensaje Recibido';
      case 'tour_updated':
        return 'Tour Actualizado';
      case 'tour_announcement':
        return 'Mensaje de Agencia';
      case 'system_announcement':
        return 'Comunicado ToursRed';
      default:
        return type;
    }
  };

  const filteredNotifications = notifications.filter(notification => {
    // Filter by type
    if (filterType !== 'all' && notification.type !== filterType) {
      return false;
    }
    
    // Filter by search term
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      return (
        notification.title.toLowerCase().includes(searchLower) ||
        notification.message.toLowerCase().includes(searchLower)
      );
    }
    
    return true;
  });

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold">Notificaciones</h1>
            <p className="text-gray-600 mt-1">
              {unreadCount > 0 
                ? `Tienes ${unreadCount} ${unreadCount === 1 ? 'notificación no leída' : 'notificaciones no leídas'}`
                : 'No tienes notificaciones sin leer'
              }
            </p>
          </div>
          
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="btn btn-outline flex items-center"
            >
              <CheckCheck className="h-4 w-4 mr-2" />
              Marcar todas como leídas
            </button>
          )}
        </div>

        {error && (
          <div className="mb-6 bg-red-50 text-red-600 p-4 rounded-md">
            {error}
          </div>
        )}

        {/* Filters */}
        <div className="bg-blue-100 rounded-lg shadow-md p-4 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar notificaciones..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="all">Todas</option>
                <option value="booking_pending_approval">Reservas Pendientes</option>
                <option value="booking_approved">Reservas Aprobadas</option>
                <option value="booking_rejected">Reservas Rechazadas</option>
                <option value="booking_confirmed">Reservas Confirmadas</option>
                <option value="message_received">Mensajes</option>
                <option value="system_announcement">Anuncios</option>
                <option value="tour_announcement">Mensajes de Agencia</option>
              </select>
            </div>
          </div>
        </div>

        {/* Notifications List */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="bg-blue-100 rounded-lg shadow-md p-8 text-center">
            <Bell className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">
              {notifications.length === 0 
                ? 'No tienes notificaciones' 
                : 'No se encontraron notificaciones'
              }
            </h3>
            <p className="text-gray-600">
              {notifications.length === 0 
                ? 'Las notificaciones aparecerán aquí cuando haya actualizaciones importantes.' 
                : 'Intenta ajustar los filtros de búsqueda.'
              }
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredNotifications.map((notification) => (
              <div
                key={notification.id}
                className={`bg-blue-100 rounded-lg shadow-md overflow-hidden transition-all ${
                  !notification.is_read ? 'border-l-4 border-primary-500' : ''
                } ${(notification.type === 'tour_announcement' || notification.type === 'system_announcement') ? 'cursor-pointer' : ''}`}
                onClick={() => {
                  if (notification.type === 'tour_announcement' || notification.type === 'system_announcement') {
                    if (!notification.is_read) markAsRead(notification.id);
                    setDetailNotification(notification);
                  }
                }}
              >
                <div className="p-4">
                  <div className="flex items-start">
                    <div className="flex-shrink-0 mr-3 mt-1">
                      {getNotificationIcon(notification.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {notification.title}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {getTypeLabel(notification.type)} • {formatDate(notification.created_at)}
                          </p>
                        </div>
                        <div className="flex space-x-2 ml-4">
                          {!notification.is_read && (
                            <button
                              onClick={() => markAsRead(notification.id)}
                              className="text-primary-600 hover:text-primary-800"
                              title="Marcar como leída"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => deleteNotification(notification.id)}
                            className="text-red-600 hover:text-red-800"
                            title="Eliminar notificación"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <p className="text-sm text-gray-700 mt-2">
                        {notification.message}
                      </p>
                      <div className="mt-3">
                        {(notification.type === 'tour_announcement' || notification.type === 'system_announcement') ? (
                          <button
                            className="text-sm text-primary-600 hover:text-primary-800"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!notification.is_read) markAsRead(notification.id);
                              setDetailNotification(notification);
                            }}
                          >
                            Ver detalles
                          </button>
                        ) : getNotificationLink(notification) && getNotificationLink(notification) !== '#' ? (
                          <Link
                            to={getNotificationLink(notification) as string}
                            className="text-sm text-primary-600 hover:text-primary-800"
                            onClick={() => {
                              if (!notification.is_read) markAsRead(notification.id);
                            }}
                          >
                            Ver detalles
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tour announcement detail modal */}
      {detailNotification && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 py-8">
            <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setDetailNotification(null)} />
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-auto">
              <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${detailNotification.type === 'system_announcement' ? 'bg-orange-50' : 'bg-blue-50'}`}>
                    {detailNotification.type === 'system_announcement'
                      ? <Bell className="h-5 w-5 text-orange-500" />
                      : <Building2 className="h-5 w-5 text-blue-600" />}
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-gray-900 leading-tight">{detailNotification.title}</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {detailNotification.type === 'system_announcement' ? 'ToursRed' : (detailNotification.data?.agency_name as string || 'Agencia')} · {formatDate(detailNotification.created_at)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setDetailNotification(null)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </div>

              {(detailNotification.data?.tour_name || detailNotification.data?.booking_code) && (
                <div className="mx-6 mt-5 bg-blue-50 rounded-xl px-4 py-3 space-y-0.5">
                  {detailNotification.data?.tour_name && (
                    <p className="text-sm font-semibold text-blue-800">{detailNotification.data.tour_name as string}</p>
                  )}
                  {detailNotification.data?.booking_code && (
                    <p className="text-xs text-blue-600">Reserva #{detailNotification.data.booking_code as string}</p>
                  )}
                </div>
              )}

              <div className="px-6 py-5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Mensaje</p>
                <div className="bg-gray-50 rounded-xl border-l-4 border-blue-400 px-5 py-4">
                  <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                    {detailNotification.message}
                  </p>
                </div>
              </div>

              <div className="px-6 pb-5 flex justify-end">
                <button
                  onClick={() => setDetailNotification(null)}
                  className="btn btn-primary"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationsPage;