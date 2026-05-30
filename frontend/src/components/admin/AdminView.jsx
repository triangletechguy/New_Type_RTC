import { useEffect, useMemo, useState } from 'react'
import { adminAssets } from '../../assets/rtc/catalog'
import { apiRequest } from '../../services/api'
import { formatElapsed, formatMinutes, formatNumber, formatUsageDate, getInitials } from '../../utils/formatters'
import { DashboardMetrics } from './DashboardMetrics'
import { UsageLogCard } from './UsageLogCard'
import { UsageVerificationCard } from './UsageVerificationCard'

function getUsageStatus(verification) {
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

function formatCurrency(value) {
  const amount = Number(value || 0)
  return `$${amount.toLocaleString(undefined, { minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
}

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}

function groupedFeatures(features) {
  return (features || []).reduce((groups, feature) => {
    const group = feature.group || 'Features'
    if (!groups[group]) groups[group] = []
    groups[group].push(feature)
    return groups
  }, {})
}

const INITIAL_COMPANY_FORM = {
  tenant_id: '',
  company_name: '',
  legal_name: '',
  company_email: '',
  phone: '',
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

const INITIAL_ROOM_FORM = {
  tenant_id: '',
  name: '',
  description: '',
  room_type: 'video',
  privacy_type: 'public',
  password: '',
  max_mic_count: '8',
  chat_enabled: true,
  gift_enabled: true,
  screen_share_enabled: false,
  ai_security_enabled: false,
}

const COMPANY_STATUS_OPTIONS = ['active', 'pending', 'suspended', 'cancelled']
const BILLING_TYPE_OPTIONS = ['monthly', 'prepaid', 'custom', 'enterprise']
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
  { key: 'message_chat', group: 'Common', label: 'Messages, replies, media, gifts' },
  { key: 'room_roles', group: 'Common', label: 'Room owner, admin, moderator limits' },
  { key: 'private_room_password', group: 'Common', label: 'Private and password rooms' },
  { key: 'room_theme', group: 'Common', label: 'Room theme and profile settings' },
  { key: 'room_share', group: 'Common', label: 'Room share and room like' },
  { key: 'comment_reply', group: 'Common', label: 'Comment replies and cleanup' },
  { key: 'company_billing', group: 'Admin Panel', label: 'Company-wise billing by used minutes' },
  { key: 'rtc_connection_indicator', group: 'Admin Panel', label: 'RTC connection indicator' },
  { key: 'admin_panel_analytics', group: 'Admin Panel', label: 'Live monitoring and analytics' },
]

function buildDashboardTabs(mode) {
  if (mode === 'super_admin') {
    return [
      { key: 'command', label: 'Start' },
      { key: 'clients', label: 'Clients' },
      { key: 'packages', label: 'Packages' },
      { key: 'sdk', label: 'SDK Access' },
      { key: 'usage', label: 'Usage' },
      { key: 'rooms', label: 'Rooms' },
      { key: 'health', label: 'Health' },
    ]
  }

  return [
    { key: 'command', label: 'Start' },
    { key: 'purchase', label: 'Purchase' },
    { key: 'sdk', label: 'SDK Access' },
    { key: 'rooms', label: 'Rooms' },
    { key: 'usage', label: 'Usage' },
    { key: 'company', label: 'Company' },
    { key: 'health', label: 'Health' },
  ]
}

function limitsFromPlan(plan) {
  if (!plan) return {}

  return {
    default_app_limit: String(plan.max_apps || ''),
    default_room_limit: String(plan.max_rooms || ''),
    default_participant_limit: String(plan.max_participants_per_room || ''),
  }
}

function companyToForm(company) {
  return {
    tenant_id: company?.tenant_uid || '',
    company_name: company?.name || '',
    legal_name: company?.legal_name || '',
    company_email: company?.company_email || '',
    phone: company?.phone || '',
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

function DashboardTabs({ tabs, activeTab, onChange }) {
  return (
    <nav className="admin-dashboard-tabs glass-card" aria-label="Admin dashboard sections">
      {tabs.map((tab) => (
        <button
          type="button"
          className={activeTab === tab.key ? 'active' : ''}
          key={tab.key}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}

function AdminEmptyState({ title, detail }) {
  return (
    <section className="admin-empty-state glass-card">
      <img src={adminAssets.emptySessions} alt="" loading="lazy" />
      <div>
        <strong>{title}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
    </section>
  )
}

function getPrimaryClient(enterprise) {
  return enterprise?.clients?.[0] || null
}

function getPendingPlanRequest(enterprise) {
  return (enterprise?.plan_requests || []).find((request) => request.status === 'pending') || null
}

function planFeatureRows(plan) {
  if (!plan) return []
  const enabledKeys = new Set(plan.included_features || [])

  return FEATURE_CATALOG.map((feature) => ({
    ...feature,
    enabled: enabledKeys.has(feature.key),
    limit_value: feature.key === 'room_roles'
      ? formatNumber(plan.max_room_admins)
      : feature.key === 'normal_video_group_chat'
        ? formatNumber(plan.max_participants_per_room)
        : '',
  }))
}

function CommandCenterPanel({ enterprise, dashboard, mode, onTabChange, onView }) {
  const isPlatform = mode === 'super_admin'
  const client = getPrimaryClient(enterprise)
  const currentPlan = enterprise?.current_plan || client?.plan
  const billing = enterprise?.billing || {}
  const totals = enterprise?.platform_totals || {}
  const apps = enterprise?.apps || []
  const pendingRequests = (enterprise?.plan_requests || []).filter((request) => request.status === 'pending')
  const activeRooms = dashboard?.metrics?.rooms?.active ?? dashboard?.active_rooms ?? client?.active_room_count ?? 0
  const totalRooms = dashboard?.metrics?.rooms?.total ?? client?.room_count ?? 0
  const invoice = isPlatform ? totals.estimated_invoice : billing.estimated_invoice
  const title = isPlatform ? 'Sell and operate RTC service' : 'RTC service console'
  const subtitle = isPlatform
    ? 'Create client companies, approve package purchases, issue SDK access, and monitor usage from one focused place.'
    : 'Purchase a package, generate app credentials, open RTC rooms, and watch monthly usage.'
  const actionCards = isPlatform ? [
    {
      title: 'Create client company',
      detail: 'Tenant, package, billing scope, admin invite, and default limits.',
      meta: `${formatNumber(totals.total_clients)} total clients`,
      action: 'Open clients',
      onClick: () => onTabChange('clients'),
    },
    {
      title: 'Review purchases',
      detail: 'Approve or reject client package requests.',
      meta: `${formatNumber(pendingRequests.length)} pending`,
      action: 'Open packages',
      onClick: () => onTabChange('packages'),
    },
    {
      title: 'Generate SDK access',
      detail: 'Create app key, API key, SDK token, and allowed origins.',
      meta: `${formatNumber(totals.active_apps)} active apps`,
      action: 'Open SDK',
      onClick: () => onTabChange('sdk'),
    },
    {
      title: 'Track billing',
      detail: 'Participant minutes, usage records, invoice estimate, and verification.',
      meta: formatCurrency(invoice),
      action: 'Open usage',
      onClick: () => onTabChange('usage'),
    },
  ] : [
    {
      title: 'Package',
      detail: currentPlan ? `${currentPlan.name} is active for this company.` : 'Choose a package before integration.',
      meta: getPendingPlanRequest(enterprise) ? 'Purchase pending' : formatCurrency(currentPlan?.monthly_base_price),
      action: 'Manage package',
      onClick: () => onTabChange('purchase'),
    },
    {
      title: 'SDK access',
      detail: apps.length ? 'App credentials are ready for integration.' : 'Generate app credentials before connecting your app.',
      meta: `${formatNumber(apps.length)} apps`,
      action: 'Open SDK',
      onClick: () => onTabChange('sdk'),
    },
    {
      title: 'Rooms',
      detail: `${formatNumber(activeRooms)} active rooms from ${formatNumber(totalRooms)} total.`,
      meta: `${formatNumber(activeRooms)} live`,
      action: 'Open rooms',
      onClick: () => onView?.('rooms'),
    },
    {
      title: 'Usage and billing',
      detail: 'Review monthly minutes, overage, records, and invoice estimate.',
      meta: formatCurrency(invoice),
      action: 'Open usage',
      onClick: () => onTabChange('usage'),
    },
  ]

  return (
    <section className="rtc-command-center glass-card">
      <div className="rtc-command-hero">
        <div className="rtc-command-copy">
          <span className="eyebrow">{isPlatform ? 'RTC Business Console' : client?.name || 'Client Console'}</span>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <img src={isPlatform ? adminAssets.controlGrid : adminAssets.statusColors} alt="" loading="lazy" />
      </div>

      <div className="rtc-command-kpis">
        <div>
          <span>{isPlatform ? 'Active clients' : 'Current package'}</span>
          <strong>{isPlatform ? formatNumber(totals.active_clients) : currentPlan?.name || 'No package'}</strong>
        </div>
        <div>
          <span>{isPlatform ? 'Pending purchases' : 'SDK apps'}</span>
          <strong>{isPlatform ? formatNumber(pendingRequests.length) : formatNumber(apps.length)}</strong>
        </div>
        <div>
          <span>{isPlatform ? 'Month usage' : 'Active rooms'}</span>
          <strong>{isPlatform ? formatMinutes(totals.minutes_month) : formatNumber(activeRooms)}</strong>
        </div>
        <div>
          <span>{isPlatform ? 'Revenue estimate' : 'Invoice estimate'}</span>
          <strong>{formatCurrency(invoice)}</strong>
        </div>
      </div>

      <div className="rtc-action-grid">
        {actionCards.map((card) => (
          <button type="button" className="rtc-action-card" key={card.title} onClick={card.onClick}>
            <span>{card.meta}</span>
            <strong>{card.title}</strong>
            <small>{card.detail}</small>
            <b>{card.action}</b>
          </button>
        ))}
      </div>
    </section>
  )
}

function PlanRequestsPanel({ requests, mode, onRefresh }) {
  const [reviewingId, setReviewingId] = useState(null)
  const [message, setMessage] = useState('')
  const visibleRequests = requests || []

  async function reviewRequest(requestId, status) {
    setReviewingId(requestId)
    setMessage(status === 'approved' ? 'Approving package request...' : 'Rejecting package request...')

    try {
      const data = await apiRequest(`/admin/plan-requests/${requestId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      setMessage(data.message)
      await onRefresh?.()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setReviewingId(null)
    }
  }

  return (
    <section className="enterprise-panel plan-requests-panel glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">{mode === 'super_admin' ? 'Purchases' : 'Purchase Requests'}</span>
          <h2>{mode === 'super_admin' ? 'Client Package Requests' : 'Your Package Requests'}</h2>
        </div>
        <span>{formatNumber(visibleRequests.filter((request) => request.status === 'pending').length)} pending</span>
      </div>

      {visibleRequests.length === 0 ? (
        <div className="empty-control">No package purchase requests yet.</div>
      ) : (
        <div className="plan-request-list">
          {visibleRequests.map((request) => (
            <article className="plan-request-row" key={request.id}>
              <div>
                <span className={`admin-state ${request.status}`}>{request.status}</span>
                <strong>{request.tenant_name}</strong>
                <small>
                  {request.current_plan?.name || 'No current package'} to {request.requested_plan.name} · {request.billing_type}
                </small>
                {request.note ? <p>{request.note}</p> : null}
              </div>
              <div>
                <span>{formatCurrency(request.requested_plan.monthly_base_price)}</span>
                <small>{formatMinutes(request.requested_plan.monthly_minute_allowance)} included</small>
                {mode === 'super_admin' && request.status === 'pending' ? (
                  <div className="plan-request-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={reviewingId === request.id}
                      onClick={() => reviewRequest(request.id, 'rejected')}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={reviewingId === request.id}
                      onClick={() => reviewRequest(request.id, 'approved')}
                    >
                      Approve
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {message ? <div className="company-edit-message">{message}</div> : null}
    </section>
  )
}

function PackagePurchasePanel({ enterprise, mode, selectedPlanId, onSelectPlan, onRefresh }) {
  const plans = (enterprise?.plans || []).filter((plan) => plan.status === 'active')
  const currentPlan = enterprise?.current_plan || getPrimaryClient(enterprise)?.plan
  const pendingRequest = getPendingPlanRequest(enterprise)
  const [billingType, setBillingType] = useState('monthly')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const selectedPlan = plans.find((plan) => String(plan.id) === String(selectedPlanId))

  useEffect(() => {
    if (selectedPlanId || !plans.length) return
    const nextPlan = plans.find((plan) => Number(plan.id) !== Number(currentPlan?.id)) || plans[0]
    if (nextPlan) onSelectPlan?.(String(nextPlan.id))
  }, [currentPlan?.id, onSelectPlan, plans, selectedPlanId])

  async function requestPackage(event) {
    event.preventDefault()
    if (!selectedPlan) return

    setSubmitting(true)
    setMessage(`Sending ${selectedPlan.name} purchase request...`)

    try {
      const data = await apiRequest('/admin/plan-requests', {
        method: 'POST',
        body: JSON.stringify({
          plan_id: selectedPlan.id,
          billing_type: billingType,
          note,
        }),
      })
      setMessage(data.message)
      setNote('')
      await onRefresh?.()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (mode === 'super_admin') {
    return (
      <div className="dashboard-tab-panel">
        <PlanRequestsPanel requests={enterprise?.plan_requests || []} mode={mode} onRefresh={onRefresh} />
        <ServicePlansPanel
          plans={enterprise?.plans || []}
          currentPlan={currentPlan}
          selectedPlanId={selectedPlanId}
          onSelectPlan={onSelectPlan}
          mode={mode}
        />
      </div>
    )
  }

  return (
    <div className="dashboard-tab-panel">
      <section className="enterprise-panel purchase-panel glass-card">
        <div className="admin-panel-header">
          <div>
            <span className="eyebrow">Purchase RTC</span>
            <h2>Choose Or Upgrade Your Package</h2>
          </div>
          {currentPlan ? <span>Current: {currentPlan.name}</span> : null}
        </div>

        <div className="purchase-status-grid">
          <div>
            <span>Active package</span>
            <strong>{currentPlan?.name || 'No package'}</strong>
            <small>{currentPlan ? `${formatCurrency(currentPlan.monthly_base_price)} base · ${formatMinutes(currentPlan.monthly_minute_allowance)} included` : 'Select a package to start RTC service.'}</small>
          </div>
          <div>
            <span>Purchase status</span>
            <strong>{pendingRequest ? 'Pending review' : 'Ready'}</strong>
            <small>{pendingRequest ? `${pendingRequest.requested_plan.name} request is waiting for approval.` : 'You can request a package change.'}</small>
          </div>
        </div>

        <div className="purchase-plan-grid">
          {plans.map((plan) => {
            const isCurrent = Number(plan.id) === Number(currentPlan?.id)
            const isSelected = Number(plan.id) === Number(selectedPlanId)
            return (
              <button
                type="button"
                className={isCurrent ? 'purchase-plan-card active' : isSelected ? 'purchase-plan-card selected' : 'purchase-plan-card'}
                key={plan.id}
                onClick={() => onSelectPlan?.(String(plan.id))}
              >
                <span className="eyebrow">{plan.code}</span>
                <strong>{plan.name}</strong>
                <small>{plan.description}</small>
                <b>{formatCurrency(plan.monthly_base_price)}</b>
                <span>{formatMinutes(plan.monthly_minute_allowance)} · {formatNumber(plan.max_rooms)} rooms · {formatNumber(plan.max_apps)} apps</span>
              </button>
            )
          })}
        </div>

        <form className="purchase-request-form" onSubmit={requestPackage}>
          <label>
            <span>Billing scope</span>
            <select value={billingType} onChange={(event) => setBillingType(event.target.value)}>
              {BILLING_TYPE_OPTIONS.map((type) => <option value={type} key={type}>{type}</option>)}
            </select>
          </label>
          <label>
            <span>Purchase note</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Monthly production package" />
          </label>
          <button
            className="primary-button"
            type="submit"
            disabled={submitting || !selectedPlan || pendingRequest || Number(selectedPlan?.id) === Number(currentPlan?.id)}
          >
            {submitting ? 'Sending...' : selectedPlan ? `Request ${selectedPlan.name}` : 'Choose package'}
          </button>
        </form>

        {message ? <div className="company-edit-message">{message}</div> : null}
      </section>
      <PlanRequestsPanel requests={enterprise?.plan_requests || []} mode={mode} onRefresh={onRefresh} />
    </div>
  )
}

function SdkAccessPanel({ enterprise, mode, isSuperAdmin, onRefresh }) {
  const clients = enterprise?.clients || []
  const apps = enterprise?.apps || []
  const [tenantId, setTenantId] = useState('')
  const [appName, setAppName] = useState('')
  const [platform, setPlatform] = useState('web_mobile')
  const [allowedOrigins, setAllowedOrigins] = useState('')
  const [creating, setCreating] = useState(false)
  const [createdApp, setCreatedApp] = useState(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!tenantId && clients[0]?.id) setTenantId(String(clients[0].id))
  }, [clients, tenantId])

  async function createApp(event) {
    event.preventDefault()
    setCreating(true)
    setCreatedApp(null)
    setMessage('Generating SDK access...')

    try {
      const body = {
        name: appName,
        platform,
        allowed_origins: allowedOrigins,
      }
      if (isSuperAdmin) body.tenant_id = tenantId

      const data = await apiRequest('/admin/client-apps', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setCreatedApp(data)
      setMessage(data.message)
      setAppName('')
      setAllowedOrigins('')
      await onRefresh?.()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="dashboard-tab-panel">
      <section className="enterprise-panel sdk-access-panel glass-card">
        <div className="admin-panel-header">
          <div>
            <span className="eyebrow">SDK Access</span>
            <h2>Generate App Credentials</h2>
          </div>
          <span>{formatNumber(apps.length)} apps</span>
        </div>

        <form className="sdk-access-form" onSubmit={createApp}>
          {isSuperAdmin && clients.length > 1 ? (
            <label>
              <span>Client company</span>
              <select value={tenantId} onChange={(event) => setTenantId(event.target.value)}>
                {clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}
              </select>
            </label>
          ) : null}
          <label>
            <span>App name</span>
            <input value={appName} onChange={(event) => setAppName(event.target.value)} placeholder="Production mobile app" />
          </label>
          <label>
            <span>Platform</span>
            <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
              <option value="web_mobile">Web mobile</option>
              <option value="web">Web</option>
              <option value="ios">iOS</option>
              <option value="android">Android</option>
              <option value="server">Server</option>
            </select>
          </label>
          <label className="sdk-origin-field">
            <span>Allowed origins</span>
            <textarea value={allowedOrigins} onChange={(event) => setAllowedOrigins(event.target.value)} placeholder="https://client-app.com" />
          </label>
          <button className="primary-button" type="submit" disabled={creating || (isSuperAdmin && !tenantId)}>
            {creating ? 'Generating...' : 'Generate SDK access'}
          </button>
        </form>

        {createdApp?.credentials ? (
          <div className="sdk-created-credentials">
            <strong>New credentials</strong>
            <dl>
              <dt>App key</dt>
              <dd>{createdApp.credentials.app_key}</dd>
              <dt>API key</dt>
              <dd>{createdApp.credentials.api_key}</dd>
              <dt>SDK token</dt>
              <dd>{createdApp.credentials.sdk_token}</dd>
            </dl>
          </div>
        ) : null}

        {message ? <div className="company-edit-message">{message}</div> : null}
      </section>

      <ClientAppsPanel apps={apps} mode={mode} />
      {apps.length ? null : <AdminEmptyState title="No SDK apps found" detail="Generate SDK access to connect a client app." />}
    </div>
  )
}

function CompanyProfilePanel({ enterprise }) {
  const client = getPrimaryClient(enterprise)
  if (!client) return <AdminEmptyState title="No company profile found" detail="This admin account is not attached to a client company." />

  return (
    <section className="enterprise-panel company-profile-panel glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">Company</span>
          <h2>{client.name}</h2>
        </div>
        <span className={`admin-state ${client.status}`}>{client.status}</span>
      </div>

      <div className="company-profile-grid">
        <div>
          <span>Tenant ID</span>
          <strong>{client.tenant_uid}</strong>
        </div>
        <div>
          <span>Package</span>
          <strong>{client.plan?.name || 'No package'}</strong>
        </div>
        <div>
          <span>Business email</span>
          <strong>{client.company_email || '-'}</strong>
        </div>
        <div>
          <span>Billing email</span>
          <strong>{client.billing_email || '-'}</strong>
        </div>
        <div>
          <span>Primary contact</span>
          <strong>{client.primary_contact_name || '-'}</strong>
        </div>
        <div>
          <span>Contact email</span>
          <strong>{client.primary_contact_email || '-'}</strong>
        </div>
      </div>

      <div className="company-limit-strip">
        <span><b>{formatNumber(client.default_limits?.app_count)}</b> apps</span>
        <span><b>{formatNumber(client.default_limits?.room_count)}</b> rooms</span>
        <span><b>{formatNumber(client.default_limits?.participant_limit)}</b> participants per room</span>
        <span><b>{client.billing_type}</b> billing</span>
      </div>
    </section>
  )
}

function SimpleHealthPanel({ dashboard, enterprise, rooms, onTabChange }) {
  const roomMetrics = dashboard?.metrics?.rooms || {}
  const sessionMetrics = dashboard?.metrics?.sessions || {}
  const verification = dashboard?.usage_verification || {}
  const serviceOnline = enterprise?.service_model?.connection_indicator !== 'attention'
  const availableRooms = (rooms || []).filter((room) => room.status === 'active').length
  const disabledRooms = (rooms || []).filter((room) => room.status === 'inactive').length
  const removedRooms = (rooms || []).filter((room) => room.status === 'ended').length
  const checks = [
    {
      label: 'RTC service',
      value: serviceOnline ? 'Online' : 'Needs attention',
      detail: serviceOnline ? 'Clients can connect to RTC rooms.' : 'Check RTC provider or signaling service.',
      state: serviceOnline ? 'good' : 'attention',
    },
    {
      label: 'Live sessions',
      value: formatNumber(sessionMetrics.active || dashboard?.active_sessions),
      detail: `${formatNumber(sessionMetrics.started_today)} started today`,
      state: Number(sessionMetrics.active || dashboard?.active_sessions || 0) > 0 ? 'good' : 'neutral',
    },
    {
      label: 'Available rooms',
      value: formatNumber(availableRooms || roomMetrics.active),
      detail: `${formatNumber(disabledRooms || roomMetrics.inactive)} disabled · ${formatNumber(removedRooms || roomMetrics.ended)} removed`,
      state: 'good',
    },
    {
      label: 'Usage billing',
      value: verification.status === 'verified' ? 'Verified' : 'Review',
      detail: verification.status === 'verified' ? 'Usage records are matching billing checks.' : 'Open usage to inspect records.',
      state: verification.status === 'verified' ? 'good' : 'attention',
    },
  ]

  return (
    <section className="simple-health-panel glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">Health</span>
          <h2>Service Status</h2>
        </div>
        <span>{serviceOnline ? 'Running' : 'Attention'}</span>
      </div>

      <div className="simple-health-grid">
        {checks.map((check) => (
          <div className={`simple-health-card ${check.state}`} key={check.label}>
            <span>{check.label}</span>
            <strong>{check.value}</strong>
            <small>{check.detail}</small>
          </div>
        ))}
      </div>

      <div className="simple-health-actions">
        <button type="button" className="secondary-button" onClick={() => onTabChange('rooms')}>Manage rooms</button>
        <button type="button" className="secondary-button" onClick={() => onTabChange('usage')}>Review usage</button>
        <button type="button" className="secondary-button" onClick={() => onTabChange('sdk')}>Check SDK access</button>
      </div>
    </section>
  )
}

function ScopeSummary({ payload, scope }) {
  const dashboard = payload?.dashboard
  const admin = payload?.admin
  const label = scope === 'super_admin' && !admin ? 'Platform scope' : admin?.tenant_name || 'Admin scope'

  return (
    <section className="admin-scope-summary glass-card">
      <div>
        <span className="eyebrow">{label}</span>
        <h2>{admin ? admin.name : 'All admins and rooms'}</h2>
        <p>{admin ? admin.email : 'Superadmin overview across every admin-owned room.'}</p>
      </div>
      <div className="admin-scope-pills">
        <span><b>{formatNumber(dashboard?.metrics?.rooms?.total)}</b> rooms</span>
        <span><b>{formatNumber(dashboard?.active_sessions)}</b> live sessions</span>
        <span><b>{formatMinutes(dashboard?.minutes_used_this_month)}</b> this month</span>
      </div>
    </section>
  )
}

function EnterpriseServicePanel({ enterprise, mode }) {
  if (!enterprise) return null
  const billing = enterprise.billing || {}
  const totals = enterprise.platform_totals || {}
  const plan = enterprise.current_plan
  const isPlatform = mode === 'super_admin'

  return (
    <section className="enterprise-service-panel glass-card">
      <div className="enterprise-service-copy">
        <span className="eyebrow">{isPlatform ? 'Service Business' : 'Company RTC Service'}</span>
        <h2>{enterprise.service_model?.provider_name || 'TalkEachOther'} RTC Control Center</h2>
        <p>{enterprise.service_model?.purpose}</p>
        <div className="enterprise-service-tags">
          <span>{enterprise.service_model?.selling_unit}</span>
          <span>{enterprise.sdk_status?.token_strategy}</span>
        </div>
      </div>
      <div className="enterprise-kpi-grid">
        <div>
          <span>{isPlatform ? 'Active clients' : 'Current package'}</span>
          <strong>{isPlatform ? formatNumber(totals.active_clients) : plan?.name || 'No plan'}</strong>
        </div>
        <div>
          <span>{isPlatform ? 'Active SDK apps' : 'SDK apps'}</span>
          <strong>{formatNumber(isPlatform ? totals.active_apps : enterprise.apps?.length)}</strong>
        </div>
        <div>
          <span>Month usage</span>
          <strong>{formatMinutes(billing.minutes_month || totals.minutes_month)}</strong>
        </div>
        <div>
          <span>{isPlatform ? 'Estimated revenue' : 'Estimated invoice'}</span>
          <strong>{formatCurrency(billing.estimated_invoice || totals.estimated_invoice)}</strong>
        </div>
      </div>
    </section>
  )
}

function ServiceFlowPanel({ flow }) {
  if (!flow?.length) return null

  return (
    <section className="enterprise-panel glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">Business Flow</span>
          <h2>How TalkEachOther Sells RTC Service</h2>
        </div>
      </div>
      <div className="enterprise-flow-grid">
        {flow.map((item, index) => (
          <div className="enterprise-flow-step" key={item.title}>
            <span>{index + 1}</span>
            <strong>{item.title}</strong>
            <small>{item.owner}</small>
            <p>{item.output}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function ServicePlansPanel({ plans, currentPlan, selectedPlanId, onSelectPlan, mode }) {
  if (!plans?.length) return null
  const visiblePlans = plans.filter((plan) => plan.status === 'active' || currentPlan?.id === plan.id)
  const selectedPlan = visiblePlans.find((plan) => String(plan.id) === String(selectedPlanId))

  return (
    <section className="enterprise-panel glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">Packages</span>
          <h2>{mode === 'super_admin' ? 'Sellable Service Plans' : 'Available Package Limits'}</h2>
        </div>
        <span>{selectedPlan ? `Viewing: ${selectedPlan.name}` : currentPlan ? `Current: ${currentPlan.name}` : 'Select a package'}</span>
      </div>
      <div className="service-plan-grid">
        {visiblePlans.map((plan) => {
          const active = String(selectedPlanId || currentPlan?.id || '') === String(plan.id)
          return (
            <button
              type="button"
              className={active ? 'service-plan-card active selectable' : 'service-plan-card selectable'}
              key={plan.code}
              onClick={() => onSelectPlan?.(String(plan.id))}
            >
              <div>
                <span className="eyebrow">{plan.code}</span>
                <h3>{plan.name}</h3>
                <p>{plan.description}</p>
              </div>
              <div className="service-plan-price">
                <strong>{formatCurrency(plan.monthly_base_price)}</strong>
                <span>{formatNumber(plan.monthly_minute_allowance)} min/month</span>
              </div>
              <div className="service-plan-limits">
                <span>{formatNumber(plan.max_room_admins)} room admins</span>
                <span>{formatNumber(plan.max_rooms)} rooms</span>
                <span>{formatNumber(plan.max_apps)} apps</span>
                <span>{formatNumber(plan.max_participants_per_room)} participants</span>
                <span>{formatNumber(plan.feature_count)} tools</span>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function ClientAppsPanel({ apps, mode }) {
  if (!apps?.length) return null

  return (
    <section className="enterprise-panel glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">SDK Access</span>
          <h2>{mode === 'super_admin' ? 'Client Apps And Generated Keys' : 'Your App Key, API Key, And SDK Token'}</h2>
        </div>
        <span>{formatNumber(apps.length)} apps</span>
      </div>
      <div className="client-app-grid">
        {apps.map((app) => (
          <article className="client-app-card" key={app.id}>
            <div className="client-app-head">
              <span className={`admin-state ${app.status}`}>{app.status}</span>
              <strong>{app.name}</strong>
              <small>{app.tenant_name} · {app.platform}</small>
            </div>
            <dl>
              <dt>App key</dt>
              <dd>{app.app_key}</dd>
              <dt>API key</dt>
              <dd>{app.api_key_masked}</dd>
              <dt>SDK token</dt>
              <dd>{app.sdk_token_masked}</dd>
              <dt>Allowed origins</dt>
              <dd>{app.allowed_origins?.join(', ') || 'Any configured origin'}</dd>
            </dl>
          </article>
        ))}
      </div>
    </section>
  )
}

function CompanySetupPanel({ plans, form, errors, creating, generatingTenantId, result, message, onChange, onGenerateTenantId, onSubmit }) {
  const activePlans = (plans || []).filter((plan) => plan.status === 'active')

  return (
    <section className="enterprise-panel company-setup-panel glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">Client Company Setup</span>
          <h2>Create Client Tenant</h2>
        </div>
        <span>{formatNumber(activePlans.length)} packages</span>
      </div>

      <form className="company-setup-form" onSubmit={onSubmit}>
        <div className="company-setup-fields">
          <div className="tenant-id-control">
            <label>
              <span>Tenant ID</span>
              <input
                aria-invalid={Boolean(errors.tenant_id)}
                value={form.tenant_id}
                onChange={(event) => onChange('tenant_id', event.target.value)}
                placeholder="tenant_abc_health_9x72k"
              />
              {errors.tenant_id ? <small className="form-error">{errors.tenant_id}</small> : null}
            </label>
            <button type="button" className="secondary-button" onClick={onGenerateTenantId} disabled={generatingTenantId || creating}>
              {generatingTenantId ? 'Generating...' : 'Generate tenant_id'}
            </button>
          </div>

          <div className="field-row">
            <label>
              <span>Company name</span>
              <input
                aria-invalid={Boolean(errors.company_name)}
                value={form.company_name}
                onChange={(event) => onChange('company_name', event.target.value)}
                placeholder="ABC Health App"
                required
              />
              {errors.company_name ? <small className="form-error">{errors.company_name}</small> : null}
            </label>
            <label>
              <span>Legal name</span>
              <input
                value={form.legal_name}
                onChange={(event) => onChange('legal_name', event.target.value)}
                placeholder="ABC Health Technologies LLC"
              />
            </label>
          </div>

          <div className="field-row">
            <label>
              <span>Business email</span>
              <input
                aria-invalid={Boolean(errors.company_email)}
                type="email"
                value={form.company_email}
                onChange={(event) => onChange('company_email', event.target.value)}
                placeholder="hello@company.com"
              />
              {errors.company_email ? <small className="form-error">{errors.company_email}</small> : null}
            </label>
            <label>
              <span>Billing email</span>
              <input
                aria-invalid={Boolean(errors.billing_email)}
                type="email"
                value={form.billing_email}
                onChange={(event) => onChange('billing_email', event.target.value)}
                placeholder="billing@company.com"
              />
              {errors.billing_email ? <small className="form-error">{errors.billing_email}</small> : null}
            </label>
          </div>

          <div className="field-row">
            <label>
              <span>Phone</span>
              <input
                value={form.phone}
                onChange={(event) => onChange('phone', event.target.value)}
                placeholder="+1 555 0100"
              />
            </label>
            <label>
              <span>Industry</span>
              <input
                value={form.industry}
                onChange={(event) => onChange('industry', event.target.value)}
                placeholder="Healthcare"
              />
            </label>
          </div>

          <div className="field-row">
            <label>
              <span>Address</span>
              <input
                value={form.address}
                onChange={(event) => onChange('address', event.target.value)}
                placeholder="123 Market Street, Suite 400"
              />
            </label>
            <label>
              <span>Country</span>
              <input
                value={form.country}
                onChange={(event) => onChange('country', event.target.value)}
                placeholder="United States"
              />
            </label>
          </div>

          <div className="field-row">
            <label>
              <span>Timezone</span>
              <input
                value={form.timezone}
                onChange={(event) => onChange('timezone', event.target.value)}
                placeholder="America/New_York"
              />
            </label>
          </div>

          <div className="field-row">
            <label>
              <span>Package</span>
              <select
                aria-invalid={Boolean(errors.plan_id)}
                value={form.plan_id}
                onChange={(event) => onChange('plan_id', event.target.value)}
                required
              >
                <option value="">Select package</option>
                {activePlans.map((plan) => (
                  <option value={plan.id} key={plan.id}>
                    {plan.name} - {formatNumber(plan.monthly_minute_allowance)} min
                  </option>
                ))}
              </select>
              {errors.plan_id ? <small className="form-error">{errors.plan_id}</small> : null}
            </label>
            <label>
              <span>Billing type</span>
              <select value={form.billing_type} onChange={(event) => onChange('billing_type', event.target.value)}>
                {BILLING_TYPE_OPTIONS.map((type) => (
                  <option value={type} key={type}>{type}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="default-limit-grid">
            <label>
              <span>Default apps</span>
              <input
                type="number"
                min="0"
                value={form.default_app_limit}
                onChange={(event) => onChange('default_app_limit', event.target.value)}
                placeholder="1"
              />
            </label>
            <label>
              <span>Default rooms</span>
              <input
                type="number"
                min="0"
                value={form.default_room_limit}
                onChange={(event) => onChange('default_room_limit', event.target.value)}
                placeholder="25"
              />
            </label>
            <label>
              <span>Participant limit</span>
              <input
                type="number"
                min="0"
                value={form.default_participant_limit}
                onChange={(event) => onChange('default_participant_limit', event.target.value)}
                placeholder="50"
              />
            </label>
          </div>

          <div className="field-row">
            <label>
              <span>Primary contact</span>
              <input
                value={form.primary_contact_name}
                onChange={(event) => onChange('primary_contact_name', event.target.value)}
                placeholder="Jane Admin"
              />
            </label>
            <label>
              <span>Contact email</span>
              <input
                aria-invalid={Boolean(errors.primary_contact_email)}
                type="email"
                value={form.primary_contact_email}
                onChange={(event) => onChange('primary_contact_email', event.target.value)}
                placeholder="admin@company.com"
              />
              {errors.primary_contact_email ? <small className="form-error">{errors.primary_contact_email}</small> : null}
            </label>
          </div>

          <div className="company-setup-actions">
            <label>
              <span>Status</span>
              <select value={form.status} onChange={(event) => onChange('status', event.target.value)}>
                {COMPANY_STATUS_OPTIONS.map((status) => (
                  <option value={status} key={status}>{status}</option>
                ))}
              </select>
            </label>
            <button className="primary-button" type="submit" disabled={creating || activePlans.length === 0}>
              {creating ? 'Creating...' : 'Create company'}
            </button>
          </div>
        </div>

        <div className="company-created-summary">
          {message ? <strong>{message}</strong> : <strong>Ready for setup</strong>}
          {result?.company ? (
            <dl>
              <dt>Tenant</dt>
              <dd>{result.company.tenant_uid}</dd>
              <dt>Package</dt>
              <dd>{result.company.plan?.name || 'No plan'}</dd>
              <dt>Admin</dt>
              <dd>{result.admin_account?.email || 'Not created'}</dd>
              <dt>Password</dt>
              <dd>{result.admin_account?.temporary_password || '-'}</dd>
              <dt>Invite</dt>
              <dd>{result.admin_invite?.token || '-'}</dd>
            </dl>
          ) : (
            <span>No company created in this session.</span>
          )}
        </div>
      </form>
    </section>
  )
}

function ClientsBillingPanel({ clients, billing, mode }) {
  if (!clients?.length && !billing) return null

  if (mode !== 'super_admin') {
    return (
      <section className="enterprise-panel glass-card">
        <div className="admin-panel-header">
          <div>
            <span className="eyebrow">Billing</span>
            <h2>Company Usage Amount</h2>
          </div>
          <span>{formatPercent(billing?.usage_percent)} used</span>
        </div>
        <div className="billing-summary-grid">
          <div><span>Included allowance</span><strong>{formatMinutes(billing?.monthly_allowance)}</strong></div>
          <div><span>Used this month</span><strong>{formatMinutes(billing?.minutes_month)}</strong></div>
          <div><span>Overage</span><strong>{formatMinutes(billing?.overage_minutes)}</strong></div>
          <div><span>Invoice estimate</span><strong>{formatCurrency(billing?.estimated_invoice)}</strong></div>
        </div>
        <p className="enterprise-note">{billing?.note}</p>
      </section>
    )
  }

  return (
    <section className="enterprise-panel glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">Clients</span>
          <h2>Company Plans, Usage, And Billing</h2>
        </div>
        <span>{formatNumber(clients.length)} companies</span>
      </div>
      <div className="admin-table-scroll compact">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Plan</th>
              <th>Apps</th>
              <th>Rooms</th>
              <th>Month Usage</th>
              <th>Invoice</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.id}>
                <td>
                  <strong>{client.name}</strong>
                  <span>{client.tenant_uid} · {client.status}</span>
                </td>
                <td>
                  <strong>{client.plan?.name || 'No plan'}</strong>
                  <span>{formatNumber(client.plan?.max_room_admins)} room admins max</span>
                </td>
                <td>{formatNumber(client.active_app_count)} / {formatNumber(client.app_count)}</td>
                <td>{formatNumber(client.active_room_count)} live · {formatNumber(client.room_count)} total</td>
                <td>{formatMinutes(client.minutes_month)} · {formatPercent(client.usage_percent)}</td>
                <td>{formatCurrency(client.estimated_invoice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function CompanyManagementPanel({ clients, plans, onSaved }) {
  const activePlans = (plans || []).filter((plan) => plan.status === 'active')
  const [selectedCompanyId, setSelectedCompanyId] = useState(clients?.[0]?.id || null)
  const selectedCompany = clients.find((client) => Number(client.id) === Number(selectedCompanyId)) || clients[0] || null
  const planOptions = selectedCompany?.plan && !activePlans.some((plan) => Number(plan.id) === Number(selectedCompany.plan.id))
    ? [selectedCompany.plan, ...activePlans]
    : activePlans
  const [form, setForm] = useState(companyToForm(selectedCompany))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    setSelectedCompanyId((current) => current || clients?.[0]?.id || null)
  }, [clients])

  useEffect(() => {
    setForm(companyToForm(selectedCompany))
    setErrors({})
    setMessage('')
  }, [selectedCompany?.id])

  function change(field, value) {
    setErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
    setForm((current) => {
      if (field !== 'plan_id') return { ...current, [field]: value }
      const chosenPlan = planOptions.find((plan) => String(plan.id) === String(value))
      return { ...current, plan_id: value, ...limitsFromPlan(chosenPlan) }
    })
  }

  async function saveCompany(event) {
    event.preventDefault()
    if (!selectedCompany) return

    setSaving(true)
    setErrors({})
    setMessage('Saving company...')

    try {
      const data = await apiRequest(`/admin/companies/${selectedCompany.id}`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      })
      setMessage(data.message)
      await onSaved?.()
    } catch (error) {
      setErrors(error.errors || {})
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function sendInvite() {
    if (!selectedCompany) return

    setInviting(true)
    setMessage('Creating admin invite...')

    try {
      const data = await apiRequest(`/admin/companies/${selectedCompany.id}/admin-invite`, {
        method: 'POST',
        body: JSON.stringify({
          primary_contact_name: form.primary_contact_name,
          primary_contact_email: form.primary_contact_email,
        }),
      })
      setMessage(`${data.message} Token: ${data.admin_invite?.token || 'created'}`)
      await onSaved?.()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setInviting(false)
    }
  }

  if (!clients?.length) return null

  return (
    <section className="enterprise-panel company-management-panel glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">View / Edit Company</span>
          <h2>Company Profile, Package, Limits, And Invite</h2>
        </div>
        <span>{formatNumber(clients.length)} companies</span>
      </div>

      <div className="company-management-grid">
        <div className="company-picker-list">
          {clients.map((client) => (
            <button
              type="button"
              className={Number(selectedCompany?.id) === Number(client.id) ? 'company-picker active' : 'company-picker'}
              key={client.id}
              onClick={() => setSelectedCompanyId(client.id)}
            >
              <strong>{client.name}</strong>
              <span>{client.tenant_uid} · {client.plan?.name || 'No package'}</span>
              <small>{client.status} · {client.billing_type}</small>
            </button>
          ))}
        </div>

        <form className="company-edit-form" onSubmit={saveCompany}>
          <div className="field-row">
            <label>
              <span>Company name</span>
              <input value={form.company_name} onChange={(event) => change('company_name', event.target.value)} />
              {errors.company_name ? <small className="form-error">{errors.company_name}</small> : null}
            </label>
            <label>
              <span>Legal name</span>
              <input value={form.legal_name} onChange={(event) => change('legal_name', event.target.value)} />
            </label>
          </div>

          <div className="field-row">
            <label>
              <span>Email</span>
              <input type="email" value={form.company_email} onChange={(event) => change('company_email', event.target.value)} />
              {errors.company_email ? <small className="form-error">{errors.company_email}</small> : null}
            </label>
            <label>
              <span>Phone</span>
              <input value={form.phone} onChange={(event) => change('phone', event.target.value)} />
            </label>
          </div>

          <div className="field-row">
            <label>
              <span>Address</span>
              <input value={form.address} onChange={(event) => change('address', event.target.value)} />
            </label>
            <label>
              <span>Industry</span>
              <input value={form.industry} onChange={(event) => change('industry', event.target.value)} />
            </label>
          </div>

          <div className="field-row">
            <label>
              <span>Status</span>
              <select value={form.status} onChange={(event) => change('status', event.target.value)}>
                {COMPANY_STATUS_OPTIONS.map((status) => <option value={status} key={status}>{status}</option>)}
              </select>
            </label>
            <label>
              <span>Billing scope</span>
              <select value={form.billing_type} onChange={(event) => change('billing_type', event.target.value)}>
                {BILLING_TYPE_OPTIONS.map((type) => <option value={type} key={type}>{type}</option>)}
              </select>
            </label>
          </div>

          <div className="field-row">
            <label>
              <span>Package</span>
              <select value={form.plan_id} onChange={(event) => change('plan_id', event.target.value)}>
                {planOptions.map((plan) => <option value={plan.id} key={plan.id}>{plan.name}</option>)}
              </select>
              {errors.plan_id ? <small className="form-error">{errors.plan_id}</small> : null}
            </label>
            <label>
              <span>Billing email</span>
              <input type="email" value={form.billing_email} onChange={(event) => change('billing_email', event.target.value)} />
              {errors.billing_email ? <small className="form-error">{errors.billing_email}</small> : null}
            </label>
          </div>

          <div className="default-limit-grid">
            <label>
              <span>Apps</span>
              <input type="number" min="0" value={form.default_app_limit} onChange={(event) => change('default_app_limit', event.target.value)} />
            </label>
            <label>
              <span>Rooms</span>
              <input type="number" min="0" value={form.default_room_limit} onChange={(event) => change('default_room_limit', event.target.value)} />
            </label>
            <label>
              <span>Participants</span>
              <input type="number" min="0" value={form.default_participant_limit} onChange={(event) => change('default_participant_limit', event.target.value)} />
            </label>
          </div>

          <div className="field-row">
            <label>
              <span>Primary contact</span>
              <input value={form.primary_contact_name} onChange={(event) => change('primary_contact_name', event.target.value)} />
            </label>
            <label>
              <span>Contact email</span>
              <input type="email" value={form.primary_contact_email} onChange={(event) => change('primary_contact_email', event.target.value)} />
              {errors.primary_contact_email ? <small className="form-error">{errors.primary_contact_email}</small> : null}
            </label>
          </div>

          <div className="company-edit-actions">
            <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save company'}</button>
            <button className="secondary-button" type="button" disabled={inviting || !form.primary_contact_email} onClick={sendInvite}>
              {inviting ? 'Inviting...' : 'Create admin invite'}
            </button>
          </div>

          {message ? <div className="company-edit-message">{message}</div> : null}
        </form>
      </div>
    </section>
  )
}

function FeatureControlsPanel({ features, selectedPlan }) {
  const displayFeatures = selectedPlan ? planFeatureRows(selectedPlan) : features || []
  if (!displayFeatures.length) return null
  const groups = groupedFeatures(displayFeatures)
  const enabledCount = displayFeatures.filter((feature) => feature.enabled).length

  return (
    <section className="enterprise-panel glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">Feature Controls</span>
          <h2>{selectedPlan ? `${selectedPlan.name} Tools` : 'RTC Tools Enabled By Package'}</h2>
        </div>
        <span>{formatNumber(enabledCount)} enabled</span>
      </div>
      <div className="feature-control-groups">
        {Object.entries(groups).map(([group, items]) => (
          <div className="feature-control-group" key={group}>
            <h3>{group}</h3>
            <div>
              {items.map((feature) => (
                <span className={feature.enabled ? 'feature-pill enabled' : 'feature-pill disabled'} key={`${feature.app_id || selectedPlan?.id || 'plan'}-${feature.key}`}>
                  {feature.label}
                  {feature.limit_value ? <b>{feature.limit_value}</b> : null}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function AdminList({ admins, selectedAdminId, onSelect, onPlatform }) {
  return (
    <section className="admin-list-panel glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">Super Admin</span>
          <h2>Company Admins</h2>
        </div>
        <button type="button" className={!selectedAdminId ? 'active' : ''} onClick={onPlatform}>All rooms</button>
      </div>

      <div className="admin-account-grid">
        {admins.length === 0 ? (
          <div className="empty-control">No company admins found.</div>
        ) : admins.map((admin) => (
          <button
            type="button"
            className={selectedAdminId === admin.id ? 'admin-account-card active' : 'admin-account-card'}
            key={admin.id}
            onClick={() => onSelect(admin)}
          >
            <span className="admin-account-avatar">{getInitials(admin.name)}</span>
            <span>
              <strong>{admin.name}</strong>
              <small>{admin.email}</small>
            </span>
            <span className="admin-account-stats">
              <b>{formatNumber(admin.stats?.active_rooms)}</b> live
              <b>{formatMinutes(admin.stats?.minutes_month)}</b>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

function AdminRoomsTable({ rooms }) {
  return (
    <section className="admin-data-card glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">Room Data</span>
          <h2>Live State And Usage</h2>
        </div>
        <span>{formatNumber(rooms.length)} rooms</span>
      </div>

      <div className="admin-table-scroll">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th>Room</th>
              <th>State</th>
              <th>Type</th>
              <th>Live</th>
              <th>Usage</th>
              <th>Owner</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rooms.length === 0 ? (
              <tr><td colSpan="7">No rooms in this scope yet.</td></tr>
            ) : rooms.map((room) => (
              <tr key={room.id}>
                <td>
                  <strong>#{room.id} - {room.name}</strong>
                  <span>{room.description || 'No description'}</span>
                </td>
                <td><span className={`admin-state ${room.status}`}>{room.status}</span></td>
                <td>{String(room.room_type || '').replace(/_/g, ' ')}</td>
                <td>{formatNumber(room.active_participants)} people · {formatNumber(room.mics_on)} mic · {formatNumber(room.cameras_on)} cam</td>
                <td>{formatMinutes(room.billable_minutes)} · {formatNumber(room.usage_logs)} logs</td>
                <td>{room.owner_name}</td>
                <td>{formatUsageDate(room.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function RoomManagementPanel({ rooms, clients, isSuperAdmin, onOpenRoom, onRefresh }) {
  const activeClients = (clients || []).filter((client) => client.status === 'active' || client.status === 'pending')
  const [form, setForm] = useState(INITIAL_ROOM_FORM)
  const [errors, setErrors] = useState({})
  const [creating, setCreating] = useState(false)
  const [busyRoomId, setBusyRoomId] = useState(null)
  const [statusFilter, setStatusFilter] = useState('available')
  const [message, setMessage] = useState('')
  const visibleRooms = (rooms || []).filter((room) => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'removed') return room.status === 'ended'
    return room.status !== 'ended'
  })

  useEffect(() => {
    if (!isSuperAdmin || form.tenant_id || !activeClients[0]?.id) return
    setForm((current) => ({ ...current, tenant_id: String(activeClients[0].id) }))
  }, [activeClients, form.tenant_id, isSuperAdmin])

  function change(field, value) {
    setErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function createRoom(event) {
    event.preventDefault()
    setCreating(true)
    setErrors({})
    setMessage('Creating room...')

    try {
      const payload = {
        ...form,
        max_mic_count: Number(form.max_mic_count || 8),
      }
      if (!isSuperAdmin) delete payload.tenant_id
      const data = await apiRequest('/admin/rooms', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setMessage(data.message)
      setForm((current) => ({
        ...INITIAL_ROOM_FORM,
        tenant_id: current.tenant_id,
      }))
      await onRefresh?.()
    } catch (error) {
      setErrors(error.errors || {})
      setMessage(error.message)
    } finally {
      setCreating(false)
    }
  }

  async function updateRoomStatus(room, status) {
    setBusyRoomId(room.id)
    setMessage(status === 'active' ? `Activating ${room.name}...` : `Disabling ${room.name}...`)

    try {
      const data = await apiRequest(`/admin/rooms/${room.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      setMessage(data.message)
      await onRefresh?.()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusyRoomId(null)
    }
  }

  async function removeRoom(room) {
    const confirmed = window.confirm(`Remove ${room.name} from availability?`)
    if (!confirmed) return

    setBusyRoomId(room.id)
    setMessage(`Removing ${room.name}...`)

    try {
      const data = await apiRequest(`/admin/rooms/${room.id}`, { method: 'DELETE' })
      setMessage(data.message)
      await onRefresh?.()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusyRoomId(null)
    }
  }

  return (
    <section className="admin-data-card room-management-panel glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">Rooms</span>
          <h2>Create, Access, And Control Availability</h2>
        </div>
        <span>{formatNumber(visibleRooms.length)} shown</span>
      </div>

      <form className="admin-room-create-form" onSubmit={createRoom}>
        {isSuperAdmin ? (
          <label>
            <span>Client company</span>
            <select value={form.tenant_id} onChange={(event) => change('tenant_id', event.target.value)}>
              {activeClients.map((client) => (
                <option value={client.id} key={client.id}>{client.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          <span>Room name</span>
          <input
            aria-invalid={Boolean(errors.name)}
            value={form.name}
            onChange={(event) => change('name', event.target.value)}
            placeholder="Production support room"
          />
          {errors.name ? <small className="form-error">{errors.name}</small> : null}
        </label>
        <label>
          <span>Type</span>
          <select value={form.room_type} onChange={(event) => change('room_type', event.target.value)}>
            <option value="video">Video</option>
            <option value="group_video">Group video</option>
            <option value="audio">Audio</option>
            <option value="group_audio">Group audio</option>
            <option value="solo_live">Solo live</option>
            <option value="pk_live">PK live</option>
          </select>
        </label>
        <label>
          <span>Privacy</span>
          <select value={form.privacy_type} onChange={(event) => change('privacy_type', event.target.value)}>
            <option value="public">Public</option>
            <option value="private">Private</option>
            <option value="password">Password</option>
          </select>
        </label>
        {form.privacy_type === 'password' ? (
          <label>
            <span>Password</span>
            <input
              type="password"
              value={form.password}
              onChange={(event) => change('password', event.target.value)}
              placeholder="Room password"
            />
            {errors.password ? <small className="form-error">{errors.password}</small> : null}
          </label>
        ) : null}
        <label>
          <span>Max mic</span>
          <input
            type="number"
            min="1"
            max="16"
            value={form.max_mic_count}
            onChange={(event) => change('max_mic_count', event.target.value)}
          />
        </label>
        <label className="admin-room-toggle">
          <input
            type="checkbox"
            checked={form.screen_share_enabled}
            onChange={(event) => change('screen_share_enabled', event.target.checked)}
          />
          <span>Screen share</span>
        </label>
        <button className="primary-button" type="submit" disabled={creating || (isSuperAdmin && !form.tenant_id)}>
          {creating ? 'Creating...' : 'Create room'}
        </button>
      </form>

      <div className="room-filter-row">
        {[
          ['available', 'Available'],
          ['removed', 'Removed'],
          ['all', 'All'],
        ].map(([key, label]) => (
          <button type="button" className={statusFilter === key ? 'active' : ''} key={key} onClick={() => setStatusFilter(key)}>
            {label}
          </button>
        ))}
      </div>

      <div className="admin-table-scroll">
        <table className="admin-data-table admin-room-table">
          <thead>
            <tr>
              <th>Room</th>
              <th>Status</th>
              <th>Type</th>
              <th>Live</th>
              <th>Owner</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleRooms.length === 0 ? (
              <tr><td colSpan="6">No rooms in this scope.</td></tr>
            ) : visibleRooms.map((room) => (
              <tr key={room.id}>
                <td>
                  <strong>#{room.id} - {room.name}</strong>
                  <span>{room.description || `${formatMinutes(room.billable_minutes)} used`}</span>
                </td>
                <td><span className={`admin-state ${room.status}`}>{room.status}</span></td>
                <td>{String(room.room_type || '').replace(/_/g, ' ')}</td>
                <td>{formatNumber(room.active_participants)} people · {formatNumber(room.active_sessions)} sessions</td>
                <td>{room.owner_name}</td>
                <td>
                  <div className="admin-room-actions">
                    <button type="button" className="secondary-button" onClick={() => onOpenRoom?.(room.id, { room })} disabled={room.status !== 'active'}>
                      Open
                    </button>
                    {room.status === 'active' ? (
                      <button type="button" className="secondary-button" disabled={busyRoomId === room.id} onClick={() => updateRoomStatus(room, 'inactive')}>
                        Disable
                      </button>
                    ) : room.status !== 'ended' ? (
                      <button type="button" className="secondary-button" disabled={busyRoomId === room.id} onClick={() => updateRoomStatus(room, 'active')}>
                        Activate
                      </button>
                    ) : null}
                    {room.status !== 'ended' ? (
                      <button type="button" className="secondary-button danger" disabled={busyRoomId === room.id} onClick={() => removeRoom(room)}>
                        Remove
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {message ? <div className="company-edit-message">{message}</div> : null}
    </section>
  )
}

function DailyUsageTable({ usage }) {
  return (
    <section className="admin-data-card glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">Daily Usage</span>
          <h2>Usage Amount By Day</h2>
        </div>
      </div>

      <div className="admin-table-scroll compact">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Minutes</th>
              <th>Rooms</th>
              <th>Users</th>
              <th>Logs</th>
            </tr>
          </thead>
          <tbody>
            {usage.length === 0 ? (
              <tr><td colSpan="5">No usage has been recorded in the last 30 days.</td></tr>
            ) : usage.map((day) => (
              <tr key={String(day.usage_date)}>
                <td>{formatUsageDate(day.usage_date)}</td>
                <td>{formatMinutes(day.minutes)}</td>
                <td>{formatNumber(day.rooms)}</td>
                <td>{formatNumber(day.users)}</td>
                <td>{formatNumber(day.logs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ParticipantRecordsTable({ records }) {
  return (
    <section className="admin-data-card glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">Detailed Records</span>
          <h2>Join And Exit History</h2>
        </div>
        <span>{formatNumber(records.length)} records</span>
      </div>

      <div className="admin-table-scroll compact">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Room</th>
              <th>Joined</th>
              <th>Exit</th>
              <th>Duration</th>
              <th>Media</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr><td colSpan="6">No join or exit records in this scope yet.</td></tr>
            ) : records.map((record) => (
              <tr key={record.id}>
                <td>
                  <strong>{record.user_name}</strong>
                  <span>{record.user_email || record.role}</span>
                </td>
                <td>#{record.room_id} - {record.room_name}</td>
                <td>{formatUsageDate(record.joined_at)}</td>
                <td>{record.left_at ? formatUsageDate(record.left_at) : 'Live now'}</td>
                <td>{record.left_at ? formatElapsed(record.duration_seconds) : record.connection_status}</td>
                <td>{record.mic_enabled ? 'Mic on' : 'Mic off'} · {record.camera_enabled ? 'Cam on' : 'Cam off'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function AdminView({ onView, onOpenRoom }) {
  const [overview, setOverview] = useState(null)
  const [selectedDetail, setSelectedDetail] = useState(null)
  const [selectedAdminId, setSelectedAdminId] = useState(null)
  const [companyForm, setCompanyForm] = useState(INITIAL_COMPANY_FORM)
  const [companyFormErrors, setCompanyFormErrors] = useState({})
  const [companyCreating, setCompanyCreating] = useState(false)
  const [companyGeneratingTenantId, setCompanyGeneratingTenantId] = useState(false)
  const [createdCompany, setCreatedCompany] = useState(null)
  const [companySubmitMessage, setCompanySubmitMessage] = useState('')
  const [status, setStatus] = useState('Loading dashboard...')
  const [loadingAdminId, setLoadingAdminId] = useState(null)
  const [activeTab, setActiveTab] = useState('command')
  const [selectedPackageId, setSelectedPackageId] = useState('')

  const activePayload = selectedDetail || overview
  const dashboard = activePayload?.dashboard
  const usageVerification = dashboard?.usage_verification
  const recentUsageLogs = dashboard?.recent_usage_logs || []
  const usageStatus = getUsageStatus(usageVerification)
  const isSuperAdmin = overview?.scope === 'super_admin'
  const enterprise = activePayload?.enterprise
  const enterpriseMode = isSuperAdmin && !selectedDetail ? 'super_admin' : 'client_admin'
  const rooms = activePayload?.rooms || []
  const dailyUsage = activePayload?.daily_usage || []
  const participantRecords = activePayload?.participant_records || []
  const selectedPackage = useMemo(() => {
    const plans = enterprise?.plans || []
    return plans.find((plan) => String(plan.id) === String(selectedPackageId))
      || enterprise?.current_plan
      || plans.find((plan) => plan.status === 'active')
      || null
  }, [enterprise?.current_plan, enterprise?.plans, selectedPackageId])
  const dashboardTabs = useMemo(() => buildDashboardTabs(enterpriseMode), [enterpriseMode])
  const pageTitle = useMemo(() => {
    if (isSuperAdmin && selectedDetail?.admin) return `${selectedDetail.admin.name} Dashboard`
    if (isSuperAdmin) return 'Super Admin Dashboard'
    return 'Admin Dashboard'
  }, [isSuperAdmin, selectedDetail])

  async function load(options = {}) {
    try {
      if (!options.silent) setStatus('Loading dashboard...')
      const data = await apiRequest('/admin/overview')
      setOverview(data)
      setSelectedDetail(null)
      setSelectedAdminId(null)
      setStatus(options.silent ? 'Dashboard auto-refreshed' : 'Dashboard loaded')
    } catch (error) {
      setStatus(error.message)
    }
  }

  async function loadAdmin(admin) {
    try {
      setSelectedAdminId(admin.id)
      setLoadingAdminId(admin.id)
      setStatus(`Loading ${admin.name}...`)
      const data = await apiRequest(`/admin/admins/${admin.id}`)
      setSelectedDetail(data)
      setStatus(`${admin.name} loaded`)
    } catch (error) {
      setStatus(error.message)
    } finally {
      setLoadingAdminId(null)
    }
  }

  function updateCompanyForm(field, value) {
    setCompanyForm((current) => {
      if (field !== 'plan_id') return { ...current, [field]: value }
      const chosenPlan = overview?.enterprise?.plans?.find((plan) => String(plan.id) === String(value))
      return { ...current, plan_id: value, ...limitsFromPlan(chosenPlan) }
    })
    setCompanyFormErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  async function generateTenantId() {
    setCompanyGeneratingTenantId(true)
    setCompanyFormErrors((current) => {
      if (!current.tenant_id) return current
      const next = { ...current }
      delete next.tenant_id
      return next
    })
    setCompanySubmitMessage('Generating tenant_id...')

    try {
      const query = companyForm.company_name ? `?company_name=${encodeURIComponent(companyForm.company_name)}` : ''
      const data = await apiRequest(`/admin/companies/generate-tenant-id${query}`)
      setCompanyForm((current) => ({ ...current, tenant_id: data.tenant_id }))
      setCompanySubmitMessage(`${data.tenant_id} generated`)
    } catch (error) {
      setCompanySubmitMessage(error.message)
      setStatus(error.message)
    } finally {
      setCompanyGeneratingTenantId(false)
    }
  }

  async function createCompany(event) {
    event.preventDefault()
    setCompanyCreating(true)
    setCompanyFormErrors({})
    setCreatedCompany(null)
    setCompanySubmitMessage('Creating company...')

    try {
      const data = await apiRequest('/admin/companies', {
        method: 'POST',
        body: JSON.stringify(companyForm),
      })
      const planId = companyForm.plan_id
      const selectedPlan = overview?.enterprise?.plans?.find((plan) => String(plan.id) === String(planId))
      setCreatedCompany(data)
      setCompanySubmitMessage(data.message)
      setCompanyForm({ ...INITIAL_COMPANY_FORM, plan_id: planId, ...limitsFromPlan(selectedPlan) })
      await load({ silent: true })
      setStatus(data.next_step ? `${data.message} ${data.next_step}` : data.message)
    } catch (error) {
      setCompanyFormErrors(error.errors || {})
      setCompanySubmitMessage(error.message)
      setStatus(error.message)
    } finally {
      setCompanyCreating(false)
    }
  }

  useEffect(() => {
    load()
    const timer = window.setInterval(() => load({ silent: true }), 15000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!dashboardTabs.some((tab) => tab.key === activeTab)) {
      setActiveTab('command')
    }
  }, [activeTab, dashboardTabs])

  useEffect(() => {
    const firstPlan = overview?.enterprise?.plans?.find((plan) => plan.status === 'active') || overview?.enterprise?.plans?.[0]
    if (firstPlan && !companyForm.plan_id) {
      setCompanyForm((current) => ({ ...current, plan_id: String(firstPlan.id), ...limitsFromPlan(firstPlan) }))
    }
  }, [overview?.enterprise?.plans, companyForm.plan_id])

  useEffect(() => {
    const plans = enterprise?.plans || []
    if (!plans.length) return
    const selectedStillExists = plans.some((plan) => String(plan.id) === String(selectedPackageId))
    if (selectedStillExists) return
    const nextPlan = enterprise?.current_plan || plans.find((plan) => plan.status === 'active') || plans[0]
    if (nextPlan) setSelectedPackageId(String(nextPlan.id))
  }, [enterprise?.current_plan, enterprise?.plans, selectedPackageId])

  return (
    <div className="view-stack admin-dashboard-view">
      <header className="page-header glass-card">
        <div>
          <span className="eyebrow">{isSuperAdmin ? 'Super Admin' : 'Client Admin'}</span>
          <h1>{pageTitle}</h1>
          <p>{isSuperAdmin ? 'Sell RTC packages, onboard clients, issue SDK access, and monitor billing.' : 'Purchase RTC, connect your app, manage rooms, and track billing.'}</p>
        </div>
        <div className="admin-header-actions">
          {isSuperAdmin && selectedDetail ? (
            <button className="secondary-button" onClick={() => {
              setSelectedDetail(null)
              setSelectedAdminId(null)
              setStatus('Showing all admin data')
            }}>All admins</button>
          ) : null}
          <button className="primary-button" onClick={load}>Refresh</button>
        </div>
      </header>

      <div className="admin-status-bar status-bar glass-card">
        <strong>Status:</strong> {loadingAdminId ? `${status} (#${loadingAdminId})` : status}
      </div>

      <DashboardTabs tabs={dashboardTabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'command' ? (
        <div className="dashboard-tab-panel">
          <CommandCenterPanel
            enterprise={enterprise}
            dashboard={dashboard}
            mode={enterpriseMode}
            onTabChange={setActiveTab}
            onView={onView}
          />
          <DashboardMetrics dashboard={dashboard} usageStatusLabel={usageStatus.label} />
        </div>
      ) : null}

      {activeTab === 'clients' && enterpriseMode === 'super_admin' ? (
        <div className="dashboard-tab-panel">
          <ScopeSummary payload={activePayload} scope={overview?.scope} />
          <CompanySetupPanel
            plans={enterprise?.plans || []}
            form={companyForm}
            errors={companyFormErrors}
            creating={companyCreating}
            generatingTenantId={companyGeneratingTenantId}
            result={createdCompany}
            message={companySubmitMessage}
            onChange={updateCompanyForm}
            onGenerateTenantId={generateTenantId}
            onSubmit={createCompany}
          />
          <CompanyManagementPanel
            clients={enterprise?.clients || []}
            plans={enterprise?.plans || []}
            onSaved={() => load({ silent: true })}
          />
          <ClientsBillingPanel clients={enterprise?.clients || []} billing={enterprise?.billing} mode={enterpriseMode} />
        </div>
      ) : null}

      {activeTab === 'packages' ? (
        <div className="dashboard-tab-panel">
          <PackagePurchasePanel
            enterprise={enterprise}
            mode={enterpriseMode}
            selectedPlanId={selectedPackage?.id ? String(selectedPackage.id) : selectedPackageId}
            onSelectPlan={setSelectedPackageId}
            onRefresh={() => load({ silent: true })}
          />
          <FeatureControlsPanel features={enterprise?.feature_controls || []} selectedPlan={selectedPackage} />
        </div>
      ) : null}

      {activeTab === 'purchase' ? (
        <div className="dashboard-tab-panel">
          <PackagePurchasePanel
            enterprise={enterprise}
            mode={enterpriseMode}
            selectedPlanId={selectedPackage?.id ? String(selectedPackage.id) : selectedPackageId}
            onSelectPlan={setSelectedPackageId}
            onRefresh={() => load({ silent: true })}
          />
          <FeatureControlsPanel features={enterprise?.feature_controls || []} selectedPlan={selectedPackage} />
        </div>
      ) : null}

      {activeTab === 'sdk' ? (
        <SdkAccessPanel
          enterprise={enterprise}
          mode={enterpriseMode}
          isSuperAdmin={isSuperAdmin}
          onRefresh={() => load({ silent: true })}
        />
      ) : null}

      {activeTab === 'usage' ? (
        <div className="dashboard-tab-panel">
          <ClientsBillingPanel clients={enterprise?.clients || []} billing={enterprise?.billing} mode={enterpriseMode} />
          <div className="admin-detail-grid">
            <DailyUsageTable usage={dailyUsage} />
            <ParticipantRecordsTable records={participantRecords} />
          </div>
          <section className="usage-dashboard-grid">
            <UsageVerificationCard
              dashboard={dashboard}
              verification={usageVerification}
              status={usageStatus}
            />
            <UsageLogCard billingMode={dashboard?.billing_mode} logs={recentUsageLogs} />
          </section>
        </div>
      ) : null}

      {activeTab === 'rooms' ? (
        <div className="dashboard-tab-panel">
          {isSuperAdmin ? (
            <AdminList
              admins={overview?.admins || []}
              selectedAdminId={selectedAdminId}
              onSelect={loadAdmin}
              onPlatform={() => {
                setSelectedDetail(null)
                setSelectedAdminId(null)
                setStatus('Showing all admin data')
              }}
            />
          ) : null}
          <RoomManagementPanel
            rooms={rooms}
            clients={enterprise?.clients || []}
            isSuperAdmin={isSuperAdmin}
            onOpenRoom={onOpenRoom}
            onRefresh={() => load({ silent: true })}
          />
        </div>
      ) : null}

      {activeTab === 'company' ? (
        <div className="dashboard-tab-panel">
          <CompanyProfilePanel enterprise={enterprise} />
        </div>
      ) : null}

      {activeTab === 'health' ? (
        <div className="dashboard-tab-panel">
          <SimpleHealthPanel
            dashboard={dashboard}
            enterprise={enterprise}
            rooms={rooms}
            onTabChange={setActiveTab}
          />
        </div>
      ) : null}
    </div>
  )
}
