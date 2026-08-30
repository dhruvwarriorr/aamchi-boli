# Aamchi Boli — Project Handoff for Claude

## Read this first

This is a **Gemini Hackday 2.0** project called **Aamchi Boli**. It is a full-screen Marathi-learning RPG for English-speaking people who are new to Mumbai or need confidence using Marathi in everyday public-facing situations.

The intended standard is not “a chatbot that translates Marathi.” The core demo should prove that Gemini is an actual game-and-learning mechanic:

1. The learner walks around a Mumbai game map using **WASD / arrow keys** (plus mobile touch controls).
2. They must walk close to an NPC and press **E / Enter** to unlock a conversation.
3. They speak in Marathi or type Marathi/transliteration.
4. Gemini hears/interprets the response in context, judges **communicative intent rather than accent**, and returns structured coaching.
5. The game adapts its help after failed attempts: light recast → useful phrase chunk → slow guided rebuild.
6. A fixed, code-owned mission state decides whether a learner may progress.
7. Gemini TTS speaks Marathi back to the learner.
8. An optional Omni-directed Nano Banana scene variation can be painted from a learner prompt, and a Nano Banana completion scene is generated only when the route is earned.

Do **not** put a Gemini API key in this document, source, git, or chat. The local `.env` has the key and must remain uncommitted.

---

## Why this should score well at the hackathon

The judging rubric emphasizes:

1. Quality of Gemini integration
2. Problem understanding and use-case clarity
3. Technical execution and functionality
4. Innovation and creativity
5. Presentation and demonstration

### Problem statement

People moving to Mumbai may know a few Marathi words, but can still freeze during a real interaction: naming an auto destination, confirming a landmark, asking for directions, or serving a passenger respectfully. Flashcards and generic translation bots do not test whether the listener actually understood their practical intent.

**Aamchi Boli** gives learners a safe, situated rehearsal of these moments. It rewards being understood, politely repairing misunderstandings, and trying again—not producing perfect grammar or adopting a specific accent.

### Strong Gemini story for judges

- Gemini **multimodal understanding** scores short voice recordings in a fixed Mumbai scenario.
- Gemini returns **schema-constrained JSON**, not uncontrolled chat prose.
- Gemini detects the specific communicative gap and produces a small teaching intervention.
- A code-owned escalation ladder controls the amount of support, making the “adaptive teacher” claim demonstrable and safe.
- Gemini native **Marathi TTS** lets learners hear a natural line and a deliberately slow repeatable chunk.
- Gemini **Nano Banana** provides the world art and achievement-based live visual payoff; an Omni director turns a learner's prompt into a constrained scene variation without changing code-owned gameplay geometry.
- Gemini context caching keeps the fixed route rubric reusable, while a short-lived in-memory cache avoids repainting identical live prompts.
- Mission progression is guarded by code, so the model cannot invent routes, skip objectives, or rewrite the curriculum.

---

## User decisions and non-negotiable constraints

### Product decisions

- Project name: **Aamchi Boli**.
- No auth or login in the hackathon prototype.
- Full-screen, Kahani-like RPG feel—not a conventional dashboard.
- The user should be able to learn through **voice in Marathi**, with typed Marathi/transliteration as an accessibility/demo fallback.
- The learner knows English, so English meaning and Latin transliteration are useful scaffolds.
- Keep the scope polished and credible for a short hackathon build. Do not add a database or broad account system unless explicitly asked.
- User specifically asked for real game controls after noticing they were missing. The current code now adds WASD/arrows, mobile D-pad, a marker, real proximity gating, and E/Enter talk interaction.

### One named learner across all routes

The first screen collects a display name. That one learner uses the same student sprite across all three maps; do not reintroduce a character-picker or split-screen profile UI. Raju is now an NPC auto driver in the Bandra route.

This is a language-learning simulation. It must not make legal claims about eligibility, compulsory language compliance, or identity.

### Art provenance

- **In-game maps, character portraits, and earned reaction-frame generation:** Gemini Nano Banana / Gemini image model.
- **Single full-screen Mumbai-monsoon lobby background:** ChatGPT Image Generation. The user explicitly permitted this later for prebuilt imagery.
- Be transparent about this distinction in docs/presentation. It is already noted in `README.md`.
- Do not generate more assets unnecessarily: the existing world assets are good and the Gemini image quota should be conserved for the earned live completion frame.

---

## Current gameplay loop

### Phase 1: name the learner and choose a route

