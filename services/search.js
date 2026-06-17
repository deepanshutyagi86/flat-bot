async function aiSearch(query, listings) {
    try {
      console.log(`🤖 AI Search triggered — query: "${query}", listings available: ${listings.length}`);
  

     


      const listingsText = listings.map(l =>
        `ID: ${l.id}\nListing: ${l.message_text}`
      ).join("\n\n");
  
      const prompt =
        `You are FlatBot, a flat-search assistant for an Indian housing community.\n\n` +
        `User message: "${query}"\n\n` +
        `Available listings:\n\n${listingsText}\n\n` +
        `Instructions:\n` +
        `STEP 1 — Decide if the user is asking about flats/rooms/PG/rent/flatmates/accommodation.\n` +
        `- If YES → search the listings and return a JSON object like this:\n` +
        `  { "type": "results", "ids": ["NC-0001", "NC-0005"] }\n` +
        `  Match based on location, type (flat/room/PG/BHK), gender preference, price.\n` +
        `  Understand Indian price formats: "10k" = 10000, "under 10k" = max 10000.\n` +
        `  Know Indian areas: "north campus" = near Delhi University, etc.\n` +
        `  If nothing matches return: { "type": "results", "ids": [] }\n\n` +
        `- If NO (user is asking something unrelated to flat searching) → return:\n` +
        `  { "type": "off_topic" }\n\n` +
        `IMPORTANT:\n` +
        `- Do NOT treat greetings like "hi", "hello", "hey" as off_topic — those are handled separately.\n` +
        `- Only mark as off_topic if it's a clear non-housing question like "what's the weather", "tell me a joke", "who is Modi" etc.\n` +
        `- Return ONLY valid JSON. No explanation, no markdown, no backticks.`;
  
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
          })
        }
      );
  
      const data = await response.json();
      console.log("🤖 Full API response:", JSON.stringify(data, null, 2));
      
      // ✅ Quota check FIRST, before any parsing
      if (response.status === 429 || data?.error?.code === 429 || 
        data?.error?.status === "RESOURCE_EXHAUSTED") {
        console.log("⚠️ Gemini quota exceeded");
        return { type: "quota_exceeded" };
      }
      
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      console.log(`🤖 AI Raw response: ${text}`);
      
      if (!text) return { type: "results", ids: [], results: [] };
      
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      
      if (parsed.type === "off_topic") {
        console.log("🤖 AI flagged as off-topic");
        return { type: "off_topic" };
      }
      
  
      const ids = parsed.ids || [];
      console.log(`🤖 AI matched IDs: ${JSON.stringify(ids)}`);
  
      const results = listings.filter(l => ids.includes(l.id));
      console.log(`🤖 AI final results count: ${results.length}`);
  
      return { type: "results", ids, results };
  
    } catch (err) {
      console.error("AI Search error:", err.message);

      // Detect quota/limit errors
      const isQuotaError = err.message.includes("429") || 
                           err.message.includes("quota") || 
                           err.message.includes("RESOURCE_EXHAUSTED");
  
      if (isQuotaError) {
        return { type: "quota_exceeded" };
      }

      return { type: "results", ids: [], results: [] };
    }
  }
  
  module.exports = { aiSearch };