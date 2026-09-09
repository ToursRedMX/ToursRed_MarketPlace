import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import MaintenancePage from '../pages/MaintenancePage';

interface MaintenanceSettings {
  maintenance_mode: boolean;
  maintenance_message: string;
}

const BYPASS_PATHS = ['/mantenimiento-admin'];

const MaintenanceGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isSuperAdmin, isLoading: authLoading } = useAuth();
  const location = useLocation();
  const [maintenance, setMaintenance] = useState<MaintenanceSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const leerSettings = async () =>
      supabase
        .from('platform_settings')
        .select('maintenance_mode, maintenance_message')
        .limit(1)
        .maybeSingle();

    const load = async () => {
      let { data, error } = await leerSettings();

      // Un error aqui deja el sitio abierto durante el mantenimiento. Es el
      // menor de los dos males —el contrario tumbaria el sitio entero por un
      // parpadeo de red— pero al menos reintentamos una vez y lo registramos.
      if (error) {
        console.error('MaintenanceGate: no se pudo leer platform_settings, reintentando', error);
        ({ data, error } = await leerSettings());
        if (error) {
          console.error('MaintenanceGate: el reintento tambien fallo, el sitio queda abierto', error);
        }
      }

      setMaintenance(data ?? { maintenance_mode: false, maintenance_message: '' });
      setSettingsLoading(false);
    };

    load();

    channel = supabase
      .channel(`platform_settings_maintenance_${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'platform_settings' },
        (payload) => {
          const r = payload.new as Record<string, unknown>;
          setMaintenance({
            maintenance_mode: r.maintenance_mode as boolean,
            maintenance_message: r.maintenance_message as string,
          });
        }
      )
      .subscribe();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  // Always allow bypass path (the hidden admin login)
  if (BYPASS_PATHS.includes(location.pathname)) {
    return <>{children}</>;
  }

  if (authLoading || settingsLoading) {
    return <>{children}</>;
  }

  if (maintenance?.maintenance_mode && !isSuperAdmin) {
    return <MaintenancePage message={maintenance.maintenance_message} />;
  }

  return <>{children}</>;
};

export default MaintenanceGate;
