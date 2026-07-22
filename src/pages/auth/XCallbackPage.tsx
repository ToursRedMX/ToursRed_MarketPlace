import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

async function redirectForUser(user: any, navigate: (path: string, opts?: any) => void) {
  const isXProvider =
    user.app_metadata?.provider === 'x' ||
    user.app_metadata?.provider === 'twitter' ||
    (user.identities ?? []).some((i: any) => i.provider === 'x' || i.provider === 'twitter');

  if (isXProvider) {
    const onboardingCompleted = user.user_metadata?.onboarding_completed;
    if (!onboardingCompleted) {
      const { data: existingProfile } = await supabase
        .from('users')
        .select('id, role, profile_picture_url')
        .eq('id', user.id)
        .maybeSingle();

      if (existingProfile) {
        // User linked X to an existing account — save avatar if not set yet
        if (!existingProfile.profile_picture_url) {
          const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture;
          if (avatarUrl) {
            await supabase
              .from('users')
              .update({ profile_picture_url: avatarUrl })
              .eq('id', user.id);
          }
        }
        const role = existingProfile.role;
        if (role === 'admin') navigate('/admin/dashboard', { replace: true });
        else if (role === 'agency') navigate('/agency/dashboard', { replace: true });
        else navigate('/traveler/dashboard', { replace: true });
      } else {
        navigate('/auth/x-onboarding', { replace: true });
      }
      return;
    }
  }

  const role = user.user_metadata?.role;
  if (role === 'admin') navigate('/admin/dashboard', { replace: true });
  else if (role === 'agency') navigate('/agency/dashboard', { replace: true });
  else navigate('/traveler/dashboard', { replace: true });
}

const XCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    let done = false;

    // 1. Listen FIRST to capture provider_token before getSession()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (done) return;
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
        done = true;
        redirectForUser(session.user, navigate);
      }
    });

    // 2. Check if session already exists
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (done) return;
      if (session?.user) {
        done = true;
        redirectForUser(session.user, navigate);
      }
    });

    const timeout = setTimeout(() => {
      if (!done) {
        setError('No se pudo completar el inicio de sesión. Por favor intenta de nuevo.');
      }
    }, 10000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center max-w-sm">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={() => navigate('/login')}
            className="text-primary-600 underline text-sm"
          >
            Volver al inicio de sesión
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600 mx-auto mb-4"></div>
        <p className="text-sm text-gray-500">Completando inicio de sesión con X...</p>
      </div>
    </div>
  );
};

export default XCallbackPage;
