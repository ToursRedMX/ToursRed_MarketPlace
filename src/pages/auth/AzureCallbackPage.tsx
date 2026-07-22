import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

async function fetchAndStoreMsAvatar(providerToken: string): Promise<string | null> {
  try {
    const photoRes = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    if (!photoRes.ok) return null;

    const blob = await photoRes.blob();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const path = `avatars/${user.id}/ms-avatar.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('images')
      .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });

    if (uploadError) return null;

    const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(path);
    await supabase.auth.updateUser({ data: { ms_avatar_url: publicUrl } });
    return publicUrl;
  } catch {
    return null;
  }
}

async function redirectForUser(
  user: any,
  session: any,
  navigate: (path: string, opts?: any) => void,
  setError: (msg: string) => void,
) {
  try {
    const isAzureProvider =
      user.app_metadata?.provider === 'azure' ||
      (user.identities ?? []).some((i: any) => i.provider === 'azure');

    if (isAzureProvider) {
      const onboardingCompleted = user.user_metadata?.onboarding_completed;
      if (!onboardingCompleted) {
        const { data: existingProfile, error: profileError } = await supabase
          .from('users')
          .select('id, role')
          .eq('id', user.id)
          .maybeSingle();

        if (profileError) throw profileError;

        if (existingProfile) {
          const role = existingProfile.role;
          if (role === 'admin') navigate('/admin/dashboard', { replace: true });
          else if (role === 'agency') navigate('/agency/dashboard', { replace: true });
          else navigate('/traveler/dashboard', { replace: true });
        } else {
          if (session?.provider_token) {
            await fetchAndStoreMsAvatar(session.provider_token);
          }
          navigate('/auth/azure-onboarding', { replace: true });
        }
        return;
      }
    }

    const role = user.user_metadata?.role;
    if (role === 'admin') navigate('/admin/dashboard', { replace: true });
    else if (role === 'agency') navigate('/agency/dashboard', { replace: true });
    else navigate('/traveler/dashboard', { replace: true });
  } catch {
    setError('No se pudo completar el inicio de sesión. Por favor intenta de nuevo.');
  }
}

const AzureCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    let done = false;

    // Register onAuthStateChange FIRST — its SIGNED_IN event carries provider_token
    // which is required to fetch the Microsoft profile photo for new users.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (done) return;
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
        done = true;
        redirectForUser(session.user, session, navigate, setError);
      }
    });

    // getSession() handles users whose session was already established before
    // our onAuthStateChange listener registered. If provider_token is missing
    // here (it's not stored across refreshes), the avatar fetch simply returns
    // null and the user still proceeds to onboarding normally.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (done) return;
      if (session?.user) {
        done = true;
        redirectForUser(session.user, session, navigate, setError);
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
        <p className="text-sm text-gray-500">Completando inicio de sesión con Microsoft...</p>
      </div>
    </div>
  );
};

export default AzureCallbackPage;
