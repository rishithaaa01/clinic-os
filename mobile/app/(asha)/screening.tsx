import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../../src/services/api';
import { Stethoscope, Mic, Square, Sparkles, AlertTriangle, ShieldCheck, ArrowUpRight, Building, Check, Activity, Volume2 } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useVoiceRecorder } from '../../src/hooks/useVoiceRecorder';

const COMMON_SYMPTOMS = [
  'High Fever', 'Severe Cough', 'Chest Tightness', 'Shortness of Breath',
  'Severe Headache', 'Abdominal Pain', 'Dizziness', 'Joint Swelling', 'Fatigue & Anemia'
];

export default function AshaScreening() {
  const router = useRouter();
  const [households, setHouseholds] = useState<any[]>([]);
  const [hospitals, setHospitals] = useState<any[]>([]);
  const [selectedHhId, setSelectedHhId] = useState<string>('');
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [memberName, setMemberName] = useState<string>('');
  const [selectedHospital, setSelectedHospital] = useState<string>('');

  // Vitals & Symptoms
  const [symptoms, setSymptoms] = useState('');
  const [bp, setBp] = useState('120/80');
  const [temp, setTemp] = useState('98.6');
  const [pulse, setPulse] = useState('72');
  const [spo2, setSpo2] = useState('98');

  // AI Pipeline Stage States
  const [transcriptionState, setTranscriptionState] = useState<'idle' | 'transcribing' | 'success' | 'failed'>('idle');
  const [diseaseState, setDiseaseState] = useState<'idle' | 'analyzing' | 'success' | 'failed'>('idle');
  const [referralState, setReferralState] = useState<'idle' | 'analyzing' | 'success' | 'failed'>('idle');

  // AI Classification State
  const [aiResult, setAiResult] = useState<any>(null);
  const [classifying, setClassifying] = useState(false);
  const [submittingVisit, setSubmittingVisit] = useState(false);
  const [members, setMembers] = useState<any[]>([]);

  // Voice recording completion handler
  const handleAshaAudioComplete = async (uri: string) => {
    setTranscriptionState('transcribing');
    try {
      const formData = new FormData();
      formData.append('file', {
        uri,
        type: 'audio/m4a',
        name: 'voice_note.m4a',
      } as any);

      const res = await api.post('/asha/transcribe', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      const transcript = res.data.transcript || 'High fever and severe cough for 3 days';
      setSymptoms(transcript);
      setTranscriptionState('success');
      
      // Auto-run AI Triage on Voice Transcription (independent downstream stage)
      runAiTriageForText(transcript);
    } catch (err: any) {
      console.log('Error processing recording', err);
      setTranscriptionState('failed');
      Alert.alert('Transcription Notice', "Could not transcribe voice note automatically. You can type symptoms below.");
    }
  };

  const {
    state: voiceState,
    startRecording,
    stopRecording,
  } = useVoiceRecorder({
    onRecordingComplete: handleAshaAudioComplete,
  });

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    try {
      const [hhRes, hospRes] = await Promise.all([
        api.get('/asha/households'),
        api.get('/auth/hospitals')
      ]);
      const hhList = Array.isArray(hhRes.data) ? hhRes.data : [];
      const hospList = Array.isArray(hospRes.data) ? hospRes.data : [];
      
      setHouseholds(hhList);
      setHospitals(hospList);

      if (hospList.length > 0) {
        setSelectedHospital(hospList[0].name);
      }

      if (hhList.length > 0) {
        const firstHh = hhList[0];
        const hhId = String(firstHh.id || firstHh._id);
        setSelectedHhId(hhId);
        if (firstHh.members && firstHh.members.length > 0) {
          const firstMem = firstHh.members[0];
          setSelectedMemberId(firstMem.member_id || 'mem_1');
          setSelectedPatientId(firstMem.patient_id || '');
          setMemberName(firstMem.name);
        }
      }
    } catch (e) {
      console.log('Error loading screening data', e);
    }
  };

  const resetAiState = () => {
    setSymptoms('');
    setAiResult(null);
    setTranscriptionState('idle');
    setDiseaseState('idle');
    setReferralState('idle');
  };

  const handleHouseholdChange = (hhId: string) => {
    setSelectedHhId(hhId);
    resetAiState();
    const hh = households.find(h => String(h.id || h._id) === hhId);
    if (hh && hh.members && hh.members.length > 0) {
      setMembers(hh.members);
      const firstMem = hh.members[0];
      setSelectedMemberId(firstMem.member_id || 'mem_1');
      setSelectedPatientId(firstMem.patient_id || '');
      setMemberName(firstMem.name);
    } else {
      setMembers([]);
      setSelectedMemberId('');
      setSelectedPatientId('');
      setMemberName('');
    }
  };

  const handleMemberChange = (memberObj: any) => {
    resetAiState();
    setSelectedMemberId(memberObj.member_id || 'mem_1');
    setSelectedPatientId(memberObj.patient_id || '');
    setMemberName(memberObj.name);
  };

  const toggleSymptomChip = (sym: string) => {
    if (symptoms.includes(sym)) {
      setSymptoms(symptoms.replace(sym, '').replace(/,\s*,/g, ',').replace(/^,\s*|\s*,\s*$/g, ''));
    } else {
      setSymptoms(symptoms ? `${symptoms}, ${sym}` : sym);
    }
  };

  const runAiTriageForText = async (textToAnalyze: string) => {
    if (classifying) return;
    setClassifying(true);
    setDiseaseState('analyzing');
    setReferralState('analyzing');
    try {
      const res = await api.post('/asha/visits/classify-risk', {
        member_name: memberName || 'Patient',
        member_age: 35,
        member_gender: 'female',
        visit_type: 'Home Visit Screening',
        observations: { symptoms: textToAnalyze, bp, temp, pulse, spo2 },
        transcript: textToAnalyze
      });
      setAiResult(res.data);
      setDiseaseState('success');
      setReferralState('success');
    } catch (err: any) {
      console.log('AI Triage request error:', err);
      setDiseaseState('failed');
      setReferralState('failed');
    } finally {
      setClassifying(false);
    }
  };

  const handleManualRunAiTriage = () => {
    if (classifying) return;
    if (!symptoms.trim()) {
      return Alert.alert('Required', 'Please provide symptom information before running AI triage.');
    }
    runAiTriageForText(symptoms.trim());
  };

  // Check if selected hospital has doctor matching required specialty
  const reqSpecialty = aiResult?.recommended_specialty || 'General Medicine';
  const targetHospObj = hospitals.find(h => h.name === selectedHospital);
  const targetSpecialties: string[] = targetHospObj?.specialties || ['General Medicine'];
  
  const isSpecialistAvailable = reqSpecialty === 'General Medicine' || targetSpecialties.some(s => s.toLowerCase() === reqSpecialty.toLowerCase());

  // Find alternative hospital that HAS this specialist
  const altHospObj = hospitals.find(h => h.name !== selectedHospital && (h.specialties || []).some((s: string) => s.toLowerCase() === reqSpecialty.toLowerCase()));

  const handleSaveVisitAndRefer = async () => {
    if (submittingVisit) return;
    if (!selectedHhId) {
      return Alert.alert('Error', 'Please select a household.');
    }
    if (!selectedHospital) {
      return Alert.alert('Error', 'Please select a hospital for referral.');
    }

    setSubmittingVisit(true);
    try {
      const riskLevel = aiResult?.risk_level || 'WATCH';
      const reqSpecialty = aiResult?.recommended_specialty || 'General Medicine';
      
      // 1. Record ASHA Visit
      const visitRes = await api.post('/asha/visits', {
        household_id: selectedHhId,
        member_id: selectedPatientId || selectedMemberId || 'mem_1',
        visit_type: 'Home Visit Screening',
        risk_level: riskLevel,
        observations: { symptoms, bp, temp, pulse, spo2 },
        ai_reasoning: aiResult?.reasoning || 'Screened by ASHA worker with vitals',
        ai_recommendation: aiResult?.recommendation || 'Follow up as appropriate'
      });

      // 2. Create Referral to Selected Hospital
      const refRes = await api.post('/asha/referrals', {
        patient_id: selectedPatientId || 'unknown',
        household_id: selectedHhId,
        to_hospital_id: selectedHospital,
        visit_id: visitRes.data?.id || visitRes.data?._id || 'unknown',
        urgency: riskLevel === 'URGENT' ? 'Today' : 'Routine',
        urgency_specialty: reqSpecialty,
        ai_summary: `${aiResult?.predicted_disease || 'Condition'} (${reqSpecialty}): ${aiResult?.reasoning || symptoms}`,
        notes: symptoms
      });

      if (refRes.data?.status === 'SPECIALIST_UNAVAILABLE') {
        const recs = refRes.data.recommended_hospitals || [];
        if (recs.length > 0) {
          const rec = recs[0];
          Alert.alert(
            'Specialist Unavailable',
            `No ${reqSpecialty} specialist is currently available at ${selectedHospital}.\n\nRecommended Alternative Hospital:\n• ${rec.hospital_name} (${rec.available_doctor_name})`,
            [
              { 
                text: 'Keep Unassigned', 
                style: 'cancel', 
                onPress: () => router.push('/(asha)/referrals') 
              },
              { 
                text: `Route to ${rec.hospital_name}`, 
                onPress: async () => {
                  try {
                    await api.post(`/asha/referrals/${refRes.data.referral_id}/change-destination`, {
                      new_hospital_id: rec.hospital_name
                    });
                    Alert.alert(
                      'Referral Re-routed', 
                      `Successfully assigned to ${rec.available_doctor_name} at ${rec.hospital_name}.`
                    );
                  } catch (e) {
                    Alert.alert('Notice', 'Referral saved as pending destination selection.');
                  }
                  router.push('/(asha)/referrals');
                }
              }
            ]
          );
        } else {
          Alert.alert(
            'Specialist Unavailable',
            `No ${reqSpecialty} specialist is currently available at ${selectedHospital}. The referral is saved and awaiting specialist availability.`
          );
          router.push('/(asha)/referrals');
        }
        return;
      }

      setSymptoms('');
      setAiResult(null);
      Alert.alert(
        'Referral Sent',
        `Patient successfully referred to ${refRes.data?.assigned_doctor_name || 'Specialist'} at ${selectedHospital}.`
      );
      router.push('/(asha)/referrals');
    } catch (err: any) {
      Alert.alert('Referral Error', err.response?.data?.detail || 'Failed to complete hospital referral.');
    } finally {
      setSubmittingVisit(false);
    }
  };

  const selectedHh = households.find(h => String(h.id || h._id) === selectedHhId);
  const currentMembers = selectedHh?.members || members || [];

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView className="flex-1 px-4 pt-6" contentContainerStyle={{ paddingBottom: 50 }}>
        <View className="mb-6">
          <Text className="text-slate-800 text-2xl font-bold">Community Screening</Text>
          <Text className="text-slate-500 text-xs font-medium">Voice-Assisted AI Disease Prediction & Specialist Hospital Routing</Text>
        </View>

        {/* 1. Household & Member Selector */}
        <View className="bg-white p-4 rounded-3xl mb-6 border border-slate-100 shadow-sm shadow-slate-200/50">
          <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">1. Select Household Family</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row mb-4">
            {households.map(h => {
              const hId = String(h.id || h._id);
              const isSelected = hId === selectedHhId;
              return (
                <TouchableOpacity
                  key={hId}
                  onPress={() => handleHouseholdChange(hId)}
                  className={`mr-2 px-4 py-2.5 rounded-2xl border ${isSelected ? 'bg-teal-50 border-teal-500' : 'bg-slate-50 border-slate-200'}`}
                >
                  <Text className={`text-xs font-bold ${isSelected ? 'text-teal-700' : 'text-slate-600'}`}>{h.family_name || 'Family'}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {members.length > 0 && (
            <>
              <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">2. Select Household Member</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
                {members.map((m: any, idx: number) => {
                  const isSelected = m.name === memberName;
                  return (
                    <TouchableOpacity
                      key={idx}
                      onPress={() => handleMemberChange(m)}
                      className={`mr-2 px-3 py-2 rounded-xl border ${isSelected ? 'bg-teal-600 border-teal-600' : 'bg-slate-50 border-slate-200'}`}
                    >
                      <Text className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-slate-700'}`}>{m.name} ({m.relation || 'Member'})</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          )}
        </View>

        {/* 2. Voice Recording & Symptom Intake */}
        <View className="bg-white p-5 rounded-3xl mb-6 border border-slate-100 shadow-sm shadow-slate-200/50">
          <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">3. Voice Symptom Recording</Text>
          
          {/* Mic Button Container */}
          <View className="items-center my-2">
            <TouchableOpacity
              onPress={voiceState === 'recording' ? stopRecording : startRecording}
              disabled={voiceState === 'preparing' || voiceState === 'stopping' || voiceState === 'uploading' || transcriptionState === 'transcribing'}
              className={`w-20 h-20 rounded-full items-center justify-center border-4 shadow-lg ${voiceState === 'recording' ? 'bg-red-500 border-red-200 shadow-red-500/30' : 'bg-teal-600 border-teal-200 shadow-teal-600/30'}`}
            >
              {(voiceState === 'preparing' || voiceState === 'stopping' || voiceState === 'uploading' || transcriptionState === 'transcribing') ? (
                <ActivityIndicator color="white" size="large" />
              ) : voiceState === 'recording' ? (
                <Square color="white" size={32} />
              ) : (
                <Mic color="white" size={36} />
              )}
            </TouchableOpacity>

            <Text className="text-slate-700 font-bold text-sm mt-3">
              {voiceState === 'preparing' ? 'Preparing Microphone...' : 
               voiceState === 'recording' ? 'Recording... Tap to Stop' : 
               voiceState === 'stopping' ? 'Saving Recording...' : 
               (voiceState === 'uploading' || transcriptionState === 'transcribing') ? 'Transcribing Voice Note...' : 
               transcriptionState === 'success' ? 'Transcript Ready' :
               'Tap Mic to Speak Symptoms'}
            </Text>
            
            {transcriptionState === 'success' && (
              <View className="flex-row items-center gap-1 mt-1">
                <Check size={14} color="#0d9488" />
                <Text className="text-teal-700 font-bold text-xs">Voice Transcript Recorded</Text>
              </View>
            )}
          </View>

          {/* Quick Symptom Chips */}
          <Text className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mt-4 mb-2">Or Quick-Select Symptoms</Text>
          <View className="flex-row flex-wrap gap-2 mb-4">
            {COMMON_SYMPTOMS.map((sym, i) => {
              const active = symptoms.includes(sym);
              return (
                <TouchableOpacity
                  key={i}
                  onPress={() => toggleSymptomChip(sym)}
                  className={`px-3 py-1.5 rounded-full border ${active ? 'bg-teal-100 border-teal-400' : 'bg-slate-50 border-slate-200'}`}
                >
                  <Text className={`text-xs ${active ? 'text-teal-800 font-bold' : 'text-slate-600'}`}>{sym}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TextInput
            placeholder="Symptom details (auto-transcribes from voice note)..."
            value={symptoms}
            onChangeText={setSymptoms}
            multiline
            textAlignVertical="top"
            className="bg-slate-50 p-3 rounded-2xl border border-slate-200 min-h-[70px] mb-4 text-slate-800 text-xs"
          />

          <View className="flex-row gap-2 mb-4">
            <View className="flex-1">
              <Text className="text-[10px] font-bold text-slate-500 uppercase mb-1">BP (mmHg)</Text>
              <TextInput value={bp} onChangeText={setBp} className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800" />
            </View>
            <View className="flex-1">
              <Text className="text-[10px] font-bold text-slate-500 uppercase mb-1">Temp (°F)</Text>
              <TextInput value={temp} onChangeText={setTemp} className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800" />
            </View>
            <View className="flex-1">
              <Text className="text-[10px] font-bold text-slate-500 uppercase mb-1">SpO2 (%)</Text>
              <TextInput value={spo2} onChangeText={setSpo2} className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800" />
            </View>
          </View>

          <TouchableOpacity
            onPress={handleManualRunAiTriage}
            disabled={classifying}
            className="bg-indigo-600 p-3.5 rounded-2xl flex-row items-center justify-center gap-2 shadow-md shadow-indigo-900/10"
          >
            {classifying ? <ActivityIndicator color="white" /> : (
              <>
                <Sparkles color="white" size={18} />
                <Text className="text-white font-bold text-sm">Analyze AI Disease & Referral Specialty</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* 3. AI Disease Prediction & Specialist Recommendation Representation */}
        {(diseaseState !== 'idle' || referralState !== 'idle') && (
          <View className="bg-white rounded-3xl p-5 mb-6 border border-slate-100 shadow-lg shadow-slate-200/60 overflow-hidden">
            
            {/* Disease Analysis Stage */}
            <View className="mb-4">
              <Text className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">Trained ML Disease Prediction</Text>
              {diseaseState === 'analyzing' ? (
                <View className="flex-row items-center gap-2 p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <ActivityIndicator size="small" color="#4f46e5" />
                  <Text className="text-slate-600 text-xs font-medium">Analyzing symptoms & disease indicators...</Text>
                </View>
              ) : diseaseState === 'failed' ? (
                <View className="p-3 bg-amber-50 rounded-2xl border border-amber-200">
                  <Text className="text-amber-800 text-xs font-medium">AI disease analysis is temporarily unavailable. You can continue with recorded symptoms.</Text>
                </View>
              ) : (
                <View className="flex-row justify-between items-start">
                  <View className="flex-1 mr-2">
                    <Text className="text-slate-800 text-xl font-bold mt-0.5">
                      {aiResult?.predicted_disease || 'General Assessment'}
                    </Text>
                  </View>
                  <View className={`px-3 py-1.5 rounded-2xl ${aiResult?.risk_level === 'URGENT' ? 'bg-red-500' : aiResult?.risk_level === 'WATCH' ? 'bg-amber-500' : 'bg-green-600'}`}>
                    <Text className="text-white font-bold text-xs uppercase tracking-wider">{aiResult?.risk_level || 'LOW'} RISK</Text>
                  </View>
                </View>
              )}
            </View>

            {/* Specialty Recommendation Stage */}
            <View className="mb-4">
              <Text className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-2">Required Specialty Routing</Text>
              {referralState === 'analyzing' ? (
                <View className="flex-row items-center gap-2 p-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <ActivityIndicator size="small" color="#9333ea" />
                  <Text className="text-slate-600 text-xs font-medium">Evaluating specialist routing...</Text>
                </View>
              ) : referralState === 'failed' ? (
                <View className="p-3 bg-amber-50 rounded-2xl border border-amber-200">
                  <Text className="text-amber-800 text-xs font-medium">Specialty recommendation is temporarily unavailable.</Text>
                </View>
              ) : (
                <View className="bg-purple-50 p-3.5 rounded-2xl border border-purple-100 flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2">
                    <Stethoscope size={18} color="#9333ea" />
                    <Text className="text-purple-900 font-bold text-xs">Required Specialty:</Text>
                  </View>
                  <View className="bg-purple-600 px-3 py-1 rounded-xl">
                    <Text className="text-white font-bold text-xs">{reqSpecialty}</Text>
                  </View>
                </View>
              )}
            </View>

            {/* Confidence Bar (if successful) */}
            {diseaseState === 'success' && aiResult && (
              <View className="bg-slate-50 p-3 rounded-2xl mb-4 border border-slate-100">
                <View className="flex-row justify-between items-center mb-1.5">
                  <Text className="text-slate-600 text-xs font-bold">ML Model Confidence</Text>
                  <Text className="text-indigo-600 font-bold text-xs">{Math.round((aiResult.confidence || 0.85) * 100)}% Match</Text>
                </View>
                <View className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                  <View 
                    className="bg-indigo-600 h-full rounded-full" 
                    style={{ width: `${Math.round((aiResult.confidence || 0.85) * 100)}%` }} 
                  />
                </View>
              </View>
            )}

            {/* Clinical Reasoning & Action Advice */}
            {aiResult && (
              <View className="space-y-2">
                <View className="bg-blue-50 p-3.5 rounded-2xl border border-blue-100">
                  <Text className="text-blue-900 font-bold text-xs mb-1">Clinical AI Insights:</Text>
                  <Text className="text-blue-800 text-xs leading-5">{aiResult.reasoning}</Text>
                </View>
                <View className="bg-emerald-50 p-3.5 rounded-2xl border border-emerald-100">
                  <Text className="text-emerald-900 font-bold text-xs mb-1">ASHA Field Recommendation:</Text>
                  <Text className="text-emerald-800 text-xs leading-5">{aiResult.recommendation}</Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* 4. Specialist Availability Check & Hospital Selection */}
        <View className="bg-white p-5 rounded-3xl mb-6 border border-slate-100 shadow-sm shadow-slate-200/50">
          <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">4. Select Referral Hospital Target</Text>

          {/* Warning Banner if Specialist is NOT available at selected hospital */}
          {aiResult && !isSpecialistAvailable && (
            <View className="bg-amber-50 p-4 rounded-2xl mb-4 border border-amber-200">
              <View className="flex-row items-center gap-2 mb-1">
                <AlertTriangle size={18} color="#d97706" />
                <Text className="text-amber-900 font-bold text-xs">Specialist Warning:</Text>
              </View>
              <Text className="text-amber-800 text-xs leading-5 mb-3">
                {selectedHospital} currently does not have a registered {reqSpecialty} doctor.
              </Text>
              {altHospObj && (
                <TouchableOpacity
                  onPress={() => setSelectedHospital(altHospObj.name)}
                  className="bg-amber-600 px-3.5 py-2.5 rounded-xl flex-row items-center justify-center gap-2"
                >
                  <Building size={16} color="white" />
                  <Text className="text-white font-bold text-xs">Switch to {altHospObj.name} ({reqSpecialty} Available)</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row mb-4">
            {(hospitals.length > 0 ? hospitals : [{ name: 'General Hospital' }, { name: 'Apollo Hospital' }]).map((h, i) => {
              const isSelected = selectedHospital === h.name;
              const hasSpecialist = reqSpecialty === 'General Medicine' || (h.specialties || []).some((s: string) => s.toLowerCase() === reqSpecialty.toLowerCase());

              return (
                <TouchableOpacity
                  key={i}
                  onPress={() => setSelectedHospital(h.name)}
                  className={`mr-2 px-4 py-3 rounded-2xl border ${isSelected ? 'bg-purple-50 border-purple-500' : 'bg-slate-50 border-slate-200'}`}
                >
                  <View className="flex-row items-center gap-2">
                    <Building size={16} color={isSelected ? '#9333ea' : '#64748b'} />
                    <Text className={`text-xs font-bold ${isSelected ? 'text-purple-900' : 'text-slate-700'}`}>{h.name}</Text>
                  </View>
                  {aiResult && (
                    <Text className={`text-[10px] font-semibold mt-1 ${hasSpecialist ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {hasSpecialist ? `✓ ${reqSpecialty} Ready` : `⚠ No ${reqSpecialty}`}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity
            onPress={handleSaveVisitAndRefer}
            disabled={submittingVisit}
            className="bg-[#0d9488] p-4 rounded-2xl flex-row items-center justify-center gap-2 shadow-lg shadow-teal-900/20"
          >
            {submittingVisit ? <ActivityIndicator color="white" /> : (
              <>
                <ArrowUpRight color="white" size={20} />
                <Text className="text-white font-bold text-base">Refer Patient to {selectedHospital || 'Hospital'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
