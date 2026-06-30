// ─────────────────────────────────────────────────────────────
// search.js  —  FlatBot search engine
//
// Exported functions:
//   classifyMessage(text)         → "search" | "question" | "off_topic"
//   keywordSearch(query, listings) → { results, near_budget_results }
//   aiSearch(query, listings)      → { type, results, near_budget_results }
//   aiAnswer(question)             → { type, answer }
// ─────────────────────────────────────────────────────────────

// ── 1. AREA LIST ─────────────────────────────────────────────
const STUDENT_AREAS = [
  // North Campus / DU North belt
  "kamla nagar", "shakti nagar", "shastri nagar", "vijay nagar",
  "hudson lane", "gtb nagar", "mukherjee nagar", "burari",
  "outram lines", "kingsway camp", "north campus", "mall road",
  "timarpur", "model town", "sant nagar", "jawahar nagar",

  // South Campus / DU South belt
  "satya niketan", "moti bagh", "safdarjung", "munirka",
  "ber sarai", "katwaria sarai", "hauz khas", "malviya nagar",
  "lajpat nagar", "green park", "south campus", "south ex",
  "greater kailash", "panchsheel",

  // East Delhi
  "laxmi nagar", "preet vihar", "nirman vihar", "shakarpur",
  "mayur vihar", "patparganj", "dilshad garden", "vivek vihar",

  // West / Dwarka / Rohini
  "rohini", "pitampura", "janakpuri", "uttam nagar", "dwarka",
  "paschim vihar", "punjabi bagh", "rajouri garden",

  // Noida
  "noida sector 62", "noida sector 18", "noida sector 15",
  "noida sector 63", "noida", "greater noida",

  // Ghaziabad / NCR
  "vaishali", "indirapuram", "raj nagar", "kaushambi",

  // Shorthands
  "north du", "south du", "du north", "du south", "du"
];

// ── 2. HOUSING KEYWORDS ───────────────────────────────────────
const HOUSING_WORDS = [
  "flat", "pg", "room", "rent", "bhk", "1bhk", "2bhk", "3bhk",
  "paying guest", "hostel", "accommodation", "flatmate", "roommate",
  "sharing", "single", "double", "triple", "furnished", "unfurnished",
  "semi furnished", "deposit", "advance", "boys", "girls", "male",
  "female", "gents", "ladies", "bachelor", "attached", "bathroom",
  "kitchen", "balcony", "wifi", "ac", "geyser", "parking",
  "budget", "monthly", "per month", "k/month", "k month",
  ...STUDENT_AREAS
];

// ── 3. QUESTION STARTERS ──────────────────────────────────────
const QUESTION_STARTERS = [
  "which", "what", "how", "is ", "are ", "where", "should",
  "tell me", "explain", "suggest", "recommend", "best area",
  "safe area", "good area", "difference between", "compare",
  "can you", "do you know", "any idea", "kaunsa", "kaisa",
  "kahan", "kitna", "kya hai", "bata", "batao"
];

// ── 4. CLASSIFY MESSAGE ───────────────────────────────────────
// Pure logic — no API call.
// Returns: "search" | "question" | "off_topic"
function classifyMessage(text) {
  const lower = text.trim().toLowerCase();

  const hasHousingWord = HOUSING_WORDS.some(w => lower.includes(w));
  if (!hasHousingWord) return "off_topic";

  const isQuestion =
    lower.endsWith("?") ||
    QUESTION_STARTERS.some(q => lower.startsWith(q) || lower.includes(" " + q));

  return isQuestion ? "question" : "search";
}

// ── 5. BUDGET PARSER ──────────────────────────────────────────
// Extracts a numeric budget from text. Returns null if not found.
//
// Fix: strip known BHK tokens (1bhk, 2bhk, 3bhk) before running
// the regex so "1bhk" is never mis-parsed as a budget of ₹1,000.
function parseBudget(text) {
  // Remove BHK mentions so "1bhk" doesn't match the (\d+)\s*k pattern
  const cleaned = text.toLowerCase().replace(/\d+\s*bhk/g, "");

  const patterns = [
    /(\d+)\s*k/,                                          // 10k → 10,000
    /(\d[\d,]+)\s*(?:\/month|pm|per month)?/              // 10000 or 10,000
  ];

  for (const pat of patterns) {
    const match = cleaned.match(pat);
    if (match) {
      let num = parseInt(match[1].replace(/,/g, ""));
      if (cleaned.includes("k") && num < 1000) num *= 1000;
      if (num > 500 && num < 200000) return num;
    }
  }
  return null;
}

