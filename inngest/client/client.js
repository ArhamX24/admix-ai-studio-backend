import { Inngest } from "inngest";

const inngest = new Inngest({
    id: "Admix-Ai-Studio",
    eventKey: process.env.INNGEST_EVENT_KEY
})

export default inngest