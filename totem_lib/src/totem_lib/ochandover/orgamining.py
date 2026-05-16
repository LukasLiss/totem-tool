from typing import List, Literal

import polars as pl
import numpy as np
from totem_lib import ObjectCentricEventLog as OCEL


class ResourceActivityMatrix:
    """
    Resource-Activity Matrix for organizational mining.

    Each cell (resource, activity) = fraction of all events performed by that resource
    that carry the given activity label.

    Rows are individual resource objects; columns are activity labels.
    The matrix is the basis for measuring similarity between resources and for clustering.
    """

    def __init__(self, matrix: pl.DataFrame, resources: list[str], activities: list[str]):
        # matrix: _objId column + one column per activity, values are fractions
        self.matrix = matrix
        self.resources = resources
        self.activities = activities

    @classmethod
    def from_ocel(
        cls,
        ocel: OCEL,
        resource_types: List[str] | None = None,
    ) -> "ResourceActivityMatrix":
        """
        Parameters
        ----------
        ocel : OCEL
        resource_types : list[str] | None
            Object types treated as resources. Defaults to all object types in the log.
        """
        if resource_types is None:
            resource_types = ocel.object_types

        resource_ids = set()
        for obj_type in resource_types:
            resource_ids.update(ocel.get_object_ids_by_type(obj_type))

        event_resource_activity = (
            ocel.events
            .select(["_eventId", "_activity", "_objects"])
            .explode("_objects")
            .rename({"_objects": "_objId"})
            .filter(pl.col("_objId").is_in(resource_ids))
        )
        print("Event-Resource-Activity (one row per event × resource)")
        print(event_resource_activity)

        counts = (
            event_resource_activity
            .group_by(["_objId", "_activity"])
            .agg(pl.len().alias("count"))
        )
        print("\nCounts (resource × activity)")
        print(counts.sort(["_objId", "_activity"]))

        totals = (
            event_resource_activity
            .group_by("_objId")
            .agg(pl.len().alias("total"))
        )
        print("\nTotals (events per resource)")
        print(totals.sort("_objId"))

        fractions = (
            counts
            .join(totals, on="_objId", how="left")
            .with_columns(
                (pl.col("count") / pl.col("total")).alias("fraction")
            )
            .select(["_objId", "_activity", "fraction"])
        )
        print("\nFractions (count / total per resource)")
        print(fractions.sort(["_objId", "_activity"]))

        matrix = (
            fractions
            .pivot(index="_objId", on="_activity", values="fraction")
            .fill_null(0.0)
            .sort("_objId")
        )

        activities = sorted(c for c in matrix.columns if c != "_objId")
        matrix = matrix.select(["_objId"] + activities)
        resources = matrix["_objId"].to_list()

        print("\nResource-Activity Matrix (wide form)")
        print(matrix)

        return cls(matrix, resources, activities)

    def to_numpy(self) -> np.ndarray:
        """Matrix as numpy array, shape (n_resources, n_activities)."""
        return self.matrix.select(self.activities).to_numpy()

    def distance_matrix(
        self,
        metric: Literal["euclidean", "cosine", "manhattan"] = "euclidean",
    ) -> np.ndarray:
        """
        Pairwise distance matrix between resources based on their activity profiles.
        Shape: (n_resources, n_resources).
        """
        from scipy.spatial.distance import cdist
        X = self.to_numpy()
        return cdist(X, X, metric=metric)

    def cluster(
        self,
        n_clusters: int = 3,
        method: Literal["kmeans", "agglomerative"] = "kmeans",
    ) -> list[int]:
        """
        Cluster resources by activity profile similarity.

        Returns a label per resource in the same order as self.resources.
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
        """Serialisable representation: resources list, activities list, and the value matrix."""
        return {
            "resources": self.resources,
            "activities": self.activities,
            "values": self.to_numpy().tolist(),
        }
