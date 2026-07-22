import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Bell, X, Check, CheckCheck, Clock, MessageSquare, Building2, HeadphonesIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase, getUserNotifications, getUnreadNotificationCount, markNotificationAsRead, markAllNotificationsAsRead } from '../lib/supabase';
import { Notification } from '../types';
import { format } from 'date-fns';
import { Link, useNavigate } from 'react-router-dom';

const NotificationBell: React.FC = () => {
  const { user, role, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const channelId = useMemo(() => `notification-bell-${Math.random().toString(36).slice(2)}`, []);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailNotification, setDetailNotification] = useState<Notification | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user && !authLoading) {
      fetchNotifications();

      const channel = supabase
        .channel(channelId)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            fetchNotifications();
          }
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR') {
            console.warn('Realtime notifications subscription error (non-critical)');
          }
        });

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user, authLoading, channelId]);

  useEffect(() => {
    // Close dropdown when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const fetchNotifications = async () => {
    if (!user) return;
    
    try {
      console.log('🔔 Cargando notificaciones...');
      setIsLoading(true);
      setError(null);
      
      // Get unread count
      const { data: countData, error: countError } = await getUnreadNotificationCount();
      
      if (countError) {
        console.error('Error fetching unread count:', countError);
        setError('Error al obtener notificaciones no leídas');
      } else {
        setUnreadCount(countData || 0);
      }
      
      // Get recent notifications
      const { data, error } = await getUserNotifications(10);
      
      if (error) {
        console.error('Error fetching notifications:', error);
        setError('Error al cargar notificaciones');
      } else {
        setNotifications(data || []);
      }
    } catch (err: any) {
      console.error('Error in fetchNotifications:', err);
      setError(err.message || 'Error al cargar notificaciones');
    } finally {
      setIsLoading(false);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      const { error } = await markNotificationAsRead(notificationId);
      
      if (error) {
        console.error('Error marking notification as read:', error);
      } else {
        // Update local state
        setNotifications(prev => 
          prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (err) {
      console.error('Error in markAsRead:', err);
    }
  };

  const markAllAsRead = async () => {
    try {
      const { data, error } = await markAllNotificationsAsRead();
      
      
      if (error) {
        console.error('Error marking all notifications as read:', error);
      } else {
        // Update local state
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
        setUnreadCount(0);
      }
    } catch (err) {
      console.error('Error in markAllAsRead:', err);
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diffInSeconds < 60) {
      return 'Justo ahora';
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `Hace ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `Hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
    } else if (diffInSeconds < 604800) {
      const days = Math.floor(diffInSeconds / 86400);
      return `Hace ${days} ${days === 1 ? 'día' : 'días'}`;
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
      case 'support_ticket_created':
      case 'support_ticket_updated':
        return <HeadphonesIcon className="h-5 w-5 text-teal-500" />;
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
      case 'support_ticket_created':
      case 'support_ticket_updated': {
        const ticketId = data.ticket_id;
        if (role === 'admin' || role === 'super_admin') {
          return ticketId ? `/admin/service-desk/tickets/${ticketId}` : '/admin/service-desk';
        }
        if (role === 'agency') {
          return ticketId ? `/agency/soporte?ticket=${ticketId}` : '/agency/soporte';
        }
        return ticketId ? `/traveler/soporte?ticket=${ticketId}` : '/traveler/soporte';
      }
      default:
        return null;
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.is_read) markAsRead(notification.id);

    if (notification.type === 'tour_announcement' || notification.type === 'system_announcement') {
      setIsOpen(false);
      setDetailNotification(notification);
      return;
    }

    const link = getNotificationLink(notification);
    setIsOpen(false);
    if (link && link !== '#') navigate(link);
  };

  if (!user) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-1 rounded-full text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
      >
        <span className="sr-only">Notificaciones</span>
        <Bell className="h-6 w-6" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 block h-4 w-4 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center transform translate-x-1 -translate-y-1">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="origin-top-right absolute right-0 mt-2 w-80 md:w-96 rounded-md shadow-lg bg-blue-50 ring-1 ring-black ring-opacity-5 focus:outline-none z-50">
          <div className="py-2">
            <div className="px-4 py-2 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-sm font-medium text-gray-900">Notificaciones</h3>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-xs text-primary-600 hover:text-primary-800 flex items-center"
                >
                  <CheckCheck className="h-3 w-3 mr-1" />
                  Marcar todas como leídas
                </button>
              )}
            </div>
            
            <div className="max-h-96 overflow-y-auto">
              {isLoading ? (
                <div className="px-4 py-8 text-center">
                  <div className="inline-block animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary-600"></div>
                </div>
              ) : error ? (
                <div className="px-4 py-4 text-center text-red-600 text-sm">
                  <p>{error}</p>
                  <button 
                    onClick={fetchNotifications}
                    className="mt-2 text-primary-600 hover:text-primary-800 text-xs underline"
                  >
                    Reintentar
                  </button>
                </div>
              ) : notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-gray-500">
                  <Bell className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                  <p>No tienes notificaciones</p>
                </div>
              ) : (
                notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`px-4 py-3 cursor-pointer hover:bg-blue-100 transition-colors ${
                      !notification.is_read ? 'bg-blue-100' : ''
                    }`}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div className="flex">
                      <div className="flex-shrink-0 mr-3 mt-1">
                        {getNotificationIcon(notification.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${!notification.is_read ? 'text-gray-900' : 'text-gray-600'}`}>
                          {notification.title}
                        </p>
                        <p className="text-sm text-gray-500 line-clamp-2">
                          {notification.message}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          {formatTimeAgo(notification.created_at)}
                        </p>
                      </div>
                      {!notification.is_read && (
                        <div className="ml-2 flex-shrink-0">
                          <span className="inline-block w-2 h-2 rounded-full bg-primary-600"></span>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div className="px-4 py-2 border-t border-gray-200 text-center">
              <Link
                to="/notifications"
                className="text-xs text-primary-600 hover:text-primary-800"
                onClick={() => setIsOpen(false)}
              >
                Ver todas las notificaciones
              </Link>
            </div>
          </div>
        </div>
      )}

      {detailNotification && (
        <div className="fixed inset-0 z-[100] overflow-y-auto">
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
                      {detailNotification.type === 'system_announcement' ? 'ToursRed' : ((detailNotification.data?.agency_name as string) || 'Agencia')} · {formatTimeAgo(detailNotification.created_at)}
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

export default NotificationBell;