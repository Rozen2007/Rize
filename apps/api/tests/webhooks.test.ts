import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { webhooksRouter } from '../src/routes/webhooks.js';
import * as rizeRazorpay from '@rize/razorpay';
import * as rizeAuditLedger from '@rize/audit-ledger';
import { db, incidents, processedWebhookEvents } from '@rize/db';

// Mock dependencies
vi.mock('@rize/razorpay', () => ({
  verifyWebhookSignature: vi.fn()
}));
vi.mock('@rize/audit-ledger', () => ({
  commitAuditBlockAtomic: vi.fn().mockResolvedValue(true)
}));

// Mock DB
const mockInsertResult = { rowCount: 1 };
const mockInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockReturnValue({
    onConflictDoNothing: vi.fn().mockResolvedValue(mockInsertResult)
  })
});
const mockSelect = vi.fn().mockReturnValue({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue([{ 
      id: 'inc_123', 
      status: 'PENDING', 
      winningENI: 50.25 
    }])
  })
});
const mockUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(true)
  })
});

const mockTx = {
  insert: mockInsert,
  select: mockSelect,
  update: mockUpdate
};

vi.mock('@rize/db', () => ({
  db: {
    transaction: vi.fn().mockImplementation(async (cb: any) => cb(mockTx))
  },
  incidents: { id: 'id_col' },
  processedWebhookEvents: { eventId: 'eventId_col' }
}));

// Setup Express app
const app = express();
// Mock env variable
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_secret';
app.use('/webhooks', webhooksRouter);

describe('POST /webhooks/razorpay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertResult.rowCount = 1;
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ 
          id: 'inc_123', 
          status: 'PENDING', 
          winningENI: 50.25 
        }])
      })
    });
    (rizeRazorpay.verifyWebhookSignature as any).mockReturnValue(true);
  });

  const createPayload = (event: string, incidentId?: string) => ({
    event,
    payload: {
      payment_link: {
        entity: {
          notes: {
            ...(incidentId ? { incidentId } : {})
          }
        }
      }
    }
  });

  it('5.I: Missing X-Razorpay-Signature header returns 400', async () => {
    const res = await request(app)
      .post('/webhooks/razorpay')
      .set('x-razorpay-event-id', 'evt_123')
      .send(createPayload('payment_link.paid', 'inc_123'));
    
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing required Razorpay headers');
  });

  it('5.C: Invalid signature returns 400', async () => {
    (rizeRazorpay.verifyWebhookSignature as any).mockReturnValue(false);

    const res = await request(app)
      .post('/webhooks/razorpay')
      .set('x-razorpay-event-id', 'evt_123')
      .set('x-razorpay-signature', 'invalid_sig')
      .send(createPayload('payment_link.paid', 'inc_123'));
    
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid signature');
  });

  it('5.D: Duplicate event ID is ignored, returns 200', async () => {
    mockInsertResult.rowCount = 0; // Simulate conflict

    const res = await request(app)
      .post('/webhooks/razorpay')
      .set('x-razorpay-event-id', 'evt_dup')
      .set('x-razorpay-signature', 'valid_sig')
      .send(createPayload('payment_link.paid', 'inc_123'));
    
    expect(res.status).toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(rizeAuditLedger.commitAuditBlockAtomic).not.toHaveBeenCalled();
  });

  it('5.F: Missing incidentId in webhook notes returns 200', async () => {
    const res = await request(app)
      .post('/webhooks/razorpay')
      .set('x-razorpay-event-id', 'evt_123')
      .set('x-razorpay-signature', 'valid_sig')
      .send(createPayload('payment_link.paid')); // Missing incidentId
    
    expect(res.status).toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('5.G: Incident not found in DB returns 200', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]) // Returns empty array
      })
    });

    const res = await request(app)
      .post('/webhooks/razorpay')
      .set('x-razorpay-event-id', 'evt_123')
      .set('x-razorpay-signature', 'valid_sig')
      .send(createPayload('payment_link.paid', 'inc_not_found'));
    
    expect(res.status).toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('5.E: Already-RECOVERED incident doesn\'t update again', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ 
          id: 'inc_123', 
          status: 'RECOVERED', // Terminal state
          winningENI: 50.25 
        }])
      })
    });

    const res = await request(app)
      .post('/webhooks/razorpay')
      .set('x-razorpay-event-id', 'evt_123')
      .set('x-razorpay-signature', 'valid_sig')
      .send(createPayload('payment_link.paid', 'inc_123'));
    
    expect(res.status).toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('5.A: Valid webhook.paid updates incident to RECOVERED and 5.H writes audit block', async () => {
    const res = await request(app)
      .post('/webhooks/razorpay')
      .set('x-razorpay-event-id', 'evt_paid')
      .set('x-razorpay-signature', 'valid_sig')
      .send(createPayload('payment_link.paid', 'inc_123'));
    
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
    const updateArg = mockUpdate().set.mock.calls[0][0];
    expect(updateArg.status).toBe('RECOVERED');

    expect(rizeAuditLedger.commitAuditBlockAtomic).toHaveBeenCalledWith(mockTx, {
      incidentId: 'inc_123',
      eventType: 'RECOVERED',
      eniScore: 50.25
    });
  });

  it('5.B: Valid webhook.expired updates incident to EXPIRED', async () => {
    const res = await request(app)
      .post('/webhooks/razorpay')
      .set('x-razorpay-event-id', 'evt_expired')
      .set('x-razorpay-signature', 'valid_sig')
      .send(createPayload('payment_link.expired', 'inc_123'));
    
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
    const updateArg = mockUpdate().set.mock.calls[0][0];
    expect(updateArg.status).toBe('EXPIRED');

    expect(rizeAuditLedger.commitAuditBlockAtomic).toHaveBeenCalledWith(mockTx, {
      incidentId: 'inc_123',
      eventType: 'EXPIRED',
      eniScore: 50.25
    });
  });

  it('5.J: Three event types all handled (testing cancelled -> EXPIRED)', async () => {
    const res = await request(app)
      .post('/webhooks/razorpay')
      .set('x-razorpay-event-id', 'evt_cancelled')
      .set('x-razorpay-signature', 'valid_sig')
      .send(createPayload('payment_link.cancelled', 'inc_123'));
    
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
    const updateArg = mockUpdate().set.mock.calls[0][0];
    expect(updateArg.status).toBe('EXPIRED');
  });
});
