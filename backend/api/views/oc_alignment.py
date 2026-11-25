"""Object-centric alignments: list process executions and align one of them.

Both actions live on ``EventLogViewSet`` (mixed in from here) and follow the
OCCN conformance endpoints: the log is read under the per-file lock and the
global filter (``_filter_shadow``), the expensive search runs afterwards
without holding the lock, and the computation is cancellable through the job
API.

* ``POST /api/files/<pk>/oc_alignment_executions/`` -- the process executions
  a source yields (stored execution ids, or the connected components of a
  process area / manual business object type + activity selection).
* ``POST /api/files/<pk>/oc_alignment/`` -- an optimal object-centric
  alignment of one execution against a stored OCPN asset.
* ``POST /api/files/<pk>/oc_alignment_batch/`` -- alignments of every
  execution of a source: one compact row per execution plus aggregates.
"""

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from totem_lib.ocel.event_columns import EventColumnError
from totem_lib.oc_alignments import (
    AREA_EXECUTION_SOURCE,
    AlignmentCancelled,
    AlignmentModelError,
    ExecutionNotFoundError,
    align_executions,
    compute_oc_alignment,
    list_area_executions,
    list_stored_executions,
    load_area_execution,
    load_area_executions,
    load_stored_execution,
    load_stored_executions,
    net_from_ocpn_dict,
)

from ..jobs import JobCancelled, cancelled_response, job_scope
from ..models import EventLog, ProjectAsset
from ..serializers import (
    OCAlignmentBatchRequestSerializer,
    OCAlignmentExecutionsRequestSerializer,
    OCAlignmentRequestSerializer,
)
from ._filters import _parse_filter_params
from ._ocel_db import _filter_shadow, _with_ocel_db

#: The listing is for picking one execution; beyond this the client searches.
MAX_LISTED_EXECUTIONS = 5_000


def _source_echo(validated):
    return {
        "source": validated["source"],
        "execution_column": validated.get("execution_column"),
        "business_object_types": sorted(set(validated.get("business_object_types") or [])),
        "business_activities": sorted(set(validated.get("business_activities") or [])),
    }


