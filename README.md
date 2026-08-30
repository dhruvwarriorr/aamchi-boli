# Aamchi Boli

### Learn Marathi where it matters: while moving through Mumbai.

**Aamchi Boli** is a voice-first Marathi learning RPG for English-speaking newcomers to Mumbai. Instead of memorising isolated flashcards, a learner enters a recognisable situation, speaks to a character, recovers from misunderstandings, and sees the conversation change because of what they said.

It is built for the small, high-stakes moments that language apps often miss: giving an auto destination, confirming a landmark, asking a local for directions, and closing a conversation politely.

## The problem

New residents can often read a phrase list but still freeze in a real Mumbai interaction. They need to practise **intent**, listening, polite repair, and the confidence to be understood, not chase a perfect accent.

Aamchi Boli makes that practice safe and specific. Gemini judges whether the learner's practical meaning was clear, gives a gentle Marathi recast when it was not, and unlocks the next part of the situation only when the message works.

## One learner, three Mumbai situations

The first screen asks what the world should call the learner. That one named learner stays on screen across all three routes; no profile, split-screen character view, or role swap interrupts the game.

| Route | Person the learner meets | Why it matters |
| --- | --- | --- |
| **KJ Somaiya ride** | **Meera Tai**, an auto driver | Builds confidence giving a clear destination and confirming a drop-off. |
| **Dadar directions** | **Nisha Tai**, a local commuter | Practises asking for and checking useful directions. |
| **Bandra ride** | **Raju**, an auto-rickshaw driver | Lets the learner practise being the passenger: naming BKC, confirming the bus-stop drop-off, and closing politely. |

This is practical language training for everyday service and community interactions, not a claim about legal eligibility or a substitute for any official language requirement.

## Three Mumbai missions

Each mission has three short speaking goals, Marathi in Devanagari, Latin transliteration, and an English meaning.

| Mission | Person met | Place | What the learner practises |
| --- | --- | --- | --- |
| **First Ride to KJ Somaiya** | Meera Tai | KJ Somaiya College of Engineering gate, Vidyavihar | Greeting an auto driver, stating a destination, confirming the main gate, thanking politely. |
| **A Turn at Dadar** | Nisha Tai | Dadar Station East | Asking for the Shivaji Park bus, repeating a landmark to confirm directions, closing the exchange. |
| **Bandra Ride with Raju** | Raju | Bandra Station East auto stand | Naming BKC, confirming the main bus-stop drop-off, and thanking the driver. |

## Gemini is the game mechanic, not a chat box

### 1. Gemini directs and paints the playable world

- The three detailed 16-bit Mumbai maps are generated with **Gemini Nano Banana** from tightly constrained environment prompts, then stored as fixed local game assets. This keeps mission starts fast and visual continuity reliable.
- A map prompt specifies the playable route, the NPC position, a quiet dialogue-HUD area, Mumbai details, palette, camera angle, and a strict no-text/no-logo constraint. It creates a game level, not a generic postcard.
- The route picker also offers a standalone **Create your own world** path. The learner can request anything safe, such as a floating library or an underwater garden. **Gemini Omni** shapes a playable scene direction and **Nano Banana** paints it before the player enters; an open-world Boli Guide supplies a compact, code-owned three-turn Marathi micro-lesson.
- The fixed scoring rubric uses Gemini explicit context caching on models that support it. Gemini Omni's Interactions API does not expose explicit Cached Content, so live world requests use a short-lived in-memory cache of the complete directed scene and image; an exact repeated prompt avoids both direction and repainting work. A cache hit is visible in the HUD.
- On mission completion, Gemini generates a **new learner-specific reaction frame**: for example, an NPC's warm farewell and a subtle success path based on the learner's final exchange. It is generated only after success is earned, so the live image has narrative meaning and image quota is not wasted on every turn.

