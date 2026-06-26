import type { ReactElement } from 'react'
import {
  CLAW_MODEL_IDS,
  type AppSettingsPatch,
  type AppSettingsV1,
  type ClawImAgentProfileV1,
  type ClawImChannelV1,
  type ClawImDiscordPlatformCredentialV1,
  type ClawModel
} from '@shared/app-settings'
import { SettingsCard, SettingRow, Toggle } from './settings-controls'
import { clawProviderDisplayLabel } from './chat/SidebarClaw'

type ClawSettingsContext = {
  t: (key: string, values?: Record<string, unknown>) => string
  form: AppSettingsV1
  update: (partial: AppSettingsPatch) => void
  selectControlClass: string
  pickClawWorkspace: () => Promise<void>
  resetClawWorkspaceToDefault: () => void
  clawWorkspacePickerError: string | null
}

type ClawAgentProfileField = keyof ClawImAgentProfileV1

const profileFields: Array<{
  key: ClawAgentProfileField
  labelKey: string
  placeholderKey: string
  rows: number
}> = [
  { key: 'description', labelKey: 'clawManageAgentDescription', placeholderKey: 'clawManageAgentDescriptionPlaceholder', rows: 2 },
  { key: 'identity', labelKey: 'clawManageAgentIdentity', placeholderKey: 'clawManageAgentIdentityPlaceholder', rows: 4 },
  { key: 'personality', labelKey: 'clawManageAgentPersonality', placeholderKey: 'clawManageAgentPersonalityPlaceholder', rows: 3 },
  { key: 'userContext', labelKey: 'clawManageAgentUserContext', placeholderKey: 'clawManageAgentUserContextPlaceholder', rows: 3 },
  { key: 'replyRules', labelKey: 'clawManageAgentReplyRules', placeholderKey: 'clawManageAgentReplyRulesPlaceholder', rows: 4 }
]

function textInputClass(extra = ''): string {
  return `w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 ${extra}`
}

function updateChannels(
  form: AppSettingsV1,
  update: (partial: AppSettingsPatch) => void,
  mapper: (channel: ClawImChannelV1) => ClawImChannelV1
): void {
  update({ remoteChannel: { channels: form.remoteChannel.channels.map(mapper) } })
}

function updateChannel(
  form: AppSettingsV1,
  update: (partial: AppSettingsPatch) => void,
  channelId: string,
  patch: Partial<ClawImChannelV1>
): void {
  const now = new Date().toISOString()
  updateChannels(form, update, (channel) =>
    channel.id === channelId ? { ...channel, ...patch, updatedAt: now } : channel
  )
}

function updateChannelProfile(
  form: AppSettingsV1,
  update: (partial: AppSettingsPatch) => void,
  channel: ClawImChannelV1,
  patch: Partial<ClawImAgentProfileV1>
): void {
  const nextProfile = {
    ...channel.agentProfile,
    ...patch
  }
  updateChannel(form, update, channel.id, {
    label: nextProfile.name.trim() || channel.label,
    agentProfile: nextProfile
  })
}

function channelEffectiveWorkspace(form: AppSettingsV1, channel: ClawImChannelV1): string {
  return channel.workspaceRoot.trim() || form.remoteChannel.im.workspaceRoot.trim() || form.workspaceRoot
}

