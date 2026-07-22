import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Notification } from '../types';

export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      fetchNotifications();
      
      // Set up real-time subscription for new notifications
      const channel = supabase
        .channel(`notifications-changes-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            console.log('Nueva notificación recibida:', payload);
            fetchNotifications();
          }
        )
        .subscribe();
      
      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  const fetchNotifications = async (limit = 10) => {
    if (!user) return;
    
    try {
      setIsLoading(true);
      setError(null);
      
      // Get unread count
      const { data: countData, error: countError } = await supabase
        .rpc('get_unread_notifications_count');
      
      if (countError) {
        console.error('Error fetching unread count:', countError);
        setError('Error al obtener notificaciones no leídas');
      } else {
        setUnreadCount(countData || 0);
      }
      
      // Get recent notifications
      const { data, error } = await supabase
        .from('user_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      
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
      const { error } = await supabase
        .rpc('mark_notification_as_read', { notification_id: notificationId });
      
      if (error) {
        console.error('Error marking notification as read:', error);
        return false;
      } else {
        // Update local state
        setNotifications(prev => 
          prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
        return true;
      }
    } catch (err) {
      console.error('Error in markAsRead:', err);
      return false;
    }
  };

  const markAllAsRead = async () => {
    try {
      const { data, error } = await supabase
        .rpc('mark_all_notifications_as_read');
      
      if (error) {
        console.error('Error marking all notifications as read:', error);
        return false;
      } else {
        // Update local state
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
        setUnreadCount(0);
        return true;
      }
    } catch (err) {
      console.error('Error in markAllAsRead:', err);
      return false;
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
        return false;
      } else {
        // Update local state
        setNotifications(prev => prev.filter(n => n.id !== notificationId));
        // If it was unread, update the count
        const wasUnread = notifications.find(n => n.id === notificationId && !n.is_read);
        if (wasUnread) {
          setUnreadCount(prev => Math.max(0, prev - 1));
        }
        return true;
      }
    } catch (err) {
      console.error('Error in deleteNotification:', err);
      return false;
    }
  };

  return {
    notifications,
    unreadCount,
    isLoading,
    error,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification
  };
}