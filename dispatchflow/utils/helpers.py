import os
from datetime import datetime

from werkzeug.utils import secure_filename

from ..models import Dispatch


def allowed_file(filename: str, allowed_extensions: set[str]) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in allowed_extensions


def save_upload(file_storage, upload_dir: str, allowed_extensions: set[str]) -> str | None:
    if not file_storage or file_storage.filename == "":
        return None

    if not allowed_file(file_storage.filename, allowed_extensions):
        return None

    safe_name = secure_filename(file_storage.filename)
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
    filename = f"{timestamp}_{safe_name}"
    full_path = os.path.join(upload_dir, filename)
    file_storage.save(full_path)
    return filename


def generate_shipment_number() -> str:
    year = datetime.utcnow().year
    prefix = f"SHIP-{year}-"
    count = Dispatch.query.filter(Dispatch.shipment_number.like(f"{prefix}%")).count()
    sequence = count + 1
    return f"{prefix}{sequence:04d}"
