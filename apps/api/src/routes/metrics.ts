import { Router, type Request, type Response } from 'express';
import { db, incidents } from '@rize/db';
import { eq, and, count, sql } from 'drizzle-orm';

export const metricsRouter: Router = Router();

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
          sql`CASE WHEN ${incidents.status} = 'RECOVERED' THEN 1 END`
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
          sql`CASE WHEN ${incidents.status} = 'RECOVERED' THEN 1 END`
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
