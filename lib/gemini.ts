import { GoogleGenAI, Type } from "@google/genai";
import type { HistoryEntry, Premise } from "./types";
import { MAX_TURNS } from "./constants";
import { DEFAULT_RETRY_OPTS, getErrorStatus, isTransientError, withRetry } from "./retry";
import {
  applyEffects,
  CHOICE_TAGS,
  clampClock,
  isDead,
  type Choice,
  type Effects,
  type EndingKind,
  type Stats,
} from "./stats";

const TEXT_MODEL = process.env.TEXT_MODEL || "gemini-2.5-flash";
// Nano Banana Flash Image powers every visual in Aamchi Boli and Kahani.
const IMAGE_MODEL = process.env.IMAGE_MODEL || "gemini-3.1-flash-image";

let client: GoogleGenAI | null = null;
export function ai(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local to run the game."
    );
  }
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

/** Avoid repeatedly retrying a permanent zero-quota response from Gemini. */
function shouldRetryGeminiRequest(error: unknown): boolean {
  if (!isTransientError(error)) return false;
  const message = error instanceof Error ? error.message : String(error);
  return !/limit\s*[:=]\s*0\b/i.test(message);
}

/** Gemini generateContent with exponential backoff on transient failures. */
export async function generateContentWithRetry(
  params: Parameters<GoogleGenAI["models"]["generateContent"]>[0]
) {
  return withRetry(() => ai().models.generateContent(params), {
    ...DEFAULT_RETRY_OPTS,
    shouldRetry: shouldRetryGeminiRequest,
  });
}

/**
 * Gemini Omni currently exposes its generation surface through Interactions,
 * rather than `models.generateContent`. Keep its retry policy identical to the
 * rest of the app without forcing callers to know the transport difference.
 */
export async function generateInteractionWithRetry(
  params: Parameters<GoogleGenAI["interactions"]["create"]>[0]
) {
  return withRetry(() => ai().interactions.create(params), {
    ...DEFAULT_RETRY_OPTS,
    shouldRetry: shouldRetryGeminiRequest,
  });
}

export type StoryBeat = {
  caption: string;
  outcomeFlash: string;
  choices: Choice[];
  imagePrompt: string;
  effects: Effects;
  timeCost: number;
  location: string;
  progress: number;
  isEnding: boolean;
  endingKind?: EndingKind;
  endingTitle?: string;
};

const beatSchema = {
  type: Type.OBJECT,
  properties: {
    outcomeFlash: {
      type: Type.STRING,
      description:
        "A punchy flash of what the player's last action just did, MAX 8 words, e.g. 'Bribe paid. The gate swings open.' Empty string on the opening beat.",
    },
    effects: {
      type: Type.OBJECT,
      description:
        "Stat changes caused by the player's LAST action (all zero on the opening beat). Positive or negative integers.",
      properties: {
        health: {
          type: Type.INTEGER,
          description:
            "Change to Health. Scale it to the danger you show: a scrape -5..-10, a real injury -15..-30, a grievous or potentially fatal event -40..-80. Rest and aid restore +5..+20. The number MUST match the severity — never soften a life-threatening moment to a token scratch.",
        },
        karma: {
          type: Type.INTEGER,
          description:
            "Change to Karma, typically -20..+20. Kindness and honesty raise it; cruelty and deceit lower it.",
        },
        rupees: {
          type: Type.INTEGER,
          description:
            "Change to Rupees, typically -150..+150. Bribes and purchases cost money; rewards and theft gain it.",
        },
      },
    },
    timeCost: {
      type: Type.INTEGER,
      description:
        "How much of the time budget this action spent, 0..30. A quick move ~8, a slow or cautious one ~18-30, a shortcut ~4. 0 on the opening beat. Time only ever decreases.",
    },
    caption: {
      type: Type.STRING,
      description:
        "One vivid line describing the moment now on screen. MAX 12 words. No lead-in like 'You see' — just the image in words. This is the ONLY prose the player reads.",
    },
    location: {
      type: Type.STRING,
      description:
        "A short evocative name for where the player now is, e.g. 'The Flooded Bypass' or 'Colaba Causeway'. 2-4 words.",
    },
    progress: {
      type: Type.INTEGER,
      description:
        "Cumulative journey progress toward the goal, 0..100. Advance it by roughly 12-20 on moves toward the goal; unchanged or slightly lower on setbacks or detours. Reaches 100 only at the destination.",
    },
    choices: {
      type: Type.ARRAY,
      description:
        "Exactly 4 distinct actions. Empty array only when isEnding is true.",
      items: {
        type: Type.OBJECT,
        properties: {
          text: {
            type: Type.STRING,
            description:
              "The action as a short imperative, 2-5 words, e.g. 'Wade across' or 'Bribe the guard'.",
          },
          tag: {
            type: Type.STRING,
            enum: CHOICE_TAGS as unknown as string[],
            description:
              "The play-style of this option: 'bold' (risky/aggressive), 'cautious' (safe/slow), 'cunning' (clever/deceptive), 'kind' (generous/moral).",
          },
        },
        required: ["text", "tag"],
      },
    },
    imagePrompt: {
      type: Type.STRING,
      description:
        "A single richly detailed cinematic image prompt that SHOWS the result of the player's action — the new moment, in-frame. Setting, key subject and their action, lighting, mood, composition. Authentic Indian detail. No text or captions in the image.",
    },
    isEnding: { type: Type.BOOLEAN },
    endingKind: {
      type: Type.STRING,
      enum: ["victory", "defeat", "neutral"],
      description:
        "When isEnding: 'victory' if the goal was reached, 'defeat' if the player died or ran out of time, 'neutral' otherwise.",
    },
    endingTitle: {
      type: Type.STRING,
      description:
        "When isEnding is true, a short evocative title for this ending (e.g. 'The Debt Repaid'). Otherwise empty.",
    },
  },
  required: [
    "caption",
    "choices",
    "imagePrompt",
    "effects",
    "timeCost",
    "location",
    "progress",
    "isEnding",
  ],
};

