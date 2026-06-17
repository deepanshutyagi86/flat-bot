const { getUnpostedListings, markAsPosted } = require("../database/db");

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let _send;
let schedulerTimer = null;

function initScheduler(sendFn) {
  _send = sendFn;
}

async function runPostingJob() {
  try {
    const unposted = await getUnpostedListings();

    if (unposted.length === 0) {
      console.log("📭 Scheduler: no unposted listings to broadcast.");
      return;
    }

    // Pick the oldest unposted listing (first in list, ordered by created_at ASC)
    const listing = unposted[0];

    const msg =
      `🏠 *New Listing — ${listing.id}*\n\n` +
      `${listing.message_text}\n\n` +
      `📩 Interested? Message the bot with ID: *${listing.id}*`;

    await _send("", msg, process.env.ANNOUNCEMENT_GROUP_ID);
    await markAsPosted(listing.id);

    console.log(`📢 Scheduler: posted ${listing.id} to announcement group. ${unposted.length - 1} remaining.`);
  } catch (err) {
    console.error("Scheduler job error:", err.message);
  }
}

function startScheduler() {
  if (!_send) {
    console.error("❌ Scheduler: initScheduler(sendFn) must be called before startScheduler()");
    return;
  }

  // Run once immediately when bot starts (posts any pending listing right away)
  console.log("⏰ Scheduler started — running first job now, then every 1 hour.");
  runPostingJob();

  // Then repeat every hour
  schedulerTimer = setInterval(runPostingJob, INTERVAL_MS);
}

function stopScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log("⏰ Scheduler stopped.");
  }
}

module.exports = { initScheduler, startScheduler, stopScheduler };