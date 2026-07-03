const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { excludeChat, includeChat, getChatStatus } = require("../database/db");

// Captured once when this module loads. Any message older than this
// is a WhatsApp replay from a previous session — we drop it.
const BOT_START_TIME = Math.floor(Date.now() / 1000);

// Simple in-memory cooldown. Prevents spam and protects Gemini quota.
const USER_LAST_MSG      = new Map();
const RATE_LIMIT_SECONDS = 10;

function isRateLimited(sender) {
  const now  = Date.now();
  const last = USER_LAST_MSG.get(sender) || 0;
  if (now - last < RATE_LIMIT_SECONDS * 1000) return true;
  USER_LAST_MSG.set(sender, now);
  return false;
}

let client;

async function connectWhatsApp(onMessage, onGroupMessage, onReady) {
  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu"
      ]
    }
  });

  client.on("qr", (qr) => {
    console.log("\n📱 Scan this QR code with WhatsApp:\n");
    qrcode.generate(qr, { small: true });
  });

  client.on("ready", () => {
    console.log("✅ WhatsApp connected!");
    if (onReady) onReady();
  });

  client.on("disconnected", (reason) => {
    console.log("WA disconnected:", reason, "reconnecting in 10s");
    client.removeAllListeners();
    setTimeout(() => connectWhatsApp(onMessage, onGroupMessage, onReady), 10000);
  });

  // Welcome new members — loop all recipientIds for bulk-add support
  client.on("group_join", async (notification) => {
    const ids = notification.recipientIds || [];
    if (ids.length === 0) return;

    for (const newMemberId of ids) {
      try {
        const chatId = newMemberId.includes("@")
          ? newMemberId
          : newMemberId + "@c.us";
        const number = newMemberId
          .replace("@c.us", "")
          .replace("@s.whatsapp.net", "");

        console.log("New member joined:", number);

        await client.sendMessage(
          chatId,
          "👋 Welcome to *Flat/Flatmates Community*!\n\n" +
          "I'm your community bot. Here's how I can help:\n\n" +
          "🔍 *Search for a flat:* Just describe what you need\n" +
          "   Example: looking for 2bhk in vijay nagar under 12k\n\n" +
          "📝 *List your flat:* Send *post*\n\n" +
          "🗑️ *Delete your listing:* Send *DELETE NC-0001*\n\n" +
          "🔒 Your number is *never shared* without your approval\n\n" +
          "Feel free to message me anytime! 😊\n" +
          "also pls help our boss, he's literally surviving on chai and dreams ☕💀"
        );
      } catch (err) {
        console.error("Welcome message error:", err.message);
      }
    }
  });

  client.on("message_create", async (msg) => {

    // Hard guards
    if (!msg.body)                       return;
    if (msg.from === "status@broadcast") return;

    // Block bot's own outgoing messages EXCEPT /exclude and /include.
    // These two commands must work from both sides of the chat.
    const cmdCheck = msg.body.trim().toLowerCase();
    if (msg.fromMe && cmdCheck !== "/exclude" && cmdCheck !== "/include") return;

    // Replay guard — only for incoming messages, NOT for bot owner commands.
    // msg.fromMe messages (your own commands) can have slightly older timestamps
    // due to phone/server clock drift and would get wrongly dropped otherwise.
    if (!msg.fromMe && msg.timestamp < BOT_START_TIME) return;

    try {
      const body    = msg.body.trim();
      const isGroup = msg.from.includes("@g.us");

      // Group messages — social group always active, all others dropped
      if (isGroup) {
        if (msg.from === process.env.SOCIAL_GROUP_ID) {
          const contact = await msg.getContact();
          const sender  = contact.number;
          const chatId  = contact.id._serialized;

          if (isRateLimited(sender)) {
            console.log(`⏳ Rate limited (group): ${sender}`);
            return;
          }

          console.log(`Social Group from ${sender}: ${body}`);
          await onGroupMessage(sender, body, chatId);
        }
        return;
      }

      // Private DM path
      //
      // chatId resolution — this is the tricky part:
      // When msg.fromMe = true (you typed the command from your own phone):
      //   msg.from = bot's own number
      //   msg.to   = the other person's chatId (what we want)
      //   msg.id.remote = also the other person's chatId (backup)
      // When msg.fromMe = false (other person typed):
      //   msg.from = other person's chatId (what we want)
      //
      // msg.to is sometimes undefined in certain WA Web versions,
      // so we fall back to msg.id.remote which is always populated.

      let sender, chatId;
      try {
        if (msg.fromMe) {
          // Use msg.to first, fall back to msg.id.remote
          let target = msg.to || msg.id?.remote;
          console.log(`[fromMe cmd] body="${body}" from=${msg.from} to=${msg.to} id.remote=${msg.id?.remote} resolved=${target}`);
          if (!target) {
            console.error("[fromMe cmd] could not resolve target chatId — skipping");
            return;
          }
        
          // CRITICAL FIX: If target is in @lid format, resolve it to phone (@c.us) format
          // so it matches the chatId used when the user sends messages.
          if (target.endsWith("@lid")) {
            try {
              const chat = await client.getChatById(target);
              const contact = await chat.getContact();
              if (contact?.id?._serialized && contact.id._serialized.endsWith("@c.us")) {
                console.log(`[fromMe cmd] LID resolved: ${target} → ${contact.id._serialized}`);
                target = contact.id._serialized;
              }
            } catch (err) {
              console.error("[fromMe cmd] LID resolution failed:", err.message);
              // continue with lid anyway — better than nothing
            }
          }
        
          chatId = target;
          sender = target
            .replace("@c.us", "")
            .replace("@lid", "")
            .replace("@s.whatsapp.net", "");
        } else {
          const contact = await msg.getContact();
          sender  = contact.number;
          chatId  = contact.id._serialized;
        }
      } catch (err) {
        sender  = msg.from
          .replace("@c.us", "")
          .replace("@lid", "")
          .replace("@s.whatsapp.net", "");
        chatId  = msg.from;
      }

      // /exclude command
      if (body.toLowerCase() === "/exclude") {
        try {
          await excludeChat(chatId);
          await client.sendMessage(
            chatId,
            "🤫 Got it! I'll stay quiet in this chat.\n" +
            "Type */include* anytime to bring me back."
          );
          console.log(`🚫 Chat excluded: ${chatId}`);
        } catch (err) {
          console.error("excludeChat error:", err.message);
        }
        return;
      }

      // /include command
      if (body.toLowerCase() === "/include") {
        try {
          await includeChat(chatId, msg.timestamp);
          await client.sendMessage(
            chatId,
            "👋 I'm back! Just tell me what you're looking for and I'll find the best options! 🔍"
          );
          console.log(`✅ Chat included: ${chatId} (cutoff ts: ${msg.timestamp})`);
        } catch (err) {
          console.error("includeChat error:", err.message);
        }
        return;
      }

      // Exclusion / timestamp gate
      let status;
      try {
        status = await getChatStatus(chatId);
      } catch (err) {
        console.error("getChatStatus error:", err.message);
        return;
      }

      if (status !== null) {
        if (!status.active) {
          console.log(`🚫 Ignored (excluded): ${chatId}`);
          return;
        }
        if (msg.timestamp <= status.included_at) {
          console.log(`⏭️  Ignored (pre-include timestamp): ${chatId}`);
          return;
        }
      }

      // Rate limit
      if (isRateLimited(sender)) {
        console.log(`⏳ Rate limited (DM): ${sender}`);
        return;
      }

      // All clear
      console.log(`From ${sender}: ${body}`);
      await onMessage(sender, body, chatId);

    } catch (err) {
      console.error("Message handler error:", err.message);
    }
  });

  client.initialize();
}

async function sendMessage(to, message, chatId) {
  try {
    const target = chatId || (to + "@c.us");
    await client.sendMessage(target, message);
  } catch (err) {
    console.error(`sendMessage failed (target: ${chatId || to}):`, err.message);
  }
}

module.exports = { connectWhatsApp, sendMessage };