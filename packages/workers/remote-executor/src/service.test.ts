import assert from 'node:assert/strict'
import test from 'node:test'

import {
  RemoteExecutorWorkerError,
  remoteExecutorErrorPayloadFromUnknown,
  remoteWorkerManifestSchema
} from './contract.js'
import {
  createWorkerHashManifest,
  normalizeSlurmStatus,
  sanitizeRemoteTarget
} from './service.js'

test('normalizes common Slurm states into remote executor status buckets', () => {
  assert.deepEqual(normalizeSlurmStatus('PENDING'), {
    raw: 'PENDING',
    slurmState: 'PENDING',
    state: 'queued',
    terminal: false
  })
  assert.deepEqual(normalizeSlurmStatus('RUNNING'), {
    raw: 'RUNNING',
    slurmState: 'RUNNING',
    state: 'running',
    terminal: false
  })
  assert.deepEqual(normalizeSlurmStatus('COMPLETED'), {
    raw: 'COMPLETED',
    slurmState: 'COMPLETED',
    state: 'succeeded',
    terminal: true
  })
  assert.deepEqual(normalizeSlurmStatus({ JobState: 'FAILED', Reason: 'NonZeroExitCode', ExitCode: '1:0' }), {
    raw: 'FAILED',
    slurmState: 'FAILED',
    state: 'failed',
    terminal: true,
    reason: 'NonZeroExitCode',
    exitCode: '1:0'
  })
  assert.equal(normalizeSlurmStatus('State=CANCELLED Reason=UserRequest').state, 'cancelled')
  assert.equal(normalizeSlurmStatus('TIMEOUT').state, 'timeout')
  assert.equal(normalizeSlurmStatus('MYSTERY_STATE').state, 'unknown')
})

test('sanitizes targets without leaking secret-bearing fields', () => {
  const target = sanitizeRemoteTarget({
    label: '  Lab GPU  ',
    kind: 'ssh',
    host: ' gpu.example.test ',
    user: 'alice',
    port: 2222,
    tags: ['gpu', ' gpu ', 'prod'],
    password: 'secret',
    private_key: 'secret-key'
  })

  assert.equal(target.id, 'alice-gpu.example.test-2222')
  assert.equal(target.label, 'Lab GPU')
  assert.equal(target.host, 'gpu.example.test')
  assert.equal(target.user, 'alice')
  assert.deepEqual(target.tags, ['gpu', 'prod'])
  assert.equal('password' in target, false)
  assert.equal('private_key' in target, false)
})

test('creates worker hash manifest with stable shape', () => {
  const manifest = createWorkerHashManifest([{
    path: 'remote_worker.py',
    content: 'print("hello")\n',
    mode: '0644'
  }], {
    version: '0.1.0',
    createdAt: '2026-06-30T00:00:00.000Z'
  })

  remoteWorkerManifestSchema.parse(manifest)
  assert.equal(manifest.protocol, 'sciforge.remote-worker.v1')
  assert.equal(manifest.entrypoint, 'remote_worker.py')
  assert.equal(manifest.files[0]?.sha256, 'b80792336156c7b0f7fe02eeef24610d2d52a10d1810397744471d1dc5738180')
  assert.equal(manifest.files[0]?.sizeBytes, 15)
  assert.ok(manifest.capabilities.includes('slurm-stub'))
})

test('maps errors to the public remote executor error shape', () => {
  const payload = remoteExecutorErrorPayloadFromUnknown(new RemoteExecutorWorkerError({
    code: 'target_not_found',
    reason: 'Target missing.',
    retryable: false,
    suggestion: 'Call remote_list_targets.',
    targetId: 'gpu-a'
  }))

  assert.deepEqual(payload, {
    code: 'target_not_found',
    reason: 'Target missing.',
    retryable: false,
    suggestion: 'Call remote_list_targets.',
    targetId: 'gpu-a'
  })
})
