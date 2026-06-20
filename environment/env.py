"""HUD environment boilerplate.

A HUD environment is a lightweight control object that registers lifecycle
hooks, tools, and task templates. Agents connect to it over a control channel
(started with `hud serve`) and are graded on the tasks defined here.

Docs: https://docs.hud.ai/v6/core/environment

Run it:
    uv run hud serve env.py          # serve the control channel locally
    uv run hud eval tasks.py claude  # run an agent against the tasks
"""

from __future__ import annotations

from hud import Environment
from hud import graders

# The environment is the registration hub. `name`/`version` identify it on the
# HUD platform; capabilities (ssh, cdp, mcp, ...) can be attached here or inside
# the `initialize` hook once the resources they describe actually exist.
env = Environment(name="rl-hackathon-env", version="0.1.0")


# --- Lifecycle hooks --------------------------------------------------------
# `initialize` runs once before tasks start: launch services, seed files, open
# browsers, and register any capabilities that depend on them. `shutdown` runs
# on teardown to release those resources.


@env.initialize
async def _up() -> None:
    """Set up resources the tasks need (services, browsers, seed data)."""
    # e.g. browser = await launch_chromium()
    #      env.add_capability(Capability.cdp(name="browser", url=...))
    pass


@env.shutdown
async def _down() -> None:
    """Tear down anything created in `_up`."""
    pass


# --- Capabilities -----------------------------------------------------------
# In v6, the actions an agent can take are exposed as capabilities rather than
# ad-hoc tools. Attach them in `_up` once their backing resources exist, e.g.:
#
#     from hud.capabilities import Capability
#     env.add_capability(Capability.ssh(name="shell", url=..., host_pubkey=...))
#     env.add_capability(Capability.cdp(name="browser", url=...))
#
# See https://docs.hud.ai/v6/core/environment for the full capability list.


# --- Task templates ---------------------------------------------------------
# A template is an async generator: `yield` the prompt to the agent, receive its
# answer, then `yield` a reward in [0.0, 1.0]. Parameters become knobs you can
# vary to build a taskset (see tasks.py).


@env.template(
    id="count-letter",
    description="Count how many times a letter appears in a word.",
)
async def count_letter(word: str = "strawberry", letter: str = "r"):
    answer = yield f"How many '{letter}'s are in '{word}'? Reply with just the number."
    expected = str(word.count(letter))
    yield 1.0 if answer and expected in answer else 0.0


@env.template(
    id="capital-of",
    description="Answer a simple factual question, graded by substring match.",
)
async def capital_of(country: str = "France", expected: str = "Paris"):
    answer = yield f"What is the capital of {country}? Reply with just the city name."
    # `graders` provides ready-made reward functions (contains, exact_match, ...).
    yield graders.contains(answer, expected)


if __name__ == "__main__":
    # `uv run python env.py` serves the control channel directly; equivalent to
    # `hud serve env.py` for quick local iteration.
    env.run()
