FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install --no-cache-dir uv && uv sync --frozen --no-dev
COPY agent_config.py booth.py functions.py server.py ./
COPY public ./public
ENV PORT=8080
EXPOSE 8080
CMD [".venv/bin/python", "server.py"]
