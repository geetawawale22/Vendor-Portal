import re


VALID_UNITS = {"KG", "Ton", "Bag", "Piece", "Drum"}
VALID_BILLING_TYPES = {"Rate Per Trip", "Rate Per Ton"}
VALID_STATUSES = {"CREATED", "INTRANSIT", "DELAYED", "DELIVERED", "REJECTED"}


def is_valid_mobile(mobile: str) -> bool:
    return bool(re.fullmatch(r"[6-9]\d{9}", mobile or ""))
