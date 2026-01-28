import type { DfgLink, DfgNode } from '@/utils/GraphLayouter';

export interface OcdfgMockData {
  nodes: DfgNode[];
  links: DfgLink[];
}

const makeTerminal = (type: string, role: 'start' | 'end') => ({
  label: `${type} ${role}`,
  types: [type],
  role,
  object_type: type,
  id: `__${role}__:${type}`,
});

export const orderItemOcdfgMock: OcdfgMockData = {
  nodes: [
    ...['Order', 'Item'].flatMap((type) => [
      makeTerminal(type, 'start'),
      makeTerminal(type, 'end'),
    ]),
    { id: 'create_order', label: 'create order', types: ['Order', 'Item', 'Company'], role: null, object_type: null },
    { id: 'produce_item', label: 'produce item', types: ['Item', 'Worker', 'Company', 'Factory'], role: null, object_type: null },
    { id: 'package_order', label: 'package order', types: ['Order', 'Item', 'Worker', 'Company', 'Factory'], role: null, object_type: null },
    { id: 'send_order', label: 'send order', types: ['Order', 'Item', 'Worker', 'Company', 'Warehouse'], role: null, object_type: null },
  ],
  links: [
    // Order path: start -> create_order -> package_order -> send_order -> end
    { source: '__start__:Order', target: 'create_order', owners: ['Order'], weight: 1 },
    { source: 'create_order', target: 'package_order', owners: ['Order'], weight: 1 },
    { source: 'package_order', target: 'send_order', owners: ['Order'], weight: 1 },
    { source: 'send_order', target: '__end__:Order', owners: ['Order'], weight: 1 },
    // Item path: start -> create_order -> produce_item -> package_order -> send_order -> end
    { source: '__start__:Item', target: 'create_order', owners: ['Item'], weight: 1 },
    { source: 'create_order', target: 'produce_item', owners: ['Item'], weight: 1 },
    { source: 'produce_item', target: 'package_order', owners: ['Item'], weight: 1 },
    { source: 'package_order', target: 'send_order', owners: ['Item'], weight: 1 },
    { source: 'send_order', target: '__end__:Item', owners: ['Item'], weight: 1 },
  ],
};

export const hrWorkerOcdfgMock: OcdfgMockData = {
  nodes: [
    ...['HR', 'Worker'].flatMap((type) => [makeTerminal(type, 'start'), makeTerminal(type, 'end')]),
    { id: 'hire_hr', label: 'hire HR', types: ['HR', 'Company'], role: null, object_type: null },
    { id: 'quit_hr', label: 'quit HR', types: ['HR', 'Company'], role: null, object_type: null },
    { id: 'promote', label: 'promote', types: ['HR', 'Worker', 'Company'], role: null, object_type: null },
    { id: 'adjust_contract', label: 'adjust contract', types: ['HR', 'Company'], role: null, object_type: null },
    { id: 'hire_worker', label: 'hire worker', types: ['Worker', 'Company'], role: null, object_type: null },
    { id: 'quit_worker', label: 'quit worker', types: ['Worker', 'Company'], role: null, object_type: null },
  ],
  links: [
    // HR lane - Path 1: Hire HR -> Quit HR
    { source: '__start__:HR', target: 'hire_hr', owners: ['HR'], weight: 1 },
    { source: 'hire_hr', target: 'quit_hr', owners: ['HR'], weight: 1 },
    // HR lane - Path 2: Hire HR -> (Promote -> Adjust Contract)^n -> Quit HR
    { source: 'hire_hr', target: 'promote', owners: ['HR'], weight: 1 },
    { source: 'promote', target: 'adjust_contract', owners: ['HR'], weight: 1 },
    { source: 'adjust_contract', target: 'promote', owners: ['HR'], weight: 1 },
    { source: 'adjust_contract', target: 'quit_hr', owners: ['HR'], weight: 1 },
    { source: 'quit_hr', target: '__end__:HR', owners: ['HR'], weight: 1 },
    // Worker lane
    { source: '__start__:Worker', target: 'hire_worker', owners: ['Worker'], weight: 1 },
    { source: 'hire_worker', target: 'promote', owners: ['Worker'], weight: 1 },
    { source: 'promote', target: 'promote', owners: ['Worker'], weight: 1 },
    { source: 'promote', target: 'adjust_contract', owners: ['Worker'], weight: 1 },
    { source: 'promote', target: 'quit_worker', owners: ['Worker'], weight: 1 },
    { source: 'quit_worker', target: '__end__:Worker', owners: ['Worker'], weight: 1 },
  ],
};

