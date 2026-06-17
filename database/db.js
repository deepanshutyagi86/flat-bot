const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function generateNextID() {
  const { data, error } = await supabase.from("listings").select("id");
  if (error || !data || data.length === 0) return "NC-0001";
  const nums = data.map(row => parseInt(row.id.split("-")[1]));
  const max = Math.max(...nums);
  return "NC-" + String(max + 1).padStart(4, "0");
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

  // If empty query — return all active listings
  if (!query || query.trim() === "") return data;

  // Keyword search
  const keywords = query.toLowerCase().split(" ").filter(w => w.length > 2);
  const results = data.filter(listing => {
    const text = listing.message_text.toLowerCase();
    return keywords.some(k => text.includes(k));
  });

  console.log(`🔑 Keyword matched: ${results.length}`);
  return results;
}

// Fetch all active listings that haven't been posted to the announcement group yet
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

// Mark a listing as posted so the scheduler never picks it again
async function markAsPosted(id) {
  const { error } = await supabase
    .from("listings")
    .update({ posted: true })
    .eq("id", id.toUpperCase());

  if (error) { console.error("DB Error (markAsPosted):", error.message); return false; }
  return true;
}

module.exports = { saveListing, getListing, deleteListing, searchListings, getUnpostedListings, markAsPosted };