The full-screen route picker shows the three prebuilt Nano Banana map presets as playable image cards, plus one Kahani-style custom-world prompt. The single Mumbai-monsoon backdrop is shell art made with ChatGPT Image Generation; the actual game maps and live achievement frames are Gemini/Nano Banana work, so the game mechanics and visual payoff remain directly tied to Gemini.

### 2. Gemini scores real speech multimodally

The app sends a short microphone recording directly to Gemini as inline audio. A typed response is available as an accessibility and demo fallback.

Gemini returns a constrained structured response, not free-form prose:

```text
transcript · heard Marathi · practical intent · outcome
NPC reply in Marathi + English · gentle recast
skill evidence · next-step support · completion reaction prompt
```

The game accepts Marathi, transliterated Marathi, and understandable mixed Marathi/English. It evaluates whether the learner communicated the current goal and deliberately **does not score accent**. Code owns the mission state: a model response can advance only one valid step, and only a successful practical exchange advances the route.

A deterministic objective-signal guard runs after Gemini: a destination turn must mention the destination, a gate turn must confirm the gate, and so on. A vague “yes” can receive coaching, but it cannot accidentally unlock the route. Misses become review cards instead of disappearing into chat history. Review cards return later as memory checkpoints, where independent recall is tracked separately from supported recovery.

### 3. Gemini and Sarvam speak back in the learner's language

NPC dialogue is synthesised with **Gemini native audio / TTS** using `mr-IN`. The learner can replay the NPC line before responding, making the experience useful for early readers and for learners who need to hear cadence before speaking. The voice route also accepts a language code; non-Marathi voices use the configured **Sarvam** key. The browser speech API is only a resilience fallback if audio generation is temporarily unavailable.

## Learning metrics without login

There is intentionally no account wall or database for the hackathon prototype. Progress stays on the device in `localStorage`.

For every mission, Aamchi Boli records:

- cleared speaking goals and their language skill;
- total attempts, including **voice vs. typed** attempts;
- first-try wins;
- successful recovery after a repair/hint; and
- independent first-try clears, guided recoveries, and later independent recalls, shown separately instead of collapsed into one generic score.

Only the learner's best mastery score is retained in their browser. Short audio is used to score the live turn and is not persisted by the app.

## Architecture

```text
Browser microphone / typed fallback
              │
              ▼
 Next.js route: /api/aamchi-boli/turn
              │ short audio + fixed mission context
              ▼
 Gemini multimodal structured scoring
              │ transcript, intent, recast, support, outcome
              ▼
 Local mission state + learning metrics
              │                              │
              ▼                              ▼
 Gemini Marathi TTS / Sarvam       Omni scene director
              │                              │
              └──────────────┬───────────────┘
                             ▼
                     Nano Banana live frame
```

The persistent Mumbai maps live at `public/aamchi-boli/maps/`; a standalone custom world and the earned reward frame are on-demand image generation. Fixed hotspots, walkable zones, and mission state remain code-owned.

## Stack

