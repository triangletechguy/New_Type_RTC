const { query } = require('../config/db')

const DEFAULT_MESSAGE_PRIVACY = 'everyone'
const DEFAULT_USER_PRIVACY_SETTINGS = Object.freeze({
  messagePrivacy: DEFAULT_MESSAGE_PRIVACY,
  privateInvite: true,
  hideSensitive: true,
})
const validMessagePrivacyValues = new Set(['everyone', 'followers', 'nobody'])
let privacySettingsSchemaPromise = null

async function addColumnIfMissing(tableName, columnName, alterSql) {
  const columns = await query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = :tableName
    AND COLUMN_NAME = :columnName
    LIMIT 1
    `,
    { tableName, columnName }
  )

  if (!columns.length) await query(alterSql)
}

async function ensureUserPrivacySettingsSchema() {
  if (!privacySettingsSchemaPromise) {
    privacySettingsSchemaPromise = (async () => {
      await addColumnIfMissing(
        'users',
        'message_privacy',
        "ALTER TABLE users ADD COLUMN message_privacy ENUM('everyone', 'followers', 'nobody') NOT NULL DEFAULT 'everyone' AFTER current_residence"
      )
      await addColumnIfMissing(
        'users',
        'private_live_invitation',
        'ALTER TABLE users ADD COLUMN private_live_invitation TINYINT(1) NOT NULL DEFAULT 1 AFTER message_privacy'
      )
      await addColumnIfMissing(
        'users',
        'hide_sensitive_content',
        'ALTER TABLE users ADD COLUMN hide_sensitive_content TINYINT(1) NOT NULL DEFAULT 1 AFTER private_live_invitation'
      )
    })().catch((error) => {
      privacySettingsSchemaPromise = null
      throw error
    })
  }

  return privacySettingsSchemaPromise
}

function readBodyValue(body, ...keys) {
  const source = body && typeof body === 'object' ? body : {}
  const key = keys.find((item) => Object.prototype.hasOwnProperty.call(source, item))
  return key ? { hasValue: true, value: source[key] } : { hasValue: false, value: undefined }
}

function normalizeMessagePrivacy(value, fallback = DEFAULT_MESSAGE_PRIVACY) {
  if (value === undefined || value === null || value === '') return fallback

  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (normalized === 'followers_only' || normalized === 'follower') return 'followers'
  if (validMessagePrivacyValues.has(normalized)) return normalized
  return ''
}

function normalizeBooleanSetting(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0

  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function formatUserPrivacySettings(user = {}) {
  return {
    messagePrivacy: normalizeMessagePrivacy(user.message_privacy, DEFAULT_USER_PRIVACY_SETTINGS.messagePrivacy)
      || DEFAULT_USER_PRIVACY_SETTINGS.messagePrivacy,
    privateInvite: normalizeBooleanSetting(user.private_live_invitation, DEFAULT_USER_PRIVACY_SETTINGS.privateInvite),
    hideSensitive: normalizeBooleanSetting(user.hide_sensitive_content, DEFAULT_USER_PRIVACY_SETTINGS.hideSensitive),
  }
}

function privacyPatchFromBody(body = {}) {
  const patch = {}
  const errors = {}

  const messagePrivacy = readBodyValue(body, 'messagePrivacy', 'message_privacy')
  if (messagePrivacy.hasValue) {
    const normalized = normalizeMessagePrivacy(messagePrivacy.value, '')
    if (!normalized) errors.messagePrivacy = 'Choose Everyone, Followers only, or Nobody.'
    else patch.message_privacy = normalized
  }

  const privateInvite = readBodyValue(body, 'privateInvite', 'private_live_invitation', 'privateLiveInvitation')
  if (privateInvite.hasValue) {
    patch.private_live_invitation = normalizeBooleanSetting(privateInvite.value, true) ? 1 : 0
  }

  const hideSensitive = readBodyValue(body, 'hideSensitive', 'hide_sensitive', 'hide_sensitive_content')
  if (hideSensitive.hasValue) {
    patch.hide_sensitive_content = normalizeBooleanSetting(hideSensitive.value, true) ? 1 : 0
  }

  return { patch, errors }
}

module.exports = {
  DEFAULT_USER_PRIVACY_SETTINGS,
  ensureUserPrivacySettingsSchema,
  formatUserPrivacySettings,
  normalizeMessagePrivacy,
  privacyPatchFromBody,
}
