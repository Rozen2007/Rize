import { db, incidents } from '@rize/db';
import { eq } from 'drizzle-orm';

async function run() {
  const allIncidents = await db.select().from(incidents);
  let updated = 0;
  for (const inc of allIncidents) {
    if (inc.smsCopy && inc.smsCopy.includes('$')) {
      const newCopy = inc.smsCopy.replace(/\$/g, '₹');
      await db.update(incidents).set({ smsCopy: newCopy }).where(eq(incidents.id, inc.id));
      updated++;
    }
  }
  console.log(`Fixed ${updated} incidents in DB.`);
  process.exit(0);
}
run();