function statLine(stats: Stats, clock: number): string {
  return `Health ${stats.health}/100, Karma ${stats.karma}/100, Rupees ₹${stats.rupees}, Time ${clock}/100`;
}

function buildStoryContext(
  premise: Premise,
  history: HistoryEntry[],
  choice: string | null,
  stats: Stats,
  clock: number,
  progress: number
): string {
  const lines: string[] = [];
  lines.push(`WORLD: ${premise.title}`);
  lines.push(`PREMISE: ${premise.setup}`);
  lines.push(`GOAL: ${premise.goal}`);
  lines.push(
    `TIME PRESSURE: the clock (${premise.clockLabel}) drains toward 0; at 0 the player fails.`
  );
  lines.push(`JOURNEY PROGRESS: ${progress}/100 toward ${premise.goalLabel}.`);
  lines.push(`PLAYER STATE: ${statLine(stats, clock)}.`);
  lines.push("");

  if (history.length === 0) {
    lines.push(
      "This is the OPENING frame. Set the scene, the goal, and the stakes in a single ≤12-word caption, then offer the first 4 actions. effects all zero, outcomeFlash empty, timeCost 0, progress about 5."
    );
  } else {
    lines.push("STORY SO FAR (each a caption + the action taken):");
    history.forEach((h, i) => {
      lines.push(`${i + 1}. "${h.caption}" → chose: "${h.choice}"`);
    });
    lines.push("");
    lines.push(`The player has now chosen: "${choice}"`);
    lines.push(
      "Resolve that action: set 'outcomeFlash' to what just happened, 'effects' to the stat consequences, 'timeCost' to the time it took, name the new 'location', advance 'progress', and write the new 'caption'. Then offer the next 4 actions."
    );
  }

  const beatsSoFar = history.length;
  if (stats.health <= 25 && !isDead(stats)) {
    lines.push(
      `\nThe player is gravely wounded (Health ${stats.health}/100). Do NOT soften consequences: a dangerous action here can be fatal — if it brings Health to 0, set isEnding true, endingKind 'defeat', empty choices.`
    );
  }
  if (clock <= 25 && clock > 0) {
    lines.push(
      `\nTime is almost up (${clock}/100). The player must reach the goal fast; a slow choice now may run the clock out.`
    );
  }

  if (isDead(stats)) {
    lines.push(
      "\nThe player's Health has already reached 0. This frame is their death: isEnding true, endingKind 'defeat', a fitting final caption, empty choices."
    );
  } else if (clock <= 0) {
    lines.push(
      "\nThe clock has run out. The player has failed to arrive in time: isEnding true, endingKind 'defeat', empty choices."
    );
  } else if (progress >= 90) {
    lines.push(
      "\nThe destination is within reach. If this move arrives at the goal, set isEnding true, endingKind 'victory', progress 100, empty choices."
    );
  } else if (beatsSoFar >= MAX_TURNS - 1) {
    lines.push(
      "\nThis journey has run long. Bring it to a resonant conclusion now: isEnding true, choose endingKind by what happened, give an endingTitle, empty choices."
    );
  } else if (beatsSoFar >= MAX_TURNS - 3) {
    lines.push(
      "\nThe journey is approaching its climax. Raise the stakes and steer toward the destination."
    );
  }

  return lines.join("\n");
}

