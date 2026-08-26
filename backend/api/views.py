from rest_framework.decorators import api_view, action, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework import status, viewsets, serializers
from django.utils.text import slugify
from .models import (
    EventLog,
    Project,
    ProjectAsset,
    Dashboard,
    EventLog,
    DashboardComponent,
    NumberofEventsComponent,
    TextBoxComponent,
    ImageComponent,
    VariantsComponent,
    ProcessAreaComponent,
    LogStatisticsComponent,
    OCDFGComponent,
    OCDottedChartComponent,
    NewOCDFGComponent,
    OCCNComponent,
    UserSettings,
    OCPNComponent,
    SQLQueryComponent,
    PieChartComponent,
    TotemMinerComponent,
)
from .serializers import (
    DashboardComponentPolymorphicSerializer,
    DashboardSerializer,
    EventLogSerializer,
    OCCNConformanceRequestSerializer,
    OCCNReplayUnitDetailRequestSerializer,
    ProjectAssetSerializer,
    TotemConformanceRequestSerializer,
)
from django.db.models import Max

# DuckDB-first imports. All algorithms exercised by the views below have
# DuckDB-backed implementations (`OCDFGDb`, `totemDiscovery_db`, `find_variants`
# with an `OcelDuckDB` arg), so we never construct the polars OCEL on the
# Django side.
from totem_lib.dfg import OCDFGDb, NewOCDFGDb
from totem_lib import (
    discover_occn,
    extract_occn_replay_units,
    occn_from_dict,
    occn_replay_fitness,
    serialize_occn,
)
from totem_lib.variants import find_variants
from totem_lib.variants.ocvariants import calculate_layout
from totem_lib.totem import (
    Totem,
    conformance_of_totem,
    mlpaDiscovery,
    totemDiscovery_db,
    totem_from_dict,
    totem_to_dict,
)
from totem_lib.process_areas import (
    INDICATOR_NAMES,
    prepare_db,
    process_areas_from_aggregates,
)
from totem_lib.ocel import OcelDuckDB, import_ocel_db
from totem_lib.ocpn import discover_ocpn_db
from totem_lib.ocel.validation import OCELValidationException, validate_ocel
from totem_lib.ocel.pm4py_adapter import convert_ocel_duckdb_to_pm4py
from totem_lib.oc_dotted_chart import (
    get_oc_dotted_chart_columns,
    get_oc_dotted_chart_data,
)
from totem_lib.playout import (
    PlayoutEvent,
    PlayoutVariant,
    TooManyBindingsError,
    playout_from_model_dict,
    variants_to_ocel_dict,
)
from types import SimpleNamespace
from collections import OrderedDict
import networkx as nx


from .cache_utils import get_cached_result, set_cached_result
from django.core.cache import cache

import math
import os
from hashlib import sha1
import json
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser


def _should_use_cache(request) -> bool:
    """Check if the request should use cache (default: True).

    Pass ``?bypass_cache=1`` or ``?bypass_cache=true`` to skip reading
    from the cache.  Results are **always stored** even on bypass so
    the next normal request benefits.
    """
    val = request.query_params.get("bypass_cache", "").lower()
    return val not in ("1", "true", "yes")


TOTEM_MOCK = {
    "tempgraph": {
        "nodes": ["Order", "Delivery", "Invoice"],
        "D": [
            ["Order", "Delivery"],
            ["Delivery", "Invoice"],
        ],
        "I": [
            ["Invoice", "Order"],
        ],
        "P": [
            ["Order", "Invoice"],
        ],
    },
    "cardinalities": [
        {
            "from": "Order",
            "to": "Delivery",
            "log_cardinality": "1..n",
            "event_cardinality": "1..5",
        },
        {
            "from": "Delivery",
            "to": "Invoice",
            "log_cardinality": "0..1",
            "event_cardinality": "0..3",
        },
        {
            "from": "Order",
            "to": "Invoice",
            "log_cardinality": "1..1",
            "event_cardinality": "1..2",
        },
    ],
    "type_relations": [
        ["Order", "Delivery", "Invoice"],
    ],
    "all_event_types": [
        "Create Order",
        "Dispatch Order",
        "Confirm Delivery",
        "Issue Invoice",
        "Receive Payment",
    ],
    "object_type_to_event_types": {
        "Order": ["Create Order", "Dispatch Order"],
        "Delivery": ["Dispatch Order", "Confirm Delivery"],
        "Invoice": ["Issue Invoice", "Receive Payment"],
    },
}

TOTEM_MOCK_2 = {
    "tempgraph": {
        "nodes": ["Company", "Factory", "Warehouse", "HR", "Worker", "Order", "Item"],
        "D": [
            # ["Order", "HR"],
            ["Order", "Worker"],
            ["Item", "Worker"],
            ["Worker", "Factory"],
            ["Item", "Warehouse"],
            ["HR", "Company"],
            ["Factory", "Company"],
            ["Warehouse", "Company"],
        ],
        "P": [
            ["Factory", "Warehouse"],
            ["Warehouse", "Factory"],
            ["HR", "Worker"],
            ["Worker", "HR"],
        ],
        "I": [
            ["Order", "Item"],
        ],
    },
    "cardinalities": [
        {
            "from": "Order",
            "to": "HR",
            "log_cardinality": "1..1",
            "event_cardinality": "0..2",
        },
        {
            "from": "Order",
            "to": "Worker",
            "log_cardinality": "1..n",
            "event_cardinality": "1..5",
        },
        {
            "from": "Item",
            "to": "Worker",
            "log_cardinality": "0..n",
            "event_cardinality": "0..3",
        },
        {
            "from": "Worker",
            "to": "Factory",
            "log_cardinality": "1..n",
            "event_cardinality": "1..4",
        },
        {
            "from": "Worker",
            "to": "Warehouse",
            "log_cardinality": "1..n",
            "event_cardinality": "1..3",
        },
        {
            "from": "Factory",
            "to": "Company",
            "log_cardinality": "1..1",
            "event_cardinality": "1..1",
        },
        {
            "from": "Warehouse",
            "to": "Company",
            "log_cardinality": "1..1",
            "event_cardinality": "1..1",
        },
    ],
    "type_relations": [
        ["Company", "Factory"],
        ["Company", "Warehouse"],
        ["Company", "Worker"],
        ["Factory", "Warehouse"],
        ["Factory", "Worker"],
        ["HR", "Order"],
        ["HR", "Worker"],
        ["Item", "Worker"],
        ["Order", "Item"],
        ["Order", "Worker"],
    ],
    "all_event_types": [
        "Close Company",
        "Complete Order",
        "Create Order",
        "Dispatch Inventory",
        "Establish Company",
        "Hire Worker",
        "Maintain Equipment",
        "Package Item",
        "Process Contract",
        "Relocate Worker",
        "Ship Item",
        "Staff Shift",
        "Start Production",
        "Store Inventory",
    ],
    "object_type_to_event_types": {
        "Company": ["Establish Company", "Close Company"],
        "Factory": ["Start Production", "Maintain Equipment"],
        "Warehouse": ["Store Inventory", "Dispatch Inventory"],
        "HR": ["Hire Worker", "Process Contract"],
        "Worker": ["Staff Shift", "Relocate Worker"],
        "Order": ["Create Order", "Complete Order"],
        "Item": ["Package Item", "Ship Item"],
    },
}


@api_view(["OPTIONS"])
def debug_options(request):
    return Response({"headers": dict(request.headers)})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def greeting(request):

    return Response({"message": "Hello, greetings from the backend!"})


@api_view(["GET"])
@permission_classes([AllowAny])
def health_check(request):
    return Response({"status": "ok", "message": "Backend is running."})


