const { saveListing, getListing, deleteListing, searchListings } = require("../database/db");
const { aiSearch } = require("../services/search");
const userState = {};
let _send;

// Rate limiting: track message timestamps per sender (max 10 msgs/min)
const rateLimitMap = {};
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function isRateLimited(sender) {
  const now = Date.now();
  if (!rateLimitMap[sender]) rateLimitMap[sender] = [];
  // Remove timestamps older than 1 minute
  rateLimitMap[sender] = rateLimitMap[sender].filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (rateLimitMap[sender].length >= RATE_LIMIT_MAX) return true;
  rateLimitMap[sender].push(now);
  return false;
}

// State timeout: clear state older than 2 hours to prevent ghost states
const STATE_TIMEOUT_MS = 2 * 60 * 60 * 1000;

function getState(sender) {
  const s = userState[sender];
  if (!s) return null;
  if (Date.now() - s.createdAt > STATE_TIMEOUT_MS) {
    userState[sender] = null;
    return null;
  }
  return s;
}

function setState(sender, stateObj) {
  userState[sender] = { ...stateObj, createdAt: Date.now() };
}

function clearState(sender) {
  userState[sender] = null;
}

function init(sendFn) { _send = sendFn; }

async function postToAnnouncements(listing) {
  const msg =
    `🏠 *New Listing — ${listing.id}*\n\n` +
    `${listing.message_text}\n\n` +
    `📩 Interested? Message the bot with ID: *${listing.id}*`;
  await _send("", msg, process.env.ANNOUNCEMENT_GROUP_ID);
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

function isSimpleGreeting(text) {
  const greetings = ["hi", "hello", "hey", "hii", "helo", "hye", "yo", "sup", "wassup", "howdy"];
  return greetings.includes(text.trim().toLowerCase());
}

function isNaturalLanguage(text) {
  // More than 1 word = likely a search query worth sending to AI
  // Covers short queries like "2bhk noida" or "room girls" that users type naturally
  return text.trim().split(/\s+/).length > 1;
}

async function doSearch(sender, text, chatId) {
  await _send(sender, "🔍 hold on lemme cook... 👨‍🍳✨", chatId);

  const allActive = await searchListings("");
  const aiResult = await aiSearch(text, allActive);


  if (aiResult.type === "quota_exceeded") {
    await _send(sender,
      "💀 okay so... our AI brain has temporarily LEFT THE CHAT\n\n" +
      "basically our boss spent all his money on chai thats why our API Limit reached 😭\n\n" +
      "*kr do uski help nhi toh marr jayega* 😵‍💫\n" +
      "upi: *deepanshutyagi0784@okhdfcbank*\n\n" +
      "meanwhile try manual search like:\n" +
      "*search 2bhk Shastri Nagar under 15k*\n\n" +
      "ya seedha boss ko pakad: *+91 9870600903* 😄",
      chatId
    );
    return;
  }


  if (aiResult.type === "off_topic") {
    await _send(sender,
      "😄 I appreciate the curiosity! But I'm just a humble FlatBot — only trained for flat hunting.\n\n" +
      "My boss hasn't given me permission to venture beyond that... *yet* 👀\n\n" +
      "Once we expand, maybe I'll be allowed to do more! 🚀\n\n" +
      "For now, try: *search 2bhk Shastri Nagar under 15k* 🏠\n\n" +
      "also pls help our boss, upi: *deepanshutyagi0784@okhdfcbank* 😭",
      chatId
    );
    return;
  }

  const results = aiResult.results;

  if (results.length === 0) {
    await _send(sender, "😔 nothing found bro, abhi aasi koi listing nhi hai  💀\n\nbtw thoda alag keywords try kar skte ho!", chatId);
    return;
  }

  let response = `🏠 Found *${results.length}* listing(s):\n\n`;
  results.forEach((listing, i) => {
    response += `${i + 1}️⃣ *${listing.id}*\n${listing.message_text}\n\n`;
  });
  response += `Send any ID to inquire about that listing!`;
  await _send(sender, response, chatId);
}

async function handleGroupMessage(sender, text, chatId) {
  try {
    if (getState(sender)?.state === "awaiting_group_confirm") {
      const msg = text.trim().toLowerCase();
      if (msg === "yes") {
        const originalText = getState(sender).originalText;
        const result = await saveListing(sender, originalText, "group");
        if (!result.success) {
          await _send(sender, "⚠️ Something went wrong. Please try again.", chatId);
          clearState(sender);
          return;
        }
        clearState(sender);
        await postToAnnouncements({ id: result.id, message_text: originalText });
        await _send(sender, `✅ POSTED! you're in the game now 🎯\n\nID: *${result.id}*\n\n fr\n\npeople will reach through bot, number stays on lockdown 🔒😤`, chatId);
      } else if (msg === "no") {
        clearState(sender);
        await _send(sender, "no worries bestie 😊 change of mind? just DM the bot with '*post*' anytime 🏠", chatId);
      } else {
        await _send(sender, "bhai *YES* ya *NO* bolna tha 😭 itna mushkil kya tha", chatId);
      }
      return;
    }

    if (isFlatListing(text)) {
      setState(sender, { state: "awaiting_group_confirm", originalText: text, chatId });
      await _send(sender,
      "👋 Hey! We noticed you posted about a flat in the community group.\n\n" +
        "Want to publish it officially in the *Announcements group*?\n\n" +
        "✅ Your listing will reach everyone in the community\n" +
        "🔒 Your number stays private until YOU approve sharing it\n\n" +
        "Reply *YES* to publish or *NO* to skip.",
        chatId
      );
    }
  } catch (err) {
    console.error("Group message error:", err.message);
    try { await _send(sender, "⚠️ kuch toh gadbad hai daya 😭 ek baar phir try kar, we got you 🙏, ya firr hmare boss ko bol ki ye AI kaam kyu nhi krta(Fund Chaiye kya?) le contact krr: 9870600903", chatId); } catch (e) {}
  }
}

async function handleMessage(sender, text, chatId) {
  try {
    const msg = text.trim().toLowerCase();

    // Rate limiting — max 10 messages per minute per sender
    if (isRateLimited(sender)) {
      console.log(`Rate limit hit for ${sender}`);
      await _send(sender, "⏳ thoda slow down kar bhai 😅 ek minute mein itne messages mat bhej, try again in a moment!", chatId);
      return;
    }

    // CANCEL — escape hatch from any stuck state
    if (msg === "cancel") {
      clearState(sender);
      await _send(sender,
        "✅ cancelled! fresh start 🔄\n\n" +
        "📝 *List your flat:* Type  *'post'*\n" +
        "🔍 *Search:* Send *'search 2bhk north campus'*\n" +
        "🗑️ *Delete:* Send *'DELETE NC-0001'*",
        chatId
      );
      return;
    }

    // If user is in group listing confirmation flow
    if (getState(sender)?.state === "awaiting_group_confirm") {
      await handleGroupMessage(sender, text, chatId);
      return;
    }

    // CASE 1 — Post a listing
    if (msg === "post") {
      setState(sender, { state: "awaiting_listing", chatId });
      await _send(sender, "ayo, send the message that you want to post on the announcement group. 📝 we're all ears 👂\n\n(send *cancel* anytime to stop)", chatId);

    // CASE 2 — Receive listing message
    } else if (getState(sender)?.state === "awaiting_listing") {
      // Message length validation — WhatsApp struggles with very long messages
      if (text.trim().length > 800) {
        await _send(sender,
          "⚠️ yaar thoda chhota kar apna message 😅\n\n" +
          `abhi *${text.trim().length} characters* hain — max *800* allowed hai.\n\n` +
          "short aur crisp rakh: location, type, price, contact preference. that's it! 🏠",
          chatId
        );
        return;
      }
      const result = await saveListing(sender, text, "direct");
      if (!result.success) {
        await _send(sender, "bro something broke 💀 send *post* and try again, we believe in you 🙏", chatId);
        return;
      }
      clearState(sender);
      await postToAnnouncements({ id: result.id, message_text: text });
      await _send(sender, `✅ LESSGO! listing is LIVE frfr 🎉\n\n` +
      `your ID is *${result.id}* — don't lose it bestie\n\n` +
      `📢 posted in Announcements, the whole community can see you now 👀\n\n` +
      `people will hit you up through the bot. your number stays hidden like your exam marks 😂🔒`, chatId);

    // CASE 3 — Delete a listing
    } else if (text.trim().toUpperCase().match(/^DELETE [A-Z]+-\d{4}$/)) {
      const listingId = text.trim().toUpperCase().split(" ")[1];
      const listing = await getListing(listingId);

      if (!listing) { await _send(sender, "❌ Listing not found. 👻 double check kar bhai", chatId); return; }
      if (listing.owner_phone !== sender) { await _send(sender, "⚠️ arre bhai yeh tera ghar nahi hai 😭 sirf apni listing delete kar", chatId); return; }
      if (listing.status === "inactive") { await _send(sender, "⚠️ yeh toh pehle se deleted hai bro 💀", chatId); return; }

      const success = await deleteListing(listingId, sender);
      if (success) {
        await _send(sender, `✅ *${listingId}* — gone. poof. deleted. finished. bye 👋😂`, chatId);
      } else {
        await _send(sender,"⚠️ kuch toh gadbad hai daya 😭 try again kar please", chatId);
      }

    // CASE 4 — Explicit search command
    } else if (msg.startsWith("search ")) {
      const query = text.trim().slice(7).trim();
      if (!query) {
        await _send(sender, "bro you sent *search* but nothing after it 😭\n\nexample: *search 2bhk north campus under 10k* — aise karte hain!", chatId);
        return;
      }
      await doSearch(sender, query, chatId);

    // CASE 5 — Inquire about a listing
    } else if (text.trim().toUpperCase().match(/^[A-Z]+-\d{4}$/)) {
      const listingId = text.trim().toUpperCase();
      const listing = await getListing(listingId);

      if (!listing) { await _send(sender, "😔 nothing found bestie, \n\nthoda alag keywords try kar ya baad mein aana!", chatId); return; }
      if (listing.status === "inactive") { await _send(sender, "❌ yeh listing toh gyi bhai 💀 already taken or deleted\n\nkoi aur dhundo!", chatId); return; }
      if (listing.owner_phone === sender) { await _send(sender, "😂 bhai yeh teri hi listing hai, apne aap se flat lega kya 💀", chatId); return; }

      try {
        await _send(listing.owner_phone,
          "👀 aye someone's eyeing your listing " + listingId + " frfr!\n\n\"" + listing.message_text + "\"\n\nshare your number? reply *YES* ya *NO* — your call bestie 🔒\n\n(offer expires in 2 hours)",
          listing.owner_phone + "@c.us"
        );
        setState(listing.owner_phone, {
          state: "awaiting_approval",
          requester: sender,
          requesterChatId: chatId,
          listingId
        });
        await _send(sender, "⏳ request gaya owner ke paas... ab unka wait karo bestie 🙏 fingers crossed 🤞", chatId);
      } catch (err) {
        console.error("Failed to reach owner:", err.message);
        await _send(sender, "⚠️ owner ne shayad phone band kar liya 😭 insta wale nahi milte kabhi\n\nkoi doosri listing try kar bhai!", chatId);
      }

    // CASE 6 — Owner approves or rejects
    } else if (getState(sender)?.state === "awaiting_approval") {
      const { requester, requesterChatId, listingId } = getState(sender);
      const listing = await getListing(listingId);

      if (msg === "yes") {
        clearState(sender);
        await _send(requester, "✅ Contact approved! legend 🙌 \n\nListing:\n\"" + listing.message_text + "\"\n\nOwner's number: +" + sender, requesterChatId);
        await _send(sender, "✅ number share ho gaya! you're a real one 🤝", chatId);
      } else if (msg === "no") {
        clearState(sender);
        await _send(requester, "❌" + listingId + " wale ne decline kar diya 😬 no worries, doosra dhundo!", requesterChatId);
        await _send(sender, "✅ declined! ghosting legally approved 😂🔒", chatId);
      } else {
        await _send(sender, "bhai *YES* ya *NO* mein bol, Shakespeare mat ban 😂", chatId);
      }

    // CASE 7 — Simple greeting → welcome message, no AI needed
    } else if (isSimpleGreeting(text)) {
      await _send(sender,
        "👋 Welcome to *Flat/Flatmates Community*!\n\n" +
        "I'm your community bot. Here's how I can help:\n\n" +
        "🔍 *Search for a flat directly :* Send what you are searching in message\n" +
        "   Example: i am searching for 2bhk in vijay nagar.\n\n" +
        "📝 *List your flat:* Send *post*\n\n" +
        "🗑️ *Delete your listing:* Send *DELETE NC-0001*\n\n" +
        "🔒 Your number is *never shared* without your approval\n\n" +
        "Feel free to message me anytime! 😊\n" +
        "also pls help our boss he's literally surviving on chai and dreams ☕💀\n",
        chatId
      );

    // CASE 8 — Natural language → let AI decide (search or off-topic)
    } else if (isNaturalLanguage(text)) {
      await doSearch(sender, text, chatId);

    // DEFAULT — short unrecognised input
    } else {
      await _send(sender,
        "bro... idk what that was 😭 but i gotchu!\n\n" +
        "📝 *List your flat:* Send *'post'*\n\n" +
        "🔍 *Search for a flat:* Send *search* followed by what you need\n" +
        "   Example: *search 2bhk north campus under 10k*\n\n" +
        "🗑️ *Delete your listing:* Send *DELETE NC-0001*\n\n" +
        "🔒 Your number is *never shared* without your approval\n\n" +
        "Feel free to message me anytime! 😊\n" +
        "🔒 number privacy = always on. we're built different 💅\n\n" +
        "and yooo our boss is starving fr fr 😭\n" +
        "throw him a bone: '*deepanshutyagi0784@okhdfcbank*'",
        chatId
      );
    }

  } catch (err) {
    console.error("Message handling error:", err.message);
    try { await _send(sender,"💀 bhai kuch toh tod diya tune, ek baar phir try kar 🙏\n\nagar phir bhi nahi hua toh boss ko pakad: *+91 9870600903*", chatId); } catch (e) {}
  }
}

module.exports = { handleMessage, handleGroupMessage, init };