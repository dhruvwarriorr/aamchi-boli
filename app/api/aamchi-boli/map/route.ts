import { NextRequest, NextResponse } from "next/server";
import { BoliError, generateBoliMap, getBoliMission } from "@/lib/aamchi-boli";

export const runtime = "nodejs";
// Image generation alone runs ~10-20s; the retry ladder needs room beyond that.
export const maxDuration = 120;

/** POST `/api/aamchi-boli/map`: render a fixed Nano Banana mission map. */
export async function POST(req: NextRequest) {
  let body: { missionId?: string };
  try {
    body = (await req.json()) as { missionId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid map request." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid map request." }, { status: 400 });
  }

  const mission = typeof body.missionId === "string" ? getBoliMission(body.missionId) : null;
  if (!mission) {
    return NextResponse.json({ error: "Unknown Aamchi Boli mission." }, { status: 422 });
  }

  try {
    return NextResponse.json(await generateBoliMap(mission));
  } catch (error) {
    console.error("[/api/aamchi-boli/map]", error);
    if (error instanceof BoliError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Nano Banana could not paint this map." }, { status: 503 });
  }
}