const FALLBACK_CHOICES: Choice[] = [
  { text: "Push through", tag: "bold" },
  { text: "Hold back", tag: "cautious" },
  { text: "Find another way", tag: "cunning" },
  { text: "Help nearby", tag: "kind" },
];

function sanitizeEffects(raw: unknown): Effects {
  const e = (raw ?? {}) as Record<string, unknown>;
  const out: Effects = {};
  for (const key of ["health", "karma", "rupees"] as const) {
    const v = e[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[key] = Math.round(v);
    }
  }
  return out;
}

export async function generateBeat(
  premise: Premise,
  history: HistoryEntry[],
  choice: string | null,
  stats: Stats,
  clock: number,
  progress: number
): Promise<StoryBeat> {
  const systemInstruction = [
    "You are the Game Master of a fast, cinematic, choice-driven survival-adventure game set in India.",
    "This is IMAGE-FIRST: the picture tells the story, so your words are minimal. A caption is ONE line of at most 12 words. Never write paragraphs.",
    "Ground everything in authentic, respectful Indian detail — places, food, textures — without caricature.",
    "This is a GAME with real stakes: every action changes Health, Karma, Rupees, spends Time, and moves the player toward or away from their destination. Consequences must feel earned and specific — a reckless leap hurts Health, a bribe drains Rupees, a cruel shortcut costs Karma, a detour burns Time.",
    "The player CAN die. Be a fair but unflinching game master: the size of your stat changes must match the danger. A life-threatening moment must carry a severe Health cost — never rescue the player with a token penalty. Health 0 or Time 0 is the end: isEnding true, endingKind 'defeat'.",
    "The 4 actions must be genuinely different in approach — bold, cautious, cunning, kind — never four flavors of the same move.",
    "The imagePrompt must SHOW the result of the action — depict the new moment vividly, in-frame.",
    "Keep continuity with the story so far: honor earlier choices, injuries, and money.",
    "Return ONLY the structured object. No markdown, no extra commentary.",
  ].join(" ");

  const response = await generateContentWithRetry({
    model: TEXT_MODEL,
    contents: buildStoryContext(premise, history, choice, stats, clock, progress),
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: beatSchema,
      temperature: 1.0,
    },
  });

  const raw = response.text;
  if (!raw) throw new Error("Empty response from text model.");

  const parsed = JSON.parse(raw) as Partial<StoryBeat> & {
    choices?: unknown;
  };

  const isOpening = history.length === 0;
  const beat: StoryBeat = {
    caption: parsed.caption ?? "",
    outcomeFlash: isOpening ? "" : parsed.outcomeFlash ?? "",
    imagePrompt: parsed.imagePrompt ?? premise.styleBible,
    effects: isOpening ? {} : sanitizeEffects(parsed.effects),
    timeCost: isOpening
      ? 0
      : Math.max(0, Math.min(40, Math.round(Number(parsed.timeCost) || 0))),
    location: parsed.location?.trim() || premise.goalLabel,
    progress:
      typeof parsed.progress === "number"
        ? Math.max(0, Math.min(100, Math.round(parsed.progress)))
        : progress,
    isEnding: Boolean(parsed.isEnding),
    endingKind: parsed.endingKind,
    choices: [],
  };

  // Normalize choices into exactly four tagged options for a live beat.
  const rawChoices = Array.isArray(parsed.choices) ? parsed.choices : [];
  const normalized: Choice[] = rawChoices
    .map((c, i) => {
      const obj = (c ?? {}) as Record<string, unknown>;
      const text = typeof obj.text === "string" ? obj.text : String(obj);
      const tag = CHOICE_TAGS.includes(obj.tag as never)
        ? (obj.tag as Choice["tag"])
        : CHOICE_TAGS[i % CHOICE_TAGS.length];
      return text ? { text, tag } : null;
    })
    .filter((c): c is Choice => c !== null);

  // ---- Deterministic guardrails independent of the model ----
  const projected = applyEffects(stats, beat.effects);
  const projectedClock = clampClock(clock - beat.timeCost);

  if ((isDead(projected) || projectedClock <= 0) && !beat.isEnding) {
    // The action was fatal or the clock ran out — force a defeat ending.
    beat.isEnding = true;
    beat.endingKind = "defeat";
    if (!beat.endingTitle && parsed.endingTitle) {
      beat.endingTitle = parsed.endingTitle;
    }
  } else if (beat.progress >= 100 && !beat.isEnding) {
    beat.isEnding = true;
    beat.endingKind = "victory";
  }

  if (beat.isEnding) {
    beat.choices = [];
    beat.endingTitle = parsed.endingTitle || beat.endingTitle || "Your Story";
    if (!beat.endingKind) beat.endingKind = "neutral";
  } else {
    beat.choices = normalized.slice(0, 4);
    while (beat.choices.length < 4) {
      beat.choices.push(FALLBACK_CHOICES[beat.choices.length]);
    }
  }

  return beat;
}

