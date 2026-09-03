"""``EventLogViewSet`` — upload, metadata, filtering, discovery and conformance.

The heaviest module in the package: every discovery/conformance algorithm the
frontend can trigger against a stored event log is an ``@action`` here.
"""

import copy
import json
import os
from hashlib import sha1

from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.utils.text import slugify
from django.core.cache import cache

from totem_lib.dfg import NewOCDFGDb
from totem_lib import (
    extract_occn_replay_units,
    occn_from_dict,
    occn_replay_fitness,
    occn_to_dict,
)
from totem_lib.totem import (
    conformance_of_totem,
    mlpaDiscovery,
    totemDiscovery_db,
    totem_from_dict,
    totem_to_dict,
)
from totem_lib.process_areas import prepare_db, process_areas_from_aggregates
from totem_lib.ocel import FilterStack, apply_filter_stack, import_ocel_db
from totem_lib.ocpn import discover_ocpn_db
from totem_lib.ocel.validation import OCELValidationException
from totem_lib.oc_dotted_chart import (
    get_oc_dotted_chart_columns,
    get_oc_dotted_chart_data,
)

from ..models import EventLog, Project, ProjectAsset
from ..serializers import (
    EventLogSerializer,
    OCCNConformanceRequestSerializer,
    OCCNReplayUnitDetailRequestSerializer,
    ProjectAssetSerializer,
    TotemConformanceRequestSerializer,
)
from ..cache_utils import get_cached_result, set_cached_result
from ._ocel_db import (
    _OCEL_DB_REGISTRY,
    _OCEL_DB_REGISTRY_LOCK,
    _OCEL_OBJECT_TYPES_REGISTRY,
    _activities_with_counts,
    _build_ocel_db_from_path,
    _filter_shadow,
    _get_ocel_object_types,
    _object_types,
    _object_types_with_counts,
    _with_ocel_db,
)
from ._filters import (
    _filtered_event_counts,
    _filtered_object_counts,
    _filtered_timestamp_range,
    _optional_int,
    _parse_filter_params,
    _should_use_cache,
)
from ._process_view import (
    _parse_process_area_params,
    _process_area_cache_params,
    _serialize_mlpa,
    _serialize_process_layers,
)
from .occn import _get_or_discover_base_occn


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
                _OCEL_OBJECT_TYPES_REGISTRY[pk] = tuple(
                    (row["name"], row["count"])
                    for row in _object_types_with_counts(db)
                )
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
            fp = _parse_filter_params(request)
            with _with_ocel_db(user_file) as db:
                processed, _ = _filtered_event_counts(fp, db)
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
    def activities(self, request, pk=None):
        """Returns the sorted list of unique activity names in the event log."""
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            with _with_ocel_db(user_file) as db:
                acts = _activities_with_counts(db)
        except Exception as e:
            return Response({"error": f"Failed to load OCEL: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(acts, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"])
    def event_distribution(self, request, pk=None):
        """Returns monthly event counts for the time range histogram."""
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            with _with_ocel_db(user_file) as db:
                rows = db.conn.execute("""
                    SELECT
                        CAST(EXTRACT(year  FROM to_timestamp(timestamp_unix)) AS INTEGER) AS yr,
                        CAST(EXTRACT(month FROM to_timestamp(timestamp_unix)) AS INTEGER) AS mo,
                        COUNT(*) AS count
                    FROM events
                    GROUP BY yr, mo
                    ORDER BY yr, mo
                """).fetchall()
            distribution = [{"period": f"{r[0]:04d}-{r[1]:02d}", "count": r[2]} for r in rows]
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(distribution, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def apply_filters(self, request, pk=None):
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

        filters_data = request.data.get("filters", [])

        try:
            with _with_ocel_db(user_file) as db:
                filter_stack = FilterStack.from_dict({"filters": filters_data})
                _, stats = apply_filter_stack(db, filter_stack, stats_only=True)
        except Exception as e:
            return Response({"error": f"Failed to apply filters: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response({
            "object_percentage":   stats["object_percentage"],
            "object_count_before": stats["object_count_before"],
            "object_count_after":  stats["object_count_after"],
            "event_percentage":    stats["event_percentage"],
            "event_count_before":  stats["event_count_before"],
            "event_count_after":   stats["event_count_after"],
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"])
    def discover_totem(self, request, pk=None):
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response(
                {"error": "File not found"}, status=status.HTTP_404_NOT_FOUND
            )

        try:
            fp = _parse_filter_params(request)
            is_filtered = any(k in fp for k in ("after", "before", "activities", "object_types"))
            filter_cache_params = {f"f_{k}": str(v) for k, v in fp.items()} if is_filtered else None

            if _should_use_cache(request):
                cached = get_cached_result(user_file, "discover_totem", filter_cache_params)
                if cached is not None:
                    return Response(cached, status=status.HTTP_200_OK)

            with _with_ocel_db(user_file) as db:
                with _filter_shadow(db, fp):
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

            set_cached_result(user_file, "discover_totem", serialized, filter_cache_params)
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
            fp = _parse_filter_params(request)
            is_filtered = any(k in fp for k in ("after", "before", "activities", "object_types"))

            # `discover_mlpa` keys on the file alone — it takes no parameters.
            # A filtered request bypasses the cache entirely so it never serves
            # or stores unfiltered results under that key.
            if not is_filtered and _should_use_cache(request):
                cached = get_cached_result(user_file, "discover_mlpa")
                if cached is not None:
                    return Response(cached, status=status.HTTP_200_OK)

            with _with_ocel_db(user_file) as db:
                with _filter_shadow(db, fp):
                    totem = totemDiscovery_db(db)
            # mlpaDiscovery operates on the Totem object (no DB access),
            # so it can run outside the per-file lock.
            process_view = mlpaDiscovery(totem)
            serialized = _serialize_mlpa(process_view, totem)

            if not is_filtered:
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
            fp = _parse_filter_params(request)
            is_filtered = any(k in fp for k in ("after", "before", "activities", "object_types"))

            # Every parameter is part of the key. Filter params are included so
            # filtered and unfiltered results occupy separate cache entries.
            cache_params = _process_area_cache_params(params)
            if is_filtered:
                cache_params = {**cache_params, **{f"f_{k}": str(v) for k, v in fp.items()}}

            use_full_cache = _should_use_cache(request)
            if use_full_cache:
                cached = get_cached_result(
                    user_file, "discover_process_areas", cache_params
                )
                if cached is not None:
                    return Response(cached, status=status.HTTP_200_OK)

            # Two-tier cache. Preparation reads the log and depends only on it;
            # the weights and alpha/beta only affect scoring and the ILP solve.
            # Caching the two separately turns a slider change into a solve
            # instead of a full rediscovery.
            # When a filter is active, tier caches hold unfiltered data — skip them.
            use_tier_cache = use_full_cache and not is_filtered
            aggregates = (
                get_cached_result(user_file, "process_area_prep") if use_tier_cache else None
            )
            totem_data = (
                get_cached_result(user_file, "discover_totem_raw") if use_tier_cache else None
            )

            if aggregates is None or totem_data is None:
                with _with_ocel_db(user_file) as db:
                    with _filter_shadow(db, fp):
                        if aggregates is None:
                            aggregates = prepare_db(db)
                            if use_tier_cache:
                                set_cached_result(user_file, "process_area_prep", aggregates)
                        if totem_data is None:
                            totem_data = totem_to_dict(totemDiscovery_db(db))
                            if use_tier_cache:
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

        fp = _parse_filter_params(request)
        is_filtered = any(k in fp for k in ("after", "before", "activities", "object_types"))

        raw_object_types = request.query_params.get("object_types")
        object_type_filter = None
        if raw_object_types:
            object_type_filter = sorted(
                t.strip() for t in raw_object_types.split(",") if t.strip()
            ) or None

        # The discovered model only depends on the log and the selected
        # object types, not on the timeout budget — cache accordingly.
        types_key = ",".join(object_type_filter) if object_type_filter else "all"
        if is_filtered:
            filter_suffix = sha1(json.dumps(fp, sort_keys=True).encode()).hexdigest()[:8]
            cache_key = f"ocpn_discovery_{user_file.pk}_{sha1(types_key.encode()).hexdigest()}_{filter_suffix}"
        else:
            cache_key = f"ocpn_discovery_{user_file.pk}_{sha1(types_key.encode()).hexdigest()}"
        cached_result = cache.get(cache_key)
        if cached_result:
            return Response(cached_result, status=status.HTTP_200_OK)

        try:
            with _with_ocel_db(user_file) as db:
                with _filter_shadow(db, fp):
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

    @staticmethod
    def _occn_content_json(occn):
        """Canonical asset JSON for a (possibly discovered) OCCN.

        Discovered nets may carry markers with ``marker_key == 0`` ("no
        constraint / assign automatically"), which the canonical schema
        rejects. Mirror the factory / editor behavior and give those markers
        fresh unique keys — on a deep copy, because the net may live in the
        shared discovery cache.
        """
        occn = copy.deepcopy(occn)
        all_groups = [
            group
            for groups in (occn.input_marker_groups, occn.output_marker_groups)
            for group_list in groups.values()
            for group in group_list
        ]
        next_key = 1 + max(
            (
                int(marker.marker_key)
                for group in all_groups
                for marker in group.markers
                if isinstance(marker.marker_key, (int, float)) and marker.marker_key > 0
            ),
            default=0,
        )
        for group in all_groups:
            for marker in group.markers:
                if not marker.marker_key or marker.marker_key <= 0:
                    marker.marker_key = next_key
                    next_key += 1
        return occn_to_dict(occn)

    @action(detail=True, methods=["post"])
    def save_discovered_model(self, request, pk=None):
        """Discover a model from this event log and store it as a project asset.

        Body: ``{"name": str, "model_type": "TOTEM"|"OCCN"|"OCPN"|"OCDFG",
        "params": {...}}`` where ``params`` carries the discovery settings the
        requesting component currently uses:

        - TOTEM: ``tau`` (float in [0, 1], default 0.0)
        - OCCN:  ``relative_occurrence_threshold`` (float in [0, 1]),
                 ``object_types`` (list of strings, empty = all)
        - OCPN:  ``timeout_s`` (float), ``object_types``
        - OCDFG: ``object_types``

        Discovery reuses the same caches as the corresponding read endpoints,
        so saving right after viewing a discovered model is cheap. The
        resulting canonical JSON is validated and stored through the regular
        project-asset serializer (name uniqueness included).
        """
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response(
                {"error": "File not found"}, status=status.HTTP_404_NOT_FOUND
            )

        name = request.data.get("name")
        model_type = request.data.get("model_type")
        params = request.data.get("params") or {}
        if not isinstance(params, dict):
            return Response(
                {"error": "params must be an object"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if model_type not in ProjectAsset.AssetType.values:
            return Response(
                {"error": "Unsupported model_type"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        object_type_filter = None
        raw_object_types = params.get("object_types")
        if isinstance(raw_object_types, list):
            object_type_filter = sorted(
                t.strip() for t in raw_object_types if isinstance(t, str) and t.strip()
            ) or None
        elif isinstance(raw_object_types, str) and raw_object_types.strip():
            object_type_filter = sorted(
                t.strip() for t in raw_object_types.split(",") if t.strip()
            ) or None

        try:
            if model_type == ProjectAsset.AssetType.TOTEM:
                try:
                    tau = float(params.get("tau", 0.0))
                except (TypeError, ValueError):
                    tau = 0.0
                tau = min(1.0, max(0.0, tau))
                with _with_ocel_db(user_file) as db:
                    totem = totemDiscovery_db(db, tau=tau)
                content_json = totem_to_dict(totem)

            elif model_type == ProjectAsset.AssetType.OCCN:
                try:
                    threshold = float(params.get("relative_occurrence_threshold", 0.0))
                except (TypeError, ValueError):
                    threshold = 0.0
                threshold = min(1.0, max(0.0, threshold))
                base_occn = _get_or_discover_base_occn(user_file, object_type_filter)
                if base_occn is None:
                    return Response(
                        {"error": "Failed to discover OCCN"},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    )
                occn = (
                    base_occn.apply_relative_occurrence_threshold(threshold)
                    if threshold > 0
                    else base_occn
                )
                content_json = self._occn_content_json(occn)

            elif model_type == ProjectAsset.AssetType.OCPN:
                try:
                    timeout_s = float(params.get("timeout_s", 30.0))
                    if timeout_s <= 0:
                        timeout_s = None
                except (TypeError, ValueError):
                    timeout_s = 30.0
                # Same cache key as discover_ocpn, so a save right after
                # viewing reuses the already-discovered net.
                types_key = ",".join(object_type_filter) if object_type_filter else "all"
                ocpn_cache_key = (
                    f"ocpn_discovery_{user_file.pk}_{sha1(types_key.encode()).hexdigest()}"
                )
                cached_result = cache.get(ocpn_cache_key)
                if cached_result and cached_result.get("ocpn"):
                    content_json = cached_result["ocpn"]
                else:
                    with _with_ocel_db(user_file) as db:
                        content_json = discover_ocpn_db(
                            db,
                            object_types=object_type_filter,
                            timeout_s=timeout_s,
                            name=os.path.splitext(
                                os.path.basename(user_file.file.name)
                            )[0],
                        )
                    cache.set(ocpn_cache_key, {"ocpn": content_json}, timeout=3600)

            else:  # OCDFG
                with _with_ocel_db(user_file) as db:
                    graph = NewOCDFGDb.from_ocel_db(db, object_types=object_type_filter)
                object_types = set()
                activities = []
                for node in graph.nodes:
                    node_id = str(node)
                    if node_id.startswith("__start__:") or node_id.startswith("__end__:"):
                        object_types.add(node_id.split(":", 1)[1])
                    else:
                        activities.append(node_id)
                edges = []
                seen_edges = set()
                for source, target, data in graph.edges(data=True):
                    object_type = data.get("objtype") or data.get("object_type")
                    if not object_type:
                        continue
                    key = (str(source), str(target), str(object_type))
                    if key in seen_edges:
                        continue
                    seen_edges.add(key)
                    object_types.add(str(object_type))
                    edges.append(
                        {
                            "source": str(source),
                            "target": str(target),
                            "object_type": str(object_type),
                        }
                    )
                edges.sort(
                    key=lambda e: (e["source"], e["target"], e["object_type"])
                )
                content_json = {
                    "schema": "ocdfg",
                    "version": 1,
                    "name": name or "Discovered OC-DFG",
                    "object_types": sorted(object_types),
                    "activities": sorted(activities),
                    "edges": edges,
                }
        except TimeoutError as e:
            return Response(
                {"error": str(e), "code": "timeout"},
                status=status.HTTP_408_REQUEST_TIMEOUT,
            )
        except Exception as e:
            return Response(
                {"error": f"Model discovery failed: {e}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        serializer = ProjectAssetSerializer(
            data={
                "project": user_file.project_id,
                "name": name,
                "asset_type": model_type,
                "content_json": content_json,
                "metadata": {
                    "source": "discovery",
                    "event_log_id": user_file.pk,
                    "params": params,
                },
            },
            context={"request": request},
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def statistics(self, request, pk=None):
        """Returns basic statistics of the event log."""
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response(
                {"error": "File not found"}, status=status.HTTP_404_NOT_FOUND
            )

        try:
            fp = _parse_filter_params(request)
            is_filtered = any(k in fp for k in ("after", "before", "activities", "object_types"))
            filter_cache_params = {f"f_{k}": str(v) for k, v in fp.items()} if is_filtered else None

            if _should_use_cache(request):
                cached = get_cached_result(user_file, "statistics", filter_cache_params)
                if cached is not None:
                    return Response(cached, status=status.HTTP_200_OK)

            with _with_ocel_db(user_file) as db:
                num_events, num_unique_activities = _filtered_event_counts(fp, db)
                num_objects, num_object_types = _filtered_object_counts(fp, db)
                earliest_timestamp, newest_timestamp = _filtered_timestamp_range(fp, db)

            result = {
                "num_events": num_events,
                "num_unique_activities": num_unique_activities,
                "num_objects": num_objects,
                "num_object_types": num_object_types,
                "earliest_timestamp": earliest_timestamp,
                "newest_timestamp": newest_timestamp,
            }
            set_cached_result(user_file, "statistics", result, filter_cache_params)
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

        fp = _parse_filter_params(request)
        local_t_min = _optional_int(request.query_params.get("t_min"))
        local_t_max = _optional_int(request.query_params.get("t_max"))
        global_after  = fp.get("after")
        global_before = fp.get("before")
        effective_t_min = max(v for v in [local_t_min, global_after]  if v is not None) if any(v is not None for v in [local_t_min, global_after])  else None
        effective_t_max = min(v for v in [local_t_max, global_before] if v is not None) if any(v is not None for v in [local_t_max, global_before]) else None
        fp_non_time = {k: v for k, v in fp.items() if k not in ("after", "before")}

        try:
            with _with_ocel_db(user_file) as db:
                with _filter_shadow(db, fp_non_time):
                    result = get_oc_dotted_chart_data(
                        db,
                        t_min=effective_t_min,
                        t_max=effective_t_max,
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
