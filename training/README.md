# training

A [HUD](https://docs.hud.ai/v6/core/training) GRPO training loop for the treesearch environment, managed with [uv](https://docs.astral.sh/uv/).

## Setup

```bash
uv sync
```

## Get a trainable model

Only some gateway models can be trained. List forkable bases and create your own:

```bash
uv run hud models list                              # Trainable column marks forkable bases
uv run hud models fork Qwen/Qwen3.5-4B --name treesearch
```

Set the `MODEL` constant in `train.py` to your fork slug (default: `treesearch`).

Set your API key once (see https://hud.ai/project/api-keys):

```bash
uv run hud set HUD_API_KEY=your-key-here
```

## Layout

- `train.py` — roll out tasks from `../environment/tasks.py`, score rewards, and call `TrainingClient.step()` to update weights.

## Usage

```bash
uv run python train.py
```

Monitor checkpoint progress:

```bash
uv run hud models checkpoints treesearch
uv run hud models head treesearch              # show active checkpoint
uv run hud models head treesearch --set <id>   # roll back or branch
```

## How it works

Each epoch:

1. **Roll out** — run the taskset against the current model (`group=8` rollouts per task).
2. **Score** — rewards come from the environment templates in `../environment/env.py`.
3. **Train** — `trainer.step()` computes GRPO advantages within each group and promotes new weights to the gateway.

Tasks need **reward spread** within each group for learning to happen. See [Designing tasks](https://docs.hud.ai/v6/core/advice).
