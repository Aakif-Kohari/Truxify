# backend/ml/services/ab_testing.py

def evaluate_test(self, ...):
    # ... existing metric aggregation logic ...

    # BEFORE:
    # shadow_metrics = avg_metrics.get("shadow", {})

    # AFTER:
    # Use the dynamic shadow version key instead of the hardcoded literal string
    shadow_metrics = avg_metrics.get(shadow_version, {})
    prod_metrics = avg_metrics.get(prod_version, {})

    # ... remaining evaluation/promotion logic ...