The lobby first asks what the world should call the learner. Its route-picker then shows three prebuilt Nano Banana map-image cards plus one standalone Kahani-style custom-world prompt. The custom world has its own Boli Guide and fixed micro-lesson, so it is never silently linked to a preset.

### Phase 2: explore

The mission starts on a prebuilt Nano Banana map. A full-viewport canvas renders the map, animated Kahani-style sprites, interaction rings, objective pings, and a touch joystick.

- Desktop: **WASD** or **arrow keys** move the animated player.
- Mobile: a press-and-hold joystick moves the player and the UI recommends landscape orientation on portrait screens.
- The player has walkable zones, blockers, an NPC target marker, and a real proximity radius.
- **E / Enter** or the yellow Talk button only works within that radius.
- Keyboard movement deliberately does not capture keys while an input/textarea/contenteditable has focus.

This is intentionally a lightweight collision-aware exploration layer above a static AI-generated map, with code-owned hotspots so live artwork cannot break the route.

### Phase 3: contextual Marathi conversation

When the player reaches the NPC, the NPC says a Marathi line plus a concise English translation. The learner can ask Gemini TTS to speak it.

The learner then either:

- records a short voice answer using `MediaRecorder`, or
- types Marathi, transliteration, or understandable mixed Marathi/English.

### Phase 4: Gemini review and adaptive teaching

The client tells the turn endpoint which exact objective is active and how many prior attempts have been made for that **specific step**.

The server loads only the fixed mission/step, then sends Gemini:

- Mumbai area, NPC name/role, and current practical objective;
- NPC line in Marathi and English;
- target phrase, transliteration, and English meaning;
- raw short audio inline for voice turns, or typed fallback text;
- prior-attempt count for the current objective; and
- explicit instructions to judge meaningful communication, never accent.

Gemini returns schema-constrained JSON containing:

```text
transcript / heard Marathi
intent
outcome
NPC reply in Marathi + English
natural recast
current skill evidence
support recommendation
what worked
one next adjustment
small Marathi practice chunk + transliteration + meaning
```

#### Code-owned adaptive ladder

The server clamps client-provided attempt count and chooses the coaching level after interpreting the model response:

| Situation | Level | What the learner sees |
| --- | ---: | --- |
| Practical goal succeeds | 0 | Brief affirmation; next objective unlocks. |
| First miss | 1 | One factual strength, one focused correction, natural recast / useful chunk. |
| Second+ miss | 2 | Small repeatable Marathi chunk, explicit “Hear slowly” Gemini TTS action, guided rebuild. |

The code also forces support off after success, preventing an answer hint for the next step from leaking into the UI.

#### Progression safety

- Gemini may evaluate the current step, but it cannot choose arbitrary game progression.
- A response advances exactly **one bounded step** only if its outcome is `success` **and** it named the current allowed skill as evidence.
- The server filters skill evidence to the current step’s skill.
- Missing/malformed recasts fall back to code-authored mission phrasing.

### Phase 5: interleaved review and learning evidence

Each route has three functional speaking goals. The browser stores no account/profile data.

Per objective, the app records:

- attempts;
- voice vs. typed submissions;
- whether support/hinting was used;
- independent first-try completion;
- recovery after guided practice; and
- voice/typed split, review attempts, later independent recall, and the last concrete error category.

When a learner misses, the response creates a review item keyed to `missionId + stepIndex`. The learner can practise a short chunk at a later “Memory checkpoint” without blocking the main mission. Review scoring uses the same Gemini endpoint in `mode: "review"`, and a later independent recall is counted separately from the original recovery.

The learning drawer shows independent clears, guided recoveries, later recalls, spoken-practice share, and the recurring error focus. Only local mission progress is retained in `localStorage`; raw audio is never persisted.

On final success, Nano Banana can generate a learner-specific completion frame. During play, the live scene prompt uses `/api/aamchi-boli/omni`: Omni writes a compact scene/learning variation and Nano Banana renders it against the fixed mission art direction. The client has stale-session protection, so a late response from an abandoned route cannot overwrite a newer run.

---

## Current mission catalogue

| ID | Character | Map / location | Three objectives |
| --- | --- | --- | --- |
| `kj-college-gate` | Aarav | KJ Somaiya College of Engineering gate, Vidyavihar | State destination; confirm main gate; thank Meera Tai. |
| `dadar-bus-stop` | Aarav | Dadar Station East | Ask for Shivaji Park bus; repeat landmark; thank Nisha Tai. |
| `bandra-station-pickup` | Learner meets Raju | Bandra Station East auto stand | Tell Raju BKC; confirm main bus-stop drop-off; thank him. |

