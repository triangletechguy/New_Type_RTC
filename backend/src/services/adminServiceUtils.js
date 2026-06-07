const crypto = require('crypto')

const ADMIN_ROLES = ['client_admin', 'super_admin']
const COMPANY_STATUSES = new Set(['pending', 'active', 'inactive', 'suspended', 'cancelled'])
const BILLING_TYPES = new Set(['monthly', 'prepaid', 'custom', 'enterprise'])
const APP_PLATFORMS = new Set(['web', 'ios', 'android', 'web_mobile', 'server'])
const APP_STATUSES = new Set(['active', 'inactive', 'suspended'])
const PLAN_REVIEW_STATUSES = new Set(['approved', 'rejected'])
const PLAN_STATUSES = new Set(['active', 'inactive'])
const ADMIN_ROOM_TYPES = new Set(['audio', 'youtube_audio', 'one_to_one_audio', 'video', 'one_to_one_video', 'group_audio', 'group_video', 'solo_live', 'pk_live'])
const ADMIN_ONE_TO_ONE_ROOM_TYPES = new Set(['one_to_one_audio', 'one_to_one_video'])
const ADMIN_ROOM_PRIVACY = new Set(['public', 'private', 'password'])
const ADMIN_ROOM_STATUSES = new Set(['active', 'inactive', 'ended'])
const MAX_ADMIN_ROOM_SEATS = 20
const DEFAULT_SERVICE_PLANS = [
  {
    code: 'free',
    name: 'Free RTC',
    description: 'Trial package for validating one client app with company-paid invited users, core audio, video, chat, and basic room controls.',
    monthly_base_price: 0,
    minute_rate: 0.012,
    monthly_minute_allowance: 1000,
    max_room_admins: 2,
    max_rooms: 3,
    max_apps: 1,
    max_participants_per_room: 10,
    included_features: ['normal_audio_room', 'normal_video_group_chat', 'message_chat', 'rtc_connection_indicator'],
  },
  {
    code: 'basic',
    name: 'Basic RTC',
    description: 'Small production package for one client app where the company pays for invited user RTC usage.',
    monthly_base_price: 199,
    minute_rate: 0.01,
    monthly_minute_allowance: 20000,
    max_room_admins: 10,
    max_rooms: 25,
    max_apps: 1,
    max_participants_per_room: 50,
    included_features: ['normal_audio_room', 'normal_video_group_chat', 'group_voice_chat', 'one_to_one_voice_calling', 'one_to_one_video_calling', 'message_chat', 'room_roles', 'private_room_password', 'rtc_connection_indicator'],
  },
  {
    code: 'pro',
    name: 'Pro RTC',
    description: 'Growth package for live client apps with company-paid invited users, screen share, room themes, filters, analytics, and more capacity.',
    monthly_base_price: 799,
    minute_rate: 0.008,
    monthly_minute_allowance: 100000,
    max_room_admins: 20,
    max_rooms: 120,
    max_apps: 3,
    max_participants_per_room: 200,
    included_features: ['normal_audio_room', 'youtube_audio_room', 'noise_cancellation', 'voice_changer', 'one_to_one_voice_calling', 'group_voice_chat', 'normal_video_group_chat', 'live_video_pk', 'one_to_one_video_calling', 'solo_video_live', 'screen_share', 'video_filter_beauty', 'message_chat', 'room_roles', 'private_room_password', 'room_theme', 'room_share', 'admin_panel_analytics', 'rtc_connection_indicator'],
  },
  {
    code: 'enterprise',
    name: 'Enterprise RTC',
    description: 'Full RTC service with multi-app SDK controls, AI security, client-company billing analytics, moderation history, and global monitoring.',
    monthly_base_price: 1999,
    minute_rate: 0.006,
    monthly_minute_allowance: 500000,
    max_room_admins: 50,
    max_rooms: 500,
    max_apps: 10,
    max_participants_per_room: 1000,
    included_features: ['normal_audio_room', 'youtube_audio_room', 'noise_cancellation', 'voice_changer', 'one_to_one_voice_calling', 'ai_security_audio', 'group_voice_chat', 'normal_video_group_chat', 'live_video_pk', 'ai_security_video', 'one_to_one_video_calling', 'solo_video_live', 'screen_share', 'video_filter_beauty', 'message_chat', 'room_roles', 'private_room_password', 'room_theme', 'room_share', 'comment_reply', 'company_billing', 'admin_panel_analytics', 'rtc_connection_indicator'],
  },
]

