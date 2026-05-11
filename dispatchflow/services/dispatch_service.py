import os
from datetime import datetime

from ..extensions import db
from ..models import ASNEntry, Dispatch
from ..utils.helpers import save_upload
from ..utils.validators import VALID_BILLING_TYPES, VALID_STATUSES, VALID_UNITS, is_valid_mobile


class DispatchValidationError(Exception):
    pass


def _parse_date(value: str):
    if not value:
        return None
    for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def _to_kg(value: float, unit: str) -> float:
    return value * 1000.0 if unit == "Ton" else value


def _parse_dispatch_form(form, files, upload_folder: str, allowed_extensions: set[str]) -> dict:
    required_fields = [
        "vendor_name",
        "vehicle_number",
        "vehicle_type",
        "transporter_name",
        "driver_name",
        "driver_mobile",
        "empty_vehicle_weight",
        "empty_vehicle_weight_unit",
        "loaded_vehicle_weight",
        "loaded_vehicle_weight_unit",
        "vehicle_capacity",
        "vehicle_capacity_unit",
        "billing_type",
        "rate_amount",
    ]

    missing = [name for name in required_fields if not str(form.get(name, "")).strip()]
    if missing:
        raise DispatchValidationError("Please fill all mandatory fields.")

    try:
        empty_weight = float(form["empty_vehicle_weight"])
        loaded_weight = float(form["loaded_vehicle_weight"])
        vehicle_capacity = float(form["vehicle_capacity"])
        rate_amount = float(form["rate_amount"])
    except ValueError as exc:
        raise DispatchValidationError("Numeric values are invalid.") from exc

    empty_unit = str(form["empty_vehicle_weight_unit"]).strip()
    loaded_unit = str(form["loaded_vehicle_weight_unit"]).strip()
    capacity_unit = str(form["vehicle_capacity_unit"]).strip()

    valid_weight_units = {"KG", "Ton"}
    if empty_unit not in valid_weight_units or loaded_unit not in valid_weight_units or capacity_unit not in valid_weight_units:
        raise DispatchValidationError("Invalid weight/capacity unit selected.")

    empty_kg = _to_kg(empty_weight, empty_unit)
    loaded_kg = _to_kg(loaded_weight, loaded_unit)
    capacity_kg = _to_kg(vehicle_capacity, capacity_unit)

    if capacity_kg <= 0 or rate_amount <= 0:
        raise DispatchValidationError("Vehicle capacity and rate amount must be greater than 0.")

    net_weight_kg = abs(loaded_kg - empty_kg)
    if net_weight_kg > capacity_kg:
        raise DispatchValidationError("Net material weight cannot exceed vehicle capacity.")

    billing_type = str(form["billing_type"])
    if billing_type not in VALID_BILLING_TYPES:
        raise DispatchValidationError("Invalid billing type selected.")

    if billing_type == "Rate Per Ton" and net_weight_kg == 0:
        raise DispatchValidationError("For Rate Per Ton, net weight must be greater than 0.")

    driver_mobile = str(form["driver_mobile"]).strip()
    if not is_valid_mobile(driver_mobile):
        raise DispatchValidationError("Driver mobile number should be a valid 10-digit number.")

    asn_numbers = form.getlist("asn_number[]")
    invoice_numbers = form.getlist("invoice_number[]")
    asn_material_types = form.getlist("asn_material_type[]")
    asn_quantities = form.getlist("asn_quantity[]")
    asn_units = form.getlist("asn_unit[]")

    parsed_asn_rows = []
    seen_asn_numbers = set()
    asn_total_quantity = 0.0

    for index, asn_number in enumerate(asn_numbers):
        asn_number = str(asn_number).strip()
        if not asn_number:
            continue

        invoice_number = str(invoice_numbers[index] if index < len(invoice_numbers) else "").strip()
        material_type = str(asn_material_types[index] if index < len(asn_material_types) else "").strip()
        asn_unit = str(asn_units[index] if index < len(asn_units) else "").strip()

        asn_weight_values = form.getlist("asn_material_weight[]")
        asn_weight_unit_values = form.getlist("asn_material_weight_unit[]")
        asn_weight_raw = str(asn_weight_values[index] if index < len(asn_weight_values) else "").strip()
        asn_weight_unit = str(asn_weight_unit_values[index] if index < len(asn_weight_unit_values) else "KG").strip()

        try:
            asn_quantity = float(asn_quantities[index])
        except (ValueError, TypeError, IndexError) as exc:
            raise DispatchValidationError("ASN quantity is invalid.") from exc

        asn_material_weight = None
        if asn_weight_raw:
            try:
                asn_material_weight = float(asn_weight_raw)
            except ValueError as exc:
                raise DispatchValidationError("ASN material weight is invalid.") from exc

        if asn_number in seen_asn_numbers:
            raise DispatchValidationError("Duplicate ASN numbers are not allowed.")

        if not invoice_number or not material_type:
            raise DispatchValidationError("ASN invoice number and material type are mandatory.")

        if asn_quantity <= 0:
            raise DispatchValidationError("ASN quantity must be greater than 0.")

        if asn_unit not in VALID_UNITS:
            raise DispatchValidationError("Invalid ASN unit selected.")

        seen_asn_numbers.add(asn_number)
        asn_total_quantity += asn_quantity
        parsed_asn_rows.append(
            {
                "asn_number": asn_number,
                "invoice_number": invoice_number,
                "material_type": material_type,
                "quantity": asn_quantity,
                "unit": asn_unit,
                "material_weight": asn_material_weight,
                "material_weight_unit": asn_weight_unit or "KG",
            }
        )

    if not parsed_asn_rows:
        raise DispatchValidationError("At least one ASN entry is required.")

    invoice_filename = save_upload(
        files.get("invoice_upload"),
        os.path.join(upload_folder, "invoice"),
        allowed_extensions,
    )
    invoice_upload = files.get("invoice_upload")
    if invoice_upload and invoice_upload.filename and not invoice_filename:
        raise DispatchValidationError("Invalid invoice upload format. Allowed: PDF, JPG, PNG.")

    asn_filename = save_upload(
        files.get("asn_upload"),
        os.path.join(upload_folder, "asn"),
        allowed_extensions,
    )
    asn_upload = files.get("asn_upload")
    if asn_upload and asn_upload.filename and not asn_filename:
        raise DispatchValidationError("Invalid ASN upload format. Allowed: PDF, JPG, PNG.")

    total_cost = rate_amount
    if billing_type == "Rate Per Ton":
        chargeable_tons = min(net_weight_kg, capacity_kg) / 1000.0
        total_cost = rate_amount * chargeable_tons

    return {
        "vendor_name": str(form["vendor_name"]).strip(),
        "vehicle_number": str(form["vehicle_number"]).strip().upper(),
        "vehicle_type": str(form["vehicle_type"]).strip(),
        "transporter_name": str(form["transporter_name"]).strip(),
        "driver_name": str(form["driver_name"]).strip(),
        "driver_mobile": driver_mobile,
        "empty_vehicle_weight": empty_weight,
        "empty_vehicle_weight_unit": empty_unit,
        "loaded_vehicle_weight": loaded_weight,
        "loaded_vehicle_weight_unit": loaded_unit,
        "net_material_weight": net_weight_kg,
        "vehicle_capacity": vehicle_capacity,
        "vehicle_capacity_unit": capacity_unit,
        "billing_type": billing_type,
        "rate_amount": rate_amount,
        "total_cost": total_cost,
        "invoice_file": invoice_filename,
        "asn_file": asn_filename,
        "asn_rows": parsed_asn_rows,
        "material_type": parsed_asn_rows[0]["material_type"],
        "quantity": asn_total_quantity,
        "unit": parsed_asn_rows[0]["unit"],
        "delivered_to": str(form.get("delivered_to", "") or "").strip(),
        "delivery_date": str(form.get("delivery_date", "") or "").strip(),
        "receiver_contact_person": str(form.get("receiver_contact_person", "") or "").strip(),
        "receiver_mobile": str(form.get("receiver_mobile", "") or "").strip(),
        "delivery_location": str(form.get("delivery_location", "") or "").strip(),
    }


