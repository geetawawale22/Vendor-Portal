from functools import wraps

from flask import jsonify, flash, redirect, session, url_for


def login_required(view_func):
	@wraps(view_func)
	def wrapped(*args, **kwargs):
		if "user_id" not in session:
			flash("Please login to continue.", "warning")
			return redirect(url_for("auth.login"))
		return view_func(*args, **kwargs)

	return wrapped


def api_login_required(view_func):
	@wraps(view_func)
	def wrapped(*args, **kwargs):
		if "user_id" not in session:
			response = jsonify({"message": "Please login to continue."})
			response.status_code = 401
			return response
		return view_func(*args, **kwargs)

	return wrapped
