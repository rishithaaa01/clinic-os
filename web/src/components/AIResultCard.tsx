import React from 'react';
import { Activity, ShieldCheck, Stethoscope, AlertCircle, FileText, ChevronRight } from 'lucide-react';

interface AIResultCardProps {
  predictedCondition?: string;
  confidence?: number;
  modelVersion?: string;
  recommendedSpecialty?: string;
  clinicalInsights?: string;
  transcript?: string;
  isAiAssisted?: boolean;
  topAlternatives?: Array<{ name: string; confidence: number }>;
  doctorConfirmedDiagnosis?: string;
}

export const AIResultCard: React.FC<AIResultCardProps> = ({
  predictedCondition,
  confidence,
  modelVersion = "v1.0-rf-disease",
  recommendedSpecialty = "General Medicine",
  clinicalInsights,
  transcript,
  isAiAssisted = true,
  topAlternatives = [],
  doctorConfirmedDiagnosis
}) => {
  const confPercentage = confidence ? Math.round(confidence * 100) : null;

  return (
    <div className="w-full bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6 my-4">
      {/* Header Banner */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-800 text-base">Clinical AI Evaluation</h3>
            <p className="text-xs text-slate-500">AI-assisted analysis — doctor review required</p>
          </div>
        </div>
        {isAiAssisted && (
          <span className="px-3 py-1 bg-indigo-100 text-indigo-800 text-xs font-semibold rounded-full flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" />
            AI-Assisted Prediction
          </span>
        )}
      </div>

      {/* Patient Reported Note / Transcript */}
      {transcript && (
        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
            <FileText className="w-4 h-4 text-slate-500" />
            Patient Reported Symptoms / Transcript
          </div>
          <p className="text-sm text-slate-700 italic font-sans leading-relaxed">
            "{transcript}"
          </p>
        </div>
      )}

      {/* Grid: AI Prediction & Recommended Specialty */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* AI-Assisted Prediction Box */}
        <div className="bg-gradient-to-br from-indigo-50/50 to-blue-50/50 border border-indigo-100 rounded-xl p-4">
          <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wider">
            AI-Assisted Prediction
          </span>
          <div className="mt-1 flex items-baseline justify-between">
            <h4 className="text-lg font-bold text-slate-900">
              {predictedCondition || "Clinical Evaluation Recommended"}
            </h4>
            {confPercentage !== null && confPercentage > 0 && (
              <span className="text-xs font-bold text-indigo-600 bg-indigo-100 px-2.5 py-0.5 rounded-full">
                {confPercentage}% match
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Model Version: {modelVersion}</p>

          {topAlternatives && topAlternatives.length > 1 && (
            <div className="mt-3 pt-3 border-t border-indigo-100/60">
              <span className="text-[11px] font-semibold text-slate-600">Top Differential Considerations:</span>
              <ul className="mt-1 space-y-1">
                {topAlternatives.slice(1, 3).map((alt, i) => (
                  <li key={i} className="text-xs text-slate-700 flex justify-between">
                    <span>• {alt.name}</span>
                    <span className="text-slate-500 font-medium">{Math.round(alt.confidence * 100)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Recommended Specialty Box */}
        <div className="bg-gradient-to-br from-teal-50/50 to-emerald-50/50 border border-teal-100 rounded-xl p-4">
          <span className="text-xs font-semibold text-teal-700 uppercase tracking-wider flex items-center gap-1">
            <Stethoscope className="w-3.5 h-3.5" />
            Recommended Specialty
          </span>
          <h4 className="text-lg font-bold text-slate-900 mt-1">
            {recommendedSpecialty}
          </h4>
          <p className="text-xs text-teal-800/80 mt-1 leading-normal">
            Specialist OPD assignment based on symptom pattern classifier.
          </p>
        </div>
      </div>

      {/* Clinical Insights */}
      {clinicalInsights && (
        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1 block">
            Clinical Insights
          </span>
          <p className="text-sm text-slate-800 leading-relaxed">
            {clinicalInsights}
          </p>
        </div>
      )}

      {/* Doctor Confirmed Diagnosis if present */}
      {doctorConfirmedDiagnosis && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-800 uppercase tracking-wider mb-1">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            Doctor Confirmed Diagnosis
          </div>
          <p className="text-base font-bold text-emerald-950">
            {doctorConfirmedDiagnosis}
          </p>
        </div>
      )}

      {/* Disclaimer */}
      <div className="flex items-center gap-2 text-[11px] text-slate-500 pt-2 border-t border-slate-100">
        <AlertCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span>
          AI predictions serve as decision support tools. Final diagnostic confirmation and prescribing authority belong strictly to the attending doctor.
        </span>
      </div>
    </div>
  );
};
