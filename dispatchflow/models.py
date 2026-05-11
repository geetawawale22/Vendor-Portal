from datetime import datetime

from .extensions import db


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), nullable=False, unique=True)
    email = db.Column(db.String(120), nullable=False, unique=True)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class Dispatch(db.Model):
    __tablename__ = "dispatches"

    id = db.Column(db.Integer, primary_key=True)
    shipment_number = db.Column(db.String(30), unique=True, index=True)

    vendor_name = db.Column(db.String(120), nullable=False)

    vehicle_number = db.Column(db.String(30), nullable=False, index=True)
    vehicle_type = db.Column(db.String(50), nullable=False)
    transporter_name = db.Column(db.String(120), nullable=False)
    driver_name = db.Column(db.String(120), nullable=False)
    driver_mobile = db.Column(db.String(15), nullable=False)

    material_type = db.Column(db.String(120), nullable=False)
    quantity = db.Column(db.Float, nullable=False)
    unit = db.Column(db.String(20), nullable=False)

    empty_vehicle_weight = db.Column(db.Float, nullable=False)
    empty_vehicle_weight_unit = db.Column(db.String(10), nullable=False, default="KG")
    loaded_vehicle_weight = db.Column(db.Float, nullable=False)
    loaded_vehicle_weight_unit = db.Column(db.String(10), nullable=False, default="KG")
    net_material_weight = db.Column(db.Float, nullable=False)
    vehicle_capacity = db.Column(db.Float, nullable=False)
    vehicle_capacity_unit = db.Column(db.String(10), nullable=False, default="KG")

    billing_type = db.Column(db.String(30), nullable=False)
    rate_amount = db.Column(db.Float, nullable=False)
    total_cost = db.Column(db.Float, nullable=False, default=0)

    invoice_file = db.Column(db.String(255))
    asn_file = db.Column(db.String(255))
    delivery_challan_file = db.Column(db.String(255))
    signed_invoice_file = db.Column(db.String(255))

    current_location = db.Column(db.String(200))
    driver_remarks = db.Column(db.Text)
    delay_reason = db.Column(db.String(255))
    estimated_arrival_time = db.Column(db.DateTime)

    delivered_to = db.Column(db.String(200))
    delivery_date = db.Column(db.DateTime)
    receiver_contact_person = db.Column(db.String(120))
    receiver_mobile = db.Column(db.String(15))
    delivery_location = db.Column(db.String(255))

    status = db.Column(db.String(20), nullable=False, default="CREATED", index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    confirmed_at = db.Column(db.DateTime)
    delivered_at = db.Column(db.DateTime)

    asn_entries = db.relationship(
        "ASNEntry", backref="dispatch", cascade="all, delete-orphan", lazy=True
    )
    status_logs = db.relationship(
        "DispatchStatusLog", backref="dispatch", cascade="all, delete-orphan", lazy=True
    )


class ASNEntry(db.Model):
    __tablename__ = "asn_entries"

    id = db.Column(db.Integer, primary_key=True)
    dispatch_id = db.Column(db.Integer, db.ForeignKey("dispatches.id"), nullable=False, index=True)

    asn_number = db.Column(db.String(80), nullable=False)
    invoice_number = db.Column(db.String(80), nullable=False)
    material_type = db.Column(db.String(120), nullable=False)
    quantity = db.Column(db.Float, nullable=False)
    unit = db.Column(db.String(20), nullable=False)
    material_weight = db.Column(db.Float)
    material_weight_unit = db.Column(db.String(10), default="KG")

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (db.UniqueConstraint("dispatch_id", "asn_number", name="uq_dispatch_asn"),)


class DispatchStatusLog(db.Model):
    __tablename__ = "dispatch_status_logs"

    id = db.Column(db.Integer, primary_key=True)
    dispatch_id = db.Column(db.Integer, db.ForeignKey("dispatches.id"), nullable=False, index=True)
    status = db.Column(db.String(20), nullable=False)
    current_location = db.Column(db.String(200))
    driver_remarks = db.Column(db.Text)
    delay_reason = db.Column(db.String(255))
    estimated_arrival_time = db.Column(db.DateTime)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
