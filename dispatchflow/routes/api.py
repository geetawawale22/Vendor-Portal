import os
from datetime import datetime

from flask import Blueprint, current_app, jsonify, request, send_from_directory, session
from sqlalchemy import func
from werkzeug.security import check_password_hash

from ..extensions import db
from ..models import ASNEntry, Dispatch, User
from ..services.dispatch_service import (
    DispatchValidationError,
    create_dispatch_record,
    serialize_asn_entry,
    serialize_dispatch,
    update_dispatch_record,
    update_dispatch_status_record,
    upload_delivery_documents_record,
)
from ..utils.auth import api_login_required
from ..utils.helpers import generate_shipment_number
from ..utils.validators import VALID_BILLING_TYPES, VALID_STATUSES, VALID_UNITS
from .dispatch import add_status_log_if_needed

api_bp = Blueprint("api", __name__, url_prefix="/api")


def _json_error(message: str, status_code: int):
    response = jsonify({"message": message})
    response.status_code = status_code
    return response


def _session_payload():
    return {
        "isAuthenticated": "user_id" in session,
        "user": {
            "id": session.get("user_id"),
            "username": session.get("username"),
        }
        if session.get("user_id")
        else None,
        "meta": {
            "statuses": sorted(VALID_STATUSES),
            "billingTypes": sorted(VALID_BILLING_TYPES),
            "units": sorted(VALID_UNITS),
            "weightUnits": ["KG", "Ton"],
        },
    }


@api_bp.route("/auth/session")
def auth_session():
    return jsonify(_session_payload())


@api_bp.route("/auth/login", methods=["POST"])
def auth_login():
    payload = request.get_json(silent=True) or {}
    identity = str(payload.get("identity", "")).strip()
    password = str(payload.get("password", ""))

    user = User.query.filter((User.username == identity) | (User.email == identity)).first()
    if not user or not check_password_hash(user.password_hash, password):
        return _json_error("Invalid username/email or password.", 401)

    session["user_id"] = user.id
    session["username"] = user.username
    session.permanent = True
    return jsonify({"message": "Login successful.", **_session_payload()})


@api_bp.route("/auth/logout", methods=["POST"])
def auth_logout():
    session.clear()
    return jsonify({"message": "Logged out successfully.", **_session_payload()})


@api_bp.route("/dashboard")
@api_login_required
def dashboard_data():
    recent_dispatches = Dispatch.query.order_by(Dispatch.created_at.desc()).limit(8).all()
    return jsonify(
        {
            "stats": {
                "totalDispatches": Dispatch.query.count(),
                "inTransitShipments": Dispatch.query.filter_by(status="INTRANSIT").count(),
                "deliveredShipments": Dispatch.query.filter_by(status="DELIVERED").count(),
                "pendingDeliveries": Dispatch.query.filter(Dispatch.status != "DELIVERED").count(),
            },
            "recentDispatches": [serialize_dispatch(dispatch) for dispatch in recent_dispatches],
        }
    )


@api_bp.route("/dispatches")
@api_login_required
def list_dispatches_data():
    dispatches = Dispatch.query.order_by(Dispatch.created_at.desc()).all()
    return jsonify({"dispatches": [serialize_dispatch(dispatch) for dispatch in dispatches]})


@api_bp.route("/dispatches", methods=["POST"])
@api_login_required
def create_dispatch_data():
    try:
        dispatch = create_dispatch_record(
            request.form,
            request.files,
            current_app.config["UPLOAD_FOLDER"],
            current_app.config["ALLOWED_EXTENSIONS"],
        )
        db.session.add(dispatch)
        db.session.commit()
    except DispatchValidationError as exc:
        db.session.rollback()
        return _json_error(str(exc), 400)

    return jsonify({"message": "Dispatch created successfully.", "dispatch": serialize_dispatch(dispatch, True)})


@api_bp.route("/dispatches/<int:dispatch_id>")
@api_login_required
def get_dispatch_data(dispatch_id: int):
    dispatch = Dispatch.query.get_or_404(dispatch_id)
    return jsonify({"dispatch": serialize_dispatch(dispatch, True)})


@api_bp.route("/dispatches/<int:dispatch_id>", methods=["PUT"])
@api_login_required
def update_dispatch_data(dispatch_id: int):
    dispatch = Dispatch.query.get_or_404(dispatch_id)
    if dispatch.status != "CREATED":
        return _json_error("Only CREATED dispatches can be edited.", 400)

    try:
        update_dispatch_record(
            dispatch,
            request.form,
            request.files,
            current_app.config["UPLOAD_FOLDER"],
            current_app.config["ALLOWED_EXTENSIONS"],
        )
        db.session.commit()
    except DispatchValidationError as exc:
        db.session.rollback()
        return _json_error(str(exc), 400)

    return jsonify({"message": "Dispatch updated successfully.", "dispatch": serialize_dispatch(dispatch, True)})