def create_dispatch_record(form, files, upload_folder: str, allowed_extensions: set[str]) -> Dispatch:
    parsed = _parse_dispatch_form(form, files, upload_folder, allowed_extensions)
    dispatch = Dispatch(
        vendor_name=parsed["vendor_name"],
        vehicle_number=parsed["vehicle_number"],
        vehicle_type=parsed["vehicle_type"],
        transporter_name=parsed["transporter_name"],
        driver_name=parsed["driver_name"],
        driver_mobile=parsed["driver_mobile"],
        material_type=parsed["material_type"],
        quantity=parsed["quantity"],
        unit=parsed["unit"],
        empty_vehicle_weight=parsed["empty_vehicle_weight"],
        empty_vehicle_weight_unit=parsed["empty_vehicle_weight_unit"],
        loaded_vehicle_weight=parsed["loaded_vehicle_weight"],
        loaded_vehicle_weight_unit=parsed["loaded_vehicle_weight_unit"],
        net_material_weight=parsed["net_material_weight"],
        vehicle_capacity=parsed["vehicle_capacity"],
        vehicle_capacity_unit=parsed["vehicle_capacity_unit"],
        billing_type=parsed["billing_type"],
        rate_amount=parsed["rate_amount"],
        total_cost=parsed["total_cost"],
        invoice_file=parsed["invoice_file"],
        asn_file=parsed["asn_file"],
        delivered_to=parsed["delivered_to"] or None,
        delivery_date=_parse_date(parsed["delivery_date"]),
        receiver_contact_person=parsed["receiver_contact_person"] or None,
        receiver_mobile=parsed["receiver_mobile"] or None,
        delivery_location=parsed["delivery_location"] or None,
        status="CREATED",
    )

    dispatch.asn_entries = [
        ASNEntry(
            asn_number=row["asn_number"],
            invoice_number=row["invoice_number"],
            material_type=row["material_type"],
            quantity=row["quantity"],
            unit=row["unit"],
            material_weight=row.get("material_weight"),
            material_weight_unit=row.get("material_weight_unit", "KG"),
        )
        for row in parsed["asn_rows"]
    ]

    return dispatch


