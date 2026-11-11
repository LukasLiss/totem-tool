"""Stored process-area compositions (``PROCESS_AREAS`` project assets).

Covers the asset format validator, the asset API round-trip, and the two
dashboard components that link a stored composition.
"""

import copy

from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from rest_framework import status
from rest_framework.test import APIClient

from .asset_formats import validate_process_areas_asset_dict
from .models import (
    Dashboard,
    ProcessAreaComponent,
    Project,
    ProjectAsset,
    VariantsComponent,
)


def _composition():
    return {
        "schema": "process-areas",
        "version": 1,
        "description": "Hand-tuned",
        "levels": [
            {
                "level": 0,
                "areas": [
                    {
                        "id": "pa-orders",
                        "name": "Order handling",
                        "objectTypes": ["order", "item"],
                        "activities": ["place order", "pick item"],
                    },
                    {
                        "id": "pa-shipping",
                        "name": "Shipping",
                        "objectTypes": ["package"],
                        "activities": ["ship package"],
                    },
                ],
            },
            {
                "level": 1,
                "areas": [
                    {
                        "id": "pa-staff",
                        "name": "Staff",
                        "objectTypes": ["employee"],
                        "activities": [],
                    }
                ],
            },
        ],
        "unassignedObjectTypes": ["customer"],
        "source": {"algorithm": "advanced", "fileId": 3},
    }


class ProcessAreasAssetValidatorTests(SimpleTestCase):
    def test_a_valid_composition_passes(self):
        data = _composition()
        self.assertIs(validate_process_areas_asset_dict(data), data)

    def assertRejected(self, data, fragment):
        with self.assertRaises(ValueError) as ctx:
            validate_process_areas_asset_dict(data)
        self.assertIn(fragment, str(ctx.exception))

    def test_schema_is_required(self):
        data = _composition()
        data["schema"] = "ocdfg"
        self.assertRejected(data, '"schema": "process-areas"')

    def test_area_names_are_unique_ignoring_case(self):
        data = _composition()
        data["levels"][1]["areas"][0]["name"] = "order HANDLING"
        self.assertRejected(data, "area names must be unique")

    def test_an_object_type_belongs_to_at_most_one_area(self):
        data = _composition()
        data["levels"][1]["areas"][0]["objectTypes"] = ["employee", "order"]
        self.assertRejected(data, 'Object type "order" is in both')

    def test_unassigned_types_must_not_also_be_in_an_area(self):
        data = _composition()
        data["unassignedObjectTypes"] = ["package"]
        self.assertRejected(data, 'Object type "package" is both unassigned')

    def test_area_ids_are_unique(self):
        data = _composition()
        data["levels"][1]["areas"][0]["id"] = "pa-orders"
        self.assertRejected(data, 'Duplicate process area id "pa-orders"')

    def test_areas_need_a_name_and_object_types(self):
        data = _composition()
        data["levels"][0]["areas"][0]["name"] = "  "
        self.assertRejected(data, 'needs a non-empty "name"')
        data = _composition()
        data["levels"][0]["areas"][0]["objectTypes"] = []
        self.assertRejected(data, "needs at least one object type")

    def test_levels_are_distinct_non_negative_integers(self):
        data = _composition()
        data["levels"][1]["level"] = 0
        self.assertRejected(data, "Duplicate level 0")
        data = _composition()
        data["levels"][1]["level"] = -1
        self.assertRejected(data, "non-negative integer")

    def test_a_composition_needs_an_area(self):
        data = _composition()
        data["levels"] = [{"level": 0, "areas": []}]
        self.assertRejected(data, "at least one process area")

    def test_empty_levels_between_others_are_allowed(self):
        data = _composition()
        data["levels"].append({"level": 2, "areas": []})
        validate_process_areas_asset_dict(data)


class ProcessAreasAssetApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="pa-asset-user")
        self.project = Project.objects.create(name="PA assets")
        self.project.users.add(self.user)
        self.client.force_authenticate(user=self.user)

    def _create(self, content=None, name="Order-to-delivery"):
        return self.client.post(
            "/api/assets/",
            {
                "project": self.project.pk,
                "name": name,
                "asset_type": "PROCESS_AREAS",
                "content_json": content if content is not None else _composition(),
            },
            format="json",
        )

    def test_create_list_update_and_delete(self):
        response = self._create()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        asset_id = response.data["id"]
        self.assertEqual(response.data["asset_type"], "PROCESS_AREAS")

        listed = self.client.get(
            f"/api/assets/?project={self.project.pk}&asset_type=PROCESS_AREAS"
        )
        self.assertEqual(listed.status_code, status.HTTP_200_OK)
        self.assertEqual([a["name"] for a in listed.data], ["Order-to-delivery"])

        content = _composition()
        content["levels"][0]["areas"][1]["name"] = "Outbound"
        updated = self.client.patch(
            f"/api/assets/{asset_id}/",
            {"name": "Renamed", "content_json": content},
            format="json",
        )
        self.assertEqual(updated.status_code, status.HTTP_200_OK, updated.content)
        stored = ProjectAsset.objects.get(pk=asset_id)
        self.assertEqual(stored.name, "Renamed")
        self.assertEqual(stored.content_json["levels"][0]["areas"][1]["name"], "Outbound")

        self.assertEqual(
            self.client.delete(f"/api/assets/{asset_id}/").status_code,
            status.HTTP_204_NO_CONTENT,
        )

    def test_invalid_content_is_rejected_with_a_message(self):
        content = copy.deepcopy(_composition())
        content["levels"][1]["areas"][0]["name"] = "Shipping"
        response = self._create(content)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("area names must be unique", str(response.data["content_json"]))

    def test_composition_names_are_unique_per_project(self):
        self.assertEqual(self._create().status_code, status.HTTP_201_CREATED)
        response = self._create()
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("name", response.data)


class ProcessAreaCompositionLinkTests(TestCase):
    """Variants and Process Area dashboard components link a stored composition."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="pa-link-user")
        self.project = Project.objects.create(name="PA links")
        self.project.users.add(self.user)
        self.dashboard = Dashboard.objects.create(
            project=self.project, name="D", order_in_project=0
        )
        self.asset = ProjectAsset.objects.create(
            project=self.project,
            name="Mine",
            asset_type=ProjectAsset.AssetType.PROCESS_AREAS,
            content_json=_composition(),
        )
        self.client.force_authenticate(user=self.user)

    def _save(self, items):
        response = self.client.post(
            f"/api/dashboard/{self.dashboard.pk}/save_layout/",
            {"layout": items},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        return self.client.get(f"/api/dashboard/{self.dashboard.pk}/get_layout/").data

    def _variants(self, **extra):
        return {"x": 0, "y": 0, "w": 6, "h": 6, "component_name": "VariantsComponent", **extra}

    def _process_area(self, **extra):
        return {"x": 6, "y": 0, "w": 6, "h": 6, "component_name": "ProcessAreaComponent", **extra}

    def test_both_components_keep_their_composition(self):
        layout = self._save(
            [
                self._variants(process_area_asset=self.asset.pk),
                self._process_area(composition_asset=self.asset.pk),
            ]
        )
        by_name = {c["component_name"]: c for c in layout}
        self.assertEqual(by_name["VariantsComponent"]["process_area_asset"], self.asset.pk)
        self.assertEqual(by_name["ProcessAreaComponent"]["composition_asset"], self.asset.pk)

    def test_missing_link_means_the_current_areas(self):
        layout = self._save([self._variants(), self._process_area()])
        by_name = {c["component_name"]: c for c in layout}
        self.assertIsNone(by_name["VariantsComponent"]["process_area_asset"])
        self.assertIsNone(by_name["ProcessAreaComponent"]["composition_asset"])

    def test_assets_of_other_projects_or_types_are_not_linked(self):
        other = Project.objects.create(name="Other")
        foreign = ProjectAsset.objects.create(
            project=other,
            name="Foreign",
            asset_type=ProjectAsset.AssetType.PROCESS_AREAS,
            content_json=_composition(),
        )
        query = ProjectAsset.objects.create(
            project=self.project,
            name="A query",
            asset_type=ProjectAsset.AssetType.QUERY,
            content_json={"schema": "sql-query", "version": 1, "query": "SELECT 1"},
        )
        layout = self._save(
            [
                self._variants(process_area_asset=foreign.pk),
                self._process_area(composition_asset=query.pk),
            ]
        )
        by_name = {c["component_name"]: c for c in layout}
        self.assertIsNone(by_name["VariantsComponent"]["process_area_asset"])
        self.assertIsNone(by_name["ProcessAreaComponent"]["composition_asset"])

    def test_deleting_the_asset_unlinks_the_components(self):
        self._save(
            [
                self._variants(process_area_asset=self.asset.pk),
                self._process_area(composition_asset=self.asset.pk),
            ]
        )
        self.asset.delete()
        self.assertIsNone(VariantsComponent.objects.get().process_area_asset)
        self.assertIsNone(ProcessAreaComponent.objects.get().composition_asset)
