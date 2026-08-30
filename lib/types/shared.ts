/**
 * Types shared safely across client and server (no Node/browser APIs).
 * Prefer `client.ts` or `server.ts` when a type is layer-specific.
 */

/** Premise card / world metadata used in bible, API payloads, and UI. */
export type Premise = {
  id: string;
  title: string;
  tagline: string;
  /** Seed context handed to the game master to open the story. */
  setup: string;
  /** Two-emoji motif shown on the premise card. */
  emoji: string;
  /** Art-direction hint that anchors the visual style for this world. */
  styleBible: string;
  /** The concrete objective the player is travelling toward. */
  goal: string;
  /** Short name for the destination, shown on the journey trail. */
  goalLabel: string;
  /** Pin emoji for the destination. */
  goalEmoji: string;
  /** What the draining clock represents in this world. */
  clockLabel: string;
};

/* ------------------------------------------------------------------ */
/* Aamchi Boli: code-owned world geometry with AI-authored live questions */
/* ------------------------------------------------------------------ */

/** Skill evidence awarded by a Marathi practice turn. */
export type BoliSkillId =
  | "greeting"
  | "destination"
  | "confirmation"
  | "polite_closing"
  | "clarification";

/** How a learner submitted the evidence Gemini assessed. */
export type BoliInputMode = "voice" | "typed";

/** One constrained speaking objective inside a mission. */
export type BoliMissionStep = {
  objective: string;
  npcPromptMr: string;
  npcPromptEn: string;
  targetPhraseMr: string;
  targetPhraseLatin: string;
  targetPhraseEn: string;
  /**
   * What the learner must actually get across to clear this objective, in plain
   * English. This is the pass condition Gemini is asked to judge; the target
   * phrase is only one model answer, never a required wording.
   */
  successCriteria: string;
  skill: BoliSkillId;
};

/** A point on the map plane, expressed as percentages of width and height. */
export type BoliWorldPoint = { x: number; y: number };

/** An axis-aligned region of the map plane, in the same percentage units. */
export type BoliWorldRect = { x: number; y: number; w: number; h: number };

/** A deliberate interaction point on a prebuilt Boli map. */
export type BoliMapHotspot = {
  id: string;
  kind: "npc" | "landmark" | "vehicle" | "goal";
  name: string;
  x: number;
  y: number;
  radius: number;
  prompt?: string;
};

/** Percentage-based collision rectangle used by the canvas world. */
export type BoliWalkableZone = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Code-owned scenario definition; Gemini may react but cannot change it. */
export type BoliMission = {
  id: string;
  title: string;
  area: string;
  briefing: string;
  npcName: string;
  npcRole: string;
  /** Public, prebuilt Nano Banana map used for a fast demo start. */
  mapAssetPath?: string;
  /**
   * Where the talkable NPC stands on the map, as percentages of the map plane.
   * Required so a new mission cannot silently inherit a default anchor.
   */
  npcPosition: BoliWorldPoint;
  /** Where the learner's sprite starts, as percentages of the map plane. */
  playerStart: BoliWorldPoint;
  /**
   * Ground the learner may stand on. The player must always be inside one of
   * these, which keeps them on pavement and out of walls, buildings, and sky.
   */
  walkable: BoliWorldRect[];
  /** Solid props inside the walkable ground, such as vehicles, stalls, and railings. */
  blockers?: BoliWorldRect[];
  /** Talkable NPCs and visible landmarks that anchor the RPG route. */
  mapHotspots: BoliMapHotspot[];
  /** New canvas collision data; `walkable` remains for backwards compatibility. */
  walkableZones?: BoliWalkableZone[];
  mapPrompt: string;
  reactionPrompt: string;
  steps: BoliMissionStep[];
};
