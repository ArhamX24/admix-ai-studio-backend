import { task } from "@trigger.dev/sdk/v3";
import OpenAI from "openai";
import prisma from "../../DB/prisma.client.js";

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
ध्यान रखें:
- कोई भी लाइन बेकार या filler न हो
- हर वाक्य में value या curiosity हो

Return ONLY valid JSON (no markdown, no backticks):
{
  "anchor": "SHORT स्क्रिप्ट यहाँ — minimum 70 शब्द, maximum 110 शब्द, 5-7 वाक्य — shocking opening → जी हाँ credibility → viewer connect → news facts → twist → reason → CTA",
  "voiceOver": "",
  "thumbnail": "थंबनेल टेक्स्ट यहाँ"
}

खबरें:
${newsContext}`;

      const completion = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `You are an expert Hindi short-video script writer. Output ONLY valid JSON. No markdown, no backticks.
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
- voiceOver must always be empty string "".`,
          },
          { role: "user", content: prompt },
        ],
        model: "llama-3.3-70b-versatile",
        temperature: 0.3,
        response_format: { type: "json_object" },
      });

      const parsed = JSON.parse(completion.choices[0].message.content);
      if (!parsed.anchor) throw new Error("AI response missing anchor field");

      // Safety check — if too short, log warning (Groq ignored word count)
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
- शुरुआत हमेशा बड़े दावे, डर या राहत वाली लाइन से करें (जैसे: "अब नहीं होगी मौत...", "अब नहीं कटेगी बिजली...")
- दर्शकों से सीधे जुड़ें — "अगर आप भी...", "आपके साथ भी..."
- curiosity बनाएं लेकिन पूरी जानकारी तुरंत न दें
- 1-2 बार सवाल जरूर पूछें
- ...dots का इस्तेमाल करके ठहराव और suspense बनाएं
VOICE OVER लिखने के नियम:
- शुरुआत एक सीन या सिचुएशन से करें (जैसे: रात, खेत, घर, परेशानी)
- पहले problem और डर दिखाएं (real-life pain)
- बीच में data या fact जोड़ें credibility के लिए
- फिर धीरे-धीरे solution reveal करें (जैसे: नई योजना, नई तकनीक, सरकार का फैसला)
- solution को आसान भाषा में explain करें
- clear फायदे बताएं (जान बचेगी, पैसा बचेगा, सुविधा मिलेगी)
- आम आदमी से connect करें ("अगर आप भी...", "ऐसे में आप क्या करेंगे...")
- ...dots का हर 1-2 लाइन में इस्तेमाल करें
- अंत में strong CTA दें:
  - "वीडियो शेयर करें"
  - "कमेंट में बताएं"
  - "चैनल को फॉलो/सब्सक्राइब करें"
टोन:
- इमोशनल + जानकारीपूर्ण + थोड़ा sensational
- भाषा आसान, देसी और relatable होनी चाहिए
- स्क्रिप्ट ऐसी हो कि viewer skip न करे

Return ONLY valid JSON (no markdown, no backticks):
{
  "anchor": "ANCHOR स्क्रिप्ट — strictly 6-8 वाक्य, 120-160 शब्द",
  "voiceOver": "VOICE OVER स्क्रिप्ट — strictly 45-55 वाक्य, 600-800 शब्द",
  "thumbnail": "थंबनेल टेक्स्ट यहाँ"
}

खबरें:
${newsContext}`;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are an expert Hindi TV news script writer. Output ONLY valid JSON. No markdown, no backticks.
STRICT RULES:
- anchor must be EXACTLY 6-8 sentences, 120-160 words. Count carefully.
- voiceOver must be EXACTLY 45-55 sentences, 600-800 words. Count carefully.
- Do NOT exceed or fall short of these limits.
- Follow the prompt structure exactly: problem → ground reality → emotional connect → solution → benefit → CTA.
- Do not add your own creative additions outside the given structure.`,
        },
        { role: "user", content: prompt },
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
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

    const lengthGuard = isShort
      ? `IMPORTANT — LENGTH MUST BE PRESERVED:
- Current anchor is ~${anchorWordCount} words. Refined anchor MUST stay 70-110 शब्द (5-7 वाक्य).
- Do NOT add sentences or exceed 110 words. Do NOT shorten below 70 words.
- voiceOver must be empty string "".`
      : `IMPORTANT — LENGTH MUST BE PRESERVED:
- Current anchor is ~${anchorWordCount} words. Refined anchor MUST stay 120-160 शब्द (6-8 वाक्य).
- Current voiceOver is ~${voiceOverWordCount} words. Refined voiceOver MUST stay 600-800 शब्द (45-55 वाक्य).
- Do NOT shorten or expand beyond these limits.`;

    const scriptContext = isShort
      ? `मौजूदा SHORT/ANCHOR स्क्रिप्ट:\n${anchor}`
      : `मौजूदा ANCHOR स्क्रिप्ट:\n${anchor}\n\nमौजूदा VOICE OVER स्क्रिप्ट:\n${voiceOver}`;

    const prompt = `आप एक भारतीय हिंदी न्यूज़ चैनल के सीनियर स्क्रिप्ट एडिटर हैं।

यूजर ने नीचे की स्क्रिप्ट में बदलाव मांगा है। सिर्फ वही बदलें जो मांगा गया है — बाकी सब वैसा ही रखें।

${lengthGuard}

${scriptContext}

यूजर का निर्देश: "${userMessage}"

एडिटिंग के नियम:
- सिर्फ वही बदलें जो यूजर ने कहा — बाकी structure, facts, flow मत बदलें
- टेलीविजन ब्रॉडकास्ट स्टाइल बनाए रखें
- ...dots का प्रयोग ठहराव के लिए करें
- पूरी स्क्रिप्ट हिंदी में रहे
- LENGTH बिल्कुल वैसी ही रखें — न बढ़ाएं न घटाएं

Return ONLY valid JSON (no markdown, no backticks):
{
  "anchor": "edited anchor",
  "voiceOver": "${isShort ? "" : "edited voice over"}",
  "changes": "Hinglish mein 1-2 lines: kya change kiya aur kyun"
}`;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a senior Hindi TV news script editor. Output ONLY valid JSON. No markdown.
STRICT RULES:
- Only make the change the user asked for. Nothing else.
- Preserve exact word count and sentence count.
- ${isShort ? "voiceOver must always be empty string." : ""}
- changes field must be in Hinglish (Hindi + English mix). Example: "Opening line ko more punchy banaya, CTA strong kiya."`,
        },
        { role: "user", content: prompt },
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(completion.choices[0].message.content);

    if (!parsed.anchor) {
      throw new Error("AI response missing anchor field");
    }

    // Safety check — if too short, return original
    const refinedAnchorWords = parsed.anchor.trim().split(/\s+/).length;
    const minAnchorWords = isShort ? 50 : 100;

    if (refinedAnchorWords < minAnchorWords) {
      console.warn(`Anchor too short (${refinedAnchorWords} words). Returning original.`);
      return {
        anchor,
        voiceOver: voiceOver || "",
        changes: "Script length preserve nahi hui, isliye original rakhi gayi.",
      };
    }

    console.log("SUCCESS! Script refined. Changes:", parsed.changes);

    return {
      anchor: parsed.anchor,
      voiceOver: isShort ? "" : parsed.voiceOver || voiceOver,
      changes: parsed.changes || "Script update ho gayi.",
    };
  },
});