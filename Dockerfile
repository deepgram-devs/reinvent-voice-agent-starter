FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
COPY pyproject.toml uv.lock ./
RUN pip install --no-cache-dir uv && uv sync --frozen --no-dev && useradd --create-home app
COPY server.py booth.py agent_config.py backend.py functions.py ./
COPY public ./public
USER app
EXPOSE 8080
CMD [".venv/bin/python", "server.py"]
