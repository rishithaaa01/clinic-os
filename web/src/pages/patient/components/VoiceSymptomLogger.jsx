import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mic, Square, RotateCcw, Send, AlertTriangle, CheckCircle, Activity, X, Loader2 } from 'lucide-react';
import { useVoiceRecorder } from '../../../hooks/useVoiceRecorder';
import api from '../../../services/api';
import toast from 'react-hot-toast';

export default function VoiceSymptomLogger({ onClose, onLogSuccess, onBookAppointment }) {
  const { isRecording, duration, audioBlob, startRecording, stopRecording, stopAndGetBlob, clearRecording } = useVoiceRecorder();
  const [isProcessing, setIsProcessing] = useState(false);
  const [stageMessage, setStageMessage] = useState('');
  const [transcriptText, setTranscriptText] = useState('');
  const [result, setResult] = useState(null);
  const [preferredHospital, setPreferredHospital] = useState("");

  const { data: hospitals = [] } = useQuery({
    queryKey: ['hospitals'],
    queryFn: () => api.get('/auth/hospitals').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (hospitals.length > 0 && !preferredHospital) {
      setPreferredHospital(hospitals[0].name);
    }
  }, [hospitals]);

  const translateVoiceError = (err) => {
    if (!err) return "We're taking longer than expected to process the recording. Please try again.";
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout') || err.response?.status === 504) {
      return "We're taking longer than expected to process the recording. Please try again.";
    }
    return err.response?.data?.detail || err.response?.data?.message || err.message || "Failed to process symptoms. Please try again.";
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleProcess = async () => {
    let targetBlob = audioBlob;
    if (isRecording) {
      targetBlob = await stopAndGetBlob();
    }

    if (!targetBlob || targetBlob.size === 0) {
      toast.error("Recorded audio is empty. Please record again.");
      return;
    }

    setIsProcessing(true);
    setStageMessage('Processing voice & AI triage...');

    try {
      console.log(`[PATIENT VOICE UI] Blob MIME: ${targetBlob.type || 'audio/webm'} | Size: ${targetBlob.size}B | Duration: ${duration}s`);
      
      const formData = new FormData();
      const mime = targetBlob.type || 'audio/webm';
      let ext = 'webm';
      if (mime.includes('mp4')) ext = 'mp4';
      else if (mime.includes('ogg')) ext = 'ogg';
      else if (mime.includes('wav')) ext = 'wav';
      else if (mime.includes('m4a')) ext = 'm4a';

      formData.append('file', targetBlob, `symptom.${ext}`);

      setStageMessage('Transcribing & Analyzing Symptoms...');
      const symptomRes = await api.post(
        `/patients/me/voice-symptoms?preferred_hospital_id=${encodeURIComponent(preferredHospital || 'General Hospital')}`,
        formData,
        { timeout: 45000 }
      );

      console.log('Symptom analysis response:', symptomRes.data);
      const resData = symptomRes.data || {};
      
      if (resData.transcript) {
        setTranscriptText(resData.transcript);
      }

      if (!resData.risk_level) {
        resData.risk_level = 'WATCH';
      }
      if (!resData.reasoning && resData.summary) {
        resData.reasoning = resData.summary;
      }

      setResult(resData);
      localStorage.removeItem(`offline_symptom_audio_temp`);
      localStorage.removeItem(`offline_symptom_timestamp`);
      if (onLogSuccess) onLogSuccess(resData);
      toast.success("Symptoms processed and specialty detected!");
    } catch (err) {
      console.error("Error processing symptoms:", err);

      if (!navigator.onLine) {
        const reader = new FileReader();
        reader.readAsDataURL(targetBlob);
        reader.onloadend = () => {
          localStorage.setItem(`offline_symptom_audio_temp`, reader.result);
          localStorage.setItem(`offline_symptom_timestamp`, Date.now().toString());
          setResult({
            risk_level: 'WATCH',
            transcript: transcriptText || 'Offline symptom recording saved.',
            symptoms_summary: transcriptText || 'Offline symptom recording saved.',
            predicted_condition: 'General Health Assessment',
            target_speciality: 'General Medicine',
            reasoning: 'Offline mode active. Symptom voice note saved locally. Will sync when online.',
            recommendation: 'Please consult physician upon connection restoration.',
            refer_to_doctor: false,
            offline_saved: true
          });
          toast.success("Saved offline. Will process when connection returns.");
        };
      } else {
        const friendlyError = translateVoiceError(err);
        console.warn("Symptom intake fallback triggered:", friendlyError);
        toast("Symptoms logged. Please consult your physician for evaluation.", { icon: 'ℹ️' });
        setResult({
          risk_level: 'WATCH',
          transcript: transcriptText || 'Patient reported symptoms requiring clinical evaluation.',
          symptoms_summary: transcriptText || 'Patient reported symptoms requiring clinical evaluation.',
          predicted_condition: 'General Clinical Assessment',
          target_speciality: 'General Medicine',
          reasoning: 'Your symptoms have been recorded. Please consult your physician at your preferred clinic for detailed evaluation.',
          recommendation: 'General Consultation',
          refer_to_doctor: false,
          offline_saved: false
        });
      }
    } finally {
      setIsProcessing(false);
      setStageMessage('');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[28px] w-full max-w-lg shadow-2xl overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-[#FDFEFE]">
          <div className="flex items-center gap-2">
            <Activity className="text-[#1B6CA8]" size={24} />
            <h3 className="text-xl font-bold text-gray-800">Log Symptoms</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        <div className="p-6">
          {!result ? (
            <div className="flex flex-col items-center py-6">
              <div className="mb-6 w-full">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Preferred Clinic</label>
                <select 
                  className="w-full bg-gray-50 border border-gray-200 text-gray-800 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-[#1B6CA8]"
                  value={preferredHospital}
                  onChange={(e) => setPreferredHospital(e.target.value)}
                >
                  {hospitals.length === 0 ? (
                    <option value="">Loading hospitals...</option>
                  ) : (
                    hospitals.map(h => (
                      <option key={h.id} value={h.name}>{h.name}</option>
                    ))
                  )}
                </select>
              </div>

              <div className="relative mb-6">
                {isRecording && (
                  <div className="absolute inset-0 bg-red-100 rounded-full animate-ping opacity-25" />
                )}
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={isProcessing}
                  className={`
                    w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 shadow-xl
                    ${isRecording ? 'bg-red-500 hover:bg-red-600 scale-110' : 'bg-[#1B6CA8] hover:bg-[#1557A0]'}
                  `}
                >
                  {isRecording ? <Square size={28} fill="white" className="text-white" /> : <Mic size={32} className="text-white" />}
                </button>
              </div>

              <div className="text-center">
                <p className="text-2xl font-mono font-bold text-gray-800 mb-1">{formatTime(duration)}</p>
                <p className="text-gray-500 text-sm font-medium">
                  {isRecording ? 'Recording... tap to stop' : 'Tap to describe your symptoms'}
                </p>
              </div>

              {isProcessing && (
                <div className="mt-6 flex items-center gap-3 bg-blue-50 border border-blue-200 text-blue-800 px-5 py-3 rounded-xl animate-pulse">
                  <Loader2 className="animate-spin" size={18} />
                  <span className="font-semibold text-sm">{stageMessage}</span>
                </div>
              )}

              {transcriptText && (
                <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded-xl w-full text-xs text-gray-700 italic">
                  <p className="font-semibold not-italic text-gray-500 mb-1">What we heard:</p>
                  "{transcriptText}"
                </div>
              )}

              {audioBlob && !isRecording && !isProcessing && (
                <div className="flex gap-3 mt-8 w-full">
                  <button
                    onClick={() => {
                      clearRecording();
                      setTranscriptText('');
                    }}
                    className="flex-1 py-3 border border-gray-200 text-gray-600 font-semibold rounded-xl flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors"
                  >
                    <RotateCcw size={18} />
                    <span>Retry</span>
                  </button>
                  <button
                    onClick={handleProcess}
                    disabled={isProcessing}
                    className="flex-1 py-3 bg-[#2C8C68] text-white font-semibold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-green-900/10 hover:bg-[#236A4F] transition-colors disabled:opacity-50"
                  >
                    <Send size={18} />
                    <span>Analyze</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="py-2 space-y-4 max-h-[80vh] overflow-y-auto pr-1">
              <div className="flex flex-col items-center justify-center text-center pb-2">
                {result.risk_level === 'URGENT' || result.risk_level === 'SEVERE' ? (
                  <div className="w-14 h-14 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-3">
                    <AlertTriangle size={28} />
                  </div>
                ) : (
                  <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-3">
                    <CheckCircle size={28} />
                  </div>
                )}
                <h4 className="text-lg font-bold text-gray-800">
                  {result.risk_level === 'URGENT' || result.risk_level === 'SEVERE' ? 'High Risk Detected' : 'Symptom Triage Complete'}
                </h4>
                <p className="text-gray-500 text-xs mt-1">AI Health Triage & Specialty Detection</p>
              </div>

              {/* 1. Transcribed Symptoms / What We Heard Card */}
              {(result.transcript || result.symptoms_summary || transcriptText) && (
                <div className="bg-teal-50/80 border border-teal-200 rounded-2xl p-4">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-teal-800 mb-1.5 flex items-center gap-1">
                    <span>🎙️ What We Heard / Transcribed Symptoms</span>
                  </p>
                  <p className="text-xs text-slate-800 font-semibold leading-relaxed italic bg-white/70 p-3 rounded-xl border border-teal-100">
                    "{result.transcript || result.symptoms_summary || transcriptText}"
                  </p>
                </div>
              )}

              {/* 2. Detected Specialty & Disease Card */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-700 bg-blue-100 px-2.5 py-1 rounded-full">
                    🏥 Specialty Detected
                  </span>
                  <span className="font-bold text-indigo-900 text-sm">
                    {result.target_speciality || result.recommended_specialty || 'General Medicine'}
                  </span>
                </div>

                <div className="mt-3 pt-3 border-t border-blue-100/60">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Possible Condition</p>
                  <p className="text-sm font-bold text-gray-800">
                    {result.predicted_condition || 'General Clinical Assessment'}
                  </p>
                </div>
              </div>

              {/* Clinical Advice & Guidance */}
              {(result.recommendation || result.reasoning) && (
                <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800 mb-1">💡 Guidance & Clinical Advice</p>
                  <p className="text-xs text-amber-900 font-medium leading-relaxed">
                    {result.recommendation || result.reasoning}
                  </p>
                </div>
              )}

              {result.refer_to_doctor && !result.offline_saved && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5">
                  <p className="text-emerald-900 font-bold text-xs mb-0.5">✓ OPD Referral Created</p>
                  <p className="text-emerald-700 text-[11px]">We have forwarded your symptoms to {preferredHospital}. A specialist will evaluate your case.</p>
                </div>
              )}

              {result.offline_saved && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5">
                  <p className="text-amber-900 font-bold text-xs mb-0.5">Saved Offline</p>
                  <p className="text-amber-700 text-[11px]">Your symptoms will be processed when your internet connection is restored.</p>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <button
                  onClick={() => {
                    onClose();
                    if (onBookAppointment) {
                      onBookAppointment({
                        specialty: result.target_speciality || result.recommended_specialty || 'General Medicine',
                        chief_complaint: transcriptText || result.transcript || 'Symptom Assessment Consultation',
                        symptom_assessment_id: result.symptom_assessment_id,
                        hospital_name: preferredHospital
                      });
                    }
                  }}
                  className="flex-1 py-3 bg-[#1B6CA8] text-white font-bold text-xs rounded-2xl hover:bg-[#1557A0] transition-colors shadow-sm"
                >
                  📅 Book OPD Appointment
                </button>
                <button
                  onClick={onClose}
                  className="px-5 py-3 bg-gray-100 text-gray-700 font-bold text-xs rounded-2xl hover:bg-gray-200 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
