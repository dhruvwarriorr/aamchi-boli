import { NextRequest, NextResponse } from "next/server";
import { BoliError, createBoliConversationSession, getBoliMission } from "@/lib/aamchi-boli";

export const runtime = "nodejs";
export const maxDuration = 30;

/** POST `/api/aamchi-boli/session`: create a fresh AI-led conversation for a loaded world. */
export async function POST(req: NextRequest) {
  let body: { missionId?: string; worldContext?: string; avoidQuestions?: string[] };
  try {
    body = (await req.json()) as { missionId?: string; worldContext?: string; avoidQuestions?: string[] };
  } catch {
    return NextResponse.json({ error: "Invalid conversation request." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid conversation request." }, { status: 400 });
  }
  const mission = typeof body.missionId === "string" ? getBoliMission(body.missionId) : null;
  if (!mission || (body.worldContext !== undefined && typeof body.worldContext !== "string") || (body.avoidQuestions !== undefined && (!Array.isArray(body.avoidQuestions) || body.avoidQuestions.some((item) => typeof item !== "string")))) {
    return NextResponse.json({ error: "Choose a valid world before starting a conversation." }, { status: 422 });
  }
  try {
    return NextResponse.json(await createBoliConversationSession(mission, body.worldContext, (body.avoidQuestions ?? []).map((item) => item.trim().slice(0, 220)).filter(Boolean).slice(-30)));
  } catch (error) {
    console.error("[/api/aamchi-boli/session]", error);
    if (error instanceof BoliError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Gemini could not begin this conversation." }, { status: 503 });
  }
}
