import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export function useAgencyId() {
  const { user, isAgencyStaff, staffInfo } = useAuth();
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    if (isAgencyStaff && staffInfo?.agencyId) {
      setAgencyId(staffInfo.agencyId);
      setLoading(false);
      return;
    }

    supabase
      .from('agencies')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message);
        } else if (data) {
          setAgencyId(data.id);
        }
        setLoading(false);
      });
  }, [user?.id, isAgencyStaff, staffInfo?.agencyId]);

  return { agencyId, loading, error };
}
