#!/usr/bin/env python3
"""
RIZE Synthetic Payment Recovery Dataset Generator — V3
======================================================

High-fidelity data-generating process for the RIZE payment-recovery
decision engine. Produces a production-grade synthetic dataset with:

  • 10,000+ checkout/payment-incident records
  • Correlated customer behavior (repeat buyers, heterogeneous segments)
  • Failure-reason distribution conditioned on payment method, device,
    attempt number, order value, and price sensitivity
  • Thompson-sampling intervention tournament (draw P_rec from the
    Beta posterior, compute ENI, pick argmax) — the SAME optimal action
    is not always chosen; close races flip naturally (RIZE blueprint §9.1)
  • All 10 intervention types: none, 2/4/6/8% discounts, payment_retry,
    alternative_payment, urgency_message, personalized_offer
  • Realistic discount economics: recovery climbs 2→6%, flattens at 8%,
    so Expected Net Income peaks at ~6% and 8% is rarely worth it
  • Calibration target: Brier ~0.15–0.25, non-perfect curve
  • Control group (12%) with NO intervention
  • 75-day time series with diurnal + weekly + weekend + spike/drop patterns
  • Natural high-ENI approval queue (ENI > ₹5,000)

Deterministic with a fixed random seed for reproducibility.
"""

import argparse
import csv
import json
import math
import random
from datetime import datetime, timedelta

# ---------------------------------------------------------------------------
# Reproducibility / CLI
# ---------------------------------------------------------------------------
def parse_args():
    p = argparse.ArgumentParser(description="Generate the RIZE synthetic payment-recovery dataset")
    p.add_argument("--rows", type=int, default=10000, help="Number of incident records (default 10000)")
    p.add_argument("--seed", type=int, default=42, help="Random seed (default 42) — same seed ⇒ identical data")
    p.add_argument("--start", type=str, default="2026-06-20", help="Start date YYYY-MM-DD")
    p.add_argument("--duration", type=int, default=75, help="Days of history to simulate (default 75)")
    p.add_argument("--out-dir", type=str, default=".", help="Output directory for CSV/JSON")
    return p.parse_args()


ARGS = parse_args()
RANDOM_SEED = ARGS.seed
random.seed(RANDOM_SEED)

