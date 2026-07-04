/**
 * Ground-truth fixtures generated from totem_lib's Python playout
 * (totem_lib/tests/assets/example_occns.py). sequenceCount is the number
 * of valid binding sequences produced by occn_playout with a uniform
 * max_bindings_per_activity limit (applied to START_/END_ too).
 * Regenerate with the script in the PR description if semantics change.
 */

import type { OccnActivityBindings } from '../../../editors/shared/model-types';

export type ParityScenario = {
  objects: Record<string, number>;
  maxBindings: number;
  sequenceCount: number;
};

export type ParityFixture = {
  name: string;
  markerGroups: Record<string, OccnActivityBindings>;
  scenarios: ParityScenario[];
};

export const PARITY_FIXTURES: ParityFixture[] = [
  {
    name: "occn_basic",
    markerGroups: {"START_order":{"omg":[[["a","order",[1,1],0]]]},"START_item":{"omg":[[["a","item",[1,-1],0]]]},"a":{"img":[[["START_order","order",[1,1],0],["START_item","item",[1,-1],0]]],"omg":[[["END_order","order",[1,1],0],["END_item","item",[1,-1],0]]]},"END_order":{"img":[[["a","order",[1,1],0]]]},"END_item":{"img":[[["a","item",[1,-1],0]]]}},
    scenarios: [{"objects":{"order":1,"item":1},"maxBindings":3,"sequenceCount":4},{"objects":{"order":1,"item":2},"maxBindings":3,"sequenceCount":64},{"objects":{"order":2,"item":2},"maxBindings":3,"sequenceCount":11216}],
  },
  {
    name: "occn_basic_2",
    markerGroups: {"START_container":{"omg":[[["c","container",[1,1],0],["i","container",[1,1],0]]]},"c":{"img":[[["START_container","container",[1,1],0]]],"omg":[[["e","container",[1,1],0]]]},"i":{"img":[[["START_container","container",[1,1],0]]],"omg":[[["e","container",[1,1],0]]]},"e":{"img":[[["c","container",[1,1],0],["i","container",[1,1],0]]],"omg":[[["s","container",[1,1],0]]]},"START_order":{"omg":[[["a","order",[1,1],0]],[["b","order",[1,1],0]]]},"a":{"img":[[["START_order","order",[1,1],0]]],"omg":[[["b","order",[1,1],0]]]},"b":{"img":[[["START_order","order",[1,1],0]],[["a","order",[1,1],0]]],"omg":[[["s","order",[1,1],0]]]},"START_box":{"omg":[[["d","box",[1,1],0]]]},"d":{"img":[[["START_box","box",[1,1],0]]],"omg":[[["s","box",[1,1],0]]]},"s":{"img":[[["e","container",[1,1],0],["b","order",[1,-1],0]],[["d","box",[1,1],0],["b","order",[1,1],0]]],"omg":[[["END_container","container",[1,1],0],["r","order",[1,-1],0]],[["END_box","box",[1,1],0],["r","order",[1,1],0]]]},"END_container":{"img":[[["s","container",[1,1],0]]]},"END_box":{"img":[[["s","box",[1,1],0]]]},"r":{"img":[[["s","order",[1,1],0]],[["s","order",[1,-1],0]]],"omg":[[["ti","order",[1,1],1],["si","order",[0,-1],1],["da","order",[1,1],2],["ba","order",[0,-1],2]]]},"ti":{"img":[[["r","order",[1,1],0]]],"omg":[[["END_order","order",[1,1],0]]]},"si":{"img":[[["r","order",[1,-1],0]]],"omg":[[["END_order","order",[1,-1],0]]]},"da":{"img":[[["r","order",[1,1],0]]],"omg":[[["END_order","order",[1,1],0]]]},"ba":{"img":[[["r","order",[1,-1],0]]],"omg":[[["END_order","order",[1,-1],0]]]},"END_order":{"img":[[["ti","order",[1,1],0]],[["si","order",[1,1],0]],[["da","order",[1,1],0]],[["ba","order",[1,1],0]]]}},
    scenarios: [{"objects":{"container":1,"order":1,"box":1},"maxBindings":2,"sequenceCount":0}],
  },
  {
    name: "occn_basic_3",
    markerGroups: {"START_order":{"img":[],"omg":[[["a","order",[1,1],0]]]},"a":{"img":[[["START_order","order",[1,1],0]]],"omg":[[["END_order","order",[1,1],0]]]},"END_order":{"img":[[["a","order",[1,1],0]]]}},
    scenarios: [{"objects":{"order":1},"maxBindings":3,"sequenceCount":1},{"objects":{"order":2},"maxBindings":3,"sequenceCount":20}],
  },
  {
    name: "occn_multi",
    markerGroups: {"START_order":{"img":[],"omg":[[["a","order",[1,-1],0]]]},"a":{"img":[[["START_order","order",[1,-1],0]]],"omg":[[["END_order","order",[1,-1],0]]]},"END_order":{"img":[[["a","order",[1,-1],0]]]}},
    scenarios: [{"objects":{"order":1},"maxBindings":3,"sequenceCount":1},{"objects":{"order":2},"maxBindings":3,"sequenceCount":43},{"objects":{"order":3},"maxBindings":3,"sequenceCount":7117}],
  },
  {
    name: "occn_combined",
    markerGroups: {"START_order":{"img":[],"omg":[[["a","order",[1,1],0]],[["a","order",[1,-1],0]]]},"a":{"img":[[["START_order","order",[1,1],0]]],"omg":[[["END_order","order",[1,1],0]]]},"END_order":{"img":[[["a","order",[1,1],0]],[["a","order",[1,-1],0]]]}},
    scenarios: [{"objects":{"order":1},"maxBindings":3,"sequenceCount":1},{"objects":{"order":2},"maxBindings":3,"sequenceCount":34}],
  },
  {
    name: "occn_multi_marker",
    markerGroups: {"START_order":{"img":[],"omg":[[["a","order",[1,-1],0]]]},"a":{"img":[[["START_order","order",[2,2],0]]],"omg":[[["END_order","order",[1,1],0],["b","order",[1,1],0]]]},"b":{"img":[[["a","order",[1,1],0]]],"omg":[[["END_order","order",[1,1],0]]]},"END_order":{"img":[[["a","order",[1,1],0]],[["b","order",[1,1],0]]]}},
    scenarios: [{"objects":{"order":2},"maxBindings":3,"sequenceCount":18},{"objects":{"order":2},"maxBindings":2,"sequenceCount":18}],
  },
  {
    name: "occn_multi_square_marker",
    markerGroups: {"START_order":{"img":[],"omg":[[["a","order",[1,-1],0]]]},"a":{"img":[[["START_order","order",[1,-1],0]]],"omg":[[["END_order","order",[1,-1],0],["b","order",[1,1],0]]]},"b":{"img":[[["a","order",[1,1],0]]],"omg":[[["END_order","order",[1,1],0]]]},"END_order":{"img":[[["a","order",[1,-1],0],["b","order",[1,1],0]]]}},
    scenarios: [{"objects":{"order":1},"maxBindings":3,"sequenceCount":1},{"objects":{"order":2},"maxBindings":3,"sequenceCount":180}],
  },
  {
    name: "occn_triple_marker",
    markerGroups: {"START_order":{"img":[],"omg":[[["a","order",[1,-1],0]]]},"a":{"img":[[["START_order","order",[1,-1],0]]],"omg":[[["END_order","order",[1,-1],0],["b","order",[1,1],0],["c","order",[1,-1],0]]]},"b":{"img":[[["a","order",[1,1],0]]],"omg":[[["END_order","order",[1,1],0]]]},"c":{"img":[[["a","order",[1,-1],0]]],"omg":[[["END_order","order",[1,-1],0]]]},"END_order":{"img":[[["a","order",[1,-1],0],["b","order",[1,1],0],["c","order",[1,-1],0]]]}},
    scenarios: [{"objects":{"order":1},"maxBindings":3,"sequenceCount":2},{"objects":{"order":2},"maxBindings":3,"sequenceCount":5804}],
  },
  {
    name: "occn_key",
    markerGroups: {"START_order":{"img":[],"omg":[[["a","order",[1,-1],0]]]},"a":{"img":[[["START_order","order",[1,-1],0]]],"omg":[[["END_order","order",[1,-1],1],["b","order",[1,1],1],["c","order",[1,-1],1]]]},"b":{"img":[[["a","order",[1,1],0]]],"omg":[[["END_order","order",[1,1],0]]]},"c":{"img":[[["a","order",[1,-1],0]]],"omg":[[["END_order","order",[1,-1],0]]]},"END_order":{"img":[[["a","order",[1,-1],0],["b","order",[1,1],0],["c","order",[1,-1],0]]]}},
    scenarios: [{"objects":{"order":1},"maxBindings":3,"sequenceCount":0},{"objects":{"order":2},"maxBindings":3,"sequenceCount":0},{"objects":{"order":3},"maxBindings":2,"sequenceCount":84}],
  },
  {
    name: "occn_key_input",
    markerGroups: {"START_order":{"img":[],"omg":[[["a","order",[1,-1],0]]]},"a":{"img":[[["START_order","order",[1,-1],0]]],"omg":[[["END_order","order",[1,-1],1],["b","order",[1,1],1],["c","order",[1,-1],1]]]},"b":{"img":[[["a","order",[1,1],0]]],"omg":[[["END_order","order",[1,1],0]]]},"c":{"img":[[["a","order",[1,-1],0]]],"omg":[[["END_order","order",[1,-1],0]]]},"END_order":{"img":[[["a","order",[1,-1],1],["b","order",[1,1],1],["c","order",[1,-1],1]]]}},
    scenarios: [{"objects":{"order":2},"maxBindings":3,"sequenceCount":0},{"objects":{"order":3},"maxBindings":2,"sequenceCount":84}],
  },
  {
    name: "occn_key_order",
    markerGroups: {"START_order":{"img":[],"omg":[[["a","order",[1,-1],0]]]},"a":{"img":[[["START_order","order",[1,-1],0]]],"omg":[[["END_order","order",[1,-1],1],["b","order",[1,1],0],["c","order",[1,-1],1]]]},"b":{"img":[[["a","order",[1,1],0]]],"omg":[[["END_order","order",[1,1],0]]]},"c":{"img":[[["a","order",[1,-1],0]]],"omg":[[["END_order","order",[1,-1],0]]]},"END_order":{"img":[[["a","order",[1,-1],0],["b","order",[1,1],0],["c","order",[1,-1],0]]]}},
    scenarios: [{"objects":{"order":2},"maxBindings":3,"sequenceCount":24}],
  },
  {
    name: "occn_multi_key",
    markerGroups: {"START_order":{"img":[],"omg":[[["a","order",[1,-1],0]]]},"a":{"img":[[["START_order","order",[1,-1],0]]],"omg":[[["END_order","order",[1,-1],1],["b","order",[1,1],1],["c","order",[1,-1],1]],[["END_order","order",[1,-1],2],["b","order",[1,1],2]]]},"b":{"img":[[["a","order",[1,1],0]]],"omg":[[["END_order","order",[1,1],0]]]},"c":{"img":[[["a","order",[1,-1],0]]],"omg":[[["END_order","order",[1,-1],0]]]},"END_order":{"img":[[["a","order",[1,-1],0],["b","order",[1,1],0],["c","order",[1,-1],0]]]}},
    scenarios: [{"objects":{"order":2},"maxBindings":3,"sequenceCount":0}],
  },
  {
    name: "occn_multi_key_2",
    markerGroups: {"START_order":{"img":[],"omg":[[["a","order",[1,-1],0]]]},"a":{"img":[[["START_order","order",[1,-1],0]]],"omg":[[["END_order","order",[1,-1],1],["b","order",[1,1],2],["c","order",[1,-1],1],["d","order",[1,1],2]]]},"b":{"img":[[["a","order",[1,1],0]]],"omg":[[["END_order","order",[1,1],0]]]},"c":{"img":[[["a","order",[1,-1],0]]],"omg":[[["END_order","order",[1,-1],0]]]},"d":{"img":[[["a","order",[1,1],0]]],"omg":[[["END_order","order",[1,1],0]]]},"END_order":{"img":[[["a","order",[1,-1],0],["b","order",[1,1],0],["c","order",[1,-1],0],["d","order",[1,1],0]]]}},
    scenarios: [{"objects":{"order":2},"maxBindings":3,"sequenceCount":72},{"objects":{"order":3},"maxBindings":2,"sequenceCount":5544}],
  },
  {
    name: "occn_multi_ot",
    markerGroups: {"START_order":{"img":[],"omg":[[["a","order",[1,1],0]]]},"START_item":{"img":[],"omg":[[["a","item",[1,-1],0]]]},"a":{"img":[[["START_order","order",[1,1],0],["START_item","item",[1,-1],0]]],"omg":[[["END_order","order",[1,1],0],["END_item","item",[1,-1],0]]]},"END_order":{"img":[[["a","order",[1,1],0]]]},"END_item":{"img":[[["a","item",[1,-1],0]]]}},
    scenarios: [{"objects":{"order":1,"item":1},"maxBindings":3,"sequenceCount":4},{"objects":{"order":1,"item":2},"maxBindings":3,"sequenceCount":64}],
  },
  {
    name: "occn_multi_ot_multi_arc",
    markerGroups: {"START_order":{"omg":[[["a","order",[1,1],0]]]},"START_item":{"omg":[[["a","item",[1,-1],0]]]},"a":{"img":[[["START_order","order",[1,1],0],["START_item","item",[1,-1],0]]],"omg":[[["b","order",[1,1],0],["b","item",[1,-1],0]]]},"b":{"img":[[["a","order",[1,1],0],["a","item",[1,-1],0]]],"omg":[[["END_order","order",[1,1],0],["END_item","item",[1,-1],0]]]},"END_order":{"img":[[["b","order",[1,1],0]]]},"END_item":{"img":[[["b","item",[1,-1],0]]]}},
    scenarios: [{"objects":{"order":1,"item":2},"maxBindings":3,"sequenceCount":64}],
  },
  {
    name: "occn_multi_ot_multi_min_0",
    markerGroups: {"START_order":{"omg":[[["a","order",[1,1],0]]]},"START_item":{"omg":[[["a","item",[1,-1],0]]]},"a":{"img":[[["START_order","order",[1,1],0],["START_item","item",[0,-1],0]]],"omg":[[["b","order",[1,1],0],["b","item",[0,-1],0]]]},"b":{"img":[[["a","order",[1,1],0],["a","item",[0,-1],0]]],"omg":[[["END_order","order",[1,1],0],["END_item","item",[0,-1],0]]]},"END_order":{"img":[[["b","order",[1,1],0]]]},"END_item":{"img":[[["b","item",[1,-1],0]]]}},
    scenarios: [{"objects":{"order":1,"item":1},"maxBindings":3,"sequenceCount":4},{"objects":{"order":1,"item":2},"maxBindings":3,"sequenceCount":64}],
  },
  {
    name: "occn_multi_ot_multi_marker",
    markerGroups: {"START_order":{"img":[],"omg":[[["a","order",[1,1],0]]]},"START_item":{"img":[],"omg":[[["a","item",[1,-1],0]]]},"a":{"img":[[["START_order","order",[1,1],0],["START_item","item",[1,-1],0]],[["START_item","item",[1,-1],0]]],"omg":[[["END_order","order",[1,1],0],["END_item","item",[1,-1],0]],[["END_item","item",[1,-1],0]]]},"END_order":{"img":[[["a","order",[1,1],0]]]},"END_item":{"img":[[["a","item",[1,-1],0]]]}},
    scenarios: [{"objects":{"order":1,"item":2},"maxBindings":3,"sequenceCount":736}],
  },
  {
    name: "occn_ABC",
    markerGroups: {"START_order":{"img":[],"omg":[[["a","order",[1,1],0]]]},"a":{"img":[[["START_order","order",[1,1],0]]],"omg":[[["b","order",[1,1],0]]]},"b":{"img":[[["a","order",[1,1],0]]],"omg":[[["c","order",[1,1],0]]]},"c":{"img":[[["b","order",[1,1],0]]],"omg":[[["END_order","order",[1,1],0]]]},"END_order":{"img":[[["c","order",[1,1],0]]]}},
    scenarios: [{"objects":{"order":1},"maxBindings":3,"sequenceCount":1},{"objects":{"order":2},"maxBindings":3,"sequenceCount":252},{"objects":{"order":2},"maxBindings":1,"sequenceCount":0},{"objects":{"order":2},"maxBindings":2,"sequenceCount":252}],
  },
  {
    name: "occn_start_parallel",
    markerGroups: {"START_order":{"img":[],"omg":[[["a","order",[1,1],0],["b","order",[1,1],0]],[["a","order",[1,-1],0]],[["b","order",[1,-1],0]]]},"a":{"img":[[["START_order","order",[1,1],0]]],"omg":[[["END_order","order",[1,1],0]]]},"b":{"img":[[["START_order","order",[1,1],0]]],"omg":[[["END_order","order",[1,1],0]]]},"END_order":{"img":[[["a","order",[1,1],0],["b","order",[1,1],0]],[["a","order",[1,-1],0]],[["b","order",[1,-1],0]]]}},
    scenarios: [{"objects":{"order":1},"maxBindings":3,"sequenceCount":10},{"objects":{"order":2},"maxBindings":2,"sequenceCount":1792}],
  },
];
