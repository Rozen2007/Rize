import { pgTable, text, doublePrecision, integer, boolean, timestamp, unique, pgEnum } from 'drizzle-orm/pg-core';

export const actionTypeEnum = pgEnum('action_type', [
  'PAYMENT_RECOVERY_LINK',
  'TARGETED_DYNAMIC_DISCOUNT',
  'DO_NOTHING',
]);

export const failureReasonEnum = pgEnum('failure_reason', [
  'PRICE_FRICTION',   // abandoned / price-sensitive  -> discount eligible
  'BANK_DECLINE',     // technical                     -> discount INELIGIBLE
  'AUTH_TIMEOUT',     // technical                     -> discount INELIGIBLE
  'EXPIRED_CARD',     // technical                     -> discount INELIGIBLE
]);

export const incidentStatusEnum = pgEnum('incident_status', [
  'PENDING', 'EXECUTING', 'EXECUTED_PENDING_SETTLEMENT',
  'BLOCKED_INSUFFICIENT_MARGIN', 'RECOVERED', 'EXPIRED',
  'SKIPPED_MISSING_CONTACT', 'CONTROL_HELDOUT', 'RAZORPAY_LINK_FAILED',
  'PENDING_APPROVAL', 'REJECTED_BY_APPROVER'
]);

export const merchants = pgTable('merchants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  webhookSecret: text('webhook_secret').notNull(),           // used for HMAC verification
  grossMarginRatio: doublePrecision('gross_margin_ratio').default(0.40).notNull(),
  mdrRate: doublePrecision('mdr_rate').default(0.02).notNull(),
  maxDiscountCap: doublePrecision('max_discount_cap').default(0.15).notNull(),
  minMarginFloor: doublePrecision('min_margin_floor').default(0.10).notNull(),
  controlGroupRatio: doublePrecision('control_group_ratio').default(0.10).notNull(), // 10% holdout
  tauApprove: doublePrecision('tau_approve').default(5000).notNull(), // ENI threshold for approval
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const incidents = pgTable('incidents', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  razorpayEventId: text('razorpay_event_id').notNull().unique(),   // idempotency key
  batchId: text('batch_id'),                                       // groups a demo batch
  checkoutId: text('checkout_id').notNull(),
  customerPhone: text('customer_phone'),                           // nullable -> SKIPPED
  orderValue: doublePrecision('order_value').notNull(),
  failureReason: failureReasonEnum('failure_reason').notNull(),
  device: text('device').notNull(),
  paymentMethod: text('payment_method').notNull(),
  affectedCohort: text('affected_cohort').notNull(),               // "Android:BANK_DECLINE:UPI"
  isControl: boolean('is_control').default(false).notNull(),       // randomized holdout
  winningAction: actionTypeEnum('winning_action').notNull(),
  winningENI: doublePrecision('winning_eni').notNull(),
  winningPRec: doublePrecision('winning_prec').notNull(),
  discountOffered: doublePrecision('discount_offered').default(0).notNull(),
  candidatesJson: text('candidates_json').notNull(),               // full tournament, for "why-not"
  rejectionReason: text('rejection_reason'),
  smsCopy: text('sms_copy'),
  razorpayLinkId: text('razorpay_link_id').unique(),
  razorpayLinkUrl: text('razorpay_link_url'),
  razorpayPaymentId: text('razorpay_payment_id').unique(),
  status: incidentStatusEnum('status').default('PENDING').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const cohortStats = pgTable('cohort_stats', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  cohortKey: text('cohort_key').notNull(),
  actionType: actionTypeEnum('action_type').notNull(),
  totalAttempts: integer('total_attempts').default(0).notNull(),
  totalSuccesses: integer('total_successes').default(0).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({ unq: unique().on(t.merchantId, t.cohortKey, t.actionType) }));

export const processedWebhookEvents = pgTable('processed_webhook_events', {
  eventId: text('event_id').primaryKey(),          // Razorpay x-razorpay-event-id -> dedupe
  eventType: text('event_type').notNull(),
  processedAt: timestamp('processed_at').defaultNow().notNull(),
});

export const auditLedger = pgTable('audit_ledger', {
  sequenceId: integer('sequence_id').primaryKey(),  // assigned under advisory lock (Section 9)
  incidentId: text('incident_id').notNull().references(() => incidents.id),
  eventType: text('event_type').notNull(),
  eniScore: doublePrecision('eni_score').notNull(),
  previousHash: text('previous_hash').notNull(),
  currentHash: text('current_hash').notNull(),
  createdAtMs: text('created_at_ms').notNull(),     // epoch ms as string -> deterministic hashing
});

export type ActionType = (typeof actionTypeEnum.enumValues)[number];
export type IncidentStatus = (typeof incidentStatusEnum.enumValues)[number];
export type FailureReason = (typeof failureReasonEnum.enumValues)[number];
