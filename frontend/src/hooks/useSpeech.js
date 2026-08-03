import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { speechService } from "../services/speechService";

// STT: browser-native Web Speech API (window.SpeechRecognition) — unchanged
// by the Piper migration below. Mirrors the existing VoiceLeaveTest.jsx
// precedent, adding: mic-interrupts-TTS and defensive cleanup that nulls
// event handlers before abort (VoiceLeaveTest.jsx's cleanup only calls
// .abort(), which can still let a late onend/onerror fire after unmount).
//
// TTS: offline Piper TTS running in the Python backend (POST /speech/speak),
// replacing the previous window.speechSynthesis implementation — browsers
// routinely have no installed Tamil voice, so Tamil requests were silently
// falling back to English. Playback happens client-side via a persistent
// <audio> element; the backend's only job is synthesis (text -> WAV bytes).

const TAMIL_RANGE = /[஀-௿]/;
const HINDI_RANGE = /[ऀ-ॿ]/;      // Devanagari
const MALAYALAM_RANGE = /[ഀ-ൿ]/;

export function detectSpokenLang(text) {

  if (MALAYALAM_RANGE.test(text || "")) return "ml-IN";

  if (HINDI_RANGE.test(text || "")) return "hi-IN";

  return TAMIL_RANGE.test(text || "") ? "ta-IN" : "en-IN";
}

const STT_ERROR_MESSAGES = {
  "no-speech": "No speech detected. Move closer to the mic and try again.",
  "audio-capture": "Microphone not found or not permitted.",
  "not-allowed": "Microphone permission denied. Allow it in the browser address bar.",
  "network": "Network error — voice input needs an internet connection.",
  "language-not-supported": "This browser doesn't support the selected language for speech.",
};

