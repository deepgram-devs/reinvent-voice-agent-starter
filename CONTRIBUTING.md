# Contributing

Use an issue for a bug or proposed feature, or open a pull request with a focused
change. For sensitive reports, follow [SECURITY.md](SECURITY.md).

## Local setup

Follow the [README](README.md). Use Node 22 (`nvm use` if you use nvm). For Python,
use the checked-in uv lockfile and Python 3.12 as described in the Pipecat guide.
Keep `.env` local and use placeholder credentials in tests.

## Checks

```sh
npm ci
npm run check
cd pipecat_agent
uv sync --frozen --group dev --python 3.12
uv run ruff check .
uv run pytest -q
```

Tests must run offline with fakes. Do not add a test that opens a paid provider
session, records visitor data or depends on a shared server. If you change the
prompt, audio transport or closing flow, describe the real conversation you heard,
or clearly identify that validation as outstanding.

Keep both backends' documentation accurate. A function added to the shared schema
needs a handler in each backend that advertises it. Keep dependencies and lockfiles
in sync (`npm install --package-lock-only` or `uv lock` in `pipecat_agent/`).

Before opening a PR, review `git diff --check` and the staged diff for credentials
or visitor data. Describe the resulting behavior, relevant checks and limitations.
