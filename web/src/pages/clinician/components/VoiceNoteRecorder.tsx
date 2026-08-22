import React, { useState } from 'react';
import { Mic, X, Square, RotateCcw, Check, Sparkles, AlertCircle, Loader2 } from 'lucide-react';
import { useVoiceRecorder } from '../../../hooks/useVoiceRecorder';
import api from '../../../services/clinicianApi';
import toast from 'react-hot-toast';

interface VoiceNoteRecorderProps {
  visitId: string;
  onExtractionComplete: (data: any) => void;
  onClose: () => void;
}

type ProcessStage = 'idle' | 'uploading' | 'transcribing' | 'analyzing' | 'enriching';

export default function VoiceNoteRecorder({ visitId, onExtractionComplete, onClose }: VoiceNoteRecorderProps) {
  const { isRecording, duration, audioBlob, startRecording, stopRecording, stopAndGetBlob, clearRecording } = useVoiceRecorder();
  const [isProcessing, setIsProcessing] = useState(false);
  const [stage, setStage] = useState<ProcessStage>('idle');
  const [stageMessage, setStageMessage] = useState('');
  const [transcriptionData, setTranscriptionData] = useState<any>(null);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const translateError = (err: any) => {
    if (!err) return "We're taking longer than expected to process the recording. Please try again.";
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout') || err.response?.status === 504) {
      return "We're taking longer than expected to process the recording. Please try again.";
    }
    return err.response?.data?.detail || err.response?.data?.message || "We couldn't process the recording. Please try again.";
  };

  const handleProcess = async () => {
    let targetBlob = audioBlob;
    if (isRecording) {
      targetBlob = await stopAndGetBlob();
    }

    if (!targetBlob || targetBlob.size === 0) {
      toast.error("Recorded audio file is empty. Please re-record.");
      return;
    }

    setIsProcessing(true);
    setStage('uploading');
    setStageMessage('Uploading recording...');

    try {
      console.log(`[DEVELOPER DIAGNOSTIC - CLINICIAN VOICE UI] Audio Blob MIME: ${targetBlob.type || 'audio/webm'} | File Size: ${targetBlob.size}B | Duration: ${duration}s`);
      
      setStage('transcribing');
      setStageMessage('Transcribing audio recording...');
      
      const data = await api.processVoiceNote(visitId, targetBlob);
      
      setStage('analyzing');
      setStageMessage('Analyzing symptoms & specialty...');
      
      setTranscriptionData(data);
      if (data.ollama_status === 'unavailable') {
        toast('Advanced clinical insights are temporarily unavailable. Standard results generated.', { icon: 'ℹ️' });
      } else {
        toast.success("Voice note analyzed successfully!");
      }
    } catch (err: any) {
      console.error("Failed to process clinician voice note:", err);
      if (!navigator.onLine) {
        try {
          const reader = new FileReader();
          reader.readAsDataURL(targetBlob);
          reader.onloadend = () => {
            localStorage.setItem(`offline_voice_${visitId}`, reader.result as string);
            toast.success("Saved offline. Will process when connection returns.");
            onClose();
          };
        } catch (saveErr) {
          toast.error("Failed to save offline voice note.");
        }
      } else {
        const errorMsg = translateError(err);
        toast.error(errorMsg);
      }
    } finally {
      setIsProcessing(false);
      setStage('idle');
      setStageMessage('');
    }
  };

  const handleApply = () => {
    onExtractionComplete(transcriptionData);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
      <div className="bg-white rounded-[28px] w-full max-w-2xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-8 py-6 border-b border-[#E2DDD8] flex justify-between items-center bg-[#FDFEFE]">
          <div>
            <h3 className="text-xl font-bold font-mukta text-[#333]">Clinical Voice Dictation</h3>
            <p className="text-sm text-[#666]">Powered by Ayu Disha AI</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[#F7F3EE] rounded-full transition-colors">
            <X size={24} className="text-[#888]" />
          </button>
        </div>

        <div className="p-8">
          {!transcriptionData ? (
            <div className="flex flex-col items-center py-10">
              <div className="relative mb-8">
                {isRecording && (
                  <div className="absolute inset-0 bg-red-100 rounded-full animate-ping opacity-25" />
                )}
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={isProcessing}
                  className={`
                    w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 shadow-xl
                    ${isRecording ? 'bg-red-500 hover:bg-red-600 scale-110' : 'bg-[#D35400] hover:bg-[#A04000]'}
                  `}
                >
                  {isRecording ? <Square size={32} fill="white" className="text-white" /> : <Mic size={36} className="text-white" />}
                </button>
              </div>

              <div className="text-center">
                <p className="text-2xl font-mono font-bold text-[#333] mb-2">{formatTime(duration)}</p>
                <p className="text-[#666] font-medium">
                  {isRecording ? 'Recording... click to stop' : 'Click to start dictating'}
                </p>
                <p className="text-xs text-[#888] mt-4 max-w-xs mx-auto">
                  Speak naturally about symptoms, your findings, and the treatment plan.
                </p>
              </div>

              {isProcessing && (
                <div className="mt-8 flex items-center gap-3 bg-blue-50 border border-blue-200 text-blue-800 px-6 py-3 rounded-2xl animate-pulse">
                  <Loader2 className="animate-spin" size={20} />
                  <span className="font-semibold text-sm">{stageMessage}</span>
                </div>
              )}

              {audioBlob && !isRecording && !isProcessing && (
                <div className="flex gap-4 mt-12 w-full">
                  <button
                    onClick={clearRecording}
                    className="flex-1 py-4 border-2 border-[#E2DDD8] text-[#666] font-bold rounded-2xl flex items-center justify-center gap-2 hover:bg-[#F7F3EE] transition-colors"
                  >
                    <RotateCcw size={20} />
                    <span>Re-record</span>
                  </button>
                  <button
                    onClick={handleProcess}
                    disabled={isProcessing}
                    className="flex-1 py-4 bg-[#1B6CA8] text-white font-bold rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-blue-900/10 hover:bg-[#154360] transition-colors disabled:opacity-50"
                  >
                    <Sparkles size={20} />
                    <span>Analyze with AI</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {transcriptionData.ollama_status === 'unavailable' && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex items-center gap-2">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>Advanced clinical insights are temporarily unavailable. Displaying core AI transcription & diagnosis.</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-[#888] uppercase tracking-wider">Raw Transcription</h4>
                  <div className="bg-[#F7F3EE] rounded-2xl p-4 h-[300px] overflow-y-auto text-sm text-[#333] leading-relaxed italic border border-[#E2DDD8]">
                    {transcriptionData.raw_transcription || transcriptionData.transcription || 'No transcript recorded.'}
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-[#888] uppercase tracking-wider">AI Extracted Data</h4>
                  <div className="space-y-3 overflow-y-auto h-[300px] pr-2 custom-scrollbar">
                    {Object.entries({
                      'Chief Complaint': transcriptionData.chief_complaint,
                      'Examination': transcriptionData.examination_findings,
                      'Diagnoses': Array.isArray(transcriptionData.diagnosis) ? transcriptionData.diagnosis.join(', ') : (transcriptionData.predicted_condition || transcriptionData.diagnosis),
                      'Recommended Specialty': transcriptionData.recommended_specialty,
                      'Plan': transcriptionData.plan,
                      'Follow-up': transcriptionData.follow_up
                    }).map(([label, value]) => (
                      <div key={label} className="bg-white border border-[#E2DDD8] rounded-xl p-3">
                         <p className="text-[10px] font-bold text-[#1B6CA8] uppercase mb-1">{label}</p>
                         <p className="text-xs text-[#333] font-medium">{value || 'Not mentioned'}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-4 pt-4 border-t border-[#E2DDD8]">
                <button
                  onClick={() => {
                    setTranscriptionData(null);
                    clearRecording();
                  }}
                  className="px-6 py-4 border-2 border-[#E2DDD8] text-[#666] font-bold rounded-2xl flex-1 hover:bg-[#F7F3EE] transition-colors"
                >
                  Discard & Retry
                </button>
                <button
                  onClick={handleApply}
                  className="px-6 py-4 bg-green-600 text-white font-bold rounded-2xl flex-1 flex items-center justify-center gap-2 shadow-lg shadow-green-900/10 hover:bg-green-700 transition-colors"
                >
                  <Check size={20} />
                  <span>Use This Data</span>
                </button>
              </div>
            </div>
          )}
        </div>
        
        <div className="bg-[#F7F3EE] p-4 flex items-center justify-center gap-2 text-[#888]">
          <AlertCircle size={14} />
          <span className="text-[10px] italic">Always review AI-extracted information before saving.</span>
        </div>
      </div>
    </div>
  );
}