- **Next.js 16 + TypeScript + Tailwind CSS**: touch-friendly game UI
- **Full-screen RPG shell**: a Kahani-style canvas world, animated sprites, map collision zones, proximity-gated NPCs, WASD/arrow controls, touch joystick, compact quest HUD, bottom dialogue deck, and a toggleable learning drawer
- **Gemini image model** (default: `gemini-3.1-flash-image`): Nano Banana map and reaction art
- **Gemini Omni director** (default: `gemini-omni-1.1-flash`): turns a learner's custom scene prompt into a safe playable world direction; falls back to the scoring model when unavailable
- **Gemini multimodal model** (default: `gemini-3.5-flash-lite`): audio-aware, schema-constrained turn scoring
- **Gemini TTS model** (default: `gemini-3.1-flash-tts-preview`): Marathi NPC voice
- **Sarvam Bulbul** (optional): non-Marathi voice fallback when `SARVAM_API_KEY` is configured
- **MediaRecorder + localStorage**: browser recording and no-auth local mastery

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local `.env` file in the project root and add your Gemini key:

   ```bash
   GEMINI_API_KEY=your_key_here
   ```

   Never commit or paste this key into chat. The project uses the defaults above, but these optional overrides are supported:

   ```bash
   IMAGE_MODEL=gemini-3.1-flash-image
   BOLI_SCORING_MODEL=gemini-3.5-flash-lite
   GEMINI_TTS_MODEL=gemini-3.1-flash-tts-preview
   BOLI_OMNI_MODEL=gemini-omni-1.1-flash
   SARVAM_API_KEY=your_sarvam_key_here
   SARVAM_TTS_MODEL=bulbul:v3
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000), enter the learner's name and feedback language, then choose a preset or create an original world.

For a production check:

```bash
npm run build
```

For live language acceptance checks (with the server running), use:

```bash
npm run test:aamchi
```

It exercises English, Marathi transliteration, and Devanagari responses; vague-answer blocking; adaptive escalation; memory checkpoints; and request validation against the configured Gemini API.

### Image-generation note

Nano Banana requires image-generation quota on the Gemini project attached to `GEMINI_API_KEY`. The three prebuilt maps keep the core game usable once they are generated; live prompt variations and completion frames need available image quota. If the app says that Nano Banana cannot paint a frame, enable billing/quota for that same Gemini API project and retry. Omni scene direction can fall back to the scoring model, but image rendering still needs Nano Banana quota.

## 90-second hackathon demo

| Time | What to show | What it proves |
| --- | --- | --- |
| **0 to 10s** | Open Aamchi Boli, enter a learner name, then show the three image-based Mumbai-world presets. | Clear, personal problem framing, not a generic language chatbot. |
| **10 to 22s** | Choose **First Ride to KJ Somaiya**, or type one original world prompt and let the creation screen finish. | A concrete, culturally grounded use case with prebuilt Nano Banana game art and a standalone live-generation path. |
| **22 to 34s** | Press **Hear Gemini voice**. Point out Marathi, transliteration, and English meaning. | Marathi TTS and beginner-friendly multimodal teaching. |
| **34 to 50s** | Speak: “नमस्कार, मला के. जे. सोमय्या कॉलेज ऑफ इंजिनिअरिंगला जायचे आहे.” | Gemini receives real audio and judges communicative intent, not accent. |
| **50 to 62s** | Show the returned transcript, NPC reply, intent, and unlocked skill. If needed, type an imperfect answer once to show the repair/hint loop. | Structured Gemini response drives the game state and adapts to the learner. |
| **62 to 78s** | Complete the remaining two turns using voice or the typed fallback. | A focused three-turn learning loop with measurable outcomes. |
| **78 to 88s** | Let the earned Nano Banana reaction frame appear. | Live generation is tied to a learner achievement, not decoration. |
| **88 to 90s** | Show mastery, first-try/recovery evidence, and local best score. | The experience measures learning without requiring login or collecting a profile. |

## Project guide

| Path | Purpose |
| --- | --- |
| `components/AamchiBoli.tsx` | Learner-name setup, route flow, microphone handling, adaptive review queue, live scene prompt, metrics, and UI. |
| `components/BoliWorldCanvas.tsx` | Kahani-style full-screen canvas world, sprite animation, collision bounds, proximity checks, keyboard controls, and mobile joystick. |
| `lib/boli-config.ts` | Three fixed Mumbai missions, their NPCs, phrases, geometry, and Nano Banana art prompts. |
| `lib/aamchi-boli.ts` | Gemini scoring/caching, strict objective validation, adaptive review items, Omni scene direction, Nano Banana rendering, and voice synthesis. |
| `app/api/aamchi-boli/*` | Public no-auth API routes for maps, scoring, voice, and earned reaction frames. |
| `public/aamchi-boli/maps/` | The three prebuilt Nano Banana mission maps. |
| `public/aamchi-boli/lobby/` | The prebuilt full-screen Mumbai route-picker backdrop. |

---

Built for **Gemini Hackday 2.0**: a technically meaningful use of Gemini that helps people practise Marathi in the situations where confidence matters most.
