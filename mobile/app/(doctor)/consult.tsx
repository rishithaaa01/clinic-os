import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../src/services/api';
import { useAuthStore } from '../../src/store/authStore';
import { ChevronLeft, CheckCircle, Save, Plus, X, Mic, AlertTriangle, Pill, FlaskConical, Navigation, Sparkles } from 'lucide-react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { useVoiceRecorder } from '../../src/hooks/useVoiceRecorder';

const frequencies = [
  { id: '1-0-0', label: 'Morning Only (1-0-0)' },
  { id: '0-0-1', label: 'Night Only (0-0-1)' },
  { id: '1-0-1', label: 'Twice a day (1-0-1)' },
  { id: '1-1-1', label: 'Thrice a day (1-1-1)' },
  { id: 'SOS', label: 'As needed (SOS)' }
];

const LAB_TESTS = [
  'Complete Blood Count (CBC)', 'Blood Glucose (Fasting)', 'Blood Glucose (Post-Prandial)',
  'HbA1c', 'Liver Function Test (LFT)', 'Kidney Function Test (KFT)', 'Serum Creatinine',
  'Urine Routine & Microscopy', 'Blood Urea Nitrogen (BUN)', 'Thyroid Stimulating Hormone (TSH)',
  'Lipid Profile', 'Total Cholesterol', 'HDL Cholesterol', 'LDL Cholesterol', 'Triglycerides',
  'Chest X-Ray', 'ECG / EKG', 'Echocardiogram', 'Ultrasound Abdomen', 'CT Scan Abdomen',
  'MRI Brain', 'Sputum Culture & Sensitivity', 'Blood Culture & Sensitivity',
  'Urine Culture & Sensitivity', 'Stool Routine Examination', 'Dengue NS1 Antigen',
  'Malaria Antigen Test', 'COVID-19 RT-PCR', 'Hepatitis B Surface Antigen (HBsAg)',
  'Anti-HCV Antibody', 'HIV 1 & 2 Antibody', 'VDRL / RPR (Syphilis)',
  'Widal Test', 'CRP (C-Reactive Protein)', 'ESR (Erythrocyte Sedimentation Rate)',
  'Serum Electrolytes (Na, K, Cl)', 'Serum Calcium', 'Serum Uric Acid',
  'Serum Albumin', 'Serum Bilirubin (Total & Direct)', 'PT / INR (Coagulation)',
  'APTT', 'Platelet Count', 'Peripheral Blood Smear', 'Reticulocyte Count',
  'Iron Studies (Serum Iron, TIBC, Ferritin)', 'Vitamin B12', 'Vitamin D (25-OH)',
  'Folate / Folic Acid', 'Prolactin', 'FSH', 'LH', 'Testosterone', 'Estradiol',
  'Pregnancy Test (Beta-hCG)', 'Pap Smear', 'Semen Analysis',
  'Pulmonary Function Test (PFT)', 'Spirometry', 'Peak Flow Meter',
  'Fasting Insulin', 'C-Peptide', 'OGTT (Oral Glucose Tolerance Test)',
  'ANA (Antinuclear Antibody)', 'Rheumatoid Factor (RF)', 'Anti-CCP Antibody',
  'Troponin I / T', 'CK-MB', 'BNP / NT-proBNP', 'D-Dimer',
];

