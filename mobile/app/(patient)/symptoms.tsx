import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  Alert, Animated, Easing, TextInput
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import patientApi from '../../src/services/patientApi';
import api from '../../src/services/api';
import { useAuthStore } from '../../src/store/authStore';
import { useVoiceRecorder } from '../../src/hooks/useVoiceRecorder';
import {
  Mic, MicOff, Stethoscope, Sparkles, Building2, AlertTriangle,
  CheckCircle2, ArrowLeft, ShieldAlert, Square, Volume2, Calendar
} from 'lucide-react-native';

// ────────────────────────────────────────────────────────────
// Voice-first patient symptom screen
// ────────────────────────────────────────────────────────────

type PageResult = {
  transcript?: string;
  risk_level?: string;
  refer_to_doctor?: boolean;
  target_speciality?: string;
  reasoning?: string;
  recommendation?: string;
};

export default function VoiceSymptomScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // ── state ─────────────────────────────────────────────────
  const [preferredHospital, setPreferredHospital] = useState('General Hospital');
  const [triageResult, setTriageResult] = useState<PageResult | null>(null);
  const [transcript, setTranscript] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  // pulse animation for mic
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ── Upload handler passed to recorder hook ───────────────
  const handleRecordingComplete = async (uri: string) => {
    try {
      const token = useAuthStore.getState().token;
      const API_URL = api.defaults.baseURL;

      const response = await FileSystem.uploadAsync(
        `${API_URL}/patients/me/voice-symptoms?preferred_hospital_id=${encodeURIComponent(preferredHospital)}`,
        uri,
        {
          fieldName: 'file',
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          headers: {
            Authorization: `Bearer ${token}`,
            'x-client-type': 'mobile',
          },
        }
      );

      if (response.status >= 400) {
        throw new Error(`Server error ${response.status}`);
      }

      const data = JSON.parse(response.body);
      setTranscript(data.transcript || '');
      setTriageResult(data);
      queryClient.invalidateQueries({ queryKey: ['patientVisits'] });
      queryClient.invalidateQueries({ queryKey: ['healthSummary'] });
    } catch (e: any) {
      console.error('Voice symptom upload error:', e);
      setCustomError("We couldn't process the recording. Please try again.");
    }
  };

  const {
    state,
    duration,
    error: recorderError,
    startRecording,
    stopRecording,
    cancelRecording,
    resetRecorder,
  } = useVoiceRecorder({
    onRecordingComplete: handleRecordingComplete,
  });

  const { data: hospitals = [] } = useQuery({
    queryKey: ['hospitalsList'],
    queryFn: patientApi.getHospitals,
  });

  // ── pulse animation ───────────────────────────────────────
  useEffect(() => {
    if (state === 'recording') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.18, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [state]);

  const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  // ── Reset for new recording ───────────────────────────────
  const resetAll = () => {
    resetRecorder();
    setTriageResult(null);
    setTranscript('');
    setCustomError(null);
  };

  // ── Risk badge ────────────────────────────────────────────
  const getRiskBadge = (level?: string) => {
    switch (level) {
      case 'SEVERE': return { bg: 'bg-red-500', text: 'text-white', label: '🚨 SEVERE / EMERGENCY' };
      case 'URGENT': return { bg: 'bg-amber-500', text: 'text-white', label: '⚠️ URGENT CARE NEEDED' };
      case 'WATCH':  return { bg: 'bg-indigo-500', text: 'text-white', label: '👁️ MONITOR & CONSULT' };
      default:       return { bg: 'bg-emerald-500', text: 'text-white', label: '✅ ROUTINE / LOW RISK' };
    }
  };

  const activeError = customError || recorderError;

  return (
    <SafeAreaView className="flex-1 bg-[#F7F3EE]">
      <ScrollView className="flex-1 px-4 pt-4" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>

        {/* Back */}
        <TouchableOpacity onPress={() => router.back()} className="flex-row items-center mb-4">
          <ArrowLeft size={18} color="#475569" />
          <Text className="text-slate-600 font-semibold text-sm ml-1">Back to Dashboard</Text>
        </TouchableOpacity>

        {/* Header */}
        <View className="bg-white rounded-3xl p-5 mb-5 border border-slate-100 shadow-sm flex-row items-center">
          <View className="w-12 h-12 bg-teal-100 rounded-2xl items-center justify-center mr-4 border border-teal-200">
            <Volume2 size={24} color="#0d9488" />
          </View>
          <View className="flex-1">
            <Text className="text-slate-800 text-xl font-bold">Voice Symptom Report</Text>
            <Text className="text-slate-500 text-xs mt-0.5">Speak your symptoms → AI triage → auto-referral</Text>
          </View>
        </View>

        {/* ── Hospital Selector ─────────────────────────────── */}
        <View className="bg-white rounded-3xl p-5 mb-5 border border-slate-100 shadow-sm">
          <Text className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
            🏥 Select Hospital for Referral
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
            {(hospitals.length > 0
              ? hospitals
              : [{ name: 'General Hospital' }, { name: 'District Hospital' }, { name: 'Primary Health Center' }]
            ).map((h: any) => (
              <TouchableOpacity
                key={h._id || h.name}
                onPress={() => setPreferredHospital(h.name)}
                className={`px-3.5 py-2.5 rounded-xl mr-2 flex-row items-center border ${
                  preferredHospital === h.name
                    ? 'bg-teal-600 border-teal-600'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <Building2 size={14} color={preferredHospital === h.name ? 'white' : '#64748b'} />
                <Text className={`text-xs font-semibold ml-1.5 ${preferredHospital === h.name ? 'text-white' : 'text-slate-700'}`}>
                  {h.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* ── Voice Recording Card ─────────────────────────── */}
        <View className="bg-white rounded-3xl p-6 mb-6 border border-slate-100 shadow-sm items-center">

          {/* IDLE STATE */}
          {state === 'idle' && !triageResult && (
            <>
              <Text className="text-slate-500 text-sm text-center mb-1 font-medium">
                Tap the mic and describe your symptoms
              </Text>
              <Text className="text-slate-400 text-xs text-center mb-6">
                Speak clearly in any language
              </Text>

              <TouchableOpacity
                onPress={startRecording}
                className="w-28 h-28 bg-teal-500 rounded-full items-center justify-center shadow-lg mb-4"
                activeOpacity={0.8}
              >
                <Mic size={48} color="white" />
              </TouchableOpacity>

              <Text className="text-teal-700 text-xs font-bold uppercase tracking-wider">
                Tap to Start Recording
              </Text>

              {activeError ? (
                <View className="bg-red-50 border border-red-200 rounded-xl p-3 mt-4 w-full">
                  <Text className="text-red-600 text-xs text-center">{activeError}</Text>
                </View>
              ) : null}
            </>
          )}

          {/* PREPARING STATE */}
          {state === 'preparing' && (
            <>
              <ActivityIndicator size="large" color="#0d9488" className="mb-4" />
              <Text className="text-slate-700 text-sm font-bold mb-1">Preparing microphone...</Text>
              <Text className="text-slate-400 text-xs text-center">Please wait a moment before speaking</Text>
            </>
          )}

          {/* RECORDING STATE */}
          {state === 'recording' && (
            <>
              <Text className="text-red-500 text-xs font-bold uppercase tracking-wider mb-2">
                ● Recording...
              </Text>
              <Text className="text-slate-800 text-3xl font-bold mb-4 font-mono">
                {fmtTime(duration)}
              </Text>

              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <View className="w-28 h-28 bg-red-500 rounded-full items-center justify-center shadow-lg mb-4">
                  <Mic size={48} color="white" />
                </View>
              </Animated.View>

              <View className="flex-row items-center mt-2">
                <TouchableOpacity
                  onPress={cancelRecording}
                  className="px-5 py-3 bg-slate-200 rounded-xl mr-3"
                >
                  <Text className="text-slate-700 text-xs font-bold">Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={stopRecording}
                  className="px-6 py-3 bg-teal-600 rounded-xl flex-row items-center"
                >
                  <Square size={14} color="white" />
                  <Text className="text-white text-xs font-bold ml-1.5">Stop & Submit</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* STOPPING STATE */}
          {state === 'stopping' && (
            <>
              <ActivityIndicator size="large" color="#0d9488" className="mb-4" />
              <Text className="text-slate-700 text-sm font-bold mb-1">Saving recording...</Text>
            </>
          )}

          {/* UPLOADING STATE */}
          {state === 'uploading' && (
            <>
              <ActivityIndicator size="large" color="#0d9488" className="mb-4" />
              <Text className="text-slate-700 text-base font-bold mb-1">Processing your voice...</Text>
              <Text className="text-slate-400 text-xs text-center">
                Transcribing → AI triage → auto-referral
              </Text>
            </>
          )}

          {/* RESULT STATE — show transcript */}
          {triageResult && transcript ? (
            <>
              <View className="w-full bg-teal-50 border border-teal-200 rounded-2xl p-4 mb-4">
                <Text className="text-teal-700 text-[10px] font-bold uppercase tracking-wider mb-1.5">
                  🎙️ What We Heard
                </Text>
                <Text className="text-slate-800 text-sm leading-5">{transcript}</Text>
              </View>

              <TouchableOpacity
                onPress={resetAll}
                className="bg-slate-100 border border-slate-200 rounded-xl px-5 py-2.5"
              >
                <Text className="text-slate-600 text-xs font-bold">🔄 Record Again</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </View>

        {/* ── TRIAGE RESULT CARD ───────────────────────────── */}
        {triageResult && (
          <View className="bg-slate-900 border border-slate-800 rounded-3xl p-5 mb-10 shadow-xl">
            <View className="flex-row items-center justify-between pb-3 border-b border-slate-800 mb-3">
              <View className="flex-row items-center">
                <View className="w-8 h-8 bg-teal-500/20 rounded-xl items-center justify-center mr-2.5 border border-teal-500/30">
                  <Sparkles size={16} color="#14b8a6" />
                </View>
                <Text className="text-white font-bold text-base">AI Triage & Referral</Text>
              </View>

              {(() => {
                const badge = getRiskBadge(triageResult.risk_level);
                return (
                  <View className={`px-2.5 py-1 rounded-full ${badge.bg}`}>
                    <Text className={`text-[10px] font-bold ${badge.text}`}>{badge.label}</Text>
                  </View>
                );
              })()}
            </View>

            {/* Auto-Referral Banner */}
            {triageResult.refer_to_doctor && (
              <View className="bg-teal-500/10 border border-teal-500/30 rounded-2xl p-3.5 mb-3 flex-row items-start">
                <CheckCircle2 size={18} color="#14b8a6" style={{ marginTop: 2, marginRight: 8 }} />
                <View className="flex-1">
                  <Text className="text-teal-300 font-bold text-xs">Auto-Referral Generated ✓</Text>
                  <Text className="text-slate-300 text-xs mt-0.5">
                    Your appointment is queued at <Text className="font-semibold text-white">{preferredHospital}</Text>.
                  </Text>
                  {triageResult.target_speciality && (
                    <Text className="text-slate-400 text-[10px] mt-0.5">
                      Specialty: {triageResult.target_speciality}
                    </Text>
                  )}
                </View>
              </View>
            )}

            {/* AI Reasoning */}
            {triageResult.reasoning && (
              <View className="bg-slate-800/80 rounded-2xl p-3.5 mb-3 border border-slate-700/50">
                <Text className="text-teal-400 text-[10px] font-bold uppercase tracking-wider mb-1">📋 Clinical Reasoning</Text>
                <Text className="text-slate-200 text-xs leading-5">{triageResult.reasoning}</Text>
              </View>
            )}

            {/* AI Guidance */}
            {triageResult.recommendation && (
              <View className="bg-slate-800/80 rounded-2xl p-3.5 mb-3 border border-slate-700/50">
                <Text className="text-indigo-300 text-[10px] font-bold uppercase tracking-wider mb-1">💡 Guidance & Next Steps</Text>
                <Text className="text-slate-200 text-xs leading-5">{triageResult.recommendation}</Text>
              </View>
            )}

            <TouchableOpacity
              onPress={() => router.push({
                pathname: '/(patient)/appointments',
                params: {
                  hospital: preferredHospital,
                  specialty: triageResult.target_speciality || 'General Medicine',
                  complaint: transcript || 'Self Referral',
                  auto_referral: 'true'
                }
              })}
              className="bg-teal-500 rounded-xl py-3.5 items-center justify-center mt-2 flex-row border border-teal-400"
            >
              <Calendar size={16} color="white" style={{ marginRight: 6 }} />
              <Text className="text-white font-bold text-xs">📅 Pick OPD Time Slot Now →</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push('/(patient)/records')}
              className="bg-slate-800 rounded-xl py-3 items-center justify-center mt-2 border border-slate-700"
            >
              <Text className="text-slate-300 font-semibold text-xs">View Symptom Assessments in Health Records</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}