// ── 6. KEYWORD SEARCH ─────────────────────────────────────────
// No API call. Scores listings against extracted area/type/gender/budget.
// Returns { results: [], near_budget_results: [] }
function keywordSearch(query, listings) {
  const lower = query.toLowerCase();

  const mentionedAreas  = STUDENT_AREAS.filter(a => lower.includes(a));
  const types           = ["1bhk", "2bhk", "3bhk", "pg", "paying guest", "room", "flat", "studio", "hostel"];
  const mentionedTypes  = types.filter(t => lower.includes(t));
  const isMale          = /\b(male|boys|gents|men|boy)\b/.test(lower);
  const isFemale        = /\b(female|girls|ladies|women|girl)\b/.test(lower);
  const budget          = parseBudget(lower);

  console.log(
    `🔑 Keyword search — areas: [${mentionedAreas}], types: [${mentionedTypes}],` +
    ` gender: ${isMale ? "male" : isFemale ? "female" : "any"}, budget: ${budget}`
  );

  const scored = listings.map(listing => {
    const ltext = listing.message_text.toLowerCase();
    let score = 0;

    if (mentionedAreas.some(a => ltext.includes(a)))                   score += 10;
    if (mentionedTypes.some(t => ltext.includes(t)))                   score += 5;
    if (isMale   && /\b(male|boys|gents|bachelor)\b/.test(ltext))      score += 4;
    if (isFemale && /\b(female|girls|ladies)\b/.test(ltext))           score += 4;

    const listingBudget = parseBudget(ltext);
    if (budget && listingBudget) {
      const diff = Math.abs(listingBudget - budget) / budget;
      if (diff <= 0.10)      score += 8; // within 10% → strong match
      else if (diff <= 0.25) score += 3; // within 25% → near budget
    }

    return { listing, score };
  }).filter(s => s.score > 0);

  scored.sort((a, b) => b.score - a.score);

  const exact = scored.filter(s => s.score >= 8).slice(0, 3).map(s => s.listing);
  const exactIds = new Set(exact.map(l => l.id));
  const nearBudget = scored
    .filter(s => s.score > 0 && s.score < 8 && !exactIds.has(s.listing.id))
    .slice(0, 2)
    .map(s => s.listing);

  console.log(`🔑 Exact: ${exact.length}, Near-budget: ${nearBudget.length}`);
  return { results: exact, near_budget_results: nearBudget };
}

// ── 7. AI SEARCH FALLBACK (Gemini) ───────────────────────────
// Only called when keyword search returns zero results.
async function aiSearch(query, listings) {
  try {
    console.log(`🤖 AI Search fallback — query: "${query}", listings: ${listings.length}`);

    const listingsText = listings
      .map(l => `ID: ${l.id}\nListing: ${l.message_text}`)
      .join("\n\n");

    const prompt =
      `You are FlatBot, a flat-search assistant for a Delhi/NCR student housing community.\n\n` +
      `User requirement: "${query}"\n\n` +
      `Available listings:\n\n${listingsText}\n\n` +
      `Find the best matches. Return two lists:\n` +
      `A) ids — up to 3 listings that closely match area, type, budget, gender.\n` +
      `B) near_budget_ids — up to 2 listings within 20-25% of stated budget that match other criteria. Never repeat an ID from list A.\n\n` +
      `Indian context:\n` +
      `- "10k" = ₹10,000. "under 10k" = max ₹10,000. "8-12k" = ₹8,000–12,000.\n` +
      `- "north campus" = DU north (Kamla Nagar, Vijay Nagar, Hudson Lane belt)\n` +
      `- "south campus" = DU south (Munirka, Satya Niketan, Ber Sarai belt)\n` +
      `- boys/male/gents and girls/female/ladies are gender preference signals\n\n` +
      `Return ONLY valid JSON, no explanation, no markdown:\n` +
      `{ "type": "results", "ids": ["NC-0001"], "near_budget_ids": ["NC-0003"] }\n` +
      `If nothing matches: { "type": "results", "ids": [], "near_budget_ids": [] }`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );

    const data = await response.json();

    if (
      response.status === 429 ||
      data?.error?.code === 429 ||
      data?.error?.status === "RESOURCE_EXHAUSTED"
    ) {
      return { type: "quota_exceeded" };
    }

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!rawText) return { type: "results", results: [], near_budget_results: [] };

    const parsed         = JSON.parse(rawText.replace(/```json|```/g, "").trim());
    const ids            = parsed.ids || [];
    const nearIds        = parsed.near_budget_ids || [];
    const results        = listings.filter(l => ids.includes(l.id));
    const near_budget_results = listings.filter(l => nearIds.includes(l.id));

    console.log(`🤖 AI results: ${results.length}, near-budget: ${near_budget_results.length}`);
    return { type: "results", results, near_budget_results };

  } catch (err) {
    console.error("AI Search error:", err.message);
    const isQuota =
      err.message.includes("429") ||
      err.message.includes("quota") ||
      err.message.includes("RESOURCE_EXHAUSTED");
    return isQuota
      ? { type: "quota_exceeded" }
      : { type: "results", results: [], near_budget_results: [] };
  }
}

// ── 8. AI ANSWER (Gemini — housing questions) ─────────────────
// Only called for "question" classified messages.
async function aiAnswer(question) {
  try {
    console.log(`🤖 AI Answer — question: "${question}"`);

    const prompt =
      `You are FlatBot, a helpful assistant for students finding accommodation in Delhi/NCR, India.\n\n` +
      `A student has asked a housing-related question:\n"${question}"\n\n` +
      `Answer helpfully and concisely. Keep it under 150 words. Use simple language.\n` +
      `You can mention specific areas, typical rent ranges, safety tips, etc.\n` +
      `Do NOT mention that you're an AI. Just answer like a helpful senior student would.\n` +
      `End with one encouraging line.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );

    const data = await response.json();

    if (
      response.status === 429 ||
      data?.error?.code === 429 ||
      data?.error?.status === "RESOURCE_EXHAUSTED"
    ) {
      return { type: "quota_exceeded" };
    }

    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!answer) return { type: "error" };

    return { type: "answer", answer };

  } catch (err) {
    console.error("AI Answer error:", err.message);
    return { type: "error" };
  }
}

module.exports = { classifyMessage, keywordSearch, aiSearch, aiAnswer };