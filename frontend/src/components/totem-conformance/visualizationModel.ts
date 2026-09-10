export const TOTEM_TEMPORAL_RELATIONS = ["D", "Di", "I", "Ii", "P"] as const;

export type TotemTemporalRelation = (typeof TOTEM_TEMPORAL_RELATIONS)[number];

export interface TotemVisualizationPosition {
  x: number;
  y: number;
}

export interface TotemVisualizationNode {
  id: string;
  label: string;
  color?: string;
  position?: TotemVisualizationPosition;
}

export interface TotemCardinalityAnnotation {
  log: string | null;
  event: string | null;
}

export interface TotemVisualizationRelation {
  id: string;
  source: string;
  target: string;
  temporal: TotemTemporalRelation | null;
  sourceToTarget: TotemCardinalityAnnotation;
  targetToSource: TotemCardinalityAnnotation;
}

export interface TotemVisualizationModel {
  schema: "totem";
  version: 1;
  nodes: TotemVisualizationNode[];
  relations: TotemVisualizationRelation[];
  eventTypes: string[];
  eventTypesByObjectType: Record<string, string[]>;
  warnings: string[];
}

export class TotemVisualizationModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TotemVisualizationModelError";
  }
}

type JsonRecord = Record<string, unknown>;
type TypePair = readonly [string, string];

const DISPLAY_RELATION_ORDER: readonly TotemTemporalRelation[] = [
  "D",
  "I",
  "P",
  "Di",
  "Ii",
];

const INVERSE_RELATION: Record<TotemTemporalRelation, TotemTemporalRelation> = {
  D: "Di",
  Di: "D",
  I: "Ii",
  Ii: "I",
  P: "P",
};

const EMPTY_CARDINALITY: TotemCardinalityAnnotation = {
  log: null,
  event: null,
};

/** Convert canonical TOTeM v1 asset JSON into the renderer's stable model. */
export function createTotemVisualizationModel(raw: unknown): TotemVisualizationModel {
  const asset = requireRecord(raw, "TOTeM asset");
  if (asset.schema !== "totem") {
    throw new TotemVisualizationModelError('TOTeM asset must declare schema "totem".');
  }
  if (asset.version !== 1) {
    throw new TotemVisualizationModelError("Only TOTeM schema version 1 is supported.");
  }

  const tempgraph = requireRecord(asset.tempgraph, "tempgraph");
  const nodeNames = requireUniqueStrings(tempgraph.nodes, "tempgraph.nodes");
  const knownNodes = new Set(nodeNames);
  const warnings: string[] = [];
  const directedRelations = new Map<string, TotemTemporalRelation>();
  const displayPairs = new Map<string, TypePair>();

  for (const relation of DISPLAY_RELATION_ORDER) {
    const pairs = requirePairs(tempgraph[relation], `tempgraph.${relation}`, knownNodes);
    for (const [source, target] of pairs) {
      const directionKey = directionalPairKey(source, target);
      const existing = directedRelations.get(directionKey);
      if (existing && existing !== relation) {
        warnings.push(
          `${source} to ${target} declares both ${existing} and ${relation}; ${existing} is displayed.`
        );
      } else if (!existing) {
        directedRelations.set(directionKey, relation);
      }
      addDisplayPair(displayPairs, source, target);
    }
  }

  for (const [source, target] of requirePairs(
    asset.type_relations,
    "type_relations",
    knownNodes
  )) {
    addDisplayPair(displayPairs, source, target);
  }

  const cardinalities = readCardinalities(asset.cardinalities, knownNodes);
  for (const { source, target } of cardinalities.values()) {
    addDisplayPair(displayPairs, source, target);
  }

  const layoutByNode = readLayout(asset.layout, knownNodes, warnings);
  const nodes = nodeNames.map((name) => ({
    id: name,
    label: name,
    ...layoutByNode.get(name),
  }));

  const relations = Array.from(displayPairs.values(), ([pairSource, pairTarget]) => {
    const oriented = orientDisplayPair(
      pairSource,
      pairTarget,
      directedRelations
    );
    const sourceToTarget = cardinalities.get(
      directionalPairKey(oriented.source, oriented.target)
    );
    const targetToSource = cardinalities.get(
      directionalPairKey(oriented.target, oriented.source)
    );
    const reverseTemporal = directedRelations.get(
      directionalPairKey(oriented.target, oriented.source)
    );
    if (
      oriented.temporal &&
      reverseTemporal &&
      reverseTemporal !== INVERSE_RELATION[oriented.temporal]
    ) {
      warnings.push(
        `${oriented.source} and ${oriented.target} declare inconsistent inverse temporal relations; ${oriented.temporal} is displayed.`
      );
    }

    return {
      id: directionalPairKey(oriented.source, oriented.target),
      source: oriented.source,
      target: oriented.target,
      temporal: oriented.temporal,
      sourceToTarget: sourceToTarget?.annotation ?? EMPTY_CARDINALITY,
      targetToSource: targetToSource?.annotation ?? EMPTY_CARDINALITY,
    };
  });

  const eventTypes = requireUniqueStrings(asset.all_event_types, "all_event_types");
  const eventTypesByObjectType = readEventTypesByObjectType(
    asset.object_type_to_event_types,
    knownNodes,
    new Set(eventTypes)
  );

  return {
    schema: "totem",
    version: 1,
    nodes,
    relations,
    eventTypes,
    eventTypesByObjectType,
    warnings,
  };
}

export function directionalPairKey(source: string, target: string): string {
  return JSON.stringify([source, target]);
}

