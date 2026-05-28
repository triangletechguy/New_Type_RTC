export function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Number(seconds || 0))
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

export function getInitials(value) {
  return String(value || 'U')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U'
}

export function formatChatTime(value) {
  if (!value) return ''

  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return ''
  }
}

export function formatElapsed(seconds) {
  const totalSeconds = Math.max(0, Number(seconds || 0))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainingSeconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`
  return `${remainingSeconds}s`
}

export function formatNumber(value, options = {}) {
  const number = Number(value || 0)
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: options.maximumFractionDigits ?? 0,
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
  }).format(number)
}

export function formatMinutes(value) {
  const minutes = Number(value || 0)
  return `${formatNumber(minutes, {
    maximumFractionDigits: minutes < 10 ? 2 : 1,
  })}m`
}

export function formatUsageDate(value) {
  if (!value) return ''

  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return ''
  }
}