export const companyLifecycleOcdfgMock: OcdfgMockData = {
  nodes: [
    makeTerminal('Company', 'start'),
    makeTerminal('Company', 'end'),
    { id: 'founding', label: 'founding', types: ['Company'], role: null, object_type: null },
    { id: 'closing', label: 'closing', types: ['Company'], role: null, object_type: null },
  ],
  links: [
    { source: '__start__:Company', target: 'founding', owners: ['Company'], weight: 1 },
    { source: 'founding', target: 'closing', owners: ['Company'], weight: 1 },
    { source: 'founding', target: '__end__:Company', owners: ['Company'], weight: 1 },
    { source: 'closing', target: '__end__:Company', owners: ['Company'], weight: 1 },
  ],
};

export const factoryOcdfgMock: OcdfgMockData = {
  nodes: [
    makeTerminal('Factory', 'start'),
    makeTerminal('Factory', 'end'),
    makeTerminal('Warehouse', 'start'),
    makeTerminal('Warehouse', 'end'),
    { id: 'prep_materials', label: 'prepare materials', types: ['Factory', 'Warehouse'], role: null, object_type: null },
    { id: 'setup_line', label: 'setup line', types: ['Factory'], role: null, object_type: null },
    { id: 'run_batch', label: 'run batch', types: ['Factory'], role: null, object_type: null },
    { id: 'inspect_batch', label: 'inspect batch', types: ['Factory'], role: null, object_type: null },
    { id: 'store_goods', label: 'store goods', types: ['Factory', 'Warehouse'], role: null, object_type: null },
  ],
  links: [
    { source: '__start__:Factory', target: 'prep_materials', owners: ['Factory'], weight: 1 },
    { source: 'prep_materials', target: 'setup_line', owners: ['Factory'], weight: 1 },
    { source: 'setup_line', target: 'run_batch', owners: ['Factory'], weight: 1 },
    { source: 'run_batch', target: 'inspect_batch', owners: ['Factory'], weight: 1 },
    { source: 'inspect_batch', target: 'store_goods', owners: ['Factory'], weight: 1 },
    { source: 'store_goods', target: '__end__:Factory', owners: ['Factory'], weight: 1 },
    { source: '__start__:Warehouse', target: 'prep_materials', owners: ['Warehouse'], weight: 1 },
    { source: 'prep_materials', target: 'store_goods', owners: ['Warehouse'], weight: 1 },
    { source: 'store_goods', target: '__end__:Warehouse', owners: ['Warehouse'], weight: 1 },
  ],
};

export const warehouseOcdfgMock: OcdfgMockData = {
  nodes: [
    makeTerminal('Warehouse', 'start'),
    makeTerminal('Warehouse', 'end'),
    { id: 'receive_goods', label: 'receive goods', types: ['Warehouse'], role: null, object_type: null },
    { id: 'inspect_goods', label: 'inspect goods', types: ['Warehouse'], role: null, object_type: null },
    { id: 'shelve_goods', label: 'shelve goods', types: ['Warehouse'], role: null, object_type: null },
    { id: 'pick_items', label: 'pick items', types: ['Warehouse'], role: null, object_type: null },
    { id: 'load_truck', label: 'load truck', types: ['Warehouse'], role: null, object_type: null },
  ],
  links: [
    { source: '__start__:Warehouse', target: 'receive_goods', owners: ['Warehouse'], weight: 1 },
    { source: 'receive_goods', target: 'inspect_goods', owners: ['Warehouse'], weight: 1 },
    { source: 'inspect_goods', target: 'shelve_goods', owners: ['Warehouse'], weight: 1 },
    { source: 'shelve_goods', target: 'pick_items', owners: ['Warehouse'], weight: 1 },
    { source: 'pick_items', target: 'load_truck', owners: ['Warehouse'], weight: 1 },
    { source: 'load_truck', target: '__end__:Warehouse', owners: ['Warehouse'], weight: 1 },
  ],
};

// Fallback alias for legacy imports
export const ocdfgDetailMiniMock = orderItemOcdfgMock;
