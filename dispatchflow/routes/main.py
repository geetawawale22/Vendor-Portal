from flask import Blueprint

from ..utils.auth import login_required
from ..utils.frontend import serve_react_app

main_bp = Blueprint("main", __name__)


@main_bp.route("/")
@login_required
def dashboard():
	return serve_react_app()
