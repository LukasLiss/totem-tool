"""
Checks applied to one recorded assistant turn.

A turn record (built by the runner) is a dict with: ``text`` (final streamed
answer), ``tools`` (list of {name, ok, error, kind}), ``pending`` (proposed
changes), ``client_actions``, ``notices``, ``errors``, ``model_calls`` and
``tool_text`` (all tool results of the conversation so far, for grounding).

Each check returns ``(passed, detail)``. Expected values may be callables of
the ground truth so tasks stay free of hardcoded numbers. Ported and extended
from the earlier benchmark (origin/feature/assistant-evaluation-benchmark).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple, Union

Value = Union[float, Callable[[Any], float]]
Result = Tuple[bool, str]


def normalize_text(text: str) -> str:
    """Lowercase, drop whitespace, underscores, hyphens and markdown emphasis for entity matching."""
    return re.sub(r"[\s_\-*`]+", "", (text or "").lower())


def extract_numbers(text: str) -> List[float]:
    """All numbers in a text, handling thousands separators (35,372) and thin spaces."""
    cleaned = re.sub(r"(?<=\d)[,  ](?=\d{3}\b)", "", text or "")
    found = []
    for m in re.findall(r"(?<![\w.])[-+]?(?:\d+\.\d+|\d+)(?:[eE][-+]?\d+)?", cleaned):
        try:
            found.append(float(m))
        except ValueError:
            pass
    return found


def _resolve(value: Value, truth: Any) -> float:
    return float(value(truth) if callable(value) else value)


@dataclass
class Check:
    # Keyword-only so subclasses can take their own fields positionally: Number(value, tol).
    label: str = field(default="", kw_only=True)

    def run(self, turn: Dict[str, Any], truth: Any) -> Result:  # pragma: no cover - interface
        raise NotImplementedError

    def name(self) -> str:
        return self.label or type(self).__name__


# --- answer content -------------------------------------------------------------

@dataclass
class Number(Check):
    """Some number in the answer is within ``tol_pct`` of the expected value."""

    value: Value = 0.0
    tol_pct: float = 1.0

    def run(self, turn, truth):
        target = _resolve(self.value, truth)
        nums = extract_numbers(turn["text"])
        for n in nums:
            if (target == 0 and n == 0) or (target and abs(n - target) / abs(target) * 100 <= self.tol_pct):
                return True, f"found {n:g} (expected {target:g})"
        return False, f"expected {target:g} ±{self.tol_pct}%, saw {sorted(set(nums))[:12]}"


@dataclass
class Duration(Check):
    """A duration in the answer matches ``seconds`` when read as days, hours or minutes."""

    seconds: Value = 0.0
    tol_pct: float = 5.0

    def run(self, turn, truth):
        s = _resolve(self.seconds, truth)
        candidates = {"d": s / 86400, "h": s / 3600, "min": s / 60}
        nums = extract_numbers(turn["text"])
        for unit, target in candidates.items():
            for n in nums:
                if target and abs(n - target) / target * 100 <= self.tol_pct:
                    return True, f"found {n:g} {unit}"
        return False, f"expected ≈{candidates['d']:.2f} d / {candidates['h']:.1f} h, saw {sorted(set(nums))[:12]}"


@dataclass
class Mentions(Check):
    """All ``terms`` appear (each term may be a tuple of alternatives)."""

    terms: Any = ()  # sequence of str | tuple-of-alternatives | callable(truth); or a callable returning that

    def run(self, turn, truth):
        text = normalize_text(turn["text"])
        terms = self.terms(truth) if callable(self.terms) else self.terms
        if isinstance(terms, (str, tuple)):
            terms = [terms]
        missing = []
        for term in terms:
            term = term(truth) if callable(term) else term
            options = term if isinstance(term, tuple) else (term,)
            if not any(normalize_text(o) in text for o in options):
                missing.append(" | ".join(options))
        return (not missing), ("all mentioned" if not missing else f"missing: {missing}")


@dataclass
class NotMentions(Check):
    terms: Sequence[str] = ()

    def run(self, turn, truth):
        text = normalize_text(turn["text"])
        present = [t for t in self.terms if normalize_text(t) in text]
        return (not present), ("none present" if not present else f"present: {present}")


@dataclass
class AnyOf(Check):
    """Passes if any of the given checks passes."""

    checks: Sequence[Check] = ()

    def run(self, turn, truth):
        details = []
        for c in self.checks:
            ok, d = c.run(turn, truth)
            if ok:
                return True, f"{c.name()}: {d}"
            details.append(f"{c.name()}: {d}")
        return False, " / ".join(details)


# --- behaviour --------------------------------------------------------------------

@dataclass
class UsedTool(Check):
    """At least one of ``names`` was called (successfully unless ``allow_errors``)."""

    names: Sequence[str] = ()
    allow_errors: bool = True

    def run(self, turn, truth):
        called = [t["name"] for t in turn["tools"] if self.allow_errors or t.get("ok")]
        hit = [n for n in self.names if n in called]
        return bool(hit), (f"used {hit}" if hit else f"none of {list(self.names)} in {called}")


@dataclass
class NotUsedTool(Check):
    names: Sequence[str] = ()

    def run(self, turn, truth):
        bad = [t["name"] for t in turn["tools"] if t["name"] in self.names]
        return (not bad), ("not used" if not bad else f"used {bad}")


@dataclass
class MaxModelCalls(Check):
    limit: int = 8

    def run(self, turn, truth):
        n = turn.get("model_calls", 0)
        return n <= self.limit, f"{n} model calls (limit {self.limit})"


@dataclass
class Proposed(Check):
    """A change was proposed (optionally of a given tool), and nothing was executed without approval."""

    tool: Optional[str] = None
    min_count: int = 1
    where: Optional[Callable[[Dict[str, Any]], bool]] = None

    def run(self, turn, truth):
        items = [p for p in turn["pending"] if self.tool is None or p["name"] == self.tool]
        if self.where:
            items = [p for p in items if self.where(p)]
        ok = len(items) >= self.min_count
        return ok, f"{len(items)} matching proposal(s): {[p['description'] for p in turn['pending']]}"


@dataclass
class NoProposals(Check):
    tools: Optional[Sequence[str]] = None

    def run(self, turn, truth):
        bad = [p["name"] for p in turn["pending"] if self.tools is None or p["name"] in self.tools]
        return (not bad), ("no proposals" if not bad else f"proposed {bad}")


@dataclass
class ClientAction(Check):
    """A browser-side action (``start_tour``, ``open_view``) was sent, optionally matching ``where``."""

    action: str = "start_tour"
    where: Optional[Callable[[Dict[str, Any]], bool]] = None

    def run(self, turn, truth):
        acts = [a for a in turn["client_actions"] if a["name"] == self.action]
        if self.where:
            acts = [a for a in acts if self.where(a["arguments"])]
        return bool(acts), f"{len(acts)} matching {self.action} action(s) of {[a['name'] for a in turn['client_actions']]}"


@dataclass
class Custom(Check):
    fn: Callable[[Dict[str, Any], Any], Result] = lambda turn, truth: (True, "")

    def run(self, turn, truth):
        return self.fn(turn, truth)


# --- always-on checks -----------------------------------------------------------

_LATEX_RE = re.compile(r"\$[^$\n]*\\[a-z]+|\\(rightarrow|times|leq|geq|approx|cdot|frac)\b")


@dataclass
class NoLatex(Check):
    def run(self, turn, truth):
        m = _LATEX_RE.search(turn["text"] or "")
        return (m is None), ("no LaTeX" if m is None else f"LaTeX: {m.group(0)!r}")


@dataclass
class NoHarnessError(Check):
    def run(self, turn, truth):
        errs = turn.get("errors") or []
        return (not errs), ("no errors" if not errs else f"errors: {errs}")


@dataclass
class Answered(Check):
    def run(self, turn, truth):
        stopped = any("Stopped" in n for n in turn.get("notices", []))
        ok = bool((turn["text"] or "").strip()) or stopped
        return ok, "answered" if ok else "empty answer"


_DONE_RE = re.compile(
    r"\b(i(?:'ve| have)|has been|have been|is now|are now|was|were|i)\s+(?:\w+\s+){0,2}"
    r"(created|added|deleted|removed|renamed|updated|applied|built)\b",
    re.I,
)
_HEDGE = ("approv", "once ", "after ", " will ", "would", "if you", "when you", "pending", "propos", "until", "card")


@dataclass
class NoFalseClaim(Check):
    """With changes still awaiting approval, the answer must not say they were made."""

    def run(self, turn, truth):
        if not turn["pending"]:
            return True, "nothing pending"
        for sentence in re.split(r"(?<=[.!?])\s+|\n", turn["text"] or ""):
            if _DONE_RE.search(sentence) and not any(h in sentence.lower() for h in _HEDGE):
                return False, f"claims done: {sentence.strip()[:160]!r}"
        return True, "no false claim"


DEFAULT_CHECKS: List[Check] = [Answered(), NoLatex(), NoHarnessError(), NoFalseClaim()]


def grounded_ratio(text: str, tool_text: str, min_value: float = 10.0) -> Optional[float]:
    """Share of non-trivial numbers in the answer that also occur in tool output (a soft metric)."""
    answer_nums = [n for n in extract_numbers(text) if abs(n) >= min_value and not (1900 <= n <= 2100)]
    if not answer_nums:
        return None
    source = extract_numbers(tool_text)
    source_set = set(source)

    def grounded(n: float) -> bool:
        if n in source_set:
            return True
        for s in source:
            # Rounding and unit changes the model commonly applies (seconds -> days/hours, shares).
            for factor in (1, 86400, 3600, 60, 0.01, 100):
                v = s / factor
                if v and abs(v - n) / abs(n) <= 0.01:
                    return True
        return False

    return sum(1 for n in answer_nums if grounded(n)) / len(answer_nums)


def score_turn(turn: Dict[str, Any], checks: Iterable[Check], truth: Any, defaults: bool = True) -> Dict[str, Any]:
    results = []
    for check in list(checks) + (DEFAULT_CHECKS if defaults else []):
        try:
            ok, detail = check.run(turn, truth)
        except Exception as exc:  # a broken check must not hide the rest
            ok, detail = False, f"check crashed: {type(exc).__name__}: {exc}"
        results.append({"check": check.name(), "passed": bool(ok), "detail": detail})
    return {
        "passed": all(r["passed"] for r in results),
        "checks": results,
        "grounded_ratio": grounded_ratio(turn["text"], turn.get("tool_text", "")),
    }
