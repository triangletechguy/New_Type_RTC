export function getUsageStatus(verification) {
  if (verification?.status === 'verified') {
    return {
      label: 'Verified',
      className: 'usage-status verified',
    }
  }

  if (verification?.status) {
    return {
      label: 'Review',
      className: 'usage-status attention',
    }
  }

  return {
    label: '-',
    className: 'usage-status neutral',
  }
}

export function formatCurrency(value) {
  const amount = Number(value || 0)
  return `$${amount.toLocaleString(undefined, { minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
}

export function formatPercent(value) {
  return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}

export function clientApiBaseUrl() {
  if (typeof window === 'undefined') return 'https://your-domain.com/api/client'

  const { hostname, port, protocol, origin } = window.location
  const localDevHost = hostname === 'localhost' || hostname === '127.0.0.1'

  if (localDevHost && ['5173', '5174', '4173'].includes(port)) {
    return `${protocol}//${hostname}:8000/api/client`
  }

  return `${origin}/api/client`
}

export function groupedFeatures(features) {
  return (features || []).reduce((groups, feature) => {
    const group = feature.group || 'Features'
    if (!groups[group]) groups[group] = []
    groups[group].push(feature)
    return groups
  }, {})
}

export const INITIAL_COMPANY_FORM = {
  tenant_id: '',
  company_name: '',
  legal_name: '',
  company_email: '',
  phone: '',
  website_url: '',
  app_url: '',
  telegram_contact: '',
  whatsapp_contact: '',
  discord_contact: '',
  address: '',
  country: '',
  timezone: 'America/New_York',
  industry: '',
  billing_email: '',
  billing_type: 'monthly',
  plan_id: '',
  status: 'active',
  default_app_limit: '',
  default_room_limit: '',
  default_participant_limit: '',
  primary_contact_name: '',
  primary_contact_email: '',
}

export const INITIAL_ROOM_FORM = {
  tenant_id: '',
  name: '',
  description: '',
  room_type: 'video',
  privacy_type: 'public',
  password: '',
  max_mic_count: '8',
  chat_enabled: true,
  gift_enabled: false,
  screen_share_enabled: false,
  ai_security_enabled: false,
}

export const INITIAL_PLAN_FORM = {
  name: '',
  description: '',
  monthly_base_price: '0',
  minute_rate: '0',
  monthly_minute_allowance: '0',
  max_room_admins: '0',
  max_rooms: '0',
  max_apps: '1',
  max_participants_per_room: '0',
  status: 'active',
  included_features: [],
}

