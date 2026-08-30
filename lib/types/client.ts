/**
 * Client-side types for Kahani.
 *
 * All types consumed by React components, client pages, and fetch calls belong
 * here. Do not define duplicate shapes in component files.
 */

import type { Choice, Effects, EndingKind, Stats } from "../stats";
import type { DialogueTurn, GameBible, SceneData } from "../universe";
import type { Premise } from "./shared";
import type { BoliInputMode, BoliMission, BoliSkillId } from "./shared";

/** Premise card / world metadata shown in the UI. */
export type { Premise } from "./shared";

/** One completed story beat for legacy linear mode context. */
export type HistoryEntry = {
  caption: string;
  choice: string;
};

/** Legacy linear-mode turn request (client → `/api/turn`). */
export type TurnRequest = {
  premise: Premise;
  history: HistoryEntry[];
  /** The option the player just picked. null on the opening turn. */
  choice: string | null;
  /** Previous frame (base64, no data-url prefix) for visual continuity. */
  prevImage: string | null;
  stats: Stats;
  /** Current time budget 0..100. */
  clock: number;
  /** Current journey progress 0..100. */
  progress: number;
};

/** Legacy linear-mode turn response. */
export type TurnResponse = {
  caption: string;
  outcomeFlash: string;
  choices: Choice[];
  /** Fully-formed data URL for the scene image. */
  image: string;
  effects: Effects;
  timeCost: number;
  location: string;
  progress: number;
  isEnding: boolean;
  endingKind?: EndingKind;
  endingTitle?: string;
};

/** Client-side record of a single legacy story frame. */
export type Scene = {
  turn: number;
  image: string;
  caption: string;
  outcomeFlash: string;
  choices: Choice[];
  effects: Effects;
  timeCost: number;
  location: string;
  progress: number;
  isEnding: boolean;
  endingKind?: EndingKind;
  endingTitle?: string;
  /** The choice the player made to leave this scene. */
  chosen?: string;
};

/* ------------------------------------------------------------------ */
/* Game persistence API (client ↔ `/api/games`, `/api/profile`)       */
/* ------------------------------------------------------------------ */

/** Victory or defeat ending variant. */
export type FinaleOutcome = "victory" | "defeat";

/** Generated ending narration + image (inline data URL or Storage URL). */
export type FinaleData = {
  title: string;
  resolution: string;
  image: string;
  outcome?: FinaleOutcome;
};

/** Summary row returned by `GET /api/games`. */
export type GameListItem = {
  id: string;
  owner: string;
  title: string;
  thumbnailUrl: string | null;
  createdAt: string;
};

/** Free-tier world creation limits for the signed-in user. */
export type GenerationQuota = {
  used: number;
  limit: number;
  unlimited: boolean;
  canCreate: boolean;
};

/** Response from `GET /api/profile`. */
export type ProfileResponse = {
  generation: GenerationQuota;
};

/** Full saved game returned by `GET /api/games/[id]`. */
export type FullGameResponse = {
  id: string;
  owner: string;
  /** True when the current user owns this game and may generate new scenes. */
  isOwner: boolean;
  title: string;
  idea: string;
  bible: GameBible;
  premise: Premise;
  spriteUrl: string | null;
  finales: Partial<Record<FinaleOutcome, FinaleData>>;
  scenes: SceneData[];
  /** Total AI generation calls derived from persisted assets (same for owner and visitors). */
  genCalls: number;
  createdAt: string;
};

/** Body sent by the client when creating a new game row. */
export type CreateGameRequest = {
  idea: string;
  bible: GameBible;
  premise: Premise;
};

/** Response from `POST /api/games`. */
export type CreateGameResponse = GameListItem;

/** Response from `PUT /api/games/[id]/sprite`. */
export type PutSpriteResponse = {
  spriteUrl: string;
};

/* ------------------------------------------------------------------ */
/* World component                                                      */
/* ------------------------------------------------------------------ */

/** Whether the world is being created fresh or loaded from storage. */
export type WorldMode = "create" | "load";

/** Boot vs in-game phase for the explorable world UI. */
export type WorldPhase = "booting" | "playing";

/** Props for the main game orchestrator component. */
export type WorldProps = {
  mode: WorldMode;
  /** Required when `mode` is `"load"`. */
  gameId?: string;
  /** Required when `mode` is `"create"` (passed from Home). */
  initialIdea?: string;
};

/** Active NPC dialogue panel state. */
export type WorldDialogueState = {
  npc: NonNullable<SceneData["npc"]> & object;
  history: DialogueTurn[];
  options: string[];
  thinking: boolean;
  mood?: string;
};