TOTAL_RECORDS = ARGS.rows
NUM_CUSTOMERS = max(1200, TOTAL_RECORDS // 2)   # ~2 incidents per customer avg

# ---------------------------------------------------------------------------
# Merchant policy constants (RIZE PRD v4)
# ---------------------------------------------------------------------------
GROSS_MARGIN_RATIO = 0.40   # 40% contribution margin
MDR_RATE = 0.02             # 2% payment-gateway fee
MIN_MARGIN_FLOOR = 0.10     # 10% floor — discount cannot push below this
MAX_DISCOUNT_CAP = 0.15     # 15% absolute discount cap
TAU_APPROVE = 5000.0        # ENI above which requires human approval
MIN_CLASSIFIER_CONF = 0.80  # τ_class — discount only unlocked above this
# Messaging + fulfilment costs (₹) — realistic per-action cost
MSG_COST_LINK = 20.0        # payment retry / alternative method link
MSG_COST_DISC = 25.0        # discount offer (coupon + SMS)
MSG_COST_NUDGE = 10.0       # urgency / personalization nudge

# Beta prior (matches PRD §8.4 → lib/math-engine bayesian.ts)
ALPHA_PRIOR = 2.0
BETA_PRIOR = 5.0

# ---------------------------------------------------------------------------
# Temporal domain
# ---------------------------------------------------------------------------
START_DATE = datetime.strptime(ARGS.start, "%Y-%m-%d")
DURATION_DAYS = ARGS.duration
END_DATE = START_DATE + timedelta(days=DURATION_DAYS - 1)
END_DATE = END_DATE.replace(hour=23, minute=59, second=59)
TOTAL_SECONDS = int((END_DATE - START_DATE).total_seconds())

# ---------------------------------------------------------------------------
# Distribution tables
# ---------------------------------------------------------------------------
REGIONS = [
    ("MH", 0.24), ("KA", 0.18), ("DL", 0.16), ("TN", 0.12),
    ("TG", 0.10), ("GJ", 0.08), ("UP", 0.07), ("WB", 0.05),
]

TRAFFIC_SOURCES = [
    ("paid_search", 0.28), ("organic", 0.24), ("social", 0.20),
    ("direct", 0.16), ("referral", 0.07), ("email", 0.05),
]

CUSTOMER_SEGMENTS = [
    ("new", 0.42), ("returning", 0.34), ("price_sensitive", 0.16), ("high_value", 0.08),
]

PAYMENT_METHODS = [
    ("upi", 0.46), ("credit_card", 0.24), ("debit_card", 0.16),
    ("net_banking", 0.06), ("wallet", 0.05), ("bnpl", 0.03),
]

CARD_NETWORKS = {
    "credit_card": [("Visa", 0.45), ("Mastercard", 0.35), ("Amex", 0.12), ("RuPay", 0.08)],
    "debit_card": [("RuPay", 0.45), ("Visa", 0.35), ("Mastercard", 0.20)],
    "upi": [("None", 1.0)],
    "net_banking": [("None", 1.0)],
    "wallet": [("None", 1.0)],
    "bnpl": [("None", 1.0)],
}

DEVICES = [("mobile", 0.68), ("desktop", 0.27), ("tablet", 0.05)]

# Experiment / model-version timeline
EXPERIMENTS = [
    (START_DATE,                                      "EXP_001", "v4.1.0-beta"),
    (START_DATE + timedelta(days=int(DURATION_DAYS / 3)),  "EXP_002", "v4.2.0-bayesian"),
    (START_DATE + timedelta(days=int(DURATION_DAYS * 2 / 3)), "EXP_003", "v4.3.0-prod"),
]


def sample_weighted(options):
    r = random.random()
    cum = 0.0
    for item, weight in options:
        cum += weight
        if r <= cum:
            return item
    return options[-1][0]


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


# ---------------------------------------------------------------------------
# 1. Customer behavioral profiles
# ---------------------------------------------------------------------------
def build_customers():
    customers = {}
    for i in range(1, NUM_CUSTOMERS + 1):
        cid = f"CUST_{i:06d}"
        seg = sample_weighted(CUSTOMER_SEGMENTS)
        pref_device = sample_weighted(DEVICES)
        pref_pm = sample_weighted(PAYMENT_METHODS)
        region = sample_weighted(REGIONS)

        if seg == "price_sensitive":
            price_sens = random.uniform(0.70, 0.98)
            order_mult = random.uniform(0.55, 1.05)
            base_conv_penalty = 0.018
        elif seg == "high_value":
            price_sens = random.uniform(0.05, 0.25)
            order_mult = random.uniform(1.4, 3.5)
            base_conv_penalty = -0.012
        elif seg == "returning":
            price_sens = random.uniform(0.25, 0.55)
            order_mult = random.uniform(0.95, 1.9)
            base_conv_penalty = -0.015
        else:  # new
            price_sens = random.uniform(0.40, 0.72)
            order_mult = random.uniform(0.80, 1.40)
            base_conv_penalty = 0.015

        # Relapse affinity: some customers are more contactable / return
        relapse_affinity = random.uniform(0.05, 0.9)

        customers[cid] = {
            "customer_id": cid,
            "segment": seg,
            "device": pref_device,
            "payment_method": pref_pm,
            "region": region,
            "country": "IN",
            "price_sensitivity": price_sens,
            "order_mult": order_mult,
            "base_conv_penalty": base_conv_penalty,
            "relapse_affinity": relapse_affinity,
        }
    return customers


customers = build_customers()
customer_keys = list(customers.keys())

# ---------------------------------------------------------------------------
# 2. Timestamps — diurnal + weekly + spike/drop
# ---------------------------------------------------------------------------
def generate_timestamps():
    ts = []
    day = START_DATE
    day_idx = 0
    # Overshoot so we can trim to exactly N
    avg_per_day = TOTAL_RECORDS / DURATION_DAYS * 1.06

    while len(ts) < TOTAL_RECORDS and day_idx < DURATION_DAYS + 4:
        wd = day.weekday()
        base_mult = 1.0 if wd < 5 else (0.78 if wd == 5 else 0.66)
        wave = 1.0 + 0.16 * math.sin(2 * math.pi * day_idx / 21.0)
        spike = 1.0
        if day_idx % 9 == 0:
            spike = random.uniform(1.18, 1.45)
        elif day_idx % 11 == 5:
            spike = random.uniform(0.58, 0.78)

        scale = base_mult * wave * spike
        recs_today = int(round(avg_per_day * scale * random.uniform(0.92, 1.08)))
        recs_today = max(1, recs_today)

        # Hour-of-day weights (IST) — normalized so sample_weighted works
        hour_weights = []
        for h in range(24):
            if 19 <= h < 23:
                hour_weights.append(3.4)   # evening peak
            elif 12 <= h < 14:
                hour_weights.append(2.2)   # lunch
            elif 10 <= h < 12 or 16 <= h < 19:
                hour_weights.append(1.8)
            elif 23 <= h or h < 2:
                hour_weights.append(0.45)  # late night
            elif 2 <= h < 6:
                hour_weights.append(0.12)  # dead zone
            else:
                hour_weights.append(0.8)
        hsum = sum(hour_weights)
        hour_weights = [w / hsum for w in hour_weights]

        for _ in range(recs_today):
            if len(ts) >= TOTAL_RECORDS:
                break
            h = sample_weighted([(i, w) for i, w in enumerate(hour_weights)])
            m = random.randint(0, 59)
            s = random.randint(0, 59)
            ts.append(day.replace(hour=h, minute=m, second=s))

        day += timedelta(days=1)
        day_idx += 1

    ts.sort()
    return ts[:TOTAL_RECORDS]


timestamps = generate_timestamps()
assert len(timestamps) == TOTAL_RECORDS, f"Expected {TOTAL_RECORDS} timestamps, got {len(timestamps)}"


def experiment_for(ts):
    exp_id, model_ver = "EXP_001", "v4.1.0-beta"
    for start, eid, mv in sorted(EXPERIMENTS, key=lambda x: x[0]):
        if ts >= start:
            exp_id, model_ver = eid, mv
    return exp_id, model_ver


def day_bucket(ts):
    """YYYY-MM-DD for cohort / trend plotting."""
    return ts.strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# 3. Cohort / Bayesian learning tracker (mirrors lib/cohort_stats)
# ---------------------------------------------------------------------------
cohort_tracker = {}


def get_cohort(k, action, prior_p):
    """Return (attempts, successes) with a plausible seeded history."""
    key = (k, action)
    if key not in cohort_tracker:
        n = random.randint(30, 130)
        cohort_tracker[key] = (n, int(n * prior_p))
    return cohort_tracker[key]


def posterior_params(stats, prior_p, confidence):
    """Posterior Beta parameters given observed history + prior.
    Higher model confidence ⇒ tighter posterior (more weight on estimate)."""
    attempts, successes = stats
    a = successes + ALPHA_PRIOR
    b = (attempts - successes) + BETA_PRIOR
    # Confidence scales the prior's influence: high confidence →
    # concentrate near the empirical rate. We simulate this by drawing the
    # posterior mean toward the empirical rate when confident.
    return a, b, confidence


def draw_p_rec(stats, prior_p, confidence):
    """Thompson-style sample of P_rec from the Beta posterior.
    High confidence ⇒ the sample hugs the empirical rate; low confidence ⇒
    the prior/Laplace smoothing pulls it toward `prior_p` more."""

    attempts, successes = stats
    a = successes + ALPHA_PRIOR
    b = (attempts - successes) + BETA_PRIOR
    p_emp = a / (a + b)

    raw = random.betavariate(max(1.0, a), max(1.0, b))
    # Blend toward prior when confidence is low
    blend = 1.0 - (confidence * 0.85)
    p = raw * (1.0 - blend) + prior_p * blend
    return clamp(p, 0.01, 0.95)


# ---------------------------------------------------------------------------
# 4. Intervention candidate definitions & economics
# ---------------------------------------------------------------------------
# Recovery response by friction type. Discounts only for PRICE friction.
# ENI formula (matches lib/math-engine/eni.ts + PRD §8.1):
#   ENI = P_rec × (grossProfit − discountAmount − mdrCost) − msgCost

def intervention_eni(p_rec, order_value, discount_frac, gross_margin, mdr_rate, msg_cost):
    discount_amount = order_value * discount_frac
    gross_profit = order_value * gross_margin
    net_gain = gross_profit - discount_amount - (order_value * mdr_rate) - msg_cost
    return p_rec * net_gain


def build_candidates(friction_type, payment_method, failure_reason, order_value,
                     baseline_p, cust, attempt_number, model_confidence):
    """Return the policy-eligible candidate list for this incident."""
    gross_profit = order_value * GROSS_MARGIN_RATIO
    mdr_cost = order_value * MDR_RATE
    ps = cust["price_sensitivity"]
    seg = cust["segment"]
    rel = cust["relapse_affinity"]

    got_two_plus = attempt_number >= 2
    ts_bonus = 0.04 if seg == "price_sensitive" else 0.02 if seg == "returning" else 0.0

    candidates = []

    # ----- urgency_message (behavioral nudge, cheapest) -----
    if friction_type in ("price", "payment"):
        p = {
            "price": 0.30,
            "payment": 0.20,
        }[friction_type]
        p = clamp(p + (0.05 if seg == "price_sensitive" else 0) + (0.03 if got_two_plus else 0), 0.05, 0.72)
        candidates.append({
            "type": "urgency_message", "disc_pct": 0.0, "p_rec": p,
            "cost": MSG_COST_NUDGE, "eni": intervention_eni(p, order_value, 0.0, GROSS_MARGIN_RATIO, MDR_RATE, MSG_COST_NUDGE),
            "eligible": True,
        })

    # ----- personalized_offer (loyalty / intent) -----
    p = {
        "price": 0.34,
        "payment": 0.30,
        "technical": 0.24,
    }[friction_type]
    p = clamp(p + (0.05 if seg in ("returning", "high_value") else 0) + (0.02 if got_two_plus else 0), 0.06, 0.80)
    candidates.append({
        "type": "personalized_offer", "disc_pct": 0.0, "p_rec": p,
        "cost": MSG_COST_NUDGE, "eni": intervention_eni(p, order_value, 0.0, GROSS_MARGIN_RATIO, MDR_RATE, MSG_COST_NUDGE),
        "eligible": True,
    })

    # ----- payment_retry (payment recovery link) -----
    p = {
        "price": 0.22,
        "payment": 0.30,
        "technical": 0.34,
    }[friction_type]
    p = clamp(p + (0.03 if seg == "returning" else 0) + (0.02 if got_two_plus else 0) + (0.03 if rel > 0.6 else 0), 0.06, 0.80)
    candidates.append({
        "type": "payment_retry", "disc_pct": 0.0, "p_rec": p,
        "cost": MSG_COST_LINK, "eni": intervention_eni(p, order_value, 0.0, GROSS_MARGIN_RATIO, MDR_RATE, MSG_COST_LINK),
        "eligible": True,
    })

    # ----- alternative_payment -----
    p = {
        "price": 0.17,
        "payment": 0.35,
        "technical": 0.27,
    }[friction_type]
    if payment_method == "upi" and failure_reason in ("bank_decline", "insufficient_funds"):
        p += 0.10
    elif payment_method in ("credit_card", "debit_card") and failure_reason in ("bank_decline",):
        p += 0.08
    p = clamp(p + (0.03 if seg == "returning" else 0), 0.05, 0.82)
    candidates.append({
        "type": "alternative_payment", "disc_pct": 0.0, "p_rec": p,
        "cost": MSG_COST_LINK, "eni": intervention_eni(p, order_value, 0.0, GROSS_MARGIN_RATIO, MDR_RATE, MSG_COST_LINK),
        "eligible": True,
    })

    # ----- Discounts 2/4/6/8% — price friction ONLY + confidence gate -----
    # Recovery response: climbs 2→6% at a healthy rate, then flattens hard at
    # 8% so Expected Net Income peaks at 6% (8% = slightly better recovery,
    # strictly worse economics). Discount unlocks only when the classifier is
    # confident enough (blueprint C2: τ_class = 0.80).
    disc_conf_ok = model_confidence >= MIN_CLASSIFIER_CONF
    disc_base = {0.02: 0.40, 0.04: 0.46, 0.06: 0.51, 0.08: 0.52}
    for d_type, d_pct in [("2_percent_discount", 0.02), ("4_percent_discount", 0.04),
                          ("6_percent_discount", 0.06), ("8_percent_discount", 0.08)]:
        if friction_type != "price" or not disc_conf_ok:
            candidates.append({"type": d_type, "disc_pct": d_pct, "p_rec": 0.0,
                               "cost": MSG_COST_DISC, "eni": float("-inf"), "eligible": False})
            continue

        d_amt = order_value * d_pct
        post_disc_margin = (gross_profit - d_amt) / order_value
        eligible = (d_pct <= MAX_DISCOUNT_CAP) and (post_disc_margin >= MIN_MARGIN_FLOOR)
        if not eligible:
            candidates.append({"type": d_type, "disc_pct": d_pct, "p_rec": 0.0,
                               "cost": MSG_COST_DISC, "eni": float("-inf"), "eligible": False})
            continue

        p = disc_base[d_pct] + (ps - 0.5) * 0.16 + (0.02 if got_two_plus else 0)
        p = clamp(p, 0.12, 0.88)
        candidates.append({
            "type": d_type, "disc_pct": d_pct, "p_rec": p,
            "cost": MSG_COST_DISC, "eni": intervention_eni(p, order_value, d_pct, GROSS_MARGIN_RATIO, MDR_RATE, MSG_COST_DISC),
            "eligible": True,
        })

    # ----- Do-nothing floor (always eligible) -----
    candidates.append({
        "type": "none", "disc_pct": 0.0, "p_rec": baseline_p,
        "cost": 0.0, "eni": 0.0, "eligible": True,
    })
    return candidates


# ---------------------------------------------------------------------------
# 5. Main generation loop
# ---------------------------------------------------------------------------
records = []

for idx in range(1, TOTAL_RECORDS + 1):
    incident_id = f"CHK_{idx:06d}"
    ts = timestamps[idx - 1]
    ts_iso = ts.strftime("%Y-%m-%dT%H:%M:%SZ")
    experiment_id, model_version = experiment_for(ts)

    # --- Pick a customer (weighted to give repeat buyers) ---------------
    if random.random() < 0.65:
        cust_id = customer_keys[random.randint(0, min(2000, len(customer_keys) - 1))]
    else:
        cust_id = random.choice(customer_keys)
    cust = customers[cust_id]

    session_id = f"SES_{random.randint(1000000, 9999999):d}{idx % 7}"

    # --- Device & payment method (85% preferred, 15% variation) ---------
    device_type = cust["device"] if random.random() < 0.85 else sample_weighted(DEVICES)
    payment_method = cust["payment_method"] if random.random() < 0.82 else sample_weighted(PAYMENT_METHODS)
    card_network = sample_weighted(CARD_NETWORKS[payment_method])

    # --- Traffic source correlated with customer segment ------------------
    if cust["segment"] == "price_sensitive":
        traffic_source = sample_weighted([("social", 0.38), ("paid_search", 0.36), ("organic", 0.16), ("direct", 0.10)])
    elif cust["segment"] == "high_value":
        traffic_source = sample_weighted([("direct", 0.36), ("organic", 0.33), ("email", 0.19), ("paid_search", 0.12)])
    elif cust["segment"] == "returning":
        traffic_source = sample_weighted([("direct", 0.33), ("email", 0.25), ("organic", 0.27), ("paid_search", 0.15)])
    else:
        traffic_source = sample_weighted(TRAFFIC_SOURCES)

    # --- Order value (skewed log-normal, segment-scaled) -----------------
    if cust["segment"] == "high_value":
        base_val = math.exp(random.gauss(9.5, 0.55))   # median ≈ ₹13.4k, tail to ₹60k
    elif cust["segment"] == "price_sensitive":
        base_val = math.exp(random.gauss(7.7, 0.48))   # median ≈ ₹2.2k
    else:
        base_val = math.exp(random.gauss(8.0, 0.65))   # median ≈ ₹3k

    order_val = max(499.0, base_val * cust["order_mult"])
    if order_val > 10000:
        order_value = float(round(order_val / 100) * 100)
    else:
        order_value = float(round(order_val / 50) * 50)

    # --- Payment attempt number -------------------------------------------
    r = random.random()
    if r < 0.68:
        attempt_number = 1
    elif r < 0.90:
        attempt_number = 2
    else:
        attempt_number = 3

    # --- Failure reason & friction type (conditioned) ---------------------
    # Roughly 25-27% of incidents are price-friction / abandonment.
    # Higher order value + higher price sensitivity push toward price
    # friction (realistic: expensive products → more price hesitation).
    price_push = max(0.0, (order_value - 15000.0) / 50000.0) + (cust["price_sensitivity"] - 0.5) * 0.25
    ps_roll = random.random()

    if ps_roll < 0.20 or price_push > 0.42:
        failure_reason = "customer_abandonment"
        friction_type = "price"
    elif payment_method == "upi":
        r = random.random()
        if r < 0.42:
            failure_reason, friction_type = "authentication_failure", "technical"
        elif r < 0.70:
            failure_reason, friction_type = "technical_error", "technical"
        elif r < 0.86:
            failure_reason, friction_type = "insufficient_funds", "payment"
        else:
            failure_reason, friction_type = "customer_abandonment", "price"
    elif payment_method == "credit_card":
        r = random.random()
        if r < 0.42:
            failure_reason, friction_type = "bank_decline", "payment"
        elif r < 0.68:
            failure_reason, friction_type = "authentication_failure", "technical"
        elif r < 0.86:
            failure_reason, friction_type = "customer_abandonment", "price"
        else:
            failure_reason, friction_type = "expired_card", "payment"
    elif payment_method == "debit_card":
        r = random.random()
        if r < 0.34:
            failure_reason, friction_type = "insufficient_funds", "payment"
        elif r < 0.62:
            failure_reason, friction_type = "bank_decline", "payment"
        elif r < 0.82:
            failure_reason, friction_type = "authentication_failure", "technical"
        else:
            failure_reason, friction_type = "expired_card", "payment"
    elif payment_method == "bnpl":
        r = random.random()
        if r < 0.42:
            failure_reason, friction_type = "customer_abandonment", "price"
        elif r < 0.76:
            failure_reason, friction_type = "technical_error", "technical"
        else:
            failure_reason, friction_type = "authentication_failure", "technical"
    else:  # net_banking, wallet
        r = random.random()
        if r < 0.32:
            failure_reason, friction_type = "technical_error", "technical"
        elif r < 0.68:
            failure_reason, friction_type = "customer_abandonment", "price"
        elif r < 0.88:
            failure_reason, friction_type = "insufficient_funds", "payment"
        else:
            failure_reason, friction_type = "authentication_failure", "technical"

    # --- Baseline (counterfactual) conversion probability -----------------
    base_conv = {
        "bank_decline": 0.025, "insufficient_funds": 0.025, "price_friction": 0.038,
        "customer_abandonment": 0.042, "authentication_failure": 0.055,
        "expired_card": 0.030, "technical_error": 0.050,
    }.get(failure_reason, 0.04)

    if cust["segment"] == "returning":
        base_conv += 0.015
    elif cust["segment"] == "high_value":
        base_conv += 0.008

    if device_type == "desktop":
        base_conv += 0.006
    elif device_type == "tablet":
        base_conv += 0.004

    if attempt_number >= 2:
        base_conv += 0.008

    base_conv = clamp(base_conv - cust["base_conv_penalty"], 0.012, 0.088)
    baseline_conversion_probability = round(base_conv, 4)

    # --- Control assignment (12%) -----------------------------------------
    is_control = random.random() < 0.12
    treatment_group = "control" if is_control else "treatment"

    # --- Model (classifier) confidence ------------------------------------
    if failure_reason == "customer_abandonment":
        model_confidence = round(random.uniform(0.74, 0.88), 2)
    elif failure_reason == "technical_error":
        model_confidence = round(random.uniform(0.82, 0.94), 2)
    else:
        model_confidence = round(random.uniform(0.82, 0.96), 2)

    # =====================================================================
    # INTERVENTION TOURNAMENT
    # =====================================================================
    gross_profit = order_value * GROSS_MARGIN_RATIO
    mdr_cost = order_value * MDR_RATE

    cohort_key = f"{device_type}:{failure_reason}:{payment_method}"

    if is_control:
        intervention_type = "none"
        discount_percent = 0.0
        discount_amount = 0.0
        intervention_cost = 0.0
        expected_net_income = 0.0

        # Control: no model decision. predicted_probability = baseline w/ noise.
        predicted_probability = round(clamp(base_conv + random.gauss(0.0, 0.012), 0.02, 0.2), 3)

        control_rec = clamp(base_conv + random.gauss(0.0, 0.02), 0.005, 0.2)
        recovered = 1 if random.random() < control_rec else 0
        true_p = control_rec
    else:
        # Build candidate tournament (with policy eligibility baked in)
        candidates = build_candidates(
            friction_type, payment_method, failure_reason, order_value,
            baseline_conversion_probability, cust, attempt_number, model_confidence
        )

        eligible = [c for c in candidates if c["eligible"] and c["eni"] > -1e9]

        # ---- Thompson-style selection ----
        # For each eligible candidate, load its cohort history and DRAW
        # P_rec from the Beta posterior. Compute ENI with the DRAWN p.
        # Pick argmax. This creates natural variation when races are close,
        # and increasingly confident picks when one action is clearly better.
        best = None
        best_eni = float("-inf")
        for c in eligible:
            stats = get_cohort(cohort_key, c["type"], c["p_rec"])
            p_drawn = draw_p_rec(stats, c["p_rec"], model_confidence)
            c["_p_drawn"] = p_drawn
            # ENI using the drawn P_rec
            disc_amt = order_value * c["disc_pct"]
            net_gain = gross_profit - disc_amt - mdr_cost - c["cost"]
            eni_drawn = p_drawn * net_gain
            if eni_drawn > best_eni:
                best_eni = eni_drawn
                best = c

        if best is None:
            best = candidates[-1]
            best_eni = 0.0

        winner = best
        intervention_type = winner["type"]
        discount_percent = winner["disc_pct"]
        discount_amount = round(order_value * winner["disc_pct"], 2)
        intervention_cost = winner["cost"]

        # Expected Net Income from the winner (using its drawn P_rec)
        expected_net_income = round(best_eni, 2)

        # ---- Bayesian-calibrated predicted_probability ----
        # Every checkout has intrinsic difficulty: some customers simply won't
        # complete even with the right nudge. The model's predicted P_rec
        # tracks the difficulty-adjusted true probability with calibration
        # noise — good but not perfect.
        seg_difficulty = {
            "returning": 0.90, "high_value": 0.92,
            "new": 0.80, "price_sensitive": 0.84,
        }[cust["segment"]]
        difficulty = clamp(seg_difficulty * random.uniform(0.85, 1.05), 0.5, 1.0)
        true_p = clamp(winner["p_rec"] * difficulty, 0.02, 0.92)
        pred_p = clamp(true_p + random.gauss(0.0, 0.03)
                       + (0.02 if model_confidence >= 0.90 else -0.015), 0.02, 0.95)
        predicted_probability = round(pred_p, 3)

        # ---- Actual recovery outcome ----
        recovered = 1 if random.random() < true_p else 0

        # ---- Bayesian cohort update ----
        stats = get_cohort(cohort_key, intervention_type, winner["p_rec"])
        attempts, successes = stats
        attempts += 1
        if recovered:
            successes += 1
        cohort_tracker[(cohort_key, intervention_type)] = (attempts, successes)

    # =====================================================================
    # Financial / recovery metrics
    # =====================================================================
    if recovered == 1:
        recovered_gmv = round(order_value - discount_amount, 2)
        if treatment_group == "treatment":
            if intervention_type == "none":
                inc_share = 0.0
            else:
                p_rec_eff = true_p
                inc_share = clamp(1.0 - (baseline_conversion_probability / max(0.03, p_rec_eff)), 0.0, 0.95)
            incremental_gmv = round(recovered_gmv * inc_share, 2)
        else:
            incremental_gmv = 0.0

        revenue_saved = round(gross_profit - discount_amount - mdr_cost - intervention_cost, 2)
        time_to_recovery_seconds = int(min(895, max(18, math.exp(random.gauss(5.4, 0.8)))))
    else:
        recovered_gmv = 0.0
        incremental_gmv = 0.0
        revenue_saved = round(-intervention_cost, 2)
        time_to_recovery_seconds = None

    records.append({
        "incident_id": incident_id,
        "timestamp": ts_iso,
        "customer_id": cust_id,
        "session_id": session_id,
        "device_type": device_type,
        "traffic_source": traffic_source,
        "country": cust["country"],
        "region": cust["region"],
        "customer_segment": cust["segment"],
        "order_value": order_value,
        "currency": "INR",
        "payment_method": payment_method,
        "card_network": card_network,
        "payment_attempt_number": attempt_number,
        "payment_failure_reason": failure_reason,
        "friction_type": friction_type,
        "baseline_conversion_probability": baseline_conversion_probability,
        "predicted_probability": predicted_probability,
        "model_confidence": model_confidence,
        "treatment_group": treatment_group,
        "intervention_type": intervention_type,
        "discount_percent": discount_percent,
        "discount_amount": discount_amount,
        "expected_net_income": expected_net_income,
        "intervention_cost": intervention_cost,
        "recovered": recovered,
        "recovered_gmv": recovered_gmv,
        "incremental_gmv": incremental_gmv,
        "revenue_saved": revenue_saved,
        "time_to_recovery_seconds": time_to_recovery_seconds,
        "model_version": model_version,
        "experiment_id": experiment_id,
    })

print(f"Generated {len(records)} incident records.")

# ---------------------------------------------------------------------------
# 6. Write outputs
# ---------------------------------------------------------------------------
csv_filename = "synthetic_payment_recovery_data.csv"
fieldnames = list(records[0].keys())
csv_path = ARGS.out_dir.rstrip("/") + "/" + csv_filename
with open(csv_path, mode="w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    for r in records:
        writer.writerow({k: ("" if v is None else v) for k, v in r.items()})
print(f"Saved {csv_path} ({len(records)} rows)")

json_filename = "synthetic_payment_recovery_data.json"
json_path = ARGS.out_dir.rstrip("/") + "/" + json_filename
with open(json_path, mode="w", encoding="utf-8") as f:
    json.dump(records, f, indent=2)
print(f"Saved {json_path}")