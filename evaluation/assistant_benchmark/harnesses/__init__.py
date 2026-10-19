from .base import BaseHarness, HarnessResult
from .ungrounded import UngroundedHarness
from .mcp_harness import MCPHarness

HARNESSES = {
    "ungrounded": UngroundedHarness,
    "mcp": MCPHarness,
}


def get_harness(name: str) -> BaseHarness:
    if name not in HARNESSES:
        raise ValueError(f"Unknown harness: {name}. Available: {list(HARNESSES.keys())}")
    return HARNESSES[name]()
