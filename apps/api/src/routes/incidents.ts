import { Router, type Request, type Response, type RequestHandler } from 'express';
import { db, incidents } from '@rize/db';
import { eq, desc } from 'drizzle-orm';
import { generateWhyNotWithTimeout, generateCopyWithTimeout } from '@rize/ai';
import { createRazorpayLink } from '@rize/razorpay';
import { commitAuditBlockAtomic } from '@rize/audit-ledger';

export const incidentsRouter: Router = Router();

incidentsRouter.get('/', (async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    
    let query = db.select().from(incidents).orderBy(desc(incidents.createdAt));
    
    if (status) {
      query = query.where(eq(incidents.status, status as any)) as any;
    }
    
    const recentIncidents = await query.limit(20);

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

incidentsRouter.post('/:id/approve', (async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { approvedBy } = req.body; // Who approved it (human operator name)

    // 1. Fetch incident
    const [incident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, id as string))
      .limit(1);

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    // 2. Only PENDING_APPROVAL incidents can be approved
    if (incident.status !== 'PENDING_APPROVAL') {
      return res.status(409).json({ 
        error: `Cannot approve incident with status ${incident.status}` 
      });
    }

    // 3. Create Razorpay link now
    let razorpayLinkId: string | null = null;
    let razorpayLinkUrl: string | null = null;

    try {
      const copyMsg = await generateCopyWithTimeout(
        incident.winningAction,
        incident.orderValue - (incident.discountOffered || 0)
      );
      
      const linkResult = await createRazorpayLink(
        process.env.RAZORPAY_KEY_ID || 'test',
        process.env.RAZORPAY_KEY_SECRET || 'test',
        {
          reference_id: incident.id,
          amount: incident.orderValue,
          currency: 'INR',
          accept_partial: false,
          description: copyMsg,
          customer: {
            name: 'Demo User',
            contact: incident.customerPhone || '9999999999',
            email: 'demo@example.com'
          },
          notify: { sms: true, email: false },
          reminder_enable: false,
          callback_url: 'https://example.com/callback',
          callback_method: 'get'
        }
      );
      razorpayLinkId = linkResult.id;
      razorpayLinkUrl = linkResult.short_url;
    } catch (e: any) {
      console.error('Razorpay link creation failed during approval:', e);
      return res.status(502).json({ error: 'Failed to create payment link' });
    }

    // 4. Update incident in transaction
    await db.transaction(async (tx) => {
      await tx
        .update(incidents)
        .set({
          status: 'EXECUTED_PENDING_SETTLEMENT',
          razorpayLinkId,
          razorpayLinkUrl,
          updatedAt: new Date()
        })
        .where(eq(incidents.id, id as string));

      await commitAuditBlockAtomic(tx, {
        incidentId: id as string,
        eventType: 'HUMAN_APPROVED_AND_EXECUTED',
        eniScore: incident.winningENI
      });
    });

    res.status(200).json({ 
      status: 'approved',
      razorpayLinkId,
      razorpayLinkUrl
    });
  } catch (error: any) {
    console.error('Approval endpoint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}) as RequestHandler);

incidentsRouter.post('/:id/reject', (async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // 1. Fetch incident
    const [incident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, id as string))
      .limit(1);

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    if (incident.status !== 'PENDING_APPROVAL') {
      return res.status(409).json({ 
        error: `Cannot reject incident with status ${incident.status}` 
      });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(incidents)
        .set({
          status: 'REJECTED_BY_APPROVER',
          updatedAt: new Date()
        })
        .where(eq(incidents.id, id as string));

      await commitAuditBlockAtomic(tx, {
        incidentId: id as string,
        eventType: 'HUMAN_REJECTED',
        eniScore: incident.winningENI
      });
    });

    res.status(200).json({ status: 'rejected' });
  } catch (error: any) {
    console.error('Rejection endpoint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}) as RequestHandler);
