import os
from unittest import TestCase
from evaluation.assistant_benchmark.datasets.ground_truth import (
    CONTAINER_LOGISTICS_PATH,
    ORDER_MANAGEMENT_PATH,
    GroundTruthEngine,
)


class GroundTruthTests(TestCase):
    def test_logistics_statistics(self):
        stats = GroundTruthEngine.get_log_statistics(CONTAINER_LOGISTICS_PATH)
        self.assertEqual(stats["num_events"], 35413)
        self.assertEqual(stats["num_objects"], 13910)
        self.assertGreater(stats["num_unique_activities"], 5)
        self.assertEqual(stats["num_object_types"], 7)

    def test_logistics_object_types(self):
        types = GroundTruthEngine.get_object_types(CONTAINER_LOGISTICS_PATH)
        expected = ["Container", "CustomerOrder", "Forklift", "HandlingUnit", "TransportDocument", "Truck", "Vehicle"]
        self.assertEqual(types, expected)

    def test_orders_object_types(self):
        types = GroundTruthEngine.get_object_types(ORDER_MANAGEMENT_PATH)
        expected = ["Customers", "Employees", "Items", "Orders", "Packages", "Products"]
        self.assertEqual(types, expected)

    def test_bottlenecks_computation(self):
        bottlenecks = GroundTruthEngine.get_top_bottlenecks(CONTAINER_LOGISTICS_PATH, limit=3)
        self.assertGreaterEqual(len(bottlenecks), 1)
        top = bottlenecks[0]
        self.assertIn("source", top)
        self.assertIn("target", top)
        self.assertGreater(top["avg_delay_seconds"], 100_000)

    def test_lifespans_computation(self):
        lifespans = GroundTruthEngine.get_object_lifespans(CONTAINER_LOGISTICS_PATH)
        self.assertEqual(len(lifespans), 7)
        top_types = [l["obj_type"] for l in lifespans[:2]]
        self.assertIn("Forklift", top_types)
        self.assertIn("Truck", top_types)