def update_dispatch_record(dispatch: Dispatch, form, files, upload_folder: str, allowed_extensions: set[str]):
    parsed = _parse_dispatch_form(form, files, upload_folder, allowed_extensions)

    dispatch.vendor_name = parsed["vendor_name"]
    dispatch.vehicle_number = parsed["vehicle_number"]
    dispatch.vehicle_type = parsed["vehicle_type"]
    dispatch.transporter_name = parsed["transporter_name"]
    dispatch.driver_name = parsed["driver_name"]
    dispatch.driver_mobile = parsed["driver_mobile"]
    dispatch.material_type = parsed["material_type"]
    dispatch.quantity = parsed["quantity"]
    dispatch.unit = parsed["unit"]
    dispatch.empty_vehicle_weight = parsed["empty_vehicle_weight"]
    dispatch.empty_vehicle_weight_unit = parsed["empty_vehicle_weight_unit"]
    dispatch.loaded_vehicle_weight = parsed["loaded_vehicle_weight"]
    dispatch.loaded_vehicle_weight_unit = parsed["loaded_vehicle_weight_unit"]
    dispatch.net_material_weight = parsed["net_material_weight"]
    dispatch.vehicle_capacity = parsed["vehicle_capacity"]
    dispatch.vehicle_capacity_unit = parsed["vehicle_capacity_unit"]
    dispatch.billing_type = parsed["billing_type"]
    dispatch.rate_amount = parsed["rate_amount"]
    dispatch.total_cost = parsed["total_cost"]
    if parsed["invoice_file"]:
        dispatch.invoice_file = parsed["invoice_file"]
    if parsed["asn_file"]:
        dispatch.asn_file = parsed["asn_file"]
    dispatch.delivered_to = parsed["delivered_to"] or None
    dispatch.delivery_date = _parse_date(parsed["delivery_date"])
    dispatch.receiver_contact_person = parsed["receiver_contact_person"] or None
    dispatch.receiver_mobile = parsed["receiver_mobile"] or None
    dispatch.delivery_location = parsed["delivery_location"] or None

    dispatch.asn_entries.clear()
    db.session.flush()
    dispatch.asn_entries = [
        ASNEntry(
            asn_number=row["asn_number"],
            invoice_number=row["invoice_number"],
            material_type=row["material_type"],
            quantity=row["quantity"],
            unit=row["unit"],
            material_weight=row.get("material_weight"),
            material_weight_unit=row.get("material_weight_unit", "KG"),
        )
        for row in parsed["asn_rows"]
    ]


