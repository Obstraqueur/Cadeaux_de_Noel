import os

# Derrière nginx sur le même serveur, mettez GUNICORN_BIND=127.0.0.1:8000 dans .env
bind = os.environ.get("GUNICORN_BIND", "0.0.0.0:8000")
workers = int(os.environ.get("GUNICORN_WORKERS", 3))
timeout = 30
accesslog = "-"
