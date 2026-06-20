# treefarm

A reinforcement-learning project made of two independent pieces:

- **`environment/`** — a [HUD](https://docs.hud.ai/v6/core/environment) RL environment (Python, managed with [uv](https://docs.astral.sh/uv/)). Defines the tasks an agent is run against and how it is rewarded.
- **`visualizer/`** — a browser-based visualizer (React + TypeScript, built with [Vite](https://vite.dev/)). Intended to render/inspect what happens in the environment.

The two are decoupled: the environment is a Python package served over HUD's control channel, and the visualizer is a standalone web app. They do not yet talk to each other — wiring them together (e.g. the visualizer reading traces/rollouts produced by the environment) is the work ahead.

## Prerequisites

- Node.js + npm (visualizer)
- [uv](https://docs.astral.sh/uv/) and Python 3.12+ (environment)

## environment/

A HUD environment. The core API:

- `Environment(name, version)` — the registration hub (`env.py`).
- `@env.initialize` / `@env.shutdown` — lifecycle hooks for setting up and tearing down resources.
- Capabilities (`ssh`, `cdp`, `mcp`, ...) — how an agent acts in the environment; attached via `env.add_capability(...)`.
- `@env.template(id=, description=)` — an async generator task: `yield` a prompt, receive the agent's answer, then `yield` a reward in `[0.0, 1.0]`.
- `hud.graders` — ready-made reward helpers (`contains`, `exact_match`, `LLMJudgeGrader`, ...).

Files:

- `env.py` — the environment, capabilities, and task templates (currently two example templates: `count-letter`, `capital-of`).
- `tasks.py` — a taskset instantiating those templates with concrete parameters.

Setup and run:

```bash
cd environment
uv sync                          # install dependencies into .venv
uv run hud serve env.py          # serve the environment's control channel locally
uv run hud eval tasks.py claude  # run an agent against the taskset, producing a trace
```

A HUD API key is needed for `hud eval` (get one at https://hud.ai/project/api-keys):

```bash
uv run hud set HUD_API_KEY=your-key-here
```

Add Python dependencies with `uv add <pkg>`.

## visualizer/

A standard Vite + React + TypeScript single-page app.

Setup and run:

```bash
cd visualizer
npm install      # first time only
npm run dev      # dev server at http://localhost:5173
```

Other scripts: `npm run build` (production build), `npm run preview` (serve the build), `npm run lint`.

Source entry points: `index.html` → `src/main.tsx` → `src/App.tsx`.

## Conventions

- Keep the environment and visualizer as separate projects with their own dependency manifests (`environment/pyproject.toml`, `visualizer/package.json`).
- Run Python via `uv run ...` from inside `environment/` so the project venv is used.