class EventLogViewSet(viewsets.ModelViewSet):
    serializer_class = EventLogSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return EventLog.objects.filter(project__users=self.request.user)

    def perform_create(self, serializer):

        user = self.request.user if self.request.user.is_authenticated else None

        file_name = serializer.validated_data["file"].name
        project_name = f"{slugify(file_name)}_{user.username if user else 'anonymous'}"

        project = Project.objects.create(name=project_name)
        if user:
            project.users.add(user)
            project.save()
        event_log = serializer.save(project=project)
        
        # Check if the file needs DuckDB conversion
        file_path = event_log.file.path
        if not file_path.lower().endswith('.duckdb'):
            # Generate the new .duckdb path
            base_name, _ = os.path.splitext(file_path)
            new_path = base_name + ".duckdb"
            
            db = None
            try:
                try:
                    # Import and convert the file into the new DuckDB database with strict validation
                    db = import_ocel_db(file_path, db_path=new_path, strict_mode=True)
                finally:
                    if db is not None:
                        try:
                            db.close()
                        except Exception:
                            pass
                
                # Remove the original uploaded file from disk
                try:
                    os.remove(file_path)
                except OSError:
                    pass
                
                # Update the event_log to point to the new file
                original_name, _ = os.path.splitext(event_log.file.name)
                event_log.file.name = original_name + ".duckdb"
                event_log.save(update_fields=['file'])
            except Exception as e:
                # Clean up half-written .duckdb file if it exists
                if os.path.exists(new_path):
                    try:
                        os.remove(new_path)
                    except OSError:
                        pass
                
                # Clean up original uploaded file if it still exists
                try:
                    if event_log.file and os.path.exists(event_log.file.path):
                        os.remove(event_log.file.path)
                except OSError:
                    pass

                # Delete event_log and project records
                try:
                    event_log.delete()
                except Exception:
                    pass
                try:
                    project.delete()
                except Exception:
                    pass

                if isinstance(e, OCELValidationException):
                    raise
                raise serializers.ValidationError(
                    {"error": f"Failed to convert file to DuckDB format: {str(e)}"}
                )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        try:
            self.perform_create(serializer)
            user_file = serializer.instance
            
            db = _build_ocel_db_from_path(user_file.file.path, strict_mode=True)
            with _OCEL_DB_REGISTRY_LOCK:
                pk = int(user_file.pk)
                _OCEL_DB_REGISTRY[pk] = db
                _OCEL_DB_LOCKS[pk] = threading.Lock()
        except serializers.ValidationError as e:
            return Response(e.detail, status=status.HTTP_400_BAD_REQUEST)
        except OCELValidationException as e:
            if hasattr(serializer, 'instance') and serializer.instance:
                user_file = serializer.instance
                if hasattr(user_file, 'file') and user_file.file and os.path.exists(user_file.file.path):
                    try:
                        os.remove(user_file.file.path)
                    except OSError:
                        pass
                if hasattr(user_file, 'project') and user_file.project:
                    try:
                        user_file.project.delete()
                    except Exception:
                        pass
                if user_file.pk:
                    try:
                        user_file.delete()
                    except Exception:
                        pass
            return Response({"errors": e.errors}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            if hasattr(serializer, 'instance') and serializer.instance:
                user_file = serializer.instance
                if hasattr(user_file, 'file') and user_file.file and os.path.exists(user_file.file.path):
                    try:
                        os.remove(user_file.file.path)
                    except OSError:
                        pass
                if hasattr(user_file, 'project') and user_file.project:
                    try:
                        user_file.project.delete()
                    except Exception:
                        pass
                if user_file.pk:
                    try:
                        user_file.delete()
                    except Exception:
                        pass
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    @action(detail=True, methods=["get"])
    def NoE(self, request, pk=None):

        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response(
                {"error": "File not found"}, status=status.HTTP_404_NOT_FOUND
            )

        if _should_use_cache(request):
            cached = get_cached_result(user_file, "noe")
            if cached is not None:
                return Response(cached, status=status.HTTP_200_OK)

        try:
            with _with_ocel_db(user_file) as db:
                processed = db.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        except Exception as e:
            return Response(
                {"error": f"Failed to process file: {e}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        set_cached_result(user_file, "noe", processed)
        return Response(processed, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"])
    def object_types(self, request, pk=None):
        """Returns the list of object types present in the event log."""
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response(
                {"error": "File not found"}, status=status.HTTP_404_NOT_FOUND
            )

        if _should_use_cache(request):
            cached = get_cached_result(user_file, "object_types")
            if cached is not None:
                return Response(cached, status=status.HTTP_200_OK)

        try:
            types = _get_ocel_object_types(user_file)
        except Exception as e:
            return Response(
                {"error": f"Failed to load OCEL: {e}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        set_cached_result(user_file, "object_types", types)
        return Response(types, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"])
    def discover_totem(self, request, pk=None):
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response(
                {"error": "File not found"}, status=status.HTTP_404_NOT_FOUND
            )

        try:
            if _should_use_cache(request):
                cached = get_cached_result(user_file, "discover_totem")
                if cached is not None:
                    return Response(cached, status=status.HTTP_200_OK)

            with _with_ocel_db(user_file) as db:
                # Run with tau=0.0 so the frontend can filter the full relation set.
                totem = totemDiscovery_db(db, tau=0.0)
            serialized = totem_to_dict(totem)
            
            # Augment with relations_stats for frontend tau filtering
            h_log = getattr(totem, "h_log_cardinalities", {})
            h_event = getattr(totem, "h_event_cardinalities", {})
            h_tr = getattr(totem, "h_temporal_relations", {})
            
            all_pairs = set(h_log.keys()) | set(h_event.keys()) | set(h_tr.keys())
            relations_stats = []
            for t1, t2 in all_pairs:
                log_card = h_log.get((t1, t2), {})
                event_card = h_event.get((t1, t2), {})
                tr_rel = h_tr.get((t1, t2), {})

                lc_total = log_card.get("total", 0)
                ec_total = event_card.get("total", 0)
                tr_total = tr_rel.get("total", 0)

                lc_pct = {k: log_card[k] / lc_total for k in ["0", "1", "0...1", "1..*", "0...*"] if k in log_card and lc_total > 0}
                ec_pct = {k: event_card[k] / ec_total for k in ["0", "1", "0...1", "1..*", "0...*"] if k in event_card and ec_total > 0}
                tr_pct = {k: tr_rel[k] / tr_total for k in ["D", "Di", "I", "Ii", "P"] if k in tr_rel and tr_total > 0}

                relations_stats.append({
                    "from": t1,
                    "to": t2,
                    "lc_total": lc_total,
                    "ec_total": ec_total,
                    "tr_total": tr_total,
                    "lc_percentages": lc_pct,
                    "ec_percentages": ec_pct,
                    "tr_percentages": tr_pct
                })
            
            serialized["relations_stats"] = relations_stats

            set_cached_result(user_file, "discover_totem", serialized)
            return Response(serialized, status=status.HTTP_200_OK)
        except Exception as e:
            return Response(
                {"error": f"An error occurred during Totem discovery: {e}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=["post"])
    def totem_conformance(self, request, pk=None):
        """Check one stored TOTeM asset against this event log."""
        request_serializer = TotemConformanceRequestSerializer(data=request.data)
        if not request_serializer.is_valid():
            return Response(
                request_serializer.errors,
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response(
                {"error": "File not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        asset_id = request_serializer.validated_data["asset_id"]
        try:
            asset = ProjectAsset.objects.get(
                pk=asset_id,
                project__users=request.user,
            )
        except ProjectAsset.DoesNotExist:
            return Response(
                {"asset_id": "Model asset not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if asset.project_id != user_file.project_id:
            return Response(
                {"asset_id": "Model asset must belong to the event log project."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if asset.asset_type != ProjectAsset.AssetType.TOTEM:
            return Response(
                {"asset_id": "Model asset must have type TOTEM."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            totem = totem_from_dict(asset.content_json)
        except (TypeError, ValueError) as exc:
            return Response(
                {"asset_id": f"Stored TOTeM model is invalid: {exc}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with _with_ocel_db(user_file) as db:
                result = conformance_of_totem(totem, db)
        except Exception as exc:
            return Response(
                {"error": f"Failed to calculate TOTeM conformance: {exc}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {
                "file_id": user_file.pk,
                "asset_id": asset.pk,
                **result.to_dict(),
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"])
    def occn_conformance(self, request, pk=None):
        """Check one stored OCCN asset against this event log."""
        request_serializer = OCCNConformanceRequestSerializer(data=request.data)
        if not request_serializer.is_valid():
            return Response(
                request_serializer.errors,
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response(
                {"error": "File not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        asset_id = request_serializer.validated_data["asset_id"]
        try:
            asset = ProjectAsset.objects.get(
                pk=asset_id,
                project__users=request.user,
            )
        except ProjectAsset.DoesNotExist:
            return Response(
                {"asset_id": "Model asset not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if asset.project_id != user_file.project_id:
            return Response(
                {"asset_id": "Model asset must belong to the event log project."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if asset.asset_type != ProjectAsset.AssetType.OCCN:
            return Response(
                {"asset_id": "Model asset must have type OCCN."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            occn = occn_from_dict(asset.content_json)
        except (AssertionError, TypeError, ValueError) as exc:
            return Response(
                {"asset_id": f"Stored OCCN model is invalid: {exc}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        replay_unit_strategy = request_serializer.validated_data["replay_unit_strategy"]
        leading_object_type = request_serializer.validated_data.get(
            "leading_object_type"
        )
        max_states = request_serializer.validated_data["max_states"]
        try:
            with _with_ocel_db(user_file) as db:
                if (
                    leading_object_type is not None
                    and leading_object_type not in _object_types(db)
                ):
                    return Response(
                        {
                            "leading_object_type": (
                                "Object type does not exist in the event log."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                replay_units = extract_occn_replay_units(
                    db,
                    strategy=replay_unit_strategy,
                    leading_object_type=leading_object_type,
                )
        except Exception as exc:
            return Response(
                {"error": f"Failed to extract OCCN replay units: {exc}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        try:
            result = occn_replay_fitness(
                occn,
                replay_units,
                max_states=max_states,
            )
        except Exception as exc:
            return Response(
                {"error": f"Failed to calculate OCCN conformance: {exc}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {
                "file_id": user_file.pk,
                "asset_id": asset.pk,
                "replay_unit_strategy": replay_unit_strategy,
                "leading_object_type": leading_object_type,
                "max_states": max_states,
                **result.to_dict(),
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["get"])
    def occn_replay_unit_detail(self, request, pk=None):
        """Return one bounded event page for a derived OCCN replay unit."""
        request_serializer = OCCNReplayUnitDetailRequestSerializer(
            data=request.query_params
        )
        if not request_serializer.is_valid():
            return Response(
                request_serializer.errors,
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response(
                {"error": "File not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        replay_unit_strategy = request_serializer.validated_data["replay_unit_strategy"]
        leading_object_type = request_serializer.validated_data.get(
            "leading_object_type"
        )
        try:
            with _with_ocel_db(user_file) as db:
                if (
                    leading_object_type is not None
                    and leading_object_type not in _object_types(db)
                ):
                    return Response(
                        {
                            "leading_object_type": (
                                "Object type does not exist in the event log."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                replay_units = extract_occn_replay_units(
                    db,
                    strategy=replay_unit_strategy,
                    leading_object_type=leading_object_type,
                )
        except Exception as exc:
            return Response(
                {"error": f"Failed to extract OCCN replay units: {exc}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        unit_id = request_serializer.validated_data["unit_id"]
        replay_unit = next(
            (unit for unit in replay_units if unit.unit_id == unit_id),
            None,
        )
        if replay_unit is None:
            return Response(
                {"unit_id": "Replay unit not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        offset = request_serializer.validated_data["offset"]
        limit = request_serializer.validated_data["limit"]
        total_count = len(replay_unit.events)
        event_page = replay_unit.events[offset : offset + limit]
        returned_count = len(event_page)
        has_previous = offset > 0 and total_count > 0
        has_next = offset + returned_count < total_count
        last_page_offset = (
            ((total_count - 1) // limit) * limit if total_count > 0 else 0
        )

        return Response(
            {
                "file_id": user_file.pk,
                "unit_id": replay_unit.unit_id,
                "replay_unit_strategy": replay_unit_strategy,
                "leading_object_type": leading_object_type,
                "event_count": total_count,
                "object_types": list(replay_unit.object_types),
                "pagination": {
                    "offset": offset,
                    "limit": limit,
                    "returned_count": returned_count,
                    "total_count": total_count,
                    "has_previous": has_previous,
                    "has_next": has_next,
                    "previous_offset": (
                        min(max(0, offset - limit), last_page_offset)
                        if has_previous
                        else None
                    ),
                    "next_offset": offset + limit if has_next else None,
                },
                "events": [
                    {
                        "event_index": offset + index,
                        **event.to_dict(),
                    }
                    for index, event in enumerate(event_page)
                ],
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["get"])
    def discover_mlpa(self, request, pk=None):
        """API endpoint to perform MLPA discovery on a given event log.
        It applies totem discovery first, then MLPA discovery."""
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response(
                {"error": "File not found"}, status=status.HTTP_404_NOT_FOUND
            )

        try:
            if _should_use_cache(request):
                cached = get_cached_result(user_file, "discover_mlpa")
                if cached is not None:
                    return Response(cached, status=status.HTTP_200_OK)

            with _with_ocel_db(user_file) as db:
                totem = totemDiscovery_db(db)
            # mlpaDiscovery operates on the Totem object (no DB access),
            # so it can run outside the per-file lock.
            process_view = mlpaDiscovery(totem)
            serialized = _serialize_mlpa(process_view, totem)

            set_cached_result(user_file, "discover_mlpa", serialized)
            return Response(serialized, status=status.HTTP_200_OK)
        except Exception as e:
            return Response(
                {"error": f"An error occurred during Totem and MLPA discovery: {e}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=["get"])
    def discover_process_areas(self, request, pk=None):
        """
        Advanced resource-based process area discovery (thesis section 4.1).

        Same response schema as `discover_mlpa` — only the engine that decides
        the layering differs, so the frontend can switch between the two by
        changing the URL and nothing else.

        Query parameters: `w_temporal`, `w_cardinality`, `w_divergence`,
        `alpha`, `beta`.
        """
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response(
                {"error": "File not found"}, status=status.HTTP_404_NOT_FOUND
            )

        try:
            params = _parse_process_area_params(request.query_params)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        try:
            # Every parameter is part of the key. `discover_mlpa` keys on the
            # file alone, which is fine because it takes no parameters; copying
            # that here would make the UI sliders silently return the first
            # result for an hour.
            cache_params = _process_area_cache_params(params)
            use_cache = _should_use_cache(request)
            if use_cache:
                cached = get_cached_result(
                    user_file, "discover_process_areas", cache_params
                )
                if cached is not None:
                    return Response(cached, status=status.HTTP_200_OK)

            # Two-tier cache. Preparation reads the log and depends only on it;
            # the weights and alpha/beta only affect scoring and the ILP solve.
            # Caching the two separately turns a slider change into a solve
            # instead of a full rediscovery.
            aggregates = (
                get_cached_result(user_file, "process_area_prep") if use_cache else None
            )
            totem_data = (
                get_cached_result(user_file, "discover_totem_raw") if use_cache else None
            )

            if aggregates is None or totem_data is None:
                with _with_ocel_db(user_file) as db:
                    if aggregates is None:
                        aggregates = prepare_db(db)
                        set_cached_result(user_file, "process_area_prep", aggregates)
                    if totem_data is None:
                        totem_data = totem_to_dict(totemDiscovery_db(db))
                        set_cached_result(
                            user_file, "discover_totem_raw", totem_data
                        )

            process_view = process_areas_from_aggregates(
                aggregates,
                weights=params["weights"],
                alpha=params["alpha"],
                beta=params["beta"],
            )

            serialized = {
                "layers": _serialize_process_layers(process_view),
                "tempgraph": totem_data["tempgraph"],
                "type_relations": totem_data["type_relations"],
                "all_event_types": totem_data["all_event_types"],
                "object_type_to_event_types": totem_data["object_type_to_event_types"],
            }

            set_cached_result(
                user_file, "discover_process_areas", serialized, cache_params
            )
            return Response(serialized, status=status.HTTP_200_OK)
        except Exception as e:
            return Response(
                {"error": f"An error occurred during process area discovery: {e}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=["get"])
    def discover_ocpn(self, request, pk=None):
        """Discovers an Object-Centric Petri Net from the event log.

        Runs the DuckDB-backed OCPN discovery of totem_lib (inductive
        miner per object type + merge, following van der Aalst & Berti).
        Query params:
          - timeout_s: abort with HTTP 408 after this many seconds
            (default 30; <= 0 disables the timeout).
          - object_types: optional comma-separated subset of object types.
        Returns the OCPN in the "format: ocpn" JSON exchange format.
        """
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            timeout_s = float(request.query_params.get("timeout_s", "30.0"))
            if timeout_s <= 0:
                timeout_s = None  # disable
        except (TypeError, ValueError):
            timeout_s = 30.0

        raw_object_types = request.query_params.get("object_types")
        object_type_filter = None
        if raw_object_types:
            object_type_filter = sorted(
                t.strip() for t in raw_object_types.split(",") if t.strip()
            ) or None

        # The discovered model only depends on the log and the selected
        # object types, not on the timeout budget — cache accordingly.
        types_key = ",".join(object_type_filter) if object_type_filter else "all"
        cache_key = f"ocpn_discovery_{user_file.pk}_{sha1(types_key.encode()).hexdigest()}"
        cached_result = cache.get(cache_key)
        if cached_result:
            return Response(cached_result, status=status.HTTP_200_OK)

        try:
            with _with_ocel_db(user_file) as db:
                model = discover_ocpn_db(
                    db,
                    object_types=object_type_filter,
                    timeout_s=timeout_s,
                    name=os.path.splitext(os.path.basename(user_file.file.name))[0],
                )
        except TimeoutError as e:
            return Response(
                {
                    "error": str(e),
                    "code": "timeout",
                    "timeout_s": timeout_s,
                    "hint": "Increase the timeout or restrict the discovery "
                            "to fewer object types.",
                },
                status=status.HTTP_408_REQUEST_TIMEOUT,
            )
        except Exception as e:
            return Response(
                {"error": f"An error occurred during OCPN discovery: {e}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        result = {"ocpn": model}
        cache.set(cache_key, result, timeout=3600)
        return Response(result, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"])
    def statistics(self, request, pk=None):
        """Returns basic statistics of the event log."""
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response(
                {"error": "File not found"}, status=status.HTTP_404_NOT_FOUND
            )

        if _should_use_cache(request):
            cached = get_cached_result(user_file, "statistics")
            if cached is not None:
                return Response(cached, status=status.HTTP_200_OK)

        try:
            with _with_ocel_db(user_file) as db:
                # Single round-trip per scalar. All counts are O(table scan)
                # in DuckDB which dominates over the round-trip cost.
                num_events = db.conn.execute("SELECT COUNT(*) FROM events").fetchone()[
                    0
                ]
                num_unique_activities = db.conn.execute(
                    "SELECT COUNT(DISTINCT activity) FROM events"
                ).fetchone()[0]
                num_objects = db.conn.execute(
                    "SELECT COUNT(*) FROM objects"
                ).fetchone()[0]
                num_object_types = db.conn.execute(
                    "SELECT COUNT(DISTINCT obj_type) FROM objects"
                ).fetchone()[0]
                ts_row = db.conn.execute(
                    "SELECT MIN(timestamp_unix), MAX(timestamp_unix) FROM events"
                ).fetchone()
            earliest_timestamp, newest_timestamp = ts_row if ts_row else (None, None)

            result = {
                "num_events": num_events,
                "num_unique_activities": num_unique_activities,
                "num_objects": num_objects,
                "num_object_types": num_object_types,
                "earliest_timestamp": earliest_timestamp,
                "newest_timestamp": newest_timestamp,
            }
            set_cached_result(user_file, "statistics", result)
            return Response(result, status=status.HTTP_200_OK)
        except Exception as e:
            return Response(
                {"error": f"Failed to compute statistics: {e}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=["get"])
    def oc_dotted_chart(self, request, pk=None):
        """Returns sampled event data for the object-centric dotted chart."""
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response(
                {"error": "File not found"}, status=status.HTTP_404_NOT_FOUND
            )

        try:
            row_min = _optional_int(request.query_params.get("row_min"))
            row_max = _optional_int(request.query_params.get("row_max"))
            max_points = int(request.query_params.get("max_points", 3000))
            sample_seed = int(request.query_params.get("sample_seed", 0))
        except ValueError:
            return Response(
                {
                    "error": "row_min, row_max, max_points, and sample_seed must be integers"
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with _with_ocel_db(user_file) as db:
                result = get_oc_dotted_chart_data(
                    db,
                    t_min=request.query_params.get("t_min"),
                    t_max=request.query_params.get("t_max"),
                    row_min=row_min,
                    row_max=row_max,
                    x_axis=request.query_params.get("x_axis", "time"),
                    y_axis=request.query_params.get("y_axis"),
                    color_by=request.query_params.get("color_by", "activity"),
                    shape_by=request.query_params.get("shape_by", "none"),
                    sort_by=request.query_params.get("sort_by", "time"),
                    row_order=request.query_params.get("row_order", "first_occurrence"),
                    max_points=max_points,
                    sample_seed=sample_seed,
                )
        except Exception as e:
            return Response(
                {"error": f"Failed to load OC dotted chart data: {e}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(result, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"])
    def oc_dotted_chart_columns(self, request, pk=None):
        """Returns configurable dimensions for the object-centric dotted chart."""
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response(
                {"error": "File not found"}, status=status.HTTP_404_NOT_FOUND
            )

        try:
            with _with_ocel_db(user_file) as db:
                result = get_oc_dotted_chart_columns(db)
        except Exception as e:
            return Response(
                {"error": f"Failed to load OC dotted chart columns: {e}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(result, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def execute_query(self, request, pk=None):
        """Execute a read-only SQL query against the log's DuckDB tables.

        The query runs on the shared per-file DuckDB (tables: events,
        objects, event_object, object_attribute_history, object_relations)
        under the per-file lock, so it cannot race other algorithm work.
        """
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

        query = request.data.get('query')
        if not query:
            return Response({"error": "Query parameter is required"}, status=status.HTTP_400_BAD_REQUEST)

        # Security check: only allow SELECT queries (read-only)
        query_upper = query.strip().upper()
        if not query_upper.startswith('SELECT'):
            return Response({"error": "Only SELECT queries are allowed"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with _with_ocel_db(user_file) as db:
                cursor = db.conn.execute(query)
                columns = [d[0] for d in cursor.description]
                rows = cursor.fetchall()
        except Exception as e:
            return Response({"error": f"Query execution failed: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        data = [dict(zip(columns, row)) for row in rows]
        return Response({"data": data, "columns": columns}, status=status.HTTP_200_OK)

class ProjectAssetViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectAssetSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        queryset = ProjectAsset.objects.filter(
            project__users=self.request.user,
        ).select_related("project", "created_by")

        project_id = self.request.query_params.get("project")
        if project_id:
            queryset = queryset.filter(project_id=project_id)

        asset_type = self.request.query_params.get("asset_type")
        if asset_type:
            queryset = queryset.filter(asset_type=asset_type)

        return queryset

    def list(self, request, *args, **kwargs):
        asset_type = request.query_params.get("asset_type")
        if asset_type and asset_type not in ProjectAsset.AssetType.values:
            return Response(
                {"asset_type": "Unsupported asset type."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().list(request, *args, **kwargs)

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        asset = self.get_object()
        response = Response(asset.content_json, status=status.HTTP_200_OK)
        filename = f"{slugify(asset.name) or 'model-asset'}.json"
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

class DashboardViewSet(viewsets.ModelViewSet):
    serializer_class = DashboardSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = Dashboard.objects.filter(project__users=self.request.user)
        project_id = self.request.query_params.get("project")
        if project_id:
            qs = qs.filter(project_id=project_id)
        return qs

    def perform_create(self, serializer):
        project_id = self.request.data.get("project")
        project = Project.objects.get(id=project_id, users=self.request.user)
        serializer.save(project=project)

    @action(detail=True, methods=["PATCH"])
    def rename(self, request, pk=None):
        """
        Rename a dashboard. Only accepts `name` in the body.
        """
        dashboard = self.get_object()
        new_name = request.data.get("name")
        if not new_name:
            return Response(
                {"error": "Name is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        dashboard.name = new_name
        dashboard.save()
        return Response(self.get_serializer(dashboard).data)

        serializer.save(project=project)

    @action(detail=True, methods=["GET"])
    def get_layout(self, request, pk=None):
        dashboard = self.get_object()
        base_components = dashboard.components.all()
        components = []
        for comp in base_components:
            if comp.component_name == "TextBoxComponent":
                components.append(TextBoxComponent.objects.get(id=comp.id))
            elif comp.component_name == "NumberofEventsComponent":
                components.append(NumberofEventsComponent.objects.get(id=comp.id))
            elif comp.component_name == "ImageComponent":
                components.append(ImageComponent.objects.get(id=comp.id))
            elif comp.component_name == "VariantsComponent":
                components.append(VariantsComponent.objects.get(id=comp.id))
            elif comp.component_name == "ProcessAreaComponent":
                components.append(ProcessAreaComponent.objects.get(id=comp.id))
            elif comp.component_name == "TotemMinerComponent":
                components.append(TotemMinerComponent.objects.get(id=comp.id))
            elif comp.component_name == "LogStatisticsComponent":
                components.append(LogStatisticsComponent.objects.get(id=comp.id))
            elif comp.component_name == "OCDFGComponent":
                components.append(OCDFGComponent.objects.get(id=comp.id))
            elif comp.component_name == "OCDottedChartComponent":
                components.append(OCDottedChartComponent.objects.get(id=comp.id))
            elif comp.component_name in (
                "NewOCDFGComponent",
                "NewOCDFGVariantsComponent",
            ):
                components.append(NewOCDFGComponent.objects.get(id=comp.id))
            elif comp.component_name == "OCPNComponent":
                components.append(OCPNComponent.objects.get(id=comp.id))
            elif comp.component_name == "SQLQueryComponent":
                components.append(SQLQueryComponent.objects.get(id=comp.id))
            elif comp.component_name == "PieChartComponent":
                components.append(PieChartComponent.objects.get(id=comp.id))
            elif comp.component_name == "OCCNComponent":
                components.append(OCCNComponent.objects.get(id=comp.id))
            else:
                components.append(comp)
        print(f"Dashboard {pk} has {len(components)} components")
        for comp in components:
            print(
                f"Component {comp.id}: type {type(comp).__name__}, component_name {comp.component_name}, text {getattr(comp, 'text', 'N/A')}"
            )
        serializer = DashboardComponentPolymorphicSerializer(components, many=True)
        data = serializer.data
        print("Serialized data:", data)
        return Response(data)

    @action(detail=True, methods=["POST"])
    def save_layout(self, request, pk=None):
        dashboard = self.get_object()
        layout = request.data.get("layout")

        if not isinstance(layout, list):
            return Response(
                {"error": "layout must be a list"}, status=status.HTTP_400_BAD_REQUEST
            )

            # Clear existing components
        dashboard.components.all().delete()

        for item in layout:
            component_name = item["component_name"]
            print(f"Saving item: {item}")
            if component_name == "TextBoxComponent":
                comp = TextBoxComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                    text=item.get("text", ""),
                    font_size=item.get("font_size", 14),
                )
                print(f"Created TextBoxComponent {comp.id} with text '{comp.text}'")

            elif component_name == "NumberOfEventsComponent":
                NumberofEventsComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                    color=item.get("color", "blue"),
                )
            elif component_name == "ImageComponent":
                # Extract image path, stripping /files/ prefix if present
                image_path = item.get("image", None)
                if (
                    image_path
                    and isinstance(image_path, str)
                    and image_path.startswith("/files/")
                ):
                    image_path = image_path[7:]  # Remove '/files/' prefix

                ImageComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                    image=image_path,
                )
            elif component_name == "VariantsComponent":
                VariantsComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                    automatic_loading=item.get("automatic_loading", False),
                    leading_object_type=item.get("leading_object_type", ""),
                    extraction=item.get("extraction") or "leading_1hop",
                    iso=item.get("iso") or "wl+vf2",
                    timeout_s=item.get("timeout_s", 10.0),
                )
            elif component_name == "ProcessAreaComponent":
                ProcessAreaComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                    algorithm=item.get("algorithm") or "advanced",
                    w_temporal=item.get("w_temporal", 1.0),
                    w_cardinality=item.get("w_cardinality", 1.0),
                    w_divergence=item.get("w_divergence", 1.0),
                    alpha=item.get("alpha", 1.0),
                    beta=item.get("beta", 1.0),
                )
            elif component_name == "TotemMinerComponent":
                TotemMinerComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                )
            elif component_name == "LogStatisticsComponent":
                LogStatisticsComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                    show_num_events=item.get("show_num_events", True),
                    show_num_activities=item.get("show_num_activities", True),
                    show_num_objects=item.get("show_num_objects", True),
                    show_num_object_types=item.get("show_num_object_types", True),
                    show_earliest_timestamp=item.get("show_earliest_timestamp", False),
                    show_newest_timestamp=item.get("show_newest_timestamp", False),
                    show_duration=item.get("show_duration", False),
                )
            elif component_name == "OCDFGComponent":
                OCDFGComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                    show_controls=item.get("show_controls", True),
                    initial_interaction_locked=item.get(
                        "initial_interaction_locked", True
                    ),
                )
            elif component_name == "OCDottedChartComponent":
                OCDottedChartComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                    file_id=item.get("file_id"),
                    x_axis=item.get("x_axis") or "time",
                    y_axis=item.get("y_axis") or "activity",
                    color_by=item.get("color_by") or "activity",
                    shape_by=item.get("shape_by") or "none",
                    row_order=item.get("row_order") or "first_occurrence",
                    max_points=item.get("max_points", 10000),
                    show_minimap=item.get("show_minimap", True),
                    show_controls=item.get("show_controls", True),
                )
            elif component_name in ("NewOCDFGComponent", "NewOCDFGVariantsComponent"):
                NewOCDFGComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                    show_controls=item.get("show_controls", True),
                    initial_interaction_locked=item.get(
                        "initial_interaction_locked", True
                    ),
                    layout_direction=item.get("layout_direction", "TB"),
                )
            elif component_name == "OCCNComponent":
                OCCNComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                    relative_occurrence_threshold=item.get(
                        "relative_occurrence_threshold", 0.0
                    ),
                    show_controls=item.get("show_controls", True),
                    initial_interaction_locked=item.get(
                        "initial_interaction_locked", True
                    ),
                    layout_direction=item.get("layout_direction", "LR"),
                    object_types=item.get("object_types") or "",
                )
            elif component_name == 'OCPNComponent':
                OCPNComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    automatic_loading=item.get('automatic_loading', False),
                    timeout_s=item.get('timeout_s', 30.0),
                )
            elif component_name == 'SQLQueryComponent':
                SQLQueryComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    query=item.get('query', 'SELECT * FROM data LIMIT 10'),
                )
            # Add more as needed
            elif component_name == 'PieChartComponent':
                PieChartComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    query=item.get('query', ''),
                    ring_text=item.get('ring_text', ''),
                    chart_type=item.get('chart_type', 'donut'),
                    title=item.get('title', ''),
                    show_legend=item.get('show_legend', True),
                    show_tooltip=item.get('show_tooltip', True),
                    label_column=item.get('label_column', ''),
                    value_column=item.get('value_column', ''),
                )

        return Response({"status": "saved"})

    @action(
        detail=True,
        methods=["post"],
        url_path="components/(?P<component_id>[^/.]+)/image",
        parser_classes=[MultiPartParser, FormParser],
    )
    def upload_image(self, request, pk=None, component_id=None):
        dashboard = self.get_object()

        image_file = request.FILES.get("image")
        if not image_file:
            return Response(
                {"error": "No image file provided"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            image_component = ImageComponent.objects.get(
                dashboardcomponent_ptr_id=component_id,
                dashboard=dashboard,
            )
        except ImageComponent.DoesNotExist:
            return Response(
                {"error": "ImageComponent not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        image_component.image = image_file
        image_component.save()

        return Response(
            {
                "id": image_component.id,
                "component_name": image_component.component_name,
                "image": image_component.image.url,
            },
            status=status.HTTP_200_OK,
        )


# ---------------------------------------------------------------------------
# OCEL loading — DuckDB-first
# ---------------------------------------------------------------------------
#
# Every endpoint below operates on an in-memory `OcelDuckDB`. For non-`.duckdb`
# uploads we go through `import_ocel_db` which materialises a fresh DuckDB
# from the source (one-time cost per cache lifetime). For `.duckdb` uploads
# we use the native `OcelDuckDB.load` which is essentially a file-handle open.
#
# Long-term we may also persist the converted DuckDB to disk on upload so
# cache misses skip the re-import — that's a follow-up, not done here.


def _build_ocel_db_from_path(path: str, strict_mode: bool = False) -> OcelDuckDB:
    """Open an uploaded OCEL file as an `OcelDuckDB`, dispatching on extension."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".duckdb":
        db = OcelDuckDB.load(path)
        if strict_mode:
            errors = validate_ocel(db.conn)
            if errors:
                db.close()
                raise OCELValidationException(errors)
        return db
    if ext in (".sqlite", ".db", ".json", ".xml", ".csv"):
        # `import_ocel_db` infers the format from the extension.
        return import_ocel_db(path, strict_mode=strict_mode)
    raise ValueError(
        f"Unsupported file type: {ext}. "
        "Supported formats: .sqlite, .db, .json, .xml, .csv, .duckdb"
    )


# Module-level process-local registry for OcelDuckDB instances.
#
# We can't use Django's cache here even though LocMemCache is "in-process":
# LocMemCache pickles every value on set() to preserve copy-on-read
# semantics, and `duckdb.DuckDBPyConnection` is a native C handle that
# cannot be pickled. Serializable derived results go through the "results"
# cache instead — see `cache_utils` (get_cached_result/set_cached_result).
#
# Concurrency model — a DuckDB connection is documented as "thread-safe but
# only one thread can execute a query at a time". Worse, our algorithms
# create connection-scoped TEMP TABLEs (e.g. `case_events` in
# `find_variants`), so two concurrent algorithm runs on the same connection
# would corrupt each other's temp state and can SIGSEGV the worker. The
# React dashboard fires four endpoints in parallel on first load, so this
# is not hypothetical.
#
# Solution: a per-file `threading.Lock`, acquired by every view for the
# duration of its algorithm work via `_with_ocel_db(user_file)`. Requests
# for different files still run in parallel.
#
# Both dicts live for the lifetime of the gunicorn/runserver worker. There
# is no TTL — the connection stays open until the process exits.
import threading
from contextlib import contextmanager

_OCEL_DB_REGISTRY: dict[int, OcelDuckDB] = {}
_OCEL_DB_LOCKS: dict[int, threading.Lock] = {}
_OCEL_OBJECT_TYPES_REGISTRY: dict[int, tuple[str, ...]] = {}
_OCEL_DB_REGISTRY_LOCK = threading.Lock()  # guards the dicts themselves


def _get_or_load_ocel_db(user_file) -> OcelDuckDB:
    """
    Return the process-local `OcelDuckDB` for this file, loading it on first
    call. **Does NOT acquire the per-file lock** — callers that intend to
    run a query against the connection must use `_with_ocel_db(...)` so
    concurrent requests are serialised. Read-only helpers that only need
    cheap, non-temp-table scalar queries can still call this directly.
    """
    pk = int(user_file.pk)
    db = _OCEL_DB_REGISTRY.get(pk)
    if db is not None:
        return db
    # Double-checked locking so concurrent first-loads only import once.
    with _OCEL_DB_REGISTRY_LOCK:
        db = _OCEL_DB_REGISTRY.get(pk)
        if db is None:
            db = _build_ocel_db_from_path(user_file.file.path)
            object_types = tuple(_object_types(db))
            _OCEL_DB_REGISTRY[pk] = db
            _OCEL_DB_LOCKS[pk] = threading.Lock()
            _OCEL_OBJECT_TYPES_REGISTRY[pk] = object_types
    return db


def _get_ocel_object_types(user_file) -> list[str]:
    """Return immutable log metadata without waiting for algorithm work."""
    pk = int(user_file.pk)
    object_types = _OCEL_OBJECT_TYPES_REGISTRY.get(pk)
    if object_types is None:
        _get_or_load_ocel_db(user_file)
        object_types = _OCEL_OBJECT_TYPES_REGISTRY[pk]
    return list(object_types)


@contextmanager
def _with_ocel_db(user_file):
    """
    Context manager that yields a loaded `OcelDuckDB` with the per-file lock
    held. Every view that runs an algorithm on the connection must use this
    so DuckDB never executes two queries on the same connection in parallel.

    Usage::

        with _with_ocel_db(user_file) as db:
            totem = totemDiscovery_db(db)
    """
    db = _get_or_load_ocel_db(user_file)
    lock = _OCEL_DB_LOCKS[int(user_file.pk)]
    with lock:
        yield db


def _object_types(db: OcelDuckDB) -> list[str]:
    """Distinct object types in the log (sorted, frontend-friendly)."""
    return sorted(
        r[0]
        for r in db.conn.execute("SELECT DISTINCT obj_type FROM objects").fetchall()
    )


def _optional_int(value):
    if value in (None, ""):
        return None
    return int(value)


def _layout_shim(db: OcelDuckDB):
    """
    `calculate_layout` (in `ocvariants.py`) reads `ocel.obj_type_map` to label
    swim-lanes. The polars OCEL exposes that as a `cached_property` on the
    log object; the DuckDB OCEL doesn't. We materialise the same dict here
    and wrap it in a `SimpleNamespace` so the existing layout function
    works unchanged.
    """
    obj_type_map = dict(
        db.conn.execute("SELECT obj_id, obj_type FROM objects").fetchall()
    )
    return SimpleNamespace(obj_type_map=obj_type_map)


# NOTE: _extract_trace_variants_per_type and _apply_trace_limits have been
# removed from this file. That logic now lives in totem-lib:
#   NewOCDFGDb.compute_variants()               (variant extraction)
#   NewOCDFGDb.from_ocel_db_with_variant_ranks() (full annotated graph)


# Defaults reproduce the thesis: uniform indicator weights, both objective
# terms weighted equally, and the thesis margin of exactly 1 (`margin_scale`
# is a reference-implementation extension and is not exposed over HTTP).
PROCESS_AREA_DEFAULTS = {"alpha": 1.0, "beta": 1.0, "weight": 1.0}


def _positive_float(params, name: str, default: float) -> float:
    """
    Read one non-negative, finite float query parameter.

    Raises `ValueError` so the caller can answer 400 — letting a bad value
    through surfaces later as a ZeroDivisionError or a NaN in the ILP, i.e. a
    500 for what is really a malformed request.
    """
    raw = params.get(name)
    if raw is None or raw == "":
        return default
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a number, got {raw!r}")
    if not math.isfinite(value):
        raise ValueError(f"{name} must be finite, got {raw!r}")
    if value < 0:
        raise ValueError(f"{name} must be >= 0, got {value}")
    return value


def _parse_process_area_params(params) -> dict:
    """Validate the query parameters of the process-area discovery endpoint."""
    weights = {
        name: _positive_float(params, f"w_{name}", PROCESS_AREA_DEFAULTS["weight"])
        for name in INDICATOR_NAMES
    }
    if sum(weights.values()) <= 0:
        raise ValueError(
            "at least one of "
            + ", ".join(f"w_{name}" for name in INDICATOR_NAMES)
            + " must be greater than zero"
        )
    alpha = _positive_float(params, "alpha", PROCESS_AREA_DEFAULTS["alpha"])
    beta = _positive_float(params, "beta", PROCESS_AREA_DEFAULTS["beta"])
    if alpha == 0 and beta == 0:
        # Both zero makes the ILP objective identically zero, so every layer
        # assignment is equally optimal and the answer is whatever the solver
        # happened to pick.
        raise ValueError("at least one of alpha and beta must be greater than zero")
    return {"weights": weights, "alpha": alpha, "beta": beta}


def _process_area_cache_params(params: dict) -> dict:
    """
    Flatten the discovery parameters into the ``params`` dict that
    `cache_utils.make_cache_key` hashes.

    Every parameter has to be in here: `discover_mlpa` keys on the file alone,
    which is fine because it takes no parameters, but doing that here would
    make the UI sliders silently return the first result forever. Floats are
    rendered with `%.6g` rather than passed raw so that 1.0 and 1.0000001 —
    indistinguishable to the algorithm — do not produce two cache entries.
    """
    flat = {name: f"{params['weights'][name]:.6g}" for name in INDICATOR_NAMES}
    flat["alpha"] = f"{params['alpha']:.6g}"
    flat["beta"] = f"{params['beta']:.6g}"
    return flat


def _serialize_process_layers(process_view: dict) -> list:
    """
    Convert a process view — the shape both `mlpaDiscovery` and
    `discover_process_areas` return — into the frontend's layer list.

    {level: [(object_types, event_types), ...]}
      -> [{"level": int, "areas": [{"objectTypes": [...], "eventTypes": [...]}]}]
    """
    layers = []

    # Sort levels (MLPA produces floats like 0.0, 1.0, 2.0; the process-area
    # discovery produces ints)
    for level in sorted(process_view.keys()):
        areas = []
        for object_types_set, event_types_set in process_view[level]:
            # Convert sets to sorted lists for JSON serialization
            object_types = (
                sorted(list(object_types_set))
                if isinstance(object_types_set, set)
                else list(object_types_set)
            )
            event_types = (
                sorted(list(event_types_set))
                if isinstance(event_types_set, set)
                else list(event_types_set)
            )

            areas.append(
                {
                    "objectTypes": object_types,
                    "eventTypes": event_types,
                }
            )

        layers.append(
            {
                "level": int(level),  # Convert float to int for cleaner JSON
                "areas": areas,
            }
        )

    return layers


def _serialize_mlpa(process_view: dict, totem: Totem) -> dict:
    """
    Convert MLPA output into a JSON-serializable structure for the frontend.

    MLPA returns: {level: [(object_types_set, event_types_set), ...], ...}
    We convert to: {layers: [{level, areas: [{objectTypes, eventTypes}]}], ...}
    """
    # Also include the serialized totem data for edge information
    totem_data = totem_to_dict(totem)

    return {
        "layers": _serialize_process_layers(process_view),
        "tempgraph": totem_data["tempgraph"],
        "type_relations": totem_data["type_relations"],
        "all_event_types": totem_data["all_event_types"],
        "object_type_to_event_types": totem_data["object_type_to_event_types"],
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def discover_totem_mock(request, pk: int):
    """
    Temporary mock endpoint for Totem discovery until backend integration is ready.
    """
    variant = request.query_params.get("variant")
    payload = TOTEM_MOCK_2  # if variant == "2" else TOTEM_MOCK
    return Response(payload, status=status.HTTP_200_OK)


# Accepted enums for the advanced-settings query params on the variants
# endpoint. Keep in sync with totem_lib.variants.ocvariants_db.{Extraction,IsoStrategy}.
_VALID_EXTRACTIONS = {"leading_1hop", "leading_bfs", "connected"}
_VALID_ISOS = {"db_signature", "trace", "signature", "wl", "wl+vf2", "exact"}


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def variants(request):

    file_id = request.query_params.get("file_id")
    if not file_id:
        return Response(
            {"error": "Missing ?file_id"}, status=status.HTTP_400_BAD_REQUEST
        )

    # Verify user has access to this file
    try:
        user_file = EventLog.objects.get(pk=file_id, project__users=request.user)
    except EventLog.DoesNotExist:
        return Response(
            {"error": "File not found or access denied"},
            status=status.HTTP_404_NOT_FOUND,
        )

    if not os.path.exists(user_file.file.path):
        return Response(
            {"error": f"Path does not exist: {user_file.file.path}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # --- Advanced settings (query params, all optional with sane defaults) ---
    extraction = request.query_params.get("extraction") or "leading_1hop"
    iso = request.query_params.get("iso") or "wl+vf2"
    if extraction not in _VALID_EXTRACTIONS:
        return Response(
            {
                "error": f"Invalid extraction '{extraction}'. "
                f"Allowed: {sorted(_VALID_EXTRACTIONS)}"
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    if iso not in _VALID_ISOS:
        return Response(
            {"error": f"Invalid iso '{iso}'. Allowed: {sorted(_VALID_ISOS)}"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        timeout_s = float(request.query_params.get("timeout_s", "10.0"))
        if timeout_s <= 0:
            timeout_s = None  # disable
    except (TypeError, ValueError):
        timeout_s = 10.0

    # --- Cache lookup (#72 / #74) ---
    leading_object_type = request.query_params.get("leading_type")
    cache_params = {
        "leading_type": leading_object_type or "",
        "extraction": extraction,
        "iso": iso,
        "timeout_s": timeout_s,
    }
    if _should_use_cache(request):
        cached = get_cached_result(user_file, "variants", cache_params)
        if cached is not None:
            return Response(cached, status=status.HTTP_200_OK)

    try:
        with _with_ocel_db(user_file) as db:
            obj_types = _object_types(db)

            # Leading type is only needed for the leading_* extractions.
            # For "connected" we skip the default-to-first-alphabetical
            # fallback entirely — the param is ignored downstream anyway.
            if extraction.startswith("leading"):
                if not leading_object_type or leading_object_type not in obj_types:
                    if not obj_types:
                        return Response(
                            {
                                "variants": [],
                                "object_types": [],
                            },
                            status=status.HTTP_200_OK,
                        )
                    leading_object_type = obj_types[0]
            else:
                leading_object_type = None

            # The default iso strategy ("wl+vf2") is sound and exact.
            # `find_variants` creates connection-scoped TEMP TABLEs — the
            # per-file lock from `_with_ocel_db` makes that safe under
            # concurrent requests. `timeout_s` arms a watchdog that
            # interrupts long SQL and raises TimeoutError.
            mined = find_variants(
                db,
                extraction=extraction,
                leading_type=leading_object_type,
                iso=iso,
                timeout_s=timeout_s,
                verbose=False,
            )
            # `calculate_layout` only reads `ocel.obj_type_map` — give it a
            # tiny shim backed by a SELECT against the DuckDB.
            layout_ocel = _layout_shim(db)
    except TimeoutError as e:
        return Response(
            {
                "error": str(e),
                "code": "timeout",
                "timeout_s": timeout_s,
                "hint": "Try a coarser iso strategy (db_signature / trace) "
                "or a different extraction.",
            },
            status=status.HTTP_408_REQUEST_TIMEOUT,
        )
    except Exception as e:
        import traceback

        print(f"ERROR in find_variants: {e}")
        traceback.print_exc()
        return Response(
            {"error": f"Variant computation failed: {e}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    out = []
    for var in mined:
        layout_data = calculate_layout(var, layout_ocel)

        signature = " → ".join(
            node_data["label"]
            for _, node_data in sorted(
                var.graph.nodes(data=True), key=lambda x: x[1]["timestamp"]
            )
        )
        signature_hash = sha1(signature.encode("utf-8")).hexdigest()[:8]

        final_nodes = []
        for node in layout_data["nodes"]:
            final_nodes.append(
                {
                    "id": node["id"],
                    "activity": node["activity"],
                    "x": node["x"],
                    "y_lane": node["y_lane"],
                    "y_lanes": node["y_lanes"],
                    "objectIds": [f"type::{t}" for t in node["types"]],
                    "types": node["types"],
                }
            )

        out.append(
            {
                "id": str(var.id),
                "support": int(var.support),
                "signature": signature_hash,
                "signature_hash": signature_hash,
                "graph": {
                    "nodes": final_nodes,
                    "edges": layout_data["edges"],
                    "objects": layout_data["objects"],
                },
            }
        )

    result = {
        "variants": out,
        "object_types": obj_types,
    }
    # Update cache_params with the resolved leading_type
    cache_params["leading_type"] = leading_object_type or ""
    set_cached_result(user_file, "variants", result, cache_params)
    return Response(result, status=status.HTTP_200_OK)


# --- Playout of editor models (OCPN / OCCN) --------------------------------
#
# Server-side clamps mirror the UI's input ranges; the computation itself is
# bounded by the (clamped) timeout, so results are not cached.


def _clamped_number(value, field: str, lo, hi, integer: bool = False):
    """Coerce a JSON number, clamped to [lo, hi]. Raises ValueError."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f'"{field}" must be a number.')
    if value != value:  # NaN
        raise ValueError(f'"{field}" must be a finite number.')
    # Clamp before int(): overflowing JSON numbers parse to inf, and
    # int(inf) would raise OverflowError (an unhandled 500) instead.
    number = max(lo, min(hi, value))
    return int(number) if integer else float(number)


def _clamped_count_map(value, field: str, hi: int) -> dict:
    """Coerce a {name: int} JSON object with values clamped to [0, hi]."""
    if not isinstance(value, dict):
        raise ValueError(f'"{field}" must be an object mapping names to numbers.')
    counts = {}
    for key, raw in value.items():
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            raise ValueError(f'"{field}" value for "{key}" must be a number.')
        if raw != raw:  # NaN
            raise ValueError(f'"{field}" value for "{key}" must be a finite number.')
        counts[key] = int(max(0, min(hi, raw)))
    return counts


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def playout(request):
    """
    Runs a wide playout of an editor model (OCPN or OCCN) and returns the
    object-centric variants. The model comes in the request body — no stored
    file involved. A search that merely hits the timeout / state cap is a
    normal 200 (flags in the payload); only invalid input is a 400.
    """
    data = request.data
    if not isinstance(data, dict):
        return Response(
            {"error": "Request body must be a JSON object."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        model_format = data.get("modelFormat")
        if not isinstance(model_format, str):
            raise ValueError('"modelFormat" must be "ocpn" or "occn".')
        model = data.get("model")
        if not isinstance(model, dict):
            raise ValueError('"model" must be the editor model JSON object.')
        objects_per_type = _clamped_count_map(
            data.get("objectsPerType"), "objectsPerType", 12
        )
        activity_limits = _clamped_count_map(
            data.get("activityLimits"), "activityLimits", 20
        )
        timeout_s = _clamped_number(data.get("timeoutS"), "timeoutS", 1.0, 120.0)
        max_stored_variants = _clamped_number(
            data.get("maxStoredVariants", 2000),
            "maxStoredVariants",
            1,
            2000,
            integer=True,
        )
        max_states = _clamped_number(
            data.get("maxStates", 5_000_000), "maxStates", 1, 5_000_000, integer=True
        )

        result = playout_from_model_dict(
            model_format,
            model,
            objects_per_type,
            activity_limits,
            timeout_s=timeout_s,
            max_stored_variants=max_stored_variants,
            max_states=max_states,
        )
    except (ValueError, TooManyBindingsError) as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    except (TypeError, KeyError, AttributeError) as e:
        # Model dicts are only minimally validated (the editors already did) —
        # a malformed model surfaces here instead of as a 500.
        return Response(
            {"error": f"Malformed model: {e!r}"}, status=status.HTTP_400_BAD_REQUEST
        )

    return Response(result, status=status.HTTP_200_OK)


# The playout endpoint caps objects at 12 per type; these export bounds are
# far above anything a real playout result can contain, but keep a crafted
# ~60-byte body from making the export materialize billions of objects.
_EXPORT_MAX_COUNT_PER_TYPE = 10_000
_EXPORT_MAX_TOTAL_OBJECTS = 500_000


def _parse_playout_variants(raw) -> list:
    """Parses the JSON `variants` payload into PlayoutVariant objects."""
    if not isinstance(raw, list):
        raise ValueError('"variants" must be a list of playout variants.')
    variants = []
    total_objects = 0
    for v, entry in enumerate(raw):
        if not isinstance(entry, dict):
            raise ValueError(f"Variant #{v + 1} must be an object.")
        events_raw = entry.get("events")
        if not isinstance(events_raw, list):
            raise ValueError(f'Variant #{v + 1} is missing the "events" list.')
        events = []
        for i, event_raw in enumerate(events_raw):
            where = f"Variant #{v + 1}, event #{i + 1}"
            if not isinstance(event_raw, dict):
                raise ValueError(f"{where} must be an object.")
            activity = event_raw.get("activity")
            if not isinstance(activity, str) or not activity:
                raise ValueError(f'{where} needs a non-empty string "activity".')
            objects_raw = event_raw.get("objects")
            if not isinstance(objects_raw, dict):
                raise ValueError(
                    f'{where}: "objects" must map object types to id lists.'
                )
            objects = {}
            for ot, ids in objects_raw.items():
                if not isinstance(ids, list) or not all(
                    isinstance(o, str) for o in ids
                ):
                    raise ValueError(
                        f'{where}: "objects" of type "{ot}" must be a list of ids.'
                    )
                objects[ot] = list(ids)
            events.append(
                PlayoutEvent(
                    activity=activity,
                    # Optional on input; the OCEL export writes every event anyway.
                    visible=bool(event_raw.get("visible", True)),
                    objects=objects,
                )
            )
        counts_raw = entry.get("objectCounts", {})
        if not isinstance(counts_raw, dict):
            raise ValueError(f'Variant #{v + 1}: "objectCounts" must be an object.')
        object_counts = {}
        for ot, count_raw in counts_raw.items():
            if (
                isinstance(count_raw, bool)
                or not isinstance(count_raw, (int, float))
                or count_raw != count_raw  # NaN
                or count_raw < 0
                or count_raw > _EXPORT_MAX_COUNT_PER_TYPE
            ):
                raise ValueError(
                    f'Variant #{v + 1}: objectCounts for "{ot}" must be a number '
                    f"between 0 and {_EXPORT_MAX_COUNT_PER_TYPE}."
                )
            object_counts[ot] = int(count_raw)
        total_objects += sum(object_counts.values())
        if total_objects > _EXPORT_MAX_TOTAL_OBJECTS:
            raise ValueError(
                f"The export would create more than {_EXPORT_MAX_TOTAL_OBJECTS} objects "
                "— reduce the number of variants or objects."
            )
        variants.append(PlayoutVariant(events=events, object_counts=object_counts))
    return variants


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def playout_export_ocel(request):
    """Serializes playout variants (result of /api/playout/) to OCEL 2.0 JSON."""
    data = request.data
    if not isinstance(data, dict):
        return Response(
            {"error": "Request body must be a JSON object."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        variants = _parse_playout_variants(data.get("variants"))
        ocel = variants_to_ocel_dict(variants)
    except ValueError as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    except KeyError as e:
        # variants_to_ocel_dict resolves event objects against objectCounts —
        # an id outside "<type>_1".."<type>_<count>" has no export mapping.
        detail = str(e).replace("\x01", ":")
        return Response(
            {
                "error": f"Variant events reference an object not covered by objectCounts: {detail}"
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    return Response(ocel, status=status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def OCDFGViewSet(request):
    """

    Args:
        request (_type_): _description_
    """

    simple_mockup = {
        "directed": True,
        "multigraph": False,
        "graph": {"kind": "ocdfg"},
        "nodes": [
            {
                "label": "Review Document",
                "types": ["Document"],
                "role": None,
                "object_type": None,
                "id": "Review Document",
            },
            {
                "label": "Document start",
                "types": ["Document"],
                "role": "start",
                "object_type": "Document",
                "id": "__start__:Document",
            },
            {
                "label": "Document end",
                "types": ["Document"],
                "role": "end",
                "object_type": "Document",
                "id": "__end__:Document",
            },
        ],
        "links": [
            {
                "weights": {"Document": 100},
                "weight": 100,
                "owners": ["Document"],
                "role": "start",
                "source": "__start__:Document",
                "target": "Review Document",
            },
            {
                "weights": {"Document": 20},
                "weight": 20,
                "owners": ["Document"],
                "source": "Review Document",
                "target": "Review Document",
            },
            {
                "weights": {"Document": 80},
                "weight": 80,
                "owners": ["Document"],
                "role": "end",
                "source": "Review Document",
                "target": "__end__:Document",
            },
        ],
    }

    mockup = {
        "directed": True,
        "multigraph": False,
        "graph": {"kind": "ocdfg"},
        "nodes": [
            {
                "label": "Load Truck",
                "types": ["Container", "Handling Unit", "Truck"],
                "role": None,
                "object_type": None,
                "id": "Load Truck",
            },
            {
                "label": "Load to Vehicle",
                "types": ["Container", "Forklift", "Vehicle"],
                "role": None,
                "object_type": None,
                "id": "Load to Vehicle",
            },
            {
                "label": "Place in Stock",
                "types": ["Container", "Forklift"],
                "role": None,
                "object_type": None,
                "id": "Place in Stock",
            },
            {
                "label": "Depart",
                "types": ["Container", "Transport Document", "Vehicle"],
                "role": None,
                "object_type": None,
                "id": "Depart",
            },
            {
                "label": "Bring to Loading Bay",
                "types": ["Container", "Forklift"],
                "role": None,
                "object_type": None,
                "id": "Bring to Loading Bay",
            },
            {
                "label": "Reschedule Container",
                "types": ["Container", "Transport Document", "Vehicle"],
                "role": None,
                "object_type": None,
                "id": "Reschedule Container",
            },
            {
                "label": "Pick Up Empty Container",
                "types": ["Container"],
                "role": None,
                "object_type": None,
                "id": "Pick Up Empty Container",
            },
            {
                "label": "Drive to Terminal",
                "types": ["Container", "Truck"],
                "role": None,
                "object_type": None,
                "id": "Drive to Terminal",
            },
            {
                "label": "Order Empty Containers",
                "types": ["Container", "Transport Document"],
                "role": None,
                "object_type": None,
                "id": "Order Empty Containers",
            },
            {
                "label": "Weigh",
                "types": ["Container", "Forklift"],
                "role": None,
                "object_type": None,
                "id": "Weigh",
            },
            {
                "label": "Container start",
                "types": ["Container"],
                "role": "start",
                "object_type": "Container",
                "id": "__start__:Container",
            },
            {
                "label": "Container end",
                "types": ["Container"],
                "role": "end",
                "object_type": "Container",
                "id": "__end__:Container",
            },
            {
                "label": "Register Customer Order",
                "types": ["Customer Order"],
                "role": None,
                "object_type": None,
                "id": "Register Customer Order",
            },
            {
                "label": "Create Transport Document",
                "types": ["Customer Order", "Transport Document"],
                "role": None,
                "object_type": None,
                "id": "Create Transport Document",
            },
            {
                "label": "Customer Order start",
                "types": ["Customer Order"],
                "role": "start",
                "object_type": "Customer Order",
                "id": "__start__:Customer Order",
            },
            {
                "label": "Customer Order end",
                "types": ["Customer Order"],
                "role": "end",
                "object_type": "Customer Order",
                "id": "__end__:Customer Order",
            },
            {
                "label": "Forklift start",
                "types": ["Forklift"],
                "role": "start",
                "object_type": "Forklift",
                "id": "__start__:Forklift",
            },
            {
                "label": "Forklift end",
                "types": ["Forklift"],
                "role": "end",
                "object_type": "Forklift",
                "id": "__end__:Forklift",
            },
            {
                "label": "Collect Goods",
                "types": ["Handling Unit"],
                "role": None,
                "object_type": None,
                "id": "Collect Goods",
            },
            {
                "label": "Handling Unit start",
                "types": ["Handling Unit"],
                "role": "start",
                "object_type": "Handling Unit",
                "id": "__start__:Handling Unit",
            },
            {
                "label": "Handling Unit end",
                "types": ["Handling Unit"],
                "role": "end",
                "object_type": "Handling Unit",
                "id": "__end__:Handling Unit",
            },
            {
                "label": "Book Vehicles",
                "types": ["Transport Document", "Vehicle"],
                "role": None,
                "object_type": None,
                "id": "Book Vehicles",
            },
            {
                "label": "Transport Document start",
                "types": ["Transport Document"],
                "role": "start",
                "object_type": "Transport Document",
                "id": "__start__:Transport Document",
            },
            {
                "label": "Transport Document end",
                "types": ["Transport Document"],
                "role": "end",
                "object_type": "Transport Document",
                "id": "__end__:Transport Document",
            },
            {
                "label": "Truck start",
                "types": ["Truck"],
                "role": "start",
                "object_type": "Truck",
                "id": "__start__:Truck",
            },
            {
                "label": "Truck end",
                "types": ["Truck"],
                "role": "end",
                "object_type": "Truck",
                "id": "__end__:Truck",
            },
            {
                "label": "Vehicle start",
                "types": ["Vehicle"],
                "role": "start",
                "object_type": "Vehicle",
                "id": "__start__:Vehicle",
            },
            {
                "label": "Vehicle end",
                "types": ["Vehicle"],
                "role": "end",
                "object_type": "Vehicle",
                "id": "__end__:Vehicle",
            },
        ],
        "links": [
            {
                "weights": {"Container": 1989, "Truck": 1989},
                "weight": 3978,
                "owners": ["Container", "Truck"],
                "source": "Load Truck",
                "target": "Drive to Terminal",
            },
            {
                "weights": {"Container": 8559, "Truck": 8559},
                "weight": 17118,
                "owners": ["Container", "Truck"],
                "source": "Load Truck",
                "target": "Load Truck",
            },
            {
                "weights": {"Container": 5},
                "weight": 5,
                "owners": ["Container"],
                "role": "end",
                "source": "Load Truck",
                "target": "__end__:Container",
            },
            {
                "weights": {"Handling Unit": 10553},
                "weight": 10553,
                "owners": ["Handling Unit"],
                "role": "end",
                "source": "Load Truck",
                "target": "__end__:Handling Unit",
            },
            {
                "weights": {"Truck": 5},
                "weight": 5,
                "owners": ["Truck"],
                "role": "end",
                "source": "Load Truck",
                "target": "__end__:Truck",
            },
            {
                "weights": {"Container": 1956, "Vehicle": 127},
                "weight": 2083,
                "owners": ["Container", "Vehicle"],
                "source": "Load to Vehicle",
                "target": "Depart",
            },
            {
                "weights": {"Container": 10},
                "weight": 10,
                "owners": ["Container"],
                "role": "end",
                "source": "Load to Vehicle",
                "target": "__end__:Container",
            },
            {
                "weights": {"Forklift": 604},
                "weight": 604,
                "owners": ["Forklift"],
                "source": "Load to Vehicle",
                "target": "Weigh",
            },
            {
                "weights": {"Forklift": 9, "Vehicle": 1827},
                "weight": 1836,
                "owners": ["Forklift", "Vehicle"],
                "source": "Load to Vehicle",
                "target": "Load to Vehicle",
            },
            {
                "weights": {"Forklift": 1352},
                "weight": 1352,
                "owners": ["Forklift"],
                "source": "Load to Vehicle",
                "target": "Bring to Loading Bay",
            },
            {
                "weights": {"Forklift": 1},
                "weight": 1,
                "owners": ["Forklift"],
                "role": "end",
                "source": "Load to Vehicle",
                "target": "__end__:Forklift",
            },
            {
                "weights": {"Vehicle": 2},
                "weight": 2,
                "owners": ["Vehicle"],
                "source": "Load to Vehicle",
                "target": "Book Vehicles",
            },
            {
                "weights": {"Container": 1794, "Forklift": 438},
                "weight": 2232,
                "owners": ["Container", "Forklift"],
                "source": "Place in Stock",
                "target": "Bring to Loading Bay",
            },
            {
                "weights": {"Container": 20},
                "weight": 20,
                "owners": ["Container"],
                "role": "end",
                "source": "Place in Stock",
                "target": "__end__:Container",
            },
            {
                "weights": {"Forklift": 1352},
                "weight": 1352,
                "owners": ["Forklift"],
                "source": "Place in Stock",
                "target": "Weigh",
            },
            {
                "weights": {"Forklift": 24},
                "weight": 24,
                "owners": ["Forklift"],
                "source": "Place in Stock",
                "target": "Load to Vehicle",
            },
            {
                "weights": {"Container": 1956},
                "weight": 1956,
                "owners": ["Container"],
                "role": "end",
                "source": "Depart",
                "target": "__end__:Container",
            },
            {
                "weights": {"Transport Document": 21},
                "weight": 21,
                "owners": ["Transport Document"],
                "source": "Depart",
                "target": "Reschedule Container",
            },
            {
                "weights": {"Transport Document": 160},
                "weight": 160,
                "owners": ["Transport Document"],
                "source": "Depart",
                "target": "Depart",
            },
            {
                "weights": {"Transport Document": 573},
                "weight": 573,
                "owners": ["Transport Document"],
                "role": "end",
                "source": "Depart",
                "target": "__end__:Transport Document",
            },
            {
                "weights": {"Vehicle": 127},
                "weight": 127,
                "owners": ["Vehicle"],
                "role": "end",
                "source": "Depart",
                "target": "__end__:Vehicle",
            },
            {
                "weights": {"Container": 36},
                "weight": 36,
                "owners": ["Container"],
                "source": "Bring to Loading Bay",
                "target": "Reschedule Container",
            },
            {
                "weights": {"Container": 1931, "Forklift": 1933},
                "weight": 3864,
                "owners": ["Container", "Forklift"],
                "source": "Bring to Loading Bay",
                "target": "Load to Vehicle",
            },
            {
                "weights": {"Container": 2},
                "weight": 2,
                "owners": ["Container"],
                "role": "end",
                "source": "Bring to Loading Bay",
                "target": "__end__:Container",
            },
            {
                "weights": {"Forklift": 4},
                "weight": 4,
                "owners": ["Forklift"],
                "source": "Bring to Loading Bay",
                "target": "Bring to Loading Bay",
            },
            {
                "weights": {"Forklift": 30},
                "weight": 30,
                "owners": ["Forklift"],
                "source": "Bring to Loading Bay",
                "target": "Weigh",
            },
            {
                "weights": {"Forklift": 2},
                "weight": 2,
                "owners": ["Forklift"],
                "role": "end",
                "source": "Bring to Loading Bay",
                "target": "__end__:Forklift",
            },
            {
                "weights": {"Container": 35, "Vehicle": 7},
                "weight": 42,
                "owners": ["Container", "Vehicle"],
                "source": "Reschedule Container",
                "target": "Load to Vehicle",
            },
            {
                "weights": {"Container": 1},
                "weight": 1,
                "owners": ["Container"],
                "role": "end",
                "source": "Reschedule Container",
                "target": "__end__:Container",
            },
            {
                "weights": {"Transport Document": 33},
                "weight": 33,
                "owners": ["Transport Document"],
                "source": "Reschedule Container",
                "target": "Depart",
            },
            {
                "weights": {"Transport Document": 2, "Vehicle": 16},
                "weight": 18,
                "owners": ["Transport Document", "Vehicle"],
                "source": "Reschedule Container",
                "target": "Reschedule Container",
            },
            {
                "weights": {"Transport Document": 1},
                "weight": 1,
                "owners": ["Transport Document"],
                "role": "end",
                "source": "Reschedule Container",
                "target": "__end__:Transport Document",
            },
            {
                "weights": {"Vehicle": 12},
                "weight": 12,
                "owners": ["Vehicle"],
                "source": "Reschedule Container",
                "target": "Book Vehicles",
            },
            {
                "weights": {"Container": 1994},
                "weight": 1994,
                "owners": ["Container"],
                "source": "Pick Up Empty Container",
                "target": "Load Truck",
            },
            {
                "weights": {"Container": 1},
                "weight": 1,
                "owners": ["Container"],
                "role": "end",
                "source": "Pick Up Empty Container",
                "target": "__end__:Container",
            },
            {
                "weights": {"Container": 1989},
                "weight": 1989,
                "owners": ["Container"],
                "source": "Drive to Terminal",
                "target": "Weigh",
            },
            {
                "weights": {"Truck": 1988},
                "weight": 1988,
                "owners": ["Truck"],
                "source": "Drive to Terminal",
                "target": "Load Truck",
            },
            {
                "weights": {"Truck": 1},
                "weight": 1,
                "owners": ["Truck"],
                "role": "end",
                "source": "Drive to Terminal",
                "target": "__end__:Truck",
            },
            {
                "weights": {"Container": 1995},
                "weight": 1995,
                "owners": ["Container"],
                "source": "Order Empty Containers",
                "target": "Pick Up Empty Container",
            },
            {
                "weights": {"Container": 4},
                "weight": 4,
                "owners": ["Container"],
                "role": "end",
                "source": "Order Empty Containers",
                "target": "__end__:Container",
            },
            {
                "weights": {"Transport Document": 13},
                "weight": 13,
                "owners": ["Transport Document"],
                "source": "Order Empty Containers",
                "target": "Reschedule Container",
            },
            {
                "weights": {"Transport Document": 561},
                "weight": 561,
                "owners": ["Transport Document"],
                "source": "Order Empty Containers",
                "target": "Depart",
            },
            {
                "weights": {"Transport Document": 19},
                "weight": 19,
                "owners": ["Transport Document"],
                "role": "end",
                "source": "Order Empty Containers",
                "target": "__end__:Transport Document",
            },
            {
                "weights": {"Container": 1814, "Forklift": 1814},
                "weight": 3628,
                "owners": ["Container", "Forklift"],
                "source": "Weigh",
                "target": "Place in Stock",
            },
            {
                "weights": {"Container": 175, "Forklift": 175},
                "weight": 350,
                "owners": ["Container", "Forklift"],
                "source": "Weigh",
                "target": "Bring to Loading Bay",
            },
            {
                "weights": {"Container": 1999},
                "weight": 1999,
                "owners": ["Container"],
                "role": "start",
                "source": "__start__:Container",
                "target": "Order Empty Containers",
            },
            {
                "weights": {"Customer Order": 594},
                "weight": 594,
                "owners": ["Customer Order"],
                "source": "Register Customer Order",
                "target": "Create Transport Document",
            },
            {
                "weights": {"Customer Order": 6},
                "weight": 6,
                "owners": ["Customer Order"],
                "role": "end",
                "source": "Register Customer Order",
                "target": "__end__:Customer Order",
            },
            {
                "weights": {"Customer Order": 594},
                "weight": 594,
                "owners": ["Customer Order"],
                "role": "end",
                "source": "Create Transport Document",
                "target": "__end__:Customer Order",
            },
            {
                "weights": {"Transport Document": 594},
                "weight": 594,
                "owners": ["Transport Document"],
                "source": "Create Transport Document",
                "target": "Book Vehicles",
            },
            {
                "weights": {"Customer Order": 600},
                "weight": 600,
                "owners": ["Customer Order"],
                "role": "start",
                "source": "__start__:Customer Order",
                "target": "Register Customer Order",
            },
            {
                "weights": {"Forklift": 3},
                "weight": 3,
                "owners": ["Forklift"],
                "role": "start",
                "source": "__start__:Forklift",
                "target": "Weigh",
            },
            {
                "weights": {"Handling Unit": 10553},
                "weight": 10553,
                "owners": ["Handling Unit"],
                "source": "Collect Goods",
                "target": "Load Truck",
            },
            {
                "weights": {"Handling Unit": 10553},
                "weight": 10553,
                "owners": ["Handling Unit"],
                "role": "start",
                "source": "__start__:Handling Unit",
                "target": "Collect Goods",
            },
            {
                "weights": {"Transport Document": 593},
                "weight": 593,
                "owners": ["Transport Document"],
                "source": "Book Vehicles",
                "target": "Order Empty Containers",
            },
            {
                "weights": {"Transport Document": 1},
                "weight": 1,
                "owners": ["Transport Document"],
                "role": "end",
                "source": "Book Vehicles",
                "target": "__end__:Transport Document",
            },
            {
                "weights": {"Vehicle": 122},
                "weight": 122,
                "owners": ["Vehicle"],
                "source": "Book Vehicles",
                "target": "Load to Vehicle",
            },
            {
                "weights": {"Vehicle": 596},
                "weight": 596,
                "owners": ["Vehicle"],
                "source": "Book Vehicles",
                "target": "Book Vehicles",
            },
            {
                "weights": {"Vehicle": 19},
                "weight": 19,
                "owners": ["Vehicle"],
                "source": "Book Vehicles",
                "target": "Reschedule Container",
            },
            {
                "weights": {"Transport Document": 594},
                "weight": 594,
                "owners": ["Transport Document"],
                "role": "start",
                "source": "__start__:Transport Document",
                "target": "Create Transport Document",
            },
            {
                "weights": {"Truck": 6},
                "weight": 6,
                "owners": ["Truck"],
                "role": "start",
                "source": "__start__:Truck",
                "target": "Load Truck",
            },
            {
                "weights": {"Vehicle": 127},
                "weight": 127,
                "owners": ["Vehicle"],
                "role": "start",
                "source": "__start__:Vehicle",
                "target": "Book Vehicles",
            },
        ],
    }

    # return Response({"dfg": mockup}, status=status.HTTP_200_OK)

    file_id = request.query_params.get("file_id")
    if not file_id:
        return Response(
            {"error": "Missing ?file_id parameter"}, status=status.HTTP_400_BAD_REQUEST
        )

    # Optional object-type filter (comma-separated)
    raw_object_types = request.query_params.get("object_types")
    object_type_filter = None
    if raw_object_types:
        object_type_filter = set(
            [t.strip() for t in raw_object_types.split(",") if t.strip()]
        )

    # Scope the lookup to the caller's projects: an id alone must not grant
    # access to another user's log. ValueError covers a non-numeric ?file_id,
    # which would otherwise escape as a 500.
    try:
        user_file = EventLog.objects.get(id=file_id, project__users=request.user)
    except (EventLog.DoesNotExist, ValueError):
        return Response(
            {"error": "File not found or access denied"},
            status=status.HTTP_404_NOT_FOUND,
        )

    # --- Cache lookup (#72 / #74) ---
    ocdfg_cache_params = {
        "object_types": sorted(object_type_filter) if object_type_filter else [],
    }
    if _should_use_cache(request):
        cached = get_cached_result(user_file, "ocdfg", ocdfg_cache_params)
        if cached is not None:
            return Response(cached, status=status.HTTP_200_OK)

    try:
        with _with_ocel_db(user_file) as db:
            # Full OCDFG (unfiltered) for register.
            # edges="links" preserves the pre-NetworkX-3.4 key name the
            # frontend expects.
            ocdfg_full = OCDFGDb.from_ocel_db(db)
            dfg_json_full = nx.node_link_data(ocdfg_full, edges="links")
            all_nodes = [
                {
                    "id": n.get("id"),
                    "types": n.get("types", []),
                    "role": n.get("role"),
                    "object_type": n.get("object_type"),
                }
                for n in dfg_json_full.get("nodes", [])
            ]

            # Filtered OCDFG if object types specified. `OCDFGDb.from_ocel_db`
            # pushes the type filter into SQL itself — no separate OCEL
            # subsetting step is needed.
            filter_error = None
            trace_variants = None
            if object_type_filter:
                try:
                    ocdfg_filtered = OCDFGDb.from_ocel_db(
                        db, object_types=sorted(object_type_filter)
                    )
                    if len(ocdfg_filtered.nodes) == 0:
                        dfg_json = {
                            "directed": True,
                            "multigraph": False,
                            "graph": {"kind": "ocdfg"},
                            "nodes": [],
                            "links": [],
                        }
                    else:
                        dfg_json = nx.node_link_data(ocdfg_filtered, edges="links")

                    # Per-object-type trace variants for the filtered types.
                    trace_variants = NewOCDFGDb.compute_variants(
                        db, object_types=list(object_type_filter)
                    )
                except Exception as e:
                    # Gracefully fall back to unfiltered graph to avoid
                    # frontend breakage, but surface warning.
                    filter_error = f"Failed to compute filtered OCDFG: {e}"
                    dfg_json = dfg_json_full
            else:
                dfg_json = dfg_json_full

            # Always compute trace_variants if not already computed — use
            # all object types from the OCEL when no filter is specified.
            if trace_variants is None:
                try:
                    all_object_types = _object_types(db)
                    if all_object_types:
                        trace_variants = NewOCDFGDb.compute_variants(
                            db, object_types=all_object_types
                        )
                except Exception as e:
                    print(f"[OCDFG] Failed to compute trace variants: {e}")

        response_payload = {"dfg": dfg_json, "all_nodes": all_nodes}
        if filter_error:
            response_payload["filter_error"] = filter_error
        if trace_variants:
            response_payload["trace_variants"] = trace_variants

        set_cached_result(user_file, "ocdfg", response_payload, ocdfg_cache_params)
        return Response(response_payload, status=status.HTTP_200_OK)

    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def NewOCDFGViewSet(request):
    """
    Thin routing layer for the New OC-DFG endpoint.

    Delegates all computation to ``NewOCDFGDb.from_ocel_db_with_variant_ranks``
    in totem-lib.  The only Django-layer responsibilities are:
      1. Parse / validate query params.
      2. Resolve the EventLog → open OcelDuckDB.
      3. Call the lib method.
      4. Serialize the NetworkX graph to JSON and return.

    Variant filtering is now done **entirely on the frontend** using the
    ``variant_rank`` attribute annotated on every edge by the lib.  No
    ``trace_limits`` query parameter is accepted or processed here.
    """
    file_id = request.query_params.get("file_id")
    if not file_id:
        return Response(
            {"error": "Missing ?file_id parameter"}, status=status.HTTP_400_BAD_REQUEST
        )

    # Optional object-type filter (comma-separated)
    raw_object_types = request.query_params.get("object_types")
    object_type_filter = None
    if raw_object_types:
        object_type_filter = (
            sorted(t.strip() for t in raw_object_types.split(",") if t.strip()) or None
        )

    # Scope the lookup to the caller's projects: an id alone must not grant
    # access to another user's log. ValueError covers a non-numeric ?file_id,
    # which would otherwise escape as a 500.
    try:
        user_file = EventLog.objects.get(id=file_id, project__users=request.user)
    except (EventLog.DoesNotExist, ValueError):
        return Response(
            {"error": "File not found or access denied"},
            status=status.HTTP_404_NOT_FOUND,
        )

    try:
        with _with_ocel_db(user_file) as db:
            # Delegate all process-mining logic to totem-lib.
            # Returns the annotated graph and per-type variant counts for sliders.
            ocdfg, variant_counts = NewOCDFGDb.from_ocel_db_with_variant_ranks(
                db, object_types=object_type_filter
            )

            if len(ocdfg.nodes) == 0:
                dfg_json = {
                    "directed": True,
                    "multigraph": True,
                    "graph": {"kind": "new_ocdfg"},
                    "nodes": [],
                    "links": [],
                }
            else:
                dfg_json = nx.node_link_data(ocdfg, edges="links")

            all_nodes = [
                {
                    "id": n.get("id"),
                    "types": n.get("types", []),
                    "role": n.get("role"),
                    "object_type": n.get("object_type"),
                    "metrics": n.get("metrics"),
                }
                for n in dfg_json.get("nodes", [])
            ]

        return Response(
            {
                "dfg": dfg_json,
                "all_nodes": all_nodes,
                "variant_counts": variant_counts,
            },
            status=status.HTTP_200_OK,
        )

    except Exception as e:
        import traceback

        traceback.print_exc()
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# OCCN discovery dominates request time (seconds to ~1 min per log) while
# thresholding is a cheap marker filter, so cache the threshold-0 base net per
# (file, object-type filter) and apply the requested threshold per request.
_OCCN_CACHE_MAX_ENTRIES = 4
_occn_base_cache = OrderedDict()
_occn_cache_lock = threading.Lock()
_occn_inflight = {}


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def OCCNViewSet(request):
    """
    Discover and return a serialized OCCN for the given event log file.

    Query params:
        file_id (required)         — ID of the EventLog to mine
        object_types (optional)    — comma-separated object type filter
        relativeOccuranceThreshold — float in [0, 1], default 0.0
    """
    file_id = request.query_params.get("file_id")
    if not file_id:
        return Response(
            {"error": "Missing ?file_id parameter"}, status=status.HTTP_400_BAD_REQUEST
        )

    # Parse optional comma-separated object type filter.
    raw_object_types = request.query_params.get("object_types")
    object_type_filter = None
    if raw_object_types:
        object_type_filter = [
            t.strip() for t in raw_object_types.split(",") if t.strip()
        ] or None

    # Parse and validate threshold.
    raw_threshold = request.query_params.get("relativeOccuranceThreshold", "0.0")
    try:
        threshold = float(raw_threshold)
        if not (0.0 <= threshold <= 1.0):
            return Response(
                {"error": "relativeOccuranceThreshold must be a float in [0, 1]"},
                status=status.HTTP_400_BAD_REQUEST,
            )
    except (TypeError, ValueError):
        return Response(
            {"error": "relativeOccuranceThreshold must be a float"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Scope the lookup to the caller's projects: an id alone must not grant
    # access to another user's log. ValueError covers a non-numeric ?file_id,
    # which would otherwise escape as a 500.
    try:
        user_file = EventLog.objects.get(id=file_id, project__users=request.user)
    except (EventLog.DoesNotExist, ValueError):
        return Response(
            {"error": "File not found or access denied"},
            status=status.HTTP_404_NOT_FOUND,
        )

    try:
        parameters = (
            {"object_types": object_type_filter} if object_type_filter else None
        )
        cache_key = (
            user_file.id,
            tuple(object_type_filter) if object_type_filter else None,
        )

        with _occn_cache_lock:
            base_occn = _occn_base_cache.get(cache_key)
            if base_occn is not None:
                _occn_base_cache.move_to_end(cache_key)

        if base_occn is None:
            # Single-flight deduplication: ensure only one thread mines OCCN for a given cache_key
            event = None
            is_primary = False
            with _occn_cache_lock:
                base_occn = _occn_base_cache.get(cache_key)
                if base_occn is None:
                    event = _occn_inflight.get(cache_key)
                    if event is None:
                        event = threading.Event()
                        _occn_inflight[cache_key] = event
                        is_primary = True

            if not is_primary and base_occn is None and event is not None:
                event.wait(timeout=120)
                with _occn_cache_lock:
                    base_occn = _occn_base_cache.get(cache_key)

            if is_primary:
                try:
                    with _with_ocel_db(user_file) as db:
                        ocel_pm4py = convert_ocel_duckdb_to_pm4py(db)
                    base_occn = discover_occn(ocel_pm4py, relativeOccuranceThreshold=0.0, parameters=parameters)
                    with _occn_cache_lock:
                        _occn_base_cache[cache_key] = base_occn
                        _occn_base_cache.move_to_end(cache_key)
                        while len(_occn_base_cache) > _OCCN_CACHE_MAX_ENTRIES:
                            _occn_base_cache.popitem(last=False)
                finally:
                    with _occn_cache_lock:
                        _occn_inflight.pop(cache_key, None)
                    event.set()

        if base_occn is None:
            return Response({"error": "Failed to discover OCCN"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        occn = (
            base_occn.apply_relative_occurrence_threshold(threshold)
            if threshold > 0
            else base_occn
        )

        result = serialize_occn(occn)
        return Response(result, status=status.HTTP_200_OK)

    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def delete_user_data(request):
    confirm = request.data.get("confirm")
    if confirm != "DELETE":
        return Response(
            {"error": "Please confirm by sending {'confirm': 'DELETE'}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = request.user
    projects = Project.objects.filter(users=user)
    deleted_count = projects.count()
    projects.delete()

    return Response(
        {
            "detail": f"Deleted {deleted_count} project(s) and related data for user '{user.username}'."
        },
        status=status.HTTP_200_OK,
    )


# ---------------------------------------------------------------------------
# Cache management endpoints  (#76)
# ---------------------------------------------------------------------------


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def cache_stats(request):
    """Return current cache statistics."""
    from .cache_utils import get_cache_stats

    return Response(get_cache_stats())


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def cache_clear(request):
    """Clear the entire results cache."""
    from .cache_utils import clear_all_cache

    clear_all_cache()
    return Response({"status": "cleared"})


# ---------------------------------------------------------------------------
# Per-user settings
# ---------------------------------------------------------------------------


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def user_settings(request):
    """Read or update the current user's settings.

    GET returns the settings (creating a default row on first access).
    PATCH updates individual fields — currently only ``bypass_cache``.
    """
    settings_obj, _ = UserSettings.objects.get_or_create(user=request.user)

    if request.method == "PATCH":
        if "bypass_cache" in request.data:
            # Coerce via DRF's BooleanField so string payloads like "false"/"0"
            # are parsed correctly (bool("false") would wrongly be True). Invalid
            # values raise ValidationError -> 400.
            settings_obj.bypass_cache = serializers.BooleanField().to_internal_value(
                request.data["bypass_cache"]
            )
            settings_obj.save(update_fields=["bypass_cache"])

    return Response({"bypass_cache": settings_obj.bypass_cache})
