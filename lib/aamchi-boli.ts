import { Buffer } from "node:buffer";
import { ThinkingLevel, Type } from "@google/genai";
import { generateContentWithRetry, generateImage, toDataUrl } from "./gemini";
import { BOLI_MISSIONS } from "./boli-config";
import type { BoliTurnBody } from "./types/server";
import type { BoliMapResponse, BoliReactionResponse, BoliTurnResponse, BoliVoiceResponse } from "./types/client";
import type { BoliMission, BoliMissionStep, BoliSkillId } from "./types/shared";

// Fast multimodal model for every live game turn; keep image/voice models separate.
const BOLI_SCORING_MODEL = process.env.BOLI_SCORING_MODEL || "gemini-3.5-flash-lite";

/**
 * An error whose message is safe to show a learner, carrying the status the
 * route should use. Anything thrown that is *not* a `BoliError` is unexpected,
 * so routes log it and return a generic 503 rather than leaking SDK internals.
 */
export class BoliError extends Error {
  readonly status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = "BoliError";
    this.status = status;
  }
}

/** Shared visual direction keeps every generated Mumbai scene in one game world. */
const BOLI_STYLE_BIBLE =
  "True overhead top-view 2D 16-bit retro RPG map, warm monsoon Mumbai palette, crisp pixel-art tiles, wet laterite and paving textures, yellow-and-black auto rickshaws, walkable paving, layered tree canopies, campus details, bright readable gameplay landmarks, balanced composition with clear routes, no text, no logos, no watermark.";

const BOLI_REACTION_STYLE =
  "Detailed 16-bit pixel-art RPG celebration cutscene, warm Mumbai monsoon atmosphere, expressive but respectful characters, rich environmental storytelling, cinematic framing, crisp pixel edges, no text, no logos, no watermark.";

const turnSchema = {
  type: Type.OBJECT,
  properties: {
    transcript: { type: Type.STRING },
    heardMarathi: { type: Type.STRING },
    intent: { type: Type.STRING },
    outcome: {
      type: Type.STRING,
      enum: ["success", "partial", "repair_needed", "hint_needed"],
    },
    npcLineMr: { type: Type.STRING },
    npcLineEn: { type: Type.STRING },
    recast: {
      type: Type.OBJECT,
      properties: {
        marathi: { type: Type.STRING },
        transliteration: { type: Type.STRING },
        meaning: { type: Type.STRING },
      },
      required: ["marathi", "transliteration", "meaning"],
    },
    coaching: {
      type: Type.OBJECT,
      properties: {
        whatWorked: { type: Type.STRING },
        nextFocus: { type: Type.STRING },
        keyChunk: {
          type: Type.OBJECT,
          properties: {
            marathi: { type: Type.STRING },
            transliteration: { type: Type.STRING },
            meaning: { type: Type.STRING },
          },
          required: ["marathi", "transliteration", "meaning"],
        },
      },
      required: ["whatWorked", "nextFocus", "keyChunk"],
    },
    skillEvidence: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
        enum: ["greeting", "destination", "confirmation", "polite_closing", "clarification"],
      },
    },
    supportRecommendation: {
      type: Type.STRING,
      enum: ["none", "visual_hint", "phrase_fragment", "slow_repeat"],
    },
    reactionPrompt: { type: Type.STRING },
  },
  required: [
    "transcript",
    "heardMarathi",
    "intent",
    "outcome",
    "npcLineMr",
    "npcLineEn",
    "skillEvidence",
    "supportRecommendation",
    "coaching",
  ],
};

/** Validated, code-owned facts about a finished run, used to steer the art. */
export type BoliReactionPerformance = {
  independentClears: number;
  recoveredClears: number;
  voiceTurns: number;
};

/** Return the fixed scenario only when it belongs to the selected character. */
export function getBoliMission(id: string, characterId?: string): BoliMission | null {
  const mission = BOLI_MISSIONS.find((item) => item.id === id) ?? null;
  if (mission && characterId && mission.characterId !== characterId) return null;
  return mission;
}

