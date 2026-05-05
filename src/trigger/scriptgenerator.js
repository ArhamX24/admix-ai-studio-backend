import { task } from "@trigger.dev/sdk/v3";
import OpenAI from "openai";
import prisma from "../../DB/prisma.client.js";

const extractJSON = (rawText) => {
  // ✅ Step 1: Extract JSON object from raw text
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Failed to extract JSON. Raw: ${rawText}`);

  let jsonString = match[0];

  // ✅ Step 2: Fix bad control characters inside JSON string values
  // This replaces literal newlines/tabs inside strings with escaped versions
  jsonString = jsonString.replace(
    /"((?:[^"\\]|\\.)*)"/g,
    (match) => {
      return match
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
    }
  );

  try {
    return JSON.parse(jsonString);
  } catch (e) {
    // ✅ Step 3: Nuclear option — strip ALL control characters and retry
    const cleaned = jsonString.replace(/[\x00-\x1F\x7F]/g, (char) => {
      if (char === "\n") return "\\n";
      if (char === "\r") return "\\r";
      if (char === "\t") return "\\t";
      return ""; // remove other control chars entirely
    });

    try {
      return JSON.parse(cleaned);
    } catch (e2) {
      throw new Error(`Failed to parse JSON after cleanup. Raw: ${rawText.slice(0, 200)}`);
    }
  }
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

    const openRouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    const newsContext = newsItems
      .map(
        (n, i) =>
          `News ${i + 1}:\nTitle: ${n.title}\nFull Summary:\n${n.hindiSummary}`
      )
      .join("\n\n");

    // ── Reusable word count checker ──────────────────────────────
    const countWords = (text) => text.trim().split(/\s+/).length;

    // ── SHORT ────────────────────────────────────────────────────
    if (scriptType === "short") {

      const generateShort = async (attempt = 1, previousCount = null) => {
        const retryWarning = previousCount
          ? `\n\n⚠️ RETRY ATTEMPT ${attempt}: Your previous response was only ${previousCount} words. That is BELOW the minimum of 110 words. THIS IS A FAILURE. You MUST write at least 110 words this time. Add more sentences to each step. Do not stop until you have at least 110 words.`
          : "";

        const completion = await openRouter.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `You are an expert Hindi news short-video script writer for Indian TV/Reels.

OUTPUT: Raw JSON only. No markdown. No backticks. No explanation.
JSON schema: { "anchor": "string", "voiceOver": "", "thumbnail": "string" }

ANCHOR RULES — STRICTLY FOLLOW:
- Total words: MINIMUM 110, MAXIMUM 130. Count every single word before responding.
- If your anchor is less than 110 words — you have FAILED. Write more sentences.
- Sentences: exactly 7 to 9. Each sentence ends with ... (three dots).
- STRICT SENTENCE ORDER:
  1. Shocking opening claim — direct, no build-up (e.g. "अब 10 साल की जेल...")
  2. Credibility line — "जी हाँ..." or "ये सच है..."
  3. Viewer connect — "अगर आप भी..." or "आपके साथ भी..."
  4. News facts — what happened, who did it (2 sentences minimum)
  5. Shocking twist or hidden detail (1-2 sentences)
  6. Reason behind the news (1 sentence)
  7. Strong CTA — "वीडियो शेयर करें... कमेंट में बताएं... और फॉलो करें"
- Each sentence must be at least 12-18 words long to reach the word count.
- Language: simple, conversational Hindi. No formal or bookish words.
- NO repetition of any phrase or idea.
- voiceOver must always be empty string "".
- thumbnail: short punchy Hindi text (5-8 words max).${retryWarning}`,
            },
            {
              role: "user",
              content: `Write a SHORT Reels/Shorts script for this news.

CRITICAL: anchor MUST be between 110 and 130 words. Count your words. If below 110 — keep writing more sentences until you reach 110.

${newsContext}

Return raw JSON only. voiceOver = "".`,
            },
          ],
          model: "openai/gpt-4o-mini",
          temperature: 0.3,
          frequency_penalty: 0.8,
          presence_penalty: 0.6,
          max_completion_tokens: 7000,
          response_format: { type: "json_object" },
        });

        return extractJSON(completion.choices[0].message.content);
      };

      // First attempt
      let parsed = await generateShort(1);
      if (!parsed.anchor) throw new Error("AI response missing anchor field");

      let wordCount = countWords(parsed.anchor);
      console.log(`Short script attempt 1: ${wordCount} words`);

      // Retry if below minimum
      if (wordCount < 110) {
        console.warn(`Short script too short (${wordCount} words) — retrying...`);
        parsed = await generateShort(2, wordCount);
        if (!parsed.anchor) throw new Error("AI response missing anchor field on retry");
        wordCount = countWords(parsed.anchor);
        console.log(`Short script attempt 2: ${wordCount} words`);

        // If still too short after retry — throw so trigger retries the task
        if (wordCount < 100) {
          throw new Error(`Short script still too short after retry: ${wordCount} words. Task will retry.`);
        }
      }

      console.log(`SUCCESS! Short script generated: ${wordCount} words`);
      return {
        anchor: parsed.anchor,
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
            content: `You are a Hindi TV news anchor script writer.

OUTPUT: Raw JSON only. No markdown. No backticks.
JSON schema: { "anchor": "string", "thumbnail": "string" }

ANCHOR RULES — STRICTLY FOLLOW:
- Total words: MINIMUM 110, MAXIMUM 130. Count carefully before responding.
- If anchor is less than 110 words — you have FAILED. Add more sentences.
- Sentences: exactly 7 to 9. Each ends with ... (three dots).
- Each sentence must be at least 12-18 words long.
- Structure:
  1. Big shocking claim or relief or fear (15+ words)
  2. Direct viewer connect "अगर आप भी..." (15+ words)
  3. Build curiosity — do NOT reveal full info yet (15+ words)
  4. Ask 1 powerful question to the viewer (12+ words)
  5. Hint at the solution or twist (15+ words)
  6. More suspense — what will happen next (15+ words)
  7. Strong hook to keep watching (15+ words)
- Language: simple, emotional, relatable Hindi.
- NO repetition. Every sentence must add something new.
- thumbnail: punchy Hindi thumbnail text (5-8 words).${retryWarning}`,
          },
          {
            role: "user",
            content: `Write ONLY the anchor script for this news.

CRITICAL: anchor MUST be between 110 and 130 words. If below 110 — keep writing until you hit 110.

${newsContext}

Raw JSON only.`,
          },
        ],
        model: "openai/gpt-4o-mini",
        temperature: 0.3,
        frequency_penalty: 0.8,
        presence_penalty: 0.6,
        max_completion_tokens: 7000,
        response_format: { type: "json_object" },
      });

      return extractJSON(completion.choices[0].message.content);
    };

    // First attempt anchor
    let anchorParsed = await generateAnchor(1);
    if (!anchorParsed.anchor) throw new Error("Anchor generation failed");

    let anchorWordCount = countWords(anchorParsed.anchor);
    console.log(`Anchor attempt 1: ${anchorWordCount} words`);

    // Retry anchor if too short
    if (anchorWordCount < 110) {
      console.warn(`Anchor too short (${anchorWordCount} words) — retrying...`);
      anchorParsed = await generateAnchor(2, anchorWordCount);
      if (!anchorParsed.anchor) throw new Error("Anchor generation failed on retry");
      anchorWordCount = countWords(anchorParsed.anchor);
      console.log(`Anchor attempt 2: ${anchorWordCount} words`);

      if (anchorWordCount < 100) {
        throw new Error(`Anchor still too short after retry: ${anchorWordCount} words. Task will retry.`);
      }
    }

    console.log(`Anchor final: ${anchorWordCount} words`);

    // Step 2 — Generate VOICE OVER
    const generateVoiceOver = async (attempt = 1, previousCount = null) => {
      const retryWarning = previousCount
        ? `\n\n⚠️ RETRY ATTEMPT ${attempt}: Previous voice over was only ${previousCount} words — FAR BELOW the 600 minimum. THIS IS A FAILURE. You MUST write at least 600 words. Each step below must have MORE sentences:
- Step 1: 5 sentences minimum
- Step 2: 6 sentences minimum
- Step 3: 4 sentences minimum
- Step 4: 7 sentences minimum
- Step 5: 6 sentences minimum
- Step 6: 5 sentences minimum
- Step 7: 4 sentences minimum
- Step 8: 4 sentences minimum
Do not stop writing until you have 600 words.`
        : "";

      const completion = await openRouter.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `You are a Hindi TV news voice over script writer.

OUTPUT: Raw JSON only. No markdown. No backticks.
JSON schema: { "voiceOver": "string" }

VOICE OVER RULES — STRICTLY FOLLOW:
- Total words: MINIMUM 600, MAXIMUM 750. Count every word before responding.
- If your output is less than 600 words — you have FAILED. Keep writing more sentences.
- 8-step structure. Each step has a MINIMUM sentence count — do not skip:
  Step 1 — Open with real scene/situation: 4 sentences minimum (रात, खेत, घर, समस्या)
  Step 2 — Show problem and fear (real-life pain): 5 sentences minimum
  Step 3 — Data point or fact for credibility: 3 sentences minimum
  Step 4 — Slowly reveal solution: 6 sentences minimum
  Step 5 — Explain solution in simple language: 5 sentences minimum
  Step 6 — State clear benefits: 4 sentences minimum
  Step 7 — Common man connect "अगर आप भी...": 3 sentences minimum
  Step 8 — Strong CTA (share, comment, follow): 3 sentences minimum
- Use ... after every 1-2 sentences for pause effect.
- Language: simple, emotional, conversational Hindi. No bookish words.
- CRITICAL: Do NOT repeat any phrase or sentence. Each sentence must add NEW information.
- If you run out of story — add relevant background, historical context, or examples. Never loop.${retryWarning}`,
          },
          {
            role: "user",
            content: `Write ONLY the voice over script for this news.

CRITICAL: Output MUST be between 600 and 750 Hindi words. Count your words. If below 600 — keep writing more sentences for each step until you reach 600.

Follow all 8 steps with minimum sentence counts. No repetition allowed.

${newsContext}

Raw JSON only.`,
          },
        ],
        model: "openai/gpt-4o-mini",
        temperature: 0.35,
        frequency_penalty: 0.8,
        presence_penalty: 0.6,
        max_completion_tokens: 7000,
        response_format: { type: "json_object" },
      });

      return extractJSON(completion.choices[0].message.content);
    };

    // First attempt voice over
    let voiceOverParsed = await generateVoiceOver(1);
    if (!voiceOverParsed.voiceOver) throw new Error("Voice over generation failed");

    let voiceOverWordCount = countWords(voiceOverParsed.voiceOver);
    console.log(`Voice over attempt 1: ${voiceOverWordCount} words`);

    // Retry voice over if too short
    if (voiceOverWordCount < 600) {
      console.warn(`Voice over too short (${voiceOverWordCount} words) — retrying...`);
      voiceOverParsed = await generateVoiceOver(2, voiceOverWordCount);
      if (!voiceOverParsed.voiceOver) throw new Error("Voice over generation failed on retry");
      voiceOverWordCount = countWords(voiceOverParsed.voiceOver);
      console.log(`Voice over attempt 2: ${voiceOverWordCount} words`);

      if (voiceOverWordCount < 500) {
        throw new Error(`Voice over still too short after retry: ${voiceOverWordCount} words. Task will retry.`);
      }
    }

    console.log(`SUCCESS! Long script — anchor: ${anchorWordCount} words, voiceOver: ${voiceOverWordCount} words`);
    return {
      anchor: anchorParsed.anchor,
      voiceOver: voiceOverParsed.voiceOver,
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

    const countWords = (text) => text?.trim().split(/\s+/).length || 0;

    const anchorWordCount = countWords(anchor);
    const voiceOverWordCount = countWords(voiceOver);

    // ✅ Detect which section user wants to change
    const lowerMsg = userMessage.toLowerCase();
    const wantsVoiceOver =
      !isShort && (
        lowerMsg.includes("voice") ||
        lowerMsg.includes("voiceover") ||
        lowerMsg.includes("voice over") ||
        lowerMsg.includes("vo ") ||
        lowerMsg.includes(" vo") ||
        lowerMsg.includes("lamba") ||
        lowerMsg.includes("longer") ||
        lowerMsg.includes("detail") ||
        lowerMsg.includes("story") ||
        lowerMsg.includes("लंबा") ||
        lowerMsg.includes("विस्तार")
      );

    const editVoiceOver = wantsVoiceOver;
    const sectionText = editVoiceOver ? voiceOver : anchor;
    const sectionLabel = editVoiceOver ? "VOICE OVER" : (isShort ? "SHORT/ANCHOR" : "ANCHOR");
    const sectionWordCount = editVoiceOver ? voiceOverWordCount : anchorWordCount;

    // Minimums
    const minWords = editVoiceOver ? 600 : 110;
    const maxWords = editVoiceOver ? 750 : 130;

    // ── Reusable refine call ─────────────────────────────────────
    const callRefine = async (attempt = 1, previousCount = null) => {
      const retryWarning = previousCount
        ? `\n\n⚠️ RETRY ATTEMPT ${attempt}: Your previous output was only ${previousCount} words — BELOW the minimum of ${minWords} words. THIS IS A FAILURE.
        ${editVoiceOver
          ? `You MUST write at least 600 words for voice over. Add more sentences to each step:
        - Step 1: 5 sentences minimum
        - Step 2: 6 sentences minimum
        - Step 3: 4 sentences minimum
        - Step 4: 7 sentences minimum
        - Step 5: 6 sentences minimum
        - Step 6: 5 sentences minimum
        - Step 7: 4 sentences minimum
        - Step 8: 4 sentences minimum`
          : `You MUST write at least 110 words for anchor. Each sentence must be 12-18 words long. Add more sentences.`
        }
        Do not stop writing until you reach ${minWords} words.` : "";

      const prompt = editVoiceOver
        ? `You are a Hindi TV news script editor. Edit ONLY the VOICE OVER section below.

      USER REQUEST: "${userMessage}"

      === CURRENT VOICE OVER (${sectionWordCount} words) ===
      ${sectionText}
      === END ===

    EDITING RULES:
    - Apply ONLY what user asked. Do not change anything else.
    - Output MUST be between 600 and 750 words. Count every word before responding.
    - If output is less than 600 words — you FAILED. Keep writing.
    - Keep the 8-step story structure: scene → problem → data → solution → benefits → connect → CTA
    - Use ... after every 1-2 sentences for pause effect.
    - Language: simple, emotional, conversational Hindi.
    - NO repetition. Each sentence must add new information.
    - changes field: casual Hinglish, 1-2 lines max. Example: "Voice over ki story ko aur emotional banaya, problem wala part expand kiya."
    ${retryWarning}

    Return ONLY raw JSON:
    {
      "text": "complete edited voice over — must be 600-750 words",
      "changes": "Hinglish mein: kya change kiya aur kyun"
    }`
            : `You are a Hindi TV news script editor. Edit ONLY the ${sectionLabel} section below.

    USER REQUEST: "${userMessage}"

      === CURRENT ${sectionLabel} (${sectionWordCount} words) ===
      ${sectionText}
      === END ===

    EDITING RULES:
    - Apply ONLY what user asked. Do not change anything else.
    - Output MUST be between 110 and 130 words. Count every word before responding.
    - If output is less than 110 words — you FAILED. Add more sentences.
    - Each sentence must be 12-18 words long.
    - Keep the same sentence structure and ...dots style.
    - Language: simple, conversational Hindi.
    - NO repetition. Each sentence must add new information.
    - changes field: casual Hinglish, 1-2 lines max. Example: "Opening line ko punchy kar diya, twist add kiya."
    ${retryWarning}

    Return ONLY raw JSON:
    {
      "text": "complete edited ${sectionLabel} — must be 110-130 words",
      "changes": "Hinglish mein: kya change kiya aur kyun"
    }`;

      return openRouter.chat.completions.create({
        messages: [
          {
          role: "system",
          content: `You are a senior Hindi TV news script editor.
          OUTPUT: Raw JSON only. No markdown. No backticks.
          JSON fields: "text" and "changes" only.

          CRITICAL RULES:
          1. Edit ONLY the section provided. Do not touch any other section.
          2. ${editVoiceOver
            ? `"text" MUST be 600-750 words. If less than 600 — you FAILED. Add sentences.`
            : `"text" MUST be 110-130 words. If less than 110 — you FAILED. Add sentences.`
          }
          3. Apply ONLY what the user asked. Nothing else.
          4. "changes" MUST be in casual Hinglish — short, friendly. NOT formal Hindi.
          5. No repetition of phrases or sentences.
          6. CRITICAL: Write ONLY in Devanagari Hindi script. NEVER use Urdu/Nastaliq characters like ہ ے ی ں ک گ etc. If you use any Urdu characters — you have FAILED.
          ${previousCount ? `7. PREVIOUS ATTEMPT WAS ${previousCount} WORDS — TOO SHORT. This attempt MUST be longer.` : ""}`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        model: "openai/gpt-4o-mini",
        temperature: 0.35,
        frequency_penalty: 0.8,
        presence_penalty: 0.6,
        max_completion_tokens: editVoiceOver ? 7000 : 1000,
        response_format: { type: "json_object" },
      });
    };

    // ── First attempt ────────────────────────────────────────────
    let completion = await callRefine(1);
    let parsed = extractJSON(completion.choices[0].message.content);

    if (!parsed.text) {
      throw new Error("AI response missing text field");
    }

    let outWords = countWords(parsed.text);
    console.log(`Refine attempt 1 — ${sectionLabel}: ${outWords} words (original: ${sectionWordCount})`);

    // ── Retry if too short ───────────────────────────────────────
    if (outWords < minWords) {
      console.warn(`Refine output too short (${outWords} words, min ${minWords}) — retrying...`);

      completion = await callRefine(2, outWords);
      parsed = extractJSON(completion.choices[0].message.content);

      if (!parsed.text) {
        // ✅ If retry also fails to parse — return original silently, no error to user
        console.warn("Retry parse failed — returning original");
        return {
          anchor,
          voiceOver: voiceOver || "",
          changes: "Arre yaar thoda issue aa gaya — original script rakhi. Dobara try karo!",
        };
      }

      outWords = countWords(parsed.text);
      console.log(`Refine attempt 2 — ${sectionLabel}: ${outWords} words`);

      // ✅ If retry still too short — use original for that section, no error thrown
      if (outWords < minWords * 0.8) {
        console.warn(`Retry still too short (${outWords} words) — returning original for ${sectionLabel}`);
        return {
          anchor,
          voiceOver: voiceOver || "",
          changes: "Yaar AI ne thoda chhota likh diya — original hi rakhi. Ek baar aur try karo!",
        };
      }
    }

    console.log(`Refine SUCCESS — ${sectionLabel}: ${outWords} words. Changes: ${parsed.changes}`);

    // ✅ Return only edited section — other section untouched
    if (editVoiceOver) {
      return {
        anchor,                          // ✅ untouched
        voiceOver: parsed.text,
        changes: parsed.changes || "Voice over update ho gaya!",
      };
    } else {
      return {
        anchor: parsed.text,
        voiceOver: voiceOver || "",      // ✅ untouched
        changes: parsed.changes || "Anchor update ho gaya!",
      };
    }
  },
});