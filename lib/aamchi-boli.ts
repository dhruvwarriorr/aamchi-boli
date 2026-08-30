import { Buffer } from "node:buffer";
import { ThinkingLevel, Type } from "@google/genai";
import { ai, generateContentWithRetry, generateImage, generateInteractionWithRetry, toDataUrl } from "./gemini";
import { BOLI_MISSIONS, BOLI_OPEN_WORLD_MISSION } from "./boli-config";
import type { BoliTurnBody } from "./types/server";
import type { BoliErrorCode, BoliMapResponse, BoliOmniWorldResponse, BoliReactionResponse, BoliReviewItem, BoliTurnResponse, BoliVoiceResponse } from "./types/client";
import type { BoliMission, BoliMissionStep, BoliSkillId } from "./types/shared";

// Fast multimodal model for every live game turn; keep image/voice models separate.
const BOLI_SCORING_MODEL = process.env.BOLI_SCORING_MODEL || "gemini-3.5-flash-lite";
const BOLI_CACHE_TTL = "3600s";

type BoliCacheEntry = { name: string; expiresAt: number };
let boliCurriculumCache: BoliCacheEntry | null = null;
let boliCacheInflight: Promise<string | null> | null = null;

/**
 * Gemini Cached Content has a minimum context size. Caching all nine fixed
 * objectives gives every live turn one useful, immutable curriculum context
 * instead of creating three undersized per-map cache entries.
 */
function fixedCurriculumContext(): string {
  return [
    "Aamchi Boli is a Marathi learning RPG for English-speaking beginners in Mumbai.",
    "Judge practical communicative intent, never accent, identity, spelling, or formal register. Devanagari, transliteration, and understandable Marathi-English/Hindi mixes are valid learner language.",
    "A learner clears a goal only when every concrete signal in that goal's pass condition is present. A vague yes never replaces a destination, landmark, agreement, or action. Grammar slips and missing honorifics are fine when the needed meaning is clear.",
    "On a miss: say one genuine thing understood, identify one concrete gap, offer only the smallest useful Marathi chunk, and use a warm natural recast. Never shame, grade, add curriculum objectives, or judge accent. On a clear response: affirm briefly and do not add correction work.",
    "Mission state belongs to the game, so score only the current objective and never invent steps or locations.",
    ...[...BOLI_MISSIONS, BOLI_OPEN_WORLD_MISSION].flatMap((route) => [
      `ROUTE ID: ${route.id}. ${route.title}; ${route.area}. NPC: ${route.npcName}, ${route.npcRole}.`,
      ...route.steps.map((step, index) => [
        `STEP ${index}: ${step.objective}`,
        `PASS CONDITION: ${step.successCriteria}`,
        `REFERENCE PHRASE: ${step.targetPhraseMr} | ${step.targetPhraseLatin} | ${step.targetPhraseEn}`,
      ].join("\n")),
    ]),
  ].join("\n\n");
}

/**
 * Explicitly cache the immutable route rubric. Every live turn then sends only
 * the learner's current response and tiny dynamic context. If a model/plan
 * does not allow explicit caching we transparently use the normal request path.
 */
async function ensureBoliContextCache(): Promise<string | null> {
  if (boliCurriculumCache && boliCurriculumCache.expiresAt > Date.now() + 30_000) return boliCurriculumCache.name;
  if (boliCacheInflight) return boliCacheInflight;
  const request = (async () => {
    try {
      const cache = await ai().caches.create({
        model: BOLI_SCORING_MODEL,
        config: {
          displayName: "aamchi-boli-fixed-curriculum",
          ttl: BOLI_CACHE_TTL,
          systemInstruction: "You are the strict, encouraging Marathi coach for a fixed game curriculum. Never change its objective or judge accent.",
          contents: [{
            role: "user",
            parts: [{ text: fixedCurriculumContext() }],
          }],
        },
      });
      if (!cache.name) return null;
      boliCurriculumCache = { name: cache.name, expiresAt: Date.now() + 3_540_000 };
      return cache.name;
    } catch (error) {
      console.warn("[AamchiBoli] explicit context cache unavailable; continuing without it", error instanceof Error ? error.message : error);
      return null;
    } finally {
      boliCacheInflight = null;
    }
  })();
  boliCacheInflight = request;
  return request;
}

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