function toNumber(row, key, decimals = null) {
  const value = Number(row?.[key] || 0)
  return decimals === null ? value : Number(value.toFixed(decimals))
}

function boolValue(value) {
  return Boolean(Number(value || 0))
}

function cleanString(value, maxLength = 255) {
  return String(value || '').trim().slice(0, maxLength)
}

function emptyToNull(value, maxLength = 255) {
  const text = cleanString(value, maxLength)
  return text || null
}

function normalizeEmail(value) {
  return cleanString(value, 180).toLowerCase()
}

function isValidEmail(value) {
  const email = normalizeEmail(value)
  return !email || /^[^\s@]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(email)
}

function slugify(value) {
  const slug = cleanString(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || `company-${crypto.randomBytes(3).toString('hex')}`
}

function normalizeTenantUid(value) {
  const normalized = cleanString(value, 80)
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (!normalized) return ''
  return normalized.startsWith('tenant_') ? normalized.slice(0, 80) : `tenant_${normalized}`.slice(0, 80)
}

function isValidTenantUid(value) {
  return /^tenant_[a-z0-9](?:[a-z0-9_]{0,71}[a-z0-9])?$/.test(String(value || ''))
}

function tenantUidPrefix(companyName) {
  const slug = slugify(companyName || 'client-company').replace(/-/g, '_')
  return `tenant_${slug}`.slice(0, 73).replace(/_+$/g, '')
}

function makeInFilter(column, values, prefix) {
  if (values === null) return { sql: '1 = 1', params: {} }
  if (!values.length) return { sql: '1 = 0', params: {} }

  const params = {}
  const placeholders = values.map((value, index) => {
    const key = `${prefix}${index}`
    params[key] = value
    return `:${key}`
  })

  return {
    sql: `${column} IN (${placeholders.join(', ')})`,
    params,
  }
}

function roleList(user) {
  return Array.isArray(user?.roles) ? user.roles.map((role) => (typeof role === 'string' ? role : role?.name)).filter(Boolean) : []
}

function normalizeAdmin(row, stats = {}) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    tenant_name: row.tenant_name || 'TalkEachOther',
    name: row.name,
    email: row.email,
    status: row.status,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    roles: String(row.roles || '')
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean),
    stats,
  }
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value
  if (!value) return []

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch (_error) {
    return []
  }
}

function maskSecret(value) {
  const text = String(value || '')
  if (!text) return ''
  if (text.includes('...')) return text
  if (text.length <= 8) return `${text.slice(0, 2)}...${text.slice(-2)}`
  return `${text.slice(0, 6)}...${text.slice(-4)}`
}

function hashSecret(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function temporaryPassword() {
  return `Rtc@${crypto.randomBytes(5).toString('hex')}A1`
}

function normalizeCompanyStatus(value) {
  const status = cleanString(value, 30).toLowerCase() || 'active'
  return COMPANY_STATUSES.has(status) ? status : 'active'
}

function normalizeBillingType(value) {
  const billingType = cleanString(value, 30).toLowerCase() || 'monthly'
  return BILLING_TYPES.has(billingType) ? billingType : 'monthly'
}

function normalizeAppPlatform(value) {
  const platform = cleanString(value, 30).toLowerCase() || 'web_mobile'
  return APP_PLATFORMS.has(platform) ? platform : 'web_mobile'
}

function normalizeAppStatus(value) {
  const status = cleanString(value, 30).toLowerCase() || 'active'
  return APP_STATUSES.has(status) ? status : 'active'
}

function normalizePlanReviewStatus(value) {
  const status = cleanString(value, 30).toLowerCase()
  if (status === 'approve') return 'approved'
  if (status === 'reject') return 'rejected'
  return PLAN_REVIEW_STATUSES.has(status) ? status : ''
}

function normalizePlanStatus(value) {
  const status = cleanString(value, 30).toLowerCase() || 'active'
  return PLAN_STATUSES.has(status) ? status : 'active'
}

function normalizeAdminRoomStatus(value) {
  const status = cleanString(value, 30).toLowerCase() || 'active'
  return ADMIN_ROOM_STATUSES.has(status) ? status : 'active'
}

function userStatusForCompany(status) {
  return status === 'active' ? 'active' : 'inactive'
}

function positiveInteger(value, fallback = 0) {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : fallback
}

function positiveDecimal(value, fallback = 0, decimals = 4) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return fallback
  return Number(number.toFixed(decimals))
}

