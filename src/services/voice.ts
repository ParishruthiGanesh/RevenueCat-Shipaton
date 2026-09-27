import { useCallback, useRef, useState } from 'react';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

/**
 * Voice input. Prefers ON-DEVICE recognition when supported (privacy: audio never leaves the
 * phone). Falls back gracefully when speech recognition is unavailable.
 */

export type VoiceState = 'idle' | 'listening' | 'unavailable' | 'denied';

export function useVoice(onFinal?: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const finalRef = useRef('');

  useSpeechRecognitionEvent('result', (e) => {
    const text = e.results[0]?.transcript ?? '';
    setTranscript(text);
    if (e.isFinal) finalRef.current = text;
  });
  useSpeechRecognitionEvent('end', () => {
    setState((s) => (s === 'listening' ? 'idle' : s));
    if (finalRef.current) onFinal?.(finalRef.current);
  });
  useSpeechRecognitionEvent('error', (e) => {
    setState(e.error === 'not-allowed' ? 'denied' : e.error === 'service-not-allowed' || e.error === 'language-not-supported' ? 'unavailable' : 'idle');
  });

  const start = useCallback(async () => {
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        setState('unavailable');
        return;
      }
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        setState('denied');
        return;
      }
      finalRef.current = '';
      setTranscript('');
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: false,
        requiresOnDeviceRecognition: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
        addsPunctuation: true,
        contextualStrings: ['passport', 'AirPods', 'drawer', 'dresser', 'box', 'shelf', 'backpack', 'charger', 'remember'],
      });
      setState('listening');
    } catch {
      setState('unavailable');
    }
  }, []);

  const stop = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      setState('idle');
    }
  }, []);

  return { state, transcript, start, stop, setTranscript };
}