def update_dispatch_status_record(dispatch: Dispatch, payload: dict):
    status = str(payload.get("status", "")).strip()
    current_location = str(payload.get("current_location", "")).strip()
    driver_remarks = str(payload.get("driver_remarks", "")).strip()
    delay_reason = str(payload.get("delay_reason", "")).strip()
    eta_raw = str(payload.get("estimated_arrival_time", "")).strip()

    if status not in VALID_STATUSES:
        raise DispatchValidationError("Invalid shipment status.")

    if dispatch.status in ("DELIVERED", "REJECTED"):
        raise DispatchValidationError(f"Shipment is already marked as {dispatch.status}. No further updates allowed.")

    if status == "DELAYED" and not delay_reason:
        raise DispatchValidationError("Reason for Delay is required.")
    if status == "REJECTED" and not driver_remarks:
        raise DispatchValidationError("Reason for Rejection is required.")

    eta = None
    if eta_raw:
        try:
            eta = datetime.strptime(eta_raw, "%Y-%m-%dT%H:%M")
        except ValueError as exc:
            raise DispatchValidationError("Estimated arrival time format is invalid.") from exc

    dispatch.status = status
    dispatch.current_location = current_location
    dispatch.driver_remarks = driver_remarks
    dispatch.delay_reason = delay_reason
    dispatch.estimated_arrival_time = eta

    if status == "DELIVERED" and not dispatch.delivered_at:
        dispatch.delivered_at = datetime.utcnow()


def upload_delivery_documents_record(dispatch: Dispatch, files, upload_folder: str, allowed_extensions: set[str]):
    challan = files.get("delivery_challan")
    signed_invoice = files.get("signed_invoice")

    challan_name = save_upload(
        challan,
        os.path.join(upload_folder, "delivery"),
        allowed_extensions,
    )
    if challan and challan.filename and not challan_name:
        raise DispatchValidationError("Invalid delivery challan format. Allowed: PDF, JPG, PNG.")

    signed_invoice_name = save_upload(
        signed_invoice,
        os.path.join(upload_folder, "signed_invoice"),
        allowed_extensions,
    )
    if signed_invoice and signed_invoice.filename and not signed_invoice_name:
        raise DispatchValidationError("Invalid signed invoice format. Allowed: PDF, JPG, PNG.")

    if not challan_name and not signed_invoice_name:
        raise DispatchValidationError("Please upload at least one file.")

    if challan_name:
        dispatch.delivery_challan_file = challan_name
    if signed_invoice_name:
        dispatch.signed_invoice_file = signed_invoice_name


def serialize_asn_entry(entry: ASNEntry):
    return {
        "id": entry.id,
        "dispatchId": entry.dispatch_id,
        "asnNumber": entry.asn_number,
        "invoiceNumber": entry.invoice_number,
        "materialType": entry.material_type,
        "quantity": entry.quantity,
        "unit": entry.unit,
        "materialWeight": entry.material_weight,
        "materialWeightUnit": entry.material_weight_unit or "KG",
        "createdAt": entry.created_at.isoformat() if entry.created_at else None,
    }


