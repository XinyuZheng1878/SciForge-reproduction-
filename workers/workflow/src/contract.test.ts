import assert from 'node:assert/strict'
import test from 'node:test'

import {
  WORKFLOW_TOOL_CONTRACTS,
  WorkflowFacadeErrorSchema,
  WorkflowImportInputSchema,
  WorkflowRunInputSchema,
  WorkflowSideEffectCategorySchema,
  WorkflowStopInputSchema,
  workflowRunResourceUri,
  workflowSchemaResourceUri
} from './contract.js'
import { validateInputAgainstFields } from './service.js'

test('validates workflow run input schema', () => {
  assert.equal(WorkflowRunInputSchema.safeParse({ input: { topic: 'cells' } }).success, false)
  assert.equal(WorkflowRunInputSchema.safeParse({
    workflow_id: 'wf-1',
    input: { topic: 'cells' },
    dry_run: true
  }).success, true)
})

test('validates workflow import document shape', () => {
  assert.equal(WorkflowImportInputSchema.safeParse({ workflow: {} }).success, false)
  assert.equal(WorkflowImportInputSchema.safeParse({
    workflow: {
      name: 'Paper digest',
      nodes: [{ id: 'trigger', type: 'manual-trigger', config: {} }],
      connections: []
    },
    preview: true
  }).success, true)
})

test('keeps workflow side-effect contract aligned with MCP annotations', () => {
  for (const contract of Object.values(WORKFLOW_TOOL_CONTRACTS)) {
    assert.equal(WorkflowSideEffectCategorySchema.safeParse(contract.sideEffect).success, true)
    assert.equal(contract.annotations.readOnlyHint, contract.sideEffect === 'read-only')
    assert.equal(contract.annotations.destructiveHint, contract.sideEffect === 'destructive')
    assert.equal(contract.annotations.openWorldHint, false)
  }

  assert.equal(WORKFLOW_TOOL_CONTRACTS.gui_workflow_run.sideEffect, 'write')
  assert.equal(WORKFLOW_TOOL_CONTRACTS.gui_workflow_import.sideEffect, 'write')
  assert.equal(WORKFLOW_TOOL_CONTRACTS.gui_workflow_stop.sideEffect, 'destructive')
  assert.equal(WORKFLOW_TOOL_CONTRACTS.gui_workflow_stop.annotations.destructiveHint, true)
})

test('validates stop confirmation and confirmation_required error schema', () => {
  assert.equal(WorkflowStopInputSchema.safeParse({ run_id: 'run-1', dry_run: true }).success, true)
  assert.equal(WorkflowStopInputSchema.safeParse({ run_id: 'run-1', confirmation: 'stop run-1' }).success, true)
  assert.equal(WorkflowStopInputSchema.safeParse({ run_id: 'run-1', confirmation: '' }).success, false)
  assert.equal(WorkflowFacadeErrorSchema.safeParse({
    code: 'confirmation_required',
    reason: 'Confirmation is required.',
    retryable: false,
    suggestion: 'Retry with confirmation.'
  }).success, true)
})

test('validates required input fields against callable schema', () => {
  const missing = validateInputAgainstFields([
    { key: 'topic', type: 'text', required: true },
    { key: 'limit', type: 'number', required: false }
  ], { limit: 'many' }, 'wf-1')

  assert.equal(missing.valid, false)
  assert.deepEqual(missing.issues.map((issue) => issue.code), [
    'missing_required_input',
    'invalid_input_type'
  ])
})

test('builds workflow resource uris', () => {
  assert.equal(workflowRunResourceUri('run 1'), 'workflow://run/run%201')
  assert.equal(workflowSchemaResourceUri('wf/1'), 'workflow://schema/wf%2F1')
})
