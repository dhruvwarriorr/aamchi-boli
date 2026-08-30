"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, CircleHelp, MapPin, Mic, Send, Sparkles, Volume2 } from "lucide-react";
import { BOLI_MISSIONS, BOLI_OPEN_WORLD_MISSION } from "@/lib/boli-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BoliWorldCanvas } from "@/components/BoliWorldCanvas";
import type {
  BoliLearningState,
  BoliMapResponse,
  BoliOmniWorldResponse,
  BoliReviewItem,
  BoliReactionResponse,
  BoliTurnResponse,
  BoliVoiceResponse,
} from "@/lib/types/client";
import type { BoliInputMode, BoliMission } from "@/lib/types/shared";

type View = "welcome" | "choose-mission" | "mission";

const SUPPORT_LANGUAGES = [
  { label: "English", code: "English" },
  { label: "Hindi", code: "Hindi" },
  { label: "Gujarati", code: "Gujarati" },
  { label: "Tamil", code: "Tamil" },
  { label: "Telugu", code: "Telugu" },
] as const;

function stepLearningKey(stepIndex: number): string {
  return `step:${stepIndex}`;
}

function emptyStepProgress() {
  return {
    attempts: 0,
    cleared: false,
    firstTry: false,
    recoveredAfterRepair: false,
    hintUsed: false,
    voiceAttempts: 0,
    typedAttempts: 0,
    reviewAttempted: 0,
    reviewRecalled: 0,
  };
}

/** Build fresh no-login session evidence for each objective, even when skills repeat later. */
function freshLearningState(mission?: BoliMission | null): BoliLearningState {
  return Object.fromEntries(
    (mission?.steps ?? []).map((_, index) => [stepLearningKey(index), emptyStepProgress()])
  ) as BoliLearningState;
}

/** Read the best locally retained score for one mission without requiring an account. */
function storedMastery(missionId: string): number | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(`aamchi-boli:${missionId}:best-mastery`);
  } catch {
    // Private browsing and blocked-cookie contexts throw; treat as no record.
    return null;
  }
  if (raw === null || raw.trim() === "") return null;
  const saved = Number(raw);
  return Number.isFinite(saved) && saved >= 0 && saved <= 100 ? saved : null;
}

/** Persist a mission best, tolerating storage that refuses to accept writes. */
function persistMastery(missionId: string, value: number): void {
  try {
    window.localStorage.setItem(`aamchi-boli:${missionId}:best-mastery`, String(value));
  } catch {
    // A blocked write must not break a completed mission.
  }
}

function storedLearning(mission: BoliMission): BoliLearningState {
  try {
    const raw = window.localStorage.getItem(`aamchi-boli:${mission.id}:learning-v2`);
    if (!raw) return freshLearningState(mission);
    const parsed = JSON.parse(raw) as BoliLearningState;
    return Object.fromEntries(mission.steps.map((_, index) => {
      const item = parsed?.[stepLearningKey(index)];
      return [stepLearningKey(index), item ? { ...emptyStepProgress(), ...item } : emptyStepProgress()];
    })) as BoliLearningState;
  } catch {
    return freshLearningState(mission);
  }
}

function persistLearning(missionId: string, learning: BoliLearningState): void {
  try {
    window.localStorage.setItem(`aamchi-boli:${missionId}:learning-v2`, JSON.stringify(learning));
  } catch {
    // Local storage is an enhancement; a blocked write never interrupts play.
  }
}

/** Derive learner-facing evidence from code-owned mission goals and scored attempts. */
function summarizeLearning(mission: BoliMission | null, learning: BoliLearningState) {
  const progress = mission?.steps.map((_, index) => learning[stepLearningKey(index)] ?? emptyStepProgress()) ?? [];
  const cleared = progress.filter((item) => item.cleared).length;
  const firstTryWins = progress.filter((item) => item.cleared && item.firstTry).length;
  const repairsResolved = progress.filter((item) => item.recoveredAfterRepair).length;
  const hintsUsed = progress.filter((item) => item.hintUsed).length;
  const totalAttempts = progress.reduce((total, item) => total + item.attempts, 0);
  const voiceAttempts = progress.reduce((total, item) => total + item.voiceAttempts, 0);
  const typedAttempts = progress.reduce((total, item) => total + item.typedAttempts, 0);
  const reviewAttempted = progress.reduce((total, item) => total + item.reviewAttempted, 0);
  const reviewRecalled = progress.reduce((total, item) => total + item.reviewRecalled, 0);
  const focusCounts = progress.reduce<Record<string, number>>((counts, item) => {
    if (item.lastErrorCode) counts[item.lastErrorCode] = (counts[item.lastErrorCode] ?? 0) + 1;
    return counts;
  }, {});
  const recurringFocus = Object.entries(focusCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;
  const mastery = progress.length
    ? Math.round(
        progress.reduce((total, item) => total + (item.cleared ? (item.firstTry ? 100 : 82) : 0), 0) /
          progress.length
      )
    : 0;
  return { cleared, firstTryWins, repairsResolved, hintsUsed, totalAttempts, voiceAttempts, typedAttempts, reviewAttempted, reviewRecalled, recurringFocus, mastery };
}

/** Convert a short browser recording into the base64 payload accepted by Gemini. */
async function audioPayload(blob: Blob): Promise<{ data: string; mimeType: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that recording."));
    reader.readAsDataURL(blob);
  });
  const comma = dataUrl.indexOf(",");
  return {
    data: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
    mimeType: blob.type || "audio/webm",
  };
}

/** Speak visible Marathi text only as a browser fallback until Gemini TTS is connected. */
function speakFallback(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "mr-IN";
  utterance.rate = 0.82;
  window.speechSynthesis.speak(utterance);
}