def serialize_dispatch(dispatch: Dispatch, include_relations: bool = False):
    has_delivery_proof = bool(dispatch.delivery_challan_file or dispatch.signed_invoice_file)
    payload = {
        "id": dispatch.id,
        "shipmentNumber": dispatch.shipment_number,
        "vendorName": dispatch.vendor_name,
        "vehicleNumber": dispatch.vehicle_number,
        "vehicleType": dispatch.vehicle_type,
        "transporterName": dispatch.transporter_name,
        "driverName": dispatch.driver_name,
        "driverMobile": dispatch.driver_mobile,
        "materialType": dispatch.material_type,
        "quantity": dispatch.quantity,
        "unit": dispatch.unit,
        "emptyVehicleWeight": dispatch.empty_vehicle_weight,
        "emptyVehicleWeightUnit": dispatch.empty_vehicle_weight_unit,
        "loadedVehicleWeight": dispatch.loaded_vehicle_weight,
        "loadedVehicleWeightUnit": dispatch.loaded_vehicle_weight_unit,
        "netMaterialWeight": dispatch.net_material_weight,
        "vehicleCapacity": dispatch.vehicle_capacity,
        "vehicleCapacityUnit": dispatch.vehicle_capacity_unit,
        "billingType": dispatch.billing_type,
        "rateAmount": dispatch.rate_amount,
        "totalCost": dispatch.total_cost,
        "currentLocation": dispatch.current_location,
        "driverRemarks": dispatch.driver_remarks,
        "delayReason": dispatch.delay_reason,
        "estimatedArrivalTime": dispatch.estimated_arrival_time.isoformat() if dispatch.estimated_arrival_time else None,
        "status": dispatch.status,
        "createdAt": dispatch.created_at.isoformat() if dispatch.created_at else None,
        "updatedAt": dispatch.updated_at.isoformat() if dispatch.updated_at else None,
        "confirmedAt": dispatch.confirmed_at.isoformat() if dispatch.confirmed_at else None,
        "deliveredAt": dispatch.delivered_at.isoformat() if dispatch.delivered_at else None,
        "deliveryConfirmed": dispatch.status == "DELIVERED",
        "hasDeliveryProof": has_delivery_proof,
        "deliveredTo": dispatch.delivered_to,
        "deliveryDate": dispatch.delivery_date.isoformat() if dispatch.delivery_date else None,
        "receiverContactPerson": dispatch.receiver_contact_person,
        "receiverMobile": dispatch.receiver_mobile,
        "deliveryLocation": dispatch.delivery_location,
        "documents": {
            "invoice": _file_payload("invoice", dispatch.invoice_file),
            "asn": _file_payload("asn", dispatch.asn_file),
            "deliveryChallan": _file_payload("delivery", dispatch.delivery_challan_file),
            "signedInvoice": _file_payload("signed_invoice", dispatch.signed_invoice_file),
        },
    }

    if include_relations:
        payload["asnEntries"] = [serialize_asn_entry(entry) for entry in dispatch.asn_entries]
        payload["statusLogs"] = [
            {
                "id": log.id,
                "status": log.status,
                "currentLocation": log.current_location,
                "driverRemarks": log.driver_remarks,
                "delayReason": log.delay_reason,
                "estimatedArrivalTime": log.estimated_arrival_time.isoformat() if log.estimated_arrival_time else None,
                "updatedAt": log.updated_at.isoformat() if log.updated_at else None,
            }
            for log in sorted(dispatch.status_logs, key=lambda item: item.updated_at or datetime.min, reverse=True)
        ]

    return payload


def _file_payload(category: str, filename: str | None):
    if not filename:
        return None
    return {
        "filename": filename,
        "url": f"/api/files/{category}/{filename}",
    }
