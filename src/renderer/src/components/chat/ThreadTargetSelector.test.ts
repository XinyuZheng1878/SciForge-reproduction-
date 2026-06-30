import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { ThreadTargetSelectorView } from './ThreadTargetSelector'
import type { RemoteExecutorTargetV1 } from '@shared/app-settings'

const targets: RemoteExecutorTargetV1[] = [
  {
    id: 'ssh-dev',
    label: 'SSH Dev',
    enabled: true,
    kind: 'ssh',
    ssh: { host: 'dev.example', user: 'alice', port: 22 },
    remoteWorkspaceRoot: '/srv/project',
    trustedWorkspaces: []
  },
  {
    id: 'slurm-gpu',
    label: 'Slurm GPU',
    enabled: true,
    kind: 'slurm',
    ssh: { host: 'login.gpu.example', user: 'alice', port: 22 },
    remoteWorkspaceRoot: '/scratch/project',
    slurm: { defaults: { partition: 'gpu', gpus: 1 } },
    trustedWorkspaces: [
      {
        workspaceRoot: '/tmp/workspace',
        targetFingerprint: 'settings-ui:slurm-gpu',
        trustedAt: '2026-06-30T00:00:00.000Z',
        trustedBy: 'settings-ui',
        approvalBypass: true
      }
    ]
  }
]

describe('ThreadTargetSelectorView', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders Local and enabled remote target options with trust badges', () => {
    const html = renderToStaticMarkup(
      createElement(ThreadTargetSelectorView, {
        targets,
        selectedTargetId: 'slurm-gpu',
        workspaceRoot: '/tmp/workspace',
        onTargetChange: vi.fn()
      })
    )

    expect(html).toContain('Local')
    expect(html).toContain('SSH Dev')
    expect(html).toContain('Slurm GPU')
    expect(html).toContain('Slurm')
    expect(html).toContain('Trusted')
  })
})
