import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import AgencyOnboardingLayout from './AgencyOnboardingLayout';
import OnboardingTermsStep from './OnboardingTermsStep';
import OnboardingDocumentsStep from './OnboardingDocumentsStep';
import OnboardingSignatureStep from './OnboardingSignatureStep';
import OnboardingRejectedStep from './OnboardingRejectedStep';

interface AgencyInfo {
  id: string;
  onboarding_status: string;
  persona_type: 'persona_fisica' | 'persona_moral';
  terms_accepted_at: string | null;
  contact_email: string;
  documents_submitted_at: string | null;
}

const STEPS = [
  { number: 1, label: 'Términos'   },
  { number: 2, label: 'Documentos' },
  { number: 3, label: 'Firma'      },
];

const STATUS_TO_STEP: Record<string, number> = {
  pending_documents: 2,
  pending_review:    2,
  pending_signature: 3,
  active:            4,
  rejected:          0,
};

const AgencyOnboardingPage: React.FC = () => {
  const [agency, setAgency]                 = useState<AgencyInfo | null>(null);
  const [loading, setLoading]               = useState(true);
  const [supportCategoryId, setSupportCat]  = useState<string | null>(null);

  const fetchAgency = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [{ data: ag }, { data: cats }] = await Promise.all([
      supabase
        .from('agencies')
        .select('id, onboarding_status, persona_type, terms_accepted_at, contact_email, documents_submitted_at')
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('support_categories')
        .select('id, nombre')
        .ilike('nombre', '%pelac%')
        .maybeSingle(),
    ]);

    setAgency(ag ?? null);
    setSupportCat(cats?.id ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAgency(); }, [fetchAgency]);

  // Reload when onboarding_status changes (e.g. after doc approval)
  useEffect(() => {
    if (!agency?.id) return;
    const channel = supabase
      .channel(`agency_onboarding_${agency.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'agencies', filter: `id=eq.${agency.id}` },
        () => fetchAgency()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [agency?.id, fetchAgency]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary-600/30 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!agency) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500 text-sm">
        No se encontró información de la agencia.
      </div>
    );
  }

  const { onboarding_status } = agency;

  if (onboarding_status === 'active') {
    window.location.href = '/agency/dashboard';
    return null;
  }

  if (onboarding_status === 'rejected') {
    return (
      <AgencyOnboardingLayout currentStep={0} steps={STEPS}>
        <OnboardingRejectedStep agencyId={agency.id} supportCategoryId={supportCategoryId} />
      </AgencyOnboardingLayout>
    );
  }

  const currentStep = STATUS_TO_STEP[onboarding_status] ?? 2;

  // Step 1: If status is pending_documents and terms not yet accepted → show terms
  const showTerms = onboarding_status === 'pending_documents' && !agency.terms_accepted_at;

  return (
    <AgencyOnboardingLayout currentStep={showTerms ? 1 : currentStep} steps={STEPS}>
      {showTerms && (
        <OnboardingTermsStep
          agencyId={agency.id}
          onAccepted={() => setAgency(prev => prev ? { ...prev, terms_accepted_at: new Date().toISOString() } : prev)}
        />
      )}

      {!showTerms && (onboarding_status === 'pending_documents' || onboarding_status === 'pending_review') && (
        <OnboardingDocumentsStep
          agencyId={agency.id}
          personaType={agency.persona_type}
          documentsSubmittedAt={agency.documents_submitted_at}
          onSubmitted={fetchAgency}
        />
      )}

      {onboarding_status === 'pending_signature' && (
        <OnboardingSignatureStep
          agencyId={agency.id}
          agencyEmail={agency.contact_email}
          onSigned={() => { setAgency(prev => prev ? { ...prev, onboarding_status: 'active' } : prev); window.location.href = '/agency/dashboard'; }}
        />
      )}
    </AgencyOnboardingLayout>
  );
};

export default AgencyOnboardingPage;