function discordChannelName(name: string): string {
  const trimmed = name.trim().replace(/^#/, '')
  return trimmed ? `#${trimmed}` : '#channel'
}

function discordCredential(channel: ClawImChannelV1): ClawImDiscordPlatformCredentialV1 | null {
  return channel.platformCredential?.kind === 'discord' ? channel.platformCredential : null
}

export function hasDiscordGuardConflict(form: AppSettingsV1, channel: ClawImChannelV1): boolean {
  if (!channel.enabled) return false
  const credential = discordCredential(channel)
  if (!credential) return false
  const owner = (
    credential.guardOwnerInstallationId ||
    credential.installationId ||
    ''
  ).trim()
  const current = (form.installationId ?? '').trim()
  return Boolean(owner && current && owner !== current)
}

export function discordGuardOwnerPatch(
  form: AppSettingsV1,
  channel: ClawImChannelV1,
  enabled: boolean
): Partial<ClawImChannelV1> {
  const credential = discordCredential(channel)
  if (!credential) return { enabled }
  const now = new Date().toISOString()
  const installationId = form.installationId ?? ''
  return {
    enabled,
    guardMode: enabled ? 'all_messages' : channel.guardMode,
    platformCredential: {
      ...credential,
      installationId: credential.installationId || installationId,
      ...(enabled
        ? {
            guardOwnerInstallationId: installationId,
            guardOwnerUpdatedAt: now
          }
        : {})
    }
  }
}

export function ClawSettingsSection({ ctx }: { ctx: ClawSettingsContext }): ReactElement {
  const {
    t,
    form,
    update,
    selectControlClass,
    pickClawWorkspace,
    resetClawWorkspaceToDefault,
    clawWorkspacePickerError
  } = ctx

  return (
    <>
      <SettingsCard title={t('clawRuntime')}>
        <SettingRow
          title={t('clawEnabled')}
          description={t('clawEnabledDesc')}
          control={
            <Toggle
              checked={form.remoteChannel.enabled}
              onChange={(value) => update({ remoteChannel: { enabled: value } })}
            />
          }
        />
        <SettingRow
          title={t('clawDefaultWorkspace')}
          description={t('clawDefaultWorkspaceDesc')}
          control={
            <div className="w-full min-w-[200px] md:max-w-xl">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  className={textInputClass()}
                  value={form.remoteChannel.im.workspaceRoot}
                  onChange={(e) =>
                    update({
                      remoteChannel: {
                        im: {
                          workspaceRoot: e.target.value
                        }
                      }
                    })
                  }
                  placeholder={t('clawDefaultWorkspacePlaceholder', { path: form.workspaceRoot })}
                />
                <button
                  type="button"
                  onClick={resetClawWorkspaceToDefault}
                  className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                >
                  {t('clawDefaultWorkspaceReset')}
                </button>
                <button
                  type="button"
                  onClick={() => void pickClawWorkspace()}
                  className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                >
                  {t('browse')}
                </button>
              </div>
              {clawWorkspacePickerError ? (
                <p className="mt-2 text-[13px] leading-5 text-amber-700 dark:text-amber-300">
                  {clawWorkspacePickerError}
                </p>
              ) : null}
            </div>
          }
        />
      </SettingsCard>

      <SettingsCard title={t('clawManageAgents')} className="mt-6">
        {form.remoteChannel.channels.length === 0 ? (
          <div className="px-3 py-4 text-[13px] leading-6 text-ds-muted">
            {t('clawManageAgentsEmpty')}
          </div>
        ) : (
          form.remoteChannel.channels.map((channel) => {
            const name = channel.agentProfile.name.trim() || channel.label
            const discord = discordCredential(channel)
            const discordConflict = hasDiscordGuardConflict(form, channel)
            return (
              <div key={channel.id} className="px-3 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-semibold text-ds-ink">{name}</div>
                    <div className="mt-1 text-[12px] text-ds-faint">
                      {t('clawManageAgentMeta', {
                        provider: clawProviderDisplayLabel(channel.provider),
                        model: channel.model,
                        workspace: channelEffectiveWorkspace(form, channel)
                      })}
                    </div>
                    {discord ? (
                      <div className="mt-1 text-[12px] leading-5 text-ds-faint">
                        {t('clawDiscordChannelMeta', {
                          server: discord.guildName || discord.guildId,
                          channel: discordChannelName(discord.channelName || discord.channelId)
                        })}
                      </div>
                    ) : null}
                    {discord ? (
                      <div className="mt-1 text-[12px] leading-5 text-ds-muted">
                        {t('clawDiscordLocalOnlineGuard')}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[12px] font-medium text-ds-muted">
                      {discordConflict
                        ? t('clawDiscordGuardConflictState')
                        : channel.enabled
                          ? t('clawManageAgentEnabled')
                          : t('clawManageAgentDisabled')}
                    </span>
                    <Toggle
                      checked={channel.enabled}
                      onChange={(value) =>
                        updateChannel(
                          form,
                          update,
                          channel.id,
                          channel.provider === 'discord'
                            ? discordGuardOwnerPatch(form, channel, value)
                            : { enabled: value }
                        )}
                    />
                  </div>
                </div>

                {discordConflict ? (
                  <div className="mt-3 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-[12.5px] leading-5 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                    <div className="font-semibold">{t('clawDiscordGuardConflictTitle')}</div>
                    <div className="mt-1">
                      {t('clawDiscordGuardConflictDesc', {
                        owner: discord?.guardOwnerInstallationId || discord?.installationId || ''
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateChannel(form, update, channel.id, discordGuardOwnerPatch(form, channel, true))
                      }
                      className="mt-2 rounded-lg border border-amber-400/60 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-amber-900 shadow-sm transition hover:bg-amber-100 dark:border-amber-300/30 dark:bg-amber-300/10 dark:text-amber-100 dark:hover:bg-amber-300/15"
                    >
                      {t('clawDiscordGuardTakeover')}
                    </button>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="block min-w-0">
                    <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                      {t('clawManageAgentName')}
                    </span>
                    <input
                      className={textInputClass()}
                      value={channel.agentProfile.name}
                      onChange={(e) => updateChannelProfile(form, update, channel, { name: e.target.value })}
                      placeholder={t('clawManageAgentNamePlaceholder')}
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                      {t('clawModel')}
                    </span>
                    <select
                      className={selectControlClass}
                      value={channel.model}
                      onChange={(e) => updateChannel(form, update, channel.id, { model: e.target.value as ClawModel })}
                    >
                      {CLAW_MODEL_IDS.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block min-w-0 md:col-span-2">
                    <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                      {t('clawWorkspaceOverride')}
                    </span>
                    <input
                      className={textInputClass()}
                      value={channel.workspaceRoot}
                      onChange={(e) => updateChannel(form, update, channel.id, { workspaceRoot: e.target.value })}
                      placeholder={t('clawWorkspaceInherit', {
                        path: form.remoteChannel.im.workspaceRoot.trim() || form.workspaceRoot
                      })}
                    />
                  </label>
                </div>

                <div className="mt-4 grid gap-3">
                  {profileFields.map((field) => (
                    <label key={field.key} className="block min-w-0">
                      <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                        {t(field.labelKey)}
                      </span>
                      <textarea
                        className={textInputClass('resize-y leading-5')}
                        rows={field.rows}
                        value={channel.agentProfile[field.key]}
                        onChange={(e) => updateChannelProfile(form, update, channel, { [field.key]: e.target.value })}
                        placeholder={t(field.placeholderKey)}
                      />
                    </label>
                  ))}
                </div>
              </div>
            )
          })
        )}
      </SettingsCard>
    </>
  )
}
