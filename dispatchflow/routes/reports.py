from flask import Blueprint

from ..utils.auth import login_required
from ..utils.frontend import serve_react_app

reports_bp = Blueprint("reports", __name__, url_prefix="/reports")


@reports_bp.route("/")
@login_required
def reports_home():
	return serve_react_app()
