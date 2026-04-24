import { task } from "@trigger.dev/sdk/v3";
import OpenAI from "openai";
import prisma from "../../DB/prisma.client.js";


// ── Task 1: Generate script from selected news IDs ──────────────
export const generateScriptTask = task({
  id: "generate-script",
  retry: { maxAttempts: 3 },
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

    // ── SHORT: only anchor, viral reel/shorts style ──────────────
    if (scriptType === "short") {
      const lengthInstruction = `स्क्रिप्ट छोटी, तेज और वायरल होनी चाहिए।
ANCHOR/SHORT: 14-20 वाक्य (110-140 शब्द) — शुरुआत में जोरदार दावा, तुरंत attention grab करे, अंत में CTA जरूर हो।`;

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
  "anchor": "SHORT स्क्रिप्ट यहाँ (14-20 वाक्य, 110-140 शब्द)",
  "voiceOver": "",
  "thumbnail": "थंबनेल टेक्स्ट यहाँ"
}

खबरें:
${newsContext}`;

      const completion = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content:
              "You are an expert Hindi short-video script writer. Output ONLY valid JSON. No markdown, no backticks. voiceOver field must always be an empty string for short scripts.",
          },
          { role: "user", content: prompt },
        ],
        model: "llama-3.3-70b-versatile",
        temperature: 0.4,
        response_format: { type: "json_object" },
      });

      const parsed = JSON.parse(completion.choices[0].message.content);

      if (!parsed.anchor) throw new Error("AI response missing anchor field");

      console.log("SUCCESS! Short script generated for newsIds:", newsIds);

      return {
        anchor: parsed.anchor,
        voiceOver: "",
        thumbnail: parsed.thumbnail || "",
        scriptType: "short",
        newsIds,
      };
    }

    // ── LONG: anchor + full voice over ───────────────────────────
    const lengthInstruction = `स्क्रिप्ट लंबी, डिटेल और स्टोरी-ड्रिवन होनी चाहिए।
ANCHOR: 12-16 वाक्य (160-200 शब्द) — शुरुआत में बड़ा दावा / राहत / खतरे की बात, curiosity build करे, viewer को रोके।
VOICE OVER: 55-65 वाक्य (700-900 शब्द) — पूरी कहानी के flow में: problem → ground reality → emotional connect → solution → फायदा → CTA, ...dots भरपूर उपयोग।`;

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
  "anchor": "ANCHOR स्क्रिप्ट यहाँ (12-16 वाक्य, 160-200 शब्द)",
  "voiceOver": "VOICE OVER स्क्रिप्ट यहाँ (55-65 वाक्य, 700-800 शब्द)",
  "thumbnail": "थंबनेल टेक्स्ट यहाँ"
}

खबरें:
${newsContext}`;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "You are an expert Hindi TV news script writer. Output ONLY valid JSON. No markdown, no backticks. Always meet the word count requirements specified in the prompt.",
        },
        { role: "user", content: prompt },
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.4,
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(completion.choices[0].message.content);

    if (!parsed.anchor || !parsed.voiceOver) {
      throw new Error("AI response missing anchor or voiceOver fields");
    }

    console.log("SUCCESS! Long script generated for newsIds:", newsIds);

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
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    const { anchor, voiceOver, userMessage, scriptType } = payload;

    const isShort = scriptType === "short";

     const groq = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    });

    // Count approximate words in current script to preserve length
    const anchorWordCount = anchor.trim().split(/\s+/).length;
    const voiceOverWordCount = voiceOver ? voiceOver.trim().split(/\s+/).length : 0;

    const lengthGuard = isShort
      ? `IMPORTANT — LENGTH MUST BE PRESERVED:
- Current anchor is ~${anchorWordCount} words. Your refined anchor MUST stay between 70-110 शब्द (5-7 वाक्य).
- Do NOT shorten the script. Only improve quality, tone, style as instructed.
- voiceOver field must be an empty string "".`
      : `IMPORTANT — LENGTH MUST BE PRESERVED:
- Current anchor is ~${anchorWordCount} words. Your refined anchor MUST stay between 120-160 शब्द (6-8 वाक्य).
- Current voiceOver is ~${voiceOverWordCount} words. Your refined voiceOver MUST stay between 600-800 शब्द (45-55 वाक्य).
- Do NOT shorten or cut the script. Only improve quality, tone, style as instructed.
- If you shorten the script, the task is considered FAILED.`;

    const scriptContext = isShort
      ? `मौजूदा SHORT/ANCHOR स्क्रिप्ट:
${anchor}`
      : `मौजूदा ANCHOR स्क्रिप्ट:
${anchor}

मौजूदा VOICE OVER स्क्रिप्ट:
${voiceOver}`;

    const prompt = `आप एक भारतीय हिंदी न्यूज़ चैनल के सीनियर स्क्रिप्ट एडिटर हैं।

यूजर ने नीचे की स्क्रिप्ट में बदलाव मांगा है। स्क्रिप्ट की quality, tone और style को यूजर के निर्देश के अनुसार improve करें।

${lengthGuard}

${scriptContext}

यूजर का निर्देश: "${userMessage}"

एडिटिंग के नियम:
- यूजर के निर्देश को ध्यान से पढ़ें — सिर्फ वही बदलें जो मांगा गया है
- बाकी स्क्रिप्ट का structure, facts और flow बनाए रखें
- टेलीविजन ब्रॉडकास्ट स्टाइल बनाए रखें
- ...dots का प्रयोग ठहराव के लिए करें
- पूरी स्क्रिप्ट हिंदी में रहे
- LENGTH PRESERVE करना अनिवार्य है — छोटा मत करें

Return ONLY valid JSON (no markdown, no backticks):
{
  "anchor": "edited anchor script",
  "voiceOver": "${isShort ? "" : "edited voice over script"}",
  "changes": "1-2 line mein batao kya changes kiye, Hinglish mein (mix of Hindi + English)"
}`;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a senior Hindi TV news script editor. Output ONLY valid JSON. No markdown.
        CRITICAL: Never shorten the script. Always preserve or expand the length. ${isShort ? "voiceOver must always be an empty string." : ""}
        IMPORTANT: The "changes" field must ALWAYS be written in Hinglish (mix of Hindi and English) — for example: "Anchor ki opening line ko more punchy banaya, aur ending mein ek strong CTA add kiya." Never write changes in pure Hindi or pure English.`,
        },
        { role: "user", content: prompt },
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(completion.choices[0].message.content);

    if (!parsed.anchor) {
      throw new Error("AI response missing anchor field");
    }

    // Safety check — if AI returned something way shorter, reject and return original
    const refinedAnchorWords = parsed.anchor.trim().split(/\s+/).length;
    const minAnchorWords = isShort ? 50 : 100;

    if (refinedAnchorWords < minAnchorWords) {
      console.warn(
        `Refine task returned too-short anchor (${refinedAnchorWords} words). Returning original.`
      );
      return {
        anchor,
        voiceOver: voiceOver || "",
        changes: "AI ने स्क्रिप्ट को बहुत छोटा कर दिया था, इसलिए मूल स्क्रिप्ट रखी गई।",
      };
    }

    console.log("SUCCESS! Script refined. Changes:", parsed.changes);

    return {
      anchor: parsed.anchor,
      voiceOver: isShort ? "" : parsed.voiceOver || voiceOver,
      changes: parsed.changes || "स्क्रिप्ट अपडेट कर दी गई है।",
    };
  },
});