The current map prompts use KJ/Vidyavihar visual context. Keep destination wording as-is unless the user asks otherwise, but do not add logos or readable real-world branding to generated artwork.

---

## Important repository locations

The active project is:

```text
/Users/arav/Desktop/Mumbai Boli
```

It is a copied/extended Kahani-style Next.js project. The original reference project is available at:

```text
/Users/arav/Downloads/kahani-main
```

The active directory may not be a Git repository. Do not assume `git status` works there.

### Main implementation files

| File | Responsibility |
| --- | --- |
| `app/page.tsx` | Renders Aamchi Boli at the root route. |
| `app/aamchi-boli/page.tsx` | Dedicated Aamchi Boli route. |
| `components/AamchiBoli.tsx` | Main state machine, character/mission selection, full-screen UI, movement-to-talk flow, recording, local learning metrics, and feedback rendering. |
| `components/BoliWorldCanvas.tsx` | Full-screen canvas map, animated sprites, collision-aware movement, map hotspots, proximity gate, WASD/arrows, joystick, and E/Enter interaction. |
| `lib/boli-config.ts` | The two characters, three missions, exact phrases, map/reaction prompts, and static map paths. |
| `lib/aamchi-boli.ts` | Gemini scoring/caching, strict objective guard, adaptive review normalization, Omni scene direction, Nano Banana map/reaction functions, and role-aware voice synthesis. |
| `lib/gemini.ts` | Shared Gemini calls and image handling/retry behavior. |
| `app/api/aamchi-boli/turn/route.ts` | Public no-auth turn-scoring endpoint. |
| `app/api/aamchi-boli/voice/route.ts` | Public Gemini TTS endpoint; supports `{ text, slow }`. |
| `app/api/aamchi-boli/map/route.ts` | Map endpoint. Existing routes normally use static local maps. |
| `app/api/aamchi-boli/reaction/route.ts` | Earned live Nano Banana reward endpoint. |
| `app/api/aamchi-boli/omni/route.ts` | Prompt-driven live scene variation endpoint with code-owned mission validation. |
| `lib/types/client.ts` | Client API shapes including adaptive feedback and per-step learning evidence. |
| `lib/types/shared.ts` | Mission and character types shared safely by client/server. |
| `README.md` | Judge-oriented project overview and 90-second demo narrative. |

### Asset locations

```text
public/aamchi-boli/maps/kj-college-gate.jpg
public/aamchi-boli/maps/dadar-bus-stop.jpg
public/aamchi-boli/maps/bandra-station-pickup.jpg
public/aamchi-boli/lobby/mumbai-monsoon-lobby.png
```

The first five game assets above are Nano Banana outputs. `lobby/mumbai-monsoon-lobby.png` is the approved ChatGPT ImageGen lobby asset.

---

## Gemini model configuration

The local `.env` should contain:

```bash
GEMINI_API_KEY=... # do not expose or commit
```

Defaults in code:

```text
IMAGE_MODEL=gemini-3.1-flash-image
BOLI_SCORING_MODEL=gemini-3.5-flash-lite
GEMINI_TTS_MODEL=gemini-3.1-flash-tts-preview
BOLI_OMNI_MODEL=gemini-omni-1.1-flash
SARVAM_TTS_MODEL=bulbul:v3
```

### Image quota behavior

Image generation requires billing/quota on the Gemini project attached to the key. The project previously encountered a Nano Banana zero-quota message, then the user enabled the quota. Avoid changing the static maps; they make mission starts fast and reliable. Live Omni variations and completion frames still require image quota and should gracefully fail without breaking learning. The scoring model uses best-effort Gemini explicit caching; Omni's Interactions API has no explicit Cached Content support here, so identical live world prompts use an in-process complete-result cache.

---

## What has been completed

