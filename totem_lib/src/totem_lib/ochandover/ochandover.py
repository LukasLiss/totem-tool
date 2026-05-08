import math
from typing import List

import polars as pl
import networkx as nx
from totem_lib import ObjectCentricEventLog as OCEL
from collections import defaultdict
import matplotlib.pyplot as plt

pl.Config.set_tbl_rows(20)      # to show all rows set this to -1
pl.Config.set_tbl_cols(-1)      # show all columns
pl.Config.set_fmt_str_lengths(None)  # don't truncate strings


class OCHANDOVER(nx.MultiDiGraph):
    """
    
    """
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    @classmethod
    def from_ocel(cls, ocel: OCEL, resource_types: List[str], businessobject_types: List[str]) -> 'OCHANDOVER':

        """
            Normalization still an issue
            For example when differentiating the different object types, do we divide for each type individually or with the same value
        """

        # Get the object ids of the resources and business objects
        
        resource_ids = set()
        for obj_type in resource_types:
            resource_ids.update(ocel.get_object_ids_by_type(obj_type))

        businessobject_ids = set()
        for obj_type in businessobject_types:
            businessobject_ids.update(ocel.get_object_ids_by_type(obj_type))



        event_objects = (
            ocel.events
            .select(["_eventId", "_activity", "_timestampUnix", "_objects"])
            .explode("_objects")
            .rename({"_objects": "_objId"})
        )

        print("Event Objects (Explode)")
        print(event_objects)

        event_resources = (
            event_objects
            .filter(pl.col("_objId").is_in(resource_ids))
            .group_by("_eventId")
            .agg(
                pl.col("_objId").unique().alias("resources")
            )
        )

        print("Event Resources")
        print(event_resources)


        # Get the type of the objects by their id

        businessobject_type_by_id = {}

        for obj_type in businessobject_types:
            for obj_id in ocel.get_object_ids_by_type(obj_type):
                businessobject_type_by_id[obj_id] = obj_type

        resource_type_by_id = {}

        for obj_type in resource_types:
            for obj_id in ocel.get_object_ids_by_type(obj_type):
                resource_type_by_id[obj_id] = obj_type


        businessobject_type_df = pl.DataFrame({
            "businessobject_id": list(businessobject_type_by_id.keys()),
            "businessobject_type": list(businessobject_type_by_id.values()),
        })


        # Get the business object(s) and type to each event

        event_businessobjects = (
            event_objects
            .filter(pl.col("_objId").is_in(businessobject_ids))
            .select([
                "_eventId",
                "_activity",
                "_timestampUnix",
                pl.col("_objId").alias("businessobject_id"),
            ])
            .join(businessobject_type_df, on="businessobject_id", how="left")
        )

        print("Event Businessobjects")
        print(event_businessobjects)


        # Build the Event-Object Graph Arcs

        eog_arcs = (
            event_businessobjects
            .sort(["businessobject_id", "_timestampUnix", "_eventId"])
            .with_columns([
                pl.col("_eventId")
                .shift(-1)
                .over("businessobject_id")
                .alias("next_event_id"),

                pl.col("_activity")
                .shift(-1)
                .over("businessobject_id")
                .alias("next_activity"),

                pl.col("_timestampUnix")
                .shift(-1)
                .over("businessobject_id")
                .alias("next_timestampUnix"),
            ])
            .filter(pl.col("next_event_id").is_not_null())
            .select([
                pl.col("_eventId").alias("source_event"),
                pl.col("next_event_id").alias("target_event"),
                "businessobject_id",
                "businessobject_type"
            ])
        )

        print("Event-Object Graph Arcs")
        print(eog_arcs)


        # Put the EOG Table in a form where each arc occurs only once, by assigning multiple objects at once

        # Important:
        # If two events are directly-follows for several business objects,
        # they still represent one event-object graph arc, but we may want
        # to remember which business objects caused the arc.
        eog_arcs_unique = (
            eog_arcs
            .group_by(["source_event", "target_event"])
            .agg([
                pl.col("businessobject_id").unique().alias("businessobjects"),
                pl.col("businessobject_type").unique().alias("businessobject_types"),
            ])
        )

        print("EOG Arcs Unique")
        print(eog_arcs_unique)


        # Annotate events with resource objects
        
        arcs_with_resources = (
            eog_arcs_unique
            .join(
                event_resources.rename({
                    "_eventId": "source_event",
                    "resources": "source_resources",
                }),
                on="source_event",
                how="inner",
            )
            .join(
                event_resources.rename({
                    "_eventId": "target_event",
                    "resources": "target_resources",
                }),
                on="target_event",
                how="inner",
            )
        )
        print("Arcs with Resources")
        print(arcs_with_resources)

        # not differentiating between types
        """
        handover_edges = (
            arcs_with_resources
            .explode("source_resources")
            .explode("target_resources")
            .group_by(["source_resources", "target_resources"])
            .len()
            .rename({
                "source_resources": "source",
                "target_resources": "target",
                "len": "weight",
            })
            .sort("weight", descending=True)
        )
        """

        # Compute the handover edges

        handover_edges = (
            arcs_with_resources
            .explode("source_resources")
            .explode("target_resources")
            .explode("businessobject_types")
            .group_by(["source_resources", "target_resources", "businessobject_types"])
            .len()
            .rename({
                "source_resources": "source",
                "target_resources": "target",
                "businessobject_types": "businessobject_type",
                "len": "weight",
            })
            .sort("weight", descending=True)
        )


        print("Handover edges")
        print(handover_edges)


        # Shouldn't it be divided by the sum of the weights and not the number of arcs, matrix entries should equal 1?
        # arcs_with_resources.height        <-- slides
        # handover_edges.select(pl.col("weight").sum()).item()

        total_weight = arcs_with_resources.height
        print("weights sum", handover_edges.select(pl.col("weight").sum()).item())
        print("arcs with resources height", arcs_with_resources.height)


        handover_edges = handover_edges.with_columns(
            (pl.col("weight") / total_weight).alias("norm_weight")
        )

        print("sum", handover_edges.select(pl.col("norm_weight").sum()).item())

        """
        print("Event-object graph arcs")
        print(eog_arcs_unique)

        print("Handover edges")
        print(handover_edges)
        """

        number_of_arcs = eog_arcs_unique.height
        print("Number of gaps", number_of_arcs - arcs_with_resources.height)


        graph = cls()

        for row in handover_edges.to_dicts():
            source = row["source"]
            target = row["target"]
            bo_type = row["businessobject_type"]

            graph.add_node(
                source,
                object_type=resource_type_by_id.get(source, "unknown"),
            )

            graph.add_node(
                target,
                object_type=resource_type_by_id.get(target, "unknown"),
            )

            graph.add_edge(
                source,
                target,
                key=bo_type,
                weight=row["norm_weight"],
                raw_weight=row["weight"],
                businessobject_type=bo_type,
            )

        return graph
    



    @classmethod
    def from_ocel_flattened(cls, ocel: OCEL, case_type: str, resource_type: str) -> 'OCHANDOVER':

        """
            Huge uncertainty:
            When grouping for the case ids, we get only the events, where an object of the resource type was involved.
            This makes it seem like there was nothing in between.
            The issue here is that if we only look at one object type in the flattened version, the way we do here, we do not detect those gaps.
            The result is that if there is a resource o1 from our resource object type, and then some activities from other object types followed by an activity of o1,
            which is another resource, this is counted as a handover from o1 to o2. However this would have to be seen as a handover from o1 to the objects in between and then to o2?
        """

        case_ids = set(ocel.get_object_ids_by_type(case_type))
        resource_ids = set(ocel.get_object_ids_by_type(resource_type))

        event_objects = (
            ocel.events
            .select(["_eventId", "_activity", "_timestampUnix", "_objects"])
            .explode("_objects")
            .rename({"_objects": "_objId"})
        )

        print("OCEL Table")
        print(ocel.events.select(["_eventId", "_activity", "_timestampUnix", "_objects"]).head(10))

        print("Events (Explode)")
        print(event_objects.head(10))

        case_df = (
            event_objects
            .filter(pl.col("_objId").is_in(case_ids))
            .select([
                "_eventId",
                pl.col("_objId").alias("case_id"),
            ])
        )

        print("Cases")
        print(case_df.head(10))

        resource_df = (
            event_objects
            .filter(pl.col("_objId").is_in(resource_ids))
            .select([
                "_eventId",
                pl.col("_objId").alias("resource_id"),
            ])
        )

        print("Resources")
        print(resource_df)

        base_df = (
            ocel.events
            .select(["_eventId", "_activity", "_timestampUnix"])
            .join(case_df, on="_eventId", how="inner")
            .join(resource_df, on="_eventId", how="inner")
            .sort(["case_id", "_timestampUnix", "_eventId"])
        )

        print("Base DF (case_id and resource_id to the corresponding event)")
        print(base_df)



        # Dict for storing handovers and their count
        handover_count = defaultdict(int)

        # Detect handover
        
        handovers_raw = (
            base_df
            .sort(["case_id", "_timestampUnix", "_eventId"])
            .with_columns([
                pl.col("resource_id").shift(-1).over("case_id").alias("next_resource_id"),
                pl.col("_activity").shift(-1).over("case_id").alias("next_activity"),
                pl.col("_eventId").shift(-1).over("case_id").alias("next_event_id"),
            ])
            .filter(pl.col("next_resource_id").is_not_null())
        )

        print("Handovers raw")
        print(handovers_raw)

        handover_edges = (
            handovers_raw
            .group_by(["resource_id", "next_resource_id"])
            .len()
            .rename({
                "resource_id": "source",
                "next_resource_id": "target",
                "len": "weight",
            })
            .sort("weight", descending=True)
        )
        
        # total = handover_edges.select(pl.col("weight").sum()).item()
        total = base_df.select(pl.col("case_id").n_unique()).item()

        handover_edges = handover_edges.with_columns(
            (pl.col("weight") / total).alias("norm_weight")
        )


        max_value = handover_edges.select(pl.col("weight").max()).item()

        print("Handover edges")
        print(handover_edges)


        graph = cls()
        
        for row in handover_edges.to_dicts():
            source = row["source"]
            target = row["target"]
            weight = row["norm_weight"]

            graph.add_node(
                source,
                object_type=resource_type,
            )

            graph.add_node(
                target,
                object_type=resource_type,
            )

            graph.add_edge(
                source,
                target,
                weight=weight,
                raw_weight=row["weight"],
                businessobject_type=case_type,
            )

        return graph

    def plot(self):
        import matplotlib.patches as mpatches

        def separate_overlapping_nodes(pos, min_distance=0.08):
            import math

            nodes = list(pos.keys())

            for i, node_a in enumerate(nodes):
                for node_b in nodes[i + 1:]:
                    xa, ya = pos[node_a]
                    xb, yb = pos[node_b]

                    dx = xb - xa
                    dy = yb - ya
                    distance = math.sqrt(dx * dx + dy * dy)

                    if distance < min_distance:
                        if distance == 0:
                            dx, dy = 0.01, 0.01
                            distance = math.sqrt(dx * dx + dy * dy)

                        push = (min_distance - distance) / 2
                        ux = dx / distance
                        uy = dy / distance

                        pos[node_a][0] -= ux * push
                        pos[node_a][1] -= uy * push
                        pos[node_b][0] += ux * push
                        pos[node_b][1] += uy * push

            return pos

        pos = nx.spring_layout(
            self,
            k=1.5,
            iterations=200,
            seed=42,
        )


        edge_data = list(self.edges(data=True))
        node_data = list(self.nodes(data=True))

        # -------------------------
        # Edge weights
        # -------------------------
        weights = [
            d.get("weight", 0)
            for _, _, d in edge_data
        ]

        min_weight = min(weights) if weights else 0
        max_weight = max(weights) if weights else 1

        def scale_width(weight, min_width=1.0, max_width=6.0):
            if max_weight == min_weight:
                return (min_width + max_width) / 2

            return min_width + (
                (weight - min_weight) / (max_weight - min_weight)
            ) * (max_width - min_width)

        edge_widths = [
            scale_width(d.get("weight", 0))
            for _, _, d in edge_data
        ]

        # -------------------------
        # Edge colors by business-object type
        # -------------------------
        edge_bo_types = [
            d.get("businessobject_type", "unknown")
            for _, _, d in edge_data
        ]

        unique_edge_types = sorted(set(edge_bo_types))

        edge_cmap = plt.get_cmap("tab10")

        edge_type_to_color = {
            bo_type: edge_cmap(i % edge_cmap.N)
            for i, bo_type in enumerate(unique_edge_types)
        }

        edge_colors = [
            edge_type_to_color[d.get("businessobject_type", "unknown")]
            for _, _, d in edge_data
        ]

        # -------------------------
        # Node colors by resource object type
        # -------------------------
        node_object_types = [
            d.get("object_type", "unknown")
            for _, d in node_data
        ]

        unique_node_types = sorted(set(node_object_types))

        node_cmap = plt.get_cmap("Set2")

        node_type_to_color = {
            obj_type: node_cmap(i % node_cmap.N)
            for i, obj_type in enumerate(unique_node_types)
        }

        node_colors = [
            node_type_to_color[d.get("object_type", "unknown")]
            for _, d in node_data
        ]

        plt.figure(figsize=(10, 8))

        nx.draw_networkx_nodes(
            self,
            pos,
            nodelist=[n for n, _ in node_data],
            node_size=1500,
            node_color=node_colors,
            edgecolors="black",
        )

        nx.draw_networkx_labels(
            self,
            pos,
            font_size=10,
        )

        
        nx.draw_networkx_edges(
            self,
            pos,
            edgelist=[(u, v) for u, v, _ in edge_data],
            edge_color=edge_colors,
            arrows=True,
            arrowsize=20,
            width=edge_widths,
            connectionstyle="arc3,rad=0.2",
            min_source_margin=20,
            min_target_margin=20,
        )

        # -------------------------
        # Legends
        # -------------------------
        node_legend_handles = [
            mpatches.Patch(
                color=node_type_to_color[obj_type],
                label=obj_type,
            )
            for obj_type in unique_node_types
        ]

        edge_legend_handles = [
            mpatches.Patch(
                color=edge_type_to_color[bo_type],
                label=bo_type,
            )
            for bo_type in unique_edge_types
        ]

        node_legend = plt.legend(
            handles=node_legend_handles,
            title="Resource",
            loc="upper left",
        )

        plt.gca().add_artist(node_legend)

        plt.legend(
            handles=edge_legend_handles,
            title="Handover object type",
            loc="upper right",
        )

        plt.axis("off")
        plt.tight_layout()
        plt.show()
    
    """
    def plot(self):
        pos = nx.kamada_kawai_layout(self)

        edge_labels = {
            (u, v): f"{d.get('weight', 0):.2f}"
            for u, v, d in self.edges(data=True)
        }

        plt.figure(figsize=(10, 8))

        nx.draw_networkx_nodes(
            self,
            pos,
            node_size=1500,
            node_color="lightblue",
            edgecolors="black",
        )

        nx.draw_networkx_labels(
            self,
            pos,
            font_size=10,
        )

        nx.draw_networkx_edges(
            self,
            pos,
            arrows=True,
            arrowsize=20,
            connectionstyle="arc3,rad=0.2",
            min_source_margin=20,
            min_target_margin=20,
        )

        nx.draw_networkx_edge_labels(
            self,
            pos,
            edge_labels=edge_labels,
            font_size=9,
            label_pos=0.35,
            rotate=False,
            bbox=dict(facecolor="white", edgecolor="none", alpha=0.7),
        )

        plt.axis("off")
        plt.tight_layout()
        plt.show()
        """