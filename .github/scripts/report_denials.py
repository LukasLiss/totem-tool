"""Summarize permission denials from a claude-code-action execution file.

Prints only tool names and a short input signature (command head / file path).
Never prints tool results, so it is safe to run on a public repository.
"""

import collections
import json
import sys


def signature(tool_input):
    if not isinstance(tool_input, dict):
        return ""
    for key in ("command", "file_path", "path", "pattern", "url"):
        value = tool_input.get(key)
        if value:
            return " ".join(str(value).split())[:100]
    return ""


def main(path):
    with open(path) as handle:
        messages = json.load(handle)
    if isinstance(messages, dict):
        messages = [messages]

    denials = []
    for message in messages:
        if isinstance(message, dict) and message.get("type") == "result":
            denials = message.get("permission_denials") or []

    print(f"=== permission_denials: {len(denials)} ===")
    if not denials:
        # Help future debugging if the field name ever changes.
        result = next(
            (m for m in messages if isinstance(m, dict) and m.get("type") == "result"),
            None,
        )
        if result:
            print("result keys:", sorted(result))
        return

    print("denial keys:", sorted({k for d in denials if isinstance(d, dict) for k in d}))

    counts = collections.Counter()
    for denial in denials:
        if not isinstance(denial, dict):
            print("raw:", str(denial)[:200])
            continue
        name = (
            denial.get("tool_name")
            or denial.get("toolName")
            or denial.get("name")
            or "?"
        )
        sig = signature(denial.get("tool_input") or denial.get("toolInput"))
        counts[(name, sig)] += 1

    print("=== denied calls (count, tool, input signature) ===")
    for (name, sig), count in counts.most_common():
        print(f"{count:3d}  {name:12s}  {sig}")

    print("=== totals by tool ===")
    by_tool = collections.Counter()
    for (name, _sig), count in counts.items():
        by_tool[name] += count
    for name, count in by_tool.most_common():
        print(f"{count:3d}  {name}")


if __name__ == "__main__":
    main(sys.argv[1])
