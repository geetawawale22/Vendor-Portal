from flask import Blueprint, flash, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash

from ..models import User
from ..utils.frontend import serve_react_app

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/login", methods=["GET", "POST"])
def login():
	if request.method == "GET":
		if "user_id" in session:
			return redirect(url_for("main.dashboard"))
		return serve_react_app()

	identity = request.form.get("identity", "").strip()
	password = request.form.get("password", "")

	user = User.query.filter((User.username == identity) | (User.email == identity)).first()

	if not user or not check_password_hash(user.password_hash, password):
		flash("Invalid username/email or password.", "danger")
		return render_template("auth/login.html")

	session["user_id"] = user.id
	session["username"] = user.username
	session.permanent = True
	flash("Login successful.", "success")
	return redirect(url_for("main.dashboard"))


@auth_bp.route("/logout")
def logout():
	session.clear()
	flash("Logged out successfully.", "success")
	return redirect(url_for("auth.login"))
