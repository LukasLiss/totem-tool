from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Literal

import polars as pl
import numpy as np
from totem_lib import ObjectCentricEventLog as OCEL

FEATURE_GROUPS = Literal[
    "activity_fractions",
    "cooccurrence_fractions",
    "object_collaboration_fractions",
    "object_portfolio_fractions",
    "time_fractions",
    "weekday_fractions",
]


@dataclass
class ResourceProfile:
    """
    All computed features for a single resource object.

    ``activity_fractions``            — fraction of this resource's events per activity label.
    ``cooccurrence_fractions``        — fraction of this resource's events in which each
                                        other resource also participates (same event).
    ``object_collaboration_fractions`` — fraction of this resource's distinct business
                                        objects that each other resource also worked on
                                        at any point (same object, any event).
    ``time_fractions``                — fraction of this resource's events falling in each
                                        hourly bin (0–23). Normalised per resource so all
                                        values sum to 1.0.
    ``weekday_fractions``             — fraction of this resource's events falling on each
                                        day of the week (0=Mon … 6=Sun). Normalised per
                                        resource so all values sum to 1.0.
    ``object_portfolio_fractions``    — fraction of this resource's distinct business
                                        objects belonging to each object type. Normalised
                                        per resource so all values sum to 1.0 (simplex
                                        over business object types rather than resources).
Additional feature groups are added as new fields without changing the rest
    of the system.
    """

    resource_id: str
    object_type: str
    activity_fractions: dict[str, float] = field(default_factory=dict)
    cooccurrence_fractions: dict[str, float] = field(default_factory=dict)
    object_collaboration_fractions: dict[str, float] = field(default_factory=dict)
    time_fractions: dict[int, float] = field(default_factory=dict)
    weekday_fractions: dict[int, float] = field(default_factory=dict)
    object_portfolio_fractions: dict[str, float] = field(default_factory=dict)

    def feature_vector(
        self,
        activities: list[str],
        cooccurring_resources: list[str] | None = None,
        collaborating_resources: list[str] | None = None,
        time_bins: list[int] | None = None,
        weekday_bins: list[int] | None = None,
        portfolio_object_types: list[str] | None = None,
    ) -> list[float]:
        """
        Ordered numeric vector used for distance computation, MDS, and clustering.

        Parameters
        ----------
        activities : list[str]
            Ordered activity feature space.
        cooccurring_resources : list[str] | None
            Ordered resource feature space for co-occurrence fractions.
        collaborating_resources : list[str] | None
            Ordered resource feature space for object collaboration fractions.
        time_bins : list[int] | None
            Hour bins (0–23) to include as time-fraction features.
        weekday_bins : list[int] | None
            Weekday bins (0=Mon … 6=Sun) to include as weekday-fraction features.
        portfolio_object_types : list[str] | None
            Ordered business object type names for the portfolio fractions.
        """
        vec = [self.activity_fractions.get(a, 0.0) for a in activities]
        if cooccurring_resources:
            vec += [self.cooccurrence_fractions.get(r, 0.0) for r in cooccurring_resources]
        if collaborating_resources:
            vec += [self.object_collaboration_fractions.get(r, 0.0) for r in collaborating_resources]
        if time_bins:
            vec += [self.time_fractions.get(h, 0.0) for h in time_bins]
        if weekday_bins:
            vec += [self.weekday_fractions.get(d, 0.0) for d in weekday_bins]
        if portfolio_object_types:
            vec += [self.object_portfolio_fractions.get(t, 0.0) for t in portfolio_object_types]
        return vec


