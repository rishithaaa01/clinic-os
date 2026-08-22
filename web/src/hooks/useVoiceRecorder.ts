import { useState, useRef, useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';

export function useVoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (e) {
          // ignore
        }
      });
      streamRef.current = null;
    }
  }, []);

  const stopAndGetBlob = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setIsRecording(false);

      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        stopTracks();
        resolve(audioBlob);
        return;
      }

      const handleStop = () => {
        // Give event loop 50ms to run onstop callback
        setTimeout(() => {
          stopTracks();
          setAudioBlob(prev => {
            resolve(prev);
            return prev;
          });
        }, 50);
      };

      try {
        recorder.addEventListener('stop', handleStop, { once: true });
        recorder.stop();
      } catch (err) {
        console.error("Error stopping MediaRecorder:", err);
        stopTracks();
        resolve(audioBlob);
      }
    });
  }, [stopTracks, audioBlob]);

  const stopRecording = useCallback(() => {
    stopAndGetBlob();
  }, [stopAndGetBlob]);

  const startRecording = useCallback(async () => {
    // Ensure any ongoing recording or microphone stream is stopped first
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {}
    }
    stopTracks();
    setAudioBlob(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      let options: MediaRecorderOptions = {};
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          options = { mimeType: 'audio/webm;codecs=opus' };
        } else if (MediaRecorder.isTypeSupported('audio/webm')) {
          options = { mimeType: 'audio/webm' };
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          options = { mimeType: 'audio/mp4' };
        }
      }

      const recorder = new MediaRecorder(stream, options);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        if (chunks.length > 0) {
          const mimeType = recorder.mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type: mimeType });
          console.log(`[DEVELOPER VOICE RECORDER] MediaRecorder stopped. Created Blob MIME: ${blob.type} | Size: ${blob.size}B`);
          setAudioBlob(blob);
        }
        stopTracks();
      };

      recorder.start(250); // Record in 250ms timeslices for reliable chunking
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error("Recording error:", err);
      stopTracks();
      setIsRecording(false);
      toast.error("Microphone access denied or unsupported. Please check browser permissions.");
    }
  }, [stopTracks]);

  const clearRecording = useCallback(() => {
    setAudioBlob(null);
    setDuration(0);
  }, []);

  // Failsafe hardware cleanup on component unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch (e) {}
      }
      stopTracks();
    };
  }, [stopTracks]);

  return {
    isRecording,
    duration,
    audioBlob,
    startRecording,
    stopRecording,
    stopAndGetBlob,
    clearRecording
  };
}
