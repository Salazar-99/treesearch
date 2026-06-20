# environment

A [HUD](https://docs.hud.ai/v6/core/environment) RL environment, managed with [uv](https://docs.astral.sh/uv/).

## Setup

```bash
uv sync
```

## Layout

- `env.py` — the `Environment`: lifecycle hooks (`initialize`/`shutdown`), capabilities, and task templates.
- `tasks.py` — a taskset that instantiates the templates with concrete parameters.

## Usage

```bash
uv run hud serve env.py          # serve the environment's control channel locally
uv run hud eval tasks.py claude  # run an agent against the taskset and produce a trace
```

Set your API key once (see https://hud.ai/project/api-keys):

```bash
uv run hud set HUD_API_KEY=your-key-here
```
