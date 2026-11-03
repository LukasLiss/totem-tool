/**
 * Small synthetic object-centric logs the layout tests run on. Each example
 * is a set of trace variants per object type; the DFG is derived with
 * `fromTraces`.
 */
import { fromTraces } from '../graph';
import type { LabGraph } from '../types';

export interface Example {
  id: string;
  label: string;
  description: string;
  build: () => LabGraph;
}

const orderToCash = () =>
  fromTraces({
    order: [
      [['place order', 'confirm order', 'pay order', 'ship order', 'close order'], 120],
      [['place order', 'confirm order', 'send reminder', 'pay order', 'ship order', 'close order'], 40],
      [['place order', 'confirm order', 'send reminder', 'send reminder', 'pay order', 'ship order', 'close order'], 12],
      [['place order', 'cancel order'], 18],
    ],
    item: [
      [['place order', 'pick item', 'pack item', 'ship order'], 300],
      [['place order', 'pick item', 'item out of stock', 'reorder item', 'pick item', 'pack item', 'ship order'], 45],
      [['place order', 'cancel order'], 30],
    ],
    package: [
      [['pack item', 'create package', 'ship order', 'deliver package'], 140],
      [['pack item', 'create package', 'ship order', 'failed delivery', 'deliver package'], 25],
    ],
    customer: [
      [['register customer', 'place order', 'pay order'], 60],
      [['register customer', 'place order', 'place order', 'pay order', 'pay order'], 20],
    ],
  });

const parallelAndChoices = () =>
  fromTraces({
    application: [
      [['submit', 'check credit', 'check identity', 'assess', 'approve', 'notify'], 50],
      [['submit', 'check identity', 'check credit', 'assess', 'approve', 'notify'], 45],
      [['submit', 'check credit', 'check identity', 'assess', 'reject', 'notify'], 20],
      [['submit', 'check identity', 'check credit', 'assess', 'reject', 'notify'], 18],
      [['submit', 'check credit', 'check identity', 'assess', 'request info', 'assess', 'approve', 'notify'], 12],
    ],
    document: [
      [['upload document', 'submit', 'check identity', 'archive'], 70],
      [['upload document', 'scan document', 'submit', 'check identity', 'archive'], 25],
    ],
    offer: [
      [['approve', 'create offer', 'send offer', 'accept offer'], 40],
      [['approve', 'create offer', 'send offer', 'decline offer'], 15],
      [['approve', 'create offer', 'send offer', 'revise offer', 'send offer', 'accept offer'], 10],
    ],
  });

const loopsAndRework = () =>
  fromTraces({
    ticket: [
      [['open', 'triage', 'work', 'test', 'resolve', 'close'], 80],
      [['open', 'triage', 'work', 'test', 'work', 'test', 'resolve', 'close'], 35],
      [['open', 'triage', 'work', 'test', 'resolve', 'reopen', 'work', 'test', 'resolve', 'close'], 15],
      [['open', 'triage', 'escalate', 'triage', 'work', 'test', 'resolve', 'close'], 12],
      [['open', 'triage', 'work', 'comment', 'comment', 'test', 'resolve', 'close'], 9],
    ],
    change: [
      [['work', 'create change', 'review change', 'merge change', 'test'], 70],
      [['work', 'create change', 'review change', 'rework change', 'review change', 'merge change', 'test'], 30],
    ],
    reviewer: [
      [['review change', 'review change', 'review change'], 20],
      [['review change', 'comment', 'review change'], 12],
    ],
  });

const manyTypes = () =>
  fromTraces({
    order: [
      [['create order', 'approve order', 'create invoice', 'ship', 'close order'], 100],
      [['create order', 'approve order', 'change order', 'approve order', 'create invoice', 'ship', 'close order'], 25],
    ],
    item: [
      [['create order', 'reserve item', 'pick', 'pack', 'ship'], 220],
      [['create order', 'reserve item', 'backorder', 'reserve item', 'pick', 'pack', 'ship'], 30],
    ],
    invoice: [
      [['create invoice', 'send invoice', 'receive payment', 'close order'], 90],
      [['create invoice', 'send invoice', 'dun', 'receive payment', 'close order'], 20],
    ],
    shipment: [
      [['pack', 'ship', 'track', 'deliver'], 80],
      [['pack', 'ship', 'track', 'track', 'deliver'], 30],
    ],
    payment: [[['receive payment', 'book payment'], 100]],
    vendor: [
      [['backorder', 'request quote', 'order from vendor', 'receive goods', 'reserve item'], 25],
    ],
    employee: [
      [['approve order', 'pick', 'pack', 'approve order', 'pick', 'pack'], 15],
      [['pick', 'pack', 'pick', 'pack'], 40],
    ],
  });

const tiny = () =>
  fromTraces({
    A: [
      [['a', 'b', 'c', 'd'], 10],
      [['a', 'c', 'b', 'd'], 8],
      [['a', 'b', 'c', 'b', 'c', 'd'], 3],
    ],
    B: [
      [['x', 'b', 'y'], 6],
      [['x', 'y'], 2],
    ],
  });

export const EXAMPLES: Example[] = [
  { id: 'o2c', label: 'Order to cash (4 types)', description: 'Choices, a reminder loop, a redo loop for out-of-stock items, self loops.', build: orderToCash },
  { id: 'parallel', label: 'Loan application (parallel)', description: 'Parallel checks, an approve/reject choice, an offer revision loop.', build: parallelAndChoices },
  { id: 'loops', label: 'Ticketing (nested loops)', description: 'Nested rework loops, reopen loop, reviewer self loops.', build: loopsAndRework },
  { id: 'many', label: 'Procurement (7 types)', description: 'Many object types sharing activities — lane order matters.', build: manyTypes },
  { id: 'tiny', label: 'Tiny (2 types)', description: 'Minimal example with parallelism and a loop.', build: tiny },
];
