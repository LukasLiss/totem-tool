class ProcessArea:
    """
    Represents a single process area consisting of a set of activities, the
    business object types the process runs on, the object types acting as
    resources, and a level.
S """

    def __init__(
        self,
        object_types: list[str],
        activities: list[str],
        level: float = None,
        resource_types: list[str] = None,
    ):
        self.object_types = list(object_types)
        self.activities = list(activities)
        self.level = level
        self.resource_types = list(resource_types) if resource_types else []

    def __repr__(self):
        return (
            f"<ProcessArea level={self.level}, "
            f"object_types={self.object_types}, "
            f"resource_types={self.resource_types}, "
            f"activities={[a for a in self.activities[:3]]}{'...' if len(self.activities) > 3 else ''}>"
        )
