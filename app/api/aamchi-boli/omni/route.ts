import { NextRequest, NextResponse } from "next/server";
import { BoliError, generateBoliOmniWorld, getBoliMission } from "@/lib/aamchi-boli";

export const runtime = "nodejs";
export const maxDuration = 180;

/** Prompt-driven micro-scene generation; the fixed mission map remains authoritative. */
export async function POST(req: NextRequest) {
  let body: { missionId?: string; prompt?: string };
  try {
    body = (await req.json()) as { missionId?: string; prompt?: string };
  } catch {
    return NextResponse.json({ error: "Invalid live-world request." }, { status: 400 });
  }
  const mission = typeof body.missionId === "string" ? getBoliMission(body.missionId) : null;
  if (!mission || typeof body.prompt !== "string") {
    return NextResponse.json({ error: "Choose a mission and describe the moment you want to see." }, { status: 422 });
  }
  try {
    return NextResponse.json(await generateBoliOmniWorld(mission, body.prompt));
  } catch (error) {
    console.error("[/api/aamchi-boli/omni]", error);
    if (error instanceof BoliError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "The live world variation could not be rendered." }, { status: 503 });
  }
}
