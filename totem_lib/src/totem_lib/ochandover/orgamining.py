from __future__ import annotations

from dataclasses import dataclass
from typing import List, Literal

import polars as pl
import numpy as np
from totem_lib import ObjectCentricEventLog as OCEL


@dataclass
class ResourceProfile:
    """
    All computed features for a single resource object.

    The base feature group is ``activity_fractions``: the fraction of this
    resource's events that carry each activity label.  Additional feature
    groups (co-occurrence counts, event-attribute means, …) are added as
    new fields without changing the interface of the rest of the system.
    """

    resource_id: str
    object_type: str
    activity_fractions: dict[str, float]

    def feature_vector(self, activities: list[str]) -> list[float]:
        """
        Ordered numeric vector used for distance computation, MDS, and clustering.

        Parameters
        ----------
        activities : list[str]
            The full ordered activity space defined by the ProfileMatrix this
            profile belongs to.  Activities absent from this profile get 0.
        """
        return [self.activity_fractions.get(a, 0.0) for a in activities]


class ProfileMatrix:
    """
    Collection of ResourceProfiles, one per resource.

    Provides the matrix view needed for similarity measurement, MDS projection,
    and clustering.  The feature space is defined by ``activities`` (and later
    by additional feature groups); ``to_numpy()`` assembles uniform feature
    vectors from every profile.
    """

    def __init__(
        self,
        profiles: list[ResourceProfile],
        activities: list[str],
    ) -> None:
        self.profiles = profiles
        self.activities = activities  # ordered feature space

    # ── convenience accessors ──────────────────────────────────────────────────

    @property
    def resources(self) -> list[str]:
        return [p.resource_id for p in self.profiles]

    @property
    def resource_object_types(self) -> dict[str, str]:
        return {p.resource_id: p.object_type for p in self.profiles}

    # ── construction ──────────────────────────────────────────────────────────

    @classmethod
    def from_ocel(
        cls,
        ocel: OCEL,
        resource_types: List[str] | None = None,
    ) -> "ProfileMatrix":
        """
        Build a ProfileMatrix from an OCEL.

        Parameters
        ----------
        ocel : OCEL
        resource_types : list[str] | None
            Object types treated as resources. Defaults to all object types.
        """
        if resource_types is None:
            resource_types = ocel.object_types

        resource_ids: set[str] = set()
        resource_object_types: dict[str, str] = {}
        for obj_type in resource_types:
            for obj_id in ocel.get_object_ids_by_type(obj_type):
                resource_ids.add(obj_id)
                resource_object_types[obj_id] = obj_type

        # ── activity fractions ─────────────────────────────────────────────
        event_resource_activity = (
            ocel.events
            .select(["_eventId", "_activity", "_objects"])
            .explode("_objects")
            .rename({"_objects": "_objId"})
            .filter(pl.col("_objId").is_in(resource_ids))
        )

        counts = (
            event_resource_activity
            .group_by(["_objId", "_activity"])
            .agg(pl.len().alias("count"))
        )

        totals = (
            event_resource_activity
            .group_by("_objId")
            .agg(pl.len().alias("total"))
        )

        fractions_df = (
            counts
            .join(totals, on="_objId", how="left")
            .with_columns(
                (pl.col("count") / pl.col("total")).alias("fraction")
            )
            .select(["_objId", "_activity", "fraction"])
        )

        # Build per-resource fraction dicts
        fractions_by_resource: dict[str, dict[str, float]] = {
            rid: {} for rid in resource_ids
        }
        for row in fractions_df.iter_rows(named=True):
            fractions_by_resource[row["_objId"]][row["_activity"]] = row["fraction"]

        all_activities = sorted({row["_activity"] for row in fractions_df.select("_activity").iter_rows(named=True)})

        profiles = [
            ResourceProfile(
                resource_id=rid,
                object_type=resource_object_types[rid],
                activity_fractions=fractions_by_resource[rid],
            )
            for rid in sorted(resource_ids)
        ]

        return cls(profiles, all_activities)

    # ── matrix operations ─────────────────────────────────────────────────────

    def to_numpy(self) -> np.ndarray:
        """Feature matrix, shape (n_resources, n_features)."""
        return np.array([p.feature_vector(self.activities) for p in self.profiles])

    def distance_matrix(
        self,
        metric: Literal["euclidean", "cosine", "manhattan"] = "euclidean",
    ) -> np.ndarray:
        """Pairwise distance matrix, shape (n_resources, n_resources)."""
        from scipy.spatial.distance import cdist
        X = self.to_numpy()
        return cdist(X, X, metric=metric)

    def cluster(
        self,
        n_clusters: int = 3,
        method: Literal["kmeans", "agglomerative", "hdbscan"] = "agglomerative",
        min_cluster_size: int = 2,
    ) -> list[int]:
        """
        Cluster resources by profile similarity.
        Returns a label per resource in the same order as self.profiles.
        For HDBSCAN, noise points receive label -1.
        """
        from sklearn.cluster import KMeans, AgglomerativeClustering, HDBSCAN
        X = self.to_numpy()
        if method == "kmeans":
            labels = KMeans(n_clusters=n_clusters, random_state=0, n_init="auto").fit_predict(X)
        elif method == "agglomerative":
            labels = AgglomerativeClustering(n_clusters=n_clusters).fit_predict(X)
        elif method == "hdbscan":
            labels = HDBSCAN(
                min_cluster_size=min_cluster_size,
                metric="euclidean",
            ).fit_predict(X)
        else:
            raise ValueError(f"Unknown method: {method!r}.")
        return labels.tolist()

    def mds_2d(
        self,
        width: int,
        height: int,
        pad: int = 38,
    ) -> tuple[list[dict[str, float]], float, float]:
        """
        Project resources to 2D using SMACOF MDS, then scale uniformly to fit
        the canvas so no axis distortion is introduced.

        Parameters
        ----------
        width, height : int
            Canvas dimensions in pixels.
        pad : int
            Padding around the point cloud (default 38 = NODE_R 8 + 30).

        Returns
        -------
        positions         : list of {x, y} dicts, one per resource in self.profiles order.
        stress            : normalised stress-1 ∈ [0, 1] (0 = perfect embedding).
        explained_variance: fraction of total variance captured by the 2D projection ∈ [0, 1].
        scale             : pixels per unit of Euclidean distance in the original feature space.
                            Multiply any distance d by this value to get the corresponding
                            pixel length on the canvas.
        """
        from sklearn.manifold import MDS

        X = self.to_numpy()
        n = len(self.profiles)

        if n == 0:
            return [], 0.0, 1.0, 1.0
        if n == 1:
            return [{"x": float(width / 2), "y": float(height / 2)}], 0.0, 1.0, 1.0

        # Deduplicate: MDS only needs to run on unique profiles; resources that
        # share a profile are guaranteed to land on the same point anyway.
        X_unique, inverse = np.unique(X, axis=0, return_inverse=True)
        m = len(X_unique)

        if m == 1:
            return [{"x": float(width / 2), "y": float(height / 2)}] * n, 0.0, 1.0, 1.0

        mds = MDS(
            n_components=2,
            random_state=0,
            normalized_stress=True,
            n_init=1,
        )
        coords = mds.fit_transform(X_unique)
        stress = float(mds.stress_)  # normalised stress-1 ∈ [0, 1]

        # ── Explained variance from eigenvalue spectrum of double-centred D² ──
        # Measures what fraction of the data's total variance the 2D projection
        # preserves — independent of the SMACOF result.
        norms = np.einsum("ij,ij->i", X_unique, X_unique)
        D2 = np.maximum(norms[:, None] + norms[None, :] - 2.0 * (X_unique @ X_unique.T), 0.0)
        row_means = D2.mean(axis=1, keepdims=True)
        B = -0.5 * (D2 - row_means - row_means.T + D2.mean())
        eigenvalues = np.linalg.eigvalsh(B)          # eigenvalues only — cheap
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

        # Map back to all resources via the deduplication inverse index
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
    ) -> dict:
        """
        Serialisable representation for the API response.
        When ``width`` and ``height`` are provided, MDS pixel positions and
        stress are included; otherwise only the matrix data is returned.
        ``n_clusters`` controls k-based clustering; ``compute_clusters=False`` skips it.
        For HDBSCAN the number of clusters is determined automatically; noise
        points receive label -1 and are excluded from ``n_clusters``.
        """
        result: dict = {
            "resources": self.resources,
            "activities": self.activities,
            "values": self.to_numpy().tolist(),
            "resource_object_types": self.resource_object_types,
        }

        # ── Clustering ────────────────────────────────────────────────────────
        if compute_clusters:
            n = len(self.profiles)
            if n < 2:
                # Trivial cases: single resource is noise for HDBSCAN, cluster-0 otherwise
                labels = [-1] * n if cluster_method == "hdbscan" else [0] * n
                k = 0 if cluster_method == "hdbscan" else 1
            else:
                eff_k = min(n_clusters, n)
                labels = self.cluster(
                    n_clusters=eff_k,
                    method=cluster_method,
                    min_cluster_size=min_cluster_size,
                )
                # For HDBSCAN, n_clusters = distinct real cluster labels (excluding -1)
                k = len(set(labels) - {-1}) if cluster_method == "hdbscan" else eff_k
            result["cluster_labels"] = labels   # one int per resource; -1 = noise (HDBSCAN only)
            result["n_clusters"] = k

        # ── MDS ───────────────────────────────────────────────────────────────
        if width is not None and height is not None:
            positions, stress, explained_variance, mds_scale = self.mds_2d(width, height)
            result["mds_positions"] = positions
            result["mds_stress"] = stress
            result["mds_explained_variance"] = explained_variance
            result["mds_scale"] = mds_scale   # pixels per Euclidean distance unit
        return result
