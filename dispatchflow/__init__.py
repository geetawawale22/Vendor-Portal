import os

from flask import Flask
from werkzeug.security import generate_password_hash

from .config import Config
from .extensions import db
from .models import DispatchStatusLog, User


DEFAULT_USERNAME = "vendor.user"
DEFAULT_EMAIL = "vendor.user@dispatchflow.local"
DEFAULT_PASSWORD = "Vendor@2026"


def create_app() -> Flask:
	app = Flask(__name__)
	app.config.from_object(Config)

	db.init_app(app)

	from .routes.auth import auth_bp
	from .routes.api import api_bp
	from .routes.dispatch import dispatch_bp
	from .routes.main import main_bp
	from .routes.reports import reports_bp

	app.register_blueprint(auth_bp)
	app.register_blueprint(api_bp)
	app.register_blueprint(main_bp)
	app.register_blueprint(dispatch_bp)
	app.register_blueprint(reports_bp)

	with app.app_context():
		os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
		os.makedirs(os.path.join(app.config["UPLOAD_FOLDER"], "invoice"), exist_ok=True)
		os.makedirs(os.path.join(app.config["UPLOAD_FOLDER"], "asn"), exist_ok=True)
		os.makedirs(os.path.join(app.config["UPLOAD_FOLDER"], "delivery"), exist_ok=True)
		os.makedirs(os.path.join(app.config["UPLOAD_FOLDER"], "signed_invoice"), exist_ok=True)

		db.create_all()
		_migrate_asn_weight_columns()
		seed_default_user()
		cleanup_duplicate_status_logs()

	return app


def _migrate_asn_weight_columns() -> None:
	"""Add material_weight columns to asn_entries and delivery detail columns to dispatches if they don't exist yet."""
	import sqlalchemy as sa
	with db.engine.connect() as conn:
		# asn_entries columns
		result = conn.execute(sa.text("PRAGMA table_info(asn_entries)"))
		existing = {row[1] for row in result.fetchall()}
		if "material_weight" not in existing:
			conn.execute(sa.text("ALTER TABLE asn_entries ADD COLUMN material_weight REAL"))
		if "material_weight_unit" not in existing:
			conn.execute(sa.text("ALTER TABLE asn_entries ADD COLUMN material_weight_unit VARCHAR(10) DEFAULT 'KG'"))
		# dispatch delivery detail columns
		result2 = conn.execute(sa.text("PRAGMA table_info(dispatches)"))
		existing2 = {row[1] for row in result2.fetchall()}
		for col, definition in [
			("delivered_to", "VARCHAR(200)"),
			("delivery_date", "DATETIME"),
			("receiver_contact_person", "VARCHAR(120)"),
			("receiver_mobile", "VARCHAR(15)"),
			("delivery_location", "VARCHAR(255)"),
		]:
			if col not in existing2:
				conn.execute(sa.text(f"ALTER TABLE dispatches ADD COLUMN {col} {definition}"))
		conn.commit()


def seed_default_user() -> None:
	default_user = User.query.filter_by(username=DEFAULT_USERNAME).first()
	legacy_user = User.query.filter(User.username != DEFAULT_USERNAME).order_by(User.id.asc()).first()

	if default_user:
		default_user.email = DEFAULT_EMAIL
		default_user.password_hash = generate_password_hash(DEFAULT_PASSWORD)
		if legacy_user and legacy_user.id != default_user.id:
			db.session.delete(legacy_user)
		db.session.commit()
		return

	if legacy_user:
		legacy_user.username = DEFAULT_USERNAME
		legacy_user.email = DEFAULT_EMAIL
		legacy_user.password_hash = generate_password_hash(DEFAULT_PASSWORD)
		db.session.commit()
		return

	user = User(
		username=DEFAULT_USERNAME,
		email=DEFAULT_EMAIL,
		password_hash=generate_password_hash(DEFAULT_PASSWORD),
	)
	db.session.add(user)
	db.session.commit()


def cleanup_duplicate_status_logs() -> None:
	logs = (
		DispatchStatusLog.query.order_by(
			DispatchStatusLog.dispatch_id,
			DispatchStatusLog.updated_at,
			DispatchStatusLog.id,
		).all()
	)

	duplicate_ids = []
	previous_by_dispatch = {}
	for log in logs:
		signature = (
			log.status or "",
			log.current_location or "",
			log.driver_remarks or "",
			log.delay_reason or "",
			log.estimated_arrival_time,
		)

		if previous_by_dispatch.get(log.dispatch_id) == signature:
			duplicate_ids.append(log.id)
			continue

		previous_by_dispatch[log.dispatch_id] = signature

	if duplicate_ids:
		DispatchStatusLog.query.filter(DispatchStatusLog.id.in_(duplicate_ids)).delete(
			synchronize_session=False
		)
		db.session.commit()
