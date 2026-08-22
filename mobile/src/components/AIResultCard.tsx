import React from 'react';
import { View, Text } from 'react-native';
import { Activity, ShieldCheck, Stethoscope, AlertCircle, FileText } from 'lucide-react-native';

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
    <View className="w-full bg-white border border-slate-200 rounded-2xl p-4 my-3 shadow-sm space-y-4">
      {/* Header Banner */}
      <View className="flex-row items-center justify-between border-b border-slate-100 pb-3">
        <View className="flex-row items-center gap-2">
          <View className="p-1.5 bg-indigo-50 rounded-lg">
            <Activity size={18} color="#4F46E5" />
          </View>
          <View>
            <Text className="font-bold text-slate-800 text-sm">Clinical AI Evaluation</Text>
            <Text className="text-[10px] text-slate-500">AI decision support</Text>
          </View>
        </View>
        {isAiAssisted && (
          <View className="px-2.5 py-1 bg-indigo-100 rounded-full flex-row items-center gap-1">
            <ShieldCheck size={12} color="#3730A3" />
            <Text className="text-indigo-800 text-[10px] font-bold">AI-Assisted Prediction</Text>
          </View>
        )}
      </View>

      {/* Transcript */}
      {transcript && (
        <View className="bg-slate-50 border border-slate-100 rounded-xl p-3">
          <Text className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            Symptoms / Dictation
          </Text>
          <Text className="text-xs text-slate-700 italic">
            "{transcript}"
          </Text>
        </View>
      )}

      {/* AI Prediction */}
      <View className="bg-indigo-50/60 border border-indigo-100 rounded-xl p-3">
        <Text className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">
          AI-Assisted Prediction
        </Text>
        <View className="mt-1 flex-row items-center justify-between">
          <Text className="text-base font-bold text-slate-900 flex-1">
            {predictedCondition || "Clinical Evaluation Recommended"}
          </Text>
          {confPercentage !== null && confPercentage > 0 && (
            <View className="bg-indigo-100 px-2 py-0.5 rounded-full">
              <Text className="text-[10px] font-bold text-indigo-700">{confPercentage}% match</Text>
            </View>
          )}
        </View>
      </View>

      {/* Recommended Specialty */}
      <View className="bg-emerald-50/60 border border-emerald-100 rounded-xl p-3">
        <Text className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
          Recommended Specialty
        </Text>
        <Text className="text-base font-bold text-slate-900 mt-1">
          {recommendedSpecialty}
        </Text>
      </View>

      {/* Clinical Insights */}
      {clinicalInsights && (
        <View className="bg-slate-50 border border-slate-100 rounded-xl p-3">
          <Text className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            Clinical Insights
          </Text>
          <Text className="text-xs text-slate-800 leading-relaxed">
            {clinicalInsights}
          </Text>
        </View>
      )}

      {/* Doctor Confirmed Diagnosis */}
      {doctorConfirmedDiagnosis && (
        <View className="bg-emerald-100 border border-emerald-300 rounded-xl p-3">
          <Text className="text-[10px] font-bold text-emerald-900 uppercase tracking-wider mb-0.5">
            Doctor Confirmed Diagnosis
          </Text>
          <Text className="text-sm font-bold text-emerald-950">
            {doctorConfirmedDiagnosis}
          </Text>
        </View>
      )}
    </View>
  );
};
