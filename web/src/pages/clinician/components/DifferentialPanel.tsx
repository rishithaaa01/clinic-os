import React from 'react';
import { Sparkles, Activity, FileSearch, ArrowRight, AlertTriangle, Plus, Check, RefreshCw } from 'lucide-react';

interface DifferentialPanelProps {
  diagnoses: any[];
  isLoading: boolean;
  symptoms: string;
  onAddDiagnosis?: (name: string) => void;
  onRefresh?: () => void;
  currentDiagnoses?: string[];
  onSelectSymptomSnippet?: (symptom: string) => void;
}

export default function DifferentialPanel({ 
  diagnoses, 
  isLoading, 
  symptoms,
  onAddDiagnosis,
  onRefresh,
  currentDiagnoses = [],
  onSelectSymptomSnippet
}: DifferentialPanelProps) {
  const commonSymptoms = [
    "Fever & Chills",
    "Chest Pain & Palpitations",
    "Persistent Cough & Phlegm",
    "Shortness of Breath & Wheezing",
    "Abdominal Pain & Vomiting",
    "Throbbing Headache & Dizziness",
    "Skin Rash & Itching",
    "Joint Pain & Swelling"
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 bg-[#FAFAFA] rounded-2xl min-h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-[#E2DDD8]">
        <div>
          <div className="flex items-center gap-2 text-[#1B6CA8] mb-1">
            <Sparkles size={20} className="fill-[#1B6CA8] text-[#1B6CA8]" />
            <h3 className="font-bold text-lg uppercase tracking-wider font-mukta text-[#1B6CA8]">
              AI Differential Diagnosis
            </h3>
          </div>
          <p className="text-xs sm:text-sm text-[#888]">
            Live diagnostic considerations for:{' '}
            <span className="text-[#333] font-semibold italic">
              {symptoms && symptoms.trim() ? symptoms.trim() : 'No symptoms entered yet'}
            </span>
          </p>
        </div>

        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isLoading || !symptoms || symptoms.trim().length < 3}
            title="Refresh Differential Analysis"
            className="p-2 sm:px-3 sm:py-1.5 rounded-xl border border-[#E2DDD8] bg-white text-gray-700 hover:text-[#1B6CA8] hover:border-[#1B6CA8] text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin text-[#1B6CA8]' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 space-y-4">
        {isLoading ? (
          Array(3).fill(0).map((_, i) => (
            <div key={i} className="bg-white border border-[#E2DDD8] rounded-2xl p-5 shadow-sm animate-pulse space-y-3">
              <div className="flex justify-between items-center">
                <div className="h-5 bg-gray-200 rounded-md w-1/3" />
                <div className="h-5 bg-gray-200 rounded-full w-24" />
              </div>
              <div className="h-4 bg-gray-100 rounded w-full" />
              <div className="h-4 bg-gray-100 rounded w-4/5" />
              <div className="flex gap-2 pt-2">
                <div className="h-6 bg-gray-100 rounded-lg w-20" />
                <div className="h-6 bg-gray-100 rounded-lg w-28" />
              </div>
            </div>
          ))
        ) : diagnoses && diagnoses.length > 0 ? (
          diagnoses.map((diag, idx) => {
            const isAdded = currentDiagnoses.includes(diag.name);
            const isHigh = diag.confidence === 'High';
            const isMed = diag.confidence === 'Medium';

            return (
              <div 
                key={idx} 
                className="bg-white border border-[#E2DDD8] hover:border-[#1B6CA8] rounded-2xl p-5 shadow-sm hover:shadow-md transition-all duration-200 group"
              >
                {/* Title & Confidence Badge */}
                <div className="flex justify-between items-start gap-2 mb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-50 text-[#1B6CA8] font-bold text-xs flex items-center justify-center border border-blue-100">
                      {idx + 1}
                    </span>
                    <h4 className="font-bold text-[#222] text-base sm:text-lg tracking-tight">
                      {diag.name}
                    </h4>
                  </div>
                  <span className={`
                    px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider shrink-0
                    ${isHigh ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : isMed ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-gray-100 text-gray-700 border border-gray-200'}
                  `}>
                    {diag.confidence || 'Clinical'} Confidence
                  </span>
                </div>
                
                {/* Clinical Reasoning */}
                <p className="text-xs sm:text-sm text-[#555] leading-relaxed mb-4 pl-8">
                  {diag.reasoning}
                </p>

                {/* Suggested Investigations */}
                {diag.suggested_tests && diag.suggested_tests.length > 0 && (
                  <div className="pl-8 space-y-2 mb-4">
                    <p className="text-[10px] font-extrabold text-[#888] uppercase tracking-wider">Suggested Investigations</p>
                    <div className="flex flex-wrap gap-1.5">
                      {diag.suggested_tests.map((test: string, testIdx: number) => (
                        <span key={testIdx} className="bg-[#F7F3EE] text-[#444] px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-[#E2DDD8]">
                          <FileSearch size={12} className="text-[#1B6CA8] shrink-0" />
                          {test}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="pl-8 pt-2 flex flex-wrap items-center gap-2.5 border-t border-gray-100">
                  {onAddDiagnosis && (
                    <button 
                      onClick={() => onAddDiagnosis(diag.name)}
                      disabled={isAdded}
                      className={`
                        px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm
                        ${isAdded 
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default' 
                          : 'bg-[#1B6CA8] hover:bg-[#155b8f] text-white cursor-pointer active:scale-95'}
                      `}
                    >
                      {isAdded ? (
                        <>
                          <Check size={14} className="stroke-[3]" />
                          <span>Added to Diagnosis</span>
                        </>
                      ) : (
                        <>
                          <Plus size={14} className="stroke-[3]" />
                          <span>+ Add to Provisional Diagnosis</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 sm:p-12 text-center border-2 border-dashed border-[#E2DDD8] rounded-[24px] bg-white">
            <div className="w-16 h-16 bg-[#F7F3EE] rounded-full flex items-center justify-center mb-4 text-[#1B6CA8]">
              <Activity size={32} />
            </div>
            <h4 className="font-bold text-gray-800 text-base mb-1">
              AI Diagnostic Assistant Ready
            </h4>
            <p className="text-gray-500 text-xs sm:text-sm max-w-sm mb-6">
              Enter patient symptoms or chief complaints in the left documentation panel. The AI differential engine will automatically generate top clinical diagnostic considerations.
            </p>

            {/* Quick Inspiration Chips */}
            <div className="w-full max-w-md">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2.5">
                Common Clinical Presentations:
              </p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {commonSymptoms.map((symp, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      if (onSelectSymptomSnippet) {
                        onSelectSymptomSnippet(symp);
                      }
                    }}
                    className="text-xs bg-[#F7F3EE] hover:bg-blue-50 hover:text-[#1B6CA8] hover:border-blue-200 text-gray-600 px-3 py-1 rounded-full border border-gray-200 transition-all font-medium"
                  >
                    {symp}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Medical Safety Disclaimer */}
      <div className="mt-6 p-3.5 bg-amber-50/80 rounded-xl border border-amber-200 flex items-center gap-3">
        <AlertTriangle size={18} className="text-amber-600 shrink-0" />
        <p className="text-[11px] text-amber-800 leading-tight">
          <strong>Clinical Decision Support Notice:</strong> AI suggests possibilities based on medical datasets and pattern analysis. Final diagnostic evaluation and prescription remain the sole clinical responsibility of the treating physician.
        </p>
      </div>
    </div>
  );
}

