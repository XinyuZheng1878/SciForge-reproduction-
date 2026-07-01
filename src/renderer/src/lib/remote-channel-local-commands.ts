import type { RemoteChannelCommand } from '@shared/remote-channel-commands'

const LOCALLY_HANDLED_REMOTE_CHANNEL_COMMANDS = new Set<RemoteChannelCommand['kind']>([
  'clear',
  'help',
  'model',
  'showModel',
  'invalidModel',
  'showMode',
  'mode',
  'invalidMode'
])

export function isUnsupportedLocalRemoteChannelCommand(
  command: RemoteChannelCommand | null
): command is RemoteChannelCommand {
  return command !== null && !LOCALLY_HANDLED_REMOTE_CHANNEL_COMMANDS.has(command.kind)
}
