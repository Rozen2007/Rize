# RIZE — Synthetic Payment Recovery Dataset

A high-fidelity **synthetic** dataset for the RIZE revenue-recovery command
center. It is NOT customer data — every user, session, and amount is
generated — but it is built from a realistic **data-generating process** so it
behaves like production data: correlated, calibrated, economically coherent,
and suitable for A/B analysis, Bayesian modeling, cohort analysis, and
intervention optimization.

**Outputs**
- `synthetic_payment_recovery_data.csv` (10,000 rows, 32 columns)
- `synthetic_payment_recovery_data.json` (same rows, nested-free flat objects)
- `data_dictionary.md` (column-by-column reference)
- `generate_dataset.py` (the generator — deterministic, seeded, extensible)
- `validate_dataset.py` (validation report over the CSV)
- `apps/api/scripts/seed_from_dataset.ts` (loads the dataset into Postgres for the live dashboard)

---

## 1. What the process simulates

A merchant runs a payment-recovery engine (RIZE) that watches checkout
incidents. When a checkout fails or is abandoned, the engine classifies the
cause, and — unless the incident is a **control holdout** — runs an
**intervention tournament** over a policy-eligible action set, picking the
action with the highest **Expected Net Income (ENI)**, then observes a binary
recovery outcome (the customer completes via the link/discount, or does not).

Each generated record is the result of applying that whole process to one
simulated checkout.

### The intervention tournament (per incident)

1. **Classify friction** — `price` (abandonment / price friction),
   `payment` (bank decline, insufficient funds, expired card),
   `technical` (auth failure, technical error).
2. **Build candidate set under policy rules:**
   - Discounts (`2/4/6/8%`) are eligible **only** for `price` friction **and**
     only when classifier confidence ≥ 0.80 (blueprint C2).
   - `payment_retry`, `alternative_payment`, `personalized_offer`,
     `urgency_message` are eligible for their relevant friction types.
   - `none` (do-nothing) is always eligible as the safety floor (ENI = 0).
3. **Estimate P_rec** for each candidate from its cohort's **Beta posterior**
   `Beta(successes+2, failures+5)` — a Bayesian cohort learner keyed by
   `device:failureReason:paymentMethod`.
4. **Thompson-style selection** — draw P_rec from each candidate's posterior,
   recompute ENI with the drawn value, and pick the argmax. Races that are
   close genuinely flip, which is why the same incident can sometimes get a
   4% vs 6% vs 8% discount. This mirrors the system's own uncertainty about
   P_rec (blueprint §9.1 production upgrade).
5. **Observe outcome** — recovery = Bernoulli(truth), where `truth` is the
   candidate's recovery probability scaled by an incident **difficulty
   factor** (segment-level: new 0.80 / returning 0.90 / etc.). The model is
   therefore *not* perfectly calibrated — it over/under-predicts by a small
   amount on purpose.

### Key economic relationships baked in

| Relationship | Implementation |
|---|---|
| Order value skew | Lognormal per segment; median ₹3.4k, tail to ₹205k; ~190 orders > ₹50k |
| Price friction | More likely for high-value orders and price-sensitive customers |
| Payment failures | UPI → auth/technical errors; cards → declines/expiry; attempt # affects reason |
| Discount response | Recovery 2%→35%, 4%→40%, 6%→41%, 8%→45% — climbs fast then flattens |
| ENI peak | Structural ENI peaks at **6%**; 8% recovers slightly more but concedes more margin |
| Recovery | Chosen intervention raises P_rec well above baseline (2–9%) |
| Technical failures | Beat with `payment_retry` / `alternative_payment`, **not** discounts |
| Control | ~12% randomized holdout get `none`; their recovery ≈ baseline (~4.5%) |

### Discount economics (the ENI trade-off)

The recovery gains 2%→6% add more GMV than the discount costs; the 6%→8%
step adds only a little recovery while conceding more margin, so **6–8%**
sits at the economic sweet spot. Observed **average realized ENI** by tier
(treatment, price friction): 2%→₹1,575, 4%→₹1,315, 6%→₹1,700, 8%→₹1,752.
Because Thompson sampling draws P_rec from each cohort posterior and takes
argmax ENI, close races (4% vs 6% vs 8%) genuinely flip, giving a realistic
**not deterministic** mix: **6% 723 / 4% 378 / 8% 368 / 2% 227** selections,
with 8% recovered 40.2% vs 2% 34.8%.

---

