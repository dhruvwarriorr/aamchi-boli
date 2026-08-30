# Aamchi Boli: 7 Minute Pitch and Demo Guide

## One sentence

Aamchi Boli is a voice-first Marathi learning RPG where learners practise real communication inside Mumbai presets or a world they invent, while Gemini interprets speech, teaches one useful correction, and advances the game only when the learner says the needed meaning in Marathi.

## Safe demo setup

Before presenting:

1. Open `http://localhost:3010/aamchi-boli`.
2. Enter your name and keep feedback language set to English.
3. Generate this world once so an exact retry can use the 15 minute cache:
   `A safe clockwork garden with glowing trees, friendly lanterns, and a wide brass path.`
4. Keep a second tab on the route picker as backup.
5. Allow microphone permission before the judges arrive.

## Exact conversation for a generated world

The custom world has three short tasks. Use voice first. The typed versions are reliable backups.

### Task 1: greet the Boli Guide

- Marathi: `नमस्कार!`
- Transliteration: `Namaskar!`
- Meaning: `Hello!`

Use `नमस्कार` or `Namaskar` in the demo. English and Hindi are intentionally not accepted as completed Marathi practice.

### Task 2: say what you see

Use the scene-specific phrase shown in the yellow card. For the clockwork garden, a natural answer is:

- Marathi: `मला इथे चमकणारी झाडे दिसतात.`
- Transliteration: `Mala ithe chamakanari zhade disatat.`
- Meaning: `I can see glowing trees here.`

The essential communicative chunk is `मला ... दिसते` or `मला ... दिसतात`, meaning `I can see ...`.

### Task 3: ask for Marathi help

- Marathi: `मला मराठी शिकायची आहे. मदत करा.`
- Transliteration: `Mala Marathi shikayachi aahe. Madat kara.`
- Meaning: `I want to learn Marathi. Please help me.`

After task 3, the quest reaches 100%, the completion card appears, learning metrics are saved locally, and Nano Banana begins painting the earned completion image.

## Seven minute pitch

### 0:00 to 0:45: problem

Say:

> People moving to Maharashtra can memorise vocabulary but still freeze in a real conversation. A phrase list cannot tell them whether a driver or commuter would actually understand their intention. They need safe, contextual speaking practice, respectful correction, and another chance to try.

### 0:45 to 1:20: solution

Say:

> Aamchi Boli turns practical Marathi into a small role-playing game. You walk through a scene, approach a character, hear Marathi, and answer by voice. Gemini checks communicative meaning in Marathi rather than accent or perfect grammar. An English or Hindi answer is respectfully flagged and does not clear the task. A correct Marathi answer moves the quest forward. A wrong answer stays on the same task and unlocks one small correction.

### 1:20 to 2:10: show the worlds

Show the three presets:

- KJ Somaiya college gate
- Dadar station directions
- Bandra ride with Raju

Then show the custom prompt.

Say:

> These presets solve common Mumbai interactions. The fourth option is a standalone generated world. Gemini Omni turns any safe idea into a playable scene direction and a contextual Marathi phrase. Nano Banana paints the map before the player enters.

### 2:10 to 4:30: complete the generated level

1. Enter the cached clockwork garden prompt.
2. Show the full creation screen.
3. Walk to the Boli Guide with WASD or arrows.
4. Press E or use Talk.
5. First say `Hello, I need help` to demonstrate that English does not advance a Marathi practice task.
6. Say `नमस्कार` to clear task 1.
7. Read the generated world phrase for task 2.
8. Say `मला मराठी शिकायची आहे. मदत करा.` for task 3.
9. Show 100% completion and the Learning drawer.

While demonstrating the failed answer, say:

> Notice that the quest remains at zero. Gemini explains that Marathi practice is needed, gives the smallest useful Marathi chunk, and asks for another try. The code-owned objective guard prevents a generous model response from skipping the task.

### 4:30 to 5:40: explain the learning design

Say:

> The learning loop is deliberately short: listen, produce Marathi, get one correction, retry, then recall it later. We track independent success separately from guided recovery. A missed phrase enters a memory queue only after the learner advances, so review never blocks the main story. We never score accent or identity.

Show:

- first-try clears
- guided recoveries
- voice versus typed attempts
- later independent recalls
- recurring concept to revisit

### 5:40 to 6:40: explain Gemini architecture

Say:

> Gemini is not a decorative chatbot here. It is used at five points. First, Omni directs custom worlds and writes one scene-grounded Marathi phrase. Second, Nano Banana paints the playable map. Third, Gemini receives the actual audio and returns a structured assessment with transcript, intent, coaching, and NPC reply. Fourth, Gemini native audio speaks Marathi slowly or naturally. Fifth, Nano Banana creates an earned completion frame. The fixed curriculum is cached, while deterministic code owns collisions, objectives, progression, metrics, and validation.

### 6:40 to 7:00: close

Say:

> Aamchi Boli makes language practice feel like completing a real situation, not filling a worksheet. The learner leaves with a phrase they spoke, repaired, and later recalled inside a world they cared about.

## Architecture flow

```text
Name and feedback language
        |
        v
Preset route or custom prompt
        |
        +--> Gemini Omni: safe scene direction plus contextual phrase
        |        |
        |        v
        |    Nano Banana: playable pixel-art map
        |
        v
Canvas RPG: movement, collision, hotspot, proximity
        |
        v
Voice or typed learner response
        |
        v
Turn API: fixed mission plus current objective plus attempt history
        |
        v
Gemini multimodal structured assessment
        |
        v
Code-owned objective signal guard
        |
        +--> fail: one correction plus phrase chunk plus later review
        |
        +--> pass: advance exactly one task
                    |
                    v
             task 3 completed
                    |
                    v
        metrics plus earned Nano Banana frame
```

## Three minute judge Q and A

### Why Gemini instead of a normal speech-to-text service?

Gemini receives raw audio together with the exact scene, NPC line, current objective, acceptable intent, and attempt history. It can judge practical meaning and generate a response-specific correction in one structured turn. Plain transcription alone cannot decide whether the listener would know what action to take.

### How do you prevent Gemini from accepting everything?

Gemini proposes the assessment, but deterministic objective signals and a Marathi-production guard control progression. For example, the KJ destination task must contain Somaiya in Marathi or Marathi transliteration, and the gate confirmation must contain both agreement and gate. An English or Hindi answer, or a vague `yes`, cannot advance. The server can advance at most one bounded step.

### What is generated live?

Custom world direction, one contextual Marathi phrase, the custom map, adaptive coaching, NPC replies, voice, and the earned completion image are live. The three Mumbai maps are prebuilt for a fast and reliable demo.

### Where is caching used?

The fixed mission curriculum uses Gemini Cached Content where the model and account support it. Identical Omni world prompts use a 15 minute in-process result cache, so the scene direction and image are not regenerated during a repeated demo.

### Is this evaluating accent?

No. The prompt explicitly forbids accent and identity scoring. The app checks whether the needed communicative meaning was present. Unclear audio is separated from incorrect language.

### What happens if image generation fails?

Preset missions remain playable. A custom generation failure returns the learner to the builder with the prompt preserved and a clear error. Completion remains valid even if the optional reward image fails.

### Why no login or database?

This prototype is designed for a quick, private practice session. Progress and best mastery are stored locally. Raw recordings are sent for the current assessment and are not stored by the app.