- [x] Full product concept and problem framing targeted at the judging rubric.
- [x] Public no-login Aamchi Boli route.
- [x] One named learner across all three routes; Raju is the Bandra auto-driver NPC.
- [x] Three concrete Mumbai Marathi missions.
- [x] Prebuilt Nano Banana maps and two Nano Banana character portraits.
- [x] Full-screen Mumbai lobby and full-screen map-first gameplay shell.
- [x] Desktop and mobile visual treatment, including a compact quest HUD and learning drawer.
- [x] Voice recording with typed fallback.
- [x] Gemini structured multimodal scoring with contextual Marathi prompts.
- [x] Accent-safe practical-intent evaluation instruction.
- [x] Gemini Marathi TTS (`mr-IN`) plus browser speech fallback.
- [x] Slow Gemini TTS action for repeated coaching chunks.
- [x] Code-owned one-step progression and current-skill validation.
- [x] Per-objective attempt tracking, independent vs. supported completion evidence, and local best mastery score.
- [x] Adaptive feedback object: what worked, one next focus, key Marathi chunk, escalation level/strategy.
- [x] Full support ladder behavior in UI: phrase fragment, map cue, and slow-repeat treatment no longer all reveal the same full target phrase.
- [x] Stale success feedback is now shown as a clear “Checkpoint cleared” item rather than pretending it evaluates the next objective.
- [x] High-priority UI fixes: light cards now have dark text, mobile stats drawer has its own Close button, typed submission is disabled while recording, mobile voice buttons are labeled, and route exit is not blocked while the optional completion image is generating.
- [x] Kahani-style canvas movement layer: WASD/arrows, animated sprites, collision zones/blockers, touch joystick, NPC target, true proximity requirement, E/Enter/Talk unlock.
- [x] Prompt-driven live world variation: Omni scene director + Nano Banana renderer, short-lived complete-result cache, scoring-context cache where supported, and stale-session protection.
- [x] Interleaved review queue with memory checkpoints and separate later-recall metrics.
- [x] Voice-first interaction polish: WhatsApp-like microphone recording auto-submits after roughly three seconds of silence; manual stop remains available.
- [x] Strict objective-signal checks prevent vague answers (for example “yes”) from unlocking a destination or confirmation objective.
- [x] Sarvam voice path for non-Marathi language codes; Gemini native audio remains the Marathi path.
- [x] README with problem framing, model use, no-auth rationale, setup notes, architecture, asset note, and 90-second demo sequence.

---

## Immediate verification checklist

Run these before making broad changes. Do not overwrite unrelated user edits.

```bash
cd "/Users/arav/Desktop/Mumbai Boli"
npm run build
npx eslint components/AamchiBoli.tsx components/BoliWorldCanvas.tsx lib/aamchi-boli.ts app/api/aamchi-boli/voice/route.ts app/api/aamchi-boli/omni/route.ts lib/types/client.ts lib/types/shared.ts
npm run dev
```

Then manually check:

1. Lobby shows character **names and descriptions** in dark readable text on light cards.
2. Select Aarav → First Ride to KJ Somaiya.
3. Press WASD/arrows; the animated player moves over the canvas map and stops at collision boundaries.
4. Approach NPC target; the Talk control only becomes active inside the proximity radius.
5. Press E / Enter; the dialogue and voice/text response controls open.
6. Make one weak answer, then repeat it. Confirm feedback escalates from a recast to a slow guided chunk.
7. Make a correct Marathi answer. Confirm exactly one objective advances.
8. On phone width, confirm the bottom controls remain reachable and the Learning drawer can be closed.
9. Create an original safe world and confirm its full creation screen stays visible until the Omni/Nano Banana map has arrived.
10. Miss an objective with a vague answer such as “yes”; confirm the route stays on the same step and the response names one concrete missing detail.

### Live endpoint smoke tests already performed

These were tested against the locally configured Gemini key during the previous coding session:

- A weak typed first-route answer with `attemptsForStep: 2` returned `repair_needed`, code-owned `level: 2`, `supportRecommendation: "slow_repeat"`, and a small Marathi chunk.
- A correct Marathi destination answer returned `success`, `skillEvidence: ["destination"]`, `level: 0`, `supportRecommendation: "none"`, and `nextStep: 1`.
- Gemini TTS previously returned browser-playable WAV data.
- A full Raju Bandra mission has previously been completed and generated a live reaction image.

---

## Remaining work, in priority order

### P0 — finish / verify before demo

1. **Run the browser QA checklist above after the latest movement and adaptive UI changes.**
2. Verify microphone permission and a real spoken response from the browser.
3. Record a clean 90-second demo while image quota is available.

### P1 — valuable polish if time remains

1. Add a compact “Why this was accepted” success explanation using the existing `adaptiveFeedback.whatWorked` field.
2. Improve audio coaching without evaluating accent:
   - add `speechClarity: clear | repeat_key_chunk | audio_unclear` to the Gemini schema;
   - only say whether the key word / intent was audibly captured, never rate pronunciation/accent.
