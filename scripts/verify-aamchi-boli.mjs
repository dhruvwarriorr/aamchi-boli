/**
 * Live acceptance checks for Aamchi Boli's language loop.
 *
 * Run the production server first, then use:
 *   npm run test:aamchi
 *   AAMCHI_VARIANT=transliteration npm run test:aamchi
 *   AAMCHI_VARIANT=devanagari npm run test:aamchi
 *
 * These tests intentionally call the configured Gemini API. They verify the
 * shipped scoring guardrails and coaching response, not a local mock.
 */

const baseUrl = (process.env.AAMCHI_BOLI_URL || "http://localhost:3000").replace(/\/$/, "");
const variant = process.env.AAMCHI_VARIANT || "all";

const variants = {
  transliteration: [
    ["kj-college-gate", 0, "mala KJ Somaiya college la jayache aahe"],
    ["kj-college-gate", 1, "ho, main gate var utarayache aahe"],
    ["kj-college-gate", 2, "dhanyavad tai"],
    ["dadar-bus-stop", 0, "Shivaji Park bus kuthe milel?"],
    ["dadar-bus-stop", 1, "pulakhalachya bus stop var jayache, barobar?"],
    ["dadar-bus-stop", 2, "dhanyavad, mi ata tikade jato"],
    ["bandra-station-pickup", 0, "mala BKC la jayache aahe"],
    ["bandra-station-pickup", 1, "mukhya bus thambyajaval utarayache aahe"],
    ["bandra-station-pickup", 2, "dhanyavad Raju"],
  ],
  devanagari: [
    ["kj-college-gate", 0, "मला के. जे. सोमय्या कॉलेजला जायचे आहे."],
    ["kj-college-gate", 1, "हो, मुख्य गेटवर उतरायचे आहे."],
    ["kj-college-gate", 2, "धन्यवाद ताई."],
    ["dadar-bus-stop", 0, "मला शिवाजी पार्कला जाणारी बस कुठे मिळेल?"],
    ["dadar-bus-stop", 1, "पुलाखालच्या बस थांब्यावर जायचे, बरोबर?"],
    ["dadar-bus-stop", 2, "खूप धन्यवाद, मी आता तिकडे जातो."],
    ["bandra-station-pickup", 0, "मला बीकेसीला जायचे आहे."],
    ["bandra-station-pickup", 1, "मुख्य बस थांब्याजवळ उतरायचे आहे."],
    ["bandra-station-pickup", 2, "धन्यवाद राजू."],
  ],
};

function assert(condition, label, details = "") {
  if (!condition) throw new Error(`${label}${details ? `: ${details}` : ""}`);
  console.log(`✓ ${label}`);
}

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function checkPositiveCases(name, cases) {
  for (const [missionId, stepIndex, typedResponse] of cases) {
    const result = await post("/api/aamchi-boli/turn", {
      missionId,
      stepIndex,
      typedResponse,
      attemptsForStep: 0,
    });
    assert(
      result.status === 200 && result.body.outcome === "success" && result.body.nextStep === stepIndex + 1 && result.body.completed === (stepIndex === 2),
      `${name}: ${missionId} step ${stepIndex + 1} advances exactly once`,
      JSON.stringify({ status: result.status, outcome: result.body.outcome, nextStep: result.body.nextStep })
    );
  }
}

async function checkNonMarathiCannotAdvance() {
  const nonMarathiCases = [
    ["open-world", 0, "hello"],
    ["open-world", 0, "namaste"],
    ["open-world", 1, "I can see a beautiful place here"],
    ["open-world", 1, "mujhe yahan ek sundar jagah dikhti hai"],
    ["open-world", 2, "Please help me learn Marathi"],
    ["open-world", 2, "mujhe Marathi seekhne mein madad karo"],
  ];
  for (const [missionId, stepIndex, typedResponse] of nonMarathiCases) {
    const result = await post("/api/aamchi-boli/turn", { missionId, stepIndex, typedResponse, attemptsForStep: 0 });
    assert(
      result.status === 200 && result.body.outcome !== "success" && result.body.nextStep === stepIndex && result.body.feedbackFocus?.code === "mixed_language",
      `language guard: ${JSON.stringify(typedResponse)} is asked again in Marathi`,
      JSON.stringify({ outcome: result.body.outcome, nextStep: result.body.nextStep, focus: result.body.feedbackFocus })
    );
  }
}

