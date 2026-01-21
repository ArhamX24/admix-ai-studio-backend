import inngest from "../client/client.js";
import prisma from "../../DB/prisma.client.js";
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_PROJECT_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const cleanupOldRecordsFunction = inngest.createFunction(
  { id: "cleanup-old-records" },
  { cron: "0 2 * * *" },
  async ({ step }) => {
    const scriptsDeleted = await step.run("delete-old-scripts", async () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      const oldScripts = await prisma.script.findMany({
        where: {
          isVoiceGenerated: true,
          updatedAt: { lt: tenDaysAgo },
        },
      });

      if (oldScripts.length > 0) {
        await prisma.script.deleteMany({
          where: { id: { in: oldScripts.map(s => s.id) } },
        });
      }

      return oldScripts.length;
    });

    const speechesDeleted = await step.run("delete-expired-speeches", async () => {
      const now = new Date();

      const expiredSpeeches = await prisma.speechHistory.findMany({
        where: { expiresAt: { lt: now } },
      });

      for (const speech of expiredSpeeches) {
        if (speech.audioFilePath) {
          try {
            const url = new URL(speech.audioFilePath);
            const pathParts = url.pathname.split('/storage/v1/object/public/speech-audio/');
            const filePath = pathParts[1];
            
            if (filePath) {
              await supabase.storage.from('speech-audio').remove([filePath]);
            }
          } catch (err) {
            console.warn(`Could not delete audio file: ${err.message}`);
          }
        }
      }

      if (expiredSpeeches.length > 0) {
        await prisma.speechHistory.deleteMany({
          where: { id: { in: expiredSpeeches.map(s => s.id) } },
        });
      }

      return expiredSpeeches.length;
    });

    return { scriptsDeleted, speechesDeleted, timestamp: new Date().toISOString() };
  }
);
