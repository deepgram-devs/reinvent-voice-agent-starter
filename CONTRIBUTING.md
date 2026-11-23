# Contributing

Follow the [README](README.md) to run the Python starter. No Node runtime is needed
for the app; Node 22+ is optional for the inherited browser check in `tests/browser.mjs`.

```sh
uv sync --frozen --group dev
uv run pytest -q
cd pipecat_agent
uv sync --frozen --group dev --python 3.12
uv run ruff check .
uv run pytest -q
```

Keep tests offline with fake provider responses. Never commit API keys, `.env`,
visitor audio or transcripts. A prompt/audio change needs a real conversation
check, or a clear statement that it remains outstanding.

Keep both implementations and their documentation consistent. Add business
functions through `functions.py` so both backends share handlers. Update the
relevant lockfile with `uv lock` when dependencies change. Before a PR, review
`git diff --check` and the staged diff for secrets or visitor data.

Describe the problem, resulting behavior, checks and material limitations in the
PR. Follow [SECURITY.md](SECURITY.md) for private vulnerability reporting.
