"""Taskset for the treesearch environment.

A taskset is just a list of instantiated task templates. Each entry binds
concrete parameters to a template defined in `env.py`. Run an agent against
them with:

    uv run hud eval tasks.py claude
"""

from __future__ import annotations

from env import capital_of, count_letter

tasks = [
    count_letter(word="strawberry", letter="r"),
    count_letter(word="raspberry", letter="r"),
    count_letter(word="blueberry", letter="b"),
    capital_of(country="France", expected="Paris"),
    capital_of(country="Japan", expected="Tokyo"),
]
