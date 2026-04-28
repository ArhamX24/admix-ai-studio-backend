import { task } from "@trigger.dev/sdk/v3";
import OpenAI from "openai";
import prisma from "../../DB/prisma.client.js";

const extractJSON = (rawText) => {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Failed to extract JSON. Raw: ${rawText}`);
  return JSON.parse(match[0]);
};
 

// ── Task 1: Generate script ──────────────────────────────────────
export const generateScriptTask = task({
  id: "generate-script",
  retry: { maxAttempts: 1 },
  run: async (payload) => {
    const { newsIds, scriptType } = payload;

    const newsItems = await prisma.morningAiNewsFetch.findMany({
      where: { id: { in: newsIds } },
    });

    if (!newsItems || newsItems.length === 0) {
      throw new Error(`No news found for IDs: ${newsIds.join(", ")}`);
    }

    const groq = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    });

    const newsContext = newsItems
      .map(
        (n, i) =>
          `खबर ${i + 1}:\nशीर्षक: ${n.title}\nसारांश: ${n.hindiSummary}\nविवरण: ${n.description}`
      )
      .join("\n\n");

    // ── SHORT: anchor only, Reels/Shorts style ───────────────────
    if (scriptType === "short") {
      const lengthInstruction = `स्क्रिप्ट छोटी, तेज और वायरल होनी चाहिए।
ANCHOR/SHORT: 5-7 वाक्य (70-110 शब्द) — शुरुआत में जोरदार दावा, तुरंत attention grab करे, अंत में CTA जरूर हो।`;

      const prompt = `आप एक भारतीय हिंदी न्यूज़ चैनल के एक्सपर्ट शॉर्ट वीडियो स्क्रिप्ट राइटर हैं, जो वायरल और हाई-रीटेंशन कंटेंट बनाने में माहिर हैं। नीचे दी गई खबरों पर SHORT (Reels/Shorts) के लिए स्क्रिप्ट लिखें।
${lengthInstruction}
SHORT स्क्रिप्ट लिखने के नियम:
- शुरुआत सीधे shocking claim या बड़े ऐलान से करें (कोई लंबा build-up नहीं)
  (जैसे: "अब 10 साल की जेल...", "अब 1000 रुपये का इनाम...")
- दूसरी लाइन में "जी हाँ..." या "ये मजाक नहीं है..." से credibility बनाएं
- दर्शकों से सीधे connect करें — "अगर आप भी...", "अगर आप सोच रहे हैं..."
- 1-2 लाइन में पूरी खबर clear कर दें (क्या हुआ, किसने किया)
- एक extra twist या shocking detail जरूर जोड़ें (जैसे सजा, बोनस, hidden rule)
- खबर के पीछे का reason या मकसद short में बताएं
- भाषा बहुत आसान, देसी और सीधी होनी चाहिए
- ...dots का इस्तेमाल करके flow और ठहराव बनाएं
- अंत में strong CTA जरूर दें:
  - "वीडियो शेयर करें"
  - "कमेंट में बताएं"
  - "ऐसे और अपडेट के लिए फॉलो करें"
टोन:
- तेज, सीधा और attention grabbing
- हल्का sensational लेकिन believable
- हर लाइन viewer को आगे देखने पर मजबूर करे

Return ONLY a valid JSON object. Do not include markdown code blocks (like \`\`\`json).
Ensure all newlines in the text are properly escaped as \\n.
Use exactly this schema:
{
  "anchor": "string",
  "voiceOver": "string",
  "thumbnail": "string"
}

खबरें:
${newsContext}`;

      const completion = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `You are an expert Hindi short-video script writer. Output ONLY raw JSON. No markdown, no backticks.
STRICT RULES:
- anchor MUST be minimum 70 words and maximum 110 words. Count every word before responding.
- anchor MUST have exactly 5-7 sentences separated by ... dots.
- STRUCTURE IS MANDATORY — follow this exact order:
  1. Shocking opening claim (1 sentence)
  2. "जी हाँ..." credibility line (1 sentence)
  3. Direct viewer connect "अगर आप भी..." (1 sentence)
  4. Clear news explanation — what happened, who did it (1-2 sentences)
  5. Shocking twist or hidden detail (1 sentence)
  6. Reason behind the news (1 sentence)
  7. Strong CTA with all three: "वीडियो शेयर करें... कमेंट में बताएं... फॉलो करें" (1 sentence)
- If your anchor is less than 70 words, you FAILED. Rewrite it longer.
- voiceOver must always be an empty string "".`,
          },
          { role: "user", content: prompt },
        ],
        model: "llama-3.3-70b-versatile",
        temperature: 0.4,
        frequency_penalty: 0.6, 
        max_tokens: 6000,
      });

      const parsed = extractJSON(completion.choices[0].message.content);
      if (!parsed.anchor) throw new Error("AI response missing anchor field");

      const shortWordCount = parsed.anchor.trim().split(/\s+/).length;
      console.log(`Short script word count: ${shortWordCount} words`);
      if (shortWordCount < 60) {
        console.warn(`WARNING: AI returned only ${shortWordCount} words — below minimum 70. Script may be too short.`);
      }

      console.log("SUCCESS! Short script generated.");
      return {
        anchor: parsed.anchor,
        voiceOver: "",
        thumbnail: parsed.thumbnail || "",
        scriptType: "short",
        newsIds,
      };
    }

    // ── LONG: anchor + voice over ────────────────────────────────
    const lengthInstruction = `स्क्रिप्ट लंबी, डिटेल और स्टोरी-ड्रिवन होनी चाहिए।
ANCHOR: 6-8 वाक्य (120-160 शब्द) — शुरुआत में बड़ा दावा / राहत / खतरे की बात, curiosity build करे, viewer को रोके।
VOICE OVER: 45-55 वाक्य (600-800 शब्द) — पूरी कहानी के flow में: problem → ground reality → emotional connect → solution → फायदा → CTA, ...dots भरपूर उपयोग।`;

    const prompt = `आप एक भारतीय हिंदी न्यूज़ चैनल के एक्सपर्ट स्क्रिप्ट राइटर हैं, जो वायरल और एंगेजिंग वीडियो स्क्रिप्ट लिखने में माहिर हैं। नीचे दी गई खबरों पर प्रोफेशनल TV स्क्रिप्ट लिखें।
${lengthInstruction}
ANCHOR लिखने के नियम:
- शुरुआत हमेशा बड़े दावे, डर या राहत वाली लाइन से करें
- दर्शकों से सीधे जुड़ें — "अगर आप भी...", "आपके साथ भी..."
- curiosity बनाएं लेकिन पूरी जानकारी तुरंत न दें
- 1-2 बार सवाल जरूर पूछें
- ...dots का इस्तेमाल करके ठहराव और suspense बनाएं
VOICE OVER लिखने के नियम:
- शुरुआत एक सीन या सिचुएशन से करें (जैसे: रात, खेत, घर, परेशानी)
- पहले problem और डर दिखाएं (real-life pain)
- बीच में data या fact जोड़ें credibility के लिए
- फिर धीरे-धीरे solution reveal करें
- solution को आसान भाषा में explain करें
- clear फायदे बताएं (जान बचेगी, पैसा बचेगा, सुविधा मिलेगी)
- आम आदमी से connect करें
- ...dots का हर 1-2 लाइन में इस्तेमाल करें
- अंत में strong CTA दें

Return ONLY a valid JSON object. Do not include markdown code blocks (like \`\`\`json).
Ensure all newlines in the text are properly escaped as \\n.
Use exactly this schema:
{
  "anchor": "string",
  "voiceOver": "string",
  "thumbnail": "string"
}

खबरें:
${newsContext}`;

   const completion = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `You are an expert Hindi TV news script writer. Output ONLY raw JSON. No markdown, no backticks.
STRICT RULES:
- anchor must be EXACTLY 6-8 sentences, 120-160 words. Count carefully.
- voiceOver must be EXACTLY 45-55 sentences, 600-800 words. Count carefully.
- Do NOT exceed or fall short of these limits.
- CRITICAL: DO NOT repeat the same sentences to fill the word count. Expand the story with new, relevant context instead of looping.
- Follow the prompt structure exactly: problem → ground reality → emotional connect → solution → benefit → CTA.`,
          },
          { role: "user", content: prompt },
        ],
        model: "llama-3.3-70b-versatile",
        temperature: 0.4,          
        frequency_penalty: 0.6,     
        max_tokens: 6000,           
      });
    const parsed = extractJSON(completion.choices[0].message.content);
    if (!parsed.anchor || !parsed.voiceOver) {
      throw new Error("AI response missing anchor or voiceOver fields");
    }

    console.log("SUCCESS! Long script generated.");
    return {
      anchor: parsed.anchor,
      voiceOver: parsed.voiceOver,
      thumbnail: parsed.thumbnail || "",
      scriptType: "long",
      newsIds,
    };
  },
});