function planDefaultLimits(plan = {}) {
  return {
    app_limit: positiveInteger(plan.max_apps, 1),
    room_limit: positiveInteger(plan.max_rooms, 0),
    participant_limit: positiveInteger(plan.max_participants_per_room, 0),
  }
}

function parseAllowedOrigins(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/[\n,]+/g)

  return [...new Set(raw
    .map((origin) => cleanString(origin, 255))
    .filter(Boolean))]
    .slice(0, 20)
}

function parseAdminRoomPayload(body = {}) {
  const name = cleanString(readBodyValue(body, 'name'), 150)
  const description = emptyToNull(readBodyValue(body, 'description'), 700)
  const roomType = cleanString(readBodyValue(body, 'room_type', 'roomType'), 30) || 'video'
  const privacyType = cleanString(readBodyValue(body, 'privacy_type', 'privacyType'), 30) || 'public'
  const password = cleanString(readBodyValue(body, 'password'), 100)
  const defaultMicCount = ADMIN_ONE_TO_ONE_ROOM_TYPES.has(roomType) ? 2 : 8
  const maxMicCount = positiveInteger(readBodyValue(body, 'max_mic_count', 'maxMicCount'), defaultMicCount)
  const maxAllowedSeats = ADMIN_ONE_TO_ONE_ROOM_TYPES.has(roomType) ? 2 : MAX_ADMIN_ROOM_SEATS
  const errors = {}

  if (!name) errors.name = 'Room name is required.'
  if (name && name.length < 3) errors.name = 'Room name must be at least 3 characters.'
  if (!ADMIN_ROOM_TYPES.has(roomType)) errors.room_type = 'Choose a valid room type.'
  if (!ADMIN_ROOM_PRIVACY.has(privacyType)) errors.privacy_type = 'Choose a valid privacy type.'
  if (maxMicCount < 1 || maxMicCount > maxAllowedSeats) {
    errors.max_mic_count = ADMIN_ONE_TO_ONE_ROOM_TYPES.has(roomType)
      ? 'One-to-one rooms support exactly 1 or 2 seats.'
      : `Max mic count must be between 1 and ${MAX_ADMIN_ROOM_SEATS}.`
  }
  if (privacyType === 'password' && password.length < 4) errors.password = 'Password rooms need a password of at least 4 characters.'

  return {
    errors,
    payload: {
      tenantId: Number(readBodyValue(body, 'tenant_id', 'tenantId')),
      ownerId: Number(readBodyValue(body, 'owner_id', 'ownerId')),
      name,
      description,
      roomType,
      privacyType,
      password: privacyType === 'password' ? password : '',
      maxMicCount,
      chatEnabled: readBodyValue(body, 'chat_enabled', 'chatEnabled') !== false,
      giftEnabled: readBodyValue(body, 'gift_enabled', 'giftEnabled') === true,
      screenShareEnabled: Boolean(readBodyValue(body, 'screen_share_enabled', 'screenShareEnabled')),
      aiSecurityEnabled: Boolean(readBodyValue(body, 'ai_security_enabled', 'aiSecurityEnabled')),
    },
  }
}

