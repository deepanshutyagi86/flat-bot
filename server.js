require("dotenv").config();

// Validate required environment variables before starting anything
const REQUIRED_ENV_VARS = [
  "SUPABASE_URL",
  "SUPABASE_KEY",
  "GEMINI_API_KEY",
  "ANNOUNCEMENT_GROUP_ID",
  "SOCIAL_GROUP_ID"
];

process.on("unhandledRejection", (err) => {
    console.error("Unhandled rejection:", err.message);
  });


const missingVars = REQUIRED_ENV_VARS.filter(v => !process.env[v]);
if (missingVars.length > 0) {
  console.error("❌ Missing required environment variables:", missingVars.join(", "));
  console.error("Fix your .env file and restart. Bot will NOT start with missing config.");
  process.exit(1);
}

const { connectWhatsApp, sendMessage } = require("./services/whatsapp");
const { handleMessage, handleGroupMessage, init } = require("./routes/webhook");
const { initScheduler, startScheduler } = require("./services/scheduler");

init(sendMessage);
initScheduler(sendMessage);

console.log("Starting FlatBot...");

// startScheduler is passed as onReady callback so WhatsApp is fully
// connected before the scheduler tries to send any messages
connectWhatsApp(handleMessage, handleGroupMessage, startScheduler);