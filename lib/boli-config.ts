import type { BoliCharacterCard } from "./types/client";
import type { BoliMission, BoliSkillId } from "./types/shared";

/** Ordered vocabulary for the local, no-login mastery meter. */
export const BOLI_SKILLS: BoliSkillId[] = [
  "greeting",
  "destination",
  "confirmation",
  "polite_closing",
  "clarification",
];

/** Public character cards for the two role-based learning routes. */
export const BOLI_CHARACTERS: BoliCharacterCard[] = [
  {
    id: "student",
    name: "Aarav",
    role: "First-year engineering student",
    hometown: "New to Mumbai",
    description:
      "A confident English speaker who wants to handle their first Marathi auto ride to college.",
    portraitAssetPath: "/aamchi-boli/characters/aarav.jpg",
    available: true,
  },
  {
    id: "auto_driver",
    name: "Raju",
    role: "Auto-rickshaw driver",
    hometown: "Bihar → Mumbai",
    description:
      "Learn clear, respectful Marathi with passengers and build confidence on every ride.",
    portraitAssetPath: "/aamchi-boli/characters/raju.jpg",
    available: true,
  },
];

/** Shared visual direction exported with each map entry for the pre-generation script. */
export const BOLI_MAP_ASSET_STYLE =
  "Polished playable 16-bit pixel-art RPG map, clean top-down 3/4 perspective, crisp tile detail, rich Mumbai monsoon palette, no photorealism, no readable text, no logos, no UI, no speech bubbles, no watermark.";