function readBodyValue(body, snakeKey, camelKey = snakeKey) {
  return body?.[snakeKey] ?? body?.[camelKey]
}

function parseCompanyPayload(body) {
  const tenantUid = normalizeTenantUid(readBodyValue(body, 'tenant_id', 'tenantUid') || readBodyValue(body, 'tenant_uid', 'tenantUid'))
  const companyName = cleanString(readBodyValue(body, 'company_name', 'companyName'), 150)
  const legalName = emptyToNull(readBodyValue(body, 'legal_name', 'legalName'), 180)
  const companyEmail = normalizeEmail(readBodyValue(body, 'company_email', 'companyEmail'))
  const billingEmail = normalizeEmail(readBodyValue(body, 'billing_email', 'billingEmail'))
  const primaryContactEmail = normalizeEmail(readBodyValue(body, 'primary_contact_email', 'primaryContactEmail'))
  const primaryContactName = cleanString(readBodyValue(body, 'primary_contact_name', 'primaryContactName'), 150)
  const primaryContactPassword = cleanString(readBodyValue(body, 'primary_contact_password', 'primaryContactPassword'), 120)
  const websiteUrl = emptyToNull(readBodyValue(body, 'website_url', 'websiteUrl'), 255)
  const appUrl = emptyToNull(readBodyValue(body, 'app_url', 'appUrl'), 255)
  const planId = Number(readBodyValue(body, 'plan_id', 'planId'))
  const status = normalizeCompanyStatus(readBodyValue(body, 'status'))
  const billingType = normalizeBillingType(readBodyValue(body, 'billing_type', 'billingType'))
  const defaultAppLimit = Number(readBodyValue(body, 'default_app_limit', 'defaultAppLimit'))
  const defaultRoomLimit = Number(readBodyValue(body, 'default_room_limit', 'defaultRoomLimit'))
  const defaultParticipantLimit = Number(readBodyValue(body, 'default_participant_limit', 'defaultParticipantLimit'))
  const errors = {}

  if (tenantUid && !isValidTenantUid(tenantUid)) errors.tenant_id = 'Generate a valid tenant_id before creating the company.'
  if (!companyName) errors.company_name = 'Company name is required.'
  if (!Number.isInteger(planId) || planId <= 0) errors.plan_id = 'Select a service plan.'
  if (!isValidEmail(companyEmail)) errors.company_email = 'Enter a valid business email.'
  if (!isValidEmail(billingEmail)) errors.billing_email = 'Enter a valid billing email.'
  if (!isValidEmail(primaryContactEmail)) errors.primary_contact_email = 'Enter a valid primary contact email.'
  if (primaryContactPassword && primaryContactPassword.length < 8) {
    errors.primary_contact_password = 'Password must be at least 8 characters.'
  }

  return {
    errors,
    payload: {
      tenantUid: tenantUid || null,
      companyName,
      legalName,
      companyEmail: companyEmail || null,
      phone: emptyToNull(readBodyValue(body, 'phone'), 60),
      websiteUrl,
      appUrl,
      telegramContact: emptyToNull(readBodyValue(body, 'telegram_contact', 'telegramContact'), 120),
      whatsappContact: emptyToNull(readBodyValue(body, 'whatsapp_contact', 'whatsappContact'), 120),
      discordContact: emptyToNull(readBodyValue(body, 'discord_contact', 'discordContact'), 120),
      address: emptyToNull(readBodyValue(body, 'address'), 255),
      country: emptyToNull(readBodyValue(body, 'country'), 100),
      timezone: emptyToNull(readBodyValue(body, 'timezone'), 80),
      industry: emptyToNull(readBodyValue(body, 'industry'), 120),
      billingEmail: billingEmail || null,
      billingType,
      status,
      planId,
      defaultAppLimit: Number.isFinite(defaultAppLimit) ? defaultAppLimit : null,
      defaultRoomLimit: Number.isFinite(defaultRoomLimit) ? defaultRoomLimit : null,
      defaultParticipantLimit: Number.isFinite(defaultParticipantLimit) ? defaultParticipantLimit : null,
      primaryContactName,
      primaryContactEmail: primaryContactEmail || null,
      primaryContactPassword: primaryContactPassword || null,
    },
  }
}

