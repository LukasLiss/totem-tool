"""
Benchmark task suite definition and catalog for the TOTeM AI Assistant evaluation.
Includes 20 realistic process mining questions with explicit ground truth specifications.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional
from .ground_truth import (
    CONTAINER_LOGISTICS_PATH,
    ORDER_MANAGEMENT_PATH,
)


class TaskCategory(str, Enum):
    DESCRIPTIVE = "descriptive"
    BOTTLENECK = "bottleneck"
    LIFESPAN = "lifespan"
    DISCOVERY = "discovery"
    UI_ACTION = "ui_action"


class ScorerType(str, Enum):
    EXACT_ENTITIES = "exact_entities"
    NUMERICAL = "numerical"
    SET_MEMBERSHIP = "set_membership"
    TOOL_CALL = "tool_call"
    QUALITATIVE = "qualitative"


@dataclass
class BenchmarkTask:
    id: str
    category: TaskCategory
    prompt: str
    target_log: str  # e.g. "ContainerLogistics" or "order-management"
    log_path: str
    scorer_type: ScorerType
    ground_truth: Dict[str, Any]
    description: str
    expected_tools: List[str] = field(default_factory=list)
    mode: str = "act"  # "act" or "teach"


# =============================================================================
# 20 Curated Benchmark Tasks
# =============================================================================

BENCHMARK_TASKS: List[BenchmarkTask] = [
    # -------------------------------------------------------------------------
    # T1 - T4: Descriptive & Log Profiling
    # -------------------------------------------------------------------------
    BenchmarkTask(
        id="T01_events_count_logistics",
        category=TaskCategory.DESCRIPTIVE,
        prompt="How many events are recorded in the logistics event log?",
        target_log="ContainerLogistics",
        log_path=CONTAINER_LOGISTICS_PATH,
        scorer_type=ScorerType.NUMERICAL,
        ground_truth={"value": 35413, "tolerance_pct": 0.0},
        description="Query exact total event count in ContainerLogistics.sqlite",
        expected_tools=["get_statistics"],
    ),
    BenchmarkTask(
        id="T02_objects_count_logistics",
        category=TaskCategory.DESCRIPTIVE,
        prompt="How many total objects are in the logistics event log?",
        target_log="ContainerLogistics",
        log_path=CONTAINER_LOGISTICS_PATH,
        scorer_type=ScorerType.NUMERICAL,
        ground_truth={"value": 13910, "tolerance_pct": 0.0},
        description="Query exact total object count in ContainerLogistics.sqlite",
        expected_tools=["get_statistics"],
    ),
    BenchmarkTask(
        id="T03_object_types_logistics",
        category=TaskCategory.DESCRIPTIVE,
        prompt="List all distinct object types present in the logistics event log.",
        target_log="ContainerLogistics",
        log_path=CONTAINER_LOGISTICS_PATH,
        scorer_type=ScorerType.SET_MEMBERSHIP,
        ground_truth={
            "required_entities": ["Container", "CustomerOrder", "Forklift", "HandlingUnit", "TransportDocument", "Truck", "Vehicle"],
        },
        description="Extract complete set of 7 object types in ContainerLogistics",
        expected_tools=["get_object_types", "get_statistics"],
    ),
    BenchmarkTask(
        id="T04_object_types_orders",
        category=TaskCategory.DESCRIPTIVE,
        prompt="Which object types exist in the order management event log?",
        target_log="order-management",
        log_path=ORDER_MANAGEMENT_PATH,
        scorer_type=ScorerType.SET_MEMBERSHIP,
        ground_truth={
            "required_entities": ["Customers", "Employees", "Items", "Orders", "Packages", "Products"],
        },
        description="Extract complete set of 6 object types in order-management",
        expected_tools=["get_object_types", "get_statistics"],
    ),

    # -------------------------------------------------------------------------
    # T5 - T7: Bottleneck & Latency Detection
    # -------------------------------------------------------------------------
    BenchmarkTask(
        id="T05_biggest_bottleneck_logistics",
        category=TaskCategory.BOTTLENECK,
        prompt="Between which activities is the biggest bottleneck in the logistics log?",
        target_log="ContainerLogistics",
        log_path=CONTAINER_LOGISTICS_PATH,
        scorer_type=ScorerType.EXACT_ENTITIES,
        ground_truth={
            "entity_pairs": [
                ["OrderEmptyContainers", "Depart"],
                ["PlaceinStock", "BringtoLoadingBay"],
            ],
            "primary_pair": ["OrderEmptyContainers", "Depart"],
            "disallowed_competitors": [
                ["RegisterCustomerOrder", "SendInvoice"],
                ["Arrival", "Depart"],
            ],
            "explanation": "OrderEmptyContainers -> Depart has avg delay > 1M seconds; PlaceinStock -> BringtoLoadingBay has 620k seconds over 2232 transitions."
        },
        description="Identify the activity pair corresponding to the longest delay",
        expected_tools=["get_statistics", "get_oc_dotted_chart"],
    ),
    BenchmarkTask(
        id="T06_high_volume_bottleneck_logistics",
        category=TaskCategory.BOTTLENECK,
        prompt="Which activity pair with more than 1000 transitions has the longest average delay in the logistics log?",
        target_log="ContainerLogistics",
        log_path=CONTAINER_LOGISTICS_PATH,
        scorer_type=ScorerType.EXACT_ENTITIES,
        ground_truth={
            "entity_pairs": [["PlaceinStock", "BringtoLoadingBay"]],
            "primary_pair": ["PlaceinStock", "BringtoLoadingBay"],
            "disallowed_competitors": [
                ["OrderEmptyContainers", "Depart"],
            ],
        },
        description="Identify high-volume bottleneck activity transition",
        expected_tools=["get_statistics", "get_oc_dotted_chart"],
    ),
    BenchmarkTask(
        id="T07_dotted_chart_throughput",
        category=TaskCategory.BOTTLENECK,
        prompt="What is the total duration span in days for the logistics event log?",
        target_log="ContainerLogistics",
        log_path=CONTAINER_LOGISTICS_PATH,
        scorer_type=ScorerType.NUMERICAL,
        ground_truth={"value": 453.5, "tolerance_pct": 5.0},
        description="Calculate total time horizon span in days",
        expected_tools=["get_statistics", "get_oc_dotted_chart"],
    ),

    # -------------------------------------------------------------------------
    # T8 - T10: Object Lifespan Duration
    # -------------------------------------------------------------------------
    BenchmarkTask(
        id="T08_longest_lifespan_logistics",
        category=TaskCategory.LIFESPAN,
        prompt="Identify the two object types that have the longest time between first and last event on average in the logistics log.",
        target_log="ContainerLogistics",
        log_path=CONTAINER_LOGISTICS_PATH,
        scorer_type=ScorerType.SET_MEMBERSHIP,
        ground_truth={
            "required_entities": ["Forklift", "Truck"],
            "disallowed_entities": ["HandlingUnit", "CustomerOrder"],
            "all_ranked": ["Forklift", "Truck", "Vehicle", "TransportDocument", "Container", "CustomerOrder", "HandlingUnit"],
        },
        description="Identify top-2 longest lived object types in ContainerLogistics",
        expected_tools=["get_statistics", "get_object_types"],
    ),
    BenchmarkTask(
        id="T09_longest_lifespan_orders",
        category=TaskCategory.LIFESPAN,
        prompt="Identify the two object types that have the longest average lifespan between first and last event in the order management log.",
        target_log="order-management",
        log_path=ORDER_MANAGEMENT_PATH,
        scorer_type=ScorerType.SET_MEMBERSHIP,
        ground_truth={
            "required_entities": ["Products", "Employees"],
            "disallowed_entities": ["Packages", "Orders"],
            "all_ranked": ["Products", "Employees", "Customers", "Items", "Orders", "Packages"],
        },
        description="Identify top-2 longest lived object types in order-management",
        expected_tools=["get_statistics", "get_object_types"],
    ),
    BenchmarkTask(
        id="T10_shortest_lifespan_logistics",
        category=TaskCategory.LIFESPAN,
        prompt="Which object type has the shortest average lifecycle duration in the logistics log?",
        target_log="ContainerLogistics",
        log_path=CONTAINER_LOGISTICS_PATH,
        scorer_type=ScorerType.EXACT_ENTITIES,
        ground_truth={
            "required_entities": ["HandlingUnit"],
        },
        description="Identify shortest-lived object type in ContainerLogistics",
        expected_tools=["get_statistics"],
    ),

    # -------------------------------------------------------------------------
    # T11 - T14: Process Model & Multi-Type Discovery
    # -------------------------------------------------------------------------
    BenchmarkTask(
        id="T11_most_frequent_activity_logistics",
        category=TaskCategory.DISCOVERY,
        prompt="What is the most frequent activity in the logistics log, and roughly how many times does it occur?",
        target_log="ContainerLogistics",
        log_path=CONTAINER_LOGISTICS_PATH,
        scorer_type=ScorerType.EXACT_ENTITIES,
        ground_truth={
            "required_entities": ["LoadHandlingUnitintoContainer"],
            "numerical_target": 10553,
            "tolerance_pct": 5.0,
        },
        description="Find activity with peak occurrence count",
        expected_tools=["get_statistics"],
    ),
    BenchmarkTask(
        id="T12_discover_occn_model",
        category=TaskCategory.DISCOVERY,
        prompt="Discover an Object-Centric C-Net (OCCN) for the logistics log with threshold 0.1.",
        target_log="ContainerLogistics",
        log_path=CONTAINER_LOGISTICS_PATH,
        scorer_type=ScorerType.TOOL_CALL,
        ground_truth={
            "tool_name": "discover_occn",
            "required_args": {"threshold": 0.1},
        },
        description="Invoke OCCN discovery with specific threshold",
        expected_tools=["discover_occn"],
    ),
    BenchmarkTask(
        id="T13_discover_totem_model",
        category=TaskCategory.DISCOVERY,
        prompt="Discover a TOTeM model graph from the logistics event log.",
        target_log="ContainerLogistics",
        log_path=CONTAINER_LOGISTICS_PATH,
        scorer_type=ScorerType.TOOL_CALL,
        ground_truth={
            "tool_name": "discover_totem",
        },
        description="Invoke TOTeM model discovery tool",
        expected_tools=["discover_totem"],
    ),
    BenchmarkTask(
        id="T14_find_trace_variants",
        category=TaskCategory.DISCOVERY,
        prompt="Extract the top process trace variants for leading object type Container.",
        target_log="ContainerLogistics",
        log_path=CONTAINER_LOGISTICS_PATH,
        scorer_type=ScorerType.TOOL_CALL,
        ground_truth={
            "tool_name": "find_variants",
            "required_args": {"leading_object_type": "Container"},
        },
        description="Invoke variant extraction tool for Container",
        expected_tools=["find_variants"],
    ),

    # -------------------------------------------------------------------------
    # T15 - T20: UI Actions & Dual-Mode Teach/Act Triggers
    # -------------------------------------------------------------------------
    BenchmarkTask(
        id="T15_teach_dashboard_creation",
        category=TaskCategory.UI_ACTION,
        prompt="Guide me through creating a new dashboard in the UI step by step.",
        target_log="ContainerLogistics",
        log_path=CONTAINER_LOGISTICS_PATH,
        mode="teach",
        scorer_type=ScorerType.TOOL_CALL,
        ground_truth={
            "tool_name": "highlight_element",
            "required_tour_sequence": [
                "nav-dashboard",
                "dashboard-add-btn",
                "dashboard-name-input",
                "dashboard-save-btn",
                "dashboard-add-card",
                "dashboard-grid",
            ],
        },
        description="Verify 6-step guided tour trigger for dashboard creation in Teach Mode",
        expected_tools=["highlight_element"],
    ),
    BenchmarkTask(
        id="T16_teach_conformance_navigation",
        category=TaskCategory.UI_ACTION,
        prompt="Where do I run conformance checking in the application?",
        target_log="ContainerLogistics",
        log_path=CONTAINER_LOGISTICS_PATH,
        mode="teach",
        scorer_type=ScorerType.TOOL_CALL,
        ground_truth={
            "tool_name": "highlight_element",
            "required_tour_id": "nav-conformance",
        },
        description="Verify single-step UI spotlight on conformance navigation in Teach Mode",
        expected_tools=["highlight_element"],
    ),
    BenchmarkTask(
        id="T17_teach_conceptual_conformance",
        category=TaskCategory.UI_ACTION,
        prompt="What does TOTeM conformance checking mean and how does it detect deviations?",
        target_log="ContainerLogistics",
        log_path=CONTAINER_LOGISTICS_PATH,
        mode="teach",
        scorer_type=ScorerType.QUALITATIVE,
        ground_truth={
            "must_not_invoke_tool": "highlight_element",
            "required_keywords": ["alignment", "deviation", "synchronization", "replay"],
        },
        description="Verify conceptual explanation without triggering UI spotlight in Teach Mode",
        expected_tools=[],
    ),
    BenchmarkTask(
        id="T18_act_create_dashboard",
        category=TaskCategory.UI_ACTION,
        prompt="Create a summary dashboard named 'Logistics Executive Overview' with statistics and variants.",
        target_log="ContainerLogistics",
        log_path=CONTAINER_LOGISTICS_PATH,
        mode="act",
        scorer_type=ScorerType.TOOL_CALL,
        ground_truth={
            "tool_name": "create_dashboard",
            "expected_name": "Logistics Executive Overview",
        },
        description="Direct mutation: call create_dashboard in Act Mode",
        expected_tools=["create_dashboard"],
    ),
    BenchmarkTask(
        id="T19_act_switch_view_dotted_chart",
        category=TaskCategory.UI_ACTION,
        prompt="Open the dotted chart view in analysis.",
        target_log="ContainerLogistics",
        log_path=CONTAINER_LOGISTICS_PATH,
        mode="act",
        scorer_type=ScorerType.TOOL_CALL,
        ground_truth={
            "tool_name": "set_view_mode",
            "required_args": {"mode": "analysis"},
        },
        description="Switch view mode to analysis / dotted chart",
        expected_tools=["set_view_mode", "get_oc_dotted_chart"],
    ),
    BenchmarkTask(
        id="T20_act_multi_action_workflow",
        category=TaskCategory.UI_ACTION,
        prompt="Identify the top bottleneck transition in the logistics log and navigate to the analysis view.",
        target_log="ContainerLogistics",
        log_path=CONTAINER_LOGISTICS_PATH,
        mode="act",
        scorer_type=ScorerType.TOOL_CALL,
        ground_truth={
            "expected_tools": ["get_statistics", "set_view_mode"],
        },
        description="Composite task requiring data analysis followed by UI navigation",
        expected_tools=["get_statistics", "set_view_mode"],
    ),
]


def get_benchmark_tasks() -> List[BenchmarkTask]:
    return BENCHMARK_TASKS
