# treesearch

An RL project for **long-horizon offline optimization**: an agent writes a 30-year operating schedule for a rubber plantation, submits it to a fast simulator, reads the resulting profit, and iterates to find the best plan it can. The repo includes the [HUD](https://docs.hud.ai/v6/start) environment, a GRPO training loop on the [HUD platform](https://docs.hud.ai/v6/core/training), and a browser visualizer for inspecting rollouts.

## Project layout

```
treesearch/
├── environment/          # HUD RL environment (Python, uv)
│   ├── env.py            # Environment, MCP tools, plan-submission task, reward wiring
│   ├── tasks.py          # Task variants (seeds, grid sizes, horizons)
│   ├── Farm/             # Simulation package (pure Python, no HUD dependency)
│   │   ├── spec.py       # FarmSpec / default_spec — serializable scenario
│   │   ├── objects.py    # RubberTree, Farm (growth, tapping, soil, economics)
│   │   ├── actions.py    # Action data types (Water, Fertilize, Tap)
│   │   ├── strategies.py # Baseline policies + reward anchors and scale_reward
│   │   └── textsim.py    # Interactive / --demo text front-end
│   ├── test_run_simulation.py
│   └── Dockerfile.hud
├── training/             # GRPO training loop (Python, uv)
│   └── train.py
└── visualizer/           # Rollout visualizer (React + TypeScript, Vite)
    ├── src/
    └── public/
```

## environment/

A [HUD v6 environment](https://docs.hud.ai/v6/core/environment) that trains and evaluates an agent's ability to run an autonomous business: plan a long sequence of actions over a long horizon toward a goal. The agent operates an autonomous rubber farm — a **high degree of freedom** task (thousands of days × many possible actions per day) where the skill under test is *long-horizon offline optimization*: reason about delayed consequences, search over candidate plans, and converge on a profitable strategy.

You manage a grid of rubber trees for ~30 years. Trees mature (~6 years), can be *tapped* for latex (the only revenue), need water and N/P/K nutrients to stay healthy, and age out around 28–34 years. You don't step through time live — instead you submit a **schedule of actions** and the simulator plays out all 30 years instantly. Maximize **profit = rubber revenue − spending on water & fertilizer**.

### Plan format (day-indexed)

A plan is a schedule keyed by day. Submit it either as a JSON **object** (`day → actions`) or a **list** (index = day):

```json
{
  "0":   [{"tool": "tap", "target": "mature"},
          {"tool": "fertilize", "n": 0.2, "p": 0.15, "k": 0.15, "target": "all"}],
  "365": [{"tool": "tap", "target": "mature"},
          {"tool": "water", "gallons": 5, "target": "all"}]
}
```

Each day holds a list of actions, applied in order:

| tool | fields | notes |
|------|--------|-------|
| `tap` | `target` | start tapping (persists across days) |
| `untap` | `target` | stop tapping |
| `water` | `gallons`, `target` | one-off irrigation |
| `fertilize` | `n`, `p`, `k`, `target` | one-off feed; each 0..1 per tree |

`target` ∈ `all | mature | immature | "row,col"`. Tapping is a standing setting; watering/fertilizing apply only on the day they appear; omitted days just pass.

### Tools

- **`submit_plan(plan)`** — the only scoring tool. Simulates the full schedule and returns profit, reward, and a year-by-year timeline. Call it repeatedly; your score is your **best** submission.
- `observe()` — starting farm state + the full per-year price forecast.
- `render()` — ASCII map of the starting farm.
- `observe_at(day, plan)` — inspect a plan's physical state at a given day (tree maturity, soil, health). Does **not** report profit and does **not** score.

### Reward

Profit is normalized to `0..1`, keyed on rubber harvested *and* profitability:

| outcome | reward |
|---------|--------|
| no submission, or a plan that harvests no rubber | **0.0** |
| harvests rubber but loses money | **0.1 → 0.5** (rises toward break-even) |
| break-even (profit 0, with rubber) | **0.5** |
| profitable | **0.5 → 1.0** (1.0 at the best simple baseline) |

So harvesting earns partial credit, profitability earns strictly more, and a full **1.0 requires being genuinely profitable**.

### Simulation notes

- **Forgiving, bounded spending.** You only pay for water/nutrients the soil actually absorbs (each caps at 1.0 per tree), and a fixed **annual budget** caps yearly spend (over-orders are scaled down, never overspent).
- **Tapping dynamics.** Continuous tapping wears the panel down (lower yield); resting heals it.
- **Deterministic per seed.** Weather and tree genetics are seeded, so a plan's outcome is reproducible and submissions are directly comparable.

**Tasks** (`tasks.py`) vary plantation seed, grid size (default 6×6, also 3×3), and horizon (default 30 years, also 15 years).

### Setup

```bash
cd environment
uv sync
```

A HUD API key is needed for eval and deploy (get one at https://hud.ai/project/api-keys):

```bash
uv run hud set HUD_API_KEY=your-key-here
```

### Run locally

```bash
uv run hud eval tasks.py claude --task-ids rubber-farm-seed-0 -v
uv run python env.py                      # no-model smoke test (drives tools directly)
uv run python test_run_simulation.py      # explore baselines / compare strategies
```

### Deploy and sync (for platform training)

```bash
uv run hud build && uv run hud push
uv run hud sync tasks <taskset-name> tasks.py --yes
```

Add Python dependencies with `uv add <pkg>`.

## training/

A [HUD GRPO training loop](https://docs.hud.ai/v6/core/training) that rolls out tasks from `../environment/tasks.py`, scores rewards from the environment templates, and calls `TrainingClient.step()` to update model weights.

### Setup

```bash
cd training
uv sync
uv run hud set HUD_API_KEY=your-key-here
```

### Get a trainable model

Only some gateway models can be trained. List forkable bases and create your own:

```bash
uv run hud models list
uv run hud models fork Qwen/Qwen3.5-4B --name treesearch
```

Set `MODEL` and `TASKSET` in `train.py` to match your fork slug and synced taskset name. Deploy the environment and sync tasks first (see environment section above).

### Run

```bash
uv run python train.py
```

Each epoch: roll out the taskset (`group=8` rollouts per task), score rewards, then `trainer.step()` computes GRPO advantages within each group and promotes new weights to the gateway.

Monitor checkpoints:

```bash
uv run hud models checkpoints treesearch
uv run hud models head treesearch
```

See `training/README.md` for more detail.

## visualizer/

A browser-based visualizer (React + TypeScript, built with [Vite](https://vite.dev/)) for inspecting farm rollouts. Load trained or untrained run JSON, scrub through a timeline, and view the 3D tree scene with watering-robot overlays.

The visualizer is decoupled from the environment — it reads rollout/trace JSON rather than connecting to the live HUD control channel.

### Setup and run

```bash
cd visualizer
npm install      # first time only
npm run dev      # dev server at http://localhost:5173
```

Other scripts: `npm run build` (production build), `npm run preview` (serve the build), `npm run lint`.

Example runs ship in `visualizer/public/` (`example-run.json`, `example-untrained-run.json`).