export function useSpeech({ sttLang = "en-IN", ttsLangMode = "auto", onFinalResult } = {}) {

  const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

  const [sttSupported] = useState(!!SR);

  // TTS is now a backend capability, not a browser one — every modern
  // browser can play a WAV Blob via <audio>, so this is always true. Kept
  // as a field (rather than removed) so existing `speech.ttsSupported &&`
  // gates elsewhere keep compiling and behaving correctly.
  const [ttsSupported] = useState(true);

  const [isRecording, setIsRecording] = useState(false);

  const [interimText, setInterimText] = useState("");

  const [sttError, setSttError] = useState("");

  const [isSpeaking, setIsSpeaking] = useState(false);

  const [isLoadingSpeech, setIsLoadingSpeech] = useState(false);

  const [ttsError, setTtsError] = useState("");

  const recogRef = useRef(null);

  const audioRef = useRef(null);

  const audioUrlRef = useRef(null);

  const abortControllerRef = useRef(null);

  const lastSpokenRef = useRef({ text: "", lang: "", blob: null });

  const sttLangRef = useRef(sttLang);

  const ttsLangModeRef = useRef(ttsLangMode);

  const onFinalResultRef = useRef(onFinalResult);

  const isMountedRef = useRef(true);

  useEffect(() => { sttLangRef.current = sttLang; }, [sttLang]);

  useEffect(() => { ttsLangModeRef.current = ttsLangMode; }, [ttsLangMode]);

  useEffect(() => { onFinalResultRef.current = onFinalResult; }, [onFinalResult]);

  const stopSpeaking = useCallback(() => {

    const el = audioRef.current;

    if (el) {

      el.pause();

      el.currentTime = 0;
    }

  }, []);

  const playBlob = useCallback((blob) => {

    const el = audioRef.current;

    if (!el) return;

    const nextUrl = URL.createObjectURL(blob);

    const prevUrl = audioUrlRef.current;

    el.src = nextUrl;

    audioUrlRef.current = nextUrl;

    // Revoke the PREVIOUS url only — nothing will ever load it again once
    // .src has been reassigned, so this is safe immediately, not deferred
    // to any event. The url now playing is only ever revoked by the next
    // call to playBlob() or by the unmount cleanup below.
    if (prevUrl) URL.revokeObjectURL(prevUrl);

    el.play().catch(() => {

      if (isMountedRef.current) setTtsError("Could not play the response aloud.");
    });

  }, []);

  const speak = useCallback(async (text, langOverride) => {

    if (!text || !text.trim()) return;

    // No overlapping speech, ever — stop whatever is in flight first,
    // regardless of who's calling (auto-speak effect, manual button, replay).
    stopSpeaking();

    // Abort any in-flight synthesis request from a previous speak() call.
    abortControllerRef.current?.abort();

    const controller = new AbortController();

    abortControllerRef.current = controller;

    setTtsError("");

    const mode = ttsLangModeRef.current;

    const lang = langOverride
      || (mode === "auto" ? detectSpokenLang(text) : `${mode}-IN`);

    const backendLang = lang.split("-")[0];

    setIsLoadingSpeech(true);

    let blob;

    try {

      const res = await speechService.speak(text, backendLang, { signal: controller.signal });

      if (!isMountedRef.current) return;

      blob = new Blob([res.data], { type: "audio/wav" });

    } catch (err) {

      if (!isMountedRef.current || err.name === "CanceledError" || err.name === "AbortError") return;

      setTtsError(
        err?.response?.status === 503
          ? "Voice is still starting up — try again in a few seconds."
          : "Could not play the response aloud."
      );

      return;

    } finally {

      if (isMountedRef.current) setIsLoadingSpeech(false);
    }

    lastSpokenRef.current = { text, lang, blob };

    playBlob(blob);

  }, [stopSpeaking, playBlob]);

  const replay = useCallback(() => {

    const { blob } = lastSpokenRef.current;

    if (blob) playBlob(blob);

  }, [playBlob]);

  const stopRecording = useCallback(() => {

    if (recogRef.current) {

      try {

        recogRef.current.stop();

      } catch { /* ignore */ }
    }

  }, []);

  const startRecording = useCallback((langOverride) => {

    if (!SR || isRecording) return;

    // Mic always interrupts AI speech.
    stopSpeaking();

    setSttError("");

    setInterimText("");

    const recognition = new SR();

    recognition.lang = langOverride || sttLangRef.current;

    recognition.continuous = false;

    recognition.interimResults = true;

    recognition.maxAlternatives = 1;

    recognition.onresult = (e) => {

      let interim = "";

      let final = "";

      for (let i = e.resultIndex; i < e.results.length; i++) {

        const result = e.results[i];

        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }

      if (!isMountedRef.current) return;

      if (final.trim()) {

        onFinalResultRef.current?.(final.trim());

        setInterimText("");

      } else {

        setInterimText(interim);
      }
    };

    recognition.onerror = (e) => {

      if (!isMountedRef.current) return;

      setSttError(STT_ERROR_MESSAGES[e.error] || `Recognition error: ${e.error}`);

      setIsRecording(false);
    };

    recognition.onend = () => {

      if (!isMountedRef.current) return;

      setIsRecording(false);

      setInterimText("");
    };

    try {

      recognition.start();

      recogRef.current = recognition;

      setIsRecording(true);

    } catch {

      setSttError("Could not start voice input.");

      setIsRecording(false);
    }

  }, [SR, isRecording, stopSpeaking]);

  // Mount-once setup + cleanup — the <audio> element is created once (not
  // JSX) so it survives re-renders independent of React's own lifecycle,
  // same idiom as recogRef for SpeechRecognition. Cleanup nulls handlers
  // before pause/abort so a late async callback can't fire setState after
  // unmount, and aborts any in-flight synthesis fetch.
  useEffect(() => {

    isMountedRef.current = true;

    const el = new Audio();

    el.onplay = () => { if (isMountedRef.current) setIsSpeaking(true); };

    el.onended = () => { if (isMountedRef.current) setIsSpeaking(false); };

    el.onpause = () => { if (isMountedRef.current) setIsSpeaking(false); };

    el.onerror = () => {

      if (!isMountedRef.current) return;

      setIsSpeaking(false);

      setTtsError("Could not play the response aloud.");
    };

    audioRef.current = el;

    return () => {

      isMountedRef.current = false;

      if (recogRef.current) {

        try {

          recogRef.current.onresult = null;

          recogRef.current.onerror = null;

          recogRef.current.onend = null;

          recogRef.current.abort();

        } catch { /* ignore */ }
      }

      abortControllerRef.current?.abort();

      const audioEl = audioRef.current;

      if (audioEl) {

        audioEl.onplay = audioEl.onended = audioEl.onpause = audioEl.onerror = null;

        audioEl.pause();

        audioEl.src = "";
      }

      if (audioUrlRef.current) {

        URL.revokeObjectURL(audioUrlRef.current);

        audioUrlRef.current = null;
      }
    };

  }, []);

  return useMemo(() => ({
    sttSupported,
    ttsSupported,
    isRecording,
    interimText,
    sttError,
    startRecording,
    stopRecording,
    isSpeaking,
    isLoadingSpeech,
    ttsError,
    speak,
    stopSpeaking,
    replay,
  }), [
    sttSupported, ttsSupported, isRecording, interimText, sttError,
    startRecording, stopRecording, isSpeaking, isLoadingSpeech, ttsError,
    speak, stopSpeaking, replay,
  ]);
}
