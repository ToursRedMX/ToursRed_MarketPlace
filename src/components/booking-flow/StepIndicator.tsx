import React from 'react';
import { Check } from 'lucide-react';

interface StepIndicatorProps {
  currentStep: 1 | 2 | 3 | 4;
}

const STEPS = [
  { num: 1, label: 'Tu Tour' },
  { num: 2, label: 'Viajeros' },
  { num: 3, label: 'Asientos y Extras' },
  { num: 4, label: 'Pago' },
] as const;

const StepIndicator: React.FC<StepIndicatorProps> = ({ currentStep }) => {
  return (
    <div className="w-full max-w-2xl mx-auto mb-8">
      <div className="flex items-center justify-between">
        {STEPS.map((step, idx) => {
          const isComplete = currentStep > step.num;
          const isCurrent = currentStep === step.num;
          const isLast = idx === STEPS.length - 1;

          return (
            <React.Fragment key={step.num}>
              <div className="flex flex-col items-center gap-2 flex-shrink-0">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm transition-all duration-300 ${
                    isComplete
                      ? 'bg-emerald-500 text-white'
                      : isCurrent
                      ? 'bg-primary-600 text-white ring-4 ring-primary-100'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {isComplete ? <Check className="w-5 h-5" /> : step.num}
                </div>
                <span
                  className={`text-xs font-medium ${
                    isCurrent ? 'text-primary-700' : isComplete ? 'text-emerald-600' : 'text-gray-400'
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {!isLast && (
                <div className="flex-1 h-0.5 mx-2 -mt-6">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      currentStep > step.num ? 'bg-emerald-500' : 'bg-gray-200'
                    }`}
                  />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default StepIndicator;