// ── Task 2: Refine script via AI chat ───────────────────────────
export const refineScriptTask = task({
  id: "refine-script",
  retry: { maxAttempts: 1 },
  run: async (payload) => {
    const { anchor, voiceOver, userMessage, scriptType } = payload;
 
    const isShort = scriptType === "short";
 
    const groq = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    });
 
    const anchorWordCount = anchor.trim().split(/\s+/).length;
    const voiceOverWordCount = voiceOver ? voiceOver.trim().split(/\s+/).length : 0;
 
    // ── Build full script context ────────────────────────────────
    const scriptContext = isShort
      ? `=== CURRENT ANCHOR SCRIPT (${anchorWordCount} words) ===\n${anchor}\n=== END ===`
      : `=== CURRENT ANCHOR SCRIPT (${anchorWordCount} words) ===\n${anchor}\n=== END ===\n\n=== CURRENT VOICE OVER SCRIPT (${voiceOverWordCount} words) ===\n${voiceOver}\n=== END ===`;
 
    const lengthRules = isShort
      ? `LENGTH RULES (MANDATORY):
- Output anchor MUST be ${anchorWordCount} words (±10 words tolerance). Current is ${anchorWordCount} words.
- DO NOT reduce word count. If unsure, add a sentence rather than cutting.
- voiceOver must be empty string "".`
      : `LENGTH RULES (MANDATORY):
- Output anchor MUST be ${anchorWordCount} words (±15 words tolerance). Current is ${anchorWordCount} words.
- Output voiceOver MUST be ${voiceOverWordCount} words (±50 words tolerance). Current is ${voiceOverWordCount} words.
- DO NOT reduce word count in either section. Add sentences if needed.`;
 
    const prompt = `You are a senior Hindi TV news script editor. A user wants ONE specific change to their script. Apply ONLY that change. Keep everything else exactly the same.
 
USER REQUEST: "${userMessage}"
 
${lengthRules}
 
EDITING RULES:
- Apply ONLY what the user asked. Do not change anything else.
- Keep the same structure, facts, flow, and ...dots style.
- Keep full Hindi script throughout.
- Maintain same word count — do not shorten.
- The "changes" field: write in Hinglish (Hindi + English mix), 1-2 lines explaining what was changed and why. Example: "Opening line ko zyada punchy banaya — 'ab 10 saal ki jail' wala angle add kiya. Baaki script same rakhi."
 
${scriptContext}
 
Return ONLY raw JSON (no markdown, no backticks, no explanation):
{
  "anchor": "complete edited anchor script here",
  "voiceOver": "${isShort ? "" : "complete edited voice over script here"}",
  "changes": "Hinglish mein: kya change kiya aur kyun"
}`;
 
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a senior Hindi TV news script editor.
OUTPUT: ONLY raw JSON. No markdown. No backticks. No explanation outside JSON.
CRITICAL RULES:
1. Apply ONLY the user's requested change. Nothing else.
2. anchor output MUST match current word count of ${anchorWordCount} words (±10). Do NOT shorten.
3. ${isShort ? `voiceOver must be empty string "".` : `voiceOver output MUST match current word count of ${voiceOverWordCount} words (±50). Do NOT shorten.`}
4. If you cannot apply the change without shortening — add new sentences to compensate.
5. changes field MUST be in Hinglish (Hindi-English mix).`,
        },
        { role: "user", content: prompt },
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.35,
      frequency_penalty: 0.5,
      max_tokens: 6000,
    });
 
    const parsed = extractJSON(completion.choices[0].message.content);
 
    if (!parsed.anchor) {
      throw new Error("AI response missing anchor field");
    }
 
    const outAnchorWords = parsed.anchor.trim().split(/\s+/).length;
    const outVoiceOverWords = parsed.voiceOver ? parsed.voiceOver.trim().split(/\s+/).length : 0;
 
    console.log(`Refine done — anchor: ${outAnchorWords} words (was ${anchorWordCount}), voiceOver: ${outVoiceOverWords} words (was ${voiceOverWordCount})`);
 
    // If AI still returned something too short, fall back to original for that section only
    const finalAnchor = outAnchorWords < anchorWordCount * 0.7 ? anchor : parsed.anchor;
    const finalVoiceOver = isShort ? "" : (outVoiceOverWords < voiceOverWordCount * 0.7 ? voiceOver : parsed.voiceOver || voiceOver);
 
    return {
      anchor: finalAnchor,
      voiceOver: finalVoiceOver,
      changes: parsed.changes || "Script update ho gayi.",
    };
  },
});