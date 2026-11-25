"""Scorer unit tests (no Django, no API)."""

from evaluation.assistant_eval.scorers import (
    AnyOf,
    ClientAction,
    Duration,
    Mentions,
    NoFalseClaim,
    NoLatex,
    NotUsedTool,
    Number,
    Proposed,
    UsedTool,
    extract_numbers,
    grounded_ratio,
    normalize_text,
    score_turn,
)

TRUTH = {"container": {"events": 35372, "median_s": 7.95 * 86400}}


def turn(text="", tools=(), pending=(), client_actions=(), **extra):
    base = {"text": text, "tools": list(tools), "pending": list(pending), "client_actions": list(client_actions),
            "notices": [], "errors": [], "model_calls": 2, "tool_text": ""}
    base.update(extra)
    return base


def test_number_extraction_handles_separators_and_decimals():
    assert extract_numbers("35,372 events, median 7.9 d, 1 794 objects") == [35372.0, 7.9, 1.0, 794.0]
    assert extract_numbers("ratio 66.7% and 10,553") == [66.7, 10553.0]


def test_number_check_uses_truth_and_tolerance():
    check = Number(lambda t: t["container"]["events"], 0)
    assert check.run(turn("The log has **35,372** events."), TRUTH)[0]
    assert not check.run(turn("The log has 35,413 events."), TRUTH)[0]


def test_duration_matches_days_or_hours():
    check = Duration(lambda t: t["container"]["median_s"], 5)
    assert check.run(turn("median wait 7.9 days"), TRUTH)[0]
    assert check.run(turn("about 191 hours"), TRUTH)[0]
    assert not check.run(turn("about 3 days"), TRUTH)[0]


def test_mentions_alternatives_callables_and_markdown():
    assert Mentions([("LoadTruck", "CollectGoods"), "Container"]).run(turn("**Load_Truck** for each container"), TRUTH)[0]
    assert Mentions(lambda t: ["PlaceinStock", "BringtoLoadingBay"]).run(turn("PlaceinStock → BringtoLoadingBay"), TRUTH)[0]
    ok, detail = Mentions(["Vehicle"]).run(turn("nothing here"), TRUTH)
    assert not ok and "Vehicle" in detail
    assert normalize_text("Customer-Order **x**") == "customerorderx"


def test_tool_and_action_checks():
    t = turn("ok", tools=[{"name": "get_directly_follows", "ok": True}],
             pending=[{"id": "a", "name": "create_dashboard", "description": "Create", "arguments": {"components": [{"component_name": "TextBoxComponent"}]}}],
             client_actions=[{"name": "start_tour", "arguments": {"steps": [{"tour_id": "nav-dashboard"}]}}])
    assert UsedTool(["query_event_log", "get_directly_follows"]).run(t, TRUTH)[0]
    assert not NotUsedTool(["get_directly_follows"]).run(t, TRUTH)[0]
    assert Proposed("create_dashboard", where=lambda p: p["arguments"]["components"][0]["component_name"] == "TextBoxComponent").run(t, TRUTH)[0]
    assert ClientAction("start_tour").run(t, TRUTH)[0]
    assert not ClientAction("open_view").run(t, TRUTH)[0]
    assert AnyOf([Number(1, 0), UsedTool(["get_directly_follows"])]).run(t, TRUTH)[0]


def test_false_claim_detection():
    pending = [{"id": "a", "name": "create_dashboard", "description": "Create", "arguments": {}}]
    assert not NoFalseClaim().run(turn("I've created the dashboard for you.", pending=pending), TRUTH)[0]
    assert NoFalseClaim().run(turn("I've proposed it. It will be created once you approve the card.", pending=pending), TRUTH)[0]
    assert NoFalseClaim().run(turn("I've created the dashboard.", pending=[]), TRUTH)[0]  # nothing pending: approved earlier


def test_latex_is_flagged():
    assert not NoLatex().run(turn("A $\\rightarrow$ B"), TRUTH)[0]
    assert not NoLatex().run(turn("size $12 \\times 2$"), TRUTH)[0]
    assert NoLatex().run(turn("A → B costs $5"), TRUTH)[0]


def test_grounded_ratio_accepts_unit_conversions():
    tool_text = '{"events": 35372, "median_wait_seconds": 686880.0}'
    assert grounded_ratio("35,372 events; median 7.95 days", tool_text) == 1.0
    assert grounded_ratio("about 99,999 events", tool_text) == 0.0
    assert grounded_ratio("no numbers", tool_text) is None


def test_score_turn_adds_defaults_and_contains_crashes():
    result = score_turn(turn("35,372"), [Number(lambda t: t["missing"], 0)], TRUTH)
    names = [c["check"] for c in result["checks"]]
    assert "Answered" in names and "NoLatex" in names
    crashed = [c for c in result["checks"] if c["check"] == "Number"][0]
    assert not crashed["passed"] and "crashed" in crashed["detail"]
    assert not result["passed"]