## 2. Output statistics (seed 42, 10,000 rows)

| Metric | Value |
|---|---|
| Records | 10,000 |
| Unique customers | ≈3,473 (≈2.9 incidents / customer) |
| Overall recovery rate | 29.0% |
| Control recovery rate | **4.47%** |
| Treatment recovery rate | **32.29%** |
| Incremental rate (pp) | **+27.8 pp** |
| Incremental lift (relative) | ~6.2× |
| Total recovered GMV | **₹20.8M** |
| Incremental GMV | **₹16.7M** |
| Order value: median / mean / max | ₹3,450 / ₹7,169 / ₹321,400 |
| Brier score | **0.196** (target 0.15–0.25) |
| Approval queue (ENI > ₹5k) | 320 records (~3.6% of treatment) |

### Intervention mix (treatment)

| Intervention | Count | Share |
|---|---|---|
| payment_retry | 3,244 | 32.4% |
| alternative_payment | 2,082 | 20.8% |
| personalized_offer | 1,596 | 16.0% |
| none | 1,185 | 11.8% |
| 6% discount | 723 | 7.2% |
| 4% discount | 378 | 3.8% |
| 8% discount | 368 | 3.7% |
| 2% discount | 227 | 2.3% |
| urgency_message | 197 | 2.0% |

### Best interventions by cohort (observed recovery, treatment only)

| Cohort | Best action | Recovery |
|---|---|---|
| technical friction (auth/technical errors) | `payment_retry` | ~30% |
| payment friction (declines / funds / expiry) | `alternative_payment` | ~35% |
| price friction — price_sensitive | `6_percent_discount` | ~40% |
| price friction — returning | `personalized_offer` / 4–6% discount | ~32% / ~40% |
| high-value orders | 4–8% discount (conservative by design) | ~40% |

### Experiment split (A/B)
- **EXP_001** (v4.1.0-beta) · n=3,294
- **EXP_002** (v4.2.0-bayesian) · n=3,370
- **EXP_003** (v4.3.0-prod) · n=3,336

---

## 3. Calibration

The model predicts `predicted_probability`; the actual binary outcome is
`recovered`. Because the Bayesian learner is good-but-imperfect, decile buckets
deviate from the perfect y=x line (max gap ≈ 3.8pp) and the Brier score lands
at **0.196**, squarely in the 0.15–0.25 target band.

| Decile | Pred. P | Actual | Gap |
|---|---|---|---|
| 1 | 0.043 | 0.035 | 0.008 |
| 2 | 0.180 | 0.217 | 0.037 |
| 3 | 0.244 | 0.282 | 0.038 |
| 4 | 0.270 | 0.285 | 0.015 |
| 5 | 0.291 | 0.283 | 0.008 |
| 6 | 0.313 | 0.310 | 0.003 |
| 7 | 0.333 | 0.331 | 0.002 |
| 8 | 0.357 | 0.357 | 0.000 |
| 9 | 0.385 | 0.372 | 0.013 |
| 10 | 0.438 | 0.427 | 0.011 |

---

## 4. Reproducibility & extension

```bash
python3 generate_dataset.py --rows 10000 --seed 42
python3 generate_dataset.py --rows 20000 --seed 7 --duration 90 --start 2026-01-01
python3 validate_dataset.py
```

- Same seed ⇒ byte-identical CSV/JSON.
- `--rows`, `--seed`, `--start`, `--duration`, `--out-dir` let you rebuild
  bigger/shorter/history-heavy datasets for other demos.
- The Docker/demo case: `validator` fails hard on any invariant breach, so any
  future edit to the generator is regression-checked.

---

## 5. Loading into the live dashboard (Postgres)

```bash
pnpm --filter @rize/api tsx scripts/seed_from_dataset.ts
```

Maps CSV → Drizzle `incidents`/`cohort_stats` (see that script for the
enum mappings) so every dashboard KPI — incremental lift, GMV recovered,
calibration curve, approval queue, cohort cards, incident feed — is computed
**from the dataset**, never hardcoded.

---

## 6. Honest caveats

- Synthetic only: it is *statistically* realistic, not *real* customer data.
- The classifier output is simplified (we store final classification not the
  raw error codes that would feed a real Groq call).
- Single-currency (INR), single-country (IN), one merchant.
- Blended treatment recovery (~33%) is high vs. raw baseline because RIZE only
  acts on economically eligible incidents; the control group (≈4%) is the
  honest counterfactual.