import type {
  ComputerUseActionRequest,
  ComputerUseRiskAssessment,
  ComputerUseRiskCategory
} from './contract.js'

const RISK_PATTERNS: Array<{ category: ComputerUseRiskCategory; patterns: RegExp[] }> = [
  {
    category: 'delete',
    patterns: [
      /\bdelete\b/i,
      /\bremove\b/i,
      /\btrash\b/i,
      /\berase\b/i,
      /删除|移除|清空/
    ]
  },
  {
    category: 'upload',
    patterns: [
      /\bupload\b/i,
      /\battach\b/i,
      /\bshare file\b/i,
      /上传|附件|共享文件/
    ]
  },
  {
    category: 'send_message',
    patterns: [
      /\bsend\b/i,
      /\bmessage\b/i,
      /\bemail\b/i,
      /\bpost\b/i,
      /发送|发消息|发邮件|发布/
    ]
  },
  {
    category: 'submit_form',
    patterns: [
      /\bsubmit\b/i,
      /\bconfirm\b/i,
      /\bsign in\b/i,
      /\blog in\b/i,
      /提交|确认|登录/
    ]
  },
  {
    category: 'system_settings',
    patterns: [
      /\bsystem settings\b/i,
      /\bsettings\b/i,
      /\bpreferences\b/i,
      /\bpermission\b/i,
      /系统设置|偏好设置|权限/
    ]
  },
  {
    category: 'transaction',
    patterns: [
      /\bbuy\b/i,
      /\bpurchase\b/i,
      /\bcheckout\b/i,
      /\bpay\b/i,
      /\btrade\b/i,
      /\btransfer\b/i,
      /购买|支付|交易|转账|下单/
    ]
  },
  {
    category: 'sensitive_data_transfer',
    patterns: [
      /\bpassword\b/i,
      /\bsecret\b/i,
      /\btoken\b/i,
      /\bapi[-_\s]?key\b/i,
      /\bssn\b/i,
      /密码|密钥|令牌|身份证|银行卡|敏感/
    ]
  }
]

const THIRD_PARTY_INSTRUCTION_PATTERNS = [
  /\b(page|website|webpage|site|screen|popup|dialog|document|email|message|chat|terminal)\s+(says|asks|tells|instructs|claims)\b/i,
  /\baccording to (the )?(page|website|webpage|site|screen|popup|dialog|document|email|message|chat)\b/i,
  /\b(the )?(page|website|webpage|site|screen|popup|dialog|document|email|message|chat)\s+(wants|requires|requests)\b/i,
  /\bthird[-\s]?party\b/i,
  /页面|网页|网站|弹窗|对话框|邮件|消息|聊天|屏幕.*(要求|提示|指示|声称|让你)/
]

const THIRD_PARTY_BLOCKED_RISK_CATEGORIES: ComputerUseRiskCategory[] = [
  'system_settings',
  'sensitive_data_transfer',
  'upload',
  'send_message',
  'transaction'
]

export function assessComputerUseRisk(input: ComputerUseActionRequest): ComputerUseRiskAssessment {
  const intentTexts = [
    input.riskIntent,
    actionTextForRisk(input)
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
  const categories = uniqueCategories([
    ...(input.riskCategories ?? []),
    ...intentTexts.flatMap(categoriesFromText)
  ])
  const thirdPartyInstruction = intentTexts.some(isThirdPartyInstructionText)
  const blocked = thirdPartyInstruction && categories.some((category) =>
    THIRD_PARTY_BLOCKED_RISK_CATEGORIES.includes(category)
  )
  const confirmed = input.confirmedRisk === true
  const requiresConfirmation = categories.length > 0 && !confirmed && !blocked
  return {
    requiresConfirmation,
    confirmed,
    ...(blocked ? { blocked: true, blockedReason: thirdPartyBlockedReason(categories) } : {}),
    categories,
    ...(blocked
      ? { message: thirdPartyBlockedReason(categories) }
      : requiresConfirmation
        ? { message: confirmationMessage(categories) }
        : {}),
    ...(input.riskIntent ? { intent: input.riskIntent } : {}),
    ...(input.confirmationId ? { confirmationId: input.confirmationId } : {})
  }
}

function actionTextForRisk(input: ComputerUseActionRequest): string | undefined {
  if (input.action !== 'type') return undefined
  return input.text
}

function categoriesFromText(value: string | undefined): ComputerUseRiskCategory[] {
  if (!value) return []
  const matches: ComputerUseRiskCategory[] = []
  for (const entry of RISK_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(value))) matches.push(entry.category)
  }
  return matches
}

function uniqueCategories(values: ComputerUseRiskCategory[]): ComputerUseRiskCategory[] {
  return [...new Set(values)]
}

function isThirdPartyInstructionText(value: string): boolean {
  return THIRD_PARTY_INSTRUCTION_PATTERNS.some((pattern) => pattern.test(value))
}

function confirmationMessage(categories: ComputerUseRiskCategory[]): string {
  return [
    'computer_use action requires user confirmation before execution',
    `risk categories: ${categories.join(', ')}`
  ].join('; ')
}

function thirdPartyBlockedReason(categories: ComputerUseRiskCategory[]): string {
  const blockedCategories = categories.filter((category) =>
    THIRD_PARTY_BLOCKED_RISK_CATEGORIES.includes(category)
  )
  return [
    'computer_use action blocked because third-party content cannot authorize permission expansion, system settings changes, transactions, uploads, messages, or sensitive data transfer',
    `risk categories: ${blockedCategories.join(', ')}`
  ].join('; ')
}