@api_bp.route("/dispatches/<int:dispatch_id>/confirm", methods=["POST"])
@api_login_required
def confirm_dispatch_data(dispatch_id: int):
    dispatch = Dispatch.query.get_or_404(dispatch_id)
    if dispatch.status != "CREATED":
        return _json_error("Only CREATED shipments can be confirmed.", 400)

    dispatch.shipment_number = generate_shipment_number()
    dispatch.status = "INTRANSIT"
    dispatch.confirmed_at = datetime.utcnow()
    add_status_log_if_needed(
        dispatch.id,
        "INTRANSIT",
        dispatch.current_location,
        dispatch.driver_remarks,
        dispatch.delay_reason,
        dispatch.estimated_arrival_time,
    )
    db.session.commit()
    return jsonify({"message": "Dispatch confirmed.", "dispatch": serialize_dispatch(dispatch, True)})


@api_bp.route("/dispatches/<int:dispatch_id>/status", methods=["POST"])
@api_login_required
def update_dispatch_status_data(dispatch_id: int):
    dispatch = Dispatch.query.get_or_404(dispatch_id)
    payload = request.get_json(silent=True) or {}

    try:
        update_dispatch_status_record(dispatch, payload)
    except DispatchValidationError as exc:
        db.session.rollback()
        return _json_error(str(exc), 400)

    add_status_log_if_needed(
        dispatch.id,
        dispatch.status,
        dispatch.current_location,
        dispatch.driver_remarks,
        dispatch.delay_reason,
        dispatch.estimated_arrival_time,
    )
    db.session.commit()
    return jsonify({"message": "Dispatch status updated successfully.", "dispatch": serialize_dispatch(dispatch, True)})


@api_bp.route("/dispatches/<int:dispatch_id>/delivery-documents", methods=["POST"])
@api_login_required
def upload_delivery_documents_data(dispatch_id: int):
    dispatch = Dispatch.query.get_or_404(dispatch_id)

    try:
        upload_delivery_documents_record(
            dispatch,
            request.files,
            current_app.config["UPLOAD_FOLDER"],
            current_app.config["ALLOWED_EXTENSIONS"],
        )
        db.session.commit()
    except DispatchValidationError as exc:
        db.session.rollback()
        return _json_error(str(exc), 400)

    return jsonify({"message": "Delivery documents uploaded successfully.", "dispatch": serialize_dispatch(dispatch, True)})


@api_bp.route("/dispatches/<int:dispatch_id>/confirm-delivery", methods=["POST"])
@api_login_required
def confirm_delivery_data(dispatch_id: int):
    dispatch = Dispatch.query.get_or_404(dispatch_id)
    if dispatch.status == "DELIVERED":
        return _json_error("Delivery has already been confirmed for this shipment.", 400)
    if dispatch.status == "CREATED":
        return _json_error("Confirm the dispatch before marking delivery complete.", 400)
    if not (dispatch.delivery_challan_file or dispatch.signed_invoice_file):
        return _json_error("Upload delivery proof before confirming delivery.", 400)

    dispatch.status = "DELIVERED"
    dispatch.delivered_at = datetime.utcnow()
    add_status_log_if_needed(
        dispatch.id,
        "DELIVERED",
        dispatch.current_location,
        dispatch.driver_remarks,
        dispatch.delay_reason,
        dispatch.estimated_arrival_time,
    )
    db.session.commit()
    return jsonify({"message": "Delivery confirmed.", "dispatch": serialize_dispatch(dispatch, True)})