/* ------------------------------------------------------------------ */
/* Aamchi Boli client ↔ API shapes                                     */
/* ------------------------------------------------------------------ */

/** A browser turn sent to Gemini as speech or a typed accessibility fallback. */
export type BoliTurnRequest = {
  missionId: string;
  stepIndex: number;
  /** Learner's preferred language for Gemini's concise coaching text. */
  supportLanguage?: "English" | "Hindi" | "Gujarati" | "Tamil" | "Telugu";
  /** Mission scoring or a non-blocking memory checkpoint. */
  mode?: "mission" | "review";
  /** Code-created review id; the server resolves the phrase from the mission. */
  reviewItemId?: string;
  /** Number of completed attempts on this exact objective before this submission. */
  attemptsForStep?: number;
  typedResponse?: string;
  audioBase64?: string;
  audioMimeType?: string;
};

export type BoliTurnOutcome = "success" | "partial" | "repair_needed" | "hint_needed";

export type BoliErrorCode =
  | "missing_intent"
  | "missing_detail"
  | "unclear_audio"
  | "politeness"
  | "wording"
  | "mixed_language";

export type BoliReviewItem = {
  id: string;
  sourceStepIndex: number;
  skill: BoliSkillId;
  phrase: {
    marathi: string;
    transliteration: string;
    meaning: string;
  };
  errorCode?: BoliErrorCode;
  attempts: number;
  completed: boolean;
};

export type BoliSupportRecommendation = "none" | "visual_hint" | "phrase_fragment" | "slow_repeat";

/** Code-owned escalation plus Gemini's concise, response-specific teaching note. */
export type BoliAdaptiveFeedback = {
  /** 0 = affirm, 1 = a focused recast, 2 = a small guided rebuild. */
  level: 0 | 1 | 2;
  strategy: "affirm" | "recast" | "guided_rebuild";
  whatWorked: string;
  nextFocus: string;
  keyChunk: {
    marathi: string;
    transliteration: string;
    meaning: string;
  };
};

/** Gemini's validated learning response for one BoliQuest turn. */
export type BoliTurnResponse = {
  /** Preserves whether Gemini assessed speech or the accessibility text fallback. */
  inputMode: BoliInputMode;
  transcript: string;
  heardMarathi: string;
  intent: string;
  outcome: BoliTurnOutcome;
  npcLineMr: string;
  npcLineEn: string;
  recast?: {
    marathi: string;
    transliteration: string;
    meaning: string;
  };
  skillEvidence: BoliSkillId[];
  supportRecommendation: BoliSupportRecommendation;
  adaptiveFeedback: BoliAdaptiveFeedback;
  feedbackFocus: { code: BoliErrorCode; label: string };
  reviewItem?: BoliReviewItem;
  nextStep: number;
  completed: boolean;
  reactionPrompt?: string;
};

/** Session-local evidence behind one functional Marathi skill. */
export type BoliSkillProgress = {
  attempts: number;
  cleared: boolean;
  firstTry: boolean;
  recoveredAfterRepair: boolean;
  hintUsed: boolean;
  voiceAttempts: number;
  typedAttempts: number;
  reviewAttempted: number;
  reviewRecalled: number;
  lastErrorCode?: BoliErrorCode;
};

/** Browser-only learning state, keyed by mission step rather than generic skill. */
export type BoliLearningState = Record<string, BoliSkillProgress>;

/** Map-image response returned by the Boli visual generation endpoint. */
export type BoliMapResponse = {
  mission: BoliMission;
  image: string;
  fallback: boolean;
  /** Distinguishes a stored Nano Banana map from an on-demand generation. */
  source: "prebuilt" | "generated";
};

/** Prompt-driven, cached visual scene generated during a live route. */
export type BoliOmniWorldResponse = {
  missionId: string;
  prompt: string;
  /** One short, judge-friendly teaching cue returned by the scene director. */
  learningMoment?: string;
  /** One useful Marathi sentence grounded in a visible part of the generated world. */
  scenePhrase?: {
    marathi: string;
    transliteration: string;
    meaning: string;
  };
  image: string;
  cacheHit: boolean;
  model: string;
  fallback: boolean;
};

/** Audio response from the Gemini Marathi TTS endpoint. */
export type BoliVoiceResponse = {
  audio: string | null;
};

/** Nano Banana visual response for a completed learning beat. */
export type BoliReactionResponse = {
  image: string;
  fallback: boolean;
};
