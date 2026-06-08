class ProcessArea:
    """
    Represents a single process area consisting of a set of activities and object types and a level.
    """

    def __init__(
        self, object_types: list[str], activities: list[str], level: float = None
    ):
        self.object_types = list(object_types)
        self.activities = list(activities)
        self.level = level

    def __repr__(self):
        return (
            f"<ProcessArea level={self.level}, "
            f"object_types={self.object_types}, "
            f"activities={[a for a in self.activities[:3]]}{'...' if len(self.activities) > 3 else ''}>"
        )
