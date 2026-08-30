import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/auth";
import { generateDialogue } from "@/lib/world-engine";
import type { DialogueBody } from "@/lib/types/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Generate one state-aware NPC response without closing an active conversation. */
export async function POST(req: NextRequest) {
  if (!(await requireUser())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: DialogueBody;
  try {
    body = (await req.json()) as DialogueBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !body.bible?.npcs?.length || typeof body.npcIndex !== "number") {
    return NextResponse.json(
      { error: "Missing bible or npcIndex." },
      { status: 400 }
    );
  }
  try {
    const reply = await generateDialogue(
      body.bible,
      body.npcIndex,
      body.history ?? [],
      body.playerLine ?? null,
      {
        clueFound: Boolean(body.clueFound),
        exchanges:
          body.exchanges ??
          (body.history ?? []).filter((t) => t.speaker === "player").length,
        inventory: body.inventory ?? [],
        heat: body.heat ?? 0,
        conversationId: body.conversationId,
        avoidQuestions: Array.isArray(body.avoidQuestions)
          ? body.avoidQuestions
              .filter((question): question is string => typeof question === "string")
              .map((question) => question.trim().slice(0, 260))
              .filter(Boolean)
              .slice(-30)
          : undefined,
        scene: body.scene,
      }
    );
    return NextResponse.json(reply);
  } catch (err) {
    console.error("[/api/dialogue]", err);
    return NextResponse.json(
      { error: "The character lost their train of thought." },
      { status: 500 }
    );
  }
}
