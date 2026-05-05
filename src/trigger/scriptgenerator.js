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

// ✅ Replace common Urdu characters with their Hindi Devanagari equivalents
const fixUrduChars = (text) => {
  if (!text) return text;
  return text
    // Common Urdu letter substitutions that slip into Hindi
    .replace(/ہ/g, "ह")    // ha
    .replace(/ے/g, "े")    // e matra
    .replace(/ی/g, "ी")    // ee matra  
    .replace(/ں/g, "ं")    // anusvara
    .replace(/ک/g, "क")    // ka
    .replace(/گ/g, "ग")    // ga
    .replace(/ھ/g, "ह")    // ha (aspirated)
    .replace(/چ/g, "च")    // cha
    .replace(/ج/g, "ज")    // ja
    .replace(/ز/g, "ज़")   // za
    .replace(/ر/g, "र")    // ra
    .replace(/و/g, "व")    // va
    .replace(/ن/g, "न")    // na
    .replace(/م/g, "म")    // ma
    .replace(/ل/g, "ल")    // la
    .replace(/ق/g, "क")    // qa
    .replace(/ف/g, "फ")    // fa
    .replace(/ع/g, "")     // ain — no Hindi equivalent, remove
    .replace(/غ/g, "ग़")   // gha
    .replace(/خ/g, "ख")    // kha
    .replace(/ح/g, "ह")    // ha
    .replace(/ص/g, "स")    // sa
    .replace(/ط/g, "त")    // ta
    .replace(/ذ/g, "ज़")   // za
    .replace(/ث/g, "स")    // sa
    .replace(/ض/g, "ज़")   // za
    .replace(/ظ/g, "ज़")   // za
    .replace(/ء/g, "")     // hamza — remove
    .replace(/آ/g, "आ")    // aa
    .replace(/ا/g, "अ")    // a
    .replace(/ب/g, "ब")    // ba
    .replace(/پ/g, "प")    // pa
    .replace(/ت/g, "त")    // ta
    .replace(/د/g, "द")    // da
    .replace(/ڈ/g, "ड")    // da
    .replace(/ژ/g, "झ")    // jha
    .replace(/ش/g, "श")    // sha
    .replace(/س/g, "स")    // sa
    .replace(/ٹ/g, "ट")    // ta
    .replace(/ڑ/g, "ड़")   // ra
    .replace(/ڈ/g, "ड")    // da
    // Clean up any remaining Arabic/Urdu Unicode block chars (U+0600 to U+06FF)
    .replace(/[\u0600-\u06FF]/g, "");
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
          `News ${i + 1}:\nTitle: ${n.title}\nCore Facts:\n${n.hindiSummary}`
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
              content: `You are an expert Hindi viral news short-video script writer for Indian Reels/Shorts.

              OUTPUT: Raw JSON only. No markdown. No backticks.
              JSON schema: { "anchor": "string", "voiceOver": "", "thumbnail": "string" }

              STRICT GOAL:
              Write a HIGH RETENTION spoken-Hindi short script that feels like a real Indian news reel.

          ANCHOR RULES:
          - Total words: 110 to 130 only.
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
        - thumbnail: short punchy Hindi text (5-8 words max).${retryWarning}`,
            },
            {
              role: "user",
              content: `Write a SHORT Reels/Shorts script for this news.
        This must sound like a viral spoken news reel — not like a newspaper summary.
        CRITICAL: anchor MUST be between 110 and 130 words. Count your words. If below 110 — keep writing more sentences until you reach 110.

        ${newsContext}

        Return raw JSON only. voiceOver = "".
        thumbnail: 4-7 words, high CTR Hindi text.`,
            },
          ],
          model: "openai/gpt-4o-mini",
          temperature: 0.25,
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

          OUTPUT: Raw JSON only.
          JSON schema: { "anchor": "string", "thumbnail": "string" }

          GOAL:
          Write a spoken-Hindi anchor that creates suspense and forces the viewer to continue.

          RULES:
          - 110 to 130 words only.
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

          IMPORTANT:
          Do NOT sound like a newspaper.
          Do NOT summarize the whole news.
          Reveal only enough to keep watching.

          thumbnail: 4-7 words, strong CTR Hindi text.${retryWarning}`,
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
        temperature: 0.25,
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
            content: `You are an expert Hindi voice-over writer for Indian news reels and YouTube explainers.

            OUTPUT: Raw JSON only.
            JSON schema: { "voiceOver": "string" }

            GOAL:
            Write a HIGH-RETENTION spoken Hindi voice-over.
            It should feel cinematic, emotional, and easy to speak aloud.

            RULES:
            - 600 to 750 words.
            - Spoken Hindi only.
            - No bookish language.
            - No repeated sentence or repeated idea.

            VERY IMPORTANT RETENTION RULES:
            - Every 3-4 sentences must create a fresh hook, twist, or emotional shift.
            - Use pattern interrupts naturally:
            "लेकिन असली बात ये नहीं है..."
            "अब ध्यान से समझिए..."
            "यहीं से कहानी बदलती है..."
            "लेकिन यहां एक बड़ा सवाल उठता है..."

            STRUCTURE:
            1. Real-life opening scene
            2. Problem and emotional pain
            3. Why common people suffer
            4. Data / credibility
            5. Slow reveal of solution
            6. Simple explanation
            7. Benefits to ordinary people
            8. Strong emotional CTA

            CRITICAL:
            - This must sound spoken, not written.
            - Every paragraph must feel like the story is moving forward.
            - Never explain everything at once.
            - Keep revealing information gradually.

            If story becomes simple, add:
            - practical example
            - real-world effect
            - emotional consequence

            Do not write like a report.
            Write like a viral voice-over.
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
          anchor: fixUrduChars(anchor),
          voiceOver: fixUrduChars(voiceOver || ""),
          changes: "Arre yaar thoda issue aa gaya — original script rakhi. Dobara try karo!",
        };
      }

      outWords = countWords(parsed.text);
      console.log(`Refine attempt 2 — ${sectionLabel}: ${outWords} words`);

      // ✅ If retry still too short — use original for that section, no error thrown
      if (outWords < minWords * 0.8) {
        console.warn(`Retry still too short (${outWords} words) — returning original for ${sectionLabel}`);
        return {
          anchor: fixUrduChars(anchor),
          voiceOver: fixUrduChars(voiceOver || ""),
          changes: "Arre yaar thoda issue aa gaya — original script rakhi. Dobara try karo!",
        };
      }
    }

    console.log(`Refine SUCCESS — ${sectionLabel}: ${outWords} words. Changes: ${parsed.changes}`);

      if (editVoiceOver) {
        return {
          anchor,
          voiceOver: fixUrduChars(parsed.text),  // ✅ clean Urdu chars
          changes: parsed.changes || "Voice over update ho gaya!",
        };
      } else {
        return {
          anchor: fixUrduChars(parsed.text),     // ✅ clean Urdu chars
          voiceOver: voiceOver || "",
          changes: parsed.changes || "Anchor update ho gaya!",
        };
      }
        },
});