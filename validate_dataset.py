#!/usr/bin/env python3
"""
Validation script for RIZE synthetic payment recovery dataset.
Prints a comprehensive validation report.
"""
import csv
import json
import math
from collections import Counter

print("=" * 70)
print("  RIZE SYNTHETIC DATASET VALIDATION REPORT")
print("=" * 70)

# Load CSV
rows = []
with open("synthetic_payment_recovery_data.csv", "r") as f:
    reader = csv.DictReader(f)
    for r in reader:
        rows.append(r)

N = len(rows)
print(f"\n1. ROW COUNT: {N}")
assert N >= 10000, f"FAIL: Expected >= 10000 rows, got {N}"
print("   ✅ PASS (>= 10,000 records)")

# Unique IDs
incident_ids = set(r["incident_id"] for r in rows)
print(f"\n2. UNIQUE INCIDENT IDs: {len(incident_ids)}")
assert len(incident_ids) == N, "FAIL: Duplicate incident IDs found"
print("   ✅ PASS (all unique)")

customer_ids = set(r["customer_id"] for r in rows)
print(f"\n3. UNIQUE CUSTOMERS: {len(customer_ids)}")
print(f"   Avg orders/customer: {N / len(customer_ids):.1f}")

# Recovery rates
total_recovered = sum(1 for r in rows if r["recovered"] == "1")
overall_rate = total_recovered / N
print(f"\n4. OVERALL RECOVERY RATE: {overall_rate:.4f} ({overall_rate*100:.1f}%)")

control_rows = [r for r in rows if r["treatment_group"] == "control"]
treatment_rows = [r for r in rows if r["treatment_group"] == "treatment"]

control_recovered = sum(1 for r in control_rows if r["recovered"] == "1")
treatment_recovered = sum(1 for r in treatment_rows if r["recovered"] == "1")

control_rate = control_recovered / len(control_rows) if control_rows else 0
treatment_rate = treatment_recovered / len(treatment_rows) if treatment_rows else 0

print(f"\n5. CONTROL vs TREATMENT:")
print(f"   Control group size:    {len(control_rows)} ({len(control_rows)/N*100:.1f}%)")
print(f"   Treatment group size:  {len(treatment_rows)} ({len(treatment_rows)/N*100:.1f}%)")
print(f"   Control recovery rate:   {control_rate:.4f} ({control_rate*100:.2f}%)")
print(f"   Treatment recovery rate: {treatment_rate:.4f} ({treatment_rate*100:.2f}%)")

# Incremental lift
if control_rate > 0:
    incremental_lift = (treatment_rate - control_rate) / control_rate
    print(f"\n6. INCREMENTAL LIFT: {incremental_lift:.4f} ({incremental_lift*100:.1f}%)")
else:
    incremental_lift = float('inf')
    print(f"\n6. INCREMENTAL LIFT: N/A (control rate = 0)")

# GMV
total_recovered_gmv = sum(float(r["recovered_gmv"]) for r in rows if r["recovered"] == "1")
total_incremental_gmv = sum(float(r["incremental_gmv"]) for r in rows if r["incremental_gmv"])
print(f"\n7. TOTAL RECOVERED GMV: ₹{total_recovered_gmv:,.0f}")
print(f"   Total Incremental GMV: ₹{total_incremental_gmv:,.0f}")

