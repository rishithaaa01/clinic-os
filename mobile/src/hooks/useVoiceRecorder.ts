import { useState, useRef, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';

export type RecordingState = 'idle' | 'preparing' | 'recording' | 'stopping' | 'recorded' | 'uploading';

export interface UseVoiceRecorderOptions {
  onRecordingComplete?: (uri: string, durationSec: number) => Promise<void> | void;
}

export function useVoiceRecorder(options?: UseVoiceRecorderOptions) {
  const [state, setState] = useState<RecordingState>('idle');
  const [duration, setDuration] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isTransitioningRef = useRef<boolean>(false);

  // Check permission on mount
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const status = await Audio.getPermissionsAsync();
        if (isMounted) {
          setPermissionGranted(status.granted);
        }
      } catch (_) {}
    })();

    // Cleanup on unmount: guarantee no native recorder stays running in background
    return () => {
      isMounted = false;
      cleanupRecorder();
    };
  }, []);

  const cleanupRecorder = async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recordingRef.current) {
      try {
        const rec = recordingRef.current;
        recordingRef.current = null;
        await rec.stopAndUnloadAsync();
      } catch (_) {}
    }
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
    } catch (_) {}
  };

  const startRecording = useCallback(async () => {
    if (isTransitioningRef.current || state !== 'idle') return;
    isTransitioningRef.current = true;
    setError(null);
    setState('preparing');

    try {
      // 1. Verify Permission
      let granted = permissionGranted;
      if (!granted) {
        const permRes = await Audio.requestPermissionsAsync();
        granted = permRes.granted;
        setPermissionGranted(granted);
      }

      if (!granted) {
        Alert.alert('Permission Required', 'Microphone permission is required to record audio.');
        setState('idle');
        isTransitioningRef.current = false;
        return;
      }

      // 2. Clean up any stale recorder reference
      await cleanupRecorder();

      // 3. Configure Audio Mode for Recording
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });

      // 4. Prepare and Start Native Recorder
      const newRecording = new Audio.Recording();
      await newRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await newRecording.startAsync();

      // 5. Native recording successfully started -> store ref and update state
      recordingRef.current = newRecording;
      setDuration(0);
      setState('recording');

      // Start duration timer only after native recording confirms active
      timerRef.current = setInterval(() => {
        setDuration(d => d + 1);
      }, 1000);

    } catch (err: any) {
      console.error('[VoiceRecorder] Start Error:', err);
      setError("Could not access device microphone. Please try again.");
      Alert.alert('Recording Error', "Could not start recording. Please try again.");
      await cleanupRecorder();
      setState('idle');
    } finally {
      isTransitioningRef.current = false;
    }
  }, [state, permissionGranted]);

  const stopRecording = useCallback(async () => {
    if (isTransitioningRef.current || state !== 'recording' || !recordingRef.current) return;
    isTransitioningRef.current = true;
    setState('stopping');

    // Clear timer immediately
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const rec = recordingRef.current;
    recordingRef.current = null; // Clear ref immediately to prevent duplicate calls

    let finalUri: string | null = null;

    try {
      if (rec) {
        await rec.stopAndUnloadAsync();
        finalUri = rec.getURI();
      }

      // Restore Audio Mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      // Verify file existence and non-zero size
      if (!finalUri) {
        throw new Error('No recording URI returned');
      }

      const fileInfo = await FileSystem.getInfoAsync(finalUri);
      if (!fileInfo.exists || fileInfo.size === 0) {
        throw new Error('Recording file is empty or missing');
      }

      setState('recorded');

      if (options?.onRecordingComplete) {
        setState('uploading');
        try {
          await options.onRecordingComplete(finalUri, duration);
        } finally {
          setState('idle');
        }
      }

    } catch (err: any) {
      console.error('[VoiceRecorder] Stop Error:', err);
      setError("We couldn't save the recording. Please try again.");
      Alert.alert('Recording Failed', "We couldn't save the recording. Please try again.");
      setState('idle');
    } finally {
      isTransitioningRef.current = false;
    }
  }, [state, duration, options]);

  const cancelRecording = useCallback(async () => {
    isTransitioningRef.current = true;
    await cleanupRecorder();
    setDuration(0);
    setError(null);
    setState('idle');
    isTransitioningRef.current = false;
  }, []);

  const resetRecorder = useCallback(async () => {
    await cleanupRecorder();
    setDuration(0);
    setError(null);
    setState('idle');
  }, []);

  return {
    state,
    duration,
    error,
    permissionGranted,
    startRecording,
    stopRecording,
    cancelRecording,
    resetRecorder,
    setState,
    setError,
  };
}
