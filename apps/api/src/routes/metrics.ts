import { Router, type Request, type Response } from 'express';
import { db, incidents } from '@rize/db';
import { eq, and, count, sql, inArray } from 'drizzle-orm';

export const metricsRouter: Router = Router();

metricsRouter.get('/cohorts', async (req: Request, res: Response): Promise<any> => {
  try {
    const merchantId = 'test';
    const distinctCohorts = await db
      .selectDistinct({ cohortKey: incidents.affectedCohort })
      .from(incidents)
      .where(eq(incidents.merchantId, merchantId));

    const cohorts = distinctCohorts.map(c => c.cohortKey).filter(Boolean);
    return res.status(200).json({ cohorts });
  } catch (error: any) {
    console.error('Cohorts error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

metricsRouter.get('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const cohortKey = req.query.cohortKey as string | undefined;
    const merchantId = 'test'; // Hardcoded for now; move to auth later

    if (!cohortKey) {
      return res.status(400).json({ error: 'cohortKey query parameter required' });
    }

    // Treatment group (isControl = false): AI intervention happened
    const treatmentData = await db
      .select({
        totalAttempts: count().as('total_attempts'),
        totalRecovered: count(
          sql`CASE WHEN ${incidents.status} IN ('RECOVERED', 'EXECUTED_PENDING_SETTLEMENT') THEN 1 END`
        ).as('total_recovered'),
        totalOrderValue: sql`SUM(${incidents.orderValue})`.as('total_order_value'),
      })
      .from(incidents)
      .where(
        and(
          eq(incidents.merchantId, merchantId),
          eq(incidents.affectedCohort, cohortKey),
          eq(incidents.isControl, false)
        )
      );

    // Control group (isControl = true): Holdout, no intervention
    const controlData = await db
      .select({
        totalAttempts: count().as('total_attempts'),
        totalRecovered: count(
          sql`CASE WHEN ${incidents.status} IN ('RECOVERED', 'EXECUTED_PENDING_SETTLEMENT') THEN 1 END`
        ).as('total_recovered'),
      })
      .from(incidents)
      .where(
        and(
          eq(incidents.merchantId, merchantId),
          eq(incidents.affectedCohort, cohortKey),
          eq(incidents.isControl, true)
        )
      );

    const treatment = treatmentData[0];
    const control = controlData[0];

    // Handle empty groups
    if (!treatment || !control) {
      return res.status(404).json({
        error: 'No incidents found for this cohort',
        cohortKey,
      });
    }

    const treatmentAttempts = Number(treatment.totalAttempts) || 0;
    const treatmentRecovered = Number(treatment.totalRecovered) || 0;
    const treatmentOrderValue = Number(treatment.totalOrderValue) || 0;

    const controlAttempts = Number(control.totalAttempts) || 0;
    const controlRecovered = Number(control.totalRecovered) || 0;

    // Avoid division by zero
    if (treatmentAttempts === 0 && controlAttempts === 0) {
      return res.status(404).json({
        error: 'No incidents for this cohort',
        cohortKey,
      });
    }

    // Recovery rates
    const treatmentRate = treatmentAttempts > 0 ? treatmentRecovered / treatmentAttempts : 0;
    const controlRate = controlAttempts > 0 ? controlRecovered / controlAttempts : 0;

    // Incremental lift (the extra recovery RIZE caused)
    const incrementalRecoveryRate = treatmentRate - controlRate;
    const estimatedIncrementalGMV = Math.round(incrementalRecoveryRate * treatmentOrderValue);

    return res.status(200).json({
      cohortKey,
      control: {
        totalAttempts: controlAttempts,
        recoveries: controlRecovered,
        recoveryRate: Number(controlRate.toFixed(4)),
      },
      treatment: {
        totalAttempts: treatmentAttempts,
        recoveries: treatmentRecovered,
        recoveryRate: Number(treatmentRate.toFixed(4)),
      },
      incremental_recovery_rate: Number(incrementalRecoveryRate.toFixed(4)),
      estimated_incremental_gmv: estimatedIncrementalGMV,
    });
  } catch (error: any) {
    console.error('Metrics error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

metricsRouter.get('/summary', async (req: Request, res: Response): Promise<any> => {
  try {
    const merchantId = 'test';

    const rows = await db
      .select({
        affectedCohort: incidents.affectedCohort,
        treatmentAttempts: count(
          sql`CASE WHEN ${incidents.isControl} = false THEN 1 END`
        ).as('treatment_attempts'),
        treatmentRecovered: count(
          sql`CASE WHEN ${incidents.isControl} = false AND ${incidents.status} IN ('RECOVERED', 'EXECUTED_PENDING_SETTLEMENT') THEN 1 END`
        ).as('treatment_recovered'),
        treatmentOrderValue: sql`COALESCE(SUM(CASE WHEN ${incidents.isControl} = false THEN ${incidents.orderValue} ELSE 0 END), 0)`.as('treatment_order_value'),
        controlAttempts: count(
          sql`CASE WHEN ${incidents.isControl} = true THEN 1 END`
        ).as('control_attempts'),
        controlRecovered: count(
          sql`CASE WHEN ${incidents.isControl} = true AND ${incidents.status} IN ('RECOVERED', 'EXECUTED_PENDING_SETTLEMENT') THEN 1 END`
        ).as('control_recovered'),
      })
      .from(incidents)
      .where(eq(incidents.merchantId, merchantId))
      .groupBy(incidents.affectedCohort);

    let totalGmv = 0;
    let avgIncrementalRate = 0;
    let totalRecoveries = 0;
    let totalTreatmentAttempts = 0;
    let totalControlAttempts = 0;
    let overallTreatmentRecovered = 0;
    let overallControlRecovered = 0;
    let cohortCount = 0;

    for (const row of rows) {
      const treatmentAttempts = Number(row.treatmentAttempts) || 0;
      const treatmentRecovered = Number(row.treatmentRecovered) || 0;
      const treatmentOrderValue = Number(row.treatmentOrderValue) || 0;
      const controlAttempts = Number(row.controlAttempts) || 0;
      const controlRecovered = Number(row.controlRecovered) || 0;

      const treatmentRate = treatmentAttempts > 0 ? treatmentRecovered / treatmentAttempts : 0;
      const controlRate = controlAttempts > 0 ? controlRecovered / controlAttempts : 0;

      const incrementalRecoveryRate = treatmentRate - controlRate;
      const estimatedIncrementalGMV = Math.round(incrementalRecoveryRate * treatmentOrderValue);

      totalGmv += estimatedIncrementalGMV;
      avgIncrementalRate += incrementalRecoveryRate;
      totalRecoveries += treatmentRecovered;
      totalTreatmentAttempts += treatmentAttempts;
      totalControlAttempts += controlAttempts;
      overallTreatmentRecovered += treatmentRecovered;
      overallControlRecovered += controlRecovered;
      cohortCount++;
    }

    if (cohortCount > 0) avgIncrementalRate /= cohortCount;

    const treatmentRate = totalTreatmentAttempts > 0 ? overallTreatmentRecovered / totalTreatmentAttempts : 0;
    const controlRate = totalControlAttempts > 0 ? overallControlRecovered / totalControlAttempts : 0;

    return res.status(200).json({
      totalIncrementalGmv: totalGmv,
      averageIncrementalRate: Number(avgIncrementalRate.toFixed(4)),
      activeInterventions: totalRecoveries,
      cohortCount: cohortCount,
      overall: {
        treatmentRecoveryRate: Number(treatmentRate.toFixed(4)),
        controlRecoveryRate: Number(controlRate.toFixed(4)),
        incrementalRecoveryRate: Number((treatmentRate - controlRate).toFixed(4)),
        treatmentAttempts: totalTreatmentAttempts,
        controlAttempts: totalControlAttempts,
        treatmentRecovered: overallTreatmentRecovered,
        controlRecovered: overallControlRecovered,
      },
    });
  } catch (error: any) {
    console.error('Summary error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

metricsRouter.get('/calibration', async (req: Request, res: Response): Promise<any> => {
  try {
    // Run brier score calculation inline
    const allIncidents = await db
      .select()
      .from(incidents)
      .where(
        inArray(incidents.status, ['RECOVERED', 'EXPIRED'])
      );

    if (allIncidents.length < 10) {
      return res.status(200).json({
        brierScore: null,
        message: 'Need at least 10 incidents for calibration',
        available: allIncidents.length
      });
    }

    // Sort by predicted P_rec for decile visualization
    const sorted = [...allIncidents].sort((a, b) => a.winningPRec - b.winningPRec);

    // STEP 1: Calculate TRUE BRIER SCORE (per-incident)
    let totalSquaredError = 0;
    for (const incident of allIncidents) {
      const predicted = incident.winningPRec;
      const actual = incident.status === 'RECOVERED' ? 1 : 0;
      const squaredError = Math.pow(predicted - actual, 2);
      totalSquaredError += squaredError;
    }
    const brierScore = Number((totalSquaredError / allIncidents.length).toFixed(4));

    // STEP 2: Create decile buckets for visualization (separate from Brier)
    const decileSize = Math.ceil(sorted.length / 10);
    const buckets = [];

    for (let d = 0; d < 10; d++) {
      const start = d * decileSize;
      const end = Math.min(start + decileSize, sorted.length);
      
      if (start >= sorted.length) break;

      const decileIncidents = sorted.slice(start, end);
      const predictedP = decileIncidents.reduce((sum, inc) => sum + inc.winningPRec, 0) / decileIncidents.length;
      const recovered = decileIncidents.filter(inc => inc.status === 'RECOVERED').length;
      const actualRate = recovered / decileIncidents.length;
      
      buckets.push({
        decile: d + 1,
        predictedP: Number(predictedP.toFixed(2)),
        actualRate: Number(actualRate.toFixed(2)),
        count: decileIncidents.length
      });
    }

    return res.status(200).json({
      brierScore,  // THIS IS NOW THE CORRECT PER-INCIDENT BRIER SCORE
      calibrationBuckets: buckets,
      totalIncidents: allIncidents.length,
      interpretation: brierScore < 0.22 
        ? '✅ Well calibrated (Bayesian learner matches reality)'
        : brierScore < 0.28 
          ? '🟡 Moderately calibrated'
          : '⚠️ Poorly calibrated (needs more data)'
    });
  } catch (error: any) {
    console.error('Calibration error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});