/** Generate a single fixed RPG map while keeping mission mechanics code-owned. */
export async function generateBoliMap(mission: BoliMission): Promise<BoliMapResponse> {
  if (mission.mapAssetPath) {
    return {
      mission,
      image: mission.mapAssetPath,
      fallback: false,
      source: "prebuilt",
    };
  }
  const image = await generateImage(mission.mapPrompt, BOLI_STYLE_BIBLE, null);
  if (image.fallback) {
    throw new BoliError(`Nano Banana could not paint this map. ${image.failureReason ?? ""}`.trim(), 503);
  }
  return {
    mission,
    image: toDataUrl(image.b64, image.mimeType),
    fallback: image.fallback,
    source: "generated",
  };
}

/** Generate the learner-specific payoff frame only after a mission has been earned. */
export async function generateBoliReaction(
  mission: BoliMission,
  modelPrompt?: string,
  performance?: BoliReactionPerformance
): Promise<BoliReactionResponse> {
  // Build the learner-specific clause from validated numbers rather than from
  // client free text, so the earned frame reflects the real run and the image
  // prompt stays code-owned.
  const beats: string[] = [];
  if (performance) {
    const { independentClears, recoveredClears, voiceTurns } = performance;
    if (independentClears > 0) {
      beats.push(
        `${mission.npcName} understood the learner first time on ${independentClears} of ${mission.steps.length} exchanges, so show her reacting with genuine, unforced warmth`
      );
    }
    if (recoveredClears > 0) {
      beats.push(
        `the learner had to repair and retry ${recoveredClears} time${recoveredClears === 1 ? "" : "s"} before being understood, so show quiet mutual relief and encouragement rather than triumph`
      );
    }
    if (voiceTurns > 0) {
      beats.push("the learner spoke aloud rather than typing, so show them mid-gesture as someone who has just finished talking");
    }
  }
  const learnerBeat = beats.length ? ` Earned emotional beat for this specific run: ${beats.join("; ")}.` : "";
  const modelBeat = modelPrompt?.trim() ? ` Learner-specific moment: ${modelPrompt.trim().slice(0, 400)}` : "";
  const visualPrompt = `${mission.reactionPrompt}${learnerBeat}${modelBeat}`;
  const image = await generateImage(visualPrompt, BOLI_REACTION_STYLE, null);
  if (image.fallback) {
    throw new BoliError(
      `Nano Banana could not create the celebration frame. ${image.failureReason ?? ""}`.trim(),
      503
    );
  }
  return { image: toDataUrl(image.b64, image.mimeType), fallback: image.fallback };
}

function activeStep(mission: BoliMission, stepIndex: number): BoliMissionStep {
  return mission.steps[Math.min(Math.max(0, stepIndex), mission.steps.length - 1)];
}

function asOutcome(value: unknown): BoliTurnResponse["outcome"] {
  return value === "success" || value === "partial" || value === "repair_needed" || value === "hint_needed"
    ? value
    : "hint_needed";
}

function asSupport(value: unknown): BoliTurnResponse["supportRecommendation"] {
  return value === "none" || value === "visual_hint" || value === "phrase_fragment" || value === "slow_repeat"
    ? value
    : "phrase_fragment";
}

function safeSkills(value: unknown, currentSkill: BoliSkillId): BoliSkillId[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set<BoliSkillId>([
    "greeting",
    "destination",
    "confirmation",
    "polite_closing",
    "clarification",
  ]);
  return [...new Set(value.filter((skill): skill is BoliSkillId => typeof skill === "string" && valid.has(skill as BoliSkillId)))].filter(
    (skill) => skill === currentSkill
  );
}

/** Clamp client-reported retry count; progression and support escalation stay server-owned. */
function priorAttemptCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.floor(value), 0), 3);
}

function shortText(value: unknown, fallback: string, max = 160): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

