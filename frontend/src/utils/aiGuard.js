export const aiGuardKeywords = [
  'spam',
  'scam',
  'abuse',
  'nude',
  'violent',
  'private transaction',
]

export function analyzeRoomTextForGuard(text = '') {
  const body = String(text || '').toLowerCase()
  const matchedKeyword = aiGuardKeywords.find((keyword) => body.includes(keyword))

  return matchedKeyword ? { matchedKeyword } : null
}

export function isAiGuardEnabled(room) {
  return room?.ai_security_enabled === true || Number(room?.ai_security_enabled) === 1
}
