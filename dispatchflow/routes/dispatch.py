from datetime import datetime

from flask import Blueprint, current_app, flash, redirect, request, url_for

from ..extensions import db
from ..models import Dispatch, DispatchStatusLog
from ..services.dispatch_service import (
	DispatchValidationError,
	create_dispatch_record,
	update_dispatch_status_record,
	upload_delivery_documents_record,
)
from ..utils.auth import login_required
from ..utils.frontend import serve_react_app
from ..utils.helpers import generate_shipment_number

dispatch_bp = Blueprint("dispatch", __name__, url_prefix="/dispatches")


def _status_log_signature(status, current_location, driver_remarks, delay_reason, estimated_arrival_time):
	return (
		status or "",
		current_location or "",
		driver_remarks or "",
		delay_reason or "",
		estimated_arrival_time,
	)


def add_status_log_if_needed(
	dispatch_id: int,
	status: str,
	current_location: str | None,
	driver_remarks: str | None,
	delay_reason: str | None,
	estimated_arrival_time,
) -> bool:
	latest_log = (
		DispatchStatusLog.query.filter_by(dispatch_id=dispatch_id)
		.order_by(DispatchStatusLog.updated_at.desc(), DispatchStatusLog.id.desc())
		.first()
	)

	new_signature = _status_log_signature(
		status, current_location, driver_remarks, delay_reason, estimated_arrival_time
	)

	if latest_log:
		latest_signature = _status_log_signature(
			latest_log.status,
			latest_log.current_location,
			latest_log.driver_remarks,
			latest_log.delay_reason,
			latest_log.estimated_arrival_time,
		)
		if latest_signature == new_signature:
			return False

	db.session.add(
		DispatchStatusLog(
			dispatch_id=dispatch_id,
			status=status,
			current_location=current_location,
			driver_remarks=driver_remarks,
			delay_reason=delay_reason,
			estimated_arrival_time=estimated_arrival_time,
		)
	)
	return True


@dispatch_bp.route("/")
@login_required
def list_dispatches():
	return serve_react_app()


@dispatch_bp.route("/create", methods=["GET", "POST"])
@login_required
def create_dispatch():
	if request.method == "POST":
		try:
			dispatch = create_dispatch_record(
				request.form,
				request.files,
				upload_folder=current_app.config["UPLOAD_FOLDER"],
				allowed_extensions=current_app.config["ALLOWED_EXTENSIONS"],
			)
			db.session.add(dispatch)
			db.session.commit()
			flash("Dispatch created successfully. Please confirm dispatch.", "success")
			return redirect(url_for("dispatch.view_dispatch", dispatch_id=dispatch.id))
		except Exception:
			# Fallback path in case legacy form posts while React is active.
			db.session.rollback()
			return serve_react_app()

	return serve_react_app()


@dispatch_bp.route("/<int:dispatch_id>")
@login_required
def view_dispatch(dispatch_id: int):
	Dispatch.query.get_or_404(dispatch_id)
	return serve_react_app()


@dispatch_bp.route("/<int:dispatch_id>/edit")
@login_required
def edit_dispatch_view(dispatch_id: int):
	Dispatch.query.get_or_404(dispatch_id)
	return serve_react_app()


@dispatch_bp.route("/<int:dispatch_id>/confirm", methods=["POST"])
@login_required
def confirm_dispatch(dispatch_id: int):
	dispatch = Dispatch.query.get_or_404(dispatch_id)

	if dispatch.status != "CREATED":
		flash("Only CREATED shipments can be confirmed.", "warning")
		return redirect(url_for("dispatch.view_dispatch", dispatch_id=dispatch.id))

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
	flash("Dispatch confirmed. Shipment moved to INTRANSIT.", "success")
	return redirect(url_for("dispatch.view_dispatch", dispatch_id=dispatch.id))


@dispatch_bp.route("/<int:dispatch_id>/update", methods=["GET", "POST"])
@login_required
def update_dispatch_status(dispatch_id: int):
	dispatch = Dispatch.query.get_or_404(dispatch_id)

	if request.method == "POST":
		payload = {
			"status": request.form.get("status", ""),
			"current_location": request.form.get("current_location", ""),
			"driver_remarks": request.form.get("driver_remarks", ""),
			"delay_reason": request.form.get("delay_reason", ""),
			"estimated_arrival_time": request.form.get("estimated_arrival_time", ""),
		}
		try:
			update_dispatch_status_record(dispatch, payload)
		except DispatchValidationError as exc:
			flash(str(exc), "danger")
			return serve_react_app()

		add_status_log_if_needed(
			dispatch.id,
			dispatch.status,
			dispatch.current_location,
			dispatch.driver_remarks,
			dispatch.delay_reason,
			dispatch.estimated_arrival_time,
		)
		db.session.commit()

		flash("Dispatch status updated successfully.", "success")
		return redirect(url_for("dispatch.view_dispatch", dispatch_id=dispatch.id))

	return serve_react_app()


@dispatch_bp.route("/<int:dispatch_id>/upload-delivery", methods=["GET", "POST"])
@login_required
def upload_delivery(dispatch_id: int):
	dispatch = Dispatch.query.get_or_404(dispatch_id)

	if request.method == "POST":
		try:
			upload_delivery_documents_record(
				dispatch,
				request.files,
				upload_folder=current_app.config["UPLOAD_FOLDER"],
				allowed_extensions=current_app.config["ALLOWED_EXTENSIONS"],
			)
			db.session.commit()
			flash("Delivery documents uploaded successfully.", "success")
			return redirect(url_for("dispatch.view_dispatch", dispatch_id=dispatch.id))
		except Exception:
			db.session.rollback()
			return serve_react_app()

	return serve_react_app()


@dispatch_bp.route("/<int:dispatch_id>/confirm-delivery", methods=["POST"])
@login_required
def confirm_delivery(dispatch_id: int):
	dispatch = Dispatch.query.get_or_404(dispatch_id)

	if dispatch.status == "DELIVERED":
		flash("Delivery has already been confirmed for this shipment.", "warning")
		return redirect(url_for("dispatch.view_dispatch", dispatch_id=dispatch.id))
	if dispatch.status == "CREATED":
		flash("Confirm the dispatch before marking delivery complete.", "warning")
		return redirect(url_for("dispatch.view_dispatch", dispatch_id=dispatch.id))
	if not (dispatch.delivery_challan_file or dispatch.signed_invoice_file):
		flash("Upload delivery proof before confirming delivery.", "warning")
		return redirect(url_for("dispatch.view_dispatch", dispatch_id=dispatch.id))

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
	flash("Delivery confirmed. Shipment closed successfully.", "success")
	return redirect(url_for("dispatch.view_dispatch", dispatch_id=dispatch.id))
