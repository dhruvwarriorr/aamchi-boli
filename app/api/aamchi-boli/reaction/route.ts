import { NextRequest, NextResponse } from "next/server";
import { BoliError, generateBoliReaction, getBoliMission } from "@/lib/aamchi-boli";

export const runtime = "nodejs";
// Image generation alone runs ~10-20s; the retry ladder needs room beyond that.
export const maxDuration = 120;

/** POST `/api/aamchi-boli/reaction` — render an earned Nano Banana mission vignette. */
export async function POST(req: NextRequest) {
  let body: {
    missionId?: string;
    reactionPrompt?: string;
    independentClears?: number;
    recoveredClears?: number;
    voiceTurns?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid reaction request." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid reaction request." }, { status: 400 });
  }

  const mission = typeof body.missionId === "string" ? getBoliMission(body.missionId) : null;
  if (!mission) return NextResponse.json({ error: "Unknown Aamchi Boli mission." }, { status: 422 });

  // A non-string prompt would throw on `.trim()` inside the generator.
  const reactionPrompt = typeof body.reactionPrompt === "string" ? body.reactionPrompt : undefined;
  // Clamp the run stats: they steer a paid image call, so never trust them raw.
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(Math.max(Math.floor(value), 0), mission.steps.length)
      : 0;
  const performance = {
    independentClears: count(body.independentClears),
    recoveredClears: count(body.recoveredClears),
    voiceTurns: count(body.voiceTurns),
  };

  try {
    return NextResponse.json(await generateBoliReaction(mission, reactionPrompt, performance));
  } catch (error) {
    console.error("[/api/aamchi-boli/reaction]", error);
    if (error instanceof BoliError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "Nano Banana could not create the celebration frame." },
      { status: 503 }
    );
  }
}
