import { Inngest } from "inngest";

// Optional: Add a check to see if the key is actually there
if (process.env.NODE_ENV === "production" && !process.env.INNGEST_EVENT_KEY) {
    console.error("CRITICAL: INNGEST_EVENT_KEY is missing in production!");
}

const inngest = new Inngest({
    id: "Admix-Ai-Studio",
    // Explicitly fallback to an empty string to prevent "undefined" errors
    eventKey: "fhw5juKBxwnP0h4cxvWlM0hlPmva8UOnHAFG1QVPGdkuDiDeuWFKguZTWt3uisIg8420Ksq5xJSlAZq-4lOsAA"
});

export default inngest;