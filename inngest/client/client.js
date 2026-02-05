import { Inngest } from "inngest";

const inngest = new Inngest({
    id: "Admix-Ai-Studio",
    eventKey: process.env.INNGEST_EVENT_KEY,
    isDev: false,
    fetch: fetch.bind(globalThis)               
});

console.log('====================================');
console.log('Inngest Client Initialized:', inngest.id);
console.log('Event Key Present:', !!inngest.eventKey);
console.log('====================================');

export default inngest;