// ─────────────────────────────────────────────────────────────
// webhook.js  —  FlatBot brain
// All incoming message routing and state machine lives here.
// ─────────────────────────────────────────────────────────────

const { saveListing, getListing, deleteListing, searchListings, searchOwnerListingsByQuery } = require("../database/db");
const { classifyMessage, keywordSearch, aiSearch, aiAnswer } = require("../services/search");

const userState = {};
let _send;

// ── TEAM NUMBER ───────────────────────────────────────────────
const TEAM_NUMBER = "919870600903@c.us";

// ── RATE LIMITING ─────────────────────────────────────────────
const rateLimitMap = {};
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function isRateLimited(sender) {
  const now = Date.now();
  if (!rateLimitMap[sender]) rateLimitMap[sender] = [];
  rateLimitMap[sender] = rateLimitMap[sender].filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (rateLimitMap[sender].length >= RATE_LIMIT_MAX) return true;
  rateLimitMap[sender].push(now);
  return false;
}

// ── STATE MACHINE ─────────────────────────────────────────────
const STATE_TIMEOUT_MS = 2 * 60 * 60 * 1000;

function getState(sender) {
  const s = userState[sender];
  if (!s) return null;
  if (Date.now() - s.createdAt > STATE_TIMEOUT_MS) { userState[sender] = null; return null; }
  return s;
}

function setState(sender, stateObj) {
  userState[sender] = { ...stateObj, createdAt: Date.now() };
}

function clearState(sender) {
  userState[sender] = null;
}

// ── INIT ──────────────────────────────────────────────────────
function init(sendFn) { _send = sendFn; }

// ── HELPERS ───────────────────────────────────────────────────
async function postToAnnouncements(listing) {
  const msg =
    `🏠 *New Listing — ${listing.id}*\n\n` +
    `${listing.message_text}\n\n` +
    `📩 Interested? Message the bot with ID: *${listing.id}*`;
  await _send("", msg, process.env.ANNOUNCEMENT_GROUP_ID);
}

// ── TEAM NOTIFICATION ─────────────────────────────────────────
async function notifyTeam(senderPhone, requirement, resultCount) {
  let msg;

  if (resultCount > 0) {
    msg =
      `🏠 *New Flat Enquiry*\n\n` +
      `*Requirement:* "${requirement}"\n` +
      `*Contact:* +${senderPhone}\n` +
      `*Showed them:* ${resultCount} listing(s)\n\n` +
      `Please reach out and arrange a visit! 🙂`;
  } else {
    msg =
      `🚨 *Flat Requirement — No Match Found*\n\n` +
      `*Requirement:* "${requirement}"\n` +
      `*Contact:* +${senderPhone}\n` +
      `*Listings shown:* None — needs manual help\n\n` +
      `Please reach out and arrange a visit! 🙏`;
  }

  try {
    await _send("", msg, TEAM_NUMBER);
    console.log(`📣 Team notified — ${resultCount} result(s) — from ${senderPhone}`);
  } catch (err) {
    console.error("Failed to notify team:", err.message);
  }
}