export const COMPANY_STATUS_OPTIONS = ['active', 'pending', 'suspended', 'cancelled']
export const BILLING_TYPE_OPTIONS = ['monthly', 'prepaid', 'custom', 'enterprise']
export const PLAN_STATUS_OPTIONS = ['active', 'inactive']
export const FEATURE_CATALOG = [
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

export const CLIENT_API_TOKEN_CLAIMS = [
  ['tenant_id', 'Prevents cross-company access.'],
  ['app_id', 'Connects usage and room access to the correct client app.'],
  ['external_user_id', 'Maps the RTC session back to the client company user without charging that user.'],
  ['room_id', 'Limits the token to one room/channel.'],
  ['room_type / rtc_profile', 'Maps the room to communication/live profile, web mode, and media type.'],
  ['role', 'Controls audience, publisher, moderator, admin, or owner behavior.'],
  ['permissions', 'Controls join, media publish, screen share, chat, mute, and kick.'],
  ['billing_payer / billing_scope / user_pays', 'Marks the client company as payer while invited users spend package minutes.'],
  ['exp / iat', 'Keeps tokens short-lived; 15 minutes is the default target.'],
]

export const CLIENT_API_ERROR_CODES = [
  ['invalid_api_key', 'API key is missing, invalid, revoked, or malformed.'],
  ['company_suspended', 'Tenant company is suspended, so token and room APIs should fail.'],
  ['app_suspended', 'The specific client app is suspended.'],
  ['origin_not_allowed', 'The web origin is not in the app allowed origins list.'],
  ['room_disabled', 'The requested room exists but is disabled.'],
  ['room_not_found', 'The room does not exist inside this tenant/app scope.'],
  ['user_not_synced', 'The external user must be synced before token generation.'],
  ['permission_denied', 'Requested role or permissions are not allowed.'],
  ['room_capacity_reached', 'The room has reached its configured participant capacity.'],
]

export const CLIENT_API_WEBHOOK_EVENTS = [
  'room.started',
  'room.ended',
  'room.disabled',
  'participant.joined',
  'participant.left',
  'participant.reconnected',
  'usage.updated',
  'billing.usage_warning',
  'billing.invoice_ready',
]

export function buildDashboardTabs(mode) {
  if (mode === 'super_admin') {
    return [
      { key: 'command', label: 'Command' },
      { key: 'companies', label: 'Companies' },
      { key: 'packages', label: 'Packages' },
      { key: 'sdk', label: 'Integration' },
      { key: 'usage', label: 'Billing' },
      { key: 'rooms', label: 'Rooms' },
      { key: 'health', label: 'Status' },
    ]
  }

  if (mode === 'company_detail') {
    return [
      { key: 'company_overview', label: 'Overview' },
      { key: 'users', label: 'Users' },
      { key: 'rooms', label: 'RTC API' },
      { key: 'sdk', label: 'Integration' },
      { key: 'usage', label: 'Billing' },
      { key: 'packages', label: 'Package' },
      { key: 'company', label: 'Settings' },
      { key: 'health', label: 'Status' },
    ]
  }

  return [
    { key: 'command', label: 'Command' },
    { key: 'purchase', label: 'Package' },
    { key: 'users', label: 'Users' },
    { key: 'sdk', label: 'Integration' },
    { key: 'rooms', label: 'RTC API' },
    { key: 'usage', label: 'Billing' },
    { key: 'company', label: 'Company' },
    { key: 'health', label: 'Status' },
  ]
}

export function limitsFromPlan(plan) {
  if (!plan) return {}

  return {
    default_app_limit: String(plan.max_apps || ''),
    default_room_limit: String(plan.max_rooms || ''),
    default_participant_limit: String(plan.max_participants_per_room || ''),
  }
}

export function companyToForm(company) {
  return {
    tenant_id: company?.tenant_uid || '',
    company_name: company?.name || '',
    legal_name: company?.legal_name || '',
    company_email: company?.company_email || '',
    phone: company?.phone || '',
    website_url: company?.website_url || '',
    app_url: company?.app_url || '',
    telegram_contact: company?.telegram_contact || '',
    whatsapp_contact: company?.whatsapp_contact || '',
    discord_contact: company?.discord_contact || '',
    address: company?.address || '',
    country: company?.country || '',
    timezone: company?.timezone || 'America/New_York',
    industry: company?.industry || '',
    billing_email: company?.billing_email || '',
    billing_type: company?.billing_type || 'monthly',
    plan_id: company?.plan?.id ? String(company.plan.id) : '',
    status: company?.status || 'active',
    default_app_limit: company?.default_limits?.app_count ? String(company.default_limits.app_count) : '',
    default_room_limit: company?.default_limits?.room_count ? String(company.default_limits.room_count) : '',
    default_participant_limit: company?.default_limits?.participant_limit ? String(company.default_limits.participant_limit) : '',
    primary_contact_name: company?.primary_contact_name || '',
    primary_contact_email: company?.primary_contact_email || '',
  }
}

export function planToForm(plan) {
  if (!plan) return INITIAL_PLAN_FORM

  return {
    name: plan.name || '',
    description: plan.description || '',
    monthly_base_price: String(plan.monthly_base_price ?? 0),
    minute_rate: String(plan.minute_rate ?? 0),
    monthly_minute_allowance: String(plan.monthly_minute_allowance ?? 0),
    max_room_admins: String(plan.max_room_admins ?? 0),
    max_rooms: String(plan.max_rooms ?? 0),
    max_apps: String(plan.max_apps ?? 1),
    max_participants_per_room: String(plan.max_participants_per_room ?? 0),
    status: plan.status || 'active',
    included_features: [...(plan.included_features || [])],
  }
}
