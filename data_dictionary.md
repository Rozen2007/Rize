# RIZE Synthetic Payment Recovery Dataset — Data Dictionary

**Datasets:** `synthetic_payment_recovery_data.csv` / `.json`
**Version:** 3 · **Rows:** 10,000 · **Records per row:** 1 checkout/payment incident
**Seed:** 42 (reproducible) · **Span:** 2026-06-20 → 2026-09-03 (76 days)

Every row is one **checkout/payment incident**: a customer reached checkout,
attempted a payment, and did not complete it within the normal window. RIZE
then either intervened (treatment) or was held out (control), and we observe a
binary recovery outcome.

---

## Column reference

| # | Column | Type | Description |
|---|--------|------|-------------|
| 1 | `incident_id` | string | Stable unique ID, `CHK_000001` … `CHK_010000` |
| 2 | `timestamp` | ISO-8601 | Recovered? Settled timestamp of the failed checkout (UTC) |
| 3 | `customer_id` | string | Obfuscated repeat-customer ID, `CUST_xxxxxx` |
| 4 | `session_id` | string | Checkout session ID, `SES_xxxxxxx` (unique per record) |
| 5 | `device_type` | enum | `mobile` · `desktop` · `tablet` |
| 6 | `traffic_source` | enum | `organic` · `paid_search` · `social` · `direct` · `referral` · `email` |
| 7 | `country` | enum | `IN` (India) |
| 8 | `region` | enum | `MH` · `KA` · `DL` · `TN` · `TG` · `GJ` · `UP` · `WB` |
| 9 | `customer_segment` | enum | `new` · `returning` · `high_value` · `price_sensitive` |
| 10 | `order_value` | float ₹ | Checkout amount (skewed: median ₹3.4k, tail to ₹205k) |
| 11 | `currency` | enum | `INR` |
| 12 | `payment_method` | enum | `credit_card` · `debit_card` · `upi` · `wallet` · `net_banking` · `bnpl` |
| 13 | `card_network` | enum | `Visa` · `Mastercard` · `Amex` · `RuPay` · `None` (non-card methods) |
| 14 | `payment_attempt_number` | int | 1–3 (68% first attempt) |
| 15 | `payment_failure_reason` | enum | `insufficient_funds` · `bank_decline` · `authentication_failure` · `expired_card` · `technical_error` · `price_friction` · `customer_abandonment` · `none` |
| 16 | `friction_type` | enum | `price` · `payment` · `technical` · `none` (derived category) |
| 17 | `baseline_conversion_probability` | float | Counterfactual organic recovery probability with **no** intervention (2–9%) |
| 18 | `predicted_probability` | float | Model's predicted recovery probability (0.02–0.95), Bayesian posterior + calibration noise |
| 19 | `model_confidence` | float | Classifier confidence for the incident (0.74–0.96) |
| 20 | `treatment_group` | enum | `control` (11.8%) · `treatment` (88.1%) |
| 21 | `intervention_type` | enum | `none` · `2_percent_discount` · `4_percent_discount` · `6_percent_discount` · `8_percent_discount` · `payment_retry` · `alternative_payment` · `urgency_message` · `personalized_offer` |
| 22 | `discount_percent` | float | 0, 0.02, 0.04, 0.06, 0.08 (0 for non-discount actions) |
| 23 | `discount_amount` | float ₹ | `order_value × discount_percent` (0 when no discount) |
| 24 | `expected_net_income` | float ₹ | ENI of the **selected** intervention (see formula below) |
| 25 | `intervention_cost` | float ₹ | Messaging/fulfilment cost (₹0–₹25) |
| 26 | `recovered` | bool | 1 = payment later completed; 0 = not recovered |
| 27 | `recovered_gmv` | float ₹ | `order_value − discount_amount` (0 if not recovered) |
| 28 | `incremental_gmv` | float ₹ | Portion of recovered GMV attributable to the AI beyond control baseline (0 for control / `none`) |
| 29 | `revenue_saved` | float ₹ | Realized net profit: `recovered × (grossProfit − discount − MDR − cost) − cost×(1−recovered)` |
| 30 | `time_to_recovery_seconds` | int·null | Seconds from incident to link settlement (null if not recovered) |
| 31 | `model_version` | enum | `v4.1.0-beta` · `v4.2.0-bayesian` · `v4.3.0-prod` |
| 32 | `experiment_id` | enum | `EXP_001` · `EXP_002` · `EXP_003` |

---

## Invariants (guaranteed by construction)

- `recovered = 0` ⇒ `recovered_gmv = 0`, `incremental_gmv = 0`, `time_to_recovery_seconds = null`
- `treatment_group = control` ⇒ `intervention_type = none`, all discount fields 0
- `intervention_type = none` ⇒ `discount_percent = 0`, `discount_amount = 0`
- `discount_percent > 0` ⇒ `discount_amount = round(order_value × discount_percent, 2)`
- Only `price` friction unlocks discounts, and only when `model_confidence ≥ 0.80`
- `incremental_gmv = 0` for all control rows

## Key formulas

```
grossProfit  = order_value × 0.40                       (merchant margin)
mdrCost      = order_value × 0.02                       (gateway fee)
ENI(action)  = P_rec × (grossProfit − discountAmount − mdrCost − msgCost)

incrementalGmv = recoveredGmv × (1 − baselineConversion / trueP)     [treatment only]
revenueSaved   = recovered ? (grossProfit − discount − mdr − cost) : −cost
```

## Derived analytics (dashboard KPIs, all computable from the dataset)

| KPI | Definition |
|-----|-----------|
| Recovery rate | `Σ recovered / n` per group |
| Incremental rate (lift, pp) | `treatmentRate − controlRate` |
| Incremental lift (relative) | `(treatmentRate − controlRate) / controlRate` |
| Estimated GMV recovered | `Σ recovered_gmv` |
| Incremental GMV | `Σ incremental_gmv` |
| Brier score | `(1/n) Σ (predicted_probability − recovered)²` |
| Approval-queue count | treatment records with `expected_net_income > ₹5,000` |