import { NextRequest, NextResponse } from "next/server";
import { synthesizeBoliVoice } from "@/lib/aamchi-boli";
import { synthesizeSarvamSpeech } from "@/lib/sarvam";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST `/api/aamchi-boli/voice` — synthesize an NPC's Marathi dialogue with Gemini TTS. */
export async function POST(req: NextRequest) {
  let body: { text?: string; role?: string; language?: string; slow?: boolean };
  try {
    body = (await req.json()) as { text?: string; role?: string; language?: string; slow?: boolean };
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
    // Keep Marathi mission audio Gemini-native; route any future language to
    // the already-configured Sarvam key so the app stays multilingual.
    if (body.language && body.language !== "mr-IN") {
      const audio = await synthesizeSarvamSpeech(text, body.role, {
        languageCode: body.language,
        pace: body.slow ? 0.72 : 1,
      });
      return NextResponse.json({ audio });
    }
    return NextResponse.json(await synthesizeBoliVoice(text, { slow: body.slow === true, role: body.role }));
  } catch (error) {
    // Voice is an enhancement: the client falls back to browser speech, so a
    // failure here must never block the turn. Logged loudly for diagnosis.
    console.error("[/api/aamchi-boli/voice]", error);
    return NextResponse.json({ audio: null });
  }
}