/** Shared visual direction keeps generated scenes readable as real game levels. */
const BOLI_STYLE_BIBLE =
  "True overhead top-view 2D 16-bit retro RPG map, crisp pixel-art tiles, bright readable gameplay landmarks, balanced composition with clear routes and open walkable ground, no readable text, no logos, no UI, no watermark.";

const BOLI_REACTION_STYLE =
  "Detailed 16-bit pixel-art RPG celebration cutscene, warm Mumbai monsoon atmosphere, expressive but respectful characters, rich environmental storytelling, cinematic framing, crisp pixel edges, no text, no logos, no watermark.";

const BOLI_OMNI_MODEL = process.env.BOLI_OMNI_MODEL || "gemini-omni-1.1-flash";
const omniWorldCache = new Map<string, { expiresAt: number; result: BoliOmniWorldResponse }>();

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
    feedbackFocus: {
      type: Type.OBJECT,
      properties: {
        code: { type: Type.STRING, enum: ["missing_intent", "missing_detail", "unclear_audio", "politeness", "wording", "mixed_language"] },
        label: { type: Type.STRING },
      },
      required: ["code", "label"],
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
    "feedbackFocus",
  ],
};

/** Validated, code-owned facts about a finished run, used to steer the art. */
export type BoliReactionPerformance = {
  independentClears: number;
  recoveredClears: number;
  voiceTurns: number;
};

/** Return one fixed, code-owned learning scenario by id. */
export function getBoliMission(id: string): BoliMission | null {
  return [...BOLI_MISSIONS, BOLI_OPEN_WORLD_MISSION].find((item) => item.id === id) ?? null;
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

/** Generate a prompt-driven micro-scene without replacing the authoritative map. */
export async function generateBoliOmniWorld(mission: BoliMission, userPrompt: string): Promise<BoliOmniWorldResponse> {
  const cleanPrompt = userPrompt.trim().slice(0, 420);
  if (!cleanPrompt) throw new BoliError("Describe the world you want to explore.", 400);
  const key = `${mission.id}:${cleanPrompt.toLowerCase()}`;
  const cached = omniWorldCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.result, cacheHit: true };

  const isOpenWorld = mission.id === BOLI_OPEN_WORLD_MISSION.id;
  const staticContext = [
    "You are the live-world director for Aamchi Boli, a respectful Marathi learning RPG.",
    isOpenWorld
      ? "Turn the learner's request into an original, safe game world. It can be any place or imaginative setting. Keep a friendly guide encounter, an open path, and a clear landmark."
      : `The fixed location is ${mission.area}; preserve its identity and keep the ${mission.npcName} encounter readable.`,
    "Return a single concise visual scene description. Never add UI, readable text, logos, unsafe content, or new curriculum objectives.",
  ].join(" ");
  const schema = {
    type: Type.OBJECT,
    properties: {
      scene: { type: Type.STRING },
      learningMoment: { type: Type.STRING },
    },
    required: ["scene", "learningMoment"],
  };
  let directorText = "";
  let directorModel = BOLI_OMNI_MODEL;
  try {
    // Omni has a separate Interactions endpoint. It does not support explicit
    // cached content yet, so `omniWorldCache` below deduplicates the complete
    // prompt → scene → image result for fifteen minutes instead.
    const interaction = await generateInteractionWithRetry({
      model: BOLI_OMNI_MODEL,
      input: `${staticContext}\n\nLIVE PLAYER PROMPT: ${cleanPrompt}\nReturn JSON only: {"scene":"...","learningMoment":"..."}. learningMoment must be one short speaking cue, never a new quiz.`,
      response_modalities: ["text"],
    });
    directorText = "output_text" in interaction ? interaction.output_text || "" : "";
    if (!directorText) throw new Error("Omni returned no live-world direction.");
  } catch (error) {
    // Keep the feature demoable when Omni is not enabled on the current key.
    console.warn("[AamchiBoli] Omni model unavailable; using fast Gemini fallback", error instanceof Error ? error.message : error);
    directorModel = BOLI_SCORING_MODEL;
    const response = await generateContentWithRetry({
      model: BOLI_SCORING_MODEL,
      contents: [{ text: `${staticContext}\n\nLIVE PLAYER PROMPT: ${cleanPrompt}` }],
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.8,
      },
    });
    directorText = response.text || "";
  }
  let scene = cleanPrompt;
  let learningMoment = "Use the scene as a speaking cue, not a new quiz.";
  try {
    const parsed = JSON.parse(directorText) as { scene?: unknown; learningMoment?: unknown };
    if (typeof parsed.scene === "string" && parsed.scene.trim()) scene = parsed.scene.trim().slice(0, 700);
    if (typeof parsed.learningMoment === "string" && parsed.learningMoment.trim()) learningMoment = parsed.learningMoment.trim().slice(0, 240);
  } catch {
    // The visual still gets a safe, code-owned prompt if the director returned prose.
  }
  const image = await generateImage(
    `${mission.mapPrompt} LIVE WORLD ${isOpenWorld ? "CREATION" : "VARIATION"}: ${scene}. Keep an open walkable stage and do not render the guide or learner; sprites are added by the game.`,
    BOLI_STYLE_BIBLE,
    null
  );
  if (image.fallback) throw new BoliError(`Nano Banana could not render this live world variation. ${image.failureReason ?? ""}`.trim(), 503);
  const result: BoliOmniWorldResponse = {
    missionId: mission.id,
    prompt: cleanPrompt,
    learningMoment,
    image: toDataUrl(image.b64, image.mimeType),
    cacheHit: false,
    model: directorModel,
    fallback: false,
  };
  omniWorldCache.set(key, { expiresAt: Date.now() + 900_000, result });
  if (omniWorldCache.size > 8) omniWorldCache.delete(omniWorldCache.keys().next().value as string);
  return result;
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

