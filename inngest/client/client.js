import { Inngest } from "inngest";

const inngest = new Inngest({
    id: "Admix-Ai-Studio",
    eventKey: "P-_4uPynWQJ_dE1978A2ZyQNBEwpDDFGsVOEMGhT4-XZ5xU9i-d-VOg2iKnG9Ij047KUUpP9LoGjkTtc-dUjIg",
    isDev: false,
    fetch: fetch.bind(globalThis)               
});

console.log('====================================');
console.log('Inngest Client Initialized:', inngest.id);
console.log('Event Key Present:', !!inngest.eventKey);
console.log('Event Key:', inngest.eventKey); // Full key for testing
console.log('Event Key Length:', inngest.eventKey?.length);
console.log('====================================');

export default inngest;