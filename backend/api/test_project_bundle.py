"""Export and import a whole project as a single `.totem` file (#439).

Split out of `tests.py` the way `test_oc_alignment.py` and
`test_ocpn_flattened_replay.py` are: the area is large enough to read on its
own.
"""

import io
import json
import os
import shutil
import tempfile
import zipfile

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from .dashboard_bundle import DASHBOARD_BUNDLE_SCHEMA
from .models import (
    Dashboard,
    EventLog,
    ImageAsset,
    ImageComponent,
    Project,
    ProjectAsset,
    OCDottedChartComponent,
    SqlQueryComponent,
    TextBoxComponent,
)
from .project_bundle import (
    MANIFEST_NAME,
    MAX_COMPRESSION_RATIO,
    PROJECT_BUNDLE_SCHEMA,
    PROJECT_BUNDLE_VERSION,
    ProjectBundleError,
    check_archive_safety,
    safe_member_path,
    unique_display_name,
    unique_project_name,
    validate_project_manifest,
)

_MEDIA_ROOT = tempfile.mkdtemp(prefix="totem-project-bundle-")

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


class SafeMemberPathTests(SimpleTestCase):
    """Zip-slip: a member name must never escape where it is written."""

    def test_rejects_paths_that_climb_out(self):
        for name in (
            "../etc/passwd",
            "../../etc/passwd",
            "a/../../b",
            "/etc/passwd",
            "//etc/passwd",
            "C:/Windows/system32",
            "..\\..\\windows",
            "a/b/../../../c",
        ):
            with self.subTest(name=name):
                self.assertIsNone(safe_member_path(name))

    def test_accepts_ordinary_members(self):
        for name in ("manifest.json", "assets/images/001.png", "a/b/c.json"):
            with self.subTest(name=name):
                self.assertIsNotNone(safe_member_path(name))

    def test_normalises_without_losing_containment(self):
        self.assertEqual(safe_member_path("a/./b.json"), "a/b.json")


class ArchiveSafetyTests(SimpleTestCase):
    """A bundle is a file, so it is trusted less than the UI."""

    def _zip(self, members):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, data in members.items():
                zf.writestr(name, data)
        buffer.seek(0)
        return zipfile.ZipFile(buffer)

    def test_refuses_a_traversing_member_before_reading_it(self):
        with self.assertRaises(ProjectBundleError):
            check_archive_safety(self._zip({"../escape.json": b"{}"}))

    def test_refuses_too_many_members(self):
        with self.assertRaises(ProjectBundleError):
            check_archive_safety(self._zip({f"f{i}.txt": b"x" for i in range(1001)}))

    def test_refuses_a_zip_bomb_without_expanding_it(self):
        # Highly compressible: a few KB on disk claiming megabytes on extract.
        bomb = self._zip({"big.bin": b"\0" * (8 * 1024 * 1024)})
        compressed = sum(i.compress_size for i in bomb.infolist())
        uncompressed = sum(i.file_size for i in bomb.infolist())
        self.assertGreater(uncompressed, compressed * MAX_COMPRESSION_RATIO)
        with self.assertRaises(ProjectBundleError):
            check_archive_safety(bomb)

    def test_accepts_an_ordinary_archive(self):
        check_archive_safety(self._zip({"manifest.json": b"{}", "a/b.json": b"[]"}))


class ManifestValidationTests(SimpleTestCase):
    def _manifest(self, **overrides):
        return {
            "schema": PROJECT_BUNDLE_SCHEMA,
            "version": PROJECT_BUNDLE_VERSION,
            **overrides,
        }

    def test_accepts_a_well_formed_manifest(self):
        validate_project_manifest(self._manifest())

    def test_rejects_another_schema(self):
        with self.assertRaises(ProjectBundleError):
            validate_project_manifest(self._manifest(schema="totem-dashboard"))

    def test_rejects_a_newer_version(self):
        with self.assertRaises(ProjectBundleError) as caught:
            validate_project_manifest(self._manifest(version=PROJECT_BUNDLE_VERSION + 1))
        self.assertIn("newer version", str(caught.exception))

    def test_rejects_a_version_that_is_not_a_whole_number(self):
        for version in ("1", 1.5, True, None):
            with self.subTest(version=version):
                with self.assertRaises(ProjectBundleError):
                    validate_project_manifest(self._manifest(version=version))

    def test_rejects_too_many_dashboards(self):
        with self.assertRaises(ProjectBundleError):
            validate_project_manifest(self._manifest(dashboards=["d"] * 101))


