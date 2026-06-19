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
  { key: 'normal_audio_room', group: 'Audio Features', label: 'Normal audio room' },
  { key: 'youtube_audio_room', group: 'Audio Features', label: 'YouTube audio room' },
  { key: 'noise_cancellation', group: 'Audio Features', label: 'Noise cancellation control' },
  { key: 'voice_changer', group: 'Audio Features', label: 'Voice changer' },
  { key: 'one_to_one_voice_calling', group: 'Audio Features', label: 'One-to-one voice calling' },
  { key: 'ai_security_audio', group: 'Audio Features', label: 'AI audio security' },
  { key: 'group_voice_chat', group: 'Audio Features', label: 'Group voice chat' },
  { key: 'normal_video_group_chat', group: 'Video Features', label: 'Normal video group chat' },
  { key: 'live_video_pk', group: 'Video Features', label: 'Live video PK' },
  { key: 'ai_security_video', group: 'Video Features', label: 'AI video security' },
  { key: 'one_to_one_video_calling', group: 'Video Features', label: 'One-to-one video calling with beauty' },
  { key: 'solo_video_live', group: 'Video Features', label: 'Solo video live' },
  { key: 'screen_share', group: 'Video Features', label: 'Screen share' },
  { key: 'video_filter_beauty', group: 'Video Features', label: 'Filters, stickers, face detect, beauty' },
  { key: 'message_chat', group: 'Common', label: 'Messages, replies, and media' },
  { key: 'room_roles', group: 'Common', label: 'Room owner, room admin, moderator limits' },
  { key: 'private_room_password', group: 'Common', label: 'Private and password rooms' },
  { key: 'room_theme', group: 'Common', label: 'Room theme and profile settings' },
  { key: 'room_share', group: 'Common', label: 'Room share and room like' },
  { key: 'comment_reply', group: 'Common', label: 'Comment replies and cleanup' },
  { key: 'company_billing', group: 'Service Console', label: 'Company-wise billing by used minutes' },
  { key: 'rtc_connection_indicator', group: 'Service Console', label: 'RTC connection indicator' },
  { key: 'admin_panel_analytics', group: 'Service Console', label: 'Live monitoring and analytics' },
]

export function buildDashboardTabs(mode) {
  if (mode === 'super_admin') {
    return [
      { key: 'command', label: 'Command' },
      { key: 'companies', label: 'Companies' },
      { key: 'packages', label: 'Packages' },
      { key: 'access', label: 'App Access' },
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
      { key: 'access', label: 'App Access' },
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
    { key: 'access', label: 'App Access' },
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
