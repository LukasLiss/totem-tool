import re
from typing import Any, Dict, List, Optional, Set, Tuple
from ..datasets.tasks import BenchmarkTask, ScorerType
from ..harnesses.base import HarnessResult


def normalize_text(text: str) -> str:
    """Normalize whitespace and strip punctuation for entity matching."""
    return re.sub(r"[\s_\-]+", "", text.lower())


def extract_numbers(text: str) -> List[float]:
    """Extract all integer and floating point numbers from text, handling thousands separators."""
    # Remove commas between digits (e.g. 35,413 -> 35413)
    text_cleaned = re.sub(r"(?<=\d),(?=\d)", "", text)
    matches = re.findall(r"[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?", text_cleaned)
    nums = []
    for m in matches:
        try:
            nums.append(float(m))
        except ValueError:
            pass
    return nums


def score_exact_entities(result: HarnessResult, task: BenchmarkTask) -> Dict[str, Any]:
    """Score whether expected entity pairs or names appear in response."""
    gt = task.ground_truth
    text_norm = normalize_text(result.response_text)

    # Check for entity pairs (e.g. bottleneck transitions)
    entity_pairs = gt.get("entity_pairs", [])
    if entity_pairs:
        matched_pair = False
        for pair in entity_pairs:
            source, target = pair[0], pair[1]
            if normalize_text(source) in text_norm and normalize_text(target) in text_norm:
                matched_pair = True
                break

        # Competitor defense: verify disallowed/false bottleneck competitor claims are NOT asserted
        disallowed_competitors = gt.get("disallowed_competitors", [])
        for comp in disallowed_competitors:
            if isinstance(comp, (list, tuple)) and len(comp) == 2:
                if normalize_text(comp[0]) in text_norm and normalize_text(comp[1]) in text_norm:
                    return {
                        "score": 0.0,
                        "correct": False,
                        "matched_pair": matched_pair,
                        "reason": f"Disallowed competitor transition ('{comp[0]}' -> '{comp[1]}') falsely claimed as primary bottleneck.",
                    }
            elif isinstance(comp, str) and normalize_text(comp) in text_norm:
                return {
                    "score": 0.0,
                    "correct": False,
                    "matched_pair": matched_pair,
                    "reason": f"Disallowed competitor activity '{comp}' falsely claimed as primary bottleneck.",
                }

        return {
            "score": 1.0 if matched_pair else 0.0,
            "correct": matched_pair,
            "matched_pair": matched_pair,
            "reason": "Matched expected transition pair" if matched_pair else "Missing expected activity pair",
        }

    # Check for single/list required entities
    required = gt.get("required_entities", [])
    if required:
        found = [e for e in required if normalize_text(e) in text_norm]
        correct = len(found) == len(required)

        # Check for disallowed entities
        disallowed = gt.get("disallowed_entities", [])
        disallowed_found = [e for e in disallowed if normalize_text(e) in text_norm]
        if disallowed_found:
            return {
                "score": 0.0,
                "correct": False,
                "found_entities": found,
                "disallowed_found": disallowed_found,
                "reason": f"Disallowed entities found in response: {disallowed_found}",
            }

        return {
            "score": len(found) / max(len(required), 1),
            "correct": correct,
            "found_entities": found,
            "missing_entities": [e for e in required if e not in found],
        }

    return {"score": 0.0, "correct": False, "reason": "No entities specified in ground truth"}


def score_numerical(result: HarnessResult, task: BenchmarkTask) -> Dict[str, Any]:
    """Score numerical accuracy within tolerance percentage."""
    gt = task.ground_truth
    target_val = float(gt.get("value", 0.0))
    tolerance_pct = float(gt.get("tolerance_pct", 5.0))

    numbers = extract_numbers(result.response_text)
    if not numbers:
        return {"score": 0.0, "correct": False, "reason": "No numerical values found in response"}

    min_diff_pct = float("inf")
    closest_num = None

    for num in numbers:
        if target_val == 0.0:
            diff_pct = abs(num) * 100.0
        else:
            diff_pct = abs(num - target_val) / abs(target_val) * 100.0

        if diff_pct < min_diff_pct:
            min_diff_pct = diff_pct
            closest_num = num

    correct = min_diff_pct <= tolerance_pct
    return {
        "score": 1.0 if correct else 0.0,
        "correct": correct,
        "closest_number": closest_num,
        "target_value": target_val,
        "error_pct": round(min_diff_pct, 2),
        "tolerance_pct": tolerance_pct,
    }


