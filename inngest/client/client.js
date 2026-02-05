import { Inngest } from "inngest";

const inngest = new Inngest({
    id: "Admix-Ai-Studio",
    eventKey: "P-_4uPynWQJ_dE1978A2ZyQNBEwpDDFGsVOEMGhT4-XZ5xU9i-d-VOg2iKnG9Ij047KUUpP9LoGjkTtc-dUjIg",
    isDev: false,
    fetch: fetch.bind(globalThis)               
});

export default inngest;