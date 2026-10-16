FROM python:3.13.7-alpine3.22
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && addgroup -g 10001 exporter && adduser -D -u 10001 -G exporter exporter
COPY *.py *.json ./
USER 10001:10001
EXPOSE 9108
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9108/health', timeout=3)"
CMD ["python", "exporter.py"]