/** Play a Gemini-scored Marathi mission chosen from the local route catalogue. */
export function AamchiBoli() {
  const [view, setView] = useState<View>("welcome");
  const [nameInput, setNameInput] = useState("");
  const [playerName, setPlayerName] = useState("Learner");
  const [supportLanguage, setSupportLanguage] = useState<(typeof SUPPORT_LANGUAGES)[number]["code"]>("English");
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [map, setMap] = useState<BoliMapResponse | null>(null);
  const [liveWorld, setLiveWorld] = useState<BoliOmniWorldResponse | null>(null);
  const [openingPrompt, setOpeningPrompt] = useState("");
  const [generatingWorld, setGeneratingWorld] = useState(false);
  const [reaction, setReaction] = useState<BoliReactionResponse | null>(null);
  const [reactionNote, setReactionNote] = useState<string | null>(null);
  const [loadingMap, setLoadingMap] = useState(false);
  const [loadingReaction, setLoadingReaction] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [typedResponse, setTypedResponse] = useState("");
  const [turn, setTurn] = useState<BoliTurnResponse | null>(null);
  const [turnStepIndex, setTurnStepIndex] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [showLearningPanel, setShowLearningPanel] = useState(false);
  const [conversationUnlocked, setConversationUnlocked] = useState(false);
  const [npcInRange, setNpcInRange] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<BoliReviewItem[]>([]);
  const [reviewingItemId, setReviewingItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [learning, setLearning] = useState<BoliLearningState>(() => freshLearningState());
  const learningRef = useRef<BoliLearningState>(learning);
  const [bestMastery, setBestMastery] = useState<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const silenceRafRef = useRef<number | null>(null);
  const acquiringMicRef = useRef(false);
  const submittingRef = useRef(false);
  const hintUsedByStepRef = useRef<Record<string, boolean>>({});
  const mapRequestRef = useRef(0);
  const missionSessionRef = useRef(0);

  /** Keep state and ref in lockstep so post-await reads never see a stale map. */
  const commitLearning = (next: BoliLearningState) => {
    learningRef.current = next;
    setLearning(next);
    if (mission) persistLearning(mission.id, next);
  };

  useEffect(() => {
    return () => {
      // Release hardware and stop audio if the player leaves mid-turn.
      try {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      } catch {
        // A recorder already torn down by the browser is fine to ignore.
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (silenceRafRef.current !== null) cancelAnimationFrame(silenceRafRef.current);
      void audioContextRef.current?.close();
      audioContextRef.current = null;
      streamRef.current = null;
      recorderRef.current = null;
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const mission = [...BOLI_MISSIONS, BOLI_OPEN_WORLD_MISSION].find((candidate) => candidate.id === selectedMissionId) ?? null;
  const completed = Boolean(mission && stepIndex >= mission.steps.length);
  const step = mission?.steps[Math.min(stepIndex, Math.max(mission.steps.length - 1, 0))] ?? null;
  const questProgress = mission?.steps.length ? Math.round((stepIndex / mission.steps.length) * 100) : 0;
  const learningSummary = summarizeLearning(mission, learning);
  const activeReview = reviewQueue.find((item) => item.id === reviewingItemId) ?? null;
  const availableReview = reviewQueue.find((item) => item.sourceStepIndex < stepIndex) ?? null;
  const scenePhrase = mission?.id === BOLI_OPEN_WORLD_MISSION.id && stepIndex === 1 ? liveWorld?.scenePhrase : undefined;
  const conversationStep = activeReview && mission ? mission.steps[activeReview.sourceStepIndex] : step;
  const activeTurn = turn && turnStepIndex !== null && (turnStepIndex === stepIndex || turnStepIndex === activeReview?.sourceStepIndex) ? turn : null;
  const recentlyClearedTurn = turn && turnStepIndex !== null && turnStepIndex < stepIndex ? turn : null;

  const generateLiveWorldFor = async (missionToGenerate: BoliMission, prompt: string, sessionId: number) => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) return;
    setGeneratingWorld(true);
    setError(null);
    try {
      const response = await fetch("/api/aamchi-boli/omni", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId: missionToGenerate.id, prompt: cleanPrompt }),
      });
      const data = (await response.json()) as BoliOmniWorldResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "The live world variation could not be rendered.");
      if (sessionId === missionSessionRef.current) {
        setLiveWorld(data);
      }
    } catch (cause) {
      if (sessionId === missionSessionRef.current) {
        setError(cause instanceof Error ? cause.message : "The live world variation could not be rendered.");
        if (missionToGenerate.id === BOLI_OPEN_WORLD_MISSION.id) {
          setOpeningPrompt(cleanPrompt);
          setSelectedMissionId(null);
          setView("choose-mission");
        }
      }
    } finally {
      if (sessionId === missionSessionRef.current) {
        setGeneratingWorld(false);
        if (missionToGenerate.id === BOLI_OPEN_WORLD_MISSION.id) setLoadingMap(false);
      }
    }
  };

  const beginMission = async (missionToStart: BoliMission, livePrompt?: string) => {
    if (!missionToStart.steps.length) {
      setError("This route does not have any conversation turns yet.");
      return;
    }
    const requestId = ++mapRequestRef.current;
    ++missionSessionRef.current;
    setSelectedMissionId(missionToStart.id);
    setView("mission");
    setLoadingMap(true);
    setMap(null);
    setLiveWorld(null);
    setReaction(null);
    setLoadingReaction(false);
    setStepIndex(0);
    setTurn(null);
    setTurnStepIndex(null);
    setTypedResponse("");
    setShowHint(false);
    setShowLearningPanel(false);
    hintUsedByStepRef.current = {};
    setConversationUnlocked(false);
    setNpcInRange(false);
    setReviewQueue([]);
    setReviewingItemId(null);
    setOpeningPrompt("");
    const savedLearning = storedLearning(missionToStart);
    learningRef.current = savedLearning;
    setLearning(savedLearning);
    setBestMastery(storedMastery(missionToStart.id));
    setError(null);
    // A custom build is its own world: paint it directly, never generate a
    // hidden preset map first or attach it to a Mumbai route.
    if (livePrompt?.trim()) {
      void generateLiveWorldFor(missionToStart, livePrompt, missionSessionRef.current);
      return;
    }
    if (missionToStart.mapAssetPath) {
      setMap({
        mission: missionToStart,
        image: missionToStart.mapAssetPath,
        fallback: false,
        source: "prebuilt",
      });
      setLoadingMap(false);
      return;
    }
    try {
      const response = await fetch("/api/aamchi-boli/map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId: missionToStart.id }),
      });
      const data = (await response.json()) as BoliMapResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "The map could not be generated.");
      if (requestId === mapRequestRef.current) {
        setMap(data);
      }
    } catch (cause) {
      if (requestId === mapRequestRef.current) {
        setError(cause instanceof Error ? cause.message : "The map could not be generated.");
      }
    } finally {
      if (requestId === mapRequestRef.current) setLoadingMap(false);
    }
  };


  const applyTurn = (
    response: BoliTurnResponse,
    inputMode: BoliInputMode,
    attemptedStepIndex: number
  ) => {
    if (!mission) return;
    setTurn(response);
    setTurnStepIndex(attemptedStepIndex);
    setShowHint(response.outcome !== "success" && response.supportRecommendation !== "none");
    const isReview = Boolean(reviewingItemId);
    if (!isReview) setStepIndex(Math.min(Math.max(response.nextStep, 0), mission.steps.length));
    const progressKey = stepLearningKey(attemptedStepIndex);
    const current = learningRef.current;
    const prior = current[progressKey] ?? emptyStepProgress();
    const attempts = prior.attempts + 1;
    const clearedNow = response.outcome === "success";
    // Read hint use from the ref: opening phrase help *while Gemini is thinking*
    // was missed by the closure, letting a supported attempt score as first-try.
    const supportWasUsed =
      prior.hintUsed || Boolean(hintUsedByStepRef.current[progressKey]) || response.adaptiveFeedback.level > 0;
    const nextLearning: BoliLearningState = {
      ...current,
      [progressKey]: {
        attempts: isReview ? prior.attempts : attempts,
        cleared: prior.cleared || clearedNow,
        firstTry: prior.firstTry || (!isReview && clearedNow && prior.attempts === 0 && !supportWasUsed),
        recoveredAfterRepair: prior.recoveredAfterRepair || (!isReview && clearedNow && (prior.attempts > 0 || supportWasUsed)),
        hintUsed: supportWasUsed,
        voiceAttempts: prior.voiceAttempts + (inputMode === "voice" ? 1 : 0),
        typedAttempts: prior.typedAttempts + (inputMode === "typed" ? 1 : 0),
        reviewAttempted: prior.reviewAttempted + (isReview ? 1 : 0),
        reviewRecalled: prior.reviewRecalled + (isReview && clearedNow ? 1 : 0),
        // A success should preserve the earlier repair signal instead of
        // inventing a new “error” from the model's optional success payload.
        lastErrorCode: clearedNow ? prior.lastErrorCode : response.feedbackFocus?.code,
      },
    };
    commitLearning(nextLearning);
    if (response.reviewItem) {
      const reviewItem = response.reviewItem;
      setReviewQueue((queue) => {
        const existing = queue.find((item) => item.id === reviewItem.id);
        if (reviewItem.completed) return queue.filter((item) => item.id !== reviewItem.id);
        if (existing) return queue.map((item) => item.id === reviewItem.id ? { ...item, attempts: reviewItem.attempts, errorCode: reviewItem.errorCode } : item);
        return [...queue, reviewItem];
      });
    }
    if (isReview) {
      if (clearedNow) setReviewingItemId(null);
      return;
    }
    const summary = summarizeLearning(mission, nextLearning);
    if (response.completed) {
      const mastery = summary.mastery;
      const currentBest = storedMastery(mission.id);
      const nextBest = currentBest === null ? mastery : Math.max(currentBest, mastery);
      persistMastery(mission.id, nextBest);
      setBestMastery(nextBest);
    }
    if (response.completed) {
      const sessionId = missionSessionRef.current;
      setReactionNote(null);
      setLoadingReaction(true);
      void fetch("/api/aamchi-boli/reaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          missionId: mission.id,
          reactionPrompt: response.reactionPrompt,
          // Let Nano Banana paint the run the learner actually had.
          independentClears: summary.firstTryWins,
          recoveredClears: summary.repairsResolved,
          voiceTurns: summary.voiceAttempts,
        }),
      })
        .then(async (result) => {
          if (!result.ok) {
            const detail = (await result.json().catch(() => null)) as { error?: string } | null;
            throw new Error(detail?.error || "The celebration frame could not be generated.");
          }
          return (await result.json()) as BoliReactionResponse;
        })
        .then((result) => {
          if (sessionId === missionSessionRef.current && result && !result.fallback) setReaction(result);
        })
        .catch((cause: unknown) => {
          // The mission is already won; this is a missing bonus, not a failure.
          if (sessionId !== missionSessionRef.current) return;
          setReactionNote(
            cause instanceof Error ? cause.message : "The celebration frame could not be generated."
          );
        })
        .finally(() => {
          if (sessionId === missionSessionRef.current) setLoadingReaction(false);
        });
    }
  };

  const submitTurn = async (payload: { typedResponse?: string; audioBase64?: string; audioMimeType?: string }) => {
    if (submittingRef.current || thinking || completed || !conversationUnlocked || !mission || !conversationStep) return;
    submittingRef.current = true;
    const sessionId = missionSessionRef.current;
    const isReview = Boolean(activeReview);
    const attemptedStepIndex = isReview ? activeReview!.sourceStepIndex : stepIndex;
    const attemptsForStep = learningRef.current[stepLearningKey(attemptedStepIndex)]?.attempts ?? 0;
    const inputMode: BoliInputMode = payload.audioBase64 ? "voice" : "typed";
    setThinking(true);
    setError(null);
    try {
      const response = await fetch("/api/aamchi-boli/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId: mission.id, stepIndex: attemptedStepIndex, attemptsForStep, mode: isReview ? "review" : "mission", reviewItemId: activeReview?.id, supportLanguage, ...payload }),
      });
      const data = (await response.json()) as BoliTurnResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "Gemini could not score that turn.");
      if (sessionId !== missionSessionRef.current) return;
      setTypedResponse("");
      applyTurn(data, inputMode, attemptedStepIndex);
    } catch (cause) {
      if (sessionId === missionSessionRef.current) {
        setError(cause instanceof Error ? cause.message : "Gemini could not score that turn.");
      }
    } finally {
      submittingRef.current = false;
      if (sessionId === missionSessionRef.current) setThinking(false);
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError("Microphone recording is unavailable here. Type your Marathi response instead.");
      return;
    }
    // `recording` only flips true after the permission await, so without this
    // ref a second click acquires a second stream and orphans the first.
    // leaving the browser mic indicator lit until the tab closes.
    if (acquiringMicRef.current || recorderRef.current) return;
    acquiringMicRef.current = true;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      acquiringMicRef.current = false;
      setError("Microphone permission was not granted. Type your response instead.");
      return;
    }

    try {
      streamRef.current = stream;
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (silenceRafRef.current !== null) cancelAnimationFrame(silenceRafRef.current);
        silenceRafRef.current = null;
        void audioContextRef.current?.close();
        audioContextRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) {
          setError("No audio was captured. Try again or type your response.");
          return;
        }
        // This handler is not awaited by anyone, so it must own its failures:
        // an unhandled rejection here left the button dead with no message.
        void (async () => {
          try {
            const audio = await audioPayload(blob);
            await submitTurn({ audioBase64: audio.data, audioMimeType: audio.mimeType });
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not read that recording.");
          }
        })();
      };
      recorder.start();
      // WhatsApp-like resilience: stop after roughly three seconds of actual
      // silence, while still allowing a manual stop at any time.
      try {
        const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioContextCtor) {
          const audioContext = new AudioContextCtor();
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 512;
          audioContext.createMediaStreamSource(stream).connect(analyser);
          const samples = new Uint8Array(analyser.fftSize);
          let activeTicks = 0;
          let silentTicks = 0;
          const monitor = () => {
            activeTicks += 1;
            analyser.getByteTimeDomainData(samples);
            let energy = 0;
            for (const sample of samples) {
              const normalized = (sample - 128) / 128;
              energy += normalized * normalized;
            }
            const rms = Math.sqrt(energy / samples.length);
            if (rms > 0.035) silentTicks = 0;
            else silentTicks += 1;
            // requestAnimationFrame is roughly 60 Hz: 180 quiet frames ≈ 3s.
            if (recorderRef.current?.state === "recording" && activeTicks > 55 && silentTicks > 180) {
              recorderRef.current.stop();
              return;
            }
            silenceRafRef.current = requestAnimationFrame(monitor);
          };
          audioContextRef.current = audioContext;
          silenceRafRef.current = requestAnimationFrame(monitor);
        }
      } catch {
        // Audio analysis is optional; MediaRecorder still works normally.
      }
      setRecording(true);
    } catch {
      // Permission succeeded but the recorder did not start; release the mic
      // and report the real problem instead of blaming permissions.
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      setError("This browser could not start an audio recorder. Type your response instead.");
    } finally {
      acquiringMicRef.current = false;
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  const speakNpc = async (text: string, slow = false) => {
    if (speaking) return;
    setSpeaking(true);
    let playingGeminiAudio = false;
    try {
      const response = await fetch("/api/aamchi-boli/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, slow, role: mission?.npcRole }),
      });
      const data = (await response.json()) as BoliVoiceResponse;
      if (data.audio) {
        const audio = new Audio(data.audio);
        audio.onended = () => setSpeaking(false);
        audio.onerror = () => {
          speakFallback(text);
          setSpeaking(false);
        };
        // Only claim ownership of the flag once playback actually started;
        // play() rejects under autoplay policy and would otherwise latch it.
        await audio.play();
        playingGeminiAudio = true;
        return;
      }
      speakFallback(text);
    } catch {
      speakFallback(text);
    } finally {
      if (!playingGeminiAudio) setSpeaking(false);
    }
  };

  const resetMission = (preserveMap = true) => {
    ++missionSessionRef.current;
    setSpeaking(false);
    setThinking(false);
    setStepIndex(0);
    setTurn(null);
    setTurnStepIndex(null);
    setReaction(null);
    setLoadingReaction(false);
    setTypedResponse("");
    setShowHint(false);
    setConversationUnlocked(false);
    setNpcInRange(false);
    setReviewQueue([]);
    setReviewingItemId(null);
    setError(null);
    commitLearning(freshLearningState(mission));
    if (!preserveMap) {
      setMap(null);
      setLiveWorld(null);
    }
  };

  const openRoutePicker = () => {
    mapRequestRef.current += 1;
    setSelectedMissionId(null);
    setLoadingMap(false);
    resetMission(false);
    setBestMastery(null);
    setView("choose-mission");
  };

  const returnToMissionPicker = () => {
    mapRequestRef.current += 1;
    setLoadingMap(false);
    resetMission(false);
    setSelectedMissionId(null);
    setBestMastery(null);
    setView("choose-mission");
  };

  const togglePhraseHelp = () => {
    const key = stepLearningKey(activeReview?.sourceStepIndex ?? stepIndex);
    setShowHint((visible) => {
      const nextVisible = !visible;
      if (nextVisible) hintUsedByStepRef.current = { ...hintUsedByStepRef.current, [key]: true };
      return nextVisible;
    });
  };

  if (view === "welcome") {
    return (
      <main className="relative min-h-dvh overflow-hidden bg-[#15110e] text-white">
        <Image
          src="/aamchi-boli/lobby/mumbai-monsoon-lobby.png"
          alt="A pixel-art language-learning game world"
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(12,9,7,.88),rgba(12,9,7,.54)_52%,rgba(12,9,7,.76)),linear-gradient(0deg,rgba(12,9,7,.88),transparent_58%)]" />
        <div className="relative z-10 mx-auto flex min-h-dvh max-w-5xl flex-col justify-center px-5 py-8 sm:px-8">
          <header className="mb-8 border-b-2 border-[#fff6dd]/45 pb-6">
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.22em] text-main">Language comes alive</p>
            <h1 className="font-display text-5xl font-extrabold tracking-tight sm:text-7xl">Aamchi Boli</h1>
            <p className="mt-3 max-w-2xl text-lg font-semibold text-[#fff6dd]/82">Walk through ready-made stories or invent a new world, then learn Marathi by speaking, not flashcards.</p>
          </header>

          <form
            className="max-w-3xl rounded-base border-2 border-black bg-[#fff6dd] p-5 text-black shadow-shadow sm:p-7"
            onSubmit={(event) => {
              event.preventDefault();
              const nextName = nameInput.trim().slice(0, 32);
              if (!nextName) return;
              setPlayerName(nextName);
              openRoutePicker();
            }}
          >
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#8b5b00]">Your learner</p>
            <label className="mt-4 block text-sm font-bold" htmlFor="learner-name">What should the world call you?</label>
            <Input id="learner-name" value={nameInput} onChange={(event) => setNameInput(event.target.value)} placeholder="Your name" className="mt-2 bg-white" autoFocus />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-bold">
                Learning now
                <div className="mt-1 rounded-base border-2 border-black bg-[#d9ff83] px-3 py-2 font-bold">Marathi · live speaking quests</div>
              </label>
              <label className="block text-sm font-bold" htmlFor="support-language">
                Explain feedback in
                <select id="support-language" value={supportLanguage} onChange={(event) => setSupportLanguage(event.target.value as typeof supportLanguage)} className="mt-1 h-10 w-full rounded-base border-2 border-black bg-white px-3 font-semibold outline-none focus:ring-2 focus:ring-main">
                  {SUPPORT_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
                </select>
              </label>
            </div>
            <p className="mt-3 text-sm font-semibold text-inksoft">Each quest is three short turns: speak, get one useful correction, then try again.</p>
            <Button className="mt-5" size="lg" type="submit" disabled={!nameInput.trim()}>
              Explore worlds <Sparkles />
            </Button>
          </form>
        </div>
      </main>
    );
  }

  if (view === "choose-mission") {
    return (
      <main className="relative min-h-dvh overflow-hidden bg-[#15110e] text-white">
        <Image
          src="/aamchi-boli/lobby/mumbai-monsoon-lobby.png"
          alt="A pixel-art language-learning game world"
          fill
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(12,9,7,.88),rgba(12,9,7,.54)_52%,rgba(12,9,7,.76)),linear-gradient(0deg,rgba(12,9,7,.88),transparent_58%)]" />
        <div className="relative z-10 mx-auto flex min-h-dvh max-w-6xl flex-col px-5 py-8 sm:px-8">
        <header className="mb-7 flex items-start justify-between gap-6 border-b-2 border-[#fff6dd]/45 pb-6">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.22em] text-main">Aamchi Boli · choose a route</p>
            <h1 className="font-display text-5xl font-extrabold tracking-tight sm:text-6xl">{playerName}&apos;s worlds</h1>
            <p className="mt-3 max-w-2xl text-lg font-semibold text-[#fff6dd]/82">
              Choose a place to walk through. Marathi practice is assessed for practical meaning; explanations are in {supportLanguage}.
            </p>
          </div>
          <Button variant="neutral" onClick={() => { setNameInput(playerName); setView("welcome"); }}>Change name</Button>
        </header>

        <section>
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-main">Ready-made worlds</p>
              <p className="mt-1 text-sm font-semibold text-[#fff6dd]/75">Choose a preset, or create an entirely original world below.</p>
            </div>
            <p className="hidden rounded-base border-2 border-black bg-main px-3 py-2 text-xs font-black text-black shadow-shadow sm:block">Playing as {playerName}</p>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {BOLI_MISSIONS.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => void beginMission(candidate)}
                className="group relative min-h-[18rem] overflow-hidden rounded-base border-2 border-black text-left shadow-shadow transition hover:-translate-y-1 hover:shadow-[8px_8px_0_#000] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-main"
                aria-label={`Enter preset world: ${candidate.title}`}
              >
                <Image src={candidate.mapAssetPath ?? "/aamchi-boli/lobby/mumbai-monsoon-lobby.png"} alt="" fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover transition duration-500 group-hover:scale-105" />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,3,2,.05)_24%,rgba(5,3,2,.92)_100%)]" />
                <div className="absolute inset-x-0 bottom-0 p-4 text-white">
                  <p className="flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.14em] text-[#ffd166]"><MapPin size={13} /> {candidate.area}</p>
                  <h2 className="mt-2 font-display text-2xl font-extrabold leading-tight">{candidate.title}</h2>
                  <p className="mt-2 line-clamp-2 text-sm font-semibold text-[#fff6dd]/90">Meet {candidate.npcName} · {candidate.steps.length} speaking goals</p>
                  <span className="mt-4 inline-flex rounded-base border-2 border-black bg-main px-3 py-2 text-xs font-black text-black shadow-shadow">Enter preset <Sparkles size={14} /></span>
                </div>
              </button>
            ))}
          </div>

          <form
            className="mt-8 rounded-base border-2 border-[#fff6dd]/60 bg-[#fff6dd] p-4 text-black shadow-shadow sm:p-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (openingPrompt.trim()) void beginMission(BOLI_OPEN_WORLD_MISSION, openingPrompt);
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-[#8b5b00]"><Sparkles size={15} /> Create your own world</p>
                <p className="mt-1 text-sm font-semibold text-inksoft">Gemini Omni turns your idea into a playable scene; Nano Banana paints it, then the Boli Guide teaches in context.</p>
              </div>
              <p className="rounded-base border-2 border-black bg-main px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] shadow-shadow">Any safe setting</p>
            </div>
            <Textarea
              id="custom-world-prompt"
              value={openingPrompt}
              onChange={(event) => setOpeningPrompt(event.target.value)}
              placeholder="Describe any world: a moonlit forest library, a futuristic floating market, a quiet beach…"
              aria-label="Describe the world Gemini should paint"
              className="mt-4 min-h-24 resize-none bg-white"
            />
            {error && <p className="mt-3 rounded-base border-2 border-black bg-[#ffd3ca] px-3 py-2 text-sm font-bold">{error}</p>}
            <div className="mt-3 flex justify-end">
              <Button type="submit" size="lg" disabled={!openingPrompt.trim()}>
                Build this world <Sparkles />
              </Button>
            </div>
          </form>
        </section>
        </div>
      </main>
    );
  }

  if (!mission || !step) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-3xl items-center px-5 py-8 sm:px-8">
        <section className="w-full rounded-base border-2 border-border bg-secondary-background p-7 shadow-shadow">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-inksoft">Route unavailable</p>
          <h1 className="mt-2 font-display text-4xl font-extrabold">Choose a playable world.</h1>
          <p className="mt-3 font-semibold text-inksoft">The selected route is missing its conversation steps, so there is nothing for Gemini to assess yet.</p>
          <Button className="mt-6" onClick={returnToMissionPicker}>Back to routes</Button>
        </section>
      </main>
    );
  }

  return (
    <main className="relative isolate min-h-dvh overflow-x-hidden bg-[#15110e] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_62%_34%,#f7b84b_0%,#b65a31_28%,#44362b_62%,#17120f_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(9,7,5,.62),transparent_35%,rgba(9,7,5,.12)_55%,rgba(9,7,5,.9))]" />

      <div className="relative z-10 flex min-h-dvh flex-col">
        <div className="pointer-events-auto absolute inset-0 z-0">
          <BoliWorldCanvas
            key={mission.id}
            mission={mission}
            imageSrc={reaction?.image ?? liveWorld?.image ?? map?.image}
            characterName={playerName}
            paused={conversationUnlocked || thinking || recording || showLearningPanel || loadingMap}
            completed={completed}
            onInteract={(hotspot) => {
              if (hotspot.kind === "npc") setConversationUnlocked(true);
            }}
            onNearChange={(hotspot) => setNpcInRange(hotspot?.kind === "npc")}
          />
        </div>
        {loadingMap && (
          <div className="absolute inset-0 z-40 grid place-items-center bg-[#15110e] px-5 text-white">
            <section className="w-full max-w-xl rounded-base border-2 border-black bg-[#fff6dd] p-6 text-black shadow-shadow sm:p-8">
              <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-[#8b5b00]"><Sparkles className="animate-pulse" size={16} /> Building your world</p>
              <h2 className="mt-3 font-display text-4xl font-extrabold">Gemini is making the place before you enter it.</h2>
              <p className="mt-3 text-sm font-semibold text-inksoft">Omni is shaping the game layout. Nano Banana is painting the playable map. Your Boli Guide will appear once the scene is ready.</p>
              <div className="mt-5 grid gap-2 text-sm font-bold">
                <p className="rounded-base border-2 border-black bg-[#d9ff83] px-3 py-2">1 · Scene direction</p>
                <p className="rounded-base border-2 border-black bg-white px-3 py-2">2 · Pixel-art world</p>
                <p className="rounded-base border-2 border-black bg-white px-3 py-2">3 · Three short Marathi bites</p>
              </div>
            </section>
          </div>
        )}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-white/25 bg-black/35 px-4 py-3 backdrop-blur-md sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="neutral"
              size="sm"
              disabled={thinking || recording}
              onClick={returnToMissionPicker}
            >
              <ChevronLeft size={16} /> Routes
            </Button>
            <div className="min-w-0">
              <p className="truncate text-[10px] font-bold uppercase tracking-[0.18em] text-[#fff6dd]/72">{playerName}&apos;s world</p>
              <p className="truncate font-display text-lg font-extrabold sm:text-xl">{mission.title} <span className="font-sans text-xs font-bold text-[#fff6dd]/70">· Marathi + {supportLanguage}</span></p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {generatingWorld && <div className="hidden rounded-base border-2 border-black bg-[#d9ff83] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-black shadow-shadow sm:block">Omni · painting</div>}
            {liveWorld && <div className="hidden rounded-base border-2 border-black bg-[#d9ff83] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-black shadow-shadow sm:block">{liveWorld.model.includes("omni") ? "Omni" : "Gemini"} · {liveWorld.cacheHit ? "cached" : "live"}</div>}
            <div className="hidden rounded-base border-2 border-black bg-[#fff6dd] px-3 py-1.5 text-black shadow-shadow sm:block">
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-inksoft">Location</p>
              <p className="flex items-center gap-1 text-xs font-bold"><MapPin size={13} /> {mission.area}</p>
            </div>
            <div className="rounded-base border-2 border-black bg-main px-3 py-1.5 text-right text-black shadow-shadow">
              <p className="text-[9px] font-bold uppercase tracking-[0.14em]">Quest</p>
              <p className="font-display text-lg font-extrabold leading-none">{questProgress}%</p>
            </div>
            <Button
              variant="neutral"
              size="sm"
              aria-expanded={showLearningPanel}
              onClick={() => setShowLearningPanel((visible) => !visible)}
            >
              {showLearningPanel ? "Close stats" : "Learning"}
            </Button>
          </div>
        </header>

        {showLearningPanel && (
          <aside className="fixed inset-x-3 bottom-3 top-[116px] z-30 overflow-y-auto rounded-base border-2 border-black bg-[#fff6dd] p-4 text-black shadow-shadow sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-6 sm:top-[88px] sm:max-h-[calc(100dvh-105px)] sm:w-[min(25rem,calc(100vw-3rem))]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-inksoft">No-login learning record</p>
                <p className="mt-1 font-display text-2xl font-extrabold">Your practical Marathi</p>
              </div>
              <div className="flex shrink-0 items-start gap-2">
                {map && <p className="hidden rounded-base border-2 border-black bg-main px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] shadow-shadow sm:block">Nano Banana {map.source === "prebuilt" ? "map" : "live"}</p>}
                <Button variant="neutral" size="sm" onClick={() => setShowLearningPanel(false)}>Close</Button>
              </div>
            </div>

            <article className="mt-4 rounded-base border-2 border-black bg-white p-3 shadow-shadow">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-inksoft">Can-do map</p>
              {mission.steps.map((item, index) => {
                const progress = learning[stepLearningKey(index)] ?? emptyStepProgress();
                const complete = progress.cleared;
                const currentGoal = !complete && index === stepIndex;
                return (
                  <div key={`${item.skill}-${index}`} className={`mt-3 flex items-center gap-2 rounded-base p-2 text-sm font-semibold ${complete ? "bg-[#d9ff83]" : currentGoal ? "border-2 border-black bg-main/25" : ""}`}>
                    <CheckCircle2 size={16} className={complete ? "text-green-700" : "text-inksoft"} />
                    <span className={complete ? "" : currentGoal ? "text-black" : "text-inksoft"}>{item.objective}</span>
                    <span className="ml-auto shrink-0 text-[9px] font-black uppercase tracking-wider">{complete ? "Done" : currentGoal ? "Now" : "Next"}</span>
                  </div>
                );
              })}
            </article>

            <article className="mt-4 rounded-base border-2 border-black bg-[#ffd3ca] p-3 shadow-shadow">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-2xl font-extrabold">{learningSummary.cleared}/{mission.steps.length}</p><p className="font-semibold text-inksoft">functional goals</p></div>
                <div><p className="text-2xl font-extrabold">{learningSummary.mastery}%</p><p className="font-semibold text-inksoft">mastery score</p></div>
                <div><p className="font-bold">{learningSummary.firstTryWins} independent</p><p className="text-xs text-inksoft">before support</p></div>
                <div><p className="font-bold">{learningSummary.repairsResolved} recovered</p><p className="text-xs text-inksoft">after guided practice</p></div>
                <div><p className="font-bold">{learningSummary.reviewRecalled}/{learningSummary.reviewAttempted}</p><p className="text-xs text-inksoft">later recalls</p></div>
              </div>
              {learningSummary.totalAttempts > 0 ? (
                <p className="mt-3 border-t-2 border-black/15 pt-3 text-xs font-semibold text-inksoft">
                  Evidence: {learningSummary.voiceAttempts} spoken, {learningSummary.typedAttempts} typed, {learningSummary.totalAttempts} Gemini-scored attempt{learningSummary.totalAttempts === 1 ? "" : "s"}.
                </p>
              ) : (
                <p className="mt-3 border-t-2 border-black/15 pt-3 text-xs font-semibold text-inksoft">Your first Gemini-scored turn will create this record.</p>
              )}
              {learningSummary.hintsUsed > 0 && <p className="mt-2 text-xs font-bold">Adaptive support used on {learningSummary.hintsUsed} goal{learningSummary.hintsUsed === 1 ? "" : "s"}.</p>}
              {learningSummary.recurringFocus && <p className="mt-2 text-xs font-bold">Next concept to revisit: {learningSummary.recurringFocus.replaceAll("_", " ")}.</p>}
              {bestMastery !== null && <p className="mt-2 text-xs font-bold">Best saved on this device: {bestMastery}%</p>}
            </article>
          </aside>
        )}

        {liveWorld?.visualFallbackReason && (
          <p className="absolute left-4 right-4 top-[92px] z-20 mx-auto max-w-xl rounded-base border-2 border-black bg-[#ffe8a8] px-3 py-2 text-center text-xs font-bold text-black shadow-shadow sm:top-[82px]">
            {liveWorld.visualFallbackReason}
          </p>
        )}

        <section className="relative flex min-h-[21dvh] flex-1 items-end px-4 pb-4 sm:min-h-[27dvh] sm:px-6 sm:pb-6">
          {loadingMap ? null : completed ? (
            <div className="max-w-xl rounded-base border-2 border-black bg-[#d9ff83] p-4 text-black shadow-shadow">
              <p className="flex items-center gap-2 font-display text-2xl font-extrabold"><CheckCircle2 /> Mission complete!</p>
              <p className="mt-1 font-semibold">You completed {mission.title} in practical Marathi.</p>
              {loadingReaction && <p className="mt-2 flex items-center gap-1 text-sm font-bold"><Sparkles className="animate-pulse" size={15} /> Nano Banana is illustrating your earned moment…</p>}
              {reactionNote && <p className="mt-2 text-xs font-semibold text-inksoft">{reactionNote}</p>}
            </div>
          ) : conversationUnlocked ? (
            <div className="relative z-10 max-w-xl rounded-base border-2 border-black bg-[#fff6dd] p-4 text-black shadow-shadow">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-inksoft">Quest {stepIndex + 1} of {mission.steps.length}</p>
              <p className="mt-1 font-display text-xl font-extrabold">{step.objective}</p>
            </div>
          ) : null}

        </section>

        <section className="relative z-20 max-h-[48dvh] overflow-y-auto overscroll-contain border-t-2 border-white/35 bg-[#100d0b]/95 shadow-[0_-12px_40px_rgba(0,0,0,.32)] backdrop-blur-md sm:max-h-none sm:overflow-visible">
          <div className={`mx-auto w-full max-w-7xl gap-4 px-4 py-4 lg:px-6 ${conversationUnlocked || completed ? "grid lg:grid-cols-[minmax(0,1.25fr)_minmax(340px,.75fr)]" : "max-w-2xl"}`}>
            <div className="no-scrollbar max-h-[39dvh] space-y-3 overflow-y-auto pr-1">
              {!completed ? (
                !conversationUnlocked ? (
                  <article className="rounded-base border-2 border-black bg-[#fff6dd] p-4 text-black shadow-shadow">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-inksoft">Explore</p>
                        <p className="mt-1 font-display text-2xl font-extrabold">Walk to {mission.npcName}.</p>
                        <p className="mt-1 text-sm font-semibold text-inksoft">WASD / arrows to move · E / Enter to talk</p>
                        {error && <p className="mt-2 rounded-base border-2 border-black bg-[#ffd3ca] px-2 py-1 text-xs font-bold">{error}</p>}
                      </div>
                      <Button disabled={!npcInRange || thinking || recording} onClick={() => setConversationUnlocked(true)}>
                        <Sparkles /> {npcInRange ? `Talk to ${mission.npcName}` : "Walk closer"}
                      </Button>
                    </div>
                  </article>
                ) : (
                  <>
                    {activeReview ? (
                      <article className="rounded-base border-2 border-black bg-[#d9ff83] p-4 text-black shadow-shadow">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-inksoft">Memory checkpoint · Gemini review</p>
                        <p className="mt-1 font-display text-2xl font-extrabold">Can you recall this useful line?</p>
                        <p className="mt-2 text-sm font-semibold">Say the Marathi phrase for: <span className="font-bold">{activeReview.phrase.meaning}</span></p>
                        <p className="mt-2 text-xs font-semibold text-inksoft">No full answer is shown. A close, natural meaning counts as independent recall.</p>
                        <Button variant="neutral" size="sm" className="mt-3" onClick={() => setReviewingItemId(null)}>Return to mission</Button>
                      </article>
                    ) : (
                      <article className="rounded-base border-2 border-black bg-[#fff6dd] p-4 text-black shadow-shadow">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-inksoft">{mission.npcName} says</p>
                            <p className="mt-1 text-xl font-bold leading-snug sm:text-2xl">{step.npcPromptMr}</p>
                            <p className="mt-1 text-sm font-medium text-inksoft">{step.npcPromptEn}</p>
                          </div>
                          <Button
                            variant="neutral"
                            size="sm"
                            className="shrink-0"
                            disabled={speaking}
                            aria-label={speaking ? "Gemini voice is speaking" : "Hear Gemini voice"}
                            onClick={() => void speakNpc(step.npcPromptMr)}
                          >
                            <Volume2 size={15} /> {speaking ? "Speaking…" : "Hear voice"}
                          </Button>
                        </div>
                      </article>
                    )}

                    {!activeReview && scenePhrase && (
                      <article className="rounded-base border-2 border-black bg-[#ffe8a8] p-4 text-black shadow-shadow">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-inksoft">A phrase from your world</p>
                        <p className="mt-1 text-xl font-bold">{scenePhrase.marathi}</p>
                        <p className="mt-1 text-sm italic text-inksoft">{scenePhrase.transliteration}</p>
                        <p className="mt-1 text-sm font-semibold">{scenePhrase.meaning}</p>
                        <Button variant="neutral" size="sm" className="mt-3" disabled={speaking} onClick={() => void speakNpc(scenePhrase.marathi, true)}>
                          <Volume2 size={15} /> {speaking ? "Speaking…" : "Hear this slowly"}
                        </Button>
                      </article>
                    )}

                    {!activeReview && availableReview && (
                      <article className="rounded-base border-2 border-black bg-[#ffe8a8] p-4 text-black shadow-shadow">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-inksoft">Remember this · optional checkpoint</p>
                        <p className="mt-1 font-bold">One earlier phrase is ready for a quick recall.</p>
                        <p className="mt-1 text-sm font-semibold">It will not block the next quest objective.</p>
                        <Button variant="neutral" size="sm" className="mt-3" onClick={() => setReviewingItemId(availableReview.id)}>Practice memory</Button>
                      </article>
                    )}

                    {recentlyClearedTurn && (
                      <article className="rounded-base border-2 border-black bg-[#d9ff83] p-4 text-black shadow-shadow">
                        <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-inksoft"><CheckCircle2 size={14} /> Checkpoint cleared</p>
                        <p className="mt-1 font-bold">{recentlyClearedTurn.adaptiveFeedback.whatWorked}</p>
                        <p className="mt-2 text-sm font-semibold">Next: {step.objective}</p>
                      </article>
                    )}

                    {activeTurn && (
                      <article className="rounded-base border-2 border-black bg-[#d9ff83] p-4 text-black shadow-shadow">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-inksoft">Quick coach · {activeTurn.outcome === "success" ? "clear" : `retry ${activeTurn.adaptiveFeedback.level}/2`}</p>
                        {activeTurn.inputMode === "voice" && (
                          <div className="mt-3 rounded-base border-2 border-black bg-white/80 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-inksoft">Gemini heard you say</p>
                            <p className="mt-1 font-bold leading-snug">{activeTurn.transcript || "I could not make out a clear phrase."}</p>
                            {activeTurn.heardMarathi && activeTurn.heardMarathi !== activeTurn.transcript && (
                              <p className="mt-1 text-sm font-semibold text-inksoft">Marathi reading: {activeTurn.heardMarathi}</p>
                            )}
                            {!activeTurn.transcript && (
                              <p className="mt-2 text-xs font-bold text-[#a02714]">Try again a little closer to the microphone. Unclear audio never counts as a language mistake.</p>
                            )}
                          </div>
                        )}
                        {activeTurn.feedbackFocus?.code === "mixed_language" && (
                          <p className="mt-2 rounded-base border-2 border-black bg-[#ffd3ca] p-2 text-sm font-black">Marathi practice needed. English or Hindi can help you understand, but only Marathi clears this task.</p>
                        )}
                        <p className="mt-1 font-bold">{activeTurn.adaptiveFeedback.whatWorked}</p>
                        {activeTurn.outcome !== "success" && (
                          <div className="mt-3 rounded-base border-2 border-black/15 bg-white/70 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-inksoft">One small change</p>
                            <p className="mt-1 text-sm font-semibold">{activeTurn.adaptiveFeedback.nextFocus}</p>
                            {showHint && (
                              <div className="mt-3 border-t-2 border-black/15 pt-3">
                                <p className="font-bold">{activeTurn.adaptiveFeedback.keyChunk.marathi}</p>
                                <p className="text-sm italic text-inksoft">{activeTurn.adaptiveFeedback.keyChunk.transliteration} · {activeTurn.adaptiveFeedback.keyChunk.meaning}</p>
                                <Button variant="neutral" size="sm" className="mt-3" disabled={speaking} onClick={() => void speakNpc(activeTurn.adaptiveFeedback.keyChunk.marathi, true)}>
                                  <Volume2 size={15} /> {speaking ? "Speaking…" : "Hear slowly"}
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                        <p className="mt-3 text-base font-bold leading-snug">{activeTurn.npcLineMr}</p>
                        <p className="mt-1 text-sm font-medium text-inksoft">{activeTurn.npcLineEn}</p>
                      </article>
                    )}

                    {showHint && !activeTurn && (
                      <article className="rounded-base border-2 border-black bg-main p-4 text-black shadow-shadow">
                        <p className="text-xs font-bold uppercase tracking-[0.14em]">Optional phrase support</p>
                        <p className="mt-1 font-bold">{scenePhrase?.marathi ?? step.targetPhraseMr}</p>
                        <p className="mt-1 text-sm italic">{scenePhrase?.transliteration ?? step.targetPhraseLatin}</p>
                        <p className="mt-1 text-sm">{scenePhrase?.meaning ?? step.targetPhraseEn}</p>
                        <p className="mt-2 text-xs font-semibold">This counts as supported practice, not an independent first try.</p>
                      </article>
                    )}
                  </>
                )
              ) : (
                <article className="rounded-base border-2 border-black bg-[#d9ff83] p-4 text-black shadow-shadow">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-inksoft">Route reflection</p>
                  <p className="mt-1 font-display text-2xl font-extrabold">{learningSummary.mastery}% practical mastery</p>
                  <p className="mt-2 font-semibold">You cleared {learningSummary.cleared} of {mission.steps.length} real-world speaking goal{mission.steps.length === 1 ? "" : "s"} as {playerName}.</p>
                  {reaction?.image && <p className="mt-2 text-sm font-bold">Your earned moment is now on the map.</p>}
                </article>
              )}
            </div>

            {(conversationUnlocked || completed) && <aside className="rounded-base border-2 border-black bg-[#fff6dd] p-4 text-black shadow-shadow">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-inksoft">{conversationUnlocked || completed ? "Speak your way forward" : "Walk your way forward"}</p>
              <div className="mt-1 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl font-extrabold">{mission.npcName}</h2>
                  <p className="mt-1 text-sm font-semibold text-inksoft">{playerName} · {mission.npcRole}</p>
                </div>
                {!completed && <p className="rounded-base border-2 border-black/25 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em]">Step {stepIndex + 1}/{mission.steps.length}</p>}
              </div>

              {error && <p className="mt-3 rounded-base border-2 border-black bg-[#ffd3ca] p-2 text-sm font-semibold">{error}</p>}
              {completed ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                  <Button onClick={() => resetMission()}><Sparkles /> Play again</Button>
                  <Button variant="neutral" onClick={returnToMissionPicker}>Choose a route</Button>
                </div>
              ) : (
                <>
                  <Button
                    className={`mt-4 w-full ${recording ? "bg-[#ff8f7f]" : ""}`}
                    size="lg"
                    disabled={thinking}
                    onClick={recording ? stopRecording : startRecording}
                  >
                    <Mic className={recording ? "animate-pulse" : ""} />
                    {recording ? "Listening… silence sends" : thinking ? "Gemini is listening…" : "Record a Marathi turn"}
                  </Button>
                  <form
                    className="mt-3 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const response = typedResponse.trim();
                      if (response) void submitTurn({ typedResponse: response });
                    }}
                  >
                    <Input
                      value={typedResponse}
                      onChange={(event) => setTypedResponse(event.target.value)}
                      placeholder="Type Marathi / transliteration"
                      disabled={thinking || recording}
                    />
                    <Button type="submit" size="icon" aria-label="Send typed answer" disabled={thinking || recording || !typedResponse.trim()}><Send /></Button>
                  </form>
                  <button
                    type="button"
                    disabled={recording}
                    className="mt-3 flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-inksoft hover:text-black disabled:cursor-not-allowed disabled:opacity-45"
                    onClick={togglePhraseHelp}
                  >
                    <CircleHelp size={14} /> {showHint ? "Hide phrase help" : "Need a phrase fragment?"}
                  </button>
                </>
              )}
            </aside>}
          </div>
        </section>
      </div>
    </main>
  );
}