# Average order value
order_values = [float(r["order_value"]) for r in rows]
avg_ov = sum(order_values) / N
median_ov = sorted(order_values)[N // 2]
max_ov = max(order_values)
min_ov = min(order_values)
print(f"\n8. ORDER VALUE DISTRIBUTION:")
print(f"   Min: ₹{min_ov:,.0f}")
print(f"   Median: ₹{median_ov:,.0f}")
print(f"   Mean: ₹{avg_ov:,.0f}")
print(f"   Max: ₹{max_ov:,.0f}")

# Intervention distribution
interv_counts = Counter(r["intervention_type"] for r in rows)
print(f"\n9. INTERVENTION DISTRIBUTION:")
for k, v in sorted(interv_counts.items(), key=lambda x: -x[1]):
    pct = v / N * 100
    print(f"   {k:30s} {v:5d} ({pct:.1f}%)")

# Discount distribution (treatment only)
disc_counts = Counter(r["discount_percent"] for r in treatment_rows)
print(f"\n10. DISCOUNT DISTRIBUTION (treatment only):")
for k, v in sorted(disc_counts.items()):
    pct = v / len(treatment_rows) * 100
    print(f"    {k:10s} → {v:5d} ({pct:.1f}%)")

# Device distribution
dev_counts = Counter(r["device_type"] for r in rows)
print(f"\n11. DEVICE DISTRIBUTION:")
for k, v in sorted(dev_counts.items(), key=lambda x: -x[1]):
    print(f"    {k:10s} {v:5d} ({v/N*100:.1f}%)")

# Payment method distribution
pm_counts = Counter(r["payment_method"] for r in rows)
print(f"\n12. PAYMENT METHOD DISTRIBUTION:")
for k, v in sorted(pm_counts.items(), key=lambda x: -x[1]):
    print(f"    {k:15s} {v:5d} ({v/N*100:.1f}%)")

# Failure reason distribution
fr_counts = Counter(r["payment_failure_reason"] for r in rows)
print(f"\n13. FAILURE REASON DISTRIBUTION:")
for k, v in sorted(fr_counts.items(), key=lambda x: -x[1]):
    print(f"    {k:25s} {v:5d} ({v/N*100:.1f}%)")

# Customer segment distribution
seg_counts = Counter(r["customer_segment"] for r in rows)
print(f"\n14. CUSTOMER SEGMENT DISTRIBUTION:")
for k, v in sorted(seg_counts.items(), key=lambda x: -x[1]):
    print(f"    {k:20s} {v:5d} ({v/N*100:.1f}%)")

# Experiment distribution
exp_counts = Counter(r["experiment_id"] for r in rows)
print(f"\n15. EXPERIMENT DISTRIBUTION:")
for k, v in sorted(exp_counts.items()):
    print(f"    {k}: {v} records")

# Brier Score calculation
print(f"\n16. BRIER SCORE CALCULATION:")
brier_sum = 0.0
calibration_count = 0
for r in rows:
    pred = float(r["predicted_probability"])
    actual = int(r["recovered"])
    brier_sum += (pred - actual) ** 2
    calibration_count += 1
brier_score = brier_sum / calibration_count
print(f"    Brier Score: {brier_score:.4f}")
if 0.15 <= brier_score <= 0.30:
    print(f"    ✅ In target range [0.15 - 0.30]")
else:
    print(f"    ⚠️  Outside target range [0.15 - 0.30]")

# Calibration buckets (decile)
print(f"\n17. CALIBRATION CURVE (Decile Buckets):")
sorted_rows = sorted(rows, key=lambda r: float(r["predicted_probability"]))
decile_size = math.ceil(len(sorted_rows) / 10)
print(f"    {'Decile':<8} {'Pred P':>8} {'Actual':>8} {'Count':>7} {'Gap':>8}")
for d in range(10):
    start = d * decile_size
    end = min(start + decile_size, len(sorted_rows))
    bucket = sorted_rows[start:end]
    avg_pred = sum(float(r["predicted_probability"]) for r in bucket) / len(bucket)
    avg_actual = sum(int(r["recovered"]) for r in bucket) / len(bucket)
    gap = abs(avg_pred - avg_actual)
    print(f"    {d+1:<8} {avg_pred:>8.3f} {avg_actual:>8.3f} {len(bucket):>7} {gap:>8.3f}")

# Cohort sizes
cohort_counts = Counter(r["payment_failure_reason"] + ":" + r["device_type"] for r in rows)
print(f"\n18. TOP COHORT COMBINATIONS (failure:device):")
for k, v in sorted(cohort_counts.items(), key=lambda x: -x[1])[:10]:
    print(f"    {k:40s} {v:5d}")

# Data quality checks
print(f"\n19. DATA QUALITY CHECKS:")
issues = 0

# Check: recovered=0 -> recovered_gmv=0
bad_gmv = sum(1 for r in rows if r["recovered"] == "0" and float(r["recovered_gmv"]) != 0)
if bad_gmv:
    print(f"    ❌ {bad_gmv} rows with recovered=0 but recovered_gmv != 0")
    issues += 1
else:
    print(f"    ✅ All recovered=0 rows have recovered_gmv=0")

# Check: control -> intervention_type=none
bad_ctrl = sum(1 for r in rows if r["treatment_group"] == "control" and r["intervention_type"] != "none")
if bad_ctrl:
    print(f"    ❌ {bad_ctrl} control rows with intervention != none")
    issues += 1
else:
    print(f"    ✅ All control rows have intervention_type=none")

# Check: discount_percent=0 -> discount_amount=0
bad_disc = sum(1 for r in rows if float(r["discount_percent"]) == 0 and float(r["discount_amount"]) != 0)
if bad_disc:
    print(f"    ❌ {bad_disc} rows with discount_percent=0 but discount_amount != 0")
    issues += 1
else:
    print(f"    ✅ Discount consistency check passed")

# Check: no nulls in critical columns
critical = ["incident_id", "timestamp", "customer_id", "order_value", "treatment_group", "recovered"]
for col in critical:
    nulls = sum(1 for r in rows if not r[col])
    if nulls:
        print(f"    ❌ {nulls} null values in {col}")
        issues += 1

if issues == 0:
    print(f"    ✅ All data quality checks passed!")

# Intervention performance by cohort
print(f"\n20. INTERVENTION PERFORMANCE BY FRICTION TYPE (treatment only):")
friction_types = set(r["friction_type"] for r in treatment_rows)
for ft in sorted(friction_types):
    ft_rows = [r for r in treatment_rows if r["friction_type"] == ft]
    interv_types = set(r["intervention_type"] for r in ft_rows)
    print(f"\n    {ft.upper()} friction ({len(ft_rows)} records):")
    for it in sorted(interv_types):
        it_rows = [r for r in ft_rows if r["intervention_type"] == it]
        rec_rate = sum(1 for r in it_rows if r["recovered"] == "1") / len(it_rows) if it_rows else 0
        avg_eni = sum(float(r["expected_net_income"]) for r in it_rows) / len(it_rows) if it_rows else 0
        print(f"      {it:30s} n={len(it_rows):>5}  recovery={rec_rate*100:>5.1f}%  avg_ENI=₹{avg_eni:>8.0f}")

# Approval queue simulation
print(f"\n21. HIGH-ENI APPROVAL QUEUE SIMULATION:")
high_eni = [r for r in treatment_rows if float(r["expected_net_income"]) > 5000]
print(f"    Records with ENI > ₹5,000 (tauApprove): {len(high_eni)}")
print(f"    Percentage of treatment: {len(high_eni)/len(treatment_rows)*100:.1f}%")
if high_eni:
    avg_ov_queue = sum(float(r["order_value"]) for r in high_eni) / len(high_eni)
    print(f"    Avg order value in queue: ₹{avg_ov_queue:,.0f}")

print(f"\n{'=' * 70}")
print(f"  VALIDATION COMPLETE")
print(f"{'=' * 70}")
