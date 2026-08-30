# Aamchi Boli

### Learn Marathi where it matters: while moving through Mumbai.

**Aamchi Boli** is a voice-first Marathi learning RPG for English-speaking newcomers to Mumbai. Instead of memorising isolated flashcards, a learner enters a recognisable situation, speaks to a character, recovers from misunderstandings, and sees the conversation change because of what they said.

It is built for the small, high-stakes moments that language apps often miss: giving an auto destination, confirming a landmark, asking a local for directions, and closing a conversation politely.

## The problem

New residents can often read a phrase list but still freeze in a real Mumbai interaction. They need to practise **intent**, listening, polite repair, and the confidence to be understood—not chase a perfect accent.

Aamchi Boli makes that practice safe and specific. Gemini judges whether the learner's practical meaning was clear, gives a gentle Marathi recast when it was not, and unlocks the next part of the situation only when the message works.

## Two learner perspectives

| Route | Learner | Why it matters |
| --- | --- | --- |
| **New student** | **Aarav**, a first-year engineering student new to Mumbai | Builds confidence getting around campus and asking for help without switching straight to English. |
| **Working driver** | **Raju**, a Bihar-born Mumbai auto-rickshaw driver | Practises clear, respectful passenger conversations: welcoming, checking an exact destination, and confirming a ride. |

This is practical language training for everyday service and community interactions—not a claim about legal eligibility or a substitute for any official language requirement.

## Three Mumbai missions

Each mission has three short speaking goals, Marathi in Devanagari, Latin transliteration, and an English meaning.

| Mission | Route | Place | What the learner practises |
| --- | --- | --- | --- |
| **First Ride to KJ Somaiya** | Aarav | KJ Somaiya College of Engineering gate, Vidyavihar | Greeting an auto driver, stating a destination, confirming the main gate, thanking politely. |
| **A Turn at Dadar** | Aarav | Dadar Station East | Asking for the Shivaji Park bus, repeating a landmark to confirm directions, closing the exchange. |
| **The Bandra Pickup** | Raju | Bandra Station East auto stand | Welcoming a passenger, asking for the exact BKC drop-off instead of guessing, confirming the ride carefully. |

## Gemini is the game mechanic, not a chat box

### 1. Nano Banana creates the playable world and the earned payoff

- The three detailed 16-bit Mumbai maps are generated with **Gemini Nano Banana** from tightly constrained environment prompts, then stored as fixed local game assets. This keeps mission starts fast and visual continuity reliable.
- A map prompt specifies the playable route, the NPC position, a quiet dialogue-HUD area, Mumbai details, palette, camera angle, and a strict no-text/no-logo constraint. It creates a game level, not a generic postcard.
- On mission completion, Gemini generates a **new learner-specific reaction frame**: for example, an NPC's warm farewell and a subtle success path based on the learner's final exchange. It is generated only after success is earned, so the live image has narrative meaning and image quota is not wasted on every turn.

The full-screen route picker has one prebuilt Mumbai-monsoon backdrop made with ChatGPT Image Generation. It is shell art only; every in-game world map, character portrait, and live achievement frame is Gemini/Nano Banana work, so the game mechanics and visual payoff remain directly tied to Gemini.

### 2. Gemini scores real speech multimodally

The app sends a short microphone recording directly to Gemini as inline audio. A typed response is available as an accessibility and demo fallback.

Gemini returns a constrained structured response, not free-form prose:

```text
transcript · heard Marathi · practical intent · outcome
NPC reply in Marathi + English · gentle recast
skill evidence · next-step support · completion reaction prompt
```

The game accepts Marathi, transliterated Marathi, and understandable mixed Marathi/English. It evaluates whether the learner communicated the current goal and deliberately **does not score accent**. Code owns the mission state: a model response can advance only one valid step, and only a successful practical exchange advances the route.

### 3. Gemini speaks back in Marathi

NPC dialogue is synthesised with **Gemini native audio / TTS** using `mr-IN`. The learner can replay the NPC line before responding, making the experience useful for early readers and for learners who need to hear cadence before speaking. The browser speech API is only a resilience fallback if audio generation is temporarily unavailable.

