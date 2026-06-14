import type { ClawModel, ClawRunMode } from './app-settings'

export type ClawCommand =
  | { kind: 'clear' }
  | { kind: 'newPrivate' }
  | { kind: 'attachCurrent' }
  | { kind: 'help' }
  | { kind: 'showModel' }
  | { kind: 'model'; model: ClawModel }
  | { kind: 'invalidModel' }
  | { kind: 'showMode' }
  | { kind: 'mode'; mode: ClawRunMode }
  | { kind: 'invalidMode' }
  | { kind: 'summary' }
  | { kind: 'detach' }
  | { kind: 'status' }

export function parseClawCommand(text: string): ClawCommand | null {
  const raw = text.trim().replace(/^／/, '/')
  const lower = raw.toLowerCase()
  if (/^[/-](?:new|新会话|新话题)\s+(?:private|个人|私有|私人)$/.test(lower)) {
    return { kind: 'newPrivate' }
  }
  if (/^[/-](?:clear|reset|new|清空|重置|新会话|新话题)$/.test(lower)) {
    return { kind: 'clear' }
  }
  if (/^[/-](?:attach|bind|use|绑定|接入)(?:\s+(?:current|active|当前|当前会话|当前进程))?$/.test(lower)) {
    return { kind: 'attachCurrent' }
  }
  if (/^[/-](?:help|帮助|命令|\?)$/.test(lower)) {
    return { kind: 'help' }
  }
  if (/^[/-](?:summary|summarize|摘要|总结)$/.test(lower)) {
    return { kind: 'summary' }
  }
  if (/^[/-](?:detach|unbind|解除绑定|解绑)$/.test(lower)) {
    return { kind: 'detach' }
  }
  if (/^(?:[/-])?(?:where|pwd|当前位置|当前目录|位置|在哪)$/.test(lower)) {
    return { kind: 'status' }
  }
  if (/^[/-](?:status|状态)$/.test(lower)) {
    return { kind: 'status' }
  }
  const modeMatch = raw.match(/^[/-](?:mode|模式)(?:\s+(.+))?$/i)
  if (modeMatch) {
    const value = (modeMatch[1] ?? '').trim().toLowerCase()
    if (!value) return { kind: 'showMode' }
    if (value === 'agent' || value === '代理') return { kind: 'mode', mode: 'agent' }
    if (value === 'plan' || value === '计划') return { kind: 'mode', mode: 'plan' }
    return { kind: 'invalidMode' }
  }
  const match = raw.match(/^[/-](?:model|模型)(?:\s+(.+))?$/i)
  if (!match) return null
  const value = (match[1] ?? '').trim().toLowerCase()
  if (!value) return { kind: 'showModel' }
  if (value === 'auto' || value === '自动') return { kind: 'model', model: 'auto' }
  if (value === 'pro' || value === 'deepseek-v4-pro') {
    return { kind: 'model', model: 'deepseek-v4-pro' }
  }
  if (value === 'flash' || value === 'deepseek-v4-flash') {
    return { kind: 'model', model: 'deepseek-v4-flash' }
  }
  return { kind: 'invalidModel' }
}
