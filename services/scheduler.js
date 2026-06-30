const { getUnpostedListings, markAsPosted } = require("../database/db");

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let _send         = null;
let schedulerTimer = null;

// ── initScheduler ─────────────────────────────────────────────────────────────
// Must be called once at startup to inject the sendMessage function before
// startScheduler() is ever invoked.
function initScheduler(sendFn) {
  _send = sendFn;
}

// ── runPostingJob ─────────────────────────────────────────────────────────────
// Picks the single oldest unposted listing and broadcasts it to the
// announcement group, then marks it posted. Runs once per interval tick.
async function runPostingJob() {
  try {
    const unposted = await getUnpostedListings();

    if (unposted.length === 0) {
      console.log("📭 Scheduler: no unposted listings to broadcast.");
      return;
    }

    // Oldest first (DB returns ordered by created_at ASC)
    const listing = unposted[0];

    const msg =
      `🏠 *New Listing — ${listing.id}*\n\n` +
      `${listing.message_text}\n\n` +
      `📩 Interested? Message the bot with: *${listing.id}*`;

    await _send("", msg, process.env.ANNOUNCEMENT_GROUP_ID);
    await markAsPosted(listing.id);

    console.log(
      `📢 Scheduler: posted ${listing.id} to announcement group.` +
      ` ${unposted.length - 1} remaining.`
    );
  } catch (err) {
    console.error("Scheduler job error:", err.message);
  }
}

// ── startScheduler ────────────────────────────────────────────────────────────
// Called once when WhatsApp is fully ready (via the onReady callback).
//
// Guard: if schedulerTimer is already set it means either:
//   (a) the bot reconnected and on('ready') fired again, OR
//   (b) startScheduler() was called twice by mistake.
// In both cases we do NOT start a second interval — that's what caused
// the original message dump.
function startScheduler() {
  if (!_send) {
    console.error("❌ Scheduler: initScheduler(sendFn) must be called before startScheduler()");
    return;
  }

  if (schedulerTimer) {
    console.log("⏰ Scheduler already running — skipping duplicate start.");
    return;
  }

  console.log("⏰ Scheduler started — running first job now, then every 1 hour.");

  // Run once immediately so any pending listing goes out right away,
  // but only on the very first clean start (not on reconnects).
  runPostingJob();

  // Then tick every hour
  schedulerTimer = setInterval(runPostingJob, INTERVAL_MS);
}

// ── stopScheduler ─────────────────────────────────────────────────────────────
// Exported for graceful shutdown / testing.
function stopScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log("⏰ Scheduler stopped.");
  }
}

module.exports = { initScheduler, startScheduler, stopScheduler };