@override_settings(MEDIA_ROOT=_MEDIA_ROOT)
class ProjectExportImportApiTests(TestCase):
    """The round trip: what comes back out, and what a bad file cannot do."""

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(_MEDIA_ROOT, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user("bundle-owner")
        self.other = User.objects.create_user("bundle-other")
        self.client.force_authenticate(user=self.user)

        self.project = Project.objects.create(name="source", display_name="Source Project")
        self.project.users.add(self.user)
        self.project.view_settings = {"ocdfg-variants": {"layout": "elk"}}
        self.project.save(update_fields=["view_settings"])

        self.event_log = EventLog.objects.create(
            project=self.project,
            file=SimpleUploadedFile("log.duckdb", b"DUCKDB-BYTES-HERE", "application/octet-stream"),
        )

        self.query = ProjectAsset.objects.create(
            project=self.project,
            name="Top events",
            asset_type=ProjectAsset.AssetType.QUERY,
            content_json={"schema": "sql-query", "version": 1, "query": "SELECT 1 AS n"},
            created_by=self.user,
        )
        self.image = ImageAsset.objects.create(
            project=self.project,
            name="Logo",
            image=SimpleUploadedFile("logo.png", PNG, "image/png"),
            content_type="image/png",
            created_by=self.user,
        )

        # Two dashboards, the first linking the second, so the link rules are
        # exercised by the round trip rather than only in dashboard tests.
        self.second = Dashboard.objects.create(
            project=self.project, name="Detail", order_in_project=2
        )
        self.first = Dashboard.objects.create(
            project=self.project, name="Overview", order_in_project=1
        )
        TextBoxComponent.objects.create(
            dashboard=self.first,
            x=0, y=0, w=4, h=2,
            component_name="TextBoxComponent",
            text="see detail",
            rich_text={
                "type": "doc",
                "content": [{"type": "paragraph", "content": [{
                    "type": "text", "text": "detail",
                    "marks": [{"type": "dashboardLink",
                               "attrs": {"dashboardId": self.second.pk}}],
                }]}],
            },
        )
        SqlQueryComponent.objects.create(
            dashboard=self.first,
            x=0, y=2, w=6, h=4,
            component_name="SqlQueryComponent",
            name="Top",
            query="SELECT 'stale'",
            query_asset=self.query,
            row_limit=10,
        )
        ImageComponent.objects.create(
            dashboard=self.second,
            x=0, y=0, w=3, h=3,
            component_name="ImageComponent",
            image_asset=self.image,
        )
        OCDottedChartComponent.objects.create(
            dashboard=self.second,
            x=3, y=0, w=6, h=6,
            component_name="OCDottedChartComponent",
            file_id=self.event_log.pk,
            x_axis="time",
        )

    # -- helpers ---------------------------------------------------------

    def _export(self, expect=200):
        response = self.client.get(
            f"/api/files/{self.event_log.pk}/export-project/"
        )
        self.assertEqual(response.status_code, expect)
        if expect != 200:
            return response
        return b"".join(response.streaming_content)

    def _import(self, payload, *, filename="project.totem", expect=201):
        response = self.client.post(
            "/api/files/import-project/",
            {"file": SimpleUploadedFile(filename, payload, "application/zip")},
            format="multipart",
        )
        self.assertEqual(response.status_code, expect, getattr(response, "data", b""))
        return response.data

    def _zip_of(self, members):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, data in members.items():
                zf.writestr(name, data if isinstance(data, bytes) else json.dumps(data))
        return buffer.getvalue()

    # -- export ----------------------------------------------------------

    def test_export_is_a_single_zip_named_totem(self):
        response = self.client.get(f"/api/files/{self.event_log.pk}/export-project/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["Content-Disposition"],
            'attachment; filename="source-project.totem"',
        )
        payload = b"".join(response.streaming_content)
        self.assertTrue(zipfile.is_zipfile(io.BytesIO(payload)))

    def test_export_contains_every_part_of_the_project(self):
        with zipfile.ZipFile(io.BytesIO(self._export())) as zf:
            names = set(zf.namelist())
            self.assertIn(MANIFEST_NAME, names)
            self.assertIn("project.json", names)
            self.assertIn("event-log/log.duckdb", names)
            self.assertIn("assets/models.json", names)
            self.assertIn("assets/images.json", names)
            self.assertEqual(
                len([n for n in names if n.startswith("dashboards/")]), 2
            )
            manifest = json.loads(zf.read(MANIFEST_NAME))
            self.assertEqual(manifest["schema"], PROJECT_BUNDLE_SCHEMA)
            self.assertEqual(manifest["counts"]["dashboards"], 2)
            self.assertTrue(manifest["duckdb_version"])
            # The log travels byte for byte, not re-encoded.
            self.assertEqual(zf.read("event-log/log.duckdb"), b"DUCKDB-BYTES-HERE")

    def test_an_embedded_dashboard_is_an_ordinary_dashboard_bundle(self):
        """The reuse claim: a dashboard pulled out of a project still imports.

        If this breaks, the project format has quietly forked from
        `totem-dashboard` and the two will drift.
        """
        with zipfile.ZipFile(io.BytesIO(self._export())) as zf:
            member = sorted(n for n in zf.namelist() if n.startswith("dashboards/"))[0]
            bundle = json.loads(zf.read(member))
        self.assertEqual(bundle["schema"], DASHBOARD_BUNDLE_SCHEMA)

        target = Project.objects.create(name="target")
        target.users.add(self.user)
        response = self.client.post(
            "/api/dashboard/import/",
            {"project": target.pk, "bundle": bundle},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_cannot_export_a_project_that_is_not_yours(self):
        self.client.force_authenticate(user=self.other)
        self._export(expect=404)

    # -- round trip ------------------------------------------------------

    def test_a_round_trip_restores_the_whole_project_without_warnings(self):
        """The point of the feature.

        A dashboard bundle on its own usually warns, because the assets it
        names are not in the target project. A project bundle ships them, so
        a clean import must report nothing at all.
        """
        payload = self._export()
        result = self._import(payload)

        self.assertEqual(result["warnings"], [])
        imported = Project.objects.get(pk=result["project"]["id"])
        self.assertNotEqual(imported.pk, self.project.pk)
        # Suffixed because the source project is still here under that name;
        # `UniqueDisplayNameTests` covers the unclashed case.
        self.assertEqual(imported.display_name, "Source Project (imported)")
        self.assertEqual(imported.view_settings, {"ocdfg-variants": {"layout": "elk"}})

        # The log travels and is registered.
        log = EventLog.objects.get(project=imported)
        self.assertEqual(log.file.read(), b"DUCKDB-BYTES-HERE")

        # Assets come back, by name.
        self.assertEqual(
            list(ProjectAsset.objects.filter(project=imported).values_list("name", flat=True)),
            ["Top events"],
        )
        image = ImageAsset.objects.get(project=imported)
        self.assertEqual(image.name, "Logo")
        # Re-saved through the field, so the new project id is in the path.
        self.assertIn(f"image_assets/{imported.pk}/", image.image.name)

        # Both dashboards, in order, with their widgets.
        names = list(
            Dashboard.objects.filter(project=imported)
            .order_by("order_in_project")
            .values_list("name", flat=True)
        )
        self.assertEqual(names, ["Overview", "Detail"])

        new_first = Dashboard.objects.get(project=imported, name="Overview")
        new_second = Dashboard.objects.get(project=imported, name="Detail")

        # The SQL widget relinked to the imported asset, not the source one.
        sql = SqlQueryComponent.objects.get(dashboard=new_first)
        self.assertEqual(sql.query_asset.project_id, imported.pk)
        self.assertEqual(sql.query_asset.name, "Top events")

        # The image widget relinked to the imported image.
        img = ImageComponent.objects.get(dashboard=new_second)
        self.assertEqual(img.image_asset_id, image.pk)

        # The cross-dashboard link points inside the new project.
        box = TextBoxComponent.objects.get(dashboard=new_first)
        self.assertIn(f'"dashboardId": {new_second.pk}', json.dumps(box.rich_text))

        # The dotted chart is bound to the *imported* log, and said nothing
        # about it: the log travelled in the same file, so its columns have
        # not changed and there is nothing for the user to re-check.
        chart = OCDottedChartComponent.objects.get(dashboard=new_second)
        self.assertEqual(chart.file_id, log.pk)

    def test_the_response_carries_the_event_log_the_client_must_select(self):
        """Without the serialized log the switcher reads "Untitled project".

        The upload path returns the whole row; import has to match it, or the
        client has nothing to label the restored project with.
        """
        result = self._import(self._export())
        self.assertIsNotNone(result["file"])
        self.assertEqual(result["file"]["id"], result["event_log"])
        for key in ("id", "project", "file"):
            self.assertIn(key, result["file"])

    def test_importing_twice_gives_two_independent_projects(self):
        payload = self._export()
        first = self._import(payload)
        second = self._import(payload)
        self.assertNotEqual(first["project"]["id"], second["project"]["id"])
        self.assertNotEqual(first["project"]["name"], second["project"]["name"])
        self.assertEqual(Project.objects.filter(users=self.user).count(), 3)

    def test_a_clashing_display_name_is_suffixed_not_duplicated(self):
        """Two identically labelled rows in the switcher tell the user nothing."""
        payload = self._export()
        # The source project is already called "Source Project".
        first = self._import(payload)
        self.assertEqual(first["project"]["display_name"], "Source Project (imported)")
        second = self._import(payload)
        self.assertEqual(second["project"]["display_name"], "Source Project (2)")

    def test_import_leaves_the_source_project_alone(self):
        before = {
            "dashboards": Dashboard.objects.filter(project=self.project).count(),
            "assets": ProjectAsset.objects.filter(project=self.project).count(),
            "images": ImageAsset.objects.filter(project=self.project).count(),
        }
        self._import(self._export())
        self.assertEqual(
            {
                "dashboards": Dashboard.objects.filter(project=self.project).count(),
                "assets": ProjectAsset.objects.filter(project=self.project).count(),
                "images": ImageAsset.objects.filter(project=self.project).count(),
            },
            before,
        )

    # -- refusals --------------------------------------------------------

    def test_a_file_that_is_not_an_archive_is_refused(self):
        before = Project.objects.count()
        self._import(b"this is not a zip", expect=400)
        self.assertEqual(Project.objects.count(), before)

    def test_a_bundle_with_a_traversing_member_creates_nothing(self):
        payload = self._zip_of(
            {
                MANIFEST_NAME: {"schema": PROJECT_BUNDLE_SCHEMA, "version": 1},
                "../escape.json": b"{}",
            }
        )
        before = Project.objects.count()
        response = self._import(payload, expect=400)
        self.assertIn("error", response)
        self.assertEqual(Project.objects.count(), before)

    def test_a_bundle_of_another_schema_is_refused(self):
        payload = self._zip_of(
            {MANIFEST_NAME: {"schema": "totem-dashboard", "version": 1}}
        )
        before = Project.objects.count()
        self._import(payload, expect=400)
        self.assertEqual(Project.objects.count(), before)

    def test_a_bundle_from_a_newer_build_is_refused_by_version(self):
        payload = self._zip_of(
            {MANIFEST_NAME: {"schema": PROJECT_BUNDLE_SCHEMA,
                             "version": PROJECT_BUNDLE_VERSION + 1}}
        )
        response = self._import(payload, expect=400)
        self.assertIn("newer version", response["error"])

    def test_a_bundle_with_no_manifest_is_refused(self):
        payload = self._zip_of({"project.json": {"name": "x"}})
        self._import(payload, expect=400)

    def test_a_listed_dashboard_that_is_absent_is_refused(self):
        payload = self._zip_of(
            {
                MANIFEST_NAME: {
                    "schema": PROJECT_BUNDLE_SCHEMA,
                    "version": 1,
                    "dashboards": ["dashboards/001-gone.json"],
                }
            }
        )
        before = Project.objects.count()
        self._import(payload, expect=400)
        self.assertEqual(Project.objects.count(), before)

    def test_no_file_is_a_four_hundred(self):
        response = self.client.post("/api/files/import-project/", {}, format="multipart")
        self.assertEqual(response.status_code, 400)

    @override_settings(MAX_PROJECTS_PER_USER=1)
    def test_a_user_at_the_project_limit_is_refused(self):
        payload = self._export()
        response = self.client.post(
            "/api/files/import-project/",
            {"file": SimpleUploadedFile("p.totem", payload, "application/zip")},
            format="multipart",
        )
        self.assertEqual(response.status_code, 403)

    def test_a_bad_model_asset_is_skipped_and_reported(self):
        """One unreadable asset must not cost the user the whole project."""
        payload = self._export()
        buffer = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(payload)) as src:
            with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as out:
                for info in src.infolist():
                    data = src.read(info.filename)
                    if info.filename == "assets/models.json":
                        data = json.dumps(
                            [{"name": "Broken", "asset_type": "QUERY",
                              "content_json": {"schema": "sql-query", "version": 1}}]
                        ).encode()
                    out.writestr(info.filename, data)

        result = self._import(buffer.getvalue())
        codes = [w["code"] for w in result["warnings"]]
        self.assertIn("asset_skipped", codes)
        imported = Project.objects.get(pk=result["project"]["id"])
        # The rest of the project still arrived.
        self.assertEqual(Dashboard.objects.filter(project=imported).count(), 2)


class UniqueProjectNameTests(TestCase):
    def test_slugifies_and_keeps_within_the_column(self):
        limit = Project._meta.get_field("name").max_length
        name = unique_project_name("A Very Long Project Name That Will Not Fit At All")
        self.assertLessEqual(len(name), limit)
        self.assertEqual(name, name.lower())

    def test_never_returns_a_name_already_taken(self):
        Project.objects.create(name="sample")
        Project.objects.create(name="sample-2")
        self.assertEqual(unique_project_name("Sample"), "sample-3")

    def test_falls_back_when_there_is_nothing_to_slugify(self):
        self.assertEqual(unique_project_name("!!!"), "project")


class UniqueDisplayNameTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("namer")

    def _own(self, display_name):
        project = Project.objects.create(name=f"p{display_name}"[:30], display_name=display_name)
        project.users.add(self.user)
        return project

    def test_an_unused_name_is_kept_exactly(self):
        # A sample project must arrive under the name its author chose.
        self.assertEqual(unique_display_name(self.user, "Container Logistics"),
                         "Container Logistics")

    def test_a_clash_is_suffixed(self):
        self._own("Demo")
        self.assertEqual(unique_display_name(self.user, "Demo"), "Demo (imported)")

    def test_another_user_s_project_is_not_a_clash(self):
        other = User.objects.create_user("someone-else")
        project = Project.objects.create(name="theirs", display_name="Demo")
        project.users.add(other)
        self.assertEqual(unique_display_name(self.user, "Demo"), "Demo")

    def test_a_blank_name_stays_blank(self):
        # Blank means "fall back to the event log's file name".
        self.assertEqual(unique_display_name(self.user, ""), "")

    def test_a_long_name_still_fits_after_a_suffix(self):
        limit = Project._meta.get_field("display_name").max_length
        base = "x" * limit
        self._own(base)
        result = unique_display_name(self.user, base)
        self.assertLessEqual(len(result), limit)
        self.assertTrue(result.endswith("(imported)"))