function unorderedPairKey(source: string, target: string): string {
  return JSON.stringify([source, target].sort((left, right) => left.localeCompare(right)));
}

function addDisplayPair(
  pairs: Map<string, TypePair>,
  source: string,
  target: string
): void {
  if (source === target) return;
  const key = unorderedPairKey(source, target);
  if (!pairs.has(key)) pairs.set(key, [source, target]);
}

function orientDisplayPair(
  source: string,
  target: string,
  directedRelations: ReadonlyMap<string, TotemTemporalRelation>
): { source: string; target: string; temporal: TotemTemporalRelation | null } {
  const direct = directedRelations.get(directionalPairKey(source, target));
  if (direct) return { source, target, temporal: direct };

  const reverse = directedRelations.get(directionalPairKey(target, source));
  if (reverse) return { source: target, target: source, temporal: reverse };

  return { source, target, temporal: null };
}

function readCardinalities(
  value: unknown,
  knownNodes: ReadonlySet<string>
): Map<
  string,
  { source: string; target: string; annotation: TotemCardinalityAnnotation }
> {
  if (!Array.isArray(value)) {
    throw new TotemVisualizationModelError("cardinalities must be an array.");
  }

  const result = new Map<
    string,
    { source: string; target: string; annotation: TotemCardinalityAnnotation }
  >();
  value.forEach((entry, index) => {
    const item = requireRecord(entry, `cardinalities[${index}]`);
    const source = requireKnownNode(item.from, knownNodes, `cardinalities[${index}].from`);
    const target = requireKnownNode(item.to, knownNodes, `cardinalities[${index}].to`);
    result.set(directionalPairKey(source, target), {
      source,
      target,
      annotation: {
        log: nullableString(item.log_cardinality, `cardinalities[${index}].log_cardinality`),
        event: nullableString(
          item.event_cardinality,
          `cardinalities[${index}].event_cardinality`
        ),
      },
    });
  });
  return result;
}

function readLayout(
  value: unknown,
  knownNodes: ReadonlySet<string>,
  warnings: string[]
): Map<string, Pick<TotemVisualizationNode, "color" | "position">> {
  const result = new Map<
    string,
    Pick<TotemVisualizationNode, "color" | "position">
  >();
  if (value === undefined) return result;
  if (!isRecord(value) || !isRecord(value.objectTypes)) {
    warnings.push("The optional TOTeM layout block is invalid and was ignored.");
    return result;
  }

  for (const [name, rawEntry] of Object.entries(value.objectTypes)) {
    if (!knownNodes.has(name) || !isRecord(rawEntry)) {
      warnings.push(`Layout entry ${name} was ignored.`);
      continue;
    }
    const entry: Pick<TotemVisualizationNode, "color" | "position"> = {};
    if (typeof rawEntry.color === "string") entry.color = rawEntry.color;
    if (
      isRecord(rawEntry.position) &&
      isFiniteNumber(rawEntry.position.x) &&
      isFiniteNumber(rawEntry.position.y)
    ) {
      entry.position = { x: rawEntry.position.x, y: rawEntry.position.y };
    }
    result.set(name, entry);
  }
  return result;
}

function readEventTypesByObjectType(
  value: unknown,
  knownNodes: ReadonlySet<string>,
  knownEventTypes: ReadonlySet<string>
): Record<string, string[]> {
  const mapping = requireRecord(value, "object_type_to_event_types");
  const result: Record<string, string[]> = {};
  for (const [objectType, rawEventTypes] of Object.entries(mapping)) {
    if (!knownNodes.has(objectType)) {
      throw new TotemVisualizationModelError(
        `object_type_to_event_types references unknown object type ${objectType}.`
      );
    }
    const eventTypes = requireUniqueStrings(
      rawEventTypes,
      `object_type_to_event_types.${objectType}`
    );
    const unknownEventType = eventTypes.find((eventType) => !knownEventTypes.has(eventType));
    if (unknownEventType) {
      throw new TotemVisualizationModelError(
        `object_type_to_event_types.${objectType} references unknown event type ${unknownEventType}.`
      );
    }
    result[objectType] = eventTypes;
  }
  return result;
}

function requirePairs(
  value: unknown,
  path: string,
  knownNodes: ReadonlySet<string>
): TypePair[] {
  if (!Array.isArray(value)) {
    throw new TotemVisualizationModelError(`${path} must be an array.`);
  }
  return value.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new TotemVisualizationModelError(`${path}[${index}] must be a two-item pair.`);
    }
    return [
      requireKnownNode(entry[0], knownNodes, `${path}[${index}][0]`),
      requireKnownNode(entry[1], knownNodes, `${path}[${index}][1]`),
    ];
  });
}

function requireKnownNode(
  value: unknown,
  knownNodes: ReadonlySet<string>,
  path: string
): string {
  if (typeof value !== "string" || !knownNodes.has(value)) {
    throw new TotemVisualizationModelError(`${path} must reference a known object type.`);
  }
  return value;
}

function requireUniqueStrings(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new TotemVisualizationModelError(`${path} must be an array of strings.`);
  }
  const result = value as string[];
  if (new Set(result).size !== result.length) {
    throw new TotemVisualizationModelError(`${path} must not contain duplicates.`);
  }
  return [...result];
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new TotemVisualizationModelError(`${path} must be a string or null.`);
  }
  return value;
}

function requireRecord(value: unknown, path: string): JsonRecord {
  if (!isRecord(value)) {
    throw new TotemVisualizationModelError(`${path} must be an object.`);
  }
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