class OCAlignmentActionsMixin:
    """``@action``s of ``EventLogViewSet`` for object-centric alignments."""

    @staticmethod
    def _resolve_ocpn_asset(request, user_file, asset_id):
        """Load an OCPN asset of the log's project as an alignment net.

        Returns ``(asset, net, None)`` or ``(None, None, error_response)``.
        """
        try:
            asset = ProjectAsset.objects.get(pk=asset_id, project__users=request.user)
        except ProjectAsset.DoesNotExist:
            return None, None, Response(
                {"asset_id": "Model asset not found."}, status=status.HTTP_404_NOT_FOUND
            )
        if asset.project_id != user_file.project_id:
            return None, None, Response(
                {"asset_id": "Model asset must belong to the event log project."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if asset.asset_type != ProjectAsset.AssetType.OCPN:
            return None, None, Response(
                {"asset_id": "Model asset must be an object-centric Petri net (OCPN)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            net = net_from_ocpn_dict(asset.content_json)
        except AlignmentModelError as exc:
            return None, None, Response(
                {"asset_id": f"Stored OCPN model cannot be used for alignments: {exc}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return asset, net, None

    def _alignment_log(self, pk):
        try:
            return self.get_queryset().get(pk=pk), None
        except EventLog.DoesNotExist:
            return None, Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=True, methods=["post"])
    def oc_alignment_executions(self, request, pk=None):
        """List the process executions an alignment source yields."""
        serializer = OCAlignmentExecutionsRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        validated = serializer.validated_data
        user_file, error = self._alignment_log(pk)
        if error is not None:
            return error

        model_types = None
        if validated.get("asset_id"):
            _asset, net, error = self._resolve_ocpn_asset(request, user_file, validated["asset_id"])
            if error is not None:
                return error
            model_types = set(net.object_types)

        try:
            fp = _parse_filter_params(request)
            with job_scope(request, "Process executions") as job, _with_ocel_db(user_file, job) as db:
                job.report(None, "Extracting process executions")
                with _filter_shadow(db, fp):
                    if validated["source"] == AREA_EXECUTION_SOURCE:
                        executions = list_area_executions(
                            db.conn,
                            validated["business_object_types"],
                            validated["business_activities"] or None,
                        )
                    else:
                        executions = list_stored_executions(db.conn, validated["execution_column"])
        except JobCancelled:
            return cancelled_response()
        except EventColumnError as exc:
            return Response({"execution_column": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            return Response(
                {"error": f"Failed to extract process executions: {exc}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        if model_types is not None:
            for item in executions:
                item["ignored_object_types"] = sorted(
                    set(item["object_type_counts"]) - model_types
                )
        total = len(executions)
        return Response(
            {
                "file_id": user_file.pk,
                **_source_echo(validated),
                "model_object_types": sorted(model_types) if model_types is not None else None,
                "total": total,
                "truncated": total > MAX_LISTED_EXECUTIONS,
                "executions": executions[:MAX_LISTED_EXECUTIONS],
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"])
    def oc_alignment(self, request, pk=None):
        """Optimal object-centric alignment of one process execution."""
        serializer = OCAlignmentRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        validated = serializer.validated_data
        user_file, error = self._alignment_log(pk)
        if error is not None:
            return error
        asset, net, error = self._resolve_ocpn_asset(request, user_file, validated["asset_id"])
        if error is not None:
            return error

        execution_id = validated["execution_id"]
        try:
            with job_scope(request, "Object-centric alignment") as job:
                try:
                    fp = _parse_filter_params(request)
                    with _with_ocel_db(user_file, job) as db:
                        job.report(None, "Loading process execution")
                        with _filter_shadow(db, fp):
                            if validated["source"] == AREA_EXECUTION_SOURCE:
                                execution = load_area_execution(
                                    db.conn,
                                    validated["business_object_types"],
                                    validated["business_activities"] or None,
                                    execution_id,
                                )
                            else:
                                execution = load_stored_execution(
                                    db.conn, validated["execution_column"], execution_id
                                )
                except JobCancelled:
                    raise
                except EventColumnError as exc:
                    return Response(
                        {"execution_column": str(exc)}, status=status.HTTP_400_BAD_REQUEST
                    )
                except ExecutionNotFoundError as exc:
                    return Response({"execution_id": str(exc)}, status=status.HTTP_404_NOT_FOUND)
                except ValueError as exc:
                    return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
                except Exception as exc:
                    return Response(
                        {"error": f"Failed to load the process execution: {exc}"},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    )

                try:
                    job.report(None, "Searching optimal alignment")
                    result = compute_oc_alignment(
                        net,
                        execution,
                        max_states=validated["max_states"],
                        timeout_s=validated["timeout_s"],
                        ignore_unknown_object_types=True,
                        should_cancel=lambda: job.cancelled,
                        progress=job.report,
                    )
                except (JobCancelled, AlignmentCancelled):
                    raise JobCancelled("Object-centric alignment was cancelled")
                except Exception as exc:
                    return Response(
                        {"error": f"Failed to compute the object-centric alignment: {exc}"},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    )
        except JobCancelled:
            return cancelled_response()

        return Response(
            {
                "file_id": user_file.pk,
                "asset_id": asset.pk,
                "execution_id": execution.execution_id,
                **_source_echo(validated),
                "max_states": validated["max_states"],
                "timeout_s": validated["timeout_s"],
                "model_object_types": list(net.object_types),
                **result.to_dict(),
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"])
    def oc_alignment_batch(self, request, pk=None):
        """Object-centric alignments of every process execution of a source."""
        serializer = OCAlignmentBatchRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        validated = serializer.validated_data
        user_file, error = self._alignment_log(pk)
        if error is not None:
            return error
        asset, net, error = self._resolve_ocpn_asset(request, user_file, validated["asset_id"])
        if error is not None:
            return error

        try:
            with job_scope(request, "Object-centric alignments") as job:
                try:
                    fp = _parse_filter_params(request)
                    with _with_ocel_db(user_file, job) as db:
                        job.report(None, "Loading process executions")
                        with _filter_shadow(db, fp):
                            if validated["source"] == AREA_EXECUTION_SOURCE:
                                executions = load_area_executions(
                                    db.conn,
                                    validated["business_object_types"],
                                    validated["business_activities"] or None,
                                )
                            else:
                                executions = load_stored_executions(
                                    db.conn, validated["execution_column"]
                                )
                except JobCancelled:
                    raise
                except EventColumnError as exc:
                    return Response(
                        {"execution_column": str(exc)}, status=status.HTTP_400_BAD_REQUEST
                    )
                except ValueError as exc:
                    return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
                except Exception as exc:
                    return Response(
                        {"error": f"Failed to load the process executions: {exc}"},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    )

                try:
                    result = align_executions(
                        net,
                        executions,
                        max_states=validated["max_states"],
                        timeout_s=validated["timeout_s"],
                        total_timeout_s=validated["total_timeout_s"],
                        should_cancel=lambda: job.cancelled,
                        progress=job.report,
                    )
                except (JobCancelled, AlignmentCancelled):
                    raise JobCancelled("Object-centric alignments were cancelled")
                except Exception as exc:
                    return Response(
                        {"error": f"Failed to compute the object-centric alignments: {exc}"},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    )
        except JobCancelled:
            return cancelled_response()

        return Response(
            {
                "file_id": user_file.pk,
                "asset_id": asset.pk,
                **_source_echo(validated),
                "max_states": validated["max_states"],
                "timeout_s": validated["timeout_s"],
                "total_timeout_s": validated["total_timeout_s"],
                "model_object_types": list(net.object_types),
                **result.to_dict(),
            },
            status=status.HTTP_200_OK,
        )