def score_set_membership(result: HarnessResult, task: BenchmarkTask) -> Dict[str, Any]:
    """Score precision, recall, and F1 of extracted set items."""
    gt = task.ground_truth
    required = set(gt.get("required_entities", []))
    text_norm = normalize_text(result.response_text)

    # Check for disallowed entities
    disallowed = set(gt.get("disallowed_entities", []))
    disallowed_found = {e for e in disallowed if normalize_text(e) in text_norm}
    if disallowed_found:
        return {
            "score": 0.0,
            "correct": False,
            "precision": 0.0,
            "recall": 0.0,
            "found": list({e for e in required if normalize_text(e) in text_norm}),
            "missing": list(required - {e for e in required if normalize_text(e) in text_norm}),
            "disallowed_found": list(disallowed_found),
            "reason": f"Disallowed entities found in response: {list(disallowed_found)}",
        }

    found = {e for e in required if normalize_text(e) in text_norm}
    recall = len(found) / max(len(required), 1)
    correct = (recall == 1.0)

    return {
        "score": recall,
        "correct": correct,
        "precision": 1.0,  # Factual entity mention
        "recall": recall,
        "found": list(found),
        "missing": list(required - found),
    }


def score_tool_call(result: HarnessResult, task: BenchmarkTask) -> Dict[str, Any]:
    """Score whether expected tool was invoked with proper parameters."""
    gt = task.ground_truth
    expected_tool = gt.get("tool_name")
    expected_tools = gt.get("expected_tools", [expected_tool] if expected_tool else [])

    invoked_tools = [tc.get("name") for tc in result.tool_calls]
    invoked_args = [tc.get("arguments", {}) for tc in result.tool_calls]

    # Check tool presence
    matched_tools = [t for t in expected_tools if t in invoked_tools]
    tool_presence_score = len(matched_tools) / max(len(expected_tools), 1)

    # Check tour steps for highlight_element
    if expected_tool == "highlight_element" and "required_tour_sequence" in gt:
        expected_seq = gt["required_tour_sequence"]
        actual_steps = []
        for args in invoked_args:
            if "steps" in args and isinstance(args["steps"], list):
                actual_steps.extend([s.get("tour_id") for s in args["steps"] if isinstance(s, dict)])
            elif "tour_id" in args:
                actual_steps.append(args["tour_id"])

        seq_matches = all(req in actual_steps for req in expected_seq)
        return {
            "score": 1.0 if (tool_presence_score == 1.0 and seq_matches) else 0.5 if tool_presence_score == 1.0 else 0.0,
            "correct": tool_presence_score == 1.0 and seq_matches,
            "tool_present": expected_tool in invoked_tools,
            "expected_sequence": expected_seq,
            "actual_steps": actual_steps,
        }

    correct = tool_presence_score == 1.0
    return {
        "score": tool_presence_score,
        "correct": correct,
        "expected_tools": expected_tools,
        "invoked_tools": invoked_tools,
    }


def evaluate_task_result(result: HarnessResult, task: BenchmarkTask) -> Dict[str, Any]:
    """Dispatch deterministic evaluation based on task scorer type."""
    if result.error:
        return {"score": 0.0, "correct": False, "error": result.error}

    if task.scorer_type == ScorerType.EXACT_ENTITIES:
        return score_exact_entities(result, task)
    elif task.scorer_type == ScorerType.NUMERICAL:
        return score_numerical(result, task)
    elif task.scorer_type == ScorerType.SET_MEMBERSHIP:
        return score_set_membership(result, task)
    elif task.scorer_type == ScorerType.TOOL_CALL:
        return score_tool_call(result, task)
    else:  # Qualitative / fallback
        # Check required keywords
        req_kw = task.ground_truth.get("required_keywords", [])
        must_not_tool = task.ground_truth.get("must_not_invoke_tool")

        tool_violation = must_not_tool and any(tc.get("name") == must_not_tool for tc in result.tool_calls)
        text_norm = result.response_text.lower()
        found_kw = [kw for kw in req_kw if kw.lower() in text_norm]
        kw_ratio = len(found_kw) / max(len(req_kw), 1)

        correct = (kw_ratio >= 0.75) and not tool_violation
        return {
            "score": 0.0 if tool_violation else kw_ratio,
            "correct": correct,
            "found_keywords": found_kw,
            "tool_violation": bool(tool_violation),
        }
