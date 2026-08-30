"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, CircleHelp, Lock, MapPin, Mic, Send, Sparkles, Volume2 } from "lucide-react";
import { BOLI_CHARACTERS, BOLI_MISSIONS } from "@/lib/boli-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BoliWorldControls } from "@/components/BoliWorldControls";
import type {
  BoliLearningState,
  BoliMapResponse,
  BoliReactionResponse,
  BoliTurnResponse,
  BoliVoiceResponse,
} from "@/lib/types/client";
import type { BoliCharacterId, BoliInputMode, BoliMission } from "@/lib/types/shared";

type View = "choose-character" | "choose-mission" | "mission";

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
  };
}

/** Build fresh no-login session evidence for each objective, even when skills repeat later. */
function freshLearningState(mission?: BoliMission | null): BoliLearningState {
  return Object.fromEntries(
    (mission?.steps ?? []).map((_, index) => [stepLearningKey(index), emptyStepProgress()])
  ) as BoliLearningState;
}

function supportCopy(support: BoliTurnResponse["supportRecommendation"]): string {
  switch (support) {
    case "visual_hint":
      return "Gemini opened a visual route cue for the key place.";
    case "phrase_fragment":
      return "Gemini unlocked a phrase fragment for your next attempt.";
    case "slow_repeat":
      return "Gemini recommends hearing the line slowly before trying again.";
    default:
      return "No support needed — your practical intent was clear.";
  }
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
  const mastery = progress.length
    ? Math.round(
        progress.reduce((total, item) => total + (item.cleared ? (item.firstTry ? 100 : 82) : 0), 0) /
          progress.length
      )
    : 0;
  return { cleared, firstTryWins, repairsResolved, hintsUsed, totalAttempts, voiceAttempts, typedAttempts, mastery };
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
  const [view, setView] = useState<View>("choose-character");
  const [selectedCharacterId, setSelectedCharacterId] = useState<BoliCharacterId | null>(
    () => BOLI_CHARACTERS.find((character) => character.available)?.id ?? null
  );
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [map, setMap] = useState<BoliMapResponse | null>(null);
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
  const [error, setError] = useState<string | null>(null);
  const [learning, setLearning] = useState<BoliLearningState>(() => freshLearningState());
  const learningRef = useRef<BoliLearningState>(learning);
  const [bestMastery, setBestMastery] = useState<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const acquiringMicRef = useRef(false);
  const submittingRef = useRef(false);
  const hintUsedByStepRef = useRef<Record<string, boolean>>({});
  const mapRequestRef = useRef(0);
  const missionSessionRef = useRef(0);

  /** Keep state and ref in lockstep so post-await reads never see a stale map. */
  const commitLearning = (next: BoliLearningState) => {
    learningRef.current = next;
    setLearning(next);
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
      streamRef.current = null;
      recorderRef.current = null;
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const selectedCharacter = useMemo(
    () => BOLI_CHARACTERS.find((character) => character.id === selectedCharacterId) ?? null,
    [selectedCharacterId]
  );
  const characterMissions = useMemo(
    () =>
      selectedCharacter
        ? BOLI_MISSIONS.filter((candidate) => candidate.characterId === selectedCharacter.id)
        : [],
    [selectedCharacter]
  );
  const mission = useMemo(
    () => characterMissions.find((candidate) => candidate.id === selectedMissionId) ?? null,
    [characterMissions, selectedMissionId]
  );
  const completed = Boolean(mission && stepIndex >= mission.steps.length);
  const step = mission?.steps[Math.min(stepIndex, Math.max(mission.steps.length - 1, 0))] ?? null;
  const questProgress = mission?.steps.length ? Math.round((stepIndex / mission.steps.length) * 100) : 0;
  const learningSummary = useMemo(() => summarizeLearning(mission, learning), [learning, mission]);
  const activeTurn = turn && turnStepIndex === stepIndex ? turn : null;
  const recentlyClearedTurn = turn && turnStepIndex !== null && turnStepIndex < stepIndex ? turn : null;

  const beginMission = async (missionToStart: BoliMission) => {
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
    setLearning(freshLearningState(missionToStart));
    setBestMastery(storedMastery(missionToStart.id));
    setError(null);
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
      if (requestId === mapRequestRef.current) setMap(data);
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
    setStepIndex(Math.min(Math.max(response.nextStep, 0), mission.steps.length));
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
        attempts,
        cleared: prior.cleared || clearedNow,
        firstTry: prior.firstTry || (clearedNow && prior.attempts === 0 && !supportWasUsed),
        recoveredAfterRepair: prior.recoveredAfterRepair || (clearedNow && (prior.attempts > 0 || supportWasUsed)),
        hintUsed: supportWasUsed,
        voiceAttempts: prior.voiceAttempts + (inputMode === "voice" ? 1 : 0),
        typedAttempts: prior.typedAttempts + (inputMode === "typed" ? 1 : 0),
      },
    };
    commitLearning(nextLearning);
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
    if (submittingRef.current || thinking || completed || !conversationUnlocked || !mission || !step) return;
    submittingRef.current = true;
    const sessionId = missionSessionRef.current;
    const attemptedStepIndex = stepIndex;
    const attemptsForStep = learningRef.current[stepLearningKey(attemptedStepIndex)]?.attempts ?? 0;
    const inputMode: BoliInputMode = payload.audioBase64 ? "voice" : "typed";
    setThinking(true);
    setError(null);
    try {
      const response = await fetch("/api/aamchi-boli/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId: mission.id, stepIndex: attemptedStepIndex, attemptsForStep, ...payload }),
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
    // ref a second click acquires a second stream and orphans the first —
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
        body: JSON.stringify({ text, slow }),
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
    setError(null);
    commitLearning(freshLearningState(mission));
    if (!preserveMap) setMap(null);
  };

  const chooseCharacter = (characterId: BoliCharacterId) => {
    const character = BOLI_CHARACTERS.find((candidate) => candidate.id === characterId);
    if (!character?.available) return;
    mapRequestRef.current += 1;
    setSelectedCharacterId(characterId);
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
    setView(selectedCharacter ? "choose-mission" : "choose-character");
  };

  const togglePhraseHelp = () => {
    const key = stepLearningKey(stepIndex);
    setShowHint((visible) => {
      const nextVisible = !visible;
      if (nextVisible) hintUsedByStepRef.current = { ...hintUsedByStepRef.current, [key]: true };
      return nextVisible;
    });
  };

  if (view === "choose-character") {
    return (
      <main className="relative min-h-dvh overflow-hidden bg-[#15110e] text-white">
        <Image
          src="/aamchi-boli/lobby/mumbai-monsoon-lobby.png"
          alt="A pixel-art Mumbai monsoon evening"
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(12,9,7,.88),rgba(12,9,7,.54)_52%,rgba(12,9,7,.76)),linear-gradient(0deg,rgba(12,9,7,.88),transparent_58%)]" />
        <div className="relative z-10 mx-auto flex min-h-dvh max-w-6xl flex-col px-5 py-8 sm:px-8">
        <header className="mb-10 flex items-start justify-between gap-6 border-b-2 border-[#fff6dd]/45 pb-6">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.22em] text-main">Mumbai speaks back</p>
            <h1 className="font-display text-5xl font-extrabold tracking-tight sm:text-7xl">Aamchi Boli</h1>
            <p className="mt-3 max-w-xl text-lg font-semibold text-[#fff6dd]/82">
              Learn Marathi by completing a real Mumbai conversation, not by tapping flashcards.
            </p>
          </div>
          <div className="hidden rounded-base border-2 border-border bg-main px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-black sm:block">
            <p>{BOLI_CHARACTERS.filter((character) => character.available).length} learning role{BOLI_CHARACTERS.filter((character) => character.available).length === 1 ? "" : "s"}</p>
            <p className="mt-1 text-foreground/70">Choose a point of view</p>
          </div>
        </header>

        <section>
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.18em] text-inksoft">Choose your point of view</p>
          <div className="grid gap-5 md:grid-cols-2">
            {BOLI_CHARACTERS.map((character) => (
              <article
                key={character.id}
                aria-current={selectedCharacterId === character.id ? "true" : undefined}
                className={`relative overflow-hidden rounded-base border-2 border-border p-6 text-black shadow-shadow transition-transform ${
                  character.available ? "bg-secondary-background" : "bg-secondary-background/55 opacity-75"
                }`}
              >
                {!character.available && <Lock className="absolute right-5 top-5 size-5 text-inksoft" />}
                {character.portraitAssetPath && (
                  <div className="relative mb-6 aspect-[16/10] overflow-hidden rounded-base border-2 border-border bg-[#ffd3ca] shadow-shadow">
                    <Image
                      src={character.portraitAssetPath}
                      alt={`Portrait of ${character.name}, ${character.role}`}
                      fill
                      sizes="(min-width: 768px) 50vw, 100vw"
                      className="object-cover object-center"
                      priority={character.available}
                    />
                    <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
                    <p className="absolute bottom-3 left-3 rounded-base border-2 border-black bg-[#fff6dd] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-black shadow-shadow">
                      {character.available ? "Playable role" : "Coming next"}
                    </p>
                  </div>
                )}
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-main">{character.hometown}</p>
                <h2 className="mt-2 font-display text-4xl font-extrabold">{character.name}</h2>
                <p className="mt-1 font-semibold text-inksoft">{character.role}</p>
                <p className="mt-5 max-w-sm leading-relaxed">{character.description}</p>
                {character.available ? (
                  <Button className="mt-7" size="lg" onClick={() => chooseCharacter(character.id)}>
                    Explore {character.name}&apos;s routes <Sparkles />
                  </Button>
                ) : (
                  <p className="mt-7 text-sm font-bold uppercase tracking-wide text-inksoft">Routes coming soon</p>
                )}
              </article>
            ))}
          </div>
          {!BOLI_CHARACTERS.some((character) => character.available) && (
            <p className="mt-5 rounded-base border-2 border-border bg-[#ffd3ca] p-4 font-semibold">
              No character routes are available yet. Add an available character and mission in the route catalogue.
            </p>
          )}
        </section>
        </div>
      </main>
    );
  }

  if (view === "choose-mission") {
    return (
      <main className="relative min-h-dvh overflow-hidden bg-[#15110e] text-white">
        <Image
          src="/aamchi-boli/lobby/mumbai-monsoon-lobby.png"
          alt="A pixel-art Mumbai monsoon evening"
          fill
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(12,9,7,.88),rgba(12,9,7,.54)_52%,rgba(12,9,7,.76)),linear-gradient(0deg,rgba(12,9,7,.88),transparent_58%)]" />
        <div className="relative z-10 mx-auto flex min-h-dvh max-w-6xl flex-col px-5 py-8 sm:px-8">
        <header className="mb-10 flex items-start justify-between gap-6 border-b-2 border-[#fff6dd]/45 pb-6">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.22em] text-main">Aamchi Boli · choose a route</p>
            <h1 className="font-display text-5xl font-extrabold tracking-tight sm:text-6xl">
              {selectedCharacter ? `${selectedCharacter.name}'s Mumbai` : "Mumbai missions"}
            </h1>
            <p className="mt-3 max-w-2xl text-lg font-semibold text-[#fff6dd]/82">
              Each route is a practical conversation Gemini assesses for intent, polite Marathi, and recovery after feedback.
            </p>
          </div>
          <Button variant="neutral" onClick={() => setView("choose-character")}>Change character</Button>
        </header>

        {selectedCharacter ? (
          <section>
            <div className="mb-5 rounded-base border-2 border-border bg-main p-5 text-black shadow-shadow">
              <p className="text-xs font-bold uppercase tracking-[0.16em]">Playing as {selectedCharacter.name}</p>
              <p className="mt-1 font-display text-2xl font-extrabold">{selectedCharacter.role}</p>
              <p className="mt-2 max-w-2xl font-semibold">{selectedCharacter.description}</p>
            </div>
            {characterMissions.length ? (
              <div className="grid gap-5 md:grid-cols-2">
                {characterMissions.map((candidate) => (
                  <article key={candidate.id} className="flex flex-col rounded-base border-2 border-border bg-secondary-background p-6 text-black shadow-shadow">
                    <p className="flex items-center gap-1 text-xs font-bold uppercase tracking-[0.16em] text-main"><MapPin size={14} /> {candidate.area}</p>
                    <h2 className="mt-3 font-display text-3xl font-extrabold">{candidate.title}</h2>
                    <p className="mt-3 leading-relaxed">{candidate.briefing}</p>
                    <div className="mt-5 rounded-base border-2 border-border/20 bg-white/60 p-3 text-sm font-semibold">
                      <p>Talk with {candidate.npcName}, {candidate.npcRole.toLowerCase()}.</p>
                      <p className="mt-1 text-inksoft">{candidate.steps.length} Gemini-scored speaking goal{candidate.steps.length === 1 ? "" : "s"}</p>
                    </div>
                    <Button className="mt-6 w-full" size="lg" disabled={!candidate.steps.length} onClick={() => void beginMission(candidate)}>
                      {candidate.steps.length ? `Start ${candidate.title}` : "Route in development"} <Sparkles />
                    </Button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-base border-2 border-border bg-[#ffd3ca] p-6 text-black shadow-shadow">
                <h2 className="font-display text-3xl font-extrabold">No route is ready for {selectedCharacter.name} yet.</h2>
                <p className="mt-2 max-w-xl font-semibold text-inksoft">Choose another point of view while the next Mumbai conversation is prepared.</p>
              </div>
            )}
          </section>
        ) : (
          <div className="rounded-base border-2 border-border bg-[#ffd3ca] p-6 text-black shadow-shadow">
            <p className="font-semibold">That character route is no longer available. Choose another point of view.</p>
          </div>
        )}
        </div>
      </main>
    );
  }

  if (!mission || !step) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-3xl items-center px-5 py-8 sm:px-8">
        <section className="w-full rounded-base border-2 border-border bg-secondary-background p-7 shadow-shadow">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-inksoft">Route unavailable</p>
          <h1 className="mt-2 font-display text-4xl font-extrabold">Choose a playable Mumbai mission.</h1>
          <p className="mt-3 font-semibold text-inksoft">The selected route is missing its conversation steps, so there is nothing for Gemini to assess yet.</p>
          <Button className="mt-6" onClick={returnToMissionPicker}>Back to routes</Button>
        </section>
      </main>
    );
  }

  return (
    <main className="relative isolate min-h-dvh overflow-x-hidden bg-[#15110e] text-white">
      <div className="absolute inset-0">
        {reaction?.image ? (
          <Image
            src={reaction.image}
            alt={`A Gemini-generated celebration for ${mission.title}`}
            fill
            unoptimized
            sizes="100vw"
            className="object-cover"
          />
        ) : map?.image ? (
          <Image
            src={map.image}
            alt={`A Gemini-generated pixel-art view of ${mission.area}`}
            fill
            unoptimized
            sizes="100vw"
            className="object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_62%_34%,#f7b84b_0%,#b65a31_28%,#44362b_62%,#17120f_100%)]" />
        )}
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(9,7,5,.72),transparent_35%,rgba(9,7,5,.18)_55%,rgba(9,7,5,.96))]" />

      <div className="relative z-10 flex min-h-dvh flex-col">
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
              <p className="truncate text-[10px] font-bold uppercase tracking-[0.18em] text-[#fff6dd]/72">{selectedCharacter?.name ?? "Learner"}&apos;s Mumbai</p>
              <p className="truncate font-display text-lg font-extrabold sm:text-xl">{mission.title}</p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
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
                const complete = index < stepIndex;
                return (
                  <div key={`${item.skill}-${index}`} className="mt-3 flex items-center gap-2 text-sm font-semibold">
                    <CheckCircle2 size={16} className={complete ? "text-green-700" : "text-inksoft"} />
                    <span className={complete ? "" : "text-inksoft"}>{item.objective}</span>
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
              </div>
              {learningSummary.totalAttempts > 0 ? (
                <p className="mt-3 border-t-2 border-black/15 pt-3 text-xs font-semibold text-inksoft">
                  Evidence: {learningSummary.voiceAttempts} spoken, {learningSummary.typedAttempts} typed, {learningSummary.totalAttempts} Gemini-scored attempt{learningSummary.totalAttempts === 1 ? "" : "s"}.
                </p>
              ) : (
                <p className="mt-3 border-t-2 border-black/15 pt-3 text-xs font-semibold text-inksoft">Your first Gemini-scored turn will create this record.</p>
              )}
              {learningSummary.hintsUsed > 0 && <p className="mt-2 text-xs font-bold">Adaptive support used on {learningSummary.hintsUsed} goal{learningSummary.hintsUsed === 1 ? "" : "s"}.</p>}
              {bestMastery !== null && <p className="mt-2 text-xs font-bold">Best saved on this device: {bestMastery}%</p>}
            </article>
          </aside>
        )}

        <section className="relative flex min-h-[21dvh] flex-1 items-end px-4 pb-4 sm:min-h-[27dvh] sm:px-6 sm:pb-6">
          {/* Characters stay on the map through the whole mission; only the
              walking controls retire once the conversation begins. */}
          {!loadingMap && !completed && (
            <BoliWorldControls
              characterId={selectedCharacter?.id}
              characterName={selectedCharacter?.name ?? "Learner"}
              npcName={mission.npcName}
              npcId={mission.id}
              npcPosition={mission.npcPosition}
              playerStart={mission.playerStart}
              walkable={mission.walkable}
              blockers={mission.blockers}
              enabled={!conversationUnlocked && !thinking && !recording}
              canInteract
              showControls={!conversationUnlocked}
              npcTalking={conversationUnlocked}
              onInteract={() => setConversationUnlocked(true)}
              onProximityChange={setNpcInRange}
            />
          )}
          {loadingMap ? (
            <div className="inline-flex items-center gap-2 rounded-base border-2 border-black bg-[#fff6dd] px-4 py-3 text-sm font-bold text-black shadow-shadow">
              <Sparkles className="animate-pulse" size={16} /> Nano Banana is painting {mission.area}…
            </div>
          ) : completed ? (
            <div className="max-w-xl rounded-base border-2 border-black bg-[#d9ff83] p-4 text-black shadow-shadow">
              <p className="flex items-center gap-2 font-display text-2xl font-extrabold"><CheckCircle2 /> Mission complete!</p>
              <p className="mt-1 font-semibold">You completed {mission.title} in practical Marathi.</p>
              {loadingReaction && <p className="mt-2 flex items-center gap-1 text-sm font-bold"><Sparkles className="animate-pulse" size={15} /> Nano Banana is illustrating your earned moment…</p>}
              {reactionNote && <p className="mt-2 text-xs font-semibold text-inksoft">{reactionNote}</p>}
            </div>
          ) : !conversationUnlocked ? (
            <div className="absolute left-4 top-4 z-10 max-w-xl rounded-base border-2 border-black bg-[#fff6dd] p-4 text-black shadow-shadow sm:left-6 sm:top-6">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-inksoft">Explore before you speak</p>
              <p className="mt-1 font-display text-xl font-extrabold">Walk to {mission.npcName} on the map.</p>
              <p className="mt-1 text-sm font-semibold text-inksoft">Use WASD / arrow keys, then press E or Enter when the Talk prompt lights up.</p>
            </div>
          ) : (
            <div className="relative z-10 max-w-xl rounded-base border-2 border-black bg-[#fff6dd] p-4 text-black shadow-shadow">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-inksoft">Quest {stepIndex + 1} of {mission.steps.length}</p>
              <p className="mt-1 font-display text-xl font-extrabold">{step.objective}</p>
            </div>
          )}

          {activeTurn && !completed && activeTurn.supportRecommendation !== "none" && (
            <div className="absolute right-4 top-4 max-w-[255px] rounded-base border-2 border-black bg-main p-3 text-black shadow-shadow sm:right-6 sm:top-6">
              <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em]"><Sparkles size={13} /> Live Gemini cue</p>
              <p className="mt-1 text-sm font-bold">{supportCopy(activeTurn.supportRecommendation)}</p>
            </div>
          )}
        </section>

        <section className="relative z-20 border-t-2 border-white/35 bg-[#100d0b]/95 shadow-[0_-12px_40px_rgba(0,0,0,.32)] backdrop-blur-md">
          <div className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(340px,.75fr)] lg:px-6">
            <div className="no-scrollbar max-h-[39dvh] space-y-3 overflow-y-auto pr-1">
              {!completed ? (
                !conversationUnlocked ? (
                  <article className="rounded-base border-2 border-black bg-[#fff6dd] p-4 text-black shadow-shadow">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-inksoft">Mumbai is the classroom</p>
                    <p className="mt-1 font-display text-2xl font-extrabold">Find {mission.npcName} before starting the exchange.</p>
                    <p className="mt-2 font-semibold text-inksoft">Move your pixel character with WASD or arrow keys. The yellow Talk button turns active only when you are close enough.</p>
                    <p className={`mt-3 inline-flex rounded-base border-2 border-black px-3 py-2 text-sm font-bold ${npcInRange ? "bg-[#d9ff83]" : "bg-[#ffd3ca]"}`}>
                      {npcInRange ? `You are next to ${mission.npcName}. Press E to talk.` : `${mission.npcName} is ahead on the map — walk closer.`}
                    </p>
                  </article>
                ) : (
                  <>
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

                    {recentlyClearedTurn && (
                      <article className="rounded-base border-2 border-black bg-[#d9ff83] p-4 text-black shadow-shadow">
                        <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-inksoft"><CheckCircle2 size={14} /> Checkpoint cleared</p>
                        <p className="mt-1 font-bold">{recentlyClearedTurn.adaptiveFeedback.whatWorked}</p>
                        <p className="mt-2 text-sm font-semibold">Next: {step.objective}</p>
                      </article>
                    )}

                    {activeTurn && (
                      <article className="rounded-base border-2 border-black bg-[#d9ff83] p-4 text-black shadow-shadow">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-inksoft">Gemini&apos;s adaptive practice coach · level {activeTurn.adaptiveFeedback.level}/2</p>
                        <p className="mt-1 font-bold">{activeTurn.intent}</p>
                        <div className="mt-3 rounded-base border-2 border-black/15 bg-white/60 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-inksoft">
                            Gemini heard via {activeTurn.inputMode === "voice" ? "your voice" : "typed practice"}
                          </p>
                          <p className="mt-1 text-sm font-semibold leading-snug">{activeTurn.heardMarathi || activeTurn.transcript || "No clear transcript"}</p>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-base border-2 border-black/15 bg-white/60 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-inksoft">What worked</p>
                            <p className="mt-1 text-sm font-semibold">{activeTurn.adaptiveFeedback.whatWorked}</p>
                          </div>
                          <div className="rounded-base border-2 border-black/15 bg-white/60 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-inksoft">One next move</p>
                            <p className="mt-1 text-sm font-semibold">{activeTurn.adaptiveFeedback.nextFocus}</p>
                          </div>
                        </div>
                        <p className="mt-3 text-lg font-bold leading-snug">{activeTurn.npcLineMr}</p>
                        <p className="mt-1 text-sm font-medium text-inksoft">{activeTurn.npcLineEn}</p>
                        <Button
                          variant="neutral"
                          size="sm"
                          className="mt-3"
                          disabled={speaking}
                          aria-label={speaking ? "Gemini voice is speaking" : "Hear Gemini voice"}
                          onClick={() => void speakNpc(activeTurn.npcLineMr)}
                        >
                          <Volume2 size={15} /> {speaking ? "Speaking…" : "Hear reply"}
                        </Button>
                        <div className="mt-4 border-t-2 border-black/20 pt-3">
                          <p className="text-xs font-bold uppercase tracking-[0.14em] text-inksoft">Build this small part</p>
                          <p className="mt-1 font-bold">{activeTurn.adaptiveFeedback.keyChunk.marathi}</p>
                          <p className="text-sm italic text-inksoft">{activeTurn.adaptiveFeedback.keyChunk.transliteration}</p>
                          <p className="mt-1 text-sm">{activeTurn.adaptiveFeedback.keyChunk.meaning}</p>
                          <Button
                            variant="neutral"
                            size="sm"
                            className="mt-3"
                            disabled={speaking}
                            onClick={() => void speakNpc(activeTurn.adaptiveFeedback.keyChunk.marathi, true)}
                          >
                            <Volume2 size={15} /> {speaking ? "Speaking…" : "Hear slowly"}
                          </Button>
                        </div>
                        {activeTurn.recast && (
                          <div className="mt-4 border-t-2 border-black/20 pt-3">
                            <p className="text-xs font-bold uppercase tracking-[0.14em] text-inksoft">Then say it naturally</p>
                            <p className="mt-1 font-bold">{activeTurn.recast.marathi}</p>
                            <p className="text-sm italic text-inksoft">{activeTurn.recast.transliteration}</p>
                            <p className="mt-1 text-sm">{activeTurn.recast.meaning}</p>
                          </div>
                        )}
                      </article>
                    )}

                    {showHint && activeTurn?.supportRecommendation === "phrase_fragment" && (
                      <article className="rounded-base border-2 border-black bg-main p-4 text-black shadow-shadow">
                        <p className="text-xs font-bold uppercase tracking-[0.14em]">Phrase fragment</p>
                        <p className="mt-1 font-bold">{activeTurn.adaptiveFeedback.keyChunk.marathi}</p>
                        <p className="mt-1 text-sm italic">{activeTurn.adaptiveFeedback.keyChunk.transliteration}</p>
                        <p className="mt-1 text-sm">{activeTurn.adaptiveFeedback.keyChunk.meaning}</p>
                      </article>
                    )}

                    {showHint && activeTurn?.supportRecommendation === "visual_hint" && (
                      <article className="rounded-base border-2 border-black bg-main p-4 text-black shadow-shadow">
                        <p className="text-xs font-bold uppercase tracking-[0.14em]">Map cue</p>
                        <p className="mt-1 font-bold">Picture the conversation at {mission.area} with {mission.npcName}; answer only the current practical goal.</p>
                      </article>
                    )}

                    {showHint && activeTurn?.supportRecommendation === "slow_repeat" && (
                      <article className="rounded-base border-2 border-black bg-main p-4 text-black shadow-shadow">
                        <p className="text-xs font-bold uppercase tracking-[0.14em]">Slow practice unlocked</p>
                        <p className="mt-1 font-bold">Repeat the small part above once, then rebuild your own answer. You do not need to copy a perfect sentence.</p>
                      </article>
                    )}

                    {showHint && !activeTurn && (
                      <article className="rounded-base border-2 border-black bg-main p-4 text-black shadow-shadow">
                        <p className="text-xs font-bold uppercase tracking-[0.14em]">Optional phrase support</p>
                        <p className="mt-1 font-bold">{step.targetPhraseMr}</p>
                        <p className="mt-1 text-sm italic">{step.targetPhraseLatin}</p>
                        <p className="mt-1 text-sm">{step.targetPhraseEn}</p>
                        <p className="mt-2 text-xs font-semibold">This counts as supported practice, not an independent first try.</p>
                      </article>
                    )}
                  </>
                )
              ) : (
                <article className="rounded-base border-2 border-black bg-[#d9ff83] p-4 text-black shadow-shadow">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-inksoft">Route reflection</p>
                  <p className="mt-1 font-display text-2xl font-extrabold">{learningSummary.mastery}% practical mastery</p>
                  <p className="mt-2 font-semibold">You cleared {learningSummary.cleared} of {mission.steps.length} real-world speaking goal{mission.steps.length === 1 ? "" : "s"} as {selectedCharacter?.name ?? "the learner"}.</p>
                  {reaction?.image && <p className="mt-2 text-sm font-bold">Your earned Mumbai moment is now on the map.</p>}
                </article>
              )}
            </div>

            <aside className="rounded-base border-2 border-black bg-[#fff6dd] p-4 text-black shadow-shadow">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-inksoft">{conversationUnlocked || completed ? "Speak your way forward" : "Walk your way forward"}</p>
              <div className="mt-1 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl font-extrabold">{mission.npcName}</h2>
                  <p className="mt-1 text-sm font-semibold text-inksoft">{selectedCharacter?.name ?? "Learner"} · {mission.npcRole}</p>
                </div>
                {!completed && <p className="rounded-base border-2 border-black/25 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em]">Step {stepIndex + 1}/{mission.steps.length}</p>}
              </div>

              {error && <p className="mt-3 rounded-base border-2 border-black bg-[#ffd3ca] p-2 text-sm font-semibold">{error}</p>}
              {completed ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                  <Button onClick={() => resetMission()}><Sparkles /> Play again</Button>
                  <Button variant="neutral" onClick={returnToMissionPicker}>Choose a route</Button>
                </div>
              ) : !conversationUnlocked ? (
                <div className="mt-4">
                  <p className="text-sm font-semibold text-inksoft">{npcInRange ? `${mission.npcName} can hear you now.` : `Find the ${mission.npcName} target marker in the world.`}</p>
                  <Button
                    className="mt-3 w-full"
                    disabled={!npcInRange || thinking || recording}
                    onClick={() => setConversationUnlocked(true)}
                  >
                    <Sparkles /> {npcInRange ? `Talk to ${mission.npcName}` : "Walk closer to talk"}
                  </Button>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.12em] text-inksoft">WASD / arrows to move · E / Enter to interact</p>
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
                    {recording ? "Tap to send your answer" : thinking ? "Gemini is listening…" : "Record a Marathi turn"}
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
                    <Button type="submit" size="icon" disabled={thinking || recording || !typedResponse.trim()}><Send /></Button>
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
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
