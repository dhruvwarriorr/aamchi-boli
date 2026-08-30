import { NextRequest, NextResponse } from "next/server";
import { BoliError, evaluateBoliTurn } from "@/lib/aamchi-boli";
import type { BoliTurnBody } from "@/lib/types/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Roughly 1.8 MB of binary audio once base64 decoding is accounted for. */
const MAX_AUDIO_BASE64 = 2_500_000;

/** POST `/api/aamchi-boli/turn`: score one spoken or typed Marathi RPG response. */
export async function POST(req: NextRequest) {
  let body: BoliTurnBody;
  try {
    body = (await req.json()) as BoliTurnBody;
  } catch {
    return NextResponse.json({ error: "Invalid learning-turn request." }, { status: 400 });
  }

  // `JSON.parse("null")` succeeds, so guard the shape before touching a property.
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid learning-turn request." }, { status: 400 });
  }
  // `typeof NaN === "number"`, and a NaN index silently reads `steps[NaN]`.
  if (typeof body.missionId !== "string" || !Number.isInteger(body.stepIndex)) {
    return NextResponse.json({ error: "Missing mission or learning step." }, { status: 422 });
  }
  if (body.audioBase64 !== undefined && typeof body.audioBase64 !== "string") {
    return NextResponse.json({ error: "Malformed recording." }, { status: 422 });
  }
  if (body.audioBase64 && body.audioBase64.length > MAX_AUDIO_BASE64) {
    return NextResponse.json({ error: "That recording is too long. Please keep each answer brief." }, { status: 413 });
  }

  try {
    return NextResponse.json(await evaluateBoliTurn(body));
  } catch (error) {
    console.error("[/api/aamchi-boli/turn]", error);
    // Only messages we authored are safe to show; anything else could leak SDK internals.
    if (error instanceof BoliError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Gemini could not score that response." }, { status: 503 });
  }
}
