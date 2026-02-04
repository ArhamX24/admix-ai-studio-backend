import { Inngest } from "inngest";


const inngest = new Inngest({
    id: "Admix-Ai-Studio",
    eventKey: "fhw5juKBxwnP0h4cxvWlM0hlPmva8UOnHAFG1QVPGdkuDiDeuWFKguZTWt3uisIg8420Ksq5xJSlAZq-4lOsAA",
    baseUrl: "https://inn.gs/",
    isDev: false,
    fetch: fetch.bind(globalThis)               
});

export default inngest;