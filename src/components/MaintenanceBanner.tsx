import React, { useEffect, useState } from 'react';
import { AlertTriangle, X, PowerOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const MaintenanceBanner: React.FC = () => {
  const { isSuperAdmin } = useAuth();
  const [settingsId, setSettingsId] = useState<string>('');
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;

    const load = async () => {
      const { data } = await supabase
        .from('platform_settings')
        .select('id, maintenance_mode')
        .limit(1)
        .maybeSingle();
      if (data) {
        setSettingsId(data.id);
        setMaintenanceMode(data.maintenance_mode);
      }
    };

    load();

    const channel = supabase
      .channel(`maintenance_banner_${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'platform_settings' },
        (payload) => {
          const r = payload.new as Record<string, unknown>;
          setMaintenanceMode(r.maintenance_mode as boolean);
          // Un-dismiss if maintenance was re-enabled
          if (r.maintenance_mode) setDismissed(false);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isSuperAdmin]);

  const handleDeactivate = async () => {
    if (!settingsId) return;
    setIsDeactivating(true);
    await supabase
      .from('platform_settings')
      .update({ maintenance_mode: false, maintenance_enabled_at: null })
      .eq('id', settingsId);
    setIsDeactivating(false);
  };

  if (!isSuperAdmin || !maintenanceMode || dismissed) return null;

  return (
    <div className="w-full bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between gap-3 shadow-lg text-sm font-medium">
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="truncate">
          Modo mantenimiento activo — los usuarios no pueden acceder al sitio
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleDeactivate}
          disabled={isDeactivating}
          className="flex items-center gap-1.5 bg-amber-950/20 hover:bg-amber-950/30 px-3 py-1 rounded-md transition-colors disabled:opacity-60 whitespace-nowrap"
        >
          <PowerOff className="h-3.5 w-3.5" />
          {isDeactivating ? 'Desactivando...' : 'Desactivar'}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 hover:bg-amber-950/20 rounded-md transition-colors"
          title="Ocultar banner"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default MaintenanceBanner;