/**
 * Gemini supplies response-specific wording, while the app decides how much help
 * to reveal. This produces a visible, repeatable adaptive teaching ladder.
 */
function buildAdaptiveFeedback(
  raw: Record<string, unknown>,
  step: BoliMissionStep,
  didAdvance: boolean,
  attemptsBeforeThisTurn: number
): BoliTurnResponse["adaptiveFeedback"] {
  // Ladder: clear = 0, first miss = 1 (recast), second and later misses = 2
  // (guided rebuild). `attemptsBeforeThisTurn` excludes the current attempt, so
  // 1 prior attempt means this is the second miss.
  const level: 0 | 1 | 2 = didAdvance ? 0 : attemptsBeforeThisTurn >= 1 ? 2 : 1;
  const strategy = didAdvance ? "affirm" : level === 1 ? "recast" : "guided_rebuild";
  const coaching = raw.coaching && typeof raw.coaching === "object" ? (raw.coaching as Record<string, unknown>) : {};
  const rawChunk = coaching.keyChunk && typeof coaching.keyChunk === "object"
    ? (coaching.keyChunk as Record<string, unknown>)
    : {};

  return {
    level,
    strategy,
    whatWorked: shortText(
      coaching.whatWorked,
      didAdvance ? "Your practical meaning was clear." : "You made a useful attempt at the conversation."
    ),
    nextFocus: shortText(
      coaching.nextFocus,
      didAdvance
        ? "Carry that same clear Marathi into the next exchange."
        : level === 2
          ? "Repeat this small chunk slowly, then rebuild the sentence."
          : "Add this one missing idea, then try again."
    ),
    keyChunk: {
      marathi: shortText(rawChunk.marathi, step.targetPhraseMr, 120),
      transliteration: shortText(rawChunk.transliteration, step.targetPhraseLatin, 140),
      meaning: shortText(rawChunk.meaning, step.targetPhraseEn, 140),
    },
  };
}

/**
 * Score one learner utterance from direct audio or a typed accessibility fallback.
 * Gemini judges whether the learner's intent is understandable, never their accent.
 */
