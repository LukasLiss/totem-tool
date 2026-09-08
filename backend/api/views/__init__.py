"""API views package.

Split out of the former monolithic ``api/views.py``. Public names used by
``api/urls.py`` (and a handful of private helpers referenced by tests and
signals) are re-exported here so ``api.views.<name>`` keeps working.
"""

from ._ocel_db import (
    _OCEL_DB_REGISTRY,
    _OCEL_DB_REGISTRY_LOCK,
    _OCEL_OBJECT_TYPES_REGISTRY,
    _build_ocel_db_from_path,
    _filter_shadow,
    _get_ocel_object_types,
    _get_or_load_ocel_db,
    _object_types,
    _with_ocel_db,
)
from ._filters import _parse_filter_params, _should_use_cache
from ._process_view import _parse_process_area_params, _process_area_cache_params
from .assets import ImageAssetViewSet, ProjectAssetViewSet
from .dashboards import DashboardViewSet
from .event_log import EventLogViewSet
from .misc import (
    cache_clear,
    cache_stats,
    delete_user_data,
    greeting,
    health_check,
    user_settings,
)
from .ocdfg import NewOCDFGViewSet, OCDFGViewSet
from .occn import OCCNViewSet, _occn_base_cache
from .playout import playout, playout_export_ocel
from .variants import variants

__all__ = [
    "EventLogViewSet",
    "ProjectAssetViewSet",
    "ImageAssetViewSet",
    "DashboardViewSet",
    "OCDFGViewSet",
    "NewOCDFGViewSet",
    "OCCNViewSet",
    "variants",
    "playout",
    "playout_export_ocel",
    "greeting",
    "health_check",
    "delete_user_data",
    "cache_stats",
    "cache_clear",
    "user_settings",
    # Private helpers re-exported for tests and signals that reference
    # ``api.views.<name>`` directly.
    "_OCEL_DB_REGISTRY",
    "_OCEL_DB_REGISTRY_LOCK",
    "_OCEL_OBJECT_TYPES_REGISTRY",
    "_build_ocel_db_from_path",
    "_filter_shadow",
    "_get_ocel_object_types",
    "_get_or_load_ocel_db",
    "_object_types",
    "_with_ocel_db",
    "_parse_filter_params",
    "_should_use_cache",
    "_parse_process_area_params",
    "_process_area_cache_params",
    "_occn_base_cache",
]
