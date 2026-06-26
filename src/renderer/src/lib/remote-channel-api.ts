import type { SciForgeApi } from '@shared/sciforge-api'

type OptionalSciForgeApi = SciForgeApi | undefined

export function startConnectPhoneInstallQrApi(
  api: OptionalSciForgeApi
): SciForgeApi['startConnectPhoneInstallQr'] | undefined {
  return api?.startConnectPhoneInstallQr
}

export function pollConnectPhoneInstallApi(
  api: OptionalSciForgeApi
): SciForgeApi['pollConnectPhoneInstall'] | undefined {
  return api?.pollConnectPhoneInstall
}

export function onRemoteChannelActivityApi(
  api: OptionalSciForgeApi
): SciForgeApi['onRemoteChannelActivity'] | undefined {
  return api?.onRemoteChannelActivity
}

export function updateRemoteChannelActiveThreadContextApi(
  api: OptionalSciForgeApi
): SciForgeApi['updateRemoteChannelActiveThreadContext'] | undefined {
  return api?.updateRemoteChannelActiveThreadContext
}

export function mirrorRemoteChannelMessageApi(
  api: OptionalSciForgeApi
): SciForgeApi['mirrorRemoteChannelMessage'] | undefined {
  return api?.mirrorRemoteChannelMessage
}

export function mirrorRemoteChannelMessageToFeishuApi(
  api: OptionalSciForgeApi
): SciForgeApi['mirrorRemoteChannelMessageToFeishu'] | undefined {
  return api?.mirrorRemoteChannelMessageToFeishu
}

export function createRemoteChannelTaskFromTextApi(
  api: OptionalSciForgeApi
): SciForgeApi['createRemoteChannelTaskFromText'] | undefined {
  return api?.createRemoteChannelTaskFromText
}
