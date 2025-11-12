import type { DfgLink, DfgNode } from '@/utils/GraphLayouter';

export interface OcdfgMockData {
  nodes: DfgNode[];
  links: DfgLink[];
}

export const hrCompanyWorkersOcdfgMock: OcdfgMockData = {
  nodes: [
    {
      label: 'hire HR',
      types: ['HR', 'Company'],
      role: null,
      object_type: null,
      id: 'hire HR',
    },
    {
      label: 'quite HR',
      types: ['HR', 'Company'],
      role: null,
      object_type: null,
      id: 'quite HR',
    },
    {
      label: 'promote',
      types: ['Worker', 'Company'],
      role: null,
      object_type: null,
      id: 'promote',
    },
    {
      label: 'adjust contract',
      types: ['Company'],
      role: null,
      object_type: null,
      id: 'adjust contract',
    },
    {
      label: 'hire worker',
      types: ['Worker', 'Company'],
      role: null,
      object_type: null,
      id: 'hire worker',
    },
    {
      label: 'quit worker',
      types: ['Worker', 'Company'],
      role: null,
      object_type: null,
      id: 'quit worker',
    },
    // Start/End nodes per object type
    {
      label: 'HR start',
      types: ['HR'],
      role: 'start',
      object_type: 'HR',
      id: '__start__:HR',
    },
    {
      label: 'HR end',
      types: ['HR'],
      role: 'end',
      object_type: 'HR',
      id: '__end__:HR',
    },
    {
      label: 'Worker start',
      types: ['Worker'],
      role: 'start',
      object_type: 'Worker',
      id: '__start__:Worker',
    },
    {
      label: 'Worker end',
      types: ['Worker'],
      role: 'end',
      object_type: 'Worker',
      id: '__end__:Worker',
    },
    {
      label: 'Company start',
      types: ['Company'],
      role: 'start',
      object_type: 'Company',
      id: '__start__:Company',
    },
    {
      label: 'Company end',
      types: ['Company'],
      role: 'end',
      object_type: 'Company',
      id: '__end__:Company',
    },
  ],
  links: [
    // Starts
    {
      weights: { HR: 1 },
      weight: 1,
      owners: ['HR'],
      role: 'start',
      source: '__start__:HR',
      target: 'hire HR',
    },
    {
      weights: { Company: 1 },
      weight: 1,
      owners: ['Company'],
      role: 'start',
      source: '__start__:Company',
      target: 'hire HR',
    },
    {
      weights: { Worker: 1 },
      weight: 1,
      owners: ['Worker'],
      role: 'start',
      source: '__start__:Worker',
      target: 'hire worker',
    },
    {
      weights: { Company: 1 },
      weight: 1,
      owners: ['Company'],
      role: 'start',
      source: '__start__:Company',
      target: 'hire worker',
    },

    // HR-centric and Company-centric flows
    {
      weights: { HR: 1 },
      weight: 1,
      owners: ['HR'],
      source: 'hire HR',
      target: 'quite HR',
    },
    {
      weights: { Company: 1 },
      weight: 1,
      owners: ['Company'],
      source: 'hire HR',
      target: 'adjust contract',
    },
    {
      weights: { Company: 1 },
      weight: 1,
      owners: ['Company'],
      source: 'adjust contract',
      target: 'quite HR',
    },

    // Worker/Company flows
    {
      weights: { Worker: 1, Company: 1 },
      weight: 2,
      owners: ['Worker', 'Company'],
      source: 'hire worker',
      target: 'promote',
    },
    {
      weights: { Worker: 1 },
      weight: 1,
      owners: ['Worker'],
      source: 'hire worker',
      target: 'quit worker',
    },
    {
      weights: { Company: 1 },
      weight: 1,
      owners: ['Company'],
      source: 'promote',
      target: 'adjust contract',
    },
    {
      weights: { Worker: 1 },
      weight: 1,
      owners: ['Worker'],
      source: 'promote',
      target: 'quit worker',
    },

    // Ends
    {
      weights: { HR: 1 },
      weight: 1,
      owners: ['HR'],
      role: 'end',
      source: 'quite HR',
      target: '__end__:HR',
    },
    {
      weights: { Worker: 1 },
      weight: 1,
      owners: ['Worker'],
      role: 'end',
      source: 'quit worker',
      target: '__end__:Worker',
    },
    {
      weights: { Company: 1 },
      weight: 1,
      owners: ['Company'],
      role: 'end',
      source: 'adjust contract',
      target: '__end__:Company',
    },
    {
      weights: { Company: 1 },
      weight: 1,
      owners: ['Company'],
      role: 'end',
      source: 'quit worker',
      target: '__end__:Company',
    },
  ],
};
