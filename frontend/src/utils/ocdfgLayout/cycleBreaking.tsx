import { OCDFGLayout } from './LayoutState';

export interface CycleBreakingConfig {
  preferredSources: string[];
  preferredSinks: string[];
}

export function reverseCycles(layout: OCDFGLayout, config: CycleBreakingConfig) {
  const sources = config.preferredSources.filter((id) => layout.nodes[id]);
  const sinks = config.preferredSinks.filter((id) => layout.nodes[id]);
  const order = modifiedGreedyFAS(layout, sources, sinks);
  const rank = new Map<string, number>();
  order.forEach((id, index) => rank.set(id, index));

  Object.values(layout.edges).forEach((edge) => {
    const sourceRank = rank.get(edge.source) ?? 0;
    const targetRank = rank.get(edge.target) ?? 0;
    layout.setEdgeDirection(edge.id, sourceRank > targetRank);
  });
}

function modifiedGreedyFAS(layout: OCDFGLayout, sources: string[], sinks: string[]) {
  const graph = new MutableGraph(layout);

  const s1: string[] = [];
  const s2: string[] = [];

  if (sources.length > 0) {
    const sortedSources = [...sources].sort((a, b) => graph.degreeDiff(b) - graph.degreeDiff(a));
    s1.push(...sortedSources);
    graph.removeNodes(sortedSources);
  }

  if (sinks.length > 0) {
    const sortedSinks = [...sinks].sort((a, b) => graph.degreeDiff(b) - graph.degreeDiff(a));
    s2.unshift(...sortedSinks);
    graph.removeNodes(sortedSinks);
  }

  while (graph.hasNodes()) {
    let sink: string | null;
    while ((sink = graph.getSink())) {
      s2.unshift(sink);
      graph.removeNode(sink);
    }

    let source: string | null;
    while ((source = graph.getSource())) {
      s1.push(source);
      graph.removeNode(source);
    }

    if (!graph.hasNodes()) {
      break;
    }

    const node = graph.getMaxDegreeNode();
    if (node) {
      s1.push(node);
      graph.removeNode(node);
    }
  }

  return s1.concat(s2);
}

class MutableGraph {
  nodes: Set<string>;
  outAdj: Map<string, Set<string>>;
  inAdj: Map<string, Set<string>>;

  constructor(layout: OCDFGLayout) {
    this.nodes = new Set(
      Object.values(layout.nodes)
        .filter((node) => node.type === OCDFGLayout.ACTIVITY_TYPE)
        .map((node) => node.id),
    );
    this.outAdj = new Map();
    this.inAdj = new Map();

    this.nodes.forEach((id) => {
      this.outAdj.set(id, new Set());
      this.inAdj.set(id, new Set());
    });

    Object.values(layout.edges).forEach((edge) => {
      if (!edge.original) return;
      if (!this.nodes.has(edge.source) || !this.nodes.has(edge.target)) return;
      this.outAdj.get(edge.source)?.add(edge.target);
      this.inAdj.get(edge.target)?.add(edge.source);
    });
  }

  hasNodes() {
    return this.nodes.size > 0;
  }

  removeNode(node: string) {
    if (!this.nodes.has(node)) return;
    this.nodes.delete(node);
    this.outAdj.get(node)?.forEach((target) => this.inAdj.get(target)?.delete(node));
    this.inAdj.get(node)?.forEach((source) => this.outAdj.get(source)?.delete(node));
    this.outAdj.delete(node);
    this.inAdj.delete(node);
  }

  removeNodes(nodes: string[]) {
    nodes.forEach((node) => this.removeNode(node));
  }

  getSink(): string | null {
    for (const node of this.nodes) {
      if ((this.outAdj.get(node)?.size ?? 0) === 0) {
        return node;
      }
    }
    return null;
  }

  getSource(): string | null {
    for (const node of this.nodes) {
      if ((this.inAdj.get(node)?.size ?? 0) === 0) {
        return node;
      }
    }
    return null;
  }

  degreeDiff(node: string) {
    return (this.outAdj.get(node)?.size ?? 0) - (this.inAdj.get(node)?.size ?? 0);
  }

  getMaxDegreeNode(): string | null {
    let maxNode: string | null = null;
    let maxValue = Number.NEGATIVE_INFINITY;
    for (const node of this.nodes) {
      const value = this.degreeDiff(node);
      if (value > maxValue) {
        maxValue = value;
        maxNode = node;
      }
    }
    return maxNode;
  }
}

