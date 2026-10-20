# Tallyline: one small container serving the API and the front end.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8000 \
    TALLYLINE_DB=/app/data/tallyline.duckdb

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY tallyline ./tallyline
COPY sql ./sql
COPY web ./web

# Generate the history at build time so the first visit is instant.
# At runtime only the hours since the build are added.
RUN python -m tallyline build

RUN useradd --create-home app && chown -R app /app
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8000\")}/healthz')"
CMD ["python", "-m", "tallyline", "serve"]