async function checkGuardrailsAndCoaching() {
  const vagueCases = [
    ["kj-college-gate", 0, "yes"], ["kj-college-gate", 1, "yes"], ["kj-college-gate", 2, "okay"],
    ["dadar-bus-stop", 0, "hello"], ["dadar-bus-stop", 1, "yes"], ["dadar-bus-stop", 2, "okay"],
    ["bandra-station-pickup", 0, "yes"], ["bandra-station-pickup", 1, "yes"], ["bandra-station-pickup", 2, "okay"],
  ];
  for (const [missionId, stepIndex, typedResponse] of vagueCases) {
    const result = await post("/api/aamchi-boli/turn", { missionId, stepIndex, typedResponse, attemptsForStep: 0 });
    assert(
      result.status === 200 && result.body.outcome !== "success" && result.body.nextStep === stepIndex && result.body.reviewItem?.completed === false,
      `guardrail: vague ${missionId} step ${stepIndex + 1} cannot advance`,
      JSON.stringify({ status: result.status, outcome: result.body.outcome, nextStep: result.body.nextStep })
    );
  }

  const firstMiss = await post("/api/aamchi-boli/turn", {
    missionId: "bandra-station-pickup", stepIndex: 0, typedResponse: "yes", attemptsForStep: 0,
  });
  assert(firstMiss.body.adaptiveFeedback?.level === 1 && firstMiss.body.reviewItem, "adaptive coach: first miss gives a light correction");

  const secondMiss = await post("/api/aamchi-boli/turn", {
    missionId: "bandra-station-pickup", stepIndex: 0, typedResponse: "I do not know", attemptsForStep: 1,
  });
  assert(
    secondMiss.body.adaptiveFeedback?.level === 2 && secondMiss.body.supportRecommendation === "slow_repeat",
    "adaptive coach: repeat miss unlocks slow guided rebuild",
    JSON.stringify({ level: secondMiss.body.adaptiveFeedback?.level, support: secondMiss.body.supportRecommendation })
  );

  const review = await post("/api/aamchi-boli/turn", {
    missionId: "bandra-station-pickup", stepIndex: 0, mode: "review", reviewItemId: "bandra-station-pickup:step:0",
    typedResponse: "BKC please", attemptsForStep: 1,
  });
  assert(
    review.status === 200 && review.body.outcome === "success" && review.body.nextStep === 0 && review.body.reviewItem?.completed === true,
    "memory checkpoint: successful recall does not advance the main quest",
    JSON.stringify({ status: review.status, outcome: review.body.outcome, nextStep: review.body.nextStep })
  );

  const unknown = await post("/api/aamchi-boli/turn", { missionId: "not-a-route", stepIndex: 0, typedResponse: "hello" });
  assert(unknown.status === 404, "validation: unknown mission is rejected", `HTTP ${unknown.status}`);
  const empty = await post("/api/aamchi-boli/turn", { missionId: "kj-college-gate", stepIndex: 0, typedResponse: "" });
  assert(empty.status === 400, "validation: empty response is rejected", `HTTP ${empty.status}`);
}

async function checkOpenWorldCompletion() {
  const turns = [
    [0, "namaskar"],
    [1, "mala ithe ek sundar jaga disate"],
    [2, "mala Marathi shikayachi aahe, madat kara"],
  ];
  for (const [stepIndex, typedResponse] of turns) {
    const result = await post("/api/aamchi-boli/turn", {
      missionId: "open-world",
      stepIndex,
      typedResponse,
      attemptsForStep: 0,
    });
    assert(
      result.status === 200 && result.body.outcome === "success" && result.body.nextStep === stepIndex + 1 && result.body.completed === (stepIndex === 2),
      `custom world: task ${stepIndex + 1} advances and reports completion correctly`,
      JSON.stringify({ status: result.status, outcome: result.body.outcome, nextStep: result.body.nextStep, completed: result.body.completed })
    );
  }

  const vague = await post("/api/aamchi-boli/turn", {
    missionId: "open-world",
    stepIndex: 0,
    typedResponse: "yes",
    attemptsForStep: 0,
  });
  assert(vague.status === 200 && vague.body.outcome !== "success" && vague.body.nextStep === 0, "custom world: vague greeting cannot advance");
}

async function main() {
  assert(Object.hasOwn(variants, variant) || variant === "all", "test variant is valid", variant);
  const selected = variant === "all" ? Object.entries(variants) : [[variant, variants[variant]]];
  for (const [name, cases] of selected) await checkPositiveCases(name, cases);
  await checkOpenWorldCompletion();
  await checkNonMarathiCannotAdvance();
  await checkGuardrailsAndCoaching();
  console.log("\nAamchi Boli language acceptance checks passed.");
}

main().catch((error) => {
  console.error(`\nAamchi Boli language acceptance checks failed: ${error.message}`);
  process.exitCode = 1;
});