export async function evaluateBoliTurn(body: BoliTurnBody): Promise<BoliTurnResponse> {
  const mission = getBoliMission(body.missionId);
  if (!mission) throw new BoliError("Unknown Marathi mission.", 404);
  const stepIndex = Math.min(Math.max(0, body.stepIndex), mission.steps.length - 1);
  const step = activeStep(mission, stepIndex);
  const hasAudio = Boolean(body.audioBase64 && body.audioMimeType);
  const typed = body.typedResponse?.trim().slice(0, 300) ?? "";
  const attemptsBeforeThisTurn = priorAttemptCount(body.attemptsForStep);
  if (!hasAudio && !typed) throw new BoliError("Speak or type a response first.", 400);

  const context = [
    "You are the language-aware game master for Aamchi Boli, a Marathi learning RPG for an English-speaking beginner in Mumbai.",
    `MISSION: ${mission.title}. AREA: ${mission.area}.`,
    `NPC: ${mission.npcName}, ${mission.npcRole}.`,
    `CURRENT OBJECTIVE: ${step.objective}`,
    `NPC JUST SAID (Marathi): ${step.npcPromptMr}`,
    `NPC JUST SAID (English): ${step.npcPromptEn}`,
    "",
    "=== THE ONLY PASS CONDITION ===",
    `To clear this objective the learner must get this across: ${step.successCriteria}`,
    "Judge the learner ONLY against that pass condition. If a real Mumbai listener would have understood them and acted correctly, the objective is cleared.",
    "",
    "=== ONE MODEL ANSWER (a reference, NOT a requirement) ===",
    `Marathi: ${step.targetPhraseMr}`,
    `Transliteration: ${step.targetPhraseLatin}`,
    `Meaning: ${step.targetPhraseEn}`,
    "The learner does NOT have to reproduce this sentence, its word order, its length, or its formal noun phrases. Never withhold success because their answer was shorter or simpler than this reference.",
    "",
    "=== HOW TO SCORE ===",
    "Judge communicative intent, never accent, never spelling. Devanagari, Latin transliteration, and understandable mixed Marathi/English/Hindi are all valid learner attempts.",
    "success: the pass condition is met. Grammar slips, missing honorifics, a missing greeting, English loanwords, and casual phrasing are all fine. When in doubt between success and partial, choose success.",
    "partial: they are clearly attempting this objective and are close, but one required piece of meaning from the pass condition is missing.",
    "repair_needed: they said something understandable but wrong for this objective, so the NPC would naturally ask again.",
    "hint_needed: the meaning is not recoverable at all, or nothing usable was said.",
    `IMPORTANT: whenever outcome is "success" you MUST include "${step.skill}" in skillEvidence, otherwise the learner is wrongly held back.`,
    `PRIOR ATTEMPTS ON THIS EXACT OBJECTIVE: ${attemptsBeforeThisTurn}.`,
    "",
    "=== WRITING THE REPLY ===",
    "NPC lines must be warm, culturally respectful, at most two short sentences, and in Marathi first. npcLineEn must be a concise English meaning, not a lesson.",
    "When correcting, make recast a gentle natural reformulation. Do not shame, grade, mention AI, invent facts, change the destination, or add tasks.",
    "Always return coaching in English: whatWorked must name one genuine strength, nextFocus must name exactly one actionable improvement, and keyChunk must be the smallest helpful Marathi chunk with transliteration and meaning.",
    "Adaptive rule: on a first missed attempt, give one light correction plus a natural recast. On a second missed attempt, isolate the missing practical chunk. On a third or later missed attempt, keep keyChunk to one short repeatable fragment and make nextFocus a slow guided rebuild. On success, affirm briefly and do not reveal extra support.",
    "Return JSON only.",
  ].join("\n");

  const contents: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
    { text: context },
  ];
  if (hasAudio) {
    contents.push({
      inlineData: {
        data: body.audioBase64!,
        mimeType: body.audioMimeType!,
      },
    });
  } else {
    contents.push({ text: `LEARNER TYPED: ${typed}` });
  }

  const response = await generateContentWithRetry({
    model: BOLI_SCORING_MODEL,
    contents,
    config: {
      responseMimeType: "application/json",
      responseSchema: turnSchema,
      temperature: 0.25,
      // A live conversation should feel responsive while still using audio understanding.
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
    },
  });
  const finishReason = response.candidates?.[0]?.finishReason;
  if (!response.text) {
    // A safety block and a token ceiling both arrive as empty text; say which.
    const blocked = response.promptFeedback?.blockReason;
    throw new BoliError(
      blocked
        ? `Gemini declined to score that turn (${blocked}). Try rephrasing your answer.`
        : finishReason === "MAX_TOKENS"
          ? "Gemini ran out of room before it finished that turn. Please try again."
          : "Gemini returned an empty learning turn.",
      503
    );
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(response.text) as Record<string, unknown>;
  } catch {
    // Truncated or fenced JSON must never surface a raw SyntaxError in the game UI.
    console.error("[evaluateBoliTurn] unparseable model output", {
      finishReason,
      sample: response.text.slice(0, 400),
    });
    throw new BoliError("Gemini's reply came back incomplete. Please try that answer again.", 503);
  }
  const modelOutcome = asOutcome(raw.outcome);
  const awardedSkills = safeSkills(raw.skillEvidence, step.skill);
  // A malformed optimistic response cannot unlock a fixed route without naming its current skill.
  const outcome = modelOutcome === "success" && awardedSkills.length === 0 ? "partial" : modelOutcome;
  const didAdvance = outcome === "success";
  const nextStep = didAdvance ? Math.min(stepIndex + 1, mission.steps.length) : stepIndex;
  const completed = didAdvance && nextStep === mission.steps.length;
  const recast = raw.recast as Record<string, unknown> | undefined;
  const adaptiveFeedback = buildAdaptiveFeedback(raw, step, didAdvance, attemptsBeforeThisTurn);
  const modelSupport = asSupport(raw.supportRecommendation);
  const supportRecommendation = didAdvance
    ? "none"
    : adaptiveFeedback.level === 2
      ? "slow_repeat"
      : modelSupport === "none"
        ? "phrase_fragment"
        : modelSupport;

  return {
    inputMode: hasAudio ? "voice" : "typed",
    transcript: typeof raw.transcript === "string" ? raw.transcript.slice(0, 300) : typed,
    heardMarathi: typeof raw.heardMarathi === "string" ? raw.heardMarathi.slice(0, 300) : "",
    intent: typeof raw.intent === "string" ? raw.intent.slice(0, 80) : "unclear",
    outcome,
    npcLineMr:
      typeof raw.npcLineMr === "string" && raw.npcLineMr.trim()
        ? raw.npcLineMr.slice(0, 260)
        : step.npcPromptMr,
    npcLineEn:
      typeof raw.npcLineEn === "string" && raw.npcLineEn.trim()
        ? raw.npcLineEn.slice(0, 260)
        : step.npcPromptEn,
    recast:
      recast &&
      typeof recast.marathi === "string" &&
      typeof recast.transliteration === "string" &&
      typeof recast.meaning === "string"
        ? {
            marathi: recast.marathi.slice(0, 220),
            transliteration: recast.transliteration.slice(0, 220),
            meaning: recast.meaning.slice(0, 220),
          }
        : outcome === "success"
          ? undefined
          : {
              marathi: step.targetPhraseMr,
              transliteration: step.targetPhraseLatin,
              meaning: step.targetPhraseEn,
            },
    skillEvidence: didAdvance ? awardedSkills : [],
    supportRecommendation,
    adaptiveFeedback,
    nextStep,
    completed,
    reactionPrompt:
      completed && typeof raw.reactionPrompt === "string"
        ? raw.reactionPrompt.slice(0, 500)
        : undefined,
  };
}

