import { NextRequest, NextResponse } from "next/server";
import { synthesizeBoliVoice } from "@/lib/aamchi-boli";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST `/api/aamchi-boli/voice` — synthesize an NPC's Marathi dialogue with Gemini TTS. */
export async function POST(req: NextRequest) {
  let body: { text?: string; slow?: boolean };
  try {
    body = (await req.json()) as { text?: string; slow?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid voice request." }, { status: 400 });
  }

  // A null body or a non-string `text` would throw on `.trim()` outside the try.
  if (!body || typeof body !== "object" || typeof body.text !== "string") {
    return NextResponse.json({ error: "Missing Marathi dialogue." }, { status: 422 });
  }
  const text = body.text.trim().slice(0, 300);
  if (!text) return NextResponse.json({ error: "Missing Marathi dialogue." }, { status: 422 });

  try {
    return NextResponse.json(await synthesizeBoliVoice(text, { slow: body.slow === true }));
  } catch (error) {
    // Voice is an enhancement: the client falls back to browser speech, so a
    // failure here must never block the turn. Logged loudly for diagnosis.
    console.error("[/api/aamchi-boli/voice]", error);
    return NextResponse.json({ audio: null });
  }
}
