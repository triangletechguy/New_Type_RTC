import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../../services/api'
import { formatElapsed, formatMinutes, formatNumber, formatUsageDate, getInitials } from '../../utils/formatters'
import { ActiveSessionsMonitor } from './ActiveSessionsMonitor'
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

const COMPANY_STATUS_OPTIONS = ['active', 'pending', 'suspended', 'cancelled']
const BILLING_TYPE_OPTIONS = ['monthly', 'prepaid', 'custom', 'enterprise']

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

function ServicePlansPanel({ plans, currentPlan, mode }) {
  if (!plans?.length) return null
  const visiblePlans = plans.filter((plan) => plan.status === 'active' || currentPlan?.id === plan.id)

  return (
    <section className="enterprise-panel glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">Packages</span>
          <h2>{mode === 'super_admin' ? 'Sellable Service Plans' : 'Available Package Limits'}</h2>
        </div>
        {currentPlan ? <span>Current: {currentPlan.name}</span> : null}
      </div>
      <div className="service-plan-grid">
        {visiblePlans.map((plan) => {
          const active = currentPlan?.code === plan.code
          return (
            <article className={active ? 'service-plan-card active' : 'service-plan-card'} key={plan.code}>
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
            </article>
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

function FeatureControlsPanel({ features }) {
  if (!features?.length) return null
  const groups = groupedFeatures(features)

  return (
    <section className="enterprise-panel glass-card">
      <div className="admin-panel-header">
        <div>
          <span className="eyebrow">Feature Controls</span>
          <h2>RTC Tools Enabled By Package</h2>
        </div>
        <span>{formatNumber(features.filter((feature) => feature.enabled).length)} enabled</span>
      </div>
      <div className="feature-control-groups">
        {Object.entries(groups).map(([group, items]) => (
          <div className="feature-control-group" key={group}>
            <h3>{group}</h3>
            <div>
              {items.map((feature) => (
                <span className={feature.enabled ? 'feature-pill enabled' : 'feature-pill disabled'} key={`${feature.app_id || 'plan'}-${feature.key}`}>
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

export default function AdminView() {
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
    const firstPlan = overview?.enterprise?.plans?.find((plan) => plan.status === 'active') || overview?.enterprise?.plans?.[0]
    if (firstPlan && !companyForm.plan_id) {
      setCompanyForm((current) => ({ ...current, plan_id: String(firstPlan.id), ...limitsFromPlan(firstPlan) }))
    }
  }, [overview?.enterprise?.plans, companyForm.plan_id])

  return (
    <div className="view-stack admin-dashboard-view">
      <header className="page-header glass-card">
        <div>
          <span className="eyebrow">{isSuperAdmin ? 'Super Admin' : 'Client Admin'}</span>
          <h1>{pageTitle}</h1>
          <p>{isSuperAdmin ? 'All admins, room live state, usage amounts, and detailed records.' : 'Your rooms, live state, usage, join dates, and exit dates.'}</p>
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

      <div className="status-bar glass-card">
        <strong>Status:</strong> {loadingAdminId ? `${status} (#${loadingAdminId})` : status}
      </div>

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

      <ScopeSummary payload={activePayload} scope={overview?.scope} />

      <EnterpriseServicePanel enterprise={enterprise} mode={enterpriseMode} />

      {enterpriseMode === 'super_admin' ? (
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
      ) : null}

      {enterpriseMode === 'super_admin' ? (
        <CompanyManagementPanel
          clients={enterprise?.clients || []}
          plans={enterprise?.plans || []}
          onSaved={() => load({ silent: true })}
        />
      ) : null}

      <div className="enterprise-dashboard-grid">
        <ClientsBillingPanel clients={enterprise?.clients || []} billing={enterprise?.billing} mode={enterpriseMode} />
        <ClientAppsPanel apps={enterprise?.apps || []} mode={enterpriseMode} />
      </div>

      <ServicePlansPanel plans={enterprise?.plans || []} currentPlan={enterprise?.current_plan} mode={enterpriseMode} />

      <FeatureControlsPanel features={enterprise?.feature_controls || []} />

      {enterpriseMode === 'super_admin' ? <ServiceFlowPanel flow={enterprise?.service_flow || []} /> : null}

      <DashboardMetrics dashboard={dashboard} usageStatusLabel={usageStatus.label} />

      <div className="admin-detail-grid">
        <AdminRoomsTable rooms={rooms} />
        <DailyUsageTable usage={dailyUsage} />
      </div>

      <ParticipantRecordsTable records={participantRecords} />

      <ActiveSessionsMonitor monitor={dashboard?.active_sessions_monitor} />

      <section className="usage-dashboard-grid">
        <UsageVerificationCard
          dashboard={dashboard}
          verification={usageVerification}
          status={usageStatus}
        />
        <UsageLogCard billingMode={dashboard?.billing_mode} logs={recentUsageLogs} />
      </section>
    </div>
  )
}