3. Add a tiny map ping/highlight for the `visual_hint` scaffold. Right now it deliberately gives a contextual map cue but does not animate a landmark.
4. Add a short end-of-route summary of the phrase chunks learned.

### P2 — do not prioritize for this hackathon

- Authentication, cloud save, database, leaderboard, or social features.
- A fully tiled collision/world engine.
- More maps or more image generation.
- General free-form chat beyond the constrained learning route.

---

## Known limitations / deliberate tradeoffs

- The map movement is a lightweight canvas engine over static AI art, not a tiled camera/world editor. Walkable zones and blockers are explicit mission metadata, so visual variations cannot change gameplay geometry.
- NPC and landmark coordinates are deliberate percentage-based hotspots in `lib/boli-config.ts`, tuned for the three static maps.
- The map only gates the *start* of a conversation. Once dialogue begins, the learner does not walk between individual language steps.
- Retry count comes from the client but is clamped server-side. Because this is a no-auth game, it is designed for learning feedback rather than adversarial score integrity.
- Current response scoring is model-based with a deterministic objective-signal guard. It is a practical communication coach, not a formal language-testing engine.
- No raw audio persistence is intentional.
- Live completion image generation depends on Gemini image quota; completion must still be meaningful if that final image fails.
- The dev app may show an inherited PostHog “initialized without a token” console message. It is not caused by Aamchi Boli and does not affect game behavior; do not spend hackathon time on it unless asked.

---

## Presentation / demo positioning

Use this story in the demo:

> “Aamchi Boli is not a Marathi flashcard app. It is a safe rehearsal for the exact Mumbai interaction a learner is worried about. The player physically approaches the person, speaks their intention, and Gemini decides whether the listener would understand. When they miss, it does not dump a translation—it identifies the one communicative gap, gives the smallest useful Marathi chunk, speaks it slowly, and measures whether they can recover independently.”

Suggested 90-second sequence:

1. Show the two perspectives: Aarav and Raju.
2. Pick Aarav at Vidyavihar; show the full-screen Nano Banana map.
3. Move with WASD to Meera Tai and press E to talk.
4. Play the Marathi TTS line.
5. Give an intentionally incomplete answer once. Show Gemini’s specific feedback and “Hear slowly” chunk.
6. Give a corrected Marathi answer. Show one-step unlock and independent/recovered metric.
7. Finish briefly using typed fallback if time is tight.
8. Show the earned Nano Banana completion image and local learning record.

Key phrase to repeat to judges: **“Gemini is the adaptive conversation engine; the code owns the curriculum and progression.”**

---

## Working style and safety notes for the next agent

- Preserve all unrelated existing project code; this project contains legacy Kahani functionality alongside Aamchi Boli.
- Use `apply_patch` for source-file edits.
- Do not delete/revert files or run destructive git commands.
- Prefer narrow lint/build checks after each meaningful change.
- Keep the user informed with short progress updates.
- Do not expose `.env`, its contents, API keys, raw recordings, or any credentials.
- If Gemini image quota fails, do not remove the maps or block learning gameplay; use the existing static art and treat the final image as optional.
- Be respectful about the Bihar/Mumbai language context. The product should focus on confidence, communication, and respectful service—not political or legal claims.

---

## Useful implementation details

### Adaptive response shape

`BoliTurnResponse` in `lib/types/client.ts` includes:

```ts
adaptiveFeedback: {
  level: 0 | 1 | 2;
  strategy: "affirm" | "recast" | "guided_rebuild";
  whatWorked: string;
  nextFocus: string;
  keyChunk: {
    marathi: string;
    transliteration: string;
    meaning: string;
  };
}
```

`attemptsForStep` is sent with each `BoliTurnRequest`; the server clamps it and decides the actual adaptation level.

### TTS

`POST /api/aamchi-boli/voice` accepts:

```json
{ "text": "...", "role": "auto driver", "language": "mr-IN", "slow": true }
```

The server uses Gemini TTS with `mr-IN` and converts PCM16 output to a browser-playable WAV data URL. For other language codes it uses Sarvam when `SARVAM_API_KEY` is available. The browser speech API is fallback only.

### The exploration API

`components/BoliWorldCanvas.tsx` owns the animation loop, map rendering, player pose, keyboard lifecycle, touch joystick, collision checks, hotspot proximity, and E/Enter interaction. The parent owns the high-level route state and unlocks dialogue in `onInteract`. `components/BoliWorldControls.tsx` is an unused predecessor and should not be reintroduced into the Aamchi route.

---

Last updated: 2026-08-30.
