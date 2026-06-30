const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function generateNextID() {
  const { data, error } = await supabase.from("listings").select("id");
  if (error || !data || data.length === 0) return "NC-0001";
  const nums = data.map(row => parseInt(row.id.split("-")[1]));
  const max = Math.max(...nums);
  return "NC-" + String(max + 1).padStart(4, "0");
}

async function excludeChat(chatId) {
  const { error } = await supabase
    .from("excluded_chats")
    .upsert(
      {
        chat_id:     chatId,
        active:      false,
        included_at: 0,
        updated_at:  new Date().toISOString()
      },
      { onConflict: "chat_id" }
    );

  if (error) throw new Error("excludeChat DB error: " + error.message);
}

async function includeChat(chatId, msgTimestamp) {
  const { error } = await supabase
    .from("excluded_chats")
    .upsert(
      {
        chat_id:     chatId,
        active:      true,
        included_at: msgTimestamp,
        updated_at:  new Date().toISOString()
      },
      { onConflict: "chat_id" }
    );

  if (error) throw new Error("includeChat DB error: " + error.message);
}

async function getChatStatus(chatId) {
  const { data, error } = await supabase
    .from("excluded_chats")
    .select("active, included_at")
    .eq("chat_id", chatId)
    .single();

  if (error && error.code === "PGRST116") return null;
  if (error) throw new Error("getChatStatus DB error: " + error.message);

  return data;
}

async function saveListing(owner_phone, message_text, source) {
  let attempts = 0;
  while (attempts < 3) {
    const id = await generateNextID();
    if (!id) return { success: false, id: null };
    const { error } = await supabase.from("listings").insert([{ id, owner_phone, message_text, source, status: "active" }]);
    if (!error) { console.log("Saved:", id); return { success: true, id }; }
    if (error.message.includes("duplicate key")) { attempts++; continue; }
    console.error("DB Error:", error.message);
    return { success: false, id: null };
  }
  return { success: false, id: null };
}

async function getListing(id) {
  const { data, error } = await supabase.from("listings").select("*").eq("id", id.toUpperCase()).single();
  if (error) { console.error("DB Error:", error.message); return null; }
  return data;
}

async function deleteListing(id, owner_phone) {
  const { data, error } = await supabase
    .from("listings")
    .update({ status: "inactive" })
    .eq("id", id.toUpperCase())
    .eq("owner_phone", owner_phone);

  if (error) { console.error("DB Error:", error.message); return false; }
  return true;
}

async function searchListings(query) {
  const { data, error } = await supabase
    .from("listings")
    .select("*")
    .eq("status", "active");

  if (error) { console.error("DB Error:", error.message); return []; }
  if (!data || data.length === 0) return [];

  console.log(`📦 Total active listings fetched: ${data.length}`);

  if (!query || query.trim() === "") return data;

  const keywords = query.toLowerCase().split(" ").filter(w => w.length > 2);
  const results = data.filter(listing => {
    const text = listing.message_text.toLowerCase();
    return keywords.some(k => text.includes(k));
  });

  console.log(`🔑 Keyword matched: ${results.length}`);
  return results;
}

async function getUnpostedListings() {
  const { data, error } = await supabase
    .from("listings")
    .select("*")
    .eq("status", "active")
    .eq("posted", false)
    .order("created_at", { ascending: true });

  if (error) { console.error("DB Error (getUnpostedListings):", error.message); return []; }
  return data || [];
}

async function markAsPosted(id) {
  const { error } = await supabase
    .from("listings")
    .update({ posted: true })
    .eq("id", id.toUpperCase());

  if (error) { console.error("DB Error (markAsPosted):", error.message); return false; }
  return true;
}

// ── NEW: Search owner_listings by area keywords ───────────────
// Only returns count + area names. Never returns phone numbers.
// Silently increments inquiry_count for matched rows.
async function searchOwnerListingsByQuery(query) {
  try {
    const { data, error } = await supabase
      .from("owner_listings")
      .select("id, area, inquiry_count")
      .eq("status", "active");

    if (error || !data || data.length === 0) return { count: 0, areas: [] };

    const lower = query.toLowerCase();

    const matched = data.filter(l => {
      const area = (l.area || "").toLowerCase();
      return area.split(" ").some(word => word.length > 2 && lower.includes(word));
    });

    if (matched.length === 0) return { count: 0, areas: [] };

    // Fire-and-forget — increment counts, never block the response
    const ids = matched.map(l => l.id);
    supabase
      .from("owner_listings")
      .select("id, inquiry_count")
      .in("id", ids)
      .then(({ data: rows }) => {
        if (!rows) return;
        rows.forEach(row => {
          supabase
            .from("owner_listings")
            .update({ inquiry_count: (row.inquiry_count || 0) + 1, last_inquiry_at: new Date().toISOString() })
            .eq("id", row.id)
            .then(() => {});
        });
      });

    const areas = [...new Set(matched.map(l => l.area))];
    console.log(`🏘️ Owner listings matched: ${matched.length} in ${areas.join(", ")}`);
    return { count: matched.length, areas };

  } catch (err) {
    // Never crash the bot — this is additive only
    console.error("searchOwnerListingsByQuery error:", err.message);
    return { count: 0, areas: [] };
  }
}

module.exports = {
  saveListing,
  getListing,
  deleteListing,
  searchListings,
  getUnpostedListings,
  markAsPosted,
  excludeChat,
  includeChat,
  getChatStatus,
  searchOwnerListingsByQuery
};