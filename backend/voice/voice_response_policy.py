from typing import Optional


def safe_sensitive_response(intent: str, lang_name: str = "Hindi") -> Optional[str]:
    """Return a non-assertive response for sensitive intents until authoritative state is available."""
    responses = {
        "cancel_order": (
            f"({lang_name}) I can’t confirm or complete order cancellation from this voice command "
            "because no cancellation was performed."
        ),
        "payment_status": (
            f"({lang_name}) I can’t confirm that your payment has been released "
            "without checking the authoritative payment status."
        ),
    }
    return responses.get(intent)
