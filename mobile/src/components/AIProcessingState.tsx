import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { CheckCircle } from 'lucide-react-native';

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
    <View className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 my-3">
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center gap-2">
          <ActivityIndicator size="small" color="#4F46E5" />
          <Text className="font-semibold text-slate-800 text-xs">
            {customMessage || STAGES[activeStep - 1]}
          </Text>
        </View>
        <Text className="text-[11px] text-slate-500 font-medium">
          Step {activeStep} of {STAGES.length}
        </Text>
      </View>

      <View className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden mb-3">
        <View 
          className="bg-indigo-600 h-full rounded-full"
          style={{ width: `${(activeStep / STAGES.length) * 100}%` }}
        />
      </View>
    </View>
  );
};
