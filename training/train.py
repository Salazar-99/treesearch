"""GRPO training loop skeleton for the treesearch environment.

Docs: https://docs.hud.ai/v6/core/training

Before running:
    1. Deploy the environment and sync tasks to the platform (from ../environment):
       uv run hud deploy
       uv run hud sync tasks test-environment tasks.py --yes
    2. Fork a trainable base model (see https://docs.hud.ai/v6/core/training#get-a-trainable-model):
       uv run hud models list
       uv run hud models fork Qwen/Qwen3.5-4B --name treesearch
    3. Set your HUD API key (https://hud.ai/project/api-keys):
       uv run hud set HUD_API_KEY=your-key-here

Run:
    uv run python train.py
"""

from __future__ import annotations

import asyncio

from hud import HUDRuntime, Job, Taskset, TrainingClient
from hud.agents import create_agent
from hud.eval.run import Run

# Platform taskset from `hud sync tasks <name> tasks.py` (must match deployed env name on each row).
TASKSET = "new-treesearch-4"

# Trainable model slug from `hud models fork ... --name <slug>`.
MODEL = "treesearch-v4"

# GRPO runs each task `group` times; advantages are relative within the group.
GROUP_SIZE = 8

# Cap parallel HUDRuntime leases — uncapped rollouts spam websocket teardown errors
# and can hit keepalive ping timeouts on the platform tunnel.
MAX_CONCURRENT = 8
ROLLOUT_TIMEOUT = 600.0

# Outer training loop: roll out a batch, then nudge weights with trainer.step().
EPOCHS = 10
LEARNING_RATE = 1e-5


def _suppress_runtime_tunnel_teardown_logs() -> None:
    """HUDRuntime tunnel teardown raises benign websockets close errors."""
    try:
        import websockets.exceptions
    except ImportError:
        return

    closed_errors = (
        websockets.exceptions.ConnectionClosedError,
        websockets.exceptions.ConnectionClosedOK,
    )
    loop = asyncio.get_running_loop()
    default_handler = loop.get_exception_handler() or loop.default_exception_handler

    def handler(loop: asyncio.AbstractEventLoop, context: dict[str, object]) -> None:
        exc = context.get("exception")
        message = str(context.get("message", ""))
        if "client_connected_cb" in message and isinstance(exc, closed_errors):
            return
        default_handler(context)

    loop.set_exception_handler(handler)


def _reward_stats(runs: list[Run]) -> tuple[float, float]:
    """Mean and population std of graded rewards for one rollout batch."""
    if not runs:
        return 0.0, 0.0
    rewards = [run.reward for run in runs]
    mean = sum(rewards) / len(rewards)
    if len(rewards) == 1:
        return mean, 0.0
    variance = sum((reward - mean) ** 2 for reward in rewards) / len(rewards)
    return mean, variance**0.5


async def main() -> None:
    _suppress_runtime_tunnel_teardown_logs()
    # return_token_ids sends token ids + logprobs the trainer needs.
    agent = create_agent(
        MODEL,
        completion_kwargs={"extra_body": {"return_token_ids": True}},
    )
    trainer = TrainingClient(MODEL)
    taskset = Taskset.from_api(TASKSET)
    runtime = HUDRuntime()

    session = await Job.start(MODEL, group=GROUP_SIZE)
    for epoch in range(EPOCHS):
        start = len(session.runs)
        print(
            f"epoch {epoch + 1}/{EPOCHS}: rolling out "
            f"{len(taskset)} tasks × group={GROUP_SIZE} "
            f"(max_concurrent={MAX_CONCURRENT})..."
        )
        await taskset.run(
            agent,
            runtime=runtime,
            job=session,
            max_concurrent=MAX_CONCURRENT,
            rollout_timeout=ROLLOUT_TIMEOUT,
        )
        batch = session.runs[start:]
        print(f"epoch {epoch + 1}/{EPOCHS}: training on {len(batch)} runs...")
        result = await trainer.step(
            batch,
            learning_rate=LEARNING_RATE,
            group_size=GROUP_SIZE,
        )
        mean_reward, reward_std = _reward_stats(batch)
        print(
            f"epoch {epoch + 1}/{EPOCHS}: "
            f"mean_reward={mean_reward:.3f} reward_std={reward_std:.3f} "
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
