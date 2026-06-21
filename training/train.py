"""GRPO training loop skeleton for the treefarm environment.

Docs: https://docs.hud.ai/v6/core/training

Before running:
    1. Fork a trainable base model (see https://docs.hud.ai/v6/core/training#get-a-trainable-model):
       uv run hud models list
       uv run hud models fork Qwen/Qwen3.5-4B --name treefarm-rl
    2. Set your HUD API key (https://hud.ai/project/api-keys):
       uv run hud set HUD_API_KEY=your-key-here

Run:
    uv run python train.py
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from hud import Job, Taskset, TrainingClient
from hud.agents import create_agent
from hud.eval import LocalRuntime

# Path to the sibling environment project (task templates + env control channel).
ENV_DIR = Path(__file__).resolve().parent.parent / "environment"

# Trainable model slug from `hud models fork ... --name <slug>`.
MODEL = "treefarm-rl"

# GRPO runs each task `group` times; advantages are relative within the group.
GROUP_SIZE = 8

# Outer training loop: roll out a batch, then nudge weights with trainer.step().
EPOCHS = 10
LEARNING_RATE = 1e-5


async def main() -> None:
    # return_token_ids sends token ids + logprobs the trainer needs.
    agent = create_agent(
        MODEL,
        completion_kwargs={"extra_body": {"return_token_ids": True}},
    )
    trainer = TrainingClient(MODEL)
    taskset = Taskset.from_file(ENV_DIR / "tasks.py")
    runtime = LocalRuntime(str(ENV_DIR / "env.py"))

    session = await Job.start(MODEL, group=GROUP_SIZE)
    for epoch in range(EPOCHS):
        start = len(session.runs)
        await taskset.run(agent, runtime=runtime, job=session)
        batch = session.runs[start:]
        result = await trainer.step(
            batch,
            learning_rate=LEARNING_RATE,
            group_size=GROUP_SIZE,
        )
        print(
            f"epoch {epoch + 1}/{EPOCHS}: "
            f"checkpoint={result.checkpoint_id} runs={len(batch)}"
        )

    print("\ncheckpoints:")
    for checkpoint in await trainer.checkpoints():
        reward_std = checkpoint.metrics.get("reward_std")
        print(
            f"  {checkpoint.name}: mean_reward={checkpoint.mean_reward:.3f} "
            f"reward_std={reward_std}"
        )


if __name__ == "__main__":
    asyncio.run(main())
