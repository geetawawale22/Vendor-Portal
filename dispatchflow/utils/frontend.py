import os

from flask import abort, current_app, send_from_directory


def serve_react_app():
    app_dir = os.path.join(current_app.static_folder, "app")
    index_path = os.path.join(app_dir, "index.html")

    if not os.path.exists(index_path):
        abort(503, description="React frontend is not built yet.")

    return send_from_directory(app_dir, "index.html")
