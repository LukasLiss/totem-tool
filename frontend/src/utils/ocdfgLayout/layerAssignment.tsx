import type { GLPK } from 'glpk.js';
import glpkModule from 'glpk.js';
import { OCDFGLayout } from './LayoutState';

let glpkInstance: GLPK | null = null;

async function getGLPKInstance() {
  if (!glpkInstance) {
    glpkInstance = await glpkModule();
  }
  return glpkInstance;
}

interface GLPKConstraint {
  name: string;
  vars: { name: string; coef: number }[];
  bnds: { type: number; lb: number; ub: number };
}

function combineCoefs(vars: { name: string; coef: number }[]) {
  const combined: Record<string, number> = {};
  vars.forEach(({ name, coef }) => {
    combined[name] = (combined[name] ?? 0) + coef;
  });
  return Object.entries(combined).map(([name, coef]) => ({ name, coef }));
}

function createObjective(layout: OCDFGLayout) {
  const vars: { name: string; coef: number }[] = [];
  Object.values(layout.edges).forEach((edge) => {
    if (!layout.nodes[edge.source] || !layout.nodes[edge.target]) return;
    vars.push({ name: edge.target, coef: 1 });
    vars.push({ name: edge.source, coef: -1 });
  });
  return combineCoefs(vars);
}

function createArcConstraints(layout: OCDFGLayout, glpk: GLPK): GLPKConstraint[] {
  const constraints: GLPKConstraint[] = [];
  Object.values(layout.edges).forEach((edge) => {
    if (!layout.nodes[edge.source] || !layout.nodes[edge.target]) return;
    constraints.push({
      name: `edgespan_${edge.source}_${edge.target}`,
      vars: [
        { name: edge.target, coef: 1 },
        { name: edge.source, coef: -1 },
      ],
      bnds: { type: glpk.GLP_LO, lb: 1, ub: Infinity },
    });
  });
  return constraints;
}

function createPositiveConstraints(vertices: string[], glpk: GLPK): GLPKConstraint[] {
  return vertices.map((v) => ({
    name: `positive_${v}`,
    vars: [{ name: v, coef: 1 }],
    bnds: { type: glpk.GLP_LO, lb: 0, ub: Infinity },
  }));
}

export async function assignLayers(layout: OCDFGLayout) {
  const glpk = await getGLPKInstance();

  const activityIds = Object.values(layout.nodes)
    .filter((node) => node.type === OCDFGLayout.ACTIVITY_TYPE)
    .map((node) => node.id);

  const objectiveVars = createObjective(layout);
  const arcConstraints = createArcConstraints(layout, glpk);
  const positiveConstraints = createPositiveConstraints(activityIds, glpk);

  const lp = {
    name: 'OCDFG Layer Assignment',
    objective: {
      direction: glpk.GLP_MIN,
      name: 'Minimise total edge span',
      vars: objectiveVars,
    },
    subjectTo: [...arcConstraints, ...positiveConstraints],
    integers: activityIds,
  };

  const result = await glpk.solve(lp);
  if (
    result.result.status !== glpk.GLP_OPT &&
    result.result.status !== glpk.GLP_FEAS &&
    result.result.status !== glpk.GLP_INT
  ) {
    throw new Error('Failed to compute layer assignment');
  }

  const layering: Record<number, string[]> = {};
  Object.entries(result.result.vars).forEach(([nodeId, layer]) => {
    const numericLayer = Math.max(0, Math.floor(layer));
    if (!layering[numericLayer]) layering[numericLayer] = [];
    layering[numericLayer].push(nodeId);
    if (layout.nodes[nodeId]) {
      layout.nodes[nodeId].layer = numericLayer;
    }
  });

  const layeringArray = Object.keys(layering)
    .map((layer) => Number(layer))
    .sort((a, b) => a - b)
    .map((layer) => layering[layer]);

  layout.updateLayering(layeringArray);
}