export default function ConsultationScreen() {
  const { encounterId } = useLocalSearchParams();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'notes' | 'rx' | 'labs' | 'refer'>('notes');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Notes State
  const [symptoms, setSymptoms] = useState('');
  const [findings, setFindings] = useState('');
  const [diagnosisInput, setDiagnosisInput] = useState('');
  const [diagnoses, setDiagnoses] = useState<string[]>([]);
  
  // Rx State
  const [medicines, setMedicines] = useState<any[]>([]);
  
  // Lab State
  const [labInput, setLabInput] = useState('');
  const [labSuggestions, setLabSuggestions] = useState<string[]>([]);
  const [labOrders, setLabOrders] = useState<any[]>([]);
  const [labUrgency, setLabUrgency] = useState('routine');
  const [labNotes, setLabNotes] = useState('');

  const handleLabInputChange = (text: string) => {
    setLabInput(text);
    if (text.length >= 2) {
      const q = text.toLowerCase();
      setLabSuggestions(LAB_TESTS.filter(t => t.toLowerCase().includes(q)).slice(0, 6));
    } else {
      setLabSuggestions([]);
    }
  };

  const selectLabSuggestion = (test: string) => {
    setLabInput(test);
    setLabSuggestions([]);
  };

  // Refer State
  const [referHospital, setReferHospital] = useState('');
  const [aiInsights, setAiInsights] = useState<any>(null);
  const [editableTranscript, setEditableTranscript] = useState<string>('');
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [referSpeciality, setReferSpeciality] = useState('');
  const [referReason, setReferReason] = useState('');

  // Voice recording upload handler passed to hook
  const uploadRecording = async (uri: string) => {
    try {
      if (!uri) return;
      const token = useAuthStore.getState().token;
      const API_URL = api.defaults.baseURL;
      
      const response = await FileSystem.uploadAsync(
        `${API_URL}/clinician/voice-note?visit_id=${encounterId}`,
        uri,
        {
          fieldName: 'file',
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          headers: {
            Authorization: `Bearer ${token}`,
            'x-client-type': 'mobile'
          }
        }
      );
      
      if (response.status >= 400) {
        throw new Error(response.body);
      }
      
      const d = JSON.parse(response.body);
      
      // Map AI response intelligently into the right clinical fields
      if (d.chief_complaint && d.chief_complaint !== 'Not recorded' && d.chief_complaint !== 'Not recorded due to transcription error') {
        setSymptoms(d.chief_complaint);
      }
      if (d.examination_findings && d.examination_findings !== 'Not recorded') {
        setFindings(d.examination_findings);
      }
      if (d.diagnosis && d.diagnosis.length > 0) {
        setDiagnoses(prev => {
          const existing = new Set(prev);
          d.diagnosis.forEach((dx: string) => existing.add(dx));
          return Array.from(existing);
        });
      }
      if (d.transcript) {
        setEditableTranscript(d.transcript);
      }
      setAiInsights(d);
    } catch (e: any) {
      console.error('Voice note processing error:', e);
      Alert.alert('Processing Error', "We couldn't process the voice note. Please try again.");
    }
  };

  const {
    state: voiceState,
    duration: voiceDuration,
    startRecording,
    stopRecording,
  } = useVoiceRecorder({
    onRecordingComplete: uploadRecording,
  });

  const [visitData, setVisitData] = useState<any>(null);

  useEffect(() => {
    if (encounterId) fetchVisit();
  }, [encounterId]);

  const fetchVisit = async () => {
    try {
      setLoading(true);
      const res = await api.get(`/clinician/visits/${encounterId}`);
      setVisitData(res.data);
      if (res.data.chief_complaint) setSymptoms(res.data.chief_complaint);
      if (res.data.notes) setFindings(res.data.notes);
      if (res.data.diagnosis) setDiagnoses(res.data.diagnosis);
      if (res.data.prescriptions) setMedicines(res.data.prescriptions);
      if (res.data.lab_orders) setLabOrders(res.data.lab_orders);
    } catch (err) {
      console.log('Failed to fetch visit', err);
    } finally {
      setLoading(false);
    }
  };

  // -- Notes Handlers
  const addDiagnosis = () => {
    if (diagnosisInput.trim()) {
      setDiagnoses([...diagnoses, diagnosisInput.trim()]);
      setDiagnosisInput('');
    }
  };

  // -- Rx Handlers
  const addMedicine = () => {
    setMedicines([...medicines, { 
      id: Date.now().toString(), 
      name: '', 
      dosage: '', 
      frequency: '1-0-1', 
      duration: '', 
      instructions: '' 
    }]);
  };
  const updateMedicine = (id: string, field: string, value: string) => {
    setMedicines(medicines.map(m => m.id === id ? { ...m, [field]: value } : m));
  };
  const removeMedicine = (id: string) => {
    setMedicines(medicines.filter(m => m.id !== id));
  };
  const savePrescription = async () => {
    const validMeds = medicines
      .filter(m => (m.name || m.medicine || '').trim() !== '')
      .map(m => {
        const medName = (m.name || m.medicine || '').trim();
        return {
          medicine: medName,
          name: medName,
          dosage: m.dosage || '',
          frequency: m.frequency || '1-0-1',
          duration: m.duration || '',
          instructions: m.instructions || ''
        };
      });

    if (validMeds.length === 0) {
      return Alert.alert('Add Medicine', 'Please add at least one medicine with a name before saving.');
    }

    setSaving(true);
    try {
      try {
        await api.post(`/clinician/visits/${encounterId}/prescribe`, { medicines: validMeds });
      } catch (firstErr) {
        // Fallback to /clinician/prescriptions endpoint
        await api.post('/clinician/prescriptions', {
          visit_id: String(encounterId),
          patient_id: visitData?.patient_id ? String(visitData.patient_id) : undefined,
          medicines: validMeds
        });
      }
      Alert.alert('Success', 'Prescriptions saved!');
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : 'Failed to save prescriptions';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  // -- Lab Handlers
  const addLabOrder = () => {
    if (labInput.trim()) {
      setLabOrders([...labOrders, {
        test_name: labInput.trim(),
        urgency: labUrgency,
        notes: labNotes
      }]);
      setLabInput('');
      setLabNotes('');
    }
  };
  const saveLabs = async () => {
    if (labOrders.length === 0) return Alert.alert('Error', 'Add at least one lab test');
    if (!visitData?.patient_id) return Alert.alert('Error', 'Patient data not loaded yet. Please wait a moment.');
    setSaving(true);
    try {
      const tests = labOrders.map((o: any) => o.test_name);
      const notes = labOrders.map((o: any) => o.notes).filter(Boolean).join('; ') || undefined;
      const urgency = labOrders.find((o: any) => o.urgency === 'emergency')?.urgency
        || labOrders.find((o: any) => o.urgency === 'urgent')?.urgency
        || 'routine';

      await api.post('/clinician/lab-orders', {
        visit_id: encounterId,
        patient_id: visitData.patient_id,
        tests,
        urgency,
        notes,
      });
      Alert.alert('Success', `${tests.length} lab test(s) ordered! The lab technician has been notified.`);
      setLabOrders([]);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail
        : Array.isArray(detail) ? detail.map((e: any) => e.msg || JSON.stringify(e)).join(', ')
        : err?.message || 'Unknown error';
      Alert.alert('Error', `Failed to save lab orders: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  // -- Refer Handlers
  const saveReferral = async () => {
    if (!referHospital || !referSpeciality) return Alert.alert('Error', 'Hospital and Speciality required');
    setSaving(true);
    try {
      try {
        await api.post(`/clinician/visits/${encounterId}/refer`, {
          target_hospital: referHospital,
          target_speciality: referSpeciality,
          reason: referReason
        });
      } catch (firstErr) {
        await api.post('/clinician/referrals', {
          visit_id: String(encounterId),
          patient_id: visitData?.patient_id || undefined,
          to_hospital_id: referHospital,
          target_hospital: referHospital,
          to_speciality: referSpeciality,
          target_speciality: referSpeciality,
          reason: referReason || 'Clinical referral requested.',
          urgency: 'routine',
          summary: referReason || 'Clinical referral requested.'
        });
      }
      Alert.alert('Success', 'Patient referred successfully!');
      router.back();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : 'Failed to submit referral';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    try {
      setSaving(true);
      const effectiveDiagnoses = (diagnoses && diagnoses.length > 0) ? diagnoses : [symptoms || 'General Clinical Evaluation'];
      // PATCH (not PUT) is the correct method for the update endpoint
      await api.patch(`/clinician/visits/${encounterId}`, {
        diagnosis: effectiveDiagnoses,
        notes: findings,
        chief_complaint: symptoms,
        examination_findings: findings,
      });
      await api.post(`/clinician/visits/${encounterId}/complete`);
      Alert.alert('Success', 'Consultation marked as complete');
      router.back();
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || 'Unknown error';
      Alert.alert('Error', `Failed to complete consultation: ${detail}`);
    } finally {
      setSaving(false);
    }
  };

  const reprocessTranscript = async () => {
    if (!editableTranscript.trim()) return Alert.alert('Error', 'Transcript text is required.');
    try {
      setIsReprocessing(true);
      const response = await api.post('/clinician/process-transcript', {
        transcription: editableTranscript
      });
      const d = response.data;
      if (d.chief_complaint && d.chief_complaint !== 'Not recorded') setSymptoms(d.chief_complaint);
      if (d.examination_findings && d.examination_findings !== 'Not recorded') setFindings(d.examination_findings);
      if (d.diagnosis && d.diagnosis.length > 0) {
        setDiagnoses(prev => Array.from(new Set([...prev, ...d.diagnosis])));
      }
      setAiInsights(d);
      Alert.alert('Success', 'AI Clinical Analysis updated with verified transcript.');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to reprocess transcript.');
    } finally {
      setIsReprocessing(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-[#F7F3EE]">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        
        {/* Header */}
        <View className="flex-row items-center justify-between p-4 bg-white border-b border-slate-200 shadow-sm">
          <TouchableOpacity onPress={() => router.back()} className="p-2">
            <ChevronLeft size={24} color="#1B6CA8" />
          </TouchableOpacity>
          <View className="items-center">
            <Text className="text-lg font-bold text-gray-800">Consultation</Text>
            {visitData && <Text className="text-xs text-gray-500">{visitData.patient_name}</Text>}
          </View>
          <TouchableOpacity 
            disabled={voiceState === 'preparing' || voiceState === 'stopping' || voiceState === 'uploading'}
            onPress={voiceState === 'recording' ? stopRecording : startRecording} 
            className={`p-2 rounded-full border ${voiceState === 'recording' ? 'bg-red-50 border-red-200' : (voiceState === 'uploading' || voiceState === 'preparing' || voiceState === 'stopping') ? 'bg-amber-50 border-amber-200' : 'bg-amber-50 border-amber-200'}`}
          >
            {(voiceState === 'uploading' || voiceState === 'preparing' || voiceState === 'stopping')
              ? <ActivityIndicator size="small" color="#d97706" />
              : <Mic size={20} color={voiceState === 'recording' ? '#FF0000' : '#d97706'} />}
          </TouchableOpacity>
        </View>

        {/* Tabs */}
        <View className="flex-row bg-white border-b border-gray-200">
          <TouchableOpacity onPress={() => setActiveTab('notes')} className={`flex-1 py-3 items-center border-b-2 ${activeTab === 'notes' ? 'border-[#1B6CA8]' : 'border-transparent'}`}>
            <Text className={`font-semibold text-xs ${activeTab === 'notes' ? 'text-[#1B6CA8]' : 'text-gray-500'}`}>NOTES</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setActiveTab('rx')} className={`flex-1 py-3 items-center border-b-2 ${activeTab === 'rx' ? 'border-[#1B6CA8]' : 'border-transparent'}`}>
            <Text className={`font-semibold text-xs ${activeTab === 'rx' ? 'text-[#1B6CA8]' : 'text-gray-500'}`}>RX</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setActiveTab('labs')} className={`flex-1 py-3 items-center border-b-2 ${activeTab === 'labs' ? 'border-[#1B6CA8]' : 'border-transparent'}`}>
            <Text className={`font-semibold text-xs ${activeTab === 'labs' ? 'text-[#1B6CA8]' : 'text-gray-500'}`}>LABS</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setActiveTab('refer')} className={`flex-1 py-3 items-center border-b-2 ${activeTab === 'refer' ? 'border-[#1B6CA8]' : 'border-transparent'}`}>
            <Text className={`font-semibold text-xs ${activeTab === 'refer' ? 'text-[#1B6CA8]' : 'text-gray-500'}`}>REFER</Text>
          </TouchableOpacity>
        </View>

        {loading && !visitData ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#1B6CA8" />
          </View>
        ) : (
          <ScrollView className="flex-1 p-4" showsVerticalScrollIndicator={false}>
            
            {/* NOTES TAB */}
            {activeTab === 'notes' && (
              <View className="space-y-4 mb-10">

                {/* Recording / Uploading status with Stage Progress */}
                {voiceState === 'preparing' && (
                  <View className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex-row items-center">
                    <ActivityIndicator size="small" color="#d97706" style={{ marginRight: 10 }} />
                    <Text className="text-amber-700 text-sm font-semibold flex-1">Preparing microphone... Please wait a moment</Text>
                  </View>
                )}
                {voiceState === 'recording' && (
                  <View className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex-row items-center">
                    <View className="w-3 h-3 bg-red-500 rounded-full mr-3" />
                    <Text className="text-red-700 text-sm font-semibold flex-1">Recording clinical voice note ({String(Math.floor(voiceDuration / 60)).padStart(2, '0')}:{String(voiceDuration % 60).padStart(2, '0')})... Tap mic icon to stop</Text>
                  </View>
                )}
                {voiceState === 'stopping' && (
                  <View className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex-row items-center">
                    <ActivityIndicator size="small" color="#d97706" style={{ marginRight: 10 }} />
                    <Text className="text-amber-700 text-sm font-semibold flex-1">Saving recording...</Text>
                  </View>
                )}
                {voiceState === 'uploading' && (
                  <View className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                    <View className="flex-row items-center mb-2">
                      <ActivityIndicator size="small" color="#d97706" style={{ marginRight: 10 }} />
                      <Text className="text-amber-800 font-bold text-sm">Processing AI Clinical Analysis...</Text>
                    </View>
                    <View className="space-y-1 pl-6">
                      <Text className="text-amber-700 text-xs font-medium">1. Transcribing clinical audio recording...</Text>
                      <Text className="text-amber-700 text-xs font-medium">2. Analyzing symptoms & specialty assessment...</Text>
                      <Text className="text-amber-700 text-xs font-medium">3. Generating clinical decision support...</Text>
                    </View>
                  </View>
                )}

                {/* Professional AI Decision-Support Result Cards */}
                {aiInsights && (
                  <View className="bg-slate-900 rounded-2xl p-4 border border-slate-800 shadow-xl mb-4">
                    {/* Header */}
                    <View className="flex-row items-center justify-between pb-3 border-b border-slate-800 mb-3">
                      <View className="flex-row items-center">
                        <View className="w-8 h-8 bg-teal-500/20 rounded-xl items-center justify-center mr-2.5 border border-teal-500/30">
                          <Sparkles size={16} color="#14b8a6" />
                        </View>
                        <View>
                          <Text className="text-white font-bold text-base">AI Clinical Decision Support</Text>
                          <Text className="text-slate-400 text-[10px]">Automated Clinical Insights & Suggestions</Text>
                        </View>
                      </View>
                      <TouchableOpacity onPress={() => setAiInsights(null)} className="p-1.5 bg-slate-800 rounded-lg">
                        <X size={16} color="#94a3b8" />
                      </TouchableOpacity>
                    </View>

                    {/* Medical Safety Disclaimer */}
                    <View className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-3.5 flex-row items-start">
                      <AlertTriangle size={15} color="#f59e0b" style={{ marginTop: 2, marginRight: 8 }} />
                      <Text className="text-amber-200 text-xs leading-4 flex-1 font-medium">
                        AI-assisted clinical decision support. Final diagnosis and treatment decisions must be made by a qualified clinician.
                      </Text>
                    </View>

                    {/* 2. Clinical Observations */}
                    {aiInsights.examination_findings && aiInsights.examination_findings !== 'Not recorded' && (
                      <View className="bg-slate-800/80 rounded-xl p-3 mb-2.5 border border-slate-700/50">
                        <Text className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">📋 Extracted Clinical Findings</Text>
                        <Text className="text-slate-200 text-xs leading-5">{aiInsights.examination_findings}</Text>
                      </View>
                    )}

                    {/* 3. Trained Disease Model Prediction */}
                    {aiInsights.predicted_condition && (
                      <View className="bg-teal-950/40 border border-teal-500/30 rounded-xl p-3 mb-2.5">
                        <View className="flex-row items-center justify-between mb-1">
                          <Text className="text-teal-300 text-[10px] font-bold uppercase tracking-wider">🤖 AI-Assisted Prediction</Text>
                          <View className="bg-teal-500/20 px-2 py-0.5 rounded-full border border-teal-500/30">
                            <Text className="text-teal-300 text-[10px] font-bold">
                              Confidence: {aiInsights.disease_confidence ? (aiInsights.disease_confidence * 100).toFixed(0) : '75'}%
                            </Text>
                          </View>
                        </View>
                        <Text className="text-white font-bold text-sm mb-1">{aiInsights.predicted_condition}</Text>
                        <Text className="text-teal-200/70 text-[10px] italic">Requires clinical verification prior to confirming diagnosis.</Text>
                      </View>
                    )}

                    {/* 4. Attention / Risk Level & Recommended Specialty Grid */}
                    <View className="flex-row space-x-2 mb-2.5">
                      {/* Risk Level */}
                      <View className="flex-1 bg-slate-800/80 rounded-xl p-3 border border-slate-700/50 mr-1">
                        <Text className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">Attention Level</Text>
                        <View className="flex-row items-center">
                          <View className={`w-2.5 h-2.5 rounded-full mr-1.5 ${
                            aiInsights.risk_indicators?.includes('Urgent') ? 'bg-red-500' :
                            aiInsights.risk_indicators?.includes('Needs') ? 'bg-amber-500' : 'bg-emerald-500'
                          }`} />
                          <Text className="text-white font-bold text-xs">{aiInsights.risk_indicators || 'Routine'}</Text>
                        </View>
                      </View>

                      {/* Recommended Specialty */}
                      {aiInsights.recommended_specialty && (
                        <View className="flex-1 bg-slate-800/80 rounded-xl p-3 border border-slate-700/50 ml-1">
                          <Text className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">Recommended Specialty</Text>
                          <Text className="text-white font-bold text-xs">{aiInsights.recommended_specialty}</Text>
                          {aiInsights.referral_confidence > 0 && (
                            <Text className="text-slate-400 text-[9px] mt-0.5">Confidence: {(aiInsights.referral_confidence * 100).toFixed(0)}%</Text>
                          )}
                        </View>
                      )}
                    </View>

                    {/* 5. Clinical Insights & Next Steps */}
                    {aiInsights.clinical_insights && (
                      <View className="bg-slate-800/80 rounded-xl p-3 mb-2.5 border border-slate-700/50">
                        <Text className="text-indigo-300 text-[10px] font-bold uppercase tracking-wider mb-1">💡 Clinical Insights</Text>
                        <Text className="text-slate-200 text-xs leading-5">{aiInsights.clinical_insights}</Text>
                      </View>
                    )}

                    {aiInsights.plan && aiInsights.plan !== 'Not recorded' && (
                      <View className="bg-slate-800/80 rounded-xl p-3 border border-slate-700/50">
                        <Text className="text-emerald-400 text-[10px] font-bold uppercase tracking-wider mb-1">🎯 Suggested Follow-up Actions</Text>
                        <Text className="text-slate-200 text-xs leading-5">{aiInsights.plan}</Text>
                      </View>
                    )}

                    <Text className="text-slate-500 text-[9px] mt-2.5 text-center">Consultation fields above auto-populated for clinical review ↑</Text>
                  </View>
                )}

                {/* Doctor Transcript Review & Edit Card */}
                {editableTranscript !== '' && (
                  <View className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200">
                    <View className="flex-row items-center justify-between mb-2">
                      <Text className="text-slate-700 text-xs font-bold uppercase tracking-wider">
                        🗣️ Dictated Transcript Review
                      </Text>
                      <TouchableOpacity onPress={() => setEditableTranscript('')}>
                        <Text className="text-slate-400 text-xs font-semibold">Clear</Text>
                      </TouchableOpacity>
                    </View>
                    <Text className="text-slate-500 text-xs mb-2">
                      Review and correct any mis-transcribed medical terminology before AI clinical analysis:
                    </Text>
                    <TextInput
                      className="bg-slate-50 p-3 rounded-xl text-slate-800 text-sm min-h-[80px] border border-slate-200"
                      multiline
                      textAlignVertical="top"
                      value={editableTranscript}
                      onChangeText={setEditableTranscript}
                    />
                    <TouchableOpacity
                      onPress={reprocessTranscript}
                      disabled={isReprocessing}
                      className="bg-[#1B6CA8] rounded-xl py-2.5 px-4 mt-3 flex-row items-center justify-center"
                    >
                      {isReprocessing ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <Text className="text-white font-bold text-xs">
                          ⚡ Re-analyze AI with Verified Transcript
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                <View className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
                  <Text className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Chief Complaint</Text>
                  <TextInput
                    className="bg-slate-50 p-4 rounded-xl text-slate-800 min-h-[100px]"
                    multiline
                    textAlignVertical="top"
                    placeholder="Patient symptoms..."
                    value={symptoms}
                    onChangeText={setSymptoms}
                  />
                </View>

                <View className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
                  <Text className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Clinical Findings</Text>
                  <TextInput
                    className="bg-slate-50 p-4 rounded-xl text-slate-800 min-h-[100px]"
                    multiline
                    textAlignVertical="top"
                    placeholder="Examination findings..."
                    value={findings}
                    onChangeText={setFindings}
                  />
                </View>

                <View className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
                  <Text className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Provisional Diagnosis</Text>
                  <View className="flex-row flex-wrap mb-3">
                    {diagnoses.map((d, idx) => (
                      <View key={idx} className="bg-blue-50 flex-row items-center rounded-full px-3 py-1 mr-2 mb-2 border border-blue-100">
                        <Text className="text-[#1B6CA8] font-bold text-xs mr-2">{d}</Text>
                        <TouchableOpacity onPress={() => setDiagnoses(diagnoses.filter((_, i) => i !== idx))}>
                          <X size={14} color="#1B6CA8" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                  <View className="flex-row items-center">
                    <TextInput
                      className="flex-1 bg-slate-50 p-3 rounded-xl text-slate-800 mr-2 border border-slate-200"
                      placeholder="Add diagnosis..."
                      value={diagnosisInput}
                      onChangeText={setDiagnosisInput}
                      onSubmitEditing={addDiagnosis}
                    />
                    <TouchableOpacity className="bg-[#1B6CA8] px-4 py-3 rounded-xl" onPress={addDiagnosis}>
                      <Text className="font-bold text-white">Add</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity 
                  className="bg-green-600 p-4 rounded-xl flex-row items-center justify-center shadow-lg mt-4"
                  onPress={handleComplete}
                  disabled={saving}
                >
                  {saving ? <ActivityIndicator color="white" /> : (
                    <>
                      <CheckCircle color="white" size={20} className="mr-2" />
                      <Text className="text-white font-bold text-lg">Complete Consultation</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* RX TAB */}
            {activeTab === 'rx' && (
              <View className="mb-10">
                {medicines.map((med, idx) => (
                  <View key={med.id} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mb-4">
                    <View className="flex-row justify-between items-center mb-4">
                      <View className="flex-row items-center">
                        <View className="bg-blue-50 w-6 h-6 rounded-full items-center justify-center mr-2">
                          <Text className="text-[#1B6CA8] font-bold text-xs">{idx + 1}</Text>
                        </View>
                        <Text className="font-bold text-slate-800">Medicine Entry</Text>
                      </View>
                      <TouchableOpacity onPress={() => removeMedicine(med.id)}>
                        <X size={20} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                    
                    <TextInput
                      placeholder="Medicine Name (e.g. Paracetamol 500mg)"
                      value={med.name}
                      onChangeText={(t) => updateMedicine(med.id, 'name', t)}
                      className="bg-slate-50 p-3 rounded-xl border border-slate-200 mb-2 font-semibold text-slate-800"
                    />
                    <View className="flex-row gap-2 mb-2">
                      <TextInput
                        placeholder="Dosage"
                        value={med.dosage}
                        onChangeText={(t) => updateMedicine(med.id, 'dosage', t)}
                        className="flex-1 bg-slate-50 p-3 rounded-xl border border-slate-200 text-slate-800"
                      />
                      <TextInput
                        placeholder="Duration"
                        value={med.duration}
                        onChangeText={(t) => updateMedicine(med.id, 'duration', t)}
                        className="flex-1 bg-slate-50 p-3 rounded-xl border border-slate-200 text-slate-800"
                      />
                    </View>
                    <TextInput
                      placeholder="Instructions (e.g. After food)"
                      value={med.instructions}
                      onChangeText={(t) => updateMedicine(med.id, 'instructions', t)}
                      className="bg-slate-50 p-3 rounded-xl border border-slate-200 mb-2 text-slate-800"
                    />
                  </View>
                ))}

                <TouchableOpacity 
                  onPress={addMedicine}
                  className="border-2 border-dashed border-[#1B6CA8] p-4 rounded-xl items-center flex-row justify-center mb-6 bg-blue-50"
                >
                  <Plus size={20} color="#1B6CA8" className="mr-2" />
                  <Text className="text-[#1B6CA8] font-bold">Add Medicine</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  className="bg-[#1B6CA8] p-4 rounded-xl flex-row items-center justify-center shadow-lg"
                  onPress={savePrescription}
                  disabled={saving}
                >
                  {saving ? <ActivityIndicator color="white" /> : (
                    <>
                      <Save color="white" size={20} className="mr-2" />
                      <Text className="text-white font-bold text-lg">Save Prescriptions</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* LABS TAB */}
            {activeTab === 'labs' && (
              <View className="mb-10">
                <View className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mb-6">
                  <Text className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-3">Order Lab Test</Text>
                  <View className="relative">
                    <TextInput
                      placeholder="Type test name (e.g. CBC, HbA1c...)"
                      value={labInput}
                      onChangeText={handleLabInputChange}
                      className="bg-slate-50 p-3 rounded-xl border border-slate-200 mb-1 text-slate-800 font-semibold"
                    />
                    {labSuggestions.length > 0 && (
                      <View className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-2 shadow-md">
                        {labSuggestions.map((s, i) => (
                          <TouchableOpacity
                            key={i}
                            onPress={() => selectLabSuggestion(s)}
                            className={`px-4 py-3 ${i < labSuggestions.length - 1 ? 'border-b border-slate-100' : ''}`}
                          >
                            <Text className="text-slate-700 text-sm">
                              <Text className="text-[#1B6CA8] font-bold">{s.substring(0, s.toLowerCase().indexOf(labInput.toLowerCase()))}</Text>
                              <Text className="font-bold text-[#1B6CA8]">{s.substring(s.toLowerCase().indexOf(labInput.toLowerCase()), s.toLowerCase().indexOf(labInput.toLowerCase()) + labInput.length)}</Text>
                              <Text className="text-slate-600">{s.substring(s.toLowerCase().indexOf(labInput.toLowerCase()) + labInput.length)}</Text>
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                  <View className="flex-row gap-2 mb-3">
                    <TouchableOpacity onPress={() => setLabUrgency('routine')} className={`flex-1 p-2 rounded-lg items-center border ${labUrgency === 'routine' ? 'bg-blue-50 border-blue-400' : 'bg-white border-slate-200'}`}>
                      <Text className={`text-xs font-bold ${labUrgency === 'routine' ? 'text-blue-700' : 'text-slate-500'}`}>Routine</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setLabUrgency('urgent')} className={`flex-1 p-2 rounded-lg items-center border ${labUrgency === 'urgent' ? 'bg-amber-50 border-amber-400' : 'bg-white border-slate-200'}`}>
                      <Text className={`text-xs font-bold ${labUrgency === 'urgent' ? 'text-amber-700' : 'text-slate-500'}`}>Urgent</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setLabUrgency('emergency')} className={`flex-1 p-2 rounded-lg items-center border ${labUrgency === 'emergency' ? 'bg-red-50 border-red-400' : 'bg-white border-slate-200'}`}>
                      <Text className={`text-xs font-bold ${labUrgency === 'emergency' ? 'text-red-700' : 'text-slate-500'}`}>Emergency</Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    placeholder="Clinical Notes for Lab (optional)"
                    value={labNotes}
                    onChangeText={setLabNotes}
                    className="bg-slate-50 p-3 rounded-xl border border-slate-200 mb-3 text-slate-800"
                  />
                  <TouchableOpacity onPress={addLabOrder} className="bg-teal-600 p-3 rounded-xl items-center">
                    <Text className="text-white font-bold text-sm">Add Test to Order</Text>
                  </TouchableOpacity>
                </View>

                {labOrders.length > 0 && (
                  <View className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mb-6">
                    <Text className="text-slate-800 font-bold mb-3">Selected Tests</Text>
                    {labOrders.map((order, idx) => (
                      <View key={idx} className="flex-row justify-between items-center bg-slate-50 p-3 rounded-xl mb-2 border border-slate-100">
                        <View className="flex-1">
                          <View className="flex-row items-center">
                            <Text className="font-bold text-slate-800 mr-2">{order.test_name}</Text>
                            <View className={`px-2 py-0.5 rounded-md ${order.urgency === 'urgent' ? 'bg-amber-100' : order.urgency === 'emergency' ? 'bg-red-100' : 'bg-blue-100'}`}>
                              <Text className={`text-[10px] font-bold uppercase ${order.urgency === 'urgent' ? 'text-amber-700' : order.urgency === 'emergency' ? 'text-red-700' : 'text-blue-700'}`}>{order.urgency}</Text>
                            </View>
                          </View>
                          {order.notes && <Text className="text-xs text-slate-500 mt-1">{order.notes}</Text>}
                        </View>
                        <TouchableOpacity onPress={() => setLabOrders(labOrders.filter((_, i) => i !== idx))}>
                          <X size={18} color="#ef4444" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                <TouchableOpacity 
                  className="bg-[#1B6CA8] p-4 rounded-xl flex-row items-center justify-center shadow-lg"
                  onPress={saveLabs}
                  disabled={saving}
                >
                  {saving ? <ActivityIndicator color="white" /> : (
                    <>
                      <FlaskConical color="white" size={20} className="mr-2" />
                      <Text className="text-white font-bold text-lg">Submit Lab Orders</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* REFER TAB */}
            {activeTab === 'refer' && (
              <View className="mb-10">
                <View className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mb-4">
                  <Text className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-4">Refer to Specialist</Text>
                  
                  <Text className="font-bold text-slate-700 text-xs mb-1">Target Hospital *</Text>
                  <TextInput
                    placeholder="e.g. District General Hospital"
                    value={referHospital}
                    onChangeText={setReferHospital}
                    className="bg-slate-50 p-3 rounded-xl border border-slate-200 mb-4 text-slate-800 font-semibold"
                  />

                  <Text className="font-bold text-slate-700 text-xs mb-1">Target Speciality *</Text>
                  <TextInput
                    placeholder="e.g. Cardiology"
                    value={referSpeciality}
                    onChangeText={setReferSpeciality}
                    className="bg-slate-50 p-3 rounded-xl border border-slate-200 mb-4 text-slate-800 font-semibold"
                  />

                  <Text className="font-bold text-slate-700 text-xs mb-1">Reason for Referral *</Text>
                  <TextInput
                    placeholder="Clinical reason..."
                    value={referReason}
                    onChangeText={setReferReason}
                    multiline
                    textAlignVertical="top"
                    className="bg-slate-50 p-3 rounded-xl border border-slate-200 min-h-[100px] mb-4 text-slate-800"
                  />
                </View>

                <TouchableOpacity 
                  className="bg-amber-600 p-4 rounded-xl flex-row items-center justify-center shadow-lg"
                  onPress={saveReferral}
                  disabled={saving}
                >
                  {saving ? <ActivityIndicator color="white" /> : (
                    <>
                      <Navigation color="white" size={20} className="mr-2" />
                      <Text className="text-white font-bold text-lg">Send Referral</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}

          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