/** Turn Gemini's raw PCM16 response into a browser-playable WAV data URL. */
function pcm16ToWavDataUrl(base64: string, mimeType: string): string {
  if (!/^audio\/l16/i.test(mimeType)) return toDataUrl(base64, mimeType);

  const sampleRate = Number(/(?:^|;)\s*rate=(\d+)/i.exec(mimeType)?.[1]) || 24_000;
  const channels = Number(/(?:^|;)\s*channels=(\d+)/i.exec(mimeType)?.[1]) || 1;
  const pcm = Buffer.from(base64, "base64");
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const wav = Buffer.alloc(44 + pcm.length);

  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);

  return toDataUrl(wav.toString("base64"), "audio/wav");
}

/** Generate one short Marathi NPC line with Gemini native audio output. */
export async function synthesizeBoliVoice(text: string, options?: { slow?: boolean }): Promise<BoliVoiceResponse> {
  const pace = options?.slow
    ? "Speak it extra slowly, with tiny natural pauses between Marathi word groups so a beginner can repeat it."
    : "Speak it warmly and clearly at a natural conversational pace.";
  const response = await generateContentWithRetry({
    model: process.env.GEMINI_TTS_MODEL || "gemini-3.1-flash-tts-preview",
    contents: [
      {
        text: `${pace} Speak this exact Marathi dialogue as a helpful person in Mumbai: ${text}`,
      },
    ],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        languageCode: "mr-IN",
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
      },
    },
  });
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const audioPart = parts.find((part) => part.inlineData?.data)?.inlineData;
  if (!audioPart?.data) return { audio: null };
  return {
    audio: pcm16ToWavDataUrl(audioPart.data, audioPart.mimeType || "audio/l16;rate=24000;channels=1"),
  };
}
