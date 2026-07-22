type AssetSchema = 'totem' | 'occn';

const TEMPORAL_RELATIONS = ['D', 'Di', 'I', 'Ii', 'P'] as const;
const CARDINALITIES = new Set([
  'total',
  '0',
  '1',
  '0...1',
  '1..*',
  '0...*',
  'None',
  'ERROR 0',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  return value;
};

const requireArray = (value: unknown, path: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
};

const requireString = (value: unknown, path: string): string => {
  if (typeof value !== 'string') throw new Error(`${path} must be a string.`);
  return value;
};

const requireStringArray = (value: unknown, path: string): string[] =>
  requireArray(value, path).map((entry, index) => requireString(entry, `${path}[${index}]`));

const requireUnique = (values: string[], path: string) => {
  if (new Set(values).size !== values.length) {
    throw new Error(`${path} must not contain duplicate values.`);
  }
};

const requireKnown = (value: string, known: Set<string>, path: string, kind: string) => {
  if (!known.has(value)) throw new Error(`${path} references unknown ${kind} "${value}".`);
};

const requireNonNegativeInteger = (value: unknown, path: string): number => {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${path} must be a non-negative integer.`);
  }
  return value as number;
};

const requireOptionalCount = (value: unknown, path: string) => {
  if (value !== null && value !== undefined) requireNonNegativeInteger(value, path);
};

const requireExactKeys = (value: Record<string, unknown>, expected: string[], path: string) => {
  const actual = Object.keys(value);
  const expectedSet = new Set(expected);
  const missing = expected.filter(
    (key) => !Object.prototype.hasOwnProperty.call(value, key),
  );
  const unexpected = actual.filter((key) => !expectedSet.has(key));
  if (missing.length > 0) throw new Error(`${path} is missing keys: ${missing.join(', ')}.`);
  if (unexpected.length > 0) {
    throw new Error(`${path} contains unknown keys: ${unexpected.join(', ')}.`);
  }
};

const tupleKey = (...parts: string[]) => JSON.stringify(parts);

function validatePosition(value: unknown, path: string) {
  const position = requireRecord(value, path);
  for (const axis of ['x', 'y'] as const) {
    if (typeof position[axis] !== 'number' || !Number.isFinite(position[axis])) {
      throw new Error(`${path}.${axis} must be a finite number.`);
    }
  }
}

function validateLayoutNode(value: unknown, path: string) {
  const node = requireRecord(value, path);
  if (node.position !== undefined) validatePosition(node.position, `${path}.position`);
  if (node.color !== undefined && typeof node.color !== 'string') {
    throw new Error(`${path}.color must be a string.`);
  }
}

function validateTotem(raw: Record<string, unknown>) {
  const tempgraph = requireRecord(raw.tempgraph, 'tempgraph');
  const nodes = requireStringArray(tempgraph.nodes, 'tempgraph.nodes');
  const nodeSet = new Set(nodes);

  for (const relation of TEMPORAL_RELATIONS) {
    for (const [index, edge] of requireArray(tempgraph[relation], `tempgraph.${relation}`).entries()) {
      const pair = requireArray(edge, `tempgraph.${relation}[${index}]`);
      if (pair.length !== 2) throw new Error(`tempgraph.${relation}[${index}] must have two entries.`);
      const source = requireString(pair[0], `tempgraph.${relation}[${index}][0]`);
      const target = requireString(pair[1], `tempgraph.${relation}[${index}][1]`);
      requireKnown(source, nodeSet, `tempgraph.${relation}[${index}][0]`, 'object type');
      requireKnown(target, nodeSet, `tempgraph.${relation}[${index}][1]`, 'object type');
    }
  }

  for (const [index, entry] of requireArray(raw.cardinalities, 'cardinalities').entries()) {
    const cardinality = requireRecord(entry, `cardinalities[${index}]`);
    const source = requireString(cardinality.from, `cardinalities[${index}].from`);
    const target = requireString(cardinality.to, `cardinalities[${index}].to`);
    requireKnown(source, nodeSet, `cardinalities[${index}].from`, 'object type');
    requireKnown(target, nodeSet, `cardinalities[${index}].to`, 'object type');
    for (const key of ['log_cardinality', 'event_cardinality'] as const) {
      const value = requireString(cardinality[key], `cardinalities[${index}].${key}`);
      if (!CARDINALITIES.has(value)) {
        throw new Error(`cardinalities[${index}].${key} has unsupported value "${value}".`);
      }
    }
  }

  for (const [index, entry] of requireArray(raw.type_relations, 'type_relations').entries()) {
    const pair = requireArray(entry, `type_relations[${index}]`);
    if (pair.length !== 2) throw new Error(`type_relations[${index}] must have two entries.`);
    const source = requireString(pair[0], `type_relations[${index}][0]`);
    const target = requireString(pair[1], `type_relations[${index}][1]`);
    requireKnown(source, nodeSet, `type_relations[${index}][0]`, 'object type');
    requireKnown(target, nodeSet, `type_relations[${index}][1]`, 'object type');
  }

  const eventTypes = new Set(requireStringArray(raw.all_event_types, 'all_event_types'));
  const eventTypesByObject = requireRecord(
    raw.object_type_to_event_types,
    'object_type_to_event_types',
  );
  for (const [objectType, values] of Object.entries(eventTypesByObject)) {
    requireKnown(objectType, nodeSet, `object_type_to_event_types.${objectType}`, 'object type');
    for (const eventType of requireStringArray(values, `object_type_to_event_types.${objectType}`)) {
      requireKnown(eventType, eventTypes, `object_type_to_event_types.${objectType}`, 'event type');
    }
  }

  if (raw.layout !== undefined) {
    const layout = requireRecord(raw.layout, 'layout');
    const objectTypes = requireRecord(layout.objectTypes ?? {}, 'layout.objectTypes');
    for (const [name, entry] of Object.entries(objectTypes)) {
      requireKnown(name, nodeSet, `layout.objectTypes.${name}`, 'object type');
      validateLayoutNode(entry, `layout.objectTypes.${name}`);
    }
  }
}

function validateOccnMarkerGroups(
  raw: Record<string, unknown>,
  key: 'input_marker_groups' | 'output_marker_groups',
  activities: string[],
  activitySet: Set<string>,
  objectTypeSet: Set<string>,
  edgeSet: Set<string>,
) {
  const mapping = requireRecord(raw[key], key);
  requireExactKeys(mapping, activities, key);

  for (const activity of activities) {
    const groups = requireArray(mapping[activity], `${key}.${activity}`);
    for (const [groupIndex, groupValue] of groups.entries()) {
      const groupPath = `${key}.${activity}[${groupIndex}]`;
      const group = requireRecord(groupValue, groupPath);
      requireOptionalCount(group.support_count, `${groupPath}.support_count`);
      const markers = requireArray(group.markers, `${groupPath}.markers`);
      if (markers.length === 0) throw new Error(`${groupPath}.markers must not be empty.`);

      for (const [markerIndex, markerValue] of markers.entries()) {
        const markerPath = `${groupPath}.markers[${markerIndex}]`;
        const marker = requireRecord(markerValue, markerPath);
        const related = requireString(marker.related_activity, `${markerPath}.related_activity`);
        const objectType = requireString(marker.object_type, `${markerPath}.object_type`);
        requireKnown(related, activitySet, `${markerPath}.related_activity`, 'activity');
        requireKnown(objectType, objectTypeSet, `${markerPath}.object_type`, 'object type');
        const min = requireNonNegativeInteger(marker.min_count, `${markerPath}.min_count`);
        requireOptionalCount(marker.max_count, `${markerPath}.max_count`);
        if (marker.max_count != null && min > (marker.max_count as number)) {
          throw new Error(`${markerPath}.min_count must be <= max_count.`);
        }
        const markerKey = requireNonNegativeInteger(marker.marker_key, `${markerPath}.marker_key`);
        if (markerKey === 0) throw new Error(`${markerPath}.marker_key must be positive.`);

        const edge =
          key === 'input_marker_groups'
            ? tupleKey(related, activity, objectType)
            : tupleKey(activity, related, objectType);
        if (!edgeSet.has(edge)) throw new Error(`${markerPath} has no matching dependency edge.`);
      }
    }
  }
}

function validateOccn(raw: Record<string, unknown>) {
  const activities = requireStringArray(raw.activities, 'activities');
  const objectTypes = requireStringArray(raw.object_types, 'object_types');
  requireUnique(activities, 'activities');
  requireUnique(objectTypes, 'object_types');
  const activitySet = new Set(activities);
  const objectTypeSet = new Set(objectTypes);

  for (const objectType of objectTypes) {
    requireKnown(`START_${objectType}`, activitySet, 'activities', 'start activity');
    requireKnown(`END_${objectType}`, activitySet, 'activities', 'end activity');
  }

  const dependencyGraph = requireRecord(raw.dependency_graph, 'dependency_graph');
  const edgeSet = new Set<string>();
  for (const [index, value] of requireArray(dependencyGraph.edges, 'dependency_graph.edges').entries()) {
    const path = `dependency_graph.edges[${index}]`;
    const edge = requireRecord(value, path);
    const source = requireString(edge.source, `${path}.source`);
    const target = requireString(edge.target, `${path}.target`);
    const objectType = requireString(edge.object_type, `${path}.object_type`);
    requireKnown(source, activitySet, `${path}.source`, 'activity');
    requireKnown(target, activitySet, `${path}.target`, 'activity');
    requireKnown(objectType, objectTypeSet, `${path}.object_type`, 'object type');
    const edgeKey = tupleKey(source, target, objectType);
    if (edgeSet.has(edgeKey)) throw new Error(`${path} duplicates an existing dependency edge.`);
    edgeSet.add(edgeKey);
  }

  validateOccnMarkerGroups(
    raw,
    'input_marker_groups',
    activities,
    activitySet,
    objectTypeSet,
    edgeSet,
  );
  validateOccnMarkerGroups(
    raw,
    'output_marker_groups',
    activities,
    activitySet,
    objectTypeSet,
    edgeSet,
  );

  const activityCount = requireRecord(raw.activity_count, 'activity_count');
  requireExactKeys(activityCount, activities, 'activity_count');
  for (const activity of activities) {
    requireNonNegativeInteger(activityCount[activity], `activity_count.${activity}`);
  }
  if (
    typeof raw.relative_occurrence_threshold !== 'number' ||
    !Number.isFinite(raw.relative_occurrence_threshold) ||
    raw.relative_occurrence_threshold < 0 ||
    raw.relative_occurrence_threshold > 1
  ) {
    throw new Error('relative_occurrence_threshold must be a number in [0, 1].');
  }

  if (raw.layout !== undefined) {
    const layout = requireRecord(raw.layout, 'layout');
    for (const [layoutKey, known, kind] of [
      ['activities', activitySet, 'activity'],
      ['objectTypes', objectTypeSet, 'object type'],
    ] as const) {
      const nodes = requireRecord(layout[layoutKey] ?? {}, `layout.${layoutKey}`);
      for (const [name, entry] of Object.entries(nodes)) {
        requireKnown(name, known, `layout.${layoutKey}.${name}`, kind);
        validateLayoutNode(entry, `layout.${layoutKey}.${name}`);
      }
    }
    for (const [index, value] of requireArray(layout.arcs ?? [], 'layout.arcs').entries()) {
      const path = `layout.arcs[${index}]`;
      const arc = requireRecord(value, path);
      const source = requireString(arc.source, `${path}.source`);
      const target = requireString(arc.target, `${path}.target`);
      const objectType = requireString(arc.object_type, `${path}.object_type`);
      requireKnown(source, activitySet, `${path}.source`, 'activity');
      requireKnown(target, activitySet, `${path}.target`, 'activity');
      requireKnown(objectType, objectTypeSet, `${path}.object_type`, 'object type');
    }
  }
}

export function assertCanonicalAsset(
  raw: unknown,
  schema: AssetSchema,
): asserts raw is Record<string, unknown> {
  const asset = requireRecord(raw, `${schema.toUpperCase()} asset`);
  if (asset.schema !== schema) throw new Error(`Model must declare schema "${schema}".`);
  if (asset.version !== 1) throw new Error(`Unsupported ${schema.toUpperCase()} schema version.`);
  if (schema === 'totem') validateTotem(asset);
  else validateOccn(asset);
}
