import { task } from "@trigger.dev/sdk/v3";
import OpenAI from "openai";
import prisma from "../../DB/prisma.client.js";

// ── Robust JSON extractor ────────────────────────────────────────
// Handles: direct JSON, markdown fences, plain text with {...}
const extractJSON = (rawText) => {
  if (!rawText || typeof rawText !== "string") {
    throw new Error("extractJSON received empty or non-string input");
  }

  const text = rawText.trim();

  // Step 1: Direct parse
  try { return JSON.parse(text); } catch (_) {}

  // Step 2: Strip markdown fences ```json ... ``` or ``` ... ```
  const fenceStripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try { return JSON.parse(fenceStripped); } catch (_) {}

  // Step 3: Extract first { ... } block
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON found. Raw: ${text.slice(0, 300)}`);

  let jsonString = match[0];

  // Step 4: Fix unescaped control chars inside string values
  jsonString = jsonString.replace(
    /"((?:[^"\\]|\\.)*)"/g,
    (m) => m.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
  );
  try { return JSON.parse(jsonString); } catch (_) {}

  // Step 5: Nuclear — strip all remaining control chars
  const cleaned = jsonString.replace(/[\x00-\x1F\x7F]/g, (c) => {
    if (c === "\n") return "\\n";
    if (c === "\r") return "\\r";
    if (c === "\t") return "\\t";
    return "";
  });
  try { return JSON.parse(cleaned); } catch (e) {
    throw new Error(`Failed to parse JSON after all attempts. Raw: ${text.slice(0, 300)}`);
  }
};

// ── Urdu → Hindi char fix ────────────────────────────────────────
const fixUrduChars = (text) => {
  if (!text) return text;
  return text
    .replace(/ہ/g, "ह").replace(/ے/g, "े").replace(/ی/g, "ी")
    .replace(/ں/g, "ं").replace(/ک/g, "क").replace(/گ/g, "ग")
    .replace(/ھ/g, "ह").replace(/چ/g, "च").replace(/ج/g, "ज")
    .replace(/ز/g, "ज़").replace(/ر/g, "र").replace(/و/g, "व")
    .replace(/ن/g, "न").replace(/م/g, "म").replace(/ل/g, "ल")
    .replace(/ق/g, "क").replace(/ف/g, "फ").replace(/ع/g, "")
    .replace(/غ/g, "ग़").replace(/خ/g, "ख").replace(/ح/g, "ह")
    .replace(/ص/g, "स").replace(/ط/g, "त").replace(/ذ/g, "ज़")
    .replace(/ث/g, "स").replace(/ض/g, "ज़").replace(/ظ/g, "ज़")
    .replace(/ء/g, "").replace(/آ/g, "आ").replace(/ا/g, "अ")
    .replace(/ب/g, "ब").replace(/پ/g, "प").replace(/ت/g, "त")
    .replace(/د/g, "द").replace(/ڈ/g, "ड").replace(/ژ/g, "झ")
    .replace(/ش/g, "श").replace(/س/g, "स").replace(/ٹ/g, "ट")
    .replace(/ڑ/g, "ड़").replace(/[\u0600-\u06FF]/g, "");
};

const countWords = (text) => (text || "").trim().split(/\s+/).filter(Boolean).length;

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

    // ✅ OpenRouter client — NO response_format, rely on extractJSON
    const openRouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    const newsContext = newsItems
      .map((n, i) => `News ${i + 1}:\nTitle: ${n.title}\nCore Facts:\n${n.hindiSummary}`)
      .join("\n\n");

    // ── SHORT ────────────────────────────────────────────────────
    if (scriptType === "short") {

      const generateShort = async (attempt = 1, previousCount = null) => {
        const retryWarning = previousCount
          ? `\n\n⚠️ RETRY ATTEMPT ${attempt}: Previous anchor was only ${previousCount} words — BELOW minimum 110. THIS IS A FAILURE. You MUST write at least 110 words. Add more sentences. Do NOT stop until you reach 110 words.`
          : "";

        const completion = await openRouter.chat.completions.create({
          messages: [
            {
              role: "system",
              // ✅ Removed response_format — just tell AI to output JSON in system prompt
              content: `You are an expert Hindi viral news short-video script writer for Indian Reels/Shorts.

OUTPUT FORMAT: You MUST respond with ONLY a raw JSON object. No markdown. No backticks. No explanation.
JSON schema exactly: { "anchor": "string", "voiceOver": "", "thumbnail": "string" }

STRICT GOAL:
Write a HIGH RETENTION spoken-Hindi short script that feels like a real Indian news reel.

ANCHOR RULES:
- Total words: MINIMUM 110, MAXIMUM 130. COUNT EVERY WORD.
- Sentences: exactly 7 to 8.
- Every sentence must end with ...
- Spoken Hindi only — natural, punchy, easy to say aloud.
- No formal or bookish language.
- No repeated idea.

RETENTION RULES (VERY IMPORTANT):
- Every 1-2 sentences MUST create a new hook, twist, or curiosity spike.
- At least 2 strong pattern interrupts are mandatory.
Examples:
"लेकिन असली बात ये नहीं है..."
"अब ध्यान से सुनिए..."
"यहीं से मामला बदल जाता है..."

STRICT FLOW:
1. Shocking opening claim
2. Credibility line ("जी हाँ..." or "ये सच है...")
3. Viewer connect ("अगर आप भी...")
4. Clear news fact
5. Twist / hidden angle
6. Why it matters to common people
7. Strong CTA

thumbnail: short punchy Hindi text (5-8 words max).${retryWarning}`,
            },
            {
              role: "user",
              content: `Write a SHORT Reels/Shorts script for this news.

CRITICAL WORD COUNT RULE: The "anchor" field MUST contain AT LEAST 110 words and NO MORE than 130 words.
Count your words before writing the JSON. If below 110 — add more sentences until you reach 110.

${newsContext}

Respond with ONLY this JSON (no markdown, no backticks, no extra text):
{ "anchor": "your 110-130 word script here", "voiceOver": "", "thumbnail": "4-7 word Hindi text" }`,
            },
          ],
          model: "openai/gpt-4o-mini",
          temperature: 0.25,
          frequency_penalty: 0.8,
          presence_penalty: 0.6,
          max_completion_tokens: 7000,
          // ✅ NO response_format — this was causing OpenRouter to return truncated output
        });

        const raw = completion.choices[0].message.content;

        return extractJSON(raw);
      };

      // First attempt
      let parsed = await generateShort(1);
      if (!parsed?.anchor) throw new Error("AI response missing anchor field");

      let wordCount = countWords(parsed.anchor);


      // Retry if below minimum
      if (wordCount < 110) {

        parsed = await generateShort(2, wordCount);
        if (!parsed?.anchor) throw new Error("AI response missing anchor field on retry");
        wordCount = countWords(parsed.anchor);

        if (wordCount < 90) {
          throw new Error(`Short script still too short after retry: ${wordCount} words. Task will retry.`);
        }
      }


      return {
        anchor: fixUrduChars(parsed.anchor),
        voiceOver: "",
        thumbnail: parsed.thumbnail || "",
        scriptType: "short",
        newsIds,
      };
    }

    // ── LONG ─────────────────────────────────────────────────────

    // Step 1 — Generate ANCHOR
    const generateAnchor = async (attempt = 1, previousCount = null) => {
      const retryWarning = previousCount
        ? `\n\n⚠️ RETRY ATTEMPT ${attempt}: Previous anchor was ${previousCount} words — BELOW minimum 110. Write MORE. Each sentence must be 15-20 words. Add more sentences until you reach 110 words.`
        : "";

      const completion = await openRouter.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `You are a Hindi TV/news reel anchor writer.

OUTPUT FORMAT: Respond with ONLY a raw JSON object. No markdown. No backticks.
JSON schema exactly: { "anchor": "string", "thumbnail": "string" }

GOAL: Write a spoken-Hindi anchor that creates suspense and forces the viewer to continue.

RULES:
- anchor: MINIMUM 110 words, MAXIMUM 130 words. COUNT EVERY WORD.
- 7 to 8 sentences only.
- Every sentence ends with ...
- Spoken Hindi only.
- Every sentence must introduce NEW information.

RETENTION RULES:
- At least 3 curiosity spikes must appear.
- At least 2 pattern interrupts are mandatory.
Examples:
"लेकिन असली बात अभी बाकी है..."
"अब सवाल ये है..."
"यहीं से कहानी बदलती है..."

STRUCTURE:
1. Big impact line
2. Viewer connect
3. Curiosity build
4. Strong question
5. Hint of reveal
6. Bigger twist
7. Hook to continue watching

thumbnail: 4-7 words, strong CTR Hindi text.${retryWarning}`,
          },
          {
            role: "user",
            content: `Write ONLY the anchor script for this news.

CRITICAL: "anchor" field MUST be between 110 and 130 words. Count your words. If below 110 — keep writing more sentences.

${newsContext}

Respond with ONLY this JSON (no markdown, no backticks):
{ "anchor": "your 110-130 word anchor here", "thumbnail": "4-7 word Hindi text" }`,
          },
        ],
        model: "openai/gpt-4o-mini",
        temperature: 0.25,
        frequency_penalty: 0.8,
        presence_penalty: 0.6,
        max_completion_tokens: 7000,
        // ✅ NO response_format
      });

      const raw = completion.choices[0].message.content;

      return extractJSON(raw);
    };

    let anchorParsed = await generateAnchor(1);
    if (!anchorParsed?.anchor) throw new Error("Anchor generation failed");

    let anchorWordCount = countWords(anchorParsed.anchor);


    if (anchorWordCount < 110) {

      anchorParsed = await generateAnchor(2, anchorWordCount);
      if (!anchorParsed?.anchor) throw new Error("Anchor generation failed on retry");
      anchorWordCount = countWords(anchorParsed.anchor);

      if (anchorWordCount < 90) {
        throw new Error(`Anchor still too short after retry: ${anchorWordCount} words. Task will retry.`);
      }
    }


    // Step 2 — Generate VOICE OVER
    const generateVoiceOver = async (attempt = 1, previousCount = null) => {
      const retryWarning = previousCount
        ? `\n\n⚠️ RETRY ATTEMPT ${attempt}: Previous voice over was only ${previousCount} words — FAR BELOW the 600 minimum. THIS IS A FAILURE. Add more sentences to EVERY step until you reach 600 words.`
        : "";

      const completion = await openRouter.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `You are an expert Hindi voice-over writer for Indian news reels and YouTube explainers.

OUTPUT FORMAT: Respond with ONLY a raw JSON object. No markdown. No backticks.
JSON schema exactly: { "voiceOver": "string" }

GOAL: Write a HIGH-RETENTION spoken Hindi voice-over.

RULES:
- voiceOver: MINIMUM 600 words, MAXIMUM 750 words. COUNT EVERY WORD.
- Spoken Hindi only. No bookish language.
- No repeated sentence or repeated idea.

RETENTION RULES:
- Every 3-4 sentences must create a fresh hook, twist, or emotional shift.
- Use pattern interrupts naturally:
"लेकिन असली बात ये नहीं है..."
"अब ध्यान से समझिए..."
"यहीं से कहानी बदलती है..."

STRUCTURE (follow all 8 steps, each step minimum 4-5 sentences):
1. Real-life opening scene
2. Problem and emotional pain
3. Why common people suffer
4. Data / credibility
5. Slow reveal of solution
6. Simple explanation
7. Benefits to ordinary people
8. Strong emotional CTA${retryWarning}`,
          },
          {
            role: "user",
            content: `Write ONLY the voice over script for this news.

CRITICAL: "voiceOver" field MUST be between 600 and 750 words. Count every word. If below 600 — add more sentences to each step.

${newsContext}

Respond with ONLY this JSON (no markdown, no backticks):
{ "voiceOver": "your 600-750 word voice over here" }`,
          },
        ],
        model: "openai/gpt-4o-mini",
        temperature: 0.35,
        frequency_penalty: 0.8,
        presence_penalty: 0.6,
        max_completion_tokens: 7000,
        // ✅ NO response_format
      });

      const raw = completion.choices[0].message.content;

      return extractJSON(raw);
    };

    let voiceOverParsed = await generateVoiceOver(1);
    if (!voiceOverParsed?.voiceOver) throw new Error("Voice over generation failed");

    let voiceOverWordCount = countWords(voiceOverParsed.voiceOver);


    if (voiceOverWordCount < 600) {

      voiceOverParsed = await generateVoiceOver(2, voiceOverWordCount);
      if (!voiceOverParsed?.voiceOver) throw new Error("Voice over generation failed on retry");
      voiceOverWordCount = countWords(voiceOverParsed.voiceOver);

      if (voiceOverWordCount < 500) {
        throw new Error(`Voice over still too short after retry: ${voiceOverWordCount} words. Task will retry.`);
      }
    }

    return {
      anchor: fixUrduChars(anchorParsed.anchor),
      voiceOver: fixUrduChars(voiceOverParsed.voiceOver),
      thumbnail: anchorParsed.thumbnail || "",
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

    const openRouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    const anchorWordCount = countWords(anchor);
    const voiceOverWordCount = countWords(voiceOver);

    const lowerMsg = userMessage.toLowerCase();
    const wantsVoiceOver =
      !isShort && (
        lowerMsg.includes("voice") || lowerMsg.includes("voiceover") ||
        lowerMsg.includes("voice over") || lowerMsg.includes("vo ") ||
        lowerMsg.includes(" vo") || lowerMsg.includes("lamba") ||
        lowerMsg.includes("longer") || lowerMsg.includes("detail") ||
        lowerMsg.includes("story") || lowerMsg.includes("लंबा") ||
        lowerMsg.includes("विस्तार")
      );

    const editVoiceOver = wantsVoiceOver;
    const sectionText = editVoiceOver ? voiceOver : anchor;
    const sectionLabel = editVoiceOver ? "VOICE OVER" : (isShort ? "SHORT/ANCHOR" : "ANCHOR");
    const sectionWordCount = editVoiceOver ? voiceOverWordCount : anchorWordCount;
    const minWords = editVoiceOver ? 600 : 110;

    const callRefine = async (attempt = 1, previousCount = null) => {
      const retryWarning = previousCount
        ? `\n\n⚠️ RETRY ATTEMPT ${attempt}: Previous output was only ${previousCount} words — BELOW minimum ${minWords}. THIS IS A FAILURE. Write MORE. Do NOT stop until you reach ${minWords} words.`
        : "";

      const prompt = editVoiceOver
        ? `You are a Hindi TV news script editor. Edit ONLY the VOICE OVER section below.

USER REQUEST: "${userMessage}"

=== CURRENT VOICE OVER (${sectionWordCount} words) ===
${sectionText}
=== END ===

EDITING RULES:
- Apply ONLY what user asked. Do not change anything else.
- Output MUST be between 600 and 750 words. Count every word.
- Keep the 8-step story structure.
- Use ... after every 1-2 sentences.
- Language: simple, emotional, conversational Hindi.
- NO repetition.
- changes field: casual Hinglish, 1-2 lines max.
${retryWarning}

Respond with ONLY this JSON (no markdown, no backticks):
{ "text": "complete 600-750 word voice over", "changes": "Hinglish mein kya change kiya" }`
        : `You are a Hindi TV news script editor. Edit ONLY the ${sectionLabel} section below.

USER REQUEST: "${userMessage}"

=== CURRENT ${sectionLabel} (${sectionWordCount} words) ===
${sectionText}
=== END ===

EDITING RULES:
- Apply ONLY what user asked. Do not change anything else.
- Output MUST be between 110 and 130 words. Count every word.
- Keep the same sentence structure and ...dots style.
- Language: simple, conversational Hindi.
- NO repetition.
- changes field: casual Hinglish, 1-2 lines max.
${retryWarning}

Respond with ONLY this JSON (no markdown, no backticks):
{ "text": "complete 110-130 word anchor", "changes": "Hinglish mein kya change kiya" }`;

      return openRouter.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `You are a senior Hindi TV news script editor.
OUTPUT FORMAT: Respond with ONLY a raw JSON object. No markdown. No backticks. No explanation.
JSON fields: "text" and "changes" only.

CRITICAL:
1. "text" MUST be ${editVoiceOver ? "600-750" : "110-130"} words. Count every word. If short — FAIL.
2. Apply ONLY what user asked.
3. "changes" in casual Hinglish only.
4. Write ONLY Devanagari Hindi. NEVER use Urdu characters.
${previousCount ? `5. PREVIOUS WAS ${previousCount} WORDS — TOO SHORT. Must write more this time.` : ""}`,
          },
          { role: "user", content: prompt },
        ],
        model: "openai/gpt-4o-mini",
        temperature: 0.35,
        frequency_penalty: 0.8,
        presence_penalty: 0.6,
        max_completion_tokens: editVoiceOver ? 7000 : 1000,
        // ✅ NO response_format
      });
    };

    let completion = await callRefine(1);
    let parsed = extractJSON(completion.choices[0].message.content);

    if (!parsed?.text) throw new Error("AI response missing text field");

    let outWords = countWords(parsed.text);

    if (outWords < minWords) {
      completion = await callRefine(2, outWords);
      parsed = extractJSON(completion.choices[0].message.content);

      if (!parsed?.text) {
        return {
          anchor: fixUrduChars(anchor),
          voiceOver: fixUrduChars(voiceOver || ""),
          changes: "Arre yaar thoda issue aa gaya — original script rakhi. Dobara try karo!",
        };
      }

      outWords = countWords(parsed.text);

      if (outWords < minWords * 0.8) {
        return {
          anchor: fixUrduChars(anchor),
          voiceOver: fixUrduChars(voiceOver || ""),
          changes: "Arre yaar thoda issue aa gaya — original script rakhi. Dobara try karo!",
        };
      }
    }

    if (editVoiceOver) {
      return {
        anchor,
        voiceOver: fixUrduChars(parsed.text),
        changes: parsed.changes || "Voice over update ho gaya!",
      };
    } else {
      return {
        anchor: fixUrduChars(parsed.text),
        voiceOver: voiceOver || "",
        changes: parsed.changes || "Anchor update ho gaya!",
      };
    }
  },
});