class ProfileMatrix:
    """
    Collection of ResourceProfiles, one per resource.

    The feature space is defined by ``activities`` and optionally
    ``cooccurring_resources``; ``to_numpy()`` assembles uniform feature vectors
    from every profile using only the groups that were requested at construction.
    """

    def __init__(
        self,
        profiles: list[ResourceProfile],
        activities: list[str],
        cooccurring_resources: list[str] | None = None,
        collaborating_resources: list[str] | None = None,
        time_bins: list[int] | None = None,
        weekday_bins: list[int] | None = None,
        portfolio_object_types: list[str] | None = None,
    ) -> None:
        self.profiles = profiles
        self.activities = activities
        self.cooccurring_resources: list[str] = cooccurring_resources or []
        self.collaborating_resources: list[str] = collaborating_resources or []
        self.time_bins: list[int] = time_bins or []
        self.weekday_bins: list[int] = weekday_bins or []
        self.portfolio_object_types: list[str] = portfolio_object_types or []

    # ── convenience accessors ──────────────────────────────────────────────────

    @property
    def resources(self) -> list[str]:
        return [p.resource_id for p in self.profiles]

    @property
    def resource_object_types(self) -> dict[str, str]:
        return {p.resource_id: p.object_type for p in self.profiles}

    @property
    def feature_groups(self) -> list[str]:
        """Which feature groups are present in this matrix."""
        groups = []
        if self.activities:
            groups.append("activity_fractions")
        if self.cooccurring_resources:
            groups.append("cooccurrence_fractions")
        if self.collaborating_resources:
            groups.append("object_collaboration_fractions")
        if self.time_bins:
            groups.append("time_fractions")
        if self.weekday_bins:
            groups.append("weekday_fractions")
        if self.portfolio_object_types:
            groups.append("object_portfolio_fractions")
        return groups

    # ── construction ──────────────────────────────────────────────────────────

    @classmethod
    def from_ocel(
        cls,
        ocel: OCEL,
        resource_types: List[str] | None = None,
        feature_groups: List[str] | None = None,
        business_object_types: List[str] | None = None,
    ) -> "ProfileMatrix":
        """
        Build a ProfileMatrix from an OCEL.

        Parameters
        ----------
        ocel : OCEL
        resource_types : list[str] | None
            Object types treated as resources. Defaults to all object types.
        feature_groups : list[str] | None
            Which feature groups to compute. Defaults to ["activity_fractions"].
            Supported values: "activity_fractions", "cooccurrence_fractions",
            "object_collaboration_fractions", "time_fractions".
        business_object_types : list[str] | None
            Object types considered as business objects for the
            ``object_collaboration_fractions`` feature group.  Defaults to all
            non-resource object types when ``None``.
        """
        if feature_groups is None:
            feature_groups = ["activity_fractions"]

        if resource_types is None:
            resource_types = ocel.object_types

        resource_ids: set[str] = set()
        resource_object_types: dict[str, str] = {}
        for obj_type in resource_types:
            for obj_id in ocel.get_object_ids_by_type(obj_type):
                resource_ids.add(obj_id)
                resource_object_types[obj_id] = obj_type

        # ── Base join: one row per (event, resource) ───────────────────────────
        event_resource = (
            ocel.events
            .select(["_eventId", "_activity", "_timestampUnix", "_objects"])
            .explode("_objects")
            .rename({"_objects": "_objId"})
            .filter(pl.col("_objId").is_in(resource_ids))
        )

        # Per-resource total event count — shared denominator for all fractions
        totals = (
            event_resource
            .group_by("_objId")
            .agg(pl.len().alias("total"))
        )

        # ── Activity fractions ─────────────────────────────────────────────────
        activity_fractions_by_resource: dict[str, dict[str, float]] = {
            rid: {} for rid in resource_ids
        }
        all_activities: list[str] = []

        if "activity_fractions" in feature_groups:
            counts = (
                event_resource
                .group_by(["_objId", "_activity"])
                .agg(pl.len().alias("count"))
            )
            fractions_df = (
                counts
                .join(totals, on="_objId", how="left")
                .with_columns(
                    (pl.col("count") / pl.col("total")).alias("fraction")
                )
                .select(["_objId", "_activity", "fraction"])
            )
            for row in fractions_df.iter_rows(named=True):
                activity_fractions_by_resource[row["_objId"]][row["_activity"]] = row["fraction"]
            all_activities = sorted({
                row["_activity"]
                for row in fractions_df.select("_activity").iter_rows(named=True)
            })

        # ── Co-occurrence fractions ────────────────────────────────────────────
        # Option B formulation: for each event E that R1 participated in,
        # split credit 1/|participants(E)| equally among all co-participants,
        # then average over all of R1's events.
        #
        # Semantic: pick a random event from R1's events, then pick a random
        # participant — the probability of landing on R2.  Row sums to 1.0
        # (simplex over resources), making Hellinger directly applicable.
        #
        # Self-entry = average exclusivity of R1's events (1.0 if always solo,
        # → 0 if always in large groups).
        cooccurrence_by_resource: dict[str, dict[str, float]] = {
            rid: {} for rid in resource_ids
        }
        cooccurring_resources_list: list[str] = []

        if "cooccurrence_fractions" in feature_groups:
            er = event_resource.select(["_eventId", "_objId"])

            participants_per_event = (
                er
                .group_by("_eventId")
                .agg(pl.len().alias("n_participants"))
            )

            cooc_fractions_df = (
                er
                .join(er, on="_eventId", suffix="_other")
                .join(participants_per_event, on="_eventId", how="left")
                .with_columns((pl.lit(1.0) / pl.col("n_participants")).alias("credit"))
                .group_by(["_objId", "_objId_other"])
                .agg(pl.col("credit").sum().alias("credit_sum"))
                .join(totals, on="_objId", how="left")
                .with_columns((pl.col("credit_sum") / pl.col("total")).alias("fraction"))
                .select(["_objId", "_objId_other", "fraction"])
            )
            for row in cooc_fractions_df.iter_rows(named=True):
                cooccurrence_by_resource[row["_objId"]][row["_objId_other"]] = row["fraction"]

            cooccurring_resources_list = sorted(resource_ids)

        # ── Object collaboration fractions ─────────────────────────────────────
        # For resource R1: fraction of R1's distinct business objects (non-resource
        # objects it touched via any event) that resource R2 also touched at any point.
        object_collaboration_by_resource: dict[str, dict[str, float]] = {
            rid: {} for rid in resource_ids
        }
        collaborating_resources_list: list[str] = []

        # ── Shared business-object data (used by collab + portfolio) ──────────────
        need_bizobj = any(g in feature_groups for g in [
            "object_collaboration_fractions",
            "object_portfolio_fractions",
        ])
        resource_bizobj = None
        bizobj_type_map: dict[str, str] = {}  # bizobj_id → object type name

        if need_bizobj:
            event_all_obj = (
                ocel.events
                .select(["_eventId", "_objects"])
                .explode("_objects")
                .rename({"_objects": "_objId"})
            )
            event_bizobj = event_all_obj.filter(
                ~pl.col("_objId").is_in(resource_ids)
            )
            if business_object_types is not None:
                allowed_biz_ids: set[str] = set()
                for biz_type in business_object_types:
                    for obj_id in ocel.get_object_ids_by_type(biz_type):
                        allowed_biz_ids.add(obj_id)
                        bizobj_type_map[obj_id] = biz_type
                event_bizobj = event_bizobj.filter(
                    pl.col("_objId").is_in(allowed_biz_ids)
                )
            else:
                for obj_type in ocel.object_types:
                    if obj_type not in set(resource_types or []):
                        for obj_id in ocel.get_object_ids_by_type(obj_type):
                            bizobj_type_map[obj_id] = obj_type

            resource_bizobj = (
                event_resource.select(["_eventId", "_objId"])
                .rename({"_objId": "_resourceId"})
                .join(event_bizobj.rename({"_objId": "_bizObjId"}), on="_eventId")
                .select(["_resourceId", "_bizObjId"])
                .unique()
            )

        if "object_collaboration_fractions" in feature_groups and resource_bizobj is not None:
            # Option B formulation: for each object O that R1 touched, split credit
            # 1/|workers(O)| equally among all resources that also touched O,
            # then average over all of R1's objects.
            #
            # Semantic: pick a random object from R1's portfolio, then pick a random
            # worker of that object — the probability of landing on R2.  Row sums
            # to 1.0 (simplex), Hellinger directly applicable.  Rare exclusively-shared
            # objects contribute more credit than commonly-shared ones (IDF weighting).
            workers_per_obj = (
                resource_bizobj
                .group_by("_bizObjId")
                .agg(pl.len().alias("n_workers"))
            )

            totals_bizobj = (
                resource_bizobj
                .group_by("_resourceId")
                .agg(pl.len().alias("total_bizobj"))
            )

            collab_fractions_df = (
                resource_bizobj.rename({"_resourceId": "_r1"})
                .join(resource_bizobj.rename({"_resourceId": "_r2"}), on="_bizObjId")
                .join(workers_per_obj, on="_bizObjId", how="left")
                .with_columns((pl.lit(1.0) / pl.col("n_workers")).alias("credit"))
                .group_by(["_r1", "_r2"])
                .agg(pl.col("credit").sum().alias("credit_sum"))
                .join(
                    totals_bizobj.rename({"_resourceId": "_r1", "total_bizobj": "total"}),
                    on="_r1", how="left",
                )
                .with_columns((pl.col("credit_sum") / pl.col("total")).alias("fraction"))
                .select(["_r1", "_r2", "fraction"])
            )

            for row in collab_fractions_df.iter_rows(named=True):
                object_collaboration_by_resource[row["_r1"]][row["_r2"]] = row["fraction"]

            collaborating_resources_list = sorted(resource_ids)

        # ── Time fractions ─────────────────────────────────────────────────────
        # Divide the day into 24 hourly bins.  For each resource, count how many
        # of its events fall into each hour, then normalise by the resource's
        # total event count so each row sums to 1.0.
        time_fractions_by_resource: dict[str, dict[int, float]] = {
            rid: {} for rid in resource_ids
        }
        time_bins_list: list[int] = []

        if "time_fractions" in feature_groups:
            # Derive hour from the Unix timestamp (seconds since epoch).
            event_resource_with_hour = (
                event_resource
                .with_columns(
                    pl.from_epoch(pl.col("_timestampUnix"), time_unit="s")
                    .dt.hour()
                    .alias("_hour")
                )
                .select(["_objId", "_hour"])
            )

            hour_counts = (
                event_resource_with_hour
                .group_by(["_objId", "_hour"])
                .agg(pl.len().alias("count"))
            )

            time_fractions_df = (
                hour_counts
                .join(totals, on="_objId", how="left")
                .with_columns(
                    (pl.col("count") / pl.col("total")).alias("fraction")
                )
                .select(["_objId", "_hour", "fraction"])
            )

            for row in time_fractions_df.iter_rows(named=True):
                time_fractions_by_resource[row["_objId"]][int(row["_hour"])] = row["fraction"]

            time_bins_list = list(range(24))

        # ── Weekday fractions ──────────────────────────────────────────────────
        # 7 bins: 0=Monday … 6=Sunday (ISO weekday - 1).
        # For each resource count events per weekday, normalise by total events.
        weekday_fractions_by_resource: dict[str, dict[int, float]] = {
            rid: {} for rid in resource_ids
        }
        weekday_bins_list: list[int] = []

        if "weekday_fractions" in feature_groups:
            event_resource_with_weekday = (
                event_resource
                .with_columns(
                    (pl.from_epoch(pl.col("_timestampUnix"), time_unit="s")
                     .dt.weekday() - 1)
                    .alias("_weekday")   # 0=Mon … 6=Sun
                )
                .select(["_objId", "_weekday"])
            )

            weekday_counts = (
                event_resource_with_weekday
                .group_by(["_objId", "_weekday"])
                .agg(pl.len().alias("count"))
            )

            weekday_fractions_df = (
                weekday_counts
                .join(totals, on="_objId", how="left")
                .with_columns(
                    (pl.col("count") / pl.col("total")).alias("fraction")
                )
                .select(["_objId", "_weekday", "fraction"])
            )

            for row in weekday_fractions_df.iter_rows(named=True):
                weekday_fractions_by_resource[row["_objId"]][int(row["_weekday"])] = row["fraction"]

            weekday_bins_list = list(range(7))

        # ── Object portfolio fractions ─────────────────────────────────────────
        # Resource × ObjectType matrix: for each resource, what fraction of its
        # distinct business objects belong to each object type?  Row sums to 1.0
        # (simplex over types), so Hellinger distance applies directly.
        object_portfolio_by_resource: dict[str, dict[str, float]] = {
            rid: {} for rid in resource_ids
        }
        portfolio_object_types_list: list[str] = []

        if "object_portfolio_fractions" in feature_groups and resource_bizobj is not None and bizobj_type_map:
            biz_type_df = pl.DataFrame({
                "_bizObjId": list(bizobj_type_map.keys()),
                "_bizType":  list(bizobj_type_map.values()),
            })

            # (resource, type) counts of distinct business objects
            type_counts = (
                resource_bizobj
                .join(biz_type_df, on="_bizObjId", how="left")
                .filter(pl.col("_bizType").is_not_null())
                .group_by(["_resourceId", "_bizType"])
                .agg(pl.len().alias("count"))
            )

            # total distinct business objects per resource (denominator)
            resource_biz_totals = (
                resource_bizobj
                .join(biz_type_df, on="_bizObjId", how="left")
                .filter(pl.col("_bizType").is_not_null())
                .group_by("_resourceId")
                .agg(pl.len().alias("total"))
            )

            portfolio_fractions_df = (
                type_counts
                .join(resource_biz_totals, on="_resourceId", how="left")
                .with_columns((pl.col("count") / pl.col("total")).alias("fraction"))
                .select(["_resourceId", "_bizType", "fraction"])
            )

            for row in portfolio_fractions_df.iter_rows(named=True):
                object_portfolio_by_resource[row["_resourceId"]][row["_bizType"]] = row["fraction"]

            portfolio_object_types_list = sorted(set(bizobj_type_map.values()))

        # ── Assemble profiles ──────────────────────────────────────────────────
        profiles = [
            ResourceProfile(
                resource_id=rid,
                object_type=resource_object_types[rid],
                activity_fractions=activity_fractions_by_resource[rid],
                cooccurrence_fractions=cooccurrence_by_resource[rid],
                object_collaboration_fractions=object_collaboration_by_resource[rid],
                time_fractions=time_fractions_by_resource[rid],
                weekday_fractions=weekday_fractions_by_resource[rid],
                object_portfolio_fractions=object_portfolio_by_resource[rid],
            )
            for rid in sorted(resource_ids)
        ]

        return cls(
            profiles,
            all_activities,
            cooccurring_resources=cooccurring_resources_list or None,
            collaborating_resources=collaborating_resources_list or None,
            time_bins=time_bins_list or None,
            weekday_bins=weekday_bins_list or None,
            portfolio_object_types=portfolio_object_types_list or None,
        )

    # ── matrix operations ─────────────────────────────────────────────────────

    def to_numpy(self) -> np.ndarray:
        """Feature matrix, shape (n_resources, n_features)."""
        return np.array([
            p.feature_vector(
                self.activities,
                self.cooccurring_resources if self.cooccurring_resources else None,
                self.collaborating_resources if self.collaborating_resources else None,
                self.time_bins if self.time_bins else None,
                self.weekday_bins if self.weekday_bins else None,
                self.portfolio_object_types if self.portfolio_object_types else None,
            )
            for p in self.profiles
        ])

    def combined_distance_matrix(
        self,
        weights: dict[str, float] | None = None,
        distance_metric: str = "euclidean",
    ) -> np.ndarray:
        """
        Weighted sum of per-group distance matrices.

        For simplex groups (rows sum to 1) the metric can be either Euclidean
        (normalised by sqrt(2)) or Hellinger (H = euclidean(sqrt(P), sqrt(Q)) / sqrt(2)),
        selected via ``distance_metric``.  Non-simplex groups (cooccurrence,
        collaboration) always use Euclidean normalised by sqrt(n_resources).

        Parameters
        ----------
        weights : dict[str, float] | None
            Mapping from feature-group name → non-negative weight (default 1.0).
        distance_metric : str
            ``"euclidean"`` (default) or ``"hellinger"``.

        Returns
        -------
        D : np.ndarray, shape (n_resources, n_resources)
        """
        from scipy.spatial.distance import cdist

        n = len(self.profiles)
        weights = weights or {}
        D = np.zeros((n, n))
        use_hellinger = distance_metric == "hellinger"

        def _euclidean(X: np.ndarray, max_dist: float) -> np.ndarray:
            d = cdist(X, X, metric="euclidean")
            return d / max_dist if max_dist > 0 else d

        def _simplex_dist(X: np.ndarray) -> np.ndarray:
            """Hellinger or Euclidean for simplex rows (theoretical max sqrt(2))."""
            if use_hellinger:
                d = cdist(np.sqrt(X), np.sqrt(X), metric="euclidean")
                return d / np.sqrt(2)
            return _euclidean(X, np.sqrt(2))

        total_weight = 0.0

        if self.activities:
            w = weights.get("activity_fractions", 1.0)
            if w > 0:
                X = np.array([p.feature_vector(self.activities) for p in self.profiles])
                D += w * _simplex_dist(X)
                total_weight += w

        if self.cooccurring_resources:
            w = weights.get("cooccurrence_fractions", 1.0)
            if w > 0:
                X = np.array([
                    [p.cooccurrence_fractions.get(r, 0.0) for r in self.cooccurring_resources]
                    for p in self.profiles
                ])
                # Rows sum to 1.0 (Option B) → use simplex distance.
                D += w * _simplex_dist(X)
                total_weight += w

        if self.collaborating_resources:
            w = weights.get("object_collaboration_fractions", 1.0)
            if w > 0:
                X = np.array([
                    [p.object_collaboration_fractions.get(r, 0.0) for r in self.collaborating_resources]
                    for p in self.profiles
                ])
                # Rows sum to 1.0 (Option B) → use simplex distance.
                D += w * _simplex_dist(X)
                total_weight += w

        if self.time_bins:
            w = weights.get("time_fractions", 1.0)
            if w > 0:
                X = np.array([
                    [p.time_fractions.get(h, 0.0) for h in self.time_bins]
                    for p in self.profiles
                ])
                D += w * _simplex_dist(X)
                total_weight += w

        if self.weekday_bins:
            w = weights.get("weekday_fractions", 1.0)
            if w > 0:
                X = np.array([
                    [p.weekday_fractions.get(d, 0.0) for d in self.weekday_bins]
                    for p in self.profiles
                ])
                D += w * _simplex_dist(X)
                total_weight += w

        if self.portfolio_object_types:
            w = weights.get("object_portfolio_fractions", 1.0)
            if w > 0:
                X = np.array([
                    [p.object_portfolio_fractions.get(t, 0.0) for t in self.portfolio_object_types]
                    for p in self.profiles
                ])
                D += w * _simplex_dist(X)
                total_weight += w

        # Divide by total weight → D ∈ [0, 1] regardless of how many groups
        # are active or what weights are used.  0 = identical profiles,
        # 1 = maximally different in every active group simultaneously.
        if total_weight > 0:
            D /= total_weight

        return D

    def cluster(
        self,
        n_clusters: int = 3,
        method: Literal["kmeans", "agglomerative", "hdbscan"] = "hdbscan",
        min_cluster_size: int = 2,
        precomputed_D: np.ndarray | None = None,
    ) -> list[int]:
        """
        Cluster resources by profile similarity.
        Returns a label per resource in the same order as self.profiles.
        For HDBSCAN, noise points receive label -1.

        Parameters
        ----------
        precomputed_D : np.ndarray | None
            Pre-computed distance matrix (from ``combined_distance_matrix``).
            Ignored for K-Means, which always uses the raw feature vector.
            When provided, agglomerative uses average linkage (ward requires
            Euclidean and cannot be used with precomputed distances).
        """
        from sklearn.cluster import KMeans, AgglomerativeClustering, HDBSCAN

        if method == "kmeans":
            # K-Means does not support precomputed distances; always use features.
            X = self.to_numpy()
            labels = KMeans(n_clusters=n_clusters, random_state=0, n_init="auto").fit_predict(X)
        elif method == "agglomerative":
            if precomputed_D is not None:
                labels = AgglomerativeClustering(
                    n_clusters=n_clusters, metric="precomputed", linkage="average",
                ).fit_predict(precomputed_D)
            else:
                labels = AgglomerativeClustering(n_clusters=n_clusters).fit_predict(self.to_numpy())
        elif method == "hdbscan":
            if precomputed_D is not None:
                labels = HDBSCAN(
                    min_cluster_size=min_cluster_size, metric="precomputed",
                ).fit_predict(precomputed_D)
            else:
                labels = HDBSCAN(
                    min_cluster_size=min_cluster_size, metric="euclidean",
                ).fit_predict(self.to_numpy())
        else:
            raise ValueError(f"Unknown method: {method!r}.")
        return labels.tolist()

    def mds_2d(
        self,
        width: int,
        height: int,
        pad: int = 38,
        precomputed_D: np.ndarray | None = None,
    ) -> tuple[list[dict[str, float]], float, float, float]:
        """
        Project resources to 2D using SMACOF MDS, then scale uniformly to fit
        the canvas so no axis distortion is introduced.

        Parameters
        ----------
        width, height : int
            Canvas dimensions in pixels.
        pad : int
            Padding around the point cloud (default 38 = NODE_R 8 + 30).
        precomputed_D : np.ndarray | None
            Pre-computed distance matrix.  When provided the MDS runs with
            ``dissimilarity="precomputed"`` and deduplication is done by
            extracting unique rows of D (rows with identical distance profiles).

        Returns
        -------
        positions         : list of {x, y} dicts, one per resource in self.profiles order.
        stress            : normalised stress-1 ∈ [0, 1] (0 = perfect embedding).
        explained_variance: fraction of total variance captured by the 2D projection ∈ [0, 1].
        scale             : pixels per distance unit on the canvas.
        """
        from sklearn.manifold import MDS

        n = len(self.profiles)
        center = {"x": float(width / 2), "y": float(height / 2)}

        if n == 0:
            return [], 0.0, 1.0, 1.0
        if n == 1:
            return [center], 0.0, 1.0, 1.0

        # ── Choose dissimilarity matrix and deduplication index ───────────────
        if precomputed_D is not None:
            # Deduplicate by finding unique rows in D.
            # np.unique works on 2-D arrays row-wise when axis=0.
            D_unique, inverse = np.unique(precomputed_D, axis=0, return_inverse=True)
            # D_unique rows may differ from D columns; extract the matching columns.
            unique_idx = np.array([np.where((precomputed_D == row).all(axis=1))[0][0]
                                   for row in D_unique])
            D_fit = D_unique[:, unique_idx]   # square sub-matrix for unique resources
            dissimilarity = "precomputed"
            D2_for_ev = D_fit ** 2
        else:
            X = self.to_numpy()
            X_unique, inverse = np.unique(X, axis=0, return_inverse=True)
            D_fit = X_unique
            dissimilarity = "euclidean"
            norms = np.einsum("ij,ij->i", X_unique, X_unique)
            D2_for_ev = np.maximum(
                norms[:, None] + norms[None, :] - 2.0 * (X_unique @ X_unique.T), 0.0
            )

        m = D_fit.shape[0]
        if m == 1:
            return [center] * n, 0.0, 1.0, 1.0

        mds = MDS(
            n_components=2,
            random_state=0,
            normalized_stress=True,
            n_init=1,
            dissimilarity=dissimilarity,
        )
        coords = mds.fit_transform(D_fit)
        stress = float(mds.stress_)

        # ── Explained variance from eigenvalue spectrum of double-centred D² ──
        row_means = D2_for_ev.mean(axis=1, keepdims=True)
        B = -0.5 * (D2_for_ev - row_means - row_means.T + D2_for_ev.mean())
        eigenvalues = np.linalg.eigvalsh(B)
        pos_eigs = np.maximum(eigenvalues, 0.0)
        total = pos_eigs.sum()
        explained_variance = float(pos_eigs[-2:].sum() / total) if total > 0.0 else 1.0

        # ── Uniform scaling ───────────────────────────────────────────────────
        min_x, max_x = float(coords[:, 0].min()), float(coords[:, 0].max())
        min_y, max_y = float(coords[:, 1].min()), float(coords[:, 1].max())
        range_x = max_x - min_x or 1.0
        range_y = max_y - min_y or 1.0
        scale = min((width - 2 * pad) / range_x, (height - 2 * pad) / range_y)
        mid_x = (min_x + max_x) / 2
        mid_y = (min_y + max_y) / 2

        pixel_coords = np.column_stack([
            width  / 2 + (coords[:, 0] - mid_x) * scale,
            height / 2 + (coords[:, 1] - mid_y) * scale,
        ])

        positions = [
            {"x": float(pixel_coords[inverse[i], 0]), "y": float(pixel_coords[inverse[i], 1])}
            for i in range(n)
        ]
        return positions, stress, explained_variance, float(scale)

    def _type_n_summaries(self, cluster_labels: list[int] | None = None) -> dict:
        """
        Pre-compute the n/m tooltip values for co-occurrence and collaboration.

        For each resource R and each resource type T:
          n  = 1 (self, if R is of type T) + count of resources r of type T
               where r ≠ R and the relevant fraction > 0
          m  = total resources of type T  (returned once in "type_totals")

        For clusters the same logic is applied per member and the n values are
        averaged across members, matching the frontend tooltip semantics exactly.

        Returns a dict with:
          "type_totals"  : {type: m}
          "cooc_type_n"  : {resource_id | "Cluster N": {type: n}}  (if cooc present)
          "collab_type_n": {resource_id | "Cluster N": {type: n}}  (if collab present)
        """
        from collections import Counter

        rot = self.resource_object_types          # {resource_id: type}
        type_totals: dict[str, int] = dict(Counter(rot.values()))
        result: dict = {"type_totals": type_totals}

        groups: list[tuple[str, str]] = []
        if self.cooccurring_resources:
            groups.append(("cooc_type_n", "cooccurrence_fractions"))
        if self.collaborating_resources:
            groups.append(("collab_type_n", "object_collaboration_fractions"))

        for key, attr in groups:
            n_map: dict[str, dict[str, float]] = {}

            # ── individual resources ──────────────────────────────────────────
            for profile in self.profiles:
                rid = profile.resource_id
                fractions: dict[str, float] = getattr(profile, attr)
                counts: dict[str, float] = {t: 0.0 for t in type_totals}
                counts[profile.object_type] += 1.0          # self always counts
                for other_id, val in fractions.items():
                    if other_id != rid and val > 0:
                        other_type = rot.get(other_id)
                        if other_type:
                            counts[other_type] += 1.0
                n_map[rid] = counts

            # ── clusters ─────────────────────────────────────────────────────
            if cluster_labels is not None:
                for label in sorted(set(cluster_labels) - {-1}):
                    members = [
                        self.profiles[i]
                        for i, lbl in enumerate(cluster_labels)
                        if lbl == label
                    ]
                    totals: dict[str, float] = {t: 0.0 for t in type_totals}
                    for member in members:
                        fractions = getattr(member, attr)
                        totals[member.object_type] += 1.0   # self
                        for other_id, val in fractions.items():
                            if other_id != member.resource_id and val > 0:
                                other_type = rot.get(other_id)
                                if other_type:
                                    totals[other_type] += 1.0
                    n_map[f"Cluster {label + 1}"] = {
                        t: v / len(members) for t, v in totals.items()
                    }

            result[key] = n_map

        # ── Tooltip profiles ──────────────────────────────────────────────────
        # Compact per-resource (and per-cluster average) profile containing only
        # the "display" feature groups: activities, time, weekday, portfolio.
        # Co-occurrence and collaboration are intentionally excluded — their
        # type-level n/m summary (cooc_type_n / collab_type_n) is sufficient
        # for the tooltip without needing per-resource values.
        def _avg(members: list, attr: str, keys: list) -> list[float]:
            return [
                sum(getattr(m, attr).get(k, 0.0) for m in members) / len(members)
                for k in keys
            ]

        all_keys: list[tuple[str, str, list]] = []
        if self.activities:
            all_keys.append(("activities", "activity_fractions", self.activities))
        if self.time_bins:
            all_keys.append(("time", "time_fractions", self.time_bins))
        if self.weekday_bins:
            all_keys.append(("weekday", "weekday_fractions", self.weekday_bins))
        if self.portfolio_object_types:
            all_keys.append(("portfolio", "object_portfolio_fractions", self.portfolio_object_types))

        if all_keys:
            tooltip_profiles: dict[str, dict[str, list[float]]] = {}
            for profile in self.profiles:
                tooltip_profiles[profile.resource_id] = {
                    label: [getattr(profile, attr).get(k, 0.0) for k in keys]
                    for label, attr, keys in all_keys
                }
            if cluster_labels is not None:
                for lbl in sorted(set(cluster_labels) - {-1}):
                    members = [
                        self.profiles[i]
                        for i, cl in enumerate(cluster_labels)
                        if cl == lbl
                    ]
                    tooltip_profiles[f"Cluster {lbl + 1}"] = {
                        label: _avg(members, attr, keys)
                        for label, attr, keys in all_keys
                    }
            result["tooltip_profiles"] = tooltip_profiles

        return result

    def to_dict(
        self,
        width: int | None = None,
        height: int | None = None,
        n_clusters: int = 3,
        cluster_method: Literal["kmeans", "agglomerative", "hdbscan"] = "kmeans",
        compute_clusters: bool = True,
        min_cluster_size: int = 2,
        group_weights: dict[str, float] | None = None,
        distance_metric: str = "euclidean",
    ) -> dict:
        """
        Serialisable representation for the API response.

        When multiple feature groups are active, a combined precomputed distance
        matrix (weighted, per-group-normalised) is used for MDS and clustering
        (except K-Means, which always uses raw features).
        ``group_weights`` maps feature-group name → weight (default 1.0 each).
        ``distance_metric`` is ``"euclidean"`` (default) or ``"hellinger"``.
        """
        result: dict = {
            "resources": self.resources,
            "activities": self.activities,
            "values": self.to_numpy().tolist(),
            "resource_object_types": self.resource_object_types,
            "feature_groups": self.feature_groups,
        }
        if self.cooccurring_resources:
            result["cooccurring_resources"] = self.cooccurring_resources
        if self.collaborating_resources:
            result["collaborating_resources"] = self.collaborating_resources
        if self.time_bins:
            result["time_bins"] = self.time_bins
        if self.weekday_bins:
            result["weekday_bins"] = self.weekday_bins
        if self.portfolio_object_types:
            result["portfolio_object_types"] = self.portfolio_object_types
        # Always use the precomputed distance matrix so the scale is consistent
        # across all configurations (single group, multi-group, any weights).
        # D ∈ [0, 1]: 0 = identical profiles, 1 = maximally different in all groups.
        precomputed_D = self.combined_distance_matrix(group_weights, distance_metric)

        # ── Clustering ────────────────────────────────────────────────────────
        cluster_labels_out: list[int] | None = None
        if compute_clusters:
            n = len(self.profiles)
            if n < 2:
                labels = [-1] * n if cluster_method == "hdbscan" else [0] * n
                k = 0 if cluster_method == "hdbscan" else 1
            else:
                eff_k = min(n_clusters, n)
                labels = self.cluster(
                    n_clusters=eff_k,
                    method=cluster_method,
                    min_cluster_size=min_cluster_size,
                    precomputed_D=precomputed_D.copy(),
                )
                k = len(set(labels) - {-1}) if cluster_method == "hdbscan" else eff_k
            result["cluster_labels"] = labels
            result["n_clusters"] = k
            cluster_labels_out = labels

        # ── Type n/m summaries for tooltips ───────────────────────────────────
        result.update(self._type_n_summaries(cluster_labels=cluster_labels_out))

        # ── MDS ───────────────────────────────────────────────────────────────
        if width is not None and height is not None:
            positions, stress, explained_variance, mds_scale = self.mds_2d(
                width, height, precomputed_D=precomputed_D,
            )
            result["mds_positions"] = positions
            result["mds_stress"] = stress
            result["mds_explained_variance"] = explained_variance
            result["mds_scale"] = mds_scale
        return result
