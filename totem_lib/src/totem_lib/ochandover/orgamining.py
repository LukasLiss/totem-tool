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
        method: Literal["kmeans", "agglomerative"] = "kmeans",
    ) -> list[int]:
        """
        Cluster resources by profile similarity.
        Returns a label per resource in the same order as self.profiles.
        """
        from sklearn.cluster import KMeans, AgglomerativeClustering
        X = self.to_numpy()
        if method == "kmeans":
            labels = KMeans(n_clusters=n_clusters, random_state=0, n_init="auto").fit_predict(X)
        elif method == "agglomerative":
            labels = AgglomerativeClustering(n_clusters=n_clusters).fit_predict(X)
        else:
            raise ValueError(f"Unknown method: {method!r}. Use 'kmeans' or 'agglomerative'.")
        return labels.tolist()

    def to_dict(self) -> dict:
        """Serialisable representation — matches the existing API response shape."""
        return {
            "resources": self.resources,
            "activities": self.activities,
            "values": self.to_numpy().tolist(),
            "resource_object_types": self.resource_object_types,
        }