const TRANSPARENT_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export type ImageResult = {
  /** base64 (no data-url prefix) */
  b64: string;
  mimeType: string;
  /** true when generation failed and we fell back to a placeholder */
  fallback: boolean;
  /** Why generation failed, when `fallback` is true. Safe to show a user. */
  failureReason?: string;
};

/**
 * Turn a raw image-model failure into one honest sentence. Quota is only one of
 * several causes, and reporting the others as quota sends people to the billing
 * console for a problem that lives in the code.
 */
function describeImageFailure(err: unknown): string {
  const status = getErrorStatus(err);
  const message = err instanceof Error ? err.message : String(err);
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(message)) {
    return "This Gemini project is out of image-generation quota right now.";
  }
  if (status === 401 || status === 403 || /API key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(message)) {
    return "Gemini rejected the API key for image generation.";
  }
  if (status === 404 || /NOT_FOUND|is not found|not supported/i.test(message)) {
    return `The configured image model (${IMAGE_MODEL}) is not available to this key.`;
  }
  if (/SAFETY|blocked|PROHIBITED_CONTENT/i.test(message)) {
    return "Gemini declined to illustrate that prompt.";
  }
  return "The image model did not return a picture.";
}

/**
 * Generate a scene image with Nano Banana. When a previous frame is supplied it
 * is passed as a visual reference so characters and art style stay consistent.
 */
export async function generateImage(
  imagePrompt: string,
  styleBible: string,
  prevImage: string | null
): Promise<ImageResult> {
  const fullPrompt = [
    imagePrompt,
    `Art direction: ${styleBible}`,
    "16:9 composition, 1K, no text, no watermark, no logos.",
    prevImage
      ? "Maintain the same recurring characters, wardrobe, and overall art style as the reference image for visual continuity."
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const contents: Array<
    { text: string } | { inlineData: { data: string; mimeType: string } }
  > = [];
  if (prevImage) {
    contents.push({
      inlineData: { data: prevImage, mimeType: "image/png" },
    });
  }
  contents.push({ text: fullPrompt });

  try {
    const response = await generateContentWithRetry({
      model: IMAGE_MODEL,
      contents,
    config: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "16:9", imageSize: "1K" },
    },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        return {
          b64: part.inlineData.data,
          mimeType: part.inlineData.mimeType || "image/png",
          fallback: false,
        };
      }
    }
    throw new Error("No image data returned by image model.");
  } catch (err) {
    console.error("[generateImage] falling back to placeholder:", err);
    return {
      b64: TRANSPARENT_PNG,
      mimeType: "image/png",
      fallback: true,
      failureReason: describeImageFailure(err),
    };
  }
}

export function toDataUrl(b64: string, mimeType: string): string {
  return `data:${mimeType};base64,${b64}`;
}