const ERROR_LABELS: Record<BoliErrorCode, string> = {
  missing_intent: "The main request was missing",
  missing_detail: "One useful detail was missing",
  unclear_audio: "The audio was unclear",
  politeness: "A polite touch would help",
  wording: "The wording needs a small adjustment",
  mixed_language: "Mixed language made the meaning less clear",
};

function asErrorCode(value: unknown, outcome: BoliTurnResponse["outcome"], hasAudio: boolean): BoliErrorCode {
  if (typeof value === "string" && value in ERROR_LABELS) return value as BoliErrorCode;
  if (outcome === "hint_needed" && hasAudio) return "unclear_audio";
  if (outcome === "partial") return "missing_detail";
  return "missing_intent";
}

/** Deterministic safety net: Gemini may coach freely, but code owns pass/fail. */
function objectiveSignals(missionId: string, stepIndex: number, utterance: string): boolean {
  const text = utterance.toLowerCase();
  const has = (...patterns: RegExp[]) => patterns.some((pattern) => pattern.test(text));
  if (missionId === "kj-college-gate" && stepIndex === 0) return has(/somai|सोमय्या|के\.?\s*जे|\bkj\b/);
  if (missionId === "kj-college-gate" && stepIndex === 1) return has(/\b(ho|hoy|haan|yes)\b|हो|होय|ह[ाँा]न/) && has(/gate|गेट|द्वार/);
  if (missionId === "kj-college-gate" && stepIndex === 2) return has(/dhany|thanks|thank you|धन्यवाद|आभारी/);
  if (missionId === "dadar-bus-stop" && stepIndex === 0) return has(/shivaji|शिवाजी/) && has(/bus|बस/);
  if (missionId === "dadar-bus-stop" && stepIndex === 1) return has(/skywalk|bridge|pul|पूल|पुल|स्कायवॉक/) && has(/bus|थांब|stop/);
  if (missionId === "dadar-bus-stop" && stepIndex === 2) return has(/dhany|thanks|thank you|धन्यवाद/) || (has(/तिकडे|ata|now/) && has(/ja|go|जात|जाता|जाय/));
  if (missionId === "bandra-station-pickup" && stepIndex === 0) return has(/\bbkc\b|बीकेसी/);
  if (missionId === "bandra-station-pickup" && stepIndex === 1) return has(/bus|बस/) && has(/thamb|थांब|stop|stand/);
  if (missionId === "bandra-station-pickup" && stepIndex === 2) return has(/dhany|thanks|thank you|धन्यवाद|आभारी/);
  if (missionId === "open-world" && stepIndex === 0) return has(/namaskar|नमस्कार/);
  if (missionId === "open-world" && stepIndex === 1) return has(/disat|diste|dist|दिसत|दिसते/);
  if (missionId === "open-world" && stepIndex === 2) return has(/marathi|मराठी|madat|मदत|shik|शिक/);
  return true;
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
    nextFocus: didAdvance
      ? "Carry that same clear Marathi into the next exchange."
      : shortText(
          coaching.nextFocus,
          level === 2
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
  const mode = body.mode === "review" ? "review" : "mission";
  let requestedStepIndex = body.stepIndex;
  let reviewItemId: string | undefined;
  if (mode === "review") {
    const prefix = `${mission.id}:step:`;
    if (typeof body.reviewItemId !== "string" || !body.reviewItemId.startsWith(prefix)) {
      throw new BoliError("That memory checkpoint is not part of this mission.", 422);
    }
    const reviewIndex = body.reviewItemId.slice(prefix.length);
    if (!/^\d+$/.test(reviewIndex)) throw new BoliError("That memory checkpoint is not part of this mission.", 422);
    requestedStepIndex = Number(reviewIndex);
    if (!Number.isInteger(requestedStepIndex) || requestedStepIndex < 0 || requestedStepIndex >= mission.steps.length) {
      throw new BoliError("That memory checkpoint is no longer available.", 422);
    }
    reviewItemId = body.reviewItemId;
  }
  const stepIndex = Math.min(Math.max(0, requestedStepIndex), mission.steps.length - 1);
  const step = activeStep(mission, stepIndex);
  const supportLanguage = ["English", "Hindi", "Gujarati", "Tamil", "Telugu"].includes(body.supportLanguage ?? "")
    ? body.supportLanguage!
    : "English";
  const hasAudio = Boolean(body.audioBase64 && body.audioMimeType);
  const typed = body.typedResponse?.trim().slice(0, 300) ?? "";
  const attemptsBeforeThisTurn = priorAttemptCount(body.attemptsForStep);
  if (!hasAudio && !typed) throw new BoliError("Speak or type a response first.", 400);

  const context = [
    `You are the language-aware game master for Aamchi Boli, a Marathi learning RPG for an English-speaking beginner${mission.id === "open-world" ? " in a learner-created world" : " in Mumbai"}.`,
    `MISSION: ${mission.title}. AREA: ${mission.area}.`,
    `NPC: ${mission.npcName}, ${mission.npcRole}.`,
    `${mode === "review" ? "MEMORY CHECKPOINT" : "CURRENT OBJECTIVE"}: ${step.objective}`,
    `NPC JUST SAID (Marathi): ${step.npcPromptMr}`,
    `NPC JUST SAID (English): ${step.npcPromptEn}`,
    "",
    "=== THE ONLY PASS CONDITION ===",
    `To clear this objective the learner must get this across: ${step.successCriteria}`,
    "Judge the learner ONLY against that pass condition. If a real Marathi listener would have understood them and acted correctly, the objective is cleared.",
    "",
    "=== ONE MODEL ANSWER (a reference, NOT a requirement) ===",
    `Marathi: ${step.targetPhraseMr}`,
    `Transliteration: ${step.targetPhraseLatin}`,
    `Meaning: ${step.targetPhraseEn}`,
    "The learner does NOT have to reproduce this sentence, its word order, its length, or its formal noun phrases. Never withhold success because their answer was shorter or simpler than this reference.",
    "",
    "=== HOW TO SCORE ===",
    "Judge communicative intent, never accent, never spelling. Devanagari, Latin transliteration, and understandable mixed Marathi/English/Hindi are all valid learner attempts.",
    "success: every required communicative signal in the pass condition is present. Grammar slips, missing honorifics, a missing greeting, English loanwords, and casual phrasing are fine only when the required meaning is still present. Never mark success when a required destination, landmark, agreement, or action is absent.",
    "partial: they are clearly attempting this objective and are close, but one required piece of meaning from the pass condition is missing.",
    "repair_needed: they said something understandable but wrong for this objective, so the NPC would naturally ask again.",
    "hint_needed: the meaning is not recoverable at all, or nothing usable was said.",
    `IMPORTANT: whenever outcome is "success" you MUST include "${step.skill}" in skillEvidence, otherwise the learner is wrongly held back.`,
    `PRIOR ATTEMPTS ON THIS EXACT OBJECTIVE: ${attemptsBeforeThisTurn}.`,
    mode === "review"
      ? "REVIEW MODE: test whether the learner can independently recall the useful chunk. Do not advance the main mission. Accept a clear meaning even if wording differs."
      : "MISSION MODE: score only the current objective and advance at most one step.",
    "",
    "=== WRITING THE REPLY ===",
    `NPC lines must be warm, culturally respectful, at most two short sentences, and in Marathi first. npcLineEn must be a concise ${supportLanguage} meaning, not a lesson.`,
    "When correcting, make recast a gentle natural reformulation. Do not shame, grade, mention AI, invent facts, change the destination, or add tasks.",
    `Always return coaching in ${supportLanguage}: whatWorked must name one genuine strength, nextFocus must name exactly one actionable improvement, and keyChunk must be the smallest helpful Marathi chunk with transliteration and meaning.`,
    supportLanguage === "English" ? "" : `STRICT LANGUAGE RULE: Every learner-facing explanation field, including npcLineEn, coaching.whatWorked, coaching.nextFocus, and keyChunk.meaning, must be written in ${supportLanguage}, despite any legacy field name ending in En.`,
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

  const cachedContent = await ensureBoliContextCache();
  const response = await generateContentWithRetry({
    model: BOLI_SCORING_MODEL,
    contents,
    config: {
      responseMimeType: "application/json",
      responseSchema: turnSchema,
      temperature: 0.25,
      ...(cachedContent ? { cachedContent } : {}),
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
  const modelSkills = safeSkills(raw.skillEvidence, step.skill);
  const utteranceForGuard = hasAudio
    ? [raw.transcript, raw.heardMarathi].filter((value): value is string => typeof value === "string").join(" ")
    : typed;
  const signalsPresent = objectiveSignals(mission.id, stepIndex, utteranceForGuard);
  // A model cannot unlock a fixed route on its own. Even if Gemini is
  // optimistic and returns `success`, the utterance must contain the concrete
  // destination/landmark/action signal for this exact objective. Once that
  // signal is present, code-owned curriculum rules can safely grant one step
  // even when Gemini labelled a short beginner answer as partial.
  const awardedSkills = signalsPresent && modelOutcome !== "hint_needed" ? [step.skill] : modelSkills;
  const outcome = signalsPresent && modelOutcome !== "hint_needed"
    ? "success"
    : modelOutcome === "success"
      ? "partial"
      : modelOutcome;
  const didAdvance = outcome === "success" && mode === "mission";
  const nextStep = didAdvance ? Math.min(stepIndex + 1, mission.steps.length) : body.stepIndex;
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
  const feedbackCode = didAdvance ? "wording" : asErrorCode(
    raw.feedbackFocus && typeof raw.feedbackFocus === "object" ? (raw.feedbackFocus as Record<string, unknown>).code : undefined,
    outcome,
    hasAudio
  );
  const feedbackLabel = didAdvance ? "Objective cleared" : shortText(
    raw.feedbackFocus && typeof raw.feedbackFocus === "object" ? (raw.feedbackFocus as Record<string, unknown>).label : undefined,
    ERROR_LABELS[feedbackCode],
    80
  );
  const reviewItem: BoliReviewItem | undefined = mode === "review" || outcome === "success"
    ? mode === "review" && reviewItemId
      ? {
          id: reviewItemId,
          sourceStepIndex: stepIndex,
          skill: step.skill,
          phrase: { marathi: step.targetPhraseMr, transliteration: step.targetPhraseLatin, meaning: step.targetPhraseEn },
          attempts: attemptsBeforeThisTurn + 1,
          completed: outcome === "success",
        }
      : undefined
    : {
        id: `${mission.id}:step:${stepIndex}`,
        sourceStepIndex: stepIndex,
        skill: step.skill,
        phrase: { marathi: step.targetPhraseMr, transliteration: step.targetPhraseLatin, meaning: step.targetPhraseEn },
        errorCode: feedbackCode,
        attempts: attemptsBeforeThisTurn + 1,
        completed: false,
      };

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
    feedbackFocus: { code: feedbackCode, label: feedbackLabel },
    reviewItem,
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
export async function synthesizeBoliVoice(text: string, options?: { slow?: boolean; role?: string }): Promise<BoliVoiceResponse> {
  const pace = options?.slow
    ? "Speak it extra slowly, with tiny natural pauses between Marathi word groups so a beginner can repeat it."
    : "Speak it warmly and clearly at a natural conversational pace.";
  const role = options?.role?.trim().slice(0, 80) || "a helpful Mumbai conversation partner";
  const response = await generateContentWithRetry({
    model: process.env.GEMINI_TTS_MODEL || "gemini-3.1-flash-tts-preview",
    contents: [
      {
        text: `${pace} You are voicing the role of ${role}. Speak this exact Marathi dialogue as a helpful person in Mumbai: ${text}`,
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
