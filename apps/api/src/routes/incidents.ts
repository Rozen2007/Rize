import { Router, type Request, type Response, type RequestHandler } from 'express';
import { db, incidents } from '@rize/db';
import { eq, desc } from 'drizzle-orm';
import { generateWhyNotWithTimeout } from '@rize/ai';

export const incidentsRouter: Router = Router();

incidentsRouter.get('/', (async (req: Request, res: Response) => {
  try {
    const recentIncidents = await db
      .select()
      .from(incidents)
      .orderBy(desc(incidents.createdAt))
      .limit(20);

    res.json(recentIncidents);
  } catch (error) {
    console.error('Error fetching incidents:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}) as RequestHandler);

incidentsRouter.get('/:id/explain', (async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, id as string))
      .limit(1);

    const incident = result[0];

    if (!incident) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }

    const explanation = await generateWhyNotWithTimeout(
      incident.candidatesJson,
      incident
    );
    
    res.json({ explanation });
  } catch (error) {
    console.error('Error generating explanation:', error);
    res.status(500).json({ error: 'Failed to generate explanation' });
  }
}) as RequestHandler);
