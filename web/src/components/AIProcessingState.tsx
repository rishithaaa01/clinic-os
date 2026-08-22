import React from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';

interface AIProcessingStateProps {
  currentStage: number; // 1 to 5
  customMessage?: string;
}

const STAGES = [
  "Preparing your recording...",
  "Transcribing clinical note...",
  "Analyzing symptoms...",
  "Preparing clinical insights...",
  "Finalizing results..."
];

export const AIProcessingState: React.FC<AIProcessingStateProps> = ({ currentStage, customMessage }) => {
  const activeStep = Math.min(Math.max(currentStage, 1), STAGES.length);

  return (
    <div className="w-full bg-slate-50 border border-slate-200 rounded-xl p-5 my-4 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
          <span className="font-semibold text-slate-800 text-sm">
            {customMessage || STAGES[activeStep - 1]}
          </span>
        </div>
        <span className="text-xs text-slate-500 font-medium">
          Step {activeStep} of {STAGES.length}
        </span>
      </div>

      <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden mb-4">
        <div 
          className="bg-indigo-600 h-full transition-all duration-500 ease-out rounded-full"
          style={{ width: `${(activeStep / STAGES.length) * 100}%` }}
        />
      </div>

      <div className="grid grid-cols-5 gap-1 text-center">
        {STAGES.map((stage, idx) => {
          const stepNum = idx + 1;
          const isDone = stepNum < activeStep;
          const isCurrent = stepNum === activeStep;

          return (
            <div key={idx} className="flex flex-col items-center">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                isDone ? 'bg-emerald-500 text-white' : 
                isCurrent ? 'bg-indigo-600 text-white ring-2 ring-indigo-200 animate-pulse' : 
                'bg-slate-200 text-slate-500'
              }`}>
                {isDone ? <CheckCircle2 className="w-4 h-4" /> : stepNum}
              </div>
              <span className={`text-[10px] mt-1 hidden sm:inline ${
                isCurrent ? 'font-semibold text-indigo-700' : 'text-slate-500'
              }`}>
                {stage.split(' ')[0]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
