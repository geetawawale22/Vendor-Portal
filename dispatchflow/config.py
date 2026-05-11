import os
from datetime import timedelta


class Config:
    PROJECT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    SECRET_KEY = os.environ.get("SECRET_KEY", "dispatchflow-dev-secret")
    SQLALCHEMY_DATABASE_URI = f"sqlite:///{os.path.join(PROJECT_DIR, 'dispatchflow.db')}"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    PERMANENT_SESSION_LIFETIME = timedelta(minutes=30)
    UPLOAD_FOLDER = os.path.join(PROJECT_DIR, "uploads")
    ALLOWED_EXTENSIONS = {"pdf", "jpg", "jpeg", "png"}
