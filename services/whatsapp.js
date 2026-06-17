const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

let client;

async function connectWhatsApp(onMessage, onGroupMessage, onReady) {
  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] }
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
    console.log("WA disconnected:", reason, "— reconnecting in 10s");
    setTimeout(() => client.initialize(), 10000);
  });


  // Welcome new members
  client.on("group_join", async (notification) => {
    try {
      const newMemberId = notification.recipientIds[0]; // the actual new member
      if (!newMemberId) return;
  
      const chatId = newMemberId.includes("@") ? newMemberId : newMemberId + "@c.us";
      const number = newMemberId.replace("@c.us", "").replace("@s.whatsapp.net", "");
      
      console.log("New member joined:", number);
  
      await client.sendMessage(chatId,
        "👋 Welcome to *Flat/Flatmates Community*!\n\n" +
        "I'm your community bot. Here's how I can help:\n\n" +
        "🔍 *Search for a flat directly :* Send what you are searching in message\n" +
        "   Example: i am searching for 2bhk in vijay nagar.\n\n" +
        "📝 *List your flat:* Send *post*\n\n" +
        "🗑️ *Delete your listing:* Send *DELETE NC-0001*\n\n" +
        "🔒 Your number is *never shared* without your approval\n\n" +
        "Feel free to message me anytime! 😊"+
        "also pls help our boss, he's literally surviving on chai and dreams ☕💀\n",
      );
    } catch (err) {
      console.error("Welcome message error:", err.message);
    }
  });





  // All messages
  client.on("message", async (msg) => {
    if (!msg.body) return;
    if (msg.from === "status@broadcast") return;

    try {
      // Group message
      if (msg.from.includes("@g.us")) {
        if (msg.from === process.env.SOCIAL_GROUP_ID) {
          // Get sender from group message
          const contact = await msg.getContact();
          const sender = contact.number;
          const chatId = contact.id._serialized;
          console.log("Social Group - From " + sender + ": " + msg.body);
          await onGroupMessage(sender, msg.body, chatId);
        }
        return;
      }

      // Private message — handle @lid format
      let sender, chatId;
      try {
        const contact = await msg.getContact();
        sender = contact.number;
        chatId = contact.id._serialized;
      } catch (err) {
        // Fallback if getContact fails
        sender = msg.from.replace("@c.us", "").replace("@lid", "").replace("@s.whatsapp.net", "");
        chatId = msg.from;
      }

      console.log("From " + sender + ": " + msg.body);
      await onMessage(sender, msg.body, chatId);

    } catch (err) {
      console.error("Message handler error:", err.message);
    }
  });

  client.initialize();
}

async function sendMessage(to, message, chatId) {
  const target = chatId || (to + "@c.us");
  await client.sendMessage(target, message);
}

module.exports = { connectWhatsApp, sendMessage };