const FEATURE_CATALOG = [
  { key: 'normal_audio_room', group: 'Audio SDK', label: 'Normal audio room SDK' },
  { key: 'youtube_audio_room', group: 'Audio SDK', label: 'YouTube audio room SDK' },
  { key: 'noise_cancellation', group: 'Audio SDK', label: 'Noise cancellation control' },
  { key: 'voice_changer', group: 'Audio SDK', label: 'Voice changer' },
  { key: 'one_to_one_voice_calling', group: 'Audio SDK', label: 'One-to-one voice calling' },
  { key: 'ai_security_audio', group: 'Audio SDK', label: 'AI audio security' },
  { key: 'group_voice_chat', group: 'Audio SDK', label: 'Group voice chat' },
  { key: 'normal_video_group_chat', group: 'Video SDK', label: 'Normal video group chat' },
  { key: 'live_video_pk', group: 'Video SDK', label: 'Live video PK' },
  { key: 'ai_security_video', group: 'Video SDK', label: 'AI video security' },
  { key: 'one_to_one_video_calling', group: 'Video SDK', label: 'One-to-one video calling with beauty' },
  { key: 'solo_video_live', group: 'Video SDK', label: 'Solo video live' },
  { key: 'screen_share', group: 'Video SDK', label: 'Screen share' },
  { key: 'video_filter_beauty', group: 'Video SDK', label: 'Filters, stickers, face detect, beauty' },
  { key: 'message_chat', group: 'Common', label: 'Messages, replies, and media' },
  { key: 'room_roles', group: 'Common', label: 'Room owner, admin, moderator limits' },
  { key: 'private_room_password', group: 'Common', label: 'Private and password rooms' },
  { key: 'room_theme', group: 'Common', label: 'Room theme and profile settings' },
  { key: 'room_share', group: 'Common', label: 'Room share and room like' },
  { key: 'comment_reply', group: 'Common', label: 'Comment replies and cleanup' },
  { key: 'company_billing', group: 'Admin Panel', label: 'Company-wise billing by used minutes' },
  { key: 'rtc_connection_indicator', group: 'Admin Panel', label: 'RTC connection indicator' },
  { key: 'admin_panel_analytics', group: 'Admin Panel', label: 'Live monitoring and analytics' },
]

const SERVICE_FLOW = [
  {
    title: 'Create client company',
    owner: 'Superadmin',
    output: 'Tenant, plan, billing scope, and company admin account.',
  },
  {
    title: 'Generate SDK access',
    owner: 'Superadmin',
    output: 'App key, API key, SDK token, and allowed domains for the client app.',
  },
  {
    title: 'Configure package controls',
    owner: 'Superadmin or Client Admin',
    output: 'Feature flags, admin limits, app count, and RTC tools used for client-company billing review.',
  },
  {
    title: 'Client integrates SDK',
    owner: 'Developer client app',
    output: 'Invite/sync platform users, create/join rooms, authenticate tokens, start audio/video/chat, and receive RTC events.',
  },
  {
    title: 'Track usage and billing',
    owner: 'Platform',
    output: 'Participant minutes, room records, join/exit dates, reports, and client-company monthly invoice estimate.',
  },
]

function catalogFeature(featureKey, overrides = {}) {
  const base = FEATURE_CATALOG.find((feature) => feature.key === featureKey) || {
    key: featureKey,
    group: 'Custom',
    label: featureKey.replace(/_/g, ' '),
  }

  return { ...base, ...overrides }
}