## Learning metrics without login

There is intentionally no account wall or database for the hackathon prototype. Progress stays on the device in `localStorage`.

For every mission, Aamchi Boli records:

- cleared speaking goals and their language skill;
- total attempts, including **voice vs. typed** attempts;
- first-try wins;
- successful recovery after a repair/hint; and
- a mission mastery score: **100%** for a first-try skill clear, **82%** after a successful retry, averaged across the three goals.

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
 Gemini Marathi TTS                  Nano Banana reaction frame
```

The persistent maps live at `public/aamchi-boli/maps/`; the live reward frame is intentionally the only on-demand image generation during a successful run.

## Stack

- **Next.js 16 + TypeScript + Tailwind CSS** — touch-friendly game UI
- **Full-screen RPG shell** — a map-first play view, compact quest HUD, bottom dialogue deck, and a toggleable learning drawer that stays usable on desktop and mobile
- **Gemini image model** (default: `gemini-3.1-flash-image`) — Nano Banana map and reaction art
- **Gemini multimodal model** (default: `gemini-3.5-flash-lite`) — audio-aware, schema-constrained turn scoring
- **Gemini TTS model** (default: `gemini-3.1-flash-tts-preview`) — Marathi NPC voice
- **MediaRecorder + localStorage** — browser recording and no-auth local mastery

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
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000), allow microphone access, choose a learner route, and begin a mission.

For a production check:

```bash
npm run build
```

### Image-generation note

Nano Banana requires image-generation quota on the Gemini project attached to `GEMINI_API_KEY`. The three prebuilt maps keep the core game usable once they are generated; a live completion frame needs available image quota. If the app says that Nano Banana cannot paint a frame, enable billing/quota for that same Gemini API project and retry.

## 90-second hackathon demo

| Time | What to show | What it proves |
| --- | --- | --- |
| **0–10s** | Open Aamchi Boli and show the two routes: Aarav and Raju. | Clear, inclusive problem framing—not a generic language chatbot. |
| **10–22s** | Choose Aarav → **First Ride to KJ Somaiya**. Let the Vidyavihar map load. | A concrete, culturally grounded use case with prebuilt Nano Banana game art. |
| **22–34s** | Press **Hear Gemini voice**. Point out Marathi, transliteration, and English meaning. | Marathi TTS and beginner-friendly multimodal teaching. |
| **34–50s** | Speak: “नमस्कार, मला के. जे. सोमय्या कॉलेज ऑफ इंजिनिअरिंगला जायचे आहे.” | Gemini receives real audio and judges communicative intent, not accent. |
| **50–62s** | Show the returned transcript, NPC reply, intent, and unlocked skill. If needed, type an imperfect answer once to show the repair/hint loop. | Structured Gemini response drives the game state and adapts to the learner. |
| **62–78s** | Complete the remaining two turns using voice or the typed fallback. | A focused three-turn learning loop with measurable outcomes. |
| **78–88s** | Let the earned Nano Banana reaction frame appear. | Live generation is tied to a learner achievement, not decoration. |
| **88–90s** | Show mastery, first-try/recovery evidence, and local best score. | The experience measures learning without requiring login or collecting a profile. |

## Project guide

| Path | Purpose |
| --- | --- |
| `components/AamchiBoli.tsx` | Character choice, mission flow, microphone handling, metrics, and UI. |
| `lib/boli-config.ts` | The two learner routes, three fixed Mumbai missions, phrases, and Nano Banana art prompts. |
| `lib/aamchi-boli.ts` | Gemini image generation, multimodal scoring, structured output validation, and Marathi TTS. |
| `app/api/aamchi-boli/*` | Public no-auth API routes for maps, scoring, voice, and earned reaction frames. |
| `public/aamchi-boli/maps/` | The three prebuilt Nano Banana mission maps. |
| `public/aamchi-boli/lobby/` | The prebuilt full-screen Mumbai route-picker backdrop. |

---

Built for **Gemini Hackday 2.0**: a technically meaningful use of Gemini that helps people practise Marathi in the situations where confidence matters most.
