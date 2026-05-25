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
    Additional feature groups are added as new fields without changing the rest
    of the system.
    """

    resource_id: str
    object_type: str
    activity_fractions: dict[str, float] = field(default_factory=dict)
    cooccurrence_fractions: dict[str, float] = field(default_factory=dict)
    object_collaboration_fractions: dict[str, float] = field(default_factory=dict)

    def feature_vector(
        self,
        activities: list[str],
        cooccurring_resources: list[str] | None = None,
        collaborating_resources: list[str] | None = None,
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
        """
        vec = [self.activity_fractions.get(a, 0.0) for a in activities]
        if cooccurring_resources:
            vec += [self.cooccurrence_fractions.get(r, 0.0) for r in cooccurring_resources]
        if collaborating_resources:
            vec += [self.object_collaboration_fractions.get(r, 0.0) for r in collaborating_resources]
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
    ) -> None:
        self.profiles = profiles
        self.activities = activities
        self.cooccurring_resources: list[str] = cooccurring_resources or []
        self.collaborating_resources: list[str] = collaborating_resources or []

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
        return groups

    # ── construction ──────────────────────────────────────────────────────────

    @classmethod
    def from_ocel(
        cls,
        ocel: OCEL,
        resource_types: List[str] | None = None,
        feature_groups: List[str] | None = None,
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
            "object_collaboration_fractions".
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
            .select(["_eventId", "_activity", "_objects"])
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
        # For resource R1: fraction of R1's events in which resource R2 also appears.
        cooccurrence_by_resource: dict[str, dict[str, float]] = {
            rid: {} for rid in resource_ids
        }
        cooccurring_resources_list: list[str] = []

        if "cooccurrence_fractions" in feature_groups:
            er = event_resource.select(["_eventId", "_objId"])

            cooc_counts = (
                er
                .join(er, on="_eventId", suffix="_other")
                .filter(pl.col("_objId") != pl.col("_objId_other"))
                .group_by(["_objId", "_objId_other"])
                .agg(pl.len().alias("cooc_count"))
            )
            cooc_fractions_df = (
                cooc_counts
                .join(totals, on="_objId", how="left")
                .with_columns(
                    (pl.col("cooc_count") / pl.col("total")).alias("fraction")
                )
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

        if "object_collaboration_fractions" in feature_groups:
            # All (event, object) pairs — including non-resource objects
            event_all_obj = (
                ocel.events
                .select(["_eventId", "_objects"])
                .explode("_objects")
                .rename({"_objects": "_objId"})
            )
            # Business objects only (exclude resources)
            event_bizobj = event_all_obj.filter(
                ~pl.col("_objId").is_in(resource_ids)
            )

            # (resource, business_object) pairs — one per pair regardless of event count
            resource_bizobj = (
                event_resource.select(["_eventId", "_objId"])
                .rename({"_objId": "_resourceId"})
                .join(event_bizobj.rename({"_objId": "_bizObjId"}), on="_eventId")
                .select(["_resourceId", "_bizObjId"])
                .unique()
            )

            # Total distinct business objects per resource (denominator)
            totals_bizobj = (
                resource_bizobj
                .group_by("_resourceId")
                .agg(pl.len().alias("total_bizobj"))
            )

            # Resource pairs that share at least one business object
            shared_bizobj = (
                resource_bizobj.rename({"_resourceId": "_r1"})
                .join(resource_bizobj.rename({"_resourceId": "_r2"}), on="_bizObjId")
                .filter(pl.col("_r1") != pl.col("_r2"))
                .group_by(["_r1", "_r2"])
                .agg(pl.len().alias("shared_count"))
            )

            collab_fractions_df = (
                shared_bizobj
                .join(
                    totals_bizobj.rename({"_resourceId": "_r1", "total_bizobj": "total"}),
                    on="_r1", how="left",
                )
                .with_columns(
                    (pl.col("shared_count") / pl.col("total")).alias("fraction")
                )
                .select(["_r1", "_r2", "fraction"])
            )

            for row in collab_fractions_df.iter_rows(named=True):
                object_collaboration_by_resource[row["_r1"]][row["_r2"]] = row["fraction"]

            collaborating_resources_list = sorted(resource_ids)

        # ── Assemble profiles ──────────────────────────────────────────────────
        profiles = [
            ResourceProfile(
                resource_id=rid,
                object_type=resource_object_types[rid],
                activity_fractions=activity_fractions_by_resource[rid],
                cooccurrence_fractions=cooccurrence_by_resource[rid],
                object_collaboration_fractions=object_collaboration_by_resource[rid],
            )
            for rid in sorted(resource_ids)
        ]

        return cls(
            profiles,
            all_activities,
            cooccurring_resources=cooccurring_resources_list or None,
            collaborating_resources=collaborating_resources_list or None,
        )

    # ── matrix operations ─────────────────────────────────────────────────────

    def to_numpy(self) -> np.ndarray:
        """Feature matrix, shape (n_resources, n_features)."""
        return np.array([
            p.feature_vector(
                self.activities,
                self.cooccurring_resources if self.cooccurring_resources else None,
                self.collaborating_resources if self.collaborating_resources else None,
            )
            for p in self.profiles
        ])

    def combined_distance_matrix(
        self,
        weights: dict[str, float] | None = None,
    ) -> np.ndarray:
        """
        Weighted sum of per-group distance matrices.

        Each group's distance matrix is normalised by the **theoretical maximum**
        L2 distance for that group's feature space before weighting:

        - activity_fractions            → sqrt(2)          (two simplex vectors
                                                             with disjoint support)
        - cooccurrence_fractions        → sqrt(n_resources) (independent [0,1] dims)
        - object_collaboration_fractions → sqrt(n_resources)

        Using the theoretical maximum (rather than the observed maximum) equalises
        the scale across groups without erasing how much each group actually varies
        in this dataset.  It also keeps distances on an absolute, cross-plot-
        comparable scale: a combined distance of 0.5 with equal weights means
        "halfway to the most-different-possible pair" in each group.

        Parameters
        ----------
        weights : dict[str, float] | None
            Mapping from feature-group name to non-negative weight.
            Missing groups default to 1.0.  Pass ``{"activity_fractions": 1.0,
            "cooccurrence_fractions": 0.5}`` to halve co-occurrence's influence.

        Returns
        -------
        D : np.ndarray, shape (n_resources, n_resources)
            Symmetric distance matrix ready for ``dissimilarity="precomputed"``
            in sklearn's MDS, AgglomerativeClustering, and HDBSCAN.
        """
        from scipy.spatial.distance import cdist

        n = len(self.profiles)
        weights = weights or {}
        D = np.zeros((n, n))

        def _norm_dist(X: np.ndarray, theoretical_max: float) -> np.ndarray:
            """Euclidean distance matrix normalised by the theoretical maximum."""
            d = cdist(X, X, metric="euclidean")
            return d / theoretical_max if theoretical_max > 0 else d

        total_weight = 0.0

        if self.activities:
            w = weights.get("activity_fractions", 1.0)
            if w > 0:
                X = np.array([p.feature_vector(self.activities) for p in self.profiles])
                # Max L2 between two probability vectors: sqrt(2)
                D += w * _norm_dist(X, np.sqrt(2))
                total_weight += w

        if self.cooccurring_resources:
            w = weights.get("cooccurrence_fractions", 1.0)
            if w > 0:
                X = np.array([
                    [p.cooccurrence_fractions.get(r, 0.0) for r in self.cooccurring_resources]
                    for p in self.profiles
                ])
                # Max L2 between two [0,1]^k vectors: sqrt(k)
                D += w * _norm_dist(X, np.sqrt(len(self.cooccurring_resources)))
                total_weight += w

        if self.collaborating_resources:
            w = weights.get("object_collaboration_fractions", 1.0)
            if w > 0:
                X = np.array([
                    [p.object_collaboration_fractions.get(r, 0.0) for r in self.collaborating_resources]
                    for p in self.profiles
                ])
                D += w * _norm_dist(X, np.sqrt(len(self.collaborating_resources)))
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
        method: Literal["kmeans", "agglomerative", "hdbscan"] = "agglomerative",
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

    def to_dict(
        self,
        width: int | None = None,
        height: int | None = None,
        n_clusters: int = 3,
        cluster_method: Literal["kmeans", "agglomerative", "hdbscan"] = "kmeans",
        compute_clusters: bool = True,
        min_cluster_size: int = 2,
        group_weights: dict[str, float] | None = None,
    ) -> dict:
        """
        Serialisable representation for the API response.

        When multiple feature groups are active, a combined precomputed distance
        matrix (weighted, per-group-normalised) is used for MDS and clustering
        (except K-Means, which always uses raw features).
        ``group_weights`` maps feature-group name → weight (default 1.0 each).
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

        # Always use the precomputed distance matrix so the scale is consistent
        # across all configurations (single group, multi-group, any weights).
        # D ∈ [0, 1]: 0 = identical profiles, 1 = maximally different in all groups.
        precomputed_D = self.combined_distance_matrix(group_weights)

        # ── Clustering ────────────────────────────────────────────────────────
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