/** Short, role-based Mumbai encounters; every mission has three practical speaking turns. */
export const BOLI_MISSIONS: BoliMission[] = [
  {
    id: "kj-college-gate",
    characterId: "student",
    title: "First Ride to KJ Somaiya",
    area: "KJ Somaiya College of Engineering Gate · Vidyavihar",
    briefing:
      "You have ten minutes before your first lecture. Tell the auto driver where you need to go, confirm the drop-off point, and thank her in Marathi.",
    npcName: "Meera Tai",
    npcRole: "Auto-rickshaw driver",
    mapAssetPath: "/aamchi-boli/maps/kj-college-gate.jpg",
    npcPosition: { x: 58, y: 57 },
    playerStart: { x: 28, y: 64 },
    // Pavement in front of the gate plus the road; the wall, gate and campus are solid.
    walkable: [{ x: 4, y: 46, w: 92, h: 32 }],
    blockers: [{ x: 63, y: 45, w: 20, h: 17 }],
    mapPrompt:
      "Create a polished, playable 16-bit pixel-art RPG map in a clean top-down 3/4 perspective, set outside a large red-brick engineering college in Vidyavihar, Mumbai, with absolutely no readable college name, logos, signs, or text. Compose it like a real game level: the campus main gate and broad stone arch occupy the upper centre, leafy monsoon trees and red-brick academic buildings sit beyond the gate, and a rain-darkened Mumbai lane runs horizontally across the lower half. At the right-middle curb, place one clearly recognisable black-and-yellow Mumbai auto-rickshaw angled slightly toward the gate, with its passenger side open and nobody inside or beside it. The centre and left-middle pavement must be wide, open, empty walkable stone paving. Add a small covered bus-stop shelter at far left, a bicycle rack and puddles near the college wall, wet crosswalk markings, reflective puddles, and a single distant city bus as background ambience only. Use crisp tile-like paving, rich saffron, teal, brick-red, and monsoon-green palette, soft rain residue rather than active heavy rain, warm late-afternoon light, pixel-level environmental detail. Reserve the bottom 22 percent of the canvas as quieter dark pavement and soft shadow with no important objects, suitable for a dialogue HUD. EMPTY STAGE PLATE: draw no people anywhere in the playable mid-ground, because character sprites are composited on top later. No student, no driver, no passenger, no vendor. No glowing rings, highlight circles, or interaction markers. No readable letters or numbers anywhere.",
    reactionPrompt:
      "Create a celebratory but still playable 16-bit pixel-art RPG completion scene in the same coherent Vidyavihar college-gate map: a top-down 3/4 view of a rain-fresh red-brick engineering campus entrance inspired by KJ Somaiya College of Engineering, with no readable branding, logos, signs, or text. Keep the black-and-yellow Mumbai auto-rickshaw parked at the right-middle curb and the broad college gate in the upper centre so it unmistakably matches the earlier map. Meera Tai stands by the auto with a warm proud smile and one hand raised in a natural farewell; Aarav stands a few tiles to her left, backpack on, making a polite appreciative gesture before walking along the clearly visible path toward the gate. Background students move into campus, a bicycle rack, monsoon trees, puddles, wet paving, and distant red-brick buildings create a lively but uncluttered Mumbai setting. Add one subtle non-textual golden sparkle trail or small celebratory lantern-like particle effect around Aarav and Meera to signal mission success, never a trophy, badge, words, letters, numbers, or interface. Use the same saturated saffron, teal, brick-red, and monsoon-green palette, crisp tile detail, soft reflected late-afternoon light, coherent character scale, and deliberately open darker pavement along the bottom 22 percent for a dialogue HUD. Game asset quality, not poster art; no photorealism, no text, no speech bubbles, no watermark.",
    steps: [
      {
        objective: "Greet Meera Tai and say that you want to go to KJ Somaiya College of Engineering.",
        npcPromptMr: "नमस्कार! कुठे जायचे आहे?",
        npcPromptEn: "Hello! Where would you like to go?",
        targetPhraseMr:
          "नमस्कार, मला के. जे. सोमय्या कॉलेज ऑफ इंजिनिअरिंगला जायचे आहे.",
        targetPhraseLatin:
          "Namaskar, mala K. J. Somaiyya College of Engineering-la jayache aahe.",
        targetPhraseEn: "Hello, I want to go to K. J. Somaiya College of Engineering.",
        successCriteria:
          "The learner asks to be taken to Somaiya college. Naming the college in any recognisable way counts: 'Somaiya', 'KJ Somaiya', 'Somaiya college', with or without 'College of Engineering'. A greeting is welcome but NOT required to pass.",
        skill: "destination",
      },
      {
        objective: "Confirm that you want to get down at the main gate.",
        npcPromptMr: "कॉलेजच्या मुख्य गेटवर उतरायचे का?",
        npcPromptEn: "Would you like to get down at the college's main gate?",
        targetPhraseMr: "हो, मुख्य गेटवर उतरायचे आहे.",
        targetPhraseLatin: "Ho, mukhya gatevar utarayache aahe.",
        targetPhraseEn: "Yes, I want to get down at the main gate.",
        successCriteria:
          "The learner agrees AND points to the gate. Any of 'ho'/'hoy'/'haan' plus a reference to the gate ('mukhya gate', 'main gate', 'gate', 'gate var') passes. Saying only 'yes' with no mention of the gate does not.",
        skill: "confirmation",
      },
      {
        objective: "Thank Meera Tai politely after reaching the gate.",
        npcPromptMr: "आलो! तुमची पहिली लेक्चर चांगली जावो.",
        npcPromptEn: "We are here! I hope your first lecture goes well.",
        targetPhraseMr: "धन्यवाद, ताई.",
        targetPhraseLatin: "Dhanyavad, tai.",
        targetPhraseEn: "Thank you, ma'am/sister.",
        successCriteria:
          "The learner thanks Meera. 'Dhanyavad', 'dhanyawad', 'thank you tai', or any clear Marathi-flavoured thanks passes, with or without 'tai'.",
        skill: "polite_closing",
      },
    ],
  },
  {
    id: "dadar-bus-stop",
    characterId: "student",
    title: "A Turn at Dadar",
    area: "Dadar Station East · Mumbai",
    briefing:
      "After arriving at Dadar, you need to find the bus for Shivaji Park. Ask a local commuter for help, repeat the key landmark to check that you understood, and thank her before you leave.",
    npcName: "Nisha Tai",
    npcRole: "Local commuter",
    mapAssetPath: "/aamchi-boli/maps/dadar-bus-stop.jpg",
    npcPosition: { x: 52, y: 50 },
    playerStart: { x: 24, y: 64 },
    // The tiled plaza only; the road, footbridge and station facade are solid.
    walkable: [{ x: 4, y: 40, w: 66, h: 34 }],
    blockers: [{ x: 10, y: 39, w: 9, h: 8 }, { x: 0, y: 45, w: 9, h: 18 }],
    mapPrompt:
      "Create a polished, playable 16-bit pixel-art RPG map in a clean top-down 3/4 perspective outside Dadar Station East in Mumbai, with absolutely no readable station name, route number, logos, shop signs, advertisements, letters, or text. Compose it as a real game level: a distinctive but generic old Mumbai station entrance and covered pedestrian footbridge occupy the upper centre, with its stairs coming down to a broad rain-darkened plaza. A bus-stop lane runs across the middle, with one unlabelled red city bus stopped far in the background and a small plain shelter at the left-middle curb. The centre and centre-left plaza must be wide, open, empty tiled paving with nobody standing on it. Add restrained Dadar life at the edges only: flower baskets at a tiny stall, an unlabelled tea cart, tiled footpaths, a distant black-and-yellow Mumbai taxi, puddles reflecting warm lights, and soft monsoon trees at the far edges. Use rich saffron, teal, brick-red, wet charcoal, and monsoon-green tones; late-afternoon after-rain light; tile-level environmental detail. Reserve the bottom 22 percent as quiet darker pavement and soft shadow with no important objects for a dialogue HUD. EMPTY STAGE PLATE: draw no people anywhere in the playable mid-ground, because character sprites are composited on top later. No student, no driver, no passenger, no vendor. No glowing rings, highlight circles, or interaction markers. No readable letters or numbers anywhere.",
    reactionPrompt:
      "Create a celebratory but still playable 16-bit pixel-art RPG completion scene in the same coherent Dadar Station East map, top-down 3/4 view, with no readable text, signs, advertisements, logos, UI, speech bubbles, or watermark. Keep the generic station entrance and covered footbridge in the upper centre, the bus shelter at left-middle, wet plaza, flower baskets, small tea cart, puddles, and a distant unlabelled red city bus so it clearly matches the earlier mission map. Nisha Tai stands by the clear path with a warm encouraging smile, gesturing toward the bus shelter. Aarav, backpack on, gives a polite grateful nod and begins walking toward it. Add only a subtle non-textual golden sparkle trail between them to signal a successful exchange; never use letters, numbers, badges, or trophies. Preserve the crisp 16-bit tile art, saturated saffron, teal, brick-red, wet charcoal, and monsoon-green palette, coherent character scale, after-rain reflections, and open darker pavement along the bottom 22 percent for a dialogue HUD. Game asset quality, not poster art; no photorealism.",
    steps: [
      {
        objective: "Ask Nisha Tai where to find the bus going to Shivaji Park.",
        npcPromptMr: "नमस्कार! तुम्हाला काही मदत हवी आहे का?",
        npcPromptEn: "Hello! Do you need any help?",
        targetPhraseMr: "नमस्कार, शिवाजी पार्कला जाणारी बस कुठून मिळेल?",
        targetPhraseLatin:
          "Namaskar, Shivaji Park-la janari bus kuthun milel?",
        targetPhraseEn: "Hello, where can I get the bus that goes to Shivaji Park?",
        successCriteria:
          "The learner asks where to catch the bus for Shivaji Park. They must name Shivaji Park and make it clear they are asking about a bus or where to go. Exact grammar does not matter.",
        skill: "destination",
      },
      {
        objective: "Repeat the landmark back to Nisha Tai to make sure you understood her directions.",
        npcPromptMr: "स्कायवॉकच्या खालील बस थांब्यावरून मिळेल. सरळ जा.",
        npcPromptEn: "You will get it from the bus stop below the skywalk. Go straight.",
        targetPhraseMr: "म्हणजे पुलाखालच्या बस थांब्यावर जायचे, बरोबर ना?",
        targetPhraseLatin:
          "Mhanje pulakhalachya bus thambyavar jayache, barobar na?",
        targetPhraseEn: "So I should go to the bus stop below the bridge, right?",
        successCriteria:
          "The learner repeats the landmark back to check they understood: the bus stop below the bridge/skywalk. Any phrasing that names the bridge/skywalk bus stop as their destination passes, question form or not.",
        skill: "clarification",
      },
      {
        objective: "Thank Nisha Tai and say that you will head there now.",
        npcPromptMr: "हो, अगदी बरोबर. तिथून बस मिळेल.",
        npcPromptEn: "Yes, exactly. You will get the bus from there.",
        targetPhraseMr: "खूप धन्यवाद, मी आता तिकडे जातो.",
        targetPhraseLatin: "Khoop dhanyavad, mi ata tikade jato.",
        targetPhraseEn: "Thank you very much, I will go there now.",
        successCriteria:
          "The learner thanks Nisha, and/or says they are heading there now. Either half alone passes.",
        skill: "polite_closing",
      },
    ],
  },
  {
    id: "bandra-station-pickup",
    characterId: "auto_driver",
    title: "The Bandra Pickup",
    area: "Bandra Station East Auto Stand · Mumbai",
    briefing:
      "A passenger arrives at Bandra Station and needs an auto to BKC. As Raju, welcome them, politely ask for the exact drop-off point instead of guessing, and confirm the ride with care.",
    npcName: "Ananya",
    npcRole: "Passenger arriving from a train",
    mapAssetPath: "/aamchi-boli/maps/bandra-station-pickup.jpg",
    npcPosition: { x: 62, y: 58 },
    playerStart: { x: 36, y: 68 },
    // The auto bay and raised plaza; the station, footbridge and far road are solid.
    walkable: [{ x: 14, y: 42, w: 70, h: 34 }],
    blockers: [{ x: 68, y: 44, w: 18, h: 18 }, { x: 20, y: 40, w: 30, h: 7 }],
    mapPrompt:
      "Create a polished, playable 16-bit pixel-art RPG map of a Mumbai suburban railway-station auto-rickshaw stand, in a TRUE OVERHEAD TOP-DOWN THREE-QUARTER game camera, as if the camera floats high above the street looking down at about a 60-degree angle, exactly like a classic top-down 16-bit role-playing game town map. CRITICAL CAMERA RULE: this must NOT be a side-on elevation or a street-level view; rooftops, vehicle canopy tops, and the ground plane must all be visible from above, and the paved ground should occupy most of the canvas. Layout: a generic historic Mumbai railway-station side facade with an elevated pedestrian footbridge across the upper portion only; below it a broad rain-wet paved auto-rickshaw bay fills the middle and lower frame. Place one black-and-yellow Mumbai auto-rickshaw at the right-middle curb, viewed from above at a three-quarter angle with its canopy roof visible, its passenger side open, and nobody inside or near it; keep this auto no more than 12 percent of the canvas width. Park three or four more empty autos in a neat angled queue in the upper-left middle distance, smaller with distance. The centre and lower-centre pavement must be a wide, open, completely empty walkable plaza of wet paving tiles. Ambience at the edges only: a small unlabelled tea stall at the far left, rain-polished curb stones, distant office towers and a few palms along the top edge, and puddles with warm reflections. Late-afternoon Mumbai monsoon after rain, wet reflective ground, warm low light, saturated saffron, teal, black-and-yellow, weathered brick and monsoon-green palette, crisp pixel tile detail, no photorealism. Reserve the bottom 22 percent as quieter dark road and pavement with no important objects, suitable for a dialogue HUD. EMPTY STAGE PLATE: draw no people anywhere in the playable mid-ground, because character sprites are composited on top later. No student, no driver, no passenger, no vendor. No glowing rings, highlight circles, or interaction markers. No readable letters or numbers anywhere.",
    reactionPrompt:
      "Create a celebratory but still playable 16-bit pixel-art RPG completion scene in the same coherent Bandra Station East auto-stand map, top-down 3/4 view, with no readable text, signs, logos, UI, speech bubbles, or watermark. Keep the generic station side facade and elevated footbridge in the upper centre, the black-and-yellow auto at the right-middle curb, the tea stall, queued autos, rain-polished road, office silhouettes, palms, and puddles so it unmistakably matches the earlier mission map. Raju stands beside the open auto with one welcoming hand indicating the passenger seat; Ananya gives an appreciative nod and begins to step in with her small suitcase. Add a discreet non-textual golden glow or a few warm pixel sparkles around their shared path to signal a clear, respectful pickup; never a badge, trophy, number, letter, or label. Preserve the saturated saffron, teal, black-and-yellow, weathered brick, and monsoon-green palette, crisp tile detail, coherent character scale, reflected post-rain light, and deliberately open darker road along the bottom 22 percent for a dialogue HUD. Game asset quality, not poster art; no photorealism.",
    steps: [
      {
        objective: "Welcome Ananya and ask where she would like to go.",
        npcPromptMr: "नमस्कार, तुम्ही रिक्शाने जाणार आहात का?",
        npcPromptEn: "Hello, will you be taking an auto-rickshaw?",
        targetPhraseMr: "नमस्कार, तुम्हाला कुठे जायचे आहे?",
        targetPhraseLatin: "Namaskar, tumhala kuthe jayache aahe?",
        targetPhraseEn: "Hello, where would you like to go?",
        successCriteria:
          "As the driver, the learner greets the passenger and asks where she wants to go. Both a greeting and a 'where to?' question are ideal, but asking where she wants to go is the part that must land.",
        skill: "greeting",
      },
      {
        objective: "Ask for the precise BKC drop-off point rather than assuming one.",
        npcPromptMr: "मला बीकेसीला जायचे आहे.",
        npcPromptEn: "I would like to go to BKC.",
        targetPhraseMr: "बीकेसीमध्ये नेमके कुठे उतरायचे आहे?",
        targetPhraseLatin: "BKC-madhye nemke kuthe utarayache aahe?",
        targetPhraseEn: "Where exactly would you like to get down in BKC?",
        successCriteria:
          "As the driver, the learner asks WHERE EXACTLY in BKC to drop her, rather than assuming. Any request for a specific/exact drop-off point or landmark within BKC passes.",
        skill: "clarification",
      },
      {
        objective: "Confirm the requested stop and invite Ananya to sit comfortably.",
        npcPromptMr: "मुख्य बस थांब्याजवळ, कृपया.",
        npcPromptEn: "Near the main bus stop, please.",
        targetPhraseMr: "ठीक आहे, मुख्य बस थांब्याजवळ सोडतो. आरामात बसा.",
        targetPhraseLatin:
          "Thik aahe, mukhya bus thambyajaval sodto. Aramat basa.",
        targetPhraseEn:
          "Okay, I will drop you near the main bus stop. Please sit comfortably.",
        successCriteria:
          "As the driver, the learner confirms the main bus stop drop-off, and/or invites her to sit comfortably. Either half alone passes.",
        skill: "confirmation",
      },
    ],
  },
];

/**
 * Source of truth for the three persistent map assets. A generation script can
 * write each completed Nano Banana image to the matching relative file name.
 */
export const BOLI_ASSET_MANIFEST = BOLI_MISSIONS.map((mission) => ({
  id: mission.id,
  fileName: `maps/${mission.id}.jpg`,
  prompt: mission.mapPrompt,
  style: BOLI_MAP_ASSET_STYLE,
}));
