import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { db, incidents } from '@rize/db';
import { sql } from 'drizzle-orm';

interface CalibrationBucket {
  decile: number;
  predictedP: number;
  actualRate: number;
  count: number;
  error: number; // (predictedP - actualRate)²
}

async function calculateBrierScore() {
  // 1. Fetch all non-control, non-skipped incidents
  const allIncidents = await db.select().from(incidents).where(
    sql`status IN ('RECOVERED', 'EXPIRED', 'EXECUTED_PENDING_SETTLEMENT')`
  );

  if (allIncidents.length === 0) {
    console.log('No incidents to calibrate');
    process.exit(0);
  }

  // 2. Sort by winningPRec (predicted recovery probability)
  allIncidents.sort((a, b) => a.winningPRec - b.winningPRec);

  // 3. Split into deciles (10 equal groups)
  const decileSize = Math.ceil(allIncidents.length / 10);
  const buckets: CalibrationBucket[] = [];
  let totalBrierError = 0;

  for (let d = 0; d < 10; d++) {
    const start = d * decileSize;
    const end = Math.min(start + decileSize, allIncidents.length);
    
    if (start >= allIncidents.length) break;

    const decileIncidents = allIncidents.slice(start, end);
    
    // Average predicted P for this decile
    const predictedP = decileIncidents.reduce((sum, inc) => sum + inc.winningPRec, 0) / decileIncidents.length;
    
    // Actual recovery rate (count of RECOVERED / total)
    const recovered = decileIncidents.filter(inc => inc.status === 'RECOVERED').length;
    const actualRate = recovered / decileIncidents.length;
    
    // Brier error for this bucket
    const bucketError = Math.pow(predictedP - actualRate, 2);
    totalBrierError += bucketError;

    buckets.push({
      decile: d + 1,
      predictedP: Math.round(predictedP * 100) / 100, // 2 decimals
      actualRate: Math.round(actualRate * 100) / 100,
      count: decileIncidents.length,
      error: Math.round(bucketError * 10000) / 10000 // 4 decimals
    });
  }

  // 4. Calculate overall Brier Score
  const brierScore = totalBrierError / buckets.length;

  // 5. Output
  const result = {
    brierScore: Math.round(brierScore * 10000) / 10000,
    calibrationBuckets: buckets,
    totalIncidents: allIncidents.length,
    interpretation: brierScore < 0.15 
      ? 'Well calibrated' 
      : brierScore < 0.25 
        ? 'Moderately calibrated'
        : 'Poorly calibrated'
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

calculateBrierScore().catch(console.error);
