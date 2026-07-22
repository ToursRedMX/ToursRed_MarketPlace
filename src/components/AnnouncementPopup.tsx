import React, { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { isCrawler } from '../utils/isCrawler';

interface AnnouncementData {
  announcement_active: boolean;
  announcement_title: string;
  announcement_message: string;
  announcement_cta_text: string;
  announcement_activated_at: string | null;
}

const STORAGE_KEY_PREFIX = 'announcement_dismissed_';

const AnnouncementPopup: React.FC = () => {
  const { isSuperAdmin } = useAuth();
  const [data, setData] = useState<AnnouncementData | null>(null);
  const [visible, setVisible] = useState(false);

  const isDismissed = (activatedAt: string | null): boolean => {
    if (!activatedAt) return false;
    return localStorage.getItem(STORAGE_KEY_PREFIX + activatedAt) === '1';
  };

  const evaluateVisibility = (d: AnnouncementData) => {
    if (!d.announcement_active) {
      setVisible(false);
      return;
    }
    if (isDismissed(d.announcement_activated_at)) {
      setVisible(false);
      return;
    }
    setVisible(true);
  };

  useEffect(() => {
    const load = async () => {
      const { data: row } = await supabase
        .from('platform_settings')
        .select(
          'announcement_active, announcement_title, announcement_message, announcement_cta_text, announcement_activated_at'
        )
        .limit(1)
        .maybeSingle();
      if (row) {
        setData(row as AnnouncementData);
        evaluateVisibility(row as AnnouncementData);
      }
    };

    load();

    if (isCrawler()) return;

    const channel = supabase
      .channel(`announcement_popup_${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'platform_settings' },
        (payload) => {
          const row = payload.new as AnnouncementData;
          setData(row);
          evaluateVisibility(row);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleDismiss = () => {
    if (data?.announcement_activated_at) {
      localStorage.setItem(STORAGE_KEY_PREFIX + data.announcement_activated_at, '1');
    }
    setVisible(false);
  };

  // Super admin sees it too (for preview), but can dismiss it
  if (!visible || !data) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full mx-auto overflow-hidden animate-[fadeInScale_0.2s_ease-out]">
        {/* Header accent */}
        <div className="h-1.5 bg-gradient-to-r from-red-500 to-red-600" />

        <div className="p-6">
          {/* Icon + Title */}
          <div className="flex items-start gap-4 mb-4">
            <div className="bg-red-50 rounded-xl p-2.5 shrink-0">
              <Megaphone className="h-6 w-6 text-red-500" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-gray-900 leading-snug">
                {data.announcement_title || 'Aviso importante'}
              </h2>
            </div>
            <button
              onClick={handleDismiss}
              className="text-gray-400 hover:text-gray-600 transition-colors mt-0.5"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Message */}
          <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-wrap mb-6">
            {data.announcement_message}
          </p>

          {/* CTA */}
          <button
            onClick={handleDismiss}
            className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition-colors text-sm"
          >
            {data.announcement_cta_text || 'Aceptar'}
          </button>

          {isSuperAdmin && (
            <p className="text-center text-xs text-gray-400 mt-3">
              Vista previa de administrador — los usuarios ven este aviso al ingresar
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default AnnouncementPopup;
