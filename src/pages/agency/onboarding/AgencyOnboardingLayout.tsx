import React from 'react';
import { LogOut } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface Step {
  number: number;
  label: string;
}

interface Props {
  children: React.ReactNode;
  currentStep: number;
  steps: Step[];
}

const AgencyOnboardingLayout: React.FC<Props> = ({ children, currentStep, steps }) => {
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="ToursRed" className="h-8 w-auto" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <span className="text-lg font-semibold text-gray-900">ToursRed</span>
          <span className="hidden sm:inline text-sm text-gray-400 ml-2">— Registro de Agencia</span>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Salir
        </button>
      </header>

      {/* Progress steps */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <div className="flex items-center gap-2">
            {steps.map((step, idx) => {
              const done    = step.number < currentStep;
              const active  = step.number === currentStep;
              const pending = step.number > currentStep;
              return (
                <React.Fragment key={step.number}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold transition-colors ${
                      done    ? 'bg-green-500 text-white' :
                      active  ? 'bg-primary-600 text-white' :
                                'bg-gray-200 text-gray-500'
                    }`}>
                      {done ? '✓' : step.number}
                    </div>
                    <span className={`text-xs font-medium hidden sm:block truncate ${
                      active ? 'text-gray-900' : done ? 'text-green-700' : 'text-gray-400'
                    }`}>
                      {step.label}
                    </span>
                  </div>
                  {idx < steps.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-1 rounded ${done ? 'bg-green-400' : 'bg-gray-200'}`} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="max-w-2xl w-full">
          {children}
        </div>
      </main>
    </div>
  );
};

export default AgencyOnboardingLayout;