function isFlatListing(text) {
  const keywords = [
    "flat", "room", "bhk", "rent", "pg", "paying guest",
    "flatmate", "roommate", "accommodation", "1bhk", "2bhk",
    "3bhk", "available", "vacancy", "deposit", "furnish",
    "bachelor", "family", "girls", "boys", "tenant", "house",
    "apartment", "studio", "sharing", "single", "double"
  ];
  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

function isLookingForFlat(text) {
  const seekingPhrases = [
    "looking for", "need a", "need flat", "need pg", "need room",
    "searching for", "search for", "want a flat", "want a pg", "want a room",
    "anyone have", "koi hai", "koi flat", "koi pg", "koi room",
    "please help", "help me find", "chahiye", "dhundh raha", "dhundh rahi",
    "find flat", "find pg", "find room", "available flat", "available pg",
    "available room", "i am looking", "i'm looking", "mujhe chahiye"
  ];
  const lower = text.toLowerCase();
  return seekingPhrases.some(k => lower.includes(k));
}

function isSimpleGreeting(text) {
  const greetings = [
    "hi", "hello", "hey", "hii", "helo", "hye", "yo", "sup",
    "wassup", "howdy", "heyy", "heyyy", "hiii", "namaste", "namaskar"
  ];
  return greetings.includes(text.trim().toLowerCase());
}

// ── REQUIREMENTS PROMPT ───────────────────────────────────────
const REQUIREMENTS_PROMPT =
  "Hey! 👋 Tell me what you're looking for:\n\n" +
  "• 💰 *Budget* (e.g. 8k/month, 12000)\n" +
  "• 🏠 *Type* (flat / PG / room / 1BHK / 2BHK)\n" +
  "• 📍 *Area preference* (e.g. Kamla Nagar, Vijay Nagar, Munirka)\n" +
  "• 👤 *Your Gender* (male / female)\n" +
  "• ✨ *Anything else?* (furnished, attached bathroom, WiFi, etc.)\n\n" +
  "👤 *or simple ask in Human language* eg: searching for pg in vijay nagar\n" +
  "Just reply with all this and I'll find the best options! 🔍";

// ── CORE SEARCH FUNCTION ──────────────────────────────────────
async function doSearch(sender, text, chatId) {
  await _send(sender, "🔍 searching for you... just a sec! ✨", chatId);

  // Run both in parallel — owner search never blocks main flow
  const [allActive, ownerMatch] = await Promise.all([
    searchListings(""),
    searchOwnerListingsByQuery(text)
  ]);

  if (allActive.length === 0) {
    // No listings in DB at all — check owner_listings
    if (ownerMatch.count > 0) {
      await _send(sender,
        `✅ We have *${ownerMatch.count}* verified listing(s) in *${ownerMatch.areas.join(", ")}* with our team.\n\n` +
        `One of our team members will contact you shortly to help personally! 🙏`,
        chatId
      );
      await notifyTeam(sender, text, ownerMatch.count);
    } else {
      await _send(sender,
        "We don't have an exact match right now, but don't worry — " +
        "one of our team members will contact you shortly to help personally! 🙏",
        chatId
      );
      await notifyTeam(sender, text, 0);
    }
    return;
  }

  // ── STEP 1: Keyword search ────────────────────────────────────
  const { results, near_budget_results } = keywordSearch(text, allActive);

  if (results.length > 0 || near_budget_results.length > 0) {
    await sendSearchResults(sender, results, near_budget_results, text, chatId, ownerMatch);
    return;
  }

  // ── STEP 2: Gemini fallback ───────────────────────────────────
  console.log("🔄 Keyword search returned 0 — trying Gemini fallback");
  const aiResult = await aiSearch(text, allActive);

  if (aiResult.type === "quota_exceeded") {
    if (ownerMatch.count > 0) {
      await _send(sender,
        `✅ We have *${ownerMatch.count}* verified listing(s) in *${ownerMatch.areas.join(", ")}* with our team.\n\n` +
        `One of our team members will contact you shortly to help personally! 🙏`,
        chatId
      );
      await notifyTeam(sender, text, ownerMatch.count);
    } else {
      await _send(sender,
        "We don't have an exact match right now, but don't worry — " +
        "one of our team members will contact you shortly to help personally! 🙏",
        chatId
      );
      await notifyTeam(sender, text, 0);
    }
    return;
  }

  const aiResults = aiResult.results || [];
  const aiNearBudget = aiResult.near_budget_results || [];

  if (aiResults.length > 0 || aiNearBudget.length > 0) {
    await sendSearchResults(sender, aiResults, aiNearBudget, text, chatId, ownerMatch);
    return;
  }

  // ── STEP 3: Nothing in listings — check owner_listings ────────
  if (ownerMatch.count > 0) {
    await _send(sender,
      `✅ We have *${ownerMatch.count}* verified listing(s) in *${ownerMatch.areas.join(", ")}* with our team.\n\n` +
      `One of our team members will contact you shortly to help personally! 🙏`,
      chatId
    );
    await notifyTeam(sender, text, ownerMatch.count);
    return;
  }

  await _send(sender,
    "We don't have an exact match right now, but don't worry — " +
    "one of our team members will contact you shortly to help personally! 🙏",
    chatId
  );
  await notifyTeam(sender, text, 0);
}

// ── SEND RESULTS TO USER + NOTIFY TEAM ───────────────────────
async function sendSearchResults(sender, results, nearBudgetResults, originalQuery, chatId, ownerMatch) {
  const totalShown = results.length + nearBudgetResults.length;
  let response = "";

  if (results.length > 0) {
    response += `🏠 *Found ${results.length} match(es) for you:*\n\n`;
    results.forEach((listing, i) => {
      response += `${i + 1}️⃣ *${listing.id}*\n${listing.message_text}\n\n`;
    });
  }

  if (nearBudgetResults.length > 0) {
    response += `💡 *Similar options (slightly outside your budget):*\n\n`;
    nearBudgetResults.forEach((listing, i) => {
      response += `${i + 1}️⃣ *${listing.id}*\n${listing.message_text}\n\n`;
    });
  }

  response +=
    `💬 *Interested in a listing?* Send its ID (e.g. *NC-0001*) and we'll connect you with the owner privately.\n\n` +
    `📞 One of our team members will contact you shortly to arrange a visit! 🙂`;

  // If owner_listings also has matches — append one line, no phone, no ID
  if (ownerMatch && ownerMatch.count > 0) {
    response += `\n\n🔖 We also have *${ownerMatch.count}* verified listing(s) in *${ownerMatch.areas.join(", ")}* with our team!`;
  }

  await _send(sender, response, chatId);
  await notifyTeam(sender, originalQuery, totalShown);
}

// ── MAIN MESSAGE HANDLER (DMs) ────────────────────────────────
async function handleMessage(sender, text, chatId) {
  try {
    if (isRateLimited(sender)) {
      await _send(sender, "⚠️ slow down a bit 😅 try again in a minute!", chatId);
      return;
    }

    const msg = text.trim().toLowerCase();
    const state = getState(sender);

    // ── [HIDDEN] CASE 1: post command ─────────────────────────
    if (msg === "post") {
      setState(sender, { state: "awaiting_listing" });
      await _send(sender,
        "📝 Send your listing details:\n\n" +
        "• Type (flat/PG/room/BHK)\n" +
        "• Location/Area\n" +
        "• Rent/month\n" +
        "• Preferences (boys/girls, furnished, etc.)\n\n" +
        "Send it all in one message!",
        chatId
      );
      return;
    }

    // ── [HIDDEN] CASE 2: receiving listing text ────────────────
    if (state?.state === "awaiting_listing") {
      clearState(sender);
      const result = await saveListing(sender, text, "direct");
      if (!result.success) {
        await _send(sender, "⚠️ Something went wrong saving your listing. Please try again!", chatId);
        return;
      }
      await postToAnnouncements({ id: result.id, message_text: text });
      await _send(sender,
        `✅ Listing is LIVE! 🎉\n\n` +
        `Your ID: *${result.id}* — save this!\n\n` +
        `📢 Posted in Announcements. People will reach you through the bot.\n` +
        `🔒 Your number stays hidden until you approve.`,
        chatId
      );
      return;
    }

    // ── [HIDDEN] CASE 3: delete command ───────────────────────
    if (text.trim().toUpperCase().match(/^DELETE [A-Z]+-\d{4}$/)) {
      const listingId = text.trim().toUpperCase().split(" ")[1];
      const listing = await getListing(listingId);
      if (!listing) { await _send(sender, "❌ Listing not found. Double check the ID!", chatId); return; }
      if (listing.owner_phone !== sender) { await _send(sender, "⚠️ You can only delete your own listings.", chatId); return; }
      if (listing.status === "inactive") { await _send(sender, "⚠️ This listing is already deleted.", chatId); return; }
      const success = await deleteListing(listingId, sender);
      await _send(sender, success
        ? `✅ *${listingId}* deleted successfully.`
        : "⚠️ Something went wrong. Please try again.",
        chatId
      );
      return;
    }

    // ── [HIDDEN] CASE 4: explicit search command ───────────────
    if (msg.startsWith("search ")) {
      const query = text.trim().slice(7).trim();
      if (!query) {
        await _send(sender, "Please add what you're searching for after 'search'.\nExample: *search 2bhk kamla nagar under 10k*", chatId);
        return;
      }
      await doSearch(sender, query, chatId);
      return;
    }

    // ── [HIDDEN] CASE 5: listing ID inquiry ───────────────────
    if (text.trim().toUpperCase().match(/^[A-Z]+-\d{4}$/)) {
      const listingId = text.trim().toUpperCase();
      const listing = await getListing(listingId);
      if (!listing) { await _send(sender, "😔 Listing not found. Check the ID and try again!", chatId); return; }
      if (listing.status === "inactive") { await _send(sender, "❌ This listing has already been taken or removed.", chatId); return; }
      if (listing.owner_phone === sender) { await _send(sender, "😄 That's your own listing!", chatId); return; }

      try {
        await _send(listing.owner_phone,
          `👀 Someone is interested in your listing *${listingId}*!\n\n` +
          `"${listing.message_text}"\n\n` +
          `Do you want to share your number with them?\nReply *YES* or *NO*`,
          listing.owner_phone + "@c.us"
        );
        setState(listing.owner_phone, { state: "awaiting_approval", requester: sender, requesterChatId: chatId, listingId });
        await _send(sender, "⏳ Request sent to the owner! We'll let you know once they respond 🤞", chatId);
      } catch (err) {
        await _send(sender, "⚠️ Couldn't reach the owner right now. Try again later!", chatId);
      }
      return;
    }

    // ── [HIDDEN] CASE 6: owner YES/NO ─────────────────────────
    if (state?.state === "awaiting_approval") {
      const { requester, requesterChatId, listingId } = state;
      const listing = await getListing(listingId);
      clearState(sender);

      if (msg === "yes") {
        await _send(requester,
          `✅ Great news! The owner approved.\n\nListing: "${listing.message_text}"\n\nOwner's number: +${sender}`,
          requesterChatId
        );
        await _send(sender, "✅ Number shared! Thanks for being helpful 🤝", chatId);
      } else if (msg === "no") {
        await _send(requester,
          `❌ The owner of *${listingId}* preferred not to share their number. Keep looking! 💪`,
          requesterChatId
        );
        await _send(sender, "✅ Got it. Number not shared 🔒", chatId);
      } else {
        setState(sender, { state: "awaiting_approval", requester, requesterChatId, listingId });
        await _send(sender, "Please reply with *YES* or *NO* 😊", chatId);
      }
      return;
    }

    // ── CASE 7: Greeting → requirements prompt ─────────────────
    if (isSimpleGreeting(text)) {
      setState(sender, { state: "awaiting_requirements" });
      await _send(sender, REQUIREMENTS_PROMPT, chatId);
      return;
    }

    // ── CASE 8: User replied to requirements prompt ────────────
    if (state?.state === "awaiting_requirements") {
      clearState(sender);
      await doSearch(sender, text, chatId);
      return;
    }

    // ── CASE 9: classify and route ────────────────────────────
    const classification = classifyMessage(text);

    if (classification === "off_topic") {
      await _send(sender,
        "Hey! I'm only here to help with flat and PG hunting in Delhi/NCR 🏠\n\n" +
        "Send *hi* to get started!",
        chatId
      );
      return;
    }

    if (classification === "question") {
      await _send(sender, "Let me look that up for you... 🤔", chatId);
      const result = await aiAnswer(text);

      if (result.type === "answer") {
        await _send(sender, result.answer, chatId);
      } else {
        await _send(sender,
          "One of our team members will contact you shortly and help you with that! 🙏",
          chatId
        );
        await notifyTeam(sender, text, 0);
      }
      return;
    }

    // classification === "search"
    await doSearch(sender, text, chatId);

  } catch (err) {
    console.error("Message handling error:", err.message);
    try {
      await _send(sender,
        "Something went wrong on our end 😅 Please try again!\n" +
        "If it keeps happening, our team will help you out.",
        chatId
      );
    } catch (e) {}
  }
}

// ── GROUP MESSAGE HANDLER ─────────────────────────────────────
async function handleGroupMessage(sender, text, chatId) {
  try {
    const state = getState(sender);

    if (state?.state === "awaiting_group_confirm") {
      const msg = text.trim().toLowerCase();
      if (msg === "yes") {
        const originalText = state.originalText;
        clearState(sender);
        const result = await saveListing(sender, originalText, "group");
        if (!result.success) {
          await _send(sender, "⚠️ Something went wrong. Please try again.", chatId);
          return;
        }
        await postToAnnouncements({ id: result.id, message_text: originalText });
        await _send(sender,
          `✅ Posted! Your listing is now live.\n\nID: *${result.id}*\n\n` +
          `Interested people will reach you through the bot. Your number stays private 🔒`,
          chatId
        );
      } else if (msg === "no") {
        clearState(sender);
        await _send(sender, "No problem! You can always DM the bot anytime 😊", chatId);
      } else {
        await _send(sender, "Please reply with *YES* or *NO* 😊", chatId);
      }
      return;
    }

    if (isLookingForFlat(text)) {
      setState(sender, { state: "awaiting_requirements" });
      await _send(sender, REQUIREMENTS_PROMPT, chatId);
      return;
    }

    if (isFlatListing(text)) {
      setState(sender, { state: "awaiting_group_confirm", originalText: text });
      await _send(sender,
        "👋 We saw your listing in the group!\n\n" +
        "Want us to post it officially in Announcements? The whole community will see it.\n\n" +
        "✅ More reach\n" +
        "🔒 Your number stays private until you approve\n\n" +
        "Reply *YES* to post or *NO* to skip.",
        chatId
      );
    }

  } catch (err) {
    console.error("Group message error:", err.message);
    try { await _send(sender, "Something went wrong. Please try again 🙏", chatId); } catch (e) {}
  }
}

module.exports = { handleMessage, handleGroupMessage, init };