function parseServicePlanPayload(body = {}) {
  const name = cleanString(readBodyValue(body, 'name'), 150)
  const description = emptyToNull(readBodyValue(body, 'description'), 1000)
  const monthlyBasePrice = positiveDecimal(readBodyValue(body, 'monthly_base_price', 'monthlyBasePrice'), 0, 2)
  const minuteRate = positiveDecimal(readBodyValue(body, 'minute_rate', 'minuteRate'), 0, 4)
  const monthlyMinuteAllowance = positiveInteger(readBodyValue(body, 'monthly_minute_allowance', 'monthlyMinuteAllowance'), 0)
  const maxRoomAdmins = positiveInteger(readBodyValue(body, 'max_room_admins', 'maxRoomAdmins'), 0)
  const maxRooms = positiveInteger(readBodyValue(body, 'max_rooms', 'maxRooms'), 0)
  const maxApps = positiveInteger(readBodyValue(body, 'max_apps', 'maxApps'), 1)
  const maxParticipantsPerRoom = positiveInteger(readBodyValue(body, 'max_participants_per_room', 'maxParticipantsPerRoom'), 0)
  const status = normalizePlanStatus(readBodyValue(body, 'status'))
  const featureSource = readBodyValue(body, 'included_features', 'includedFeatures')
  const requestedFeatures = Array.isArray(featureSource)
    ? featureSource
    : String(featureSource || '').split(/[\n,]+/g)
  const validFeatureKeys = new Set(FEATURE_CATALOG.map((feature) => feature.key))
  const featureKeys = [...new Set(
    requestedFeatures
      .map((feature) => cleanString(feature, 80))
      .filter(Boolean)
  )]
  const invalidFeatures = featureKeys.filter((feature) => !validFeatureKeys.has(feature))
  const errors = {}

  if (!name) errors.name = 'Package name is required.'
  if (name && name.length < 2) errors.name = 'Package name must be at least 2 characters.'
  if (Number(readBodyValue(body, 'monthly_base_price', 'monthlyBasePrice')) < 0) errors.monthly_base_price = 'Base price cannot be negative.'
  if (Number(readBodyValue(body, 'minute_rate', 'minuteRate')) < 0) errors.minute_rate = 'Minute rate cannot be negative.'
  if (maxApps < 1) errors.max_apps = 'Package must allow at least one app.'
  if (maxParticipantsPerRoom > 10000) errors.max_participants_per_room = 'Participant limit is too high.'
  if (invalidFeatures.length) errors.included_features = `Unknown feature keys: ${invalidFeatures.join(', ')}`

  return {
    errors,
    payload: {
      name,
      description,
      monthlyBasePrice,
      minuteRate,
      monthlyMinuteAllowance,
      maxRoomAdmins,
      maxRooms,
      maxApps,
      maxParticipantsPerRoom,
      includedFeatures: featureKeys.filter((feature) => validFeatureKeys.has(feature)),
      status,
    },
  }
}

module.exports = {
  ADMIN_ROLES,
  ADMIN_ROOM_PRIVACY,
  ADMIN_ROOM_STATUSES,
  ADMIN_ROOM_TYPES,
  APP_PLATFORMS,
  APP_STATUSES,
  BILLING_TYPES,
  COMPANY_STATUSES,
  DEFAULT_SERVICE_PLANS,
  FEATURE_CATALOG,
  PLAN_REVIEW_STATUSES,
  PLAN_STATUSES,
  SERVICE_FLOW,
  boolValue,
  catalogFeature,
  cleanString,
  emptyToNull,
  hashSecret,
  isValidEmail,
  isValidTenantUid,
  makeInFilter,
  maskSecret,
  normalizeAdmin,
  normalizeAdminRoomStatus,
  normalizeAppPlatform,
  normalizeAppStatus,
  normalizeBillingType,
  normalizeCompanyStatus,
  normalizeEmail,
  normalizePlanReviewStatus,
  normalizePlanStatus,
  normalizeTenantUid,
  parseAdminRoomPayload,
  parseAllowedOrigins,
  parseCompanyPayload,
  parseJsonArray,
  parseServicePlanPayload,
  planDefaultLimits,
  positiveDecimal,
  positiveInteger,
  readBodyValue,
  roleList,
  slugify,
  temporaryPassword,
  tenantUidPrefix,
  toNumber,
  userStatusForCompany,
}