@api_bp.route("/reports")
@api_login_required
def reports_data():
    date_from = request.args.get("date_from", "").strip()
    date_to = request.args.get("date_to", "").strip()
    vehicle_number = request.args.get("vehicle_number", "").strip()
    asn_number = request.args.get("asn_number", "").strip()
    vendor_name = request.args.get("vendor_name", "").strip()
    transporter_name = request.args.get("transporter_name", "").strip()
    status = request.args.get("status", "").strip()

    dispatch_query = Dispatch.query
    if date_from:
        dispatch_query = dispatch_query.filter(Dispatch.created_at >= f"{date_from} 00:00:00")
    if date_to:
        dispatch_query = dispatch_query.filter(Dispatch.created_at <= f"{date_to} 23:59:59")
    if vehicle_number:
        dispatch_query = dispatch_query.filter(Dispatch.vehicle_number.ilike(f"%{vehicle_number}%"))
    if vendor_name:
        dispatch_query = dispatch_query.filter(Dispatch.vendor_name.ilike(f"%{vendor_name}%"))
    if transporter_name:
        dispatch_query = dispatch_query.filter(Dispatch.transporter_name.ilike(f"%{transporter_name}%"))
    if status:
        dispatch_query = dispatch_query.filter(Dispatch.status == status)
    if asn_number:
        dispatch_query = dispatch_query.join(ASNEntry).filter(ASNEntry.asn_number.ilike(f"%{asn_number}%"))

    dispatch_report = dispatch_query.distinct().order_by(Dispatch.created_at.desc()).all()
    delivery_report = [dispatch for dispatch in dispatch_report if dispatch.status == "DELIVERED"]

    asn_query = ASNEntry.query.join(Dispatch)
    if date_from:
        asn_query = asn_query.filter(Dispatch.created_at >= f"{date_from} 00:00:00")
    if date_to:
        asn_query = asn_query.filter(Dispatch.created_at <= f"{date_to} 23:59:59")
    if vehicle_number:
        asn_query = asn_query.filter(Dispatch.vehicle_number.ilike(f"%{vehicle_number}%"))
    if vendor_name:
        asn_query = asn_query.filter(Dispatch.vendor_name.ilike(f"%{vendor_name}%"))
    if transporter_name:
        asn_query = asn_query.filter(Dispatch.transporter_name.ilike(f"%{transporter_name}%"))
    if status:
        asn_query = asn_query.filter(Dispatch.status == status)
    if asn_number:
        asn_query = asn_query.filter(ASNEntry.asn_number.ilike(f"%{asn_number}%"))

    vehicle_usage_query = (
        Dispatch.query.with_entities(
            Dispatch.vehicle_number,
            func.count(Dispatch.id).label("total_trips"),
            func.sum(Dispatch.quantity).label("total_quantity"),
        )
        .group_by(Dispatch.vehicle_number)
        .order_by(func.count(Dispatch.id).desc())
    )
    if date_from:
        vehicle_usage_query = vehicle_usage_query.filter(Dispatch.created_at >= f"{date_from} 00:00:00")
    if date_to:
        vehicle_usage_query = vehicle_usage_query.filter(Dispatch.created_at <= f"{date_to} 23:59:59")
    if vehicle_number:
        vehicle_usage_query = vehicle_usage_query.filter(Dispatch.vehicle_number.ilike(f"%{vehicle_number}%"))
    if vendor_name:
        vehicle_usage_query = vehicle_usage_query.filter(Dispatch.vendor_name.ilike(f"%{vendor_name}%"))
    if transporter_name:
        vehicle_usage_query = vehicle_usage_query.filter(Dispatch.transporter_name.ilike(f"%{transporter_name}%"))
    if status:
        vehicle_usage_query = vehicle_usage_query.filter(Dispatch.status == status)

    return jsonify(
        {
            "filters": {
                "dateFrom": date_from,
                "dateTo": date_to,
                "vehicleNumber": vehicle_number,
                "asnNumber": asn_number,
                "vendorName": vendor_name,
                "status": status,
            },
            "dispatchReport": [serialize_dispatch(dispatch) for dispatch in dispatch_report],
            "deliveryReport": [serialize_dispatch(dispatch) for dispatch in delivery_report],
            "asnReport": [serialize_asn_entry(entry) for entry in asn_query.order_by(ASNEntry.created_at.desc()).all()],
            "vehicleUsageReport": [
                {
                    "vehicleNumber": row.vehicle_number,
                    "totalTrips": row.total_trips,
                    "totalQuantity": row.total_quantity or 0,
                }
                for row in vehicle_usage_query.all()
            ],
        }
    )


@api_bp.route("/files/<path:category>/<path:filename>")
@api_login_required
def download_file(category: str, filename: str):
    valid_directories = {
        "invoice": "invoice",
        "asn": "asn",
        "delivery": "delivery",
        "signed_invoice": "signed_invoice",
    }

    if category not in valid_directories:
        return _json_error("Invalid file category.", 404)

    directory = os.path.join(current_app.config["UPLOAD_FOLDER"], valid_directories[category])
    return send_from_directory(directory, filename, as_attachment=False)
