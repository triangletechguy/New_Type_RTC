const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const { query, transaction } = require('../config/db')
const { hasAnyRole } = require('../middleware/auth')
const { assertTenantCanUseRoomConfig } = require('../utils/tenantEntitlements')
const {
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
} = require('./adminServiceUtils')

let tenantCompanySchemaPromise = null

async function ensureTenantCompanyColumns() {
  if (!tenantCompanySchemaPromise) {
    tenantCompanySchemaPromise = (async () => {
      const tenantRows = await query(
        `
        SELECT COLUMN_NAME AS column_name
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'tenants'
        `
      )
      const columns = new Set(tenantRows.map((row) => row.column_name))
      const additions = [
        ['tenant_uid', 'ALTER TABLE tenants ADD COLUMN tenant_uid VARCHAR(80) NULL AFTER id'],
        ['company_slug', 'ALTER TABLE tenants ADD COLUMN company_slug VARCHAR(160) NULL AFTER name'],
        ['legal_name', 'ALTER TABLE tenants ADD COLUMN legal_name VARCHAR(180) NULL AFTER company_slug'],
        ['industry', 'ALTER TABLE tenants ADD COLUMN industry VARCHAR(120) NULL AFTER legal_name'],
        ['company_email', 'ALTER TABLE tenants ADD COLUMN company_email VARCHAR(180) NULL AFTER industry'],
        ['phone', 'ALTER TABLE tenants ADD COLUMN phone VARCHAR(60) NULL AFTER company_email'],
        ['website_url', 'ALTER TABLE tenants ADD COLUMN website_url VARCHAR(255) NULL AFTER phone'],
        ['app_url', 'ALTER TABLE tenants ADD COLUMN app_url VARCHAR(255) NULL AFTER website_url'],
        ['telegram_contact', 'ALTER TABLE tenants ADD COLUMN telegram_contact VARCHAR(120) NULL AFTER app_url'],
        ['whatsapp_contact', 'ALTER TABLE tenants ADD COLUMN whatsapp_contact VARCHAR(120) NULL AFTER telegram_contact'],
        ['discord_contact', 'ALTER TABLE tenants ADD COLUMN discord_contact VARCHAR(120) NULL AFTER whatsapp_contact'],
        ['address', 'ALTER TABLE tenants ADD COLUMN address VARCHAR(255) NULL AFTER discord_contact'],
        ['country', 'ALTER TABLE tenants ADD COLUMN country VARCHAR(100) NULL AFTER address'],
        ['timezone', 'ALTER TABLE tenants ADD COLUMN timezone VARCHAR(80) NULL AFTER country'],
        ['primary_contact_name', 'ALTER TABLE tenants ADD COLUMN primary_contact_name VARCHAR(150) NULL AFTER timezone'],
        ['primary_contact_email', 'ALTER TABLE tenants ADD COLUMN primary_contact_email VARCHAR(180) NULL AFTER primary_contact_name'],
        ['billing_email', 'ALTER TABLE tenants ADD COLUMN billing_email VARCHAR(180) NULL AFTER primary_contact_email'],
        ['billing_type', "ALTER TABLE tenants ADD COLUMN billing_type ENUM('monthly', 'prepaid', 'custom', 'enterprise') DEFAULT 'monthly' AFTER billing_email"],
        ['default_app_limit', 'ALTER TABLE tenants ADD COLUMN default_app_limit INT DEFAULT 1 AFTER billing_rate_per_minute'],
        ['default_room_limit', 'ALTER TABLE tenants ADD COLUMN default_room_limit INT DEFAULT 0 AFTER default_app_limit'],
        ['default_participant_limit', 'ALTER TABLE tenants ADD COLUMN default_participant_limit INT DEFAULT 0 AFTER default_room_limit'],
      ]

      await query(
        "ALTER TABLE tenants MODIFY COLUMN status ENUM('pending', 'active', 'inactive', 'suspended', 'cancelled') DEFAULT 'active'"
      )

      for (const [column, statement] of additions) {
        if (!columns.has(column)) {
          await query(statement)
        }
      }

      await query("UPDATE tenants SET tenant_uid = CONCAT('tenant_', id) WHERE tenant_uid IS NULL OR tenant_uid = ''")

      const servicePlanRows = await query(
        `
        SELECT COLUMN_NAME AS column_name
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'service_plans'
        `
      )
      const servicePlanColumns = new Set(servicePlanRows.map((row) => row.column_name))
      if (!servicePlanColumns.has('max_participants_per_room')) {
        await query('ALTER TABLE service_plans ADD COLUMN max_participants_per_room INT DEFAULT 0 AFTER max_apps')
      }

      const appRows = await query(
        `
        SELECT COLUMN_NAME AS column_name
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'client_apps'
        `
      )
      const appColumns = new Set(appRows.map((row) => row.column_name))
      if (!appColumns.has('api_key_hash')) {
        await query('ALTER TABLE client_apps ADD COLUMN api_key_hash CHAR(64) NULL AFTER api_key')
      }
      if (!appColumns.has('last_key_rotated_at')) {
        await query('ALTER TABLE client_apps ADD COLUMN last_key_rotated_at TIMESTAMP NULL AFTER sdk_token')
      }
      const appIndexRows = await query(
        `
        SELECT INDEX_NAME AS index_name
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'client_apps'
        AND INDEX_NAME = 'unique_client_api_key_hash'
        LIMIT 1
        `
      )
      if (!appIndexRows.length) {
        await query('ALTER TABLE client_apps ADD UNIQUE KEY unique_client_api_key_hash (api_key_hash)')
      }
      const oldApiKeyIndexRows = await query(
        `
        SELECT INDEX_NAME AS index_name
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'client_apps'
        AND INDEX_NAME = 'unique_client_api_key'
        LIMIT 1
        `
      )
      if (oldApiKeyIndexRows.length) {
        await query('ALTER TABLE client_apps DROP INDEX unique_client_api_key')
      }
      await query("UPDATE client_apps SET api_key_hash = COALESCE(NULLIF(api_key_hash, ''), SHA2(api_key, 256)), api_key = CONCAT(LEFT(api_key, 6), '...', RIGHT(api_key, 4)) WHERE api_key NOT LIKE '%...%'")

      await query(
        `
        CREATE TABLE IF NOT EXISTS company_admin_invites (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          tenant_id BIGINT UNSIGNED NOT NULL,
          invited_name VARCHAR(150) NULL,
          invited_email VARCHAR(180) NOT NULL,
          token VARCHAR(120) NOT NULL,
          role_name VARCHAR(100) DEFAULT 'client_admin',
          status ENUM('pending', 'accepted', 'cancelled', 'expired') DEFAULT 'pending',
          expires_at TIMESTAMP NULL,
          accepted_at TIMESTAMP NULL,
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY unique_company_invite_token (token),
          INDEX idx_company_invites_tenant_id (tenant_id),
          CONSTRAINT fk_company_invites_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        )
        `
      )

      await query(
        `
        CREATE TABLE IF NOT EXISTS company_plan_requests (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          tenant_id BIGINT UNSIGNED NOT NULL,
          current_plan_id BIGINT UNSIGNED NULL,
          requested_plan_id BIGINT UNSIGNED NOT NULL,
          requested_by BIGINT UNSIGNED NULL,
          billing_type ENUM('monthly', 'prepaid', 'custom', 'enterprise') DEFAULT 'monthly',
          note TEXT NULL,
          status ENUM('pending', 'approved', 'rejected', 'cancelled') DEFAULT 'pending',
          reviewed_by BIGINT UNSIGNED NULL,
          reviewed_at TIMESTAMP NULL,
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_company_plan_requests_tenant_id (tenant_id),
          INDEX idx_company_plan_requests_status (status),
          INDEX idx_company_plan_requests_requested_plan_id (requested_plan_id),
          CONSTRAINT fk_company_plan_requests_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          CONSTRAINT fk_company_plan_requests_current_plan FOREIGN KEY (current_plan_id) REFERENCES service_plans(id) ON DELETE SET NULL,
          CONSTRAINT fk_company_plan_requests_requested_plan FOREIGN KEY (requested_plan_id) REFERENCES service_plans(id) ON DELETE CASCADE,
          CONSTRAINT fk_company_plan_requests_requested_by FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
          CONSTRAINT fk_company_plan_requests_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
        )
        `
      )

      for (const plan of DEFAULT_SERVICE_PLANS) {
        await query(
          `
          INSERT INTO service_plans (
            code, name, description, monthly_base_price, minute_rate,
            monthly_minute_allowance, max_room_admins, max_rooms, max_apps,
            max_participants_per_room, included_features, status, created_at, updated_at
          )
          VALUES (
            :code, :name, :description, :monthlyBasePrice, :minuteRate,
            :monthlyMinuteAllowance, :maxRoomAdmins, :maxRooms, :maxApps,
            :maxParticipantsPerRoom, :includedFeatures, 'active', NOW(), NOW()
          )
          ON DUPLICATE KEY UPDATE
            code = VALUES(code)
          `,
          {
            code: plan.code,
            name: plan.name,
            description: plan.description,
            monthlyBasePrice: plan.monthly_base_price,
            minuteRate: plan.minute_rate,
            monthlyMinuteAllowance: plan.monthly_minute_allowance,
            maxRoomAdmins: plan.max_room_admins,
            maxRooms: plan.max_rooms,
            maxApps: plan.max_apps,
            maxParticipantsPerRoom: plan.max_participants_per_room,
            includedFeatures: JSON.stringify(plan.included_features),
          }
        )
      }

      await query("UPDATE service_plans SET status = 'inactive' WHERE code IN ('starter', 'growth')")
    })().catch((error) => {
      tenantCompanySchemaPromise = null
      throw error
    })
  }

  return tenantCompanySchemaPromise
}

async function getAdminUser(adminId) {
  const rows = await query(
    `
    SELECT
      u.id, u.tenant_id, u.name, u.email, u.status, u.last_login_at, u.created_at,
      t.name AS tenant_name,
      GROUP_CONCAT(DISTINCT roles.name ORDER BY roles.name) AS roles
    FROM users u
    LEFT JOIN tenants t ON t.id = u.tenant_id
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles ON roles.id = ur.role_id
    WHERE u.id = :adminId
    GROUP BY u.id, u.tenant_id, u.name, u.email, u.status, u.last_login_at, u.created_at, t.name
    LIMIT 1
    `,
    { adminId }
  )

  return rows[0] || null
}

async function getClientAdmins() {
  return query(
    `
    SELECT
      u.id, u.tenant_id, u.name, u.email, u.status, u.last_login_at, u.created_at,
      t.name AS tenant_name,
      GROUP_CONCAT(DISTINCT roles.name ORDER BY roles.name) AS roles
    FROM users u
    LEFT JOIN tenants t ON t.id = u.tenant_id
    LEFT JOIN user_roles all_roles ON all_roles.user_id = u.id
    LEFT JOIN roles ON roles.id = all_roles.role_id
    WHERE EXISTS (
      SELECT 1
      FROM user_roles admin_roles
      JOIN roles admin_role_names ON admin_role_names.id = admin_roles.role_id
      WHERE admin_roles.user_id = u.id
      AND admin_role_names.name = 'client_admin'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM user_roles super_roles
      JOIN roles super_role_names ON super_role_names.id = super_roles.role_id
      WHERE super_roles.user_id = u.id
      AND super_role_names.name = 'super_admin'
    )
    GROUP BY u.id, u.tenant_id, u.name, u.email, u.status, u.last_login_at, u.created_at, t.name
    ORDER BY u.created_at ASC, u.id ASC
    `
  )
}

async function getServicePlans() {
  await ensureTenantCompanyColumns()

  const rows = await query(
    `
    SELECT
      id, code, name, description, monthly_base_price, minute_rate,
      monthly_minute_allowance, max_room_admins, max_rooms, max_apps,
      max_participants_per_room, included_features, status, created_at, updated_at
    FROM service_plans
    ORDER BY status = 'active' DESC, monthly_base_price ASC, id ASC
    `
  )

  return rows.map((plan) => ({
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    monthly_base_price: Number(plan.monthly_base_price || 0),
    minute_rate: Number(plan.minute_rate || 0),
    monthly_minute_allowance: Number(plan.monthly_minute_allowance || 0),
    max_room_admins: Number(plan.max_room_admins || 0),
    max_rooms: Number(plan.max_rooms || 0),
    max_apps: Number(plan.max_apps || 0),
    max_participants_per_room: Number(plan.max_participants_per_room || 0),
    included_features: parseJsonArray(plan.included_features),
    status: plan.status,
    created_at: plan.created_at,
    updated_at: plan.updated_at,
  }))
}

async function getTenantPlan(tenantId) {
  if (!tenantId) return null

  const rows = await query(
    `
    SELECT
      tpa.id AS assignment_id,
      tpa.starts_at,
      tpa.ends_at,
      sp.id, sp.code, sp.name, sp.description, sp.monthly_base_price, sp.minute_rate,
      sp.monthly_minute_allowance, sp.max_room_admins, sp.max_rooms, sp.max_apps,
      sp.max_participants_per_room, sp.included_features, sp.status
    FROM tenant_plan_assignments tpa
    INNER JOIN service_plans sp ON sp.id = tpa.plan_id
    WHERE tpa.tenant_id = :tenantId
    AND tpa.status = 'active'
    ORDER BY tpa.id DESC
    LIMIT 1
    `,
    { tenantId }
  )
  const plan = rows[0]
  if (!plan) return null

  return {
    assignment_id: plan.assignment_id,
    starts_at: plan.starts_at,
    ends_at: plan.ends_at,
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    monthly_base_price: Number(plan.monthly_base_price || 0),
    minute_rate: Number(plan.minute_rate || 0),
    monthly_minute_allowance: Number(plan.monthly_minute_allowance || 0),
    max_room_admins: Number(plan.max_room_admins || 0),
    max_rooms: Number(plan.max_rooms || 0),
    max_apps: Number(plan.max_apps || 0),
    max_participants_per_room: Number(plan.max_participants_per_room || 0),
    included_features: parseJsonArray(plan.included_features),
    status: plan.status,
  }
}

async function getUniqueCompanySlug(connection, companyName) {
  const base = slugify(companyName).slice(0, 120)

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const suffix = attempt ? `-${attempt + 1}` : ''
    const candidate = `${base.slice(0, 160 - suffix.length)}${suffix}`
    const [rows] = await connection.execute(
      'SELECT id FROM tenants WHERE company_slug = ? LIMIT 1',
      [candidate]
    )

    if (!rows.length) return candidate
  }

  return `${base.slice(0, 151)}-${crypto.randomBytes(4).toString('hex')}`
}

async function getUniqueTenantUid(connection, companyName = '') {
  const prefix = tenantUidPrefix(companyName)

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const randomPart = crypto.randomBytes(3).toString('hex')
    const candidate = `${prefix.slice(0, 80 - randomPart.length - 1)}_${randomPart}`
    const [rows] = await connection.execute(
      'SELECT id FROM tenants WHERE tenant_uid = ? LIMIT 1',
      [candidate]
    )

    if (!rows.length) return candidate
  }

  return `tenant_${Date.now()}`
}

async function tenantUidExists(connection, tenantUid) {
  const [rows] = await connection.execute(
    'SELECT id FROM tenants WHERE tenant_uid = ? LIMIT 1',
    [tenantUid]
  )

  return rows.length > 0
}

async function ensureRoleIds(connection) {
  await connection.execute(
    `
    INSERT IGNORE INTO roles (name, label, created_at)
    VALUES
      ('end_user', 'End User', NOW()),
      ('client_admin', 'Client Admin', NOW())
    `
  )

  const [roles] = await connection.execute(
    `
    SELECT id, name
    FROM roles
    WHERE name IN ('end_user', 'client_admin')
    `
  )

  return roles.reduce((map, role) => {
    map[role.name] = role.id
    return map
  }, {})
}

async function createClientAdmin(connection, tenantId, companyStatus, contact) {
  if (!contact.email) return null

  const roleIds = await ensureRoleIds(connection)
  const userStatus = userStatusForCompany(companyStatus)
  const [existing] = await connection.execute(
    `
    SELECT id, tenant_id, name, email, status
    FROM users
    WHERE email = ?
    LIMIT 1
    `,
    [contact.email]
  )

  if (existing.length) {
    const user = existing[0]
    if (user.tenant_id && Number(user.tenant_id) !== Number(tenantId)) {
      const error = new Error('Primary contact email already belongs to another company.')
      error.status = 409
      throw error
    }

    await connection.execute(
      `
      UPDATE users
      SET tenant_id = ?,
          name = ?,
          phone = ?,
          gender = COALESCE(gender, 'male'),
          status = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [tenantId, contact.name || user.name, contact.phone || null, userStatus, user.id]
    )

    for (const roleName of ['end_user', 'client_admin']) {
      if (!roleIds[roleName]) continue

      await connection.execute(
        `
        INSERT INTO user_roles (user_id, role_id, tenant_id, created_at)
        SELECT ?, ?, ?, NOW()
        WHERE NOT EXISTS (
          SELECT 1
          FROM user_roles
          WHERE user_id = ?
          AND role_id = ?
          AND tenant_id = ?
        )
        `,
        [user.id, roleIds[roleName], tenantId, user.id, roleIds[roleName], tenantId]
      )
    }

    return {
      id: user.id,
      tenant_id: tenantId,
      name: contact.name || user.name,
      email: contact.email,
      status: userStatus,
      temporary_password: null,
      roles: ['end_user', 'client_admin'],
      existing_account: true,
    }
  }

  const password = contact.password || temporaryPassword()
  const passwordHash = await bcrypt.hash(password, 10)

  const [result] = await connection.execute(
    `
    INSERT INTO users (
      tenant_id, name, email, phone, gender, password_hash, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, 'male', ?, ?, NOW(), NOW())
    `,
    [tenantId, contact.name, contact.email, contact.phone, passwordHash, userStatus]
  )

  for (const roleName of ['end_user', 'client_admin']) {
    if (!roleIds[roleName]) continue

    await connection.execute(
      `
      INSERT INTO user_roles (user_id, role_id, tenant_id, created_at)
      VALUES (?, ?, ?, NOW())
      `,
      [result.insertId, roleIds[roleName], tenantId]
    )
  }

  return {
    id: result.insertId,
    tenant_id: tenantId,
    name: contact.name,
    email: contact.email,
    status: userStatus,
    temporary_password: password,
    roles: ['end_user', 'client_admin'],
  }
}

async function createCompanyAdminInvite(connection, tenantId, contact) {
  if (!contact.email) return null

  const token = `invite_${crypto.randomBytes(18).toString('hex')}`
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  const [result] = await connection.execute(
    `
    INSERT INTO company_admin_invites (
      tenant_id, invited_name, invited_email, token, role_name,
      status, expires_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, 'client_admin', 'pending', ?, NOW(), NOW())
    `,
    [tenantId, contact.name || null, contact.email, token, expiresAt]
  )

  return {
    id: result.insertId,
    tenant_id: tenantId,
    invited_name: contact.name || null,
    invited_email: contact.email,
    token,
    invite_url: `/client-admin/invite/${token}`,
    status: 'pending',
    expires_at: expiresAt.toISOString(),
  }
}

async function uniqueAppKey(connection, tenant = {}) {
  const companyPart = slugify(tenant.name || tenant.tenant_uid || 'client-app')
    .replace(/-/g, '_')
    .slice(0, 28)

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = `app_${companyPart}_${crypto.randomBytes(4).toString('hex')}`
    const [rows] = await connection.execute(
      'SELECT id FROM client_apps WHERE app_key = ? LIMIT 1',
      [candidate]
    )

    if (!rows.length) return candidate
  }

  return `app_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`
}

function makeCredential(prefix) {
  return `${prefix}_${crypto.randomBytes(24).toString('hex')}`
}

async function assignTenantPlan(connection, tenantId, planId, options = {}) {
  const [plans] = await connection.execute(
    `
    SELECT id, name, code, minute_rate, max_apps, max_rooms, max_participants_per_room
    FROM service_plans
    WHERE id = ?
    AND status = 'active'
    LIMIT 1
    `,
    [planId]
  )
  const plan = plans[0]

  if (!plan) {
    const error = new Error('Select an active service plan.')
    error.status = 422
    throw error
  }

  const limits = planDefaultLimits(plan)
  const billingType = options.billingType ? normalizeBillingType(options.billingType) : null

  await connection.execute(
    `
    UPDATE tenants
    SET billing_rate_per_minute = ?,
        billing_type = COALESCE(?, billing_type),
        default_app_limit = ?,
        default_room_limit = ?,
        default_participant_limit = ?,
        updated_at = NOW()
    WHERE id = ?
    `,
    [
      Number(plan.minute_rate || 0),
      billingType,
      limits.app_limit,
      limits.room_limit,
      limits.participant_limit,
      tenantId,
    ]
  )

  await connection.execute(
    `
    UPDATE tenant_plan_assignments
    SET status = 'inactive',
        ends_at = COALESCE(ends_at, NOW()),
        updated_at = NOW()
    WHERE tenant_id = ?
    AND status = 'active'
    `,
    [tenantId]
  )

  await connection.execute(
    `
    INSERT INTO tenant_plan_assignments (
      tenant_id, plan_id, status, starts_at, created_at, updated_at
    )
    VALUES (?, ?, 'active', NOW(), NOW(), NOW())
    `,
    [tenantId, plan.id]
  )

  await connection.execute(
    `
    UPDATE client_apps
    SET plan_id = ?,
        updated_at = NOW()
    WHERE tenant_id = ?
    `,
    [plan.id, tenantId]
  )

  return plan
}

async function createClientAppForTenant(user, body = {}) {
  await ensureTenantCompanyColumns()

  const isSuperAdmin = hasAnyRole(user, ['super_admin'])
  const tenantId = isSuperAdmin
    ? Number(readBodyValue(body, 'tenant_id', 'tenantId'))
    : Number(user.tenant_id)
  const name = cleanString(readBodyValue(body, 'name', 'appName') || readBodyValue(body, 'app_name', 'appName'), 150)
  const platform = normalizeAppPlatform(readBodyValue(body, 'platform'))
  const allowedOrigins = parseAllowedOrigins(readBodyValue(body, 'allowed_origins', 'allowedOrigins'))

  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    const error = new Error('Choose a client company before generating SDK access.')
    error.status = 422
    throw error
  }

  return transaction(async (connection) => {
    const [tenants] = await connection.execute(
      `
      SELECT
        t.id, t.tenant_uid, t.name, t.status, t.default_app_limit,
        sp.id AS plan_id,
        sp.name AS plan_name,
        sp.max_apps,
        sp.included_features
      FROM tenants t
      LEFT JOIN (
        SELECT latest.tenant_id, latest.plan_id
        FROM tenant_plan_assignments latest
        INNER JOIN (
          SELECT tenant_id, MAX(id) AS latest_id
          FROM tenant_plan_assignments
          WHERE status = 'active'
          GROUP BY tenant_id
        ) chosen ON chosen.latest_id = latest.id
      ) active_plan ON active_plan.tenant_id = t.id
      LEFT JOIN service_plans sp ON sp.id = active_plan.plan_id
      WHERE t.id = ?
      LIMIT 1
      `,
      [tenantId]
    )
    const tenant = tenants[0]

    if (!tenant) {
      const error = new Error('Client company was not found.')
      error.status = 404
      throw error
    }

    if (!tenant.plan_id) {
      const error = new Error('Assign a package before generating SDK access.')
      error.status = 422
      throw error
    }

    if (!['active', 'pending'].includes(tenant.status)) {
      const error = new Error('SDK access cannot be generated for this company status.')
      error.status = 422
      throw error
    }

    const [appCounts] = await connection.execute(
      `
      SELECT COUNT(*) AS count
      FROM client_apps
      WHERE tenant_id = ?
      AND status = 'active'
      `,
      [tenantId]
    )
    const activeAppCount = Number(appCounts[0]?.count || 0)
    const appLimit = positiveInteger(tenant.default_app_limit, positiveInteger(tenant.max_apps, 1))

    if (appLimit > 0 && activeAppCount >= appLimit) {
      const error = new Error(`This package allows ${appLimit} active app${appLimit === 1 ? '' : 's'}. Upgrade the package or suspend an app first.`)
      error.status = 422
      throw error
    }

    const appKey = await uniqueAppKey(connection, tenant)
    const apiKey = makeCredential('rtc_api')
    const apiKeyHash = hashSecret(apiKey)
    const sdkToken = makeCredential('rtc_sdk')
    const appName = name || `${tenant.name} ${platform.replace(/_/g, ' ')} app`
    const [result] = await connection.execute(
      `
      INSERT INTO client_apps (
        tenant_id, plan_id, name, platform, app_key, api_key, api_key_hash,
        sdk_token, last_key_rotated_at, allowed_origins, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, 'active', NOW(), NOW())
      `,
      [
        tenantId,
        tenant.plan_id,
        appName,
        platform,
        appKey,
        maskSecret(apiKey),
        apiKeyHash,
        sdkToken,
        allowedOrigins.length ? JSON.stringify(allowedOrigins) : null,
      ]
    )

    const appId = result.insertId
    const planFeatures = parseJsonArray(tenant.included_features)
    for (const featureKey of planFeatures) {
      await connection.execute(
        `
        INSERT INTO client_feature_flags (
          tenant_id, app_id, feature_key, enabled, created_at, updated_at
        )
        VALUES (?, ?, ?, TRUE, NOW(), NOW())
        `,
        [tenantId, appId, featureKey]
      )
    }

    return {
      id: appId,
      tenant_id: tenantId,
      tenant_name: tenant.name,
      plan_id: tenant.plan_id,
      plan_name: tenant.plan_name,
      name: appName,
      platform,
      app_key: appKey,
      api_key_masked: maskSecret(apiKey),
      sdk_token_masked: maskSecret(sdkToken),
      allowed_origins: allowedOrigins,
      status: 'active',
      credentials: {
        app_key: appKey,
        api_key: apiKey,
        sdk_token: sdkToken,
      },
    }
  })
}

async function createClientCompany(payload) {
  await ensureTenantCompanyColumns()

  return transaction(async (connection) => {
    const [plans] = await connection.execute(
      `
      SELECT id, name, code, minute_rate, max_apps, max_rooms, max_participants_per_room
      FROM service_plans
      WHERE id = ?
      AND status = 'active'
      LIMIT 1
      `,
      [payload.planId]
    )
    const plan = plans[0]
    const planLimits = planDefaultLimits(plan)

    if (!plan) {
      const error = new Error('Select an active service plan for this company.')
      error.status = 422
      throw error
    }

    const [existingNames] = await connection.execute(
      `
      SELECT id
      FROM tenants
      WHERE LOWER(name) = LOWER(?)
      LIMIT 1
      `,
      [payload.companyName]
    )

    if (existingNames.length) {
      const error = new Error('A company with this name already exists.')
      error.status = 409
      throw error
    }

    const tenantUid = payload.tenantUid || await getUniqueTenantUid(connection, payload.companyName)
    if (await tenantUidExists(connection, tenantUid)) {
      const error = new Error('This tenant_id is already used. Generate a new tenant_id.')
      error.status = 409
      throw error
    }

    const companySlug = await getUniqueCompanySlug(connection, payload.companyName)
    const billingEmail = payload.billingEmail || payload.companyEmail || payload.primaryContactEmail || null
    const defaultAppLimit = positiveInteger(payload.defaultAppLimit, planLimits.app_limit)
    const defaultRoomLimit = positiveInteger(payload.defaultRoomLimit, planLimits.room_limit)
    const defaultParticipantLimit = positiveInteger(payload.defaultParticipantLimit, planLimits.participant_limit)

    const [tenantResult] = await connection.execute(
      `
      INSERT INTO tenants (
        tenant_uid, name, company_slug, legal_name, industry, company_email,
        phone, website_url, app_url, telegram_contact, whatsapp_contact, discord_contact,
        address, country, timezone, primary_contact_name, primary_contact_email,
        billing_email, billing_type, status, billing_rate_per_minute,
        default_app_limit, default_room_limit, default_participant_limit,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `,
      [
        tenantUid,
        payload.companyName,
        companySlug,
        payload.legalName,
        payload.industry,
        payload.companyEmail,
        payload.phone,
        payload.websiteUrl,
        payload.appUrl,
        payload.telegramContact,
        payload.whatsappContact,
        payload.discordContact,
        payload.address,
        payload.country,
        payload.timezone,
        payload.primaryContactName || null,
        payload.primaryContactEmail,
        billingEmail,
        payload.billingType,
        payload.status,
        Number(plan.minute_rate || 0),
        defaultAppLimit,
        defaultRoomLimit,
        defaultParticipantLimit,
      ]
    )

    const tenantId = tenantResult.insertId

    await connection.execute(
      `
      INSERT INTO tenant_plan_assignments (
        tenant_id, plan_id, status, starts_at, created_at, updated_at
      )
      VALUES (?, ?, 'active', NOW(), NOW(), NOW())
      `,
      [tenantId, plan.id]
    )

    const adminAccount = await createClientAdmin(connection, tenantId, payload.status, {
      name: payload.primaryContactName || `${payload.companyName} Admin`,
      email: payload.primaryContactEmail,
      phone: payload.phone,
      password: payload.primaryContactPassword,
    })
    const adminInvite = await createCompanyAdminInvite(connection, tenantId, {
      name: payload.primaryContactName || `${payload.companyName} Admin`,
      email: payload.primaryContactEmail,
    })

    return {
      tenantId,
      tenant_uid: tenantUid,
      company_slug: companySlug,
      plan_name: plan.name,
      admin_account: adminAccount,
      admin_invite: adminInvite,
    }
  })
}

async function getClientRows(tenantId = null) {
  await ensureTenantCompanyColumns()

  const tenantClause = tenantId ? 'WHERE t.id = :tenantId' : ''
  const rows = await query(
    `
    SELECT
      t.id, t.tenant_uid, t.name, t.company_slug, t.legal_name, t.industry,
      t.company_email, t.phone, t.website_url, t.app_url,
      t.telegram_contact, t.whatsapp_contact, t.discord_contact,
      t.address, t.country, t.timezone,
      t.primary_contact_name, t.primary_contact_email,
      t.billing_email, t.billing_type, t.status, t.billing_rate_per_minute,
      t.default_app_limit, t.default_room_limit, t.default_participant_limit,
      t.created_at, t.updated_at,
      sp.id AS plan_id,
      sp.code AS plan_code,
      sp.name AS plan_name,
      sp.monthly_base_price,
      sp.minute_rate,
      sp.monthly_minute_allowance,
      sp.max_room_admins,
      sp.max_rooms,
      sp.max_apps,
      sp.max_participants_per_room,
      invite.id AS invite_id,
      invite.invited_email AS invite_email,
      invite.status AS invite_status,
      invite.expires_at AS invite_expires_at,
      invite.created_at AS invite_created_at,
      COALESCE(apps.app_count, 0) AS app_count,
      COALESCE(apps.active_app_count, 0) AS active_app_count,
      COALESCE(room_counts.room_count, 0) AS room_count,
      COALESCE(room_counts.active_room_count, 0) AS active_room_count,
      COALESCE(usage_month.minutes, 0) AS minutes_month,
      COALESCE(usage_month.logs, 0) AS usage_logs_month
    FROM tenants t
    LEFT JOIN (
      SELECT latest.tenant_id, latest.plan_id
      FROM tenant_plan_assignments latest
      INNER JOIN (
        SELECT tenant_id, MAX(id) AS latest_id
        FROM tenant_plan_assignments
        WHERE status = 'active'
        GROUP BY tenant_id
      ) chosen ON chosen.latest_id = latest.id
    ) active_plan ON active_plan.tenant_id = t.id
    LEFT JOIN service_plans sp ON sp.id = active_plan.plan_id
    LEFT JOIN (
      SELECT latest_invite.*
      FROM company_admin_invites latest_invite
      INNER JOIN (
        SELECT tenant_id, MAX(id) AS latest_id
        FROM company_admin_invites
        GROUP BY tenant_id
      ) chosen_invite ON chosen_invite.latest_id = latest_invite.id
    ) invite ON invite.tenant_id = t.id
    LEFT JOIN (
      SELECT
        tenant_id,
        COUNT(*) AS app_count,
        COALESCE(SUM(status = 'active'), 0) AS active_app_count
      FROM client_apps
      GROUP BY tenant_id
    ) apps ON apps.tenant_id = t.id
    LEFT JOIN (
      SELECT
        tenant_id,
        COUNT(*) AS room_count,
        COALESCE(SUM(status = 'active'), 0) AS active_room_count
      FROM rooms
      GROUP BY tenant_id
    ) room_counts ON room_counts.tenant_id = t.id
    LEFT JOIN (
      SELECT
        tenant_id,
        COUNT(*) AS logs,
        COALESCE(SUM(billable_minutes), 0) AS minutes
      FROM usage_logs
      WHERE created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
      GROUP BY tenant_id
    ) usage_month ON usage_month.tenant_id = t.id
    ${tenantClause}
    ORDER BY t.created_at ASC, t.id ASC
    `,
    tenantId ? { tenantId } : {}
  )

  return rows.map((client) => {
    const allowance = Number(client.monthly_minute_allowance || 0)
    const minutes = Number(client.minutes_month || 0)
    const minuteRate = Number(client.minute_rate || client.billing_rate_per_minute || 0)
    const overageMinutes = Math.max(0, minutes - allowance)
    const estimatedOverageCost = Number((overageMinutes * minuteRate).toFixed(2))
    const basePrice = Number(client.monthly_base_price || 0)

    return {
      id: client.id,
      tenant_uid: client.tenant_uid || `tenant_${client.id}`,
      name: client.name,
      company_slug: client.company_slug || slugify(client.name),
      legal_name: client.legal_name,
      industry: client.industry,
      company_email: client.company_email,
      phone: client.phone,
      website_url: client.website_url,
      app_url: client.app_url,
      telegram_contact: client.telegram_contact,
      whatsapp_contact: client.whatsapp_contact,
      discord_contact: client.discord_contact,
      address: client.address,
      country: client.country,
      timezone: client.timezone,
      primary_contact_name: client.primary_contact_name,
      primary_contact_email: client.primary_contact_email,
      billing_email: client.billing_email,
      billing_type: client.billing_type || 'monthly',
      status: client.status,
      billing_rate_per_minute: Number(client.billing_rate_per_minute || 0),
      default_limits: {
        app_count: Number(client.default_app_limit || client.max_apps || 0),
        room_count: Number(client.default_room_limit || client.max_rooms || 0),
        participant_limit: Number(client.default_participant_limit || client.max_participants_per_room || 0),
      },
      admin_invite: client.invite_id ? {
        id: client.invite_id,
        email: client.invite_email,
        status: client.invite_status,
        expires_at: client.invite_expires_at,
        created_at: client.invite_created_at,
      } : null,
      plan: client.plan_id ? {
        id: client.plan_id,
        code: client.plan_code,
        name: client.plan_name,
        monthly_base_price: basePrice,
        minute_rate: minuteRate,
        monthly_minute_allowance: allowance,
        max_room_admins: Number(client.max_room_admins || 0),
        max_rooms: Number(client.max_rooms || 0),
        max_apps: Number(client.max_apps || 0),
        max_participants_per_room: Number(client.max_participants_per_room || 0),
      } : null,
      app_count: Number(client.app_count || 0),
      active_app_count: Number(client.active_app_count || 0),
      room_count: Number(client.room_count || 0),
      active_room_count: Number(client.active_room_count || 0),
      minutes_month: minutes,
      usage_logs_month: Number(client.usage_logs_month || 0),
      usage_percent: allowance ? Math.min(100, Number(((minutes / allowance) * 100).toFixed(1))) : 0,
      overage_minutes: Number(overageMinutes.toFixed(2)),
      estimated_overage_cost: estimatedOverageCost,
      estimated_invoice: Number((basePrice + estimatedOverageCost).toFixed(2)),
      created_at: client.created_at,
      updated_at: client.updated_at,
    }
  })
}

async function getClientApps(tenantId = null) {
  const tenantClause = tenantId ? 'WHERE ca.tenant_id = :tenantId' : ''
  const rows = await query(
    `
    SELECT
      ca.id, ca.tenant_id, ca.plan_id, ca.name, ca.platform, ca.app_key,
      ca.api_key, ca.sdk_token, ca.allowed_origins, ca.status, ca.created_at, ca.updated_at,
      t.name AS tenant_name,
      sp.name AS plan_name,
      sp.code AS plan_code
    FROM client_apps ca
    INNER JOIN tenants t ON t.id = ca.tenant_id
    LEFT JOIN service_plans sp ON sp.id = ca.plan_id
    ${tenantClause}
    ORDER BY ca.status = 'active' DESC, ca.updated_at DESC, ca.id DESC
    `,
    tenantId ? { tenantId } : {}
  )

  return rows.map((app) => ({
    id: app.id,
    tenant_id: app.tenant_id,
    tenant_name: app.tenant_name,
    plan_id: app.plan_id,
    plan_name: app.plan_name,
    plan_code: app.plan_code,
    name: app.name,
    platform: app.platform,
    app_key: app.app_key,
    api_key_masked: maskSecret(app.api_key),
    sdk_token_masked: maskSecret(app.sdk_token),
    allowed_origins: parseJsonArray(app.allowed_origins),
    status: app.status,
    created_at: app.created_at,
    updated_at: app.updated_at,
  }))
}

async function getPlanRequests(tenantId = null) {
  await ensureTenantCompanyColumns()

  const tenantClause = tenantId ? 'WHERE pr.tenant_id = :tenantId' : ''
  const rows = await query(
    `
    SELECT
      pr.id, pr.tenant_id, pr.current_plan_id, pr.requested_plan_id,
      pr.requested_by, pr.billing_type, pr.note, pr.status,
      pr.reviewed_by, pr.reviewed_at, pr.created_at, pr.updated_at,
      t.name AS tenant_name,
      t.tenant_uid,
      current_plan.name AS current_plan_name,
      current_plan.code AS current_plan_code,
      requested_plan.name AS requested_plan_name,
      requested_plan.code AS requested_plan_code,
      requested_plan.monthly_base_price AS requested_monthly_base_price,
      requested_plan.monthly_minute_allowance AS requested_monthly_minute_allowance,
      requester.name AS requested_by_name,
      requester.email AS requested_by_email,
      reviewer.name AS reviewed_by_name
    FROM company_plan_requests pr
    INNER JOIN tenants t ON t.id = pr.tenant_id
    LEFT JOIN service_plans current_plan ON current_plan.id = pr.current_plan_id
    INNER JOIN service_plans requested_plan ON requested_plan.id = pr.requested_plan_id
    LEFT JOIN users requester ON requester.id = pr.requested_by
    LEFT JOIN users reviewer ON reviewer.id = pr.reviewed_by
    ${tenantClause}
    ORDER BY pr.status = 'pending' DESC, pr.created_at DESC, pr.id DESC
    LIMIT 100
    `,
    tenantId ? { tenantId } : {}
  )

  return rows.map((request) => ({
    id: request.id,
    tenant_id: request.tenant_id,
    tenant_name: request.tenant_name,
    tenant_uid: request.tenant_uid,
    current_plan: request.current_plan_id ? {
      id: request.current_plan_id,
      code: request.current_plan_code,
      name: request.current_plan_name,
    } : null,
    requested_plan: {
      id: request.requested_plan_id,
      code: request.requested_plan_code,
      name: request.requested_plan_name,
      monthly_base_price: Number(request.requested_monthly_base_price || 0),
      monthly_minute_allowance: Number(request.requested_monthly_minute_allowance || 0),
    },
    requested_by: request.requested_by ? {
      id: request.requested_by,
      name: request.requested_by_name,
      email: request.requested_by_email,
    } : null,
    billing_type: request.billing_type || 'monthly',
    note: request.note,
    status: request.status,
    reviewed_by: request.reviewed_by ? {
      id: request.reviewed_by,
      name: request.reviewed_by_name,
    } : null,
    reviewed_at: request.reviewed_at,
    created_at: request.created_at,
    updated_at: request.updated_at,
  }))
}

async function createPlanRequest(user, body = {}) {
  await ensureTenantCompanyColumns()

  const tenantId = Number(user.tenant_id)
  const requestedPlanId = Number(readBodyValue(body, 'plan_id', 'planId'))
  const billingType = normalizeBillingType(readBodyValue(body, 'billing_type', 'billingType'))
  const note = emptyToNull(readBodyValue(body, 'note'), 500)

  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    const error = new Error('Your account is not attached to a client company.')
    error.status = 403
    throw error
  }

  if (!Number.isInteger(requestedPlanId) || requestedPlanId <= 0) {
    const error = new Error('Choose a package to purchase.')
    error.status = 422
    throw error
  }

  return transaction(async (connection) => {
    const [plans] = await connection.execute(
      `
      SELECT id, name, code
      FROM service_plans
      WHERE id = ?
      AND status = 'active'
      LIMIT 1
      `,
      [requestedPlanId]
    )
    const requestedPlan = plans[0]

    if (!requestedPlan) {
      const error = new Error('Choose an active package.')
      error.status = 422
      throw error
    }

    const [currentPlans] = await connection.execute(
      `
      SELECT plan_id
      FROM tenant_plan_assignments
      WHERE tenant_id = ?
      AND status = 'active'
      ORDER BY id DESC
      LIMIT 1
      `,
      [tenantId]
    )
    const currentPlanId = currentPlans[0]?.plan_id || null

    if (Number(currentPlanId) === Number(requestedPlanId)) {
      const error = new Error('This package is already active for your company.')
      error.status = 422
      throw error
    }

    const [pendingRequests] = await connection.execute(
      `
      SELECT id
      FROM company_plan_requests
      WHERE tenant_id = ?
      AND status = 'pending'
      LIMIT 1
      `,
      [tenantId]
    )

    if (pendingRequests.length) {
      const error = new Error('A package purchase request is already waiting for review.')
      error.status = 409
      throw error
    }

    const [result] = await connection.execute(
      `
      INSERT INTO company_plan_requests (
        tenant_id, current_plan_id, requested_plan_id, requested_by,
        billing_type, note, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW())
      `,
      [tenantId, currentPlanId, requestedPlanId, user.id || null, billingType, note]
    )

    return result.insertId
  })
}

async function reviewPlanRequest(requestId, reviewer, body = {}) {
  await ensureTenantCompanyColumns()

  const status = normalizePlanReviewStatus(readBodyValue(body, 'status', 'action'))
  if (!status) {
    const error = new Error('Review status must be approved or rejected.')
    error.status = 422
    throw error
  }

  return transaction(async (connection) => {
    const [requests] = await connection.execute(
      `
      SELECT id, tenant_id, requested_plan_id, billing_type, status
      FROM company_plan_requests
      WHERE id = ?
      LIMIT 1
      `,
      [requestId]
    )
    const request = requests[0]

    if (!request) {
      const error = new Error('Package purchase request was not found.')
      error.status = 404
      throw error
    }

    if (request.status !== 'pending') {
      const error = new Error('This purchase request has already been reviewed.')
      error.status = 409
      throw error
    }

    if (status === 'approved') {
      await assignTenantPlan(connection, request.tenant_id, request.requested_plan_id, {
        billingType: request.billing_type,
      })
    }

    await connection.execute(
      `
      UPDATE company_plan_requests
      SET status = ?,
          reviewed_by = ?,
          reviewed_at = NOW(),
          updated_at = NOW()
      WHERE id = ?
      `,
      [status, reviewer.id || null, requestId]
    )

    return requestId
  })
}

async function updateClientAppForTenant(user, appId, body = {}) {
  await ensureTenantCompanyColumns()

  const name = cleanString(readBodyValue(body, 'name', 'appName') || readBodyValue(body, 'app_name', 'appName'), 150)
  const hasPlatform = readBodyValue(body, 'platform') !== undefined
  const hasStatus = readBodyValue(body, 'status') !== undefined
  const hasAllowedOrigins = readBodyValue(body, 'allowed_origins', 'allowedOrigins') !== undefined
  const platform = hasPlatform ? normalizeAppPlatform(readBodyValue(body, 'platform')) : null
  const status = hasStatus ? normalizeAppStatus(readBodyValue(body, 'status')) : null
  const allowedOrigins = parseAllowedOrigins(readBodyValue(body, 'allowed_origins', 'allowedOrigins'))
  const isSuperAdmin = hasAnyRole(user, ['super_admin'])

  return transaction(async (connection) => {
    const [apps] = await connection.execute(
      `
      SELECT id, tenant_id, name, platform, status
      FROM client_apps
      WHERE id = ?
      LIMIT 1
      `,
      [appId]
    )
    const app = apps[0]

    if (!app) {
      const error = new Error('Client app was not found.')
      error.status = 404
      throw error
    }

    if (!isSuperAdmin && Number(app.tenant_id) !== Number(user.tenant_id)) {
      const error = new Error('You can only manage apps for your company.')
      error.status = 403
      throw error
    }

    if (status === 'active' && app.status !== 'active') {
      const [limits] = await connection.execute(
        `
        SELECT
          t.default_app_limit,
          sp.name AS plan_name,
          sp.max_apps
        FROM tenants t
        LEFT JOIN (
          SELECT latest.tenant_id, latest.plan_id
          FROM tenant_plan_assignments latest
          INNER JOIN (
            SELECT tenant_id, MAX(id) AS latest_id
            FROM tenant_plan_assignments
            WHERE status = 'active'
            GROUP BY tenant_id
          ) chosen ON chosen.latest_id = latest.id
        ) active_plan ON active_plan.tenant_id = t.id
        LEFT JOIN service_plans sp ON sp.id = active_plan.plan_id
        WHERE t.id = ?
        LIMIT 1
        `,
        [app.tenant_id]
      )
      const limit = limits[0]
      const appLimit = positiveInteger(limit?.default_app_limit, positiveInteger(limit?.max_apps, 1))
      const [counts] = await connection.execute(
        `
        SELECT COUNT(*) AS count
        FROM client_apps
        WHERE tenant_id = ?
        AND id <> ?
        AND status = 'active'
        `,
        [app.tenant_id, app.id]
      )
      const activeAppCount = Number(counts[0]?.count || 0)

      if (appLimit > 0 && activeAppCount >= appLimit) {
        const error = new Error(`${limit?.plan_name || 'Current package'} allows ${appLimit} active app${appLimit === 1 ? '' : 's'}. Upgrade the package or suspend another app first.`)
        error.status = 422
        throw error
      }
    }

    await connection.execute(
      `
      UPDATE client_apps
      SET name = ?,
          platform = ?,
          status = ?,
          allowed_origins = COALESCE(?, allowed_origins),
          updated_at = NOW()
      WHERE id = ?
      `,
      [
        name || app.name,
        platform || app.platform,
        status || app.status,
        hasAllowedOrigins ? JSON.stringify(allowedOrigins) : null,
        appId,
      ]
    )

    return app.tenant_id
  })
}

async function rotateClientAppCredentials(user, appId, body = {}) {
  await ensureTenantCompanyColumns()

  const scope = cleanString(readBodyValue(body, 'scope') || readBodyValue(body, 'credential'), 30).toLowerCase() || 'all'
  const shouldRotateApiKey = ['all', 'both', 'api_key', 'api'].includes(scope)
  const shouldRotateSdkToken = ['all', 'both', 'sdk_token', 'sdk'].includes(scope)
  const isSuperAdmin = hasAnyRole(user, ['super_admin'])

  if (!shouldRotateApiKey && !shouldRotateSdkToken) {
    const error = new Error('Choose api_key, sdk_token, or all credentials to rotate.')
    error.status = 422
    throw error
  }

  return transaction(async (connection) => {
    const [apps] = await connection.execute(
      `
      SELECT
        ca.id, ca.tenant_id, ca.plan_id, ca.name, ca.platform, ca.app_key,
        ca.api_key, ca.api_key_hash, ca.sdk_token, ca.allowed_origins, ca.status,
        t.name AS tenant_name,
        sp.name AS plan_name,
        sp.code AS plan_code
      FROM client_apps ca
      INNER JOIN tenants t ON t.id = ca.tenant_id
      LEFT JOIN service_plans sp ON sp.id = ca.plan_id
      WHERE ca.id = ?
      LIMIT 1
      `,
      [appId]
    )
    const app = apps[0]

    if (!app) {
      const error = new Error('Client app was not found.')
      error.status = 404
      throw error
    }

    if (!isSuperAdmin && Number(app.tenant_id) !== Number(user.tenant_id)) {
      const error = new Error('You can only manage apps for your company.')
      error.status = 403
      throw error
    }

    const apiKey = shouldRotateApiKey ? makeCredential('rtc_api') : app.api_key
    const apiKeyHash = shouldRotateApiKey ? hashSecret(apiKey) : app.api_key_hash
    const sdkToken = shouldRotateSdkToken ? makeCredential('rtc_sdk') : app.sdk_token

    await connection.execute(
      `
      UPDATE client_apps
      SET api_key = ?,
          api_key_hash = ?,
          sdk_token = ?,
          last_key_rotated_at = NOW(),
          updated_at = NOW()
      WHERE id = ?
      `,
      [
        shouldRotateApiKey ? maskSecret(apiKey) : app.api_key,
        apiKeyHash,
        sdkToken,
        appId,
      ]
    )

    return {
      app: {
        id: app.id,
        tenant_id: app.tenant_id,
        tenant_name: app.tenant_name,
        plan_id: app.plan_id,
        plan_name: app.plan_name,
        plan_code: app.plan_code,
        name: app.name,
        platform: app.platform,
        app_key: app.app_key,
        api_key_masked: shouldRotateApiKey ? maskSecret(apiKey) : maskSecret(app.api_key),
        sdk_token_masked: maskSecret(sdkToken),
        allowed_origins: parseJsonArray(app.allowed_origins),
        status: app.status,
      },
      credentials: {
        app_key: app.app_key,
        api_key: shouldRotateApiKey ? apiKey : null,
        sdk_token: shouldRotateSdkToken ? sdkToken : null,
      },
      tenant_id: app.tenant_id,
    }
  })
}

async function findRoomOwnerForTenant(connection, tenantId, preferredOwnerId = null) {
  if (preferredOwnerId && Number.isInteger(preferredOwnerId)) {
    const [preferred] = await connection.execute(
      `
      SELECT id, name
      FROM users
      WHERE id = ?
      AND tenant_id = ?
      AND status = 'active'
      LIMIT 1
      `,
      [preferredOwnerId, tenantId]
    )

    if (preferred.length) return preferred[0]
  }

  const [admins] = await connection.execute(
    `
    SELECT u.id, u.name
    FROM users u
    INNER JOIN user_roles ur ON ur.user_id = u.id
    INNER JOIN roles r ON r.id = ur.role_id
    WHERE u.tenant_id = ?
    AND u.status = 'active'
    AND r.name = 'client_admin'
    ORDER BY u.created_at ASC, u.id ASC
    LIMIT 1
    `,
    [tenantId]
  )

  if (admins.length) return admins[0]

  const [users] = await connection.execute(
    `
    SELECT id, name
    FROM users
    WHERE tenant_id = ?
    AND status = 'active'
    ORDER BY created_at ASC, id ASC
    LIMIT 1
    `,
    [tenantId]
  )

  if (users.length) return users[0]

  const error = new Error('Create or invite a company admin before creating rooms for this client.')
  error.status = 422
  throw error
}

async function createAdminRoom(user, payload) {
  const isSuperAdmin = hasAnyRole(user, ['super_admin'])
  const tenantId = isSuperAdmin ? payload.tenantId : Number(user.tenant_id)

  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    const error = new Error('Choose a client company before creating a room.')
    error.status = 422
    throw error
  }

  return transaction(async (connection) => {
    const [tenants] = await connection.execute(
      `
      SELECT id, name, status
      FROM tenants
      WHERE id = ?
      LIMIT 1
      `,
      [tenantId]
    )
    const tenant = tenants[0]

    if (!tenant) {
      const error = new Error('Client company was not found.')
      error.status = 404
      throw error
    }

    if (!['active', 'pending'].includes(tenant.status)) {
      const error = new Error('Rooms cannot be created while this company is suspended or cancelled.')
      error.status = 422
      throw error
    }

    await assertTenantCanUseRoomConfig(connection, tenantId, {
      room_type: payload.roomType,
      privacy_type: payload.privacyType,
      max_mic_count: payload.maxMicCount,
      chat_enabled: payload.chatEnabled,
      gift_enabled: payload.giftEnabled,
      screen_share_enabled: payload.screenShareEnabled,
      ai_security_enabled: payload.aiSecurityEnabled,
    })

    const owner = await findRoomOwnerForTenant(
      connection,
      tenantId,
      isSuperAdmin ? payload.ownerId : user.id
    )
    const passwordHash = payload.password ? await bcrypt.hash(payload.password, 10) : null
    const [insertResult] = await connection.execute(
      `
      INSERT INTO rooms (
        tenant_id, owner_id, name, description, room_type,
        privacy_type, password_hash, max_mic_count,
        chat_enabled, gift_enabled, screen_share_enabled, ai_security_enabled,
        status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())
      `,
      [
        tenantId,
        owner.id,
        payload.name,
        payload.description,
        payload.roomType,
        payload.privacyType,
        passwordHash,
        payload.maxMicCount,
        payload.chatEnabled ? 1 : 0,
        payload.giftEnabled ? 1 : 0,
        payload.screenShareEnabled ? 1 : 0,
        payload.aiSecurityEnabled ? 1 : 0,
      ]
    )

    await connection.execute(
      `
      INSERT INTO room_roles (room_id, user_id, role, created_at)
      VALUES (?, ?, 'owner', NOW())
      `,
      [insertResult.insertId, owner.id]
    )

    return insertResult.insertId
  })
}

async function assertAdminRoomAccess(connection, user, roomId) {
  const [rooms] = await connection.execute(
    `
    SELECT id, tenant_id, name, status
    FROM rooms
    WHERE id = ?
    LIMIT 1
    `,
    [roomId]
  )
  const room = rooms[0]

  if (!room) {
    const error = new Error('Room was not found.')
    error.status = 404
    throw error
  }

  if (!hasAnyRole(user, ['super_admin']) && Number(room.tenant_id) !== Number(user.tenant_id)) {
    const error = new Error('You can only manage rooms for your company.')
    error.status = 403
    throw error
  }

  return room
}

async function setAdminRoomStatus(user, roomId, status) {
  return transaction(async (connection) => {
    const room = await assertAdminRoomAccess(connection, user, roomId)

    await connection.execute(
      `
      UPDATE rooms
      SET status = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [status, room.id]
    )

    if (status !== 'active') {
      await connection.execute(
        `
        UPDATE rtc_sessions
        SET status = 'ended',
            ended_at = COALESCE(ended_at, NOW()),
            updated_at = NOW()
        WHERE room_id = ?
        AND status = 'active'
        `,
        [room.id]
      )

      await connection.execute(
        `
        UPDATE rtc_session_participants
        SET left_at = COALESCE(left_at, NOW()),
            connection_status = 'disconnected',
            updated_at = NOW()
        WHERE room_id = ?
        AND left_at IS NULL
        `,
        [room.id]
      )
    }

    return room
  })
}

async function getFeatureRows(tenantId = null) {
  const tenantClause = tenantId ? 'WHERE cff.tenant_id = :tenantId' : ''
  const rows = await query(
    `
    SELECT
      cff.id, cff.tenant_id, cff.app_id, cff.feature_key, cff.enabled,
      cff.limit_value, cff.updated_at,
      t.name AS tenant_name,
      ca.name AS app_name
    FROM client_feature_flags cff
    INNER JOIN tenants t ON t.id = cff.tenant_id
    LEFT JOIN client_apps ca ON ca.id = cff.app_id
    ${tenantClause}
    ORDER BY t.name ASC, ca.name ASC, cff.feature_key ASC
    `,
    tenantId ? { tenantId } : {}
  )

  return rows.map((row) => catalogFeature(row.feature_key, {
    id: row.id,
    tenant_id: row.tenant_id,
    tenant_name: row.tenant_name,
    app_id: row.app_id,
    app_name: row.app_name || 'Company default',
    enabled: boolValue(row.enabled),
    limit_value: row.limit_value,
    updated_at: row.updated_at,
  }))
}

async function getScopedRoomIds(adminId, tenantId = null) {
  const params = { adminId }
  const tenantClause = tenantId ? 'AND r.tenant_id = :tenantId' : ''
  if (tenantId) params.tenantId = tenantId

  const rows = await query(
    `
    SELECT DISTINCT r.id, r.updated_at
    FROM rooms r
    LEFT JOIN room_roles rr
      ON rr.room_id = r.id
      AND rr.user_id = :adminId
      AND rr.role IN ('owner', 'admin', 'moderator')
    WHERE (r.owner_id = :adminId OR rr.user_id IS NOT NULL)
    ${tenantClause}
    ORDER BY r.updated_at DESC, r.id DESC
    `,
    params
  )

  return rows.map((row) => Number(row.id))
}

async function getTenantRoomIds(tenantId) {
  const rows = await query(
    `
    SELECT id
    FROM rooms
    WHERE tenant_id = :tenantId
    ORDER BY updated_at DESC, id DESC
    `,
    { tenantId }
  )

  return rows.map((row) => Number(row.id))
}

async function getTenantUsers(tenantId) {
  const rows = await query(
    `
    SELECT
      u.id, u.tenant_id, u.name, u.email, u.phone, u.avatar_url, u.status,
      u.last_login_at, u.created_at, u.updated_at,
      GROUP_CONCAT(DISTINCT roles.name ORDER BY roles.name) AS roles,
      COALESCE(activity.participant_records, 0) AS participant_records,
      COALESCE(activity.active_rooms, 0) AS active_rooms,
      COALESCE(activity.total_seconds, 0) AS total_seconds,
      activity.last_joined_at
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles ON roles.id = ur.role_id
    LEFT JOIN (
      SELECT
        p.user_id,
        COUNT(*) AS participant_records,
        COALESCE(SUM(p.left_at IS NULL), 0) AS active_rooms,
        COALESCE(SUM(p.duration_seconds), 0) AS total_seconds,
        MAX(p.joined_at) AS last_joined_at
      FROM rtc_session_participants p
      INNER JOIN rooms r ON r.id = p.room_id
      WHERE r.tenant_id = :tenantId
      GROUP BY p.user_id
    ) activity ON activity.user_id = u.id
    WHERE u.tenant_id = :tenantId
    GROUP BY
      u.id, u.tenant_id, u.name, u.email, u.phone, u.avatar_url, u.status,
      u.last_login_at, u.created_at, u.updated_at,
      activity.participant_records, activity.active_rooms, activity.total_seconds, activity.last_joined_at
    ORDER BY activity.active_rooms DESC, activity.last_joined_at DESC, u.created_at DESC, u.id DESC
    LIMIT 200
    `,
    { tenantId }
  )

  return rows.map((user) => ({
    id: user.id,
    tenant_id: user.tenant_id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    avatar_url: user.avatar_url,
    status: user.status,
    roles: String(user.roles || '')
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean),
    participant_records: Number(user.participant_records || 0),
    active_rooms: Number(user.active_rooms || 0),
    total_minutes: Number((Number(user.total_seconds || 0) / 60).toFixed(2)),
    last_joined_at: user.last_joined_at,
    last_login_at: user.last_login_at,
    created_at: user.created_at,
    updated_at: user.updated_at,
  }))
}

async function getDashboard(roomIds) {
  const roomFilter = makeInFilter('r.id', roomIds, 'room')
  const sessionRoomFilter = makeInFilter('s.room_id', roomIds, 'sessionRoom')
  const participantRoomFilter = makeInFilter('p.room_id', roomIds, 'participantRoom')
  const usageRoomFilter = makeInFilter('ul.room_id', roomIds, 'usageRoom')
  const chatRoomFilter = makeInFilter('cm.room_id', roomIds, 'chatRoom')
  const eventRoomFilter = makeInFilter('ev.room_id', roomIds, 'eventRoom')
  const banRoomFilter = makeInFilter('rb.room_id', roomIds, 'banRoom')

  const [activeRooms] = await query(
    `SELECT COUNT(*) AS count FROM rooms r WHERE ${roomFilter.sql} AND r.status = 'active'`,
    roomFilter.params
  )

  const [activeSessions] = await query(
    `SELECT COUNT(*) AS count FROM rtc_sessions s WHERE ${sessionRoomFilter.sql} AND s.status = 'active'`,
    sessionRoomFilter.params
  )

  const [totalUsers] = await query(
    `
    SELECT COUNT(DISTINCT p.user_id) AS count
    FROM rtc_session_participants p
    WHERE ${participantRoomFilter.sql}
    `,
    participantRoomFilter.params
  )

  const [roomMetrics] = await query(
    `
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(r.status = 'active'), 0) AS active,
      COALESCE(SUM(r.status = 'inactive'), 0) AS inactive,
      COALESCE(SUM(r.status = 'ended'), 0) AS ended,
      COALESCE(SUM(r.privacy_type = 'public'), 0) AS public_rooms,
      COALESCE(SUM(r.privacy_type = 'private'), 0) AS private_rooms,
      COALESCE(SUM(r.privacy_type = 'password'), 0) AS password_rooms,
      COALESCE(SUM(r.room_type IN ('video', 'group_video')), 0) AS video_rooms,
      COALESCE(SUM(r.room_type IN ('audio', 'group_audio')), 0) AS voice_rooms,
      COALESCE(SUM(r.room_type IN ('solo_live', 'pk_live')), 0) AS live_rooms,
      COALESCE(SUM(r.created_at >= CURDATE()), 0) AS created_today
    FROM rooms r
    WHERE ${roomFilter.sql}
    `,
    roomFilter.params
  )

  const [sessionMetrics] = await query(
    `
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(s.status = 'active'), 0) AS active,
      COALESCE(SUM(s.created_at >= CURDATE()), 0) AS started_today,
      COALESCE(SUM(s.status = 'ended' AND s.ended_at >= CURDATE()), 0) AS ended_today,
      COALESCE(AVG(CASE WHEN s.created_at >= CURDATE() AND s.total_duration_seconds > 0 THEN s.total_duration_seconds END), 0) AS avg_duration_seconds_today,
      COALESCE(SUM(CASE WHEN s.created_at >= CURDATE() THEN s.total_participant_minutes ELSE 0 END), 0) AS participant_minutes_today
    FROM rtc_sessions s
    WHERE ${sessionRoomFilter.sql}
    `,
    sessionRoomFilter.params
  )

  const [participantMetrics] = await query(
    `
    SELECT
      COUNT(*) AS active,
      COUNT(DISTINCT p.user_id) AS active_users,
      COALESCE(SUM(p.mic_enabled = 1), 0) AS mics_on,
      COALESCE(SUM(p.camera_enabled = 1), 0) AS cameras_on,
      COALESCE(SUM(p.connection_status = 'reconnecting'), 0) AS reconnecting
    FROM rtc_session_participants p
    WHERE ${participantRoomFilter.sql}
    AND p.left_at IS NULL
    `,
    participantRoomFilter.params
  )

  const [usageToday] = await query(
    `
    SELECT
      COUNT(*) AS logs,
      COALESCE(SUM(ul.duration_seconds), 0) AS seconds,
      COALESCE(SUM(ul.billable_minutes), 0) AS minutes,
      COUNT(DISTINCT ul.user_id) AS users,
      COUNT(DISTINCT ul.room_id) AS rooms,
      COALESCE(AVG(ul.duration_seconds), 0) AS avg_duration_seconds
    FROM usage_logs ul
    WHERE ${usageRoomFilter.sql}
    AND DATE(ul.created_at) = CURDATE()
    `,
    usageRoomFilter.params
  )

  const [usageMonth] = await query(
    `
    SELECT
      COUNT(*) AS logs,
      COALESCE(SUM(ul.duration_seconds), 0) AS seconds,
      COALESCE(SUM(ul.billable_minutes), 0) AS minutes,
      COUNT(DISTINCT ul.user_id) AS users,
      COUNT(DISTINCT ul.room_id) AS rooms,
      COALESCE(AVG(ul.duration_seconds), 0) AS avg_duration_seconds
    FROM usage_logs ul
    WHERE ${usageRoomFilter.sql}
    AND ul.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
    `,
    usageRoomFilter.params
  )

  const [chatMetrics] = await query(
    `
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(cm.created_at >= CURDATE()), 0) AS messages_today,
      COALESCE(SUM(cm.created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)), 0) AS messages_last_hour,
      COALESCE(SUM(cm.is_unsent = 1 AND cm.updated_at >= CURDATE()), 0) AS unsent_today,
      COALESCE(SUM(cm.is_deleted = 1 AND cm.updated_at >= CURDATE()), 0) AS deleted_today
    FROM chat_messages cm
    WHERE ${chatRoomFilter.sql}
    `,
    chatRoomFilter.params
  )

  const [moderationMetrics] = await query(
    `
    SELECT
      COALESCE(SUM(ev.created_at >= CURDATE()), 0) AS events_today,
      COALESCE(SUM(ev.event_type = 'mute_by_moderator' AND ev.created_at >= CURDATE()), 0) AS mutes_today,
      COALESCE(SUM(ev.event_type = 'kick_by_moderator' AND ev.created_at >= CURDATE()), 0) AS kicks_today,
      COALESCE(SUM(ev.event_type = 'ban_by_moderator' AND ev.created_at >= CURDATE()), 0) AS bans_today
    FROM rtc_events ev
    WHERE ${eventRoomFilter.sql}
    AND ev.event_type IN ('mute_by_moderator', 'kick_by_moderator', 'ban_by_moderator')
    `,
    eventRoomFilter.params
  )

  const [activeBans] = await query(
    `
    SELECT COUNT(*) AS count
    FROM room_bans rb
    WHERE ${banRoomFilter.sql}
    AND rb.status = 'active'
    AND (rb.ends_at IS NULL OR rb.ends_at > NOW())
    `,
    banRoomFilter.params
  )

  const activeSessionMonitorRows = await query(
    `
    SELECT
      s.id,
      s.room_id,
      s.signaling_room,
      s.session_type,
      s.started_by,
      s.started_at,
      TIMESTAMPDIFF(SECOND, s.started_at, NOW()) AS elapsed_seconds,
      r.name AS room_name,
      r.privacy_type,
      r.max_mic_count,
      owner.name AS owner_name,
      starter.name AS started_by_name,
      COUNT(p.id) AS active_participants,
      COUNT(DISTINCT p.user_id) AS active_users,
      COALESCE(SUM(p.mic_enabled = 1), 0) AS mics_on,
      COALESCE(SUM(p.camera_enabled = 1), 0) AS cameras_on,
      COALESCE(SUM(p.screen_shared = 1), 0) AS screen_shares,
      COALESCE(SUM(p.connection_status = 'reconnecting'), 0) AS reconnecting,
      MAX(p.updated_at) AS last_participant_update
    FROM rtc_sessions s
    INNER JOIN rooms r ON r.id = s.room_id
    LEFT JOIN users owner ON owner.id = r.owner_id
    LEFT JOIN users starter ON starter.id = s.started_by
    LEFT JOIN rtc_session_participants p
      ON p.session_id = s.id
      AND p.left_at IS NULL
    WHERE ${sessionRoomFilter.sql}
    AND s.status = 'active'
    GROUP BY
      s.id, s.room_id, s.signaling_room, s.session_type, s.started_by, s.started_at,
      r.name, r.privacy_type, r.max_mic_count, owner.name, starter.name
    ORDER BY active_participants DESC, s.started_at DESC
    LIMIT 12
    `,
    sessionRoomFilter.params
  )

  const activeSessionIds = activeSessionMonitorRows.map((session) => Number(session.id))
  const activeSessionParticipants = activeSessionIds.length
    ? await query(
      `
      SELECT
        p.id,
        p.session_id,
        p.user_id,
        p.peer_uid,
        p.role_in_room,
        p.joined_at,
        TIMESTAMPDIFF(SECOND, p.joined_at, NOW()) AS connected_seconds,
        p.mic_enabled,
        p.camera_enabled,
        p.screen_shared,
        p.connection_status,
        p.updated_at,
        u.name AS user_name,
        u.email AS user_email
      FROM rtc_session_participants p
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.left_at IS NULL
      AND p.session_id IN (${activeSessionIds.map((_, index) => `:session${index}`).join(', ')})
      ORDER BY
        p.session_id ASC,
        FIELD(p.role_in_room, 'owner', 'admin', 'moderator', 'speaker', 'audience', 'end_user'),
        p.joined_at ASC
      `,
      activeSessionIds.reduce((params, sessionId, index) => {
        params[`session${index}`] = sessionId
        return params
      }, {})
    )
    : []

  const [endedParticipants] = await query(
    `
    SELECT COUNT(*) AS count
    FROM rtc_session_participants p
    WHERE ${participantRoomFilter.sql}
    AND p.left_at IS NOT NULL
    `,
    participantRoomFilter.params
  )

  const [missingUsageLogs] = await query(
    `
    SELECT COUNT(*) AS count
    FROM rtc_session_participants p
    WHERE ${participantRoomFilter.sql}
    AND p.left_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM usage_logs ul
      WHERE ul.room_id = p.room_id
      AND ul.session_id = p.session_id
      AND ul.user_id = p.user_id
      AND ul.started_at = p.joined_at
    )
    `,
    participantRoomFilter.params
  )

  const [durationMismatches] = await query(
    `
    SELECT COUNT(*) AS count
    FROM rtc_session_participants p
    INNER JOIN usage_logs ul
      ON ul.room_id = p.room_id
      AND ul.session_id = p.session_id
      AND ul.user_id = p.user_id
      AND ul.started_at = p.joined_at
    WHERE ${participantRoomFilter.sql}
    AND p.left_at IS NOT NULL
    AND ABS(COALESCE(ul.duration_seconds, 0) - COALESCE(p.duration_seconds, 0)) > 1
    `,
    participantRoomFilter.params
  )

  const [duplicateUsageLogs] = await query(
    `
    SELECT COUNT(*) AS count
    FROM (
      SELECT ul.room_id, ul.session_id, ul.user_id, ul.started_at, COUNT(*) AS log_count
      FROM usage_logs ul
      WHERE ${usageRoomFilter.sql}
      GROUP BY ul.room_id, ul.session_id, ul.user_id, ul.started_at
      HAVING COUNT(*) > 1
    ) duplicates
    `,
    usageRoomFilter.params
  )

  const [sessionTotalMismatches] = await query(
    `
    SELECT COUNT(*) AS count
    FROM rtc_sessions s
    LEFT JOIN (
      SELECT session_id, ROUND(SUM(duration_seconds) / 60, 2) AS participant_minutes
      FROM rtc_session_participants
      WHERE left_at IS NOT NULL
      GROUP BY session_id
    ) totals ON totals.session_id = s.id
    WHERE ${sessionRoomFilter.sql}
    AND ABS(COALESCE(s.total_participant_minutes, 0) - COALESCE(totals.participant_minutes, 0)) > 0.01
    `,
    sessionRoomFilter.params
  )

  const recentUsageLogs = await query(
    `
    SELECT
      ul.id, ul.room_id, ul.session_id, ul.user_id, ul.usage_type,
      ul.started_at, ul.ended_at, ul.duration_seconds, ul.billable_minutes, ul.created_at,
      r.name AS room_name,
      u.name AS user_name,
      s.status AS session_status
    FROM usage_logs ul
    INNER JOIN rooms r ON r.id = ul.room_id
    LEFT JOIN users u ON u.id = ul.user_id
    LEFT JOIN rtc_sessions s ON s.id = ul.session_id
    WHERE ${usageRoomFilter.sql}
    ORDER BY ul.id DESC
    LIMIT 12
    `,
    usageRoomFilter.params
  )

  const usageTodayData = {
    logs: toNumber(usageToday, 'logs'),
    seconds: toNumber(usageToday, 'seconds'),
    minutes: toNumber(usageToday, 'minutes', 2),
    users: toNumber(usageToday, 'users'),
    rooms: toNumber(usageToday, 'rooms'),
    avg_duration_seconds: toNumber(usageToday, 'avg_duration_seconds'),
  }
  const usageMonthData = {
    logs: toNumber(usageMonth, 'logs'),
    seconds: toNumber(usageMonth, 'seconds'),
    minutes: toNumber(usageMonth, 'minutes', 2),
    users: toNumber(usageMonth, 'users'),
    rooms: toNumber(usageMonth, 'rooms'),
    avg_duration_seconds: toNumber(usageMonth, 'avg_duration_seconds'),
  }
  const roomMetricData = {
    total: toNumber(roomMetrics, 'total'),
    active: toNumber(roomMetrics, 'active'),
    inactive: toNumber(roomMetrics, 'inactive'),
    ended: toNumber(roomMetrics, 'ended'),
    public: toNumber(roomMetrics, 'public_rooms'),
    private: toNumber(roomMetrics, 'private_rooms'),
    password: toNumber(roomMetrics, 'password_rooms'),
    video: toNumber(roomMetrics, 'video_rooms'),
    voice: toNumber(roomMetrics, 'voice_rooms'),
    live: toNumber(roomMetrics, 'live_rooms'),
    created_today: toNumber(roomMetrics, 'created_today'),
  }
  const sessionMetricData = {
    total: toNumber(sessionMetrics, 'total'),
    active: toNumber(sessionMetrics, 'active'),
    started_today: toNumber(sessionMetrics, 'started_today'),
    ended_today: toNumber(sessionMetrics, 'ended_today'),
    avg_duration_seconds_today: toNumber(sessionMetrics, 'avg_duration_seconds_today'),
    participant_minutes_today: toNumber(sessionMetrics, 'participant_minutes_today', 2),
  }
  const participantMetricData = {
    active: toNumber(participantMetrics, 'active'),
    active_users: toNumber(participantMetrics, 'active_users'),
    mics_on: toNumber(participantMetrics, 'mics_on'),
    cameras_on: toNumber(participantMetrics, 'cameras_on'),
    reconnecting: toNumber(participantMetrics, 'reconnecting'),
  }
  const chatMetricData = {
    total: toNumber(chatMetrics, 'total'),
    messages_today: toNumber(chatMetrics, 'messages_today'),
    messages_last_hour: toNumber(chatMetrics, 'messages_last_hour'),
    unsent_today: toNumber(chatMetrics, 'unsent_today'),
    deleted_today: toNumber(chatMetrics, 'deleted_today'),
  }
  const moderationMetricData = {
    events_today: toNumber(moderationMetrics, 'events_today'),
    mutes_today: toNumber(moderationMetrics, 'mutes_today'),
    kicks_today: toNumber(moderationMetrics, 'kicks_today'),
    bans_today: toNumber(moderationMetrics, 'bans_today'),
    active_bans: toNumber(activeBans, 'count'),
  }

  const participantsBySession = activeSessionParticipants.reduce((groups, participant) => {
    const sessionId = Number(participant.session_id)
    if (!groups.has(sessionId)) groups.set(sessionId, [])
    groups.get(sessionId).push({
      id: participant.id,
      user_id: participant.user_id,
      user_name: participant.user_name || `User #${participant.user_id}`,
      user_email: participant.user_email,
      peer_uid: participant.peer_uid,
      role: participant.role_in_room,
      joined_at: participant.joined_at,
      connected_seconds: toNumber(participant, 'connected_seconds'),
      mic_enabled: boolValue(participant.mic_enabled),
      camera_enabled: boolValue(participant.camera_enabled),
      screen_shared: boolValue(participant.screen_shared),
      connection_status: participant.connection_status,
      updated_at: participant.updated_at,
    })
    return groups
  }, new Map())

  const activeSessionMonitor = {
    generated_at: new Date().toISOString(),
    summary: {
      sessions: activeSessionMonitorRows.length,
      participants: activeSessionMonitorRows.reduce((total, session) => total + toNumber(session, 'active_participants'), 0),
      active_users: activeSessionMonitorRows.reduce((total, session) => total + toNumber(session, 'active_users'), 0),
      mics_on: activeSessionMonitorRows.reduce((total, session) => total + toNumber(session, 'mics_on'), 0),
      cameras_on: activeSessionMonitorRows.reduce((total, session) => total + toNumber(session, 'cameras_on'), 0),
      reconnecting: activeSessionMonitorRows.reduce((total, session) => total + toNumber(session, 'reconnecting'), 0),
    },
    sessions: activeSessionMonitorRows.map((session) => {
      const maxMicCount = Math.max(1, toNumber(session, 'max_mic_count') || 1)
      const activeParticipants = toNumber(session, 'active_participants')

      return {
        id: session.id,
        room_id: session.room_id,
        room_name: session.room_name,
        room_privacy: session.privacy_type,
        max_mic_count: maxMicCount,
        signaling_room: session.signaling_room,
        session_type: session.session_type,
        started_by: session.started_by,
        started_by_name: session.started_by_name || `User #${session.started_by}`,
        owner_name: session.owner_name || 'Room owner',
        started_at: session.started_at,
        elapsed_seconds: toNumber(session, 'elapsed_seconds'),
        active_participants: activeParticipants,
        active_users: toNumber(session, 'active_users'),
        mics_on: toNumber(session, 'mics_on'),
        cameras_on: toNumber(session, 'cameras_on'),
        screen_shares: toNumber(session, 'screen_shares'),
        reconnecting: toNumber(session, 'reconnecting'),
        capacity_percent: Math.min(100, Math.round((activeParticipants / maxMicCount) * 100)),
        health: toNumber(session, 'reconnecting') > 0 ? 'attention' : activeParticipants > 0 ? 'live' : 'idle',
        last_participant_update: session.last_participant_update,
        participants: participantsBySession.get(Number(session.id)) || [],
      }
    }),
  }

  const verificationIssues = Number(missingUsageLogs.count || 0)
    + Number(durationMismatches.count || 0)
    + Number(duplicateUsageLogs.count || 0)
    + Number(sessionTotalMismatches.count || 0)
  const verificationStatus = verificationIssues === 0 ? 'verified' : 'needs_attention'

  return {
    active_rooms: Number(activeRooms.count || 0),
    active_sessions: Number(activeSessions.count || 0),
    total_users: Number(totalUsers.count || 0),
    minutes_used_today: usageTodayData.minutes,
    minutes_used_this_month: usageMonthData.minutes,
    rtc_status: 'online',
    billing_mode: 'participant_minutes',
    usage_today: usageTodayData,
    usage_month: usageMonthData,
    usage_verification: {
      status: verificationStatus,
      ended_participants: Number(endedParticipants.count || 0),
      missing_usage_logs: Number(missingUsageLogs.count || 0),
      duration_mismatches: Number(durationMismatches.count || 0),
      duplicate_usage_logs: Number(duplicateUsageLogs.count || 0),
      session_total_mismatches: Number(sessionTotalMismatches.count || 0),
    },
    metrics: {
      rooms: roomMetricData,
      sessions: sessionMetricData,
      participants: participantMetricData,
      users: {
        total: Number(totalUsers.count || 0),
        active: Number(totalUsers.count || 0),
        banned: 0,
        new_today: 0,
        new_7_days: 0,
      },
      usage: {
        today: usageTodayData,
        month: usageMonthData,
      },
      chat: chatMetricData,
      moderation: moderationMetricData,
      verification: {
        status: verificationStatus,
        issue_count: verificationIssues,
      },
    },
    active_sessions_monitor: activeSessionMonitor,
    recent_usage_logs: recentUsageLogs.map((log) => ({
      id: log.id,
      room_id: log.room_id,
      session_id: log.session_id,
      user_id: log.user_id,
      room_name: log.room_name,
      user_name: log.user_name || `User #${log.user_id}`,
      usage_type: log.usage_type,
      started_at: log.started_at,
      ended_at: log.ended_at,
      duration_seconds: Number(log.duration_seconds || 0),
      billable_minutes: Number(log.billable_minutes || 0),
      session_status: log.session_status,
      created_at: log.created_at,
    })),
  }
}

async function getAdminStats(roomIds) {
  const roomFilter = makeInFilter('r.id', roomIds, 'statRoom')
  const sessionFilter = makeInFilter('s.room_id', roomIds, 'statSession')
  const usageFilter = makeInFilter('ul.room_id', roomIds, 'statUsage')

  const [rooms] = await query(
    `
    SELECT
      COUNT(*) AS total_rooms,
      COALESCE(SUM(r.status = 'active'), 0) AS active_rooms
    FROM rooms r
    WHERE ${roomFilter.sql}
    `,
    roomFilter.params
  )
  const [sessions] = await query(
    `
    SELECT COUNT(*) AS active_sessions
    FROM rtc_sessions s
    WHERE ${sessionFilter.sql}
    AND s.status = 'active'
    `,
    sessionFilter.params
  )
  const [usage] = await query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN DATE(ul.created_at) = CURDATE() THEN ul.billable_minutes ELSE 0 END), 0) AS minutes_today,
      COALESCE(SUM(CASE WHEN ul.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN ul.billable_minutes ELSE 0 END), 0) AS minutes_month,
      COUNT(*) AS usage_logs
    FROM usage_logs ul
    WHERE ${usageFilter.sql}
    `,
    usageFilter.params
  )

  return {
    total_rooms: toNumber(rooms, 'total_rooms'),
    active_rooms: toNumber(rooms, 'active_rooms'),
    active_sessions: toNumber(sessions, 'active_sessions'),
    minutes_today: toNumber(usage, 'minutes_today', 2),
    minutes_month: toNumber(usage, 'minutes_month', 2),
    usage_logs: toNumber(usage, 'usage_logs'),
  }
}

async function getRoomRows(roomIds) {
  const roomFilter = makeInFilter('r.id', roomIds, 'detailRoom')

  const rows = await query(
    `
    SELECT
      r.id, r.tenant_id, r.owner_id, r.name, r.description, r.room_type, r.privacy_type,
      r.max_mic_count, r.chat_enabled, r.gift_enabled, r.screen_share_enabled,
      r.ai_security_enabled, r.status, r.created_at, r.updated_at,
      owner.name AS owner_name,
      owner.email AS owner_email,
      COALESCE(active_participants.active_count, 0) AS active_participants,
      COALESCE(active_participants.mics_on, 0) AS mics_on,
      COALESCE(active_participants.cameras_on, 0) AS cameras_on,
      COALESCE(active_sessions.active_count, 0) AS active_sessions,
      COALESCE(usage_totals.usage_logs, 0) AS usage_logs,
      COALESCE(usage_totals.billable_minutes, 0) AS billable_minutes
    FROM rooms r
    LEFT JOIN users owner ON owner.id = r.owner_id
    LEFT JOIN (
      SELECT
        room_id,
        COUNT(*) AS active_count,
        COALESCE(SUM(mic_enabled = 1), 0) AS mics_on,
        COALESCE(SUM(camera_enabled = 1), 0) AS cameras_on
      FROM rtc_session_participants
      WHERE left_at IS NULL
      GROUP BY room_id
    ) active_participants ON active_participants.room_id = r.id
    LEFT JOIN (
      SELECT room_id, COUNT(*) AS active_count
      FROM rtc_sessions
      WHERE status = 'active'
      GROUP BY room_id
    ) active_sessions ON active_sessions.room_id = r.id
    LEFT JOIN (
      SELECT
        room_id,
        COUNT(*) AS usage_logs,
        COALESCE(SUM(billable_minutes), 0) AS billable_minutes
      FROM usage_logs
      GROUP BY room_id
    ) usage_totals ON usage_totals.room_id = r.id
    WHERE ${roomFilter.sql}
    ORDER BY active_sessions DESC, active_participants DESC, r.updated_at DESC, r.id DESC
    LIMIT 120
    `,
    roomFilter.params
  )

  return rows.map((room) => ({
    id: room.id,
    tenant_id: room.tenant_id,
    owner_id: room.owner_id,
    owner_name: room.owner_name || 'Admin',
    owner_email: room.owner_email,
    name: room.name,
    description: room.description,
    room_type: room.room_type,
    privacy_type: room.privacy_type,
    max_mic_count: Number(room.max_mic_count || 0),
    status: room.status,
    chat_enabled: boolValue(room.chat_enabled),
    gift_enabled: boolValue(room.gift_enabled),
    screen_share_enabled: boolValue(room.screen_share_enabled),
    ai_security_enabled: boolValue(room.ai_security_enabled),
    active_participants: Number(room.active_participants || 0),
    active_sessions: Number(room.active_sessions || 0),
    mics_on: Number(room.mics_on || 0),
    cameras_on: Number(room.cameras_on || 0),
    usage_logs: Number(room.usage_logs || 0),
    billable_minutes: Number(room.billable_minutes || 0),
    created_at: room.created_at,
    updated_at: room.updated_at,
  }))
}

async function getDailyUsage(roomIds) {
  const usageFilter = makeInFilter('ul.room_id', roomIds, 'dailyRoom')

  const rows = await query(
    `
    SELECT
      DATE(ul.created_at) AS usage_date,
      COUNT(*) AS logs,
      COUNT(DISTINCT ul.room_id) AS rooms,
      COUNT(DISTINCT ul.user_id) AS users,
      COALESCE(SUM(ul.duration_seconds), 0) AS seconds,
      COALESCE(SUM(ul.billable_minutes), 0) AS minutes
    FROM usage_logs ul
    WHERE ${usageFilter.sql}
    AND ul.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    GROUP BY DATE(ul.created_at)
    ORDER BY usage_date DESC
    LIMIT 30
    `,
    usageFilter.params
  )

  return rows.map((row) => ({
    usage_date: row.usage_date,
    logs: Number(row.logs || 0),
    rooms: Number(row.rooms || 0),
    users: Number(row.users || 0),
    seconds: Number(row.seconds || 0),
    minutes: Number(row.minutes || 0),
  }))
}

async function getParticipantRecords(roomIds) {
  const participantFilter = makeInFilter('p.room_id', roomIds, 'recordRoom')

  const rows = await query(
    `
    SELECT
      p.id, p.room_id, p.session_id, p.user_id, p.role_in_room,
      p.joined_at, p.left_at, p.duration_seconds, p.connection_status,
      p.mic_enabled, p.camera_enabled,
      r.name AS room_name,
      r.status AS room_status,
      u.name AS user_name,
      u.email AS user_email,
      s.status AS session_status
    FROM rtc_session_participants p
    INNER JOIN rooms r ON r.id = p.room_id
    LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN rtc_sessions s ON s.id = p.session_id
    WHERE ${participantFilter.sql}
    ORDER BY p.joined_at DESC, p.id DESC
    LIMIT 80
    `,
    participantFilter.params
  )

  return rows.map((row) => ({
    id: row.id,
    room_id: row.room_id,
    room_name: row.room_name,
    room_status: row.room_status,
    session_id: row.session_id,
    session_status: row.session_status,
    user_id: row.user_id,
    user_name: row.user_name || `User #${row.user_id}`,
    user_email: row.user_email,
    role: row.role_in_room,
    joined_at: row.joined_at,
    left_at: row.left_at,
    duration_seconds: Number(row.duration_seconds || 0),
    connection_status: row.connection_status,
    mic_enabled: boolValue(row.mic_enabled),
    camera_enabled: boolValue(row.camera_enabled),
  }))
}

function buildBillingSummary({ dashboard, clients, plan }) {
  const monthMinutes = Number(dashboard?.usage_month?.minutes || dashboard?.minutes_used_this_month || 0)
  const todayMinutes = Number(dashboard?.usage_today?.minutes || dashboard?.minutes_used_today || 0)

  if (!plan) {
    return {
      billing_mode: 'participant_minutes',
      minutes_today: todayMinutes,
      minutes_month: monthMinutes,
      monthly_allowance: 0,
      usage_percent: 0,
      estimated_invoice: clients.reduce((total, client) => total + Number(client.estimated_invoice || 0), 0),
      overage_minutes: clients.reduce((total, client) => total + Number(client.overage_minutes || 0), 0),
      note: 'Superadmin aggregate across active client plans.',
    }
  }

  const allowance = Number(plan.monthly_minute_allowance || 0)
  const overageMinutes = Math.max(0, monthMinutes - allowance)
  const overageCost = Number((overageMinutes * Number(plan.minute_rate || 0)).toFixed(2))
  const basePrice = Number(plan.monthly_base_price || 0)

  return {
    billing_mode: 'participant_minutes',
    minutes_today: todayMinutes,
    minutes_month: monthMinutes,
    monthly_allowance: allowance,
    usage_percent: allowance ? Math.min(100, Number(((monthMinutes / allowance) * 100).toFixed(1))) : 0,
    included_monthly_price: basePrice,
    minute_rate: Number(plan.minute_rate || 0),
    overage_minutes: Number(overageMinutes.toFixed(2)),
    estimated_overage_cost: overageCost,
    estimated_invoice: Number((basePrice + overageCost).toFixed(2)),
    note: 'No payment gateway is required; this is the company-wise billing amount for review/export.',
  }
}

function buildPlanFeatureRows(plan, featureRows) {
  const included = new Set(plan?.included_features || [])
  const explicitFlags = new Map((featureRows || []).map((feature) => [feature.key, feature]))

  return FEATURE_CATALOG.map((feature) => {
    const explicit = explicitFlags.get(feature.key)
    return {
      ...feature,
      enabled: explicit ? explicit.enabled : included.has(feature.key),
      limit_value: explicit?.limit_value || (feature.key === 'room_roles' && plan?.max_room_admins ? String(plan.max_room_admins) : null),
      app_name: explicit?.app_name || 'Plan default',
      tenant_name: explicit?.tenant_name,
      updated_at: explicit?.updated_at,
    }
  })
}

async function buildEnterprisePayload({ scope, tenantId = null, dashboard }) {
  const [plans, clients, apps, featureRows, tenantPlan, planRequests] = await Promise.all([
    getServicePlans(),
    getClientRows(scope === 'super_admin' ? null : tenantId),
    getClientApps(scope === 'super_admin' ? null : tenantId),
    getFeatureRows(scope === 'super_admin' ? null : tenantId),
    tenantId ? getTenantPlan(tenantId) : Promise.resolve(null),
    getPlanRequests(scope === 'super_admin' ? null : tenantId),
  ])
  const currentPlan = scope === 'super_admin' ? null : tenantPlan || clients[0]?.plan || null
  const featureControls = scope === 'super_admin'
    ? featureRows
    : buildPlanFeatureRows(currentPlan, featureRows)
  const activeClients = clients.filter((client) => client.status === 'active')
  const aggregateInvoice = clients.reduce((total, client) => total + Number(client.estimated_invoice || 0), 0)
  const aggregateMinutes = clients.reduce((total, client) => total + Number(client.minutes_month || 0), 0)

  return {
    service_model: {
      provider_name: 'TalkEachOther',
      product: 'Enterprise RTC SDK and API service',
      purpose: 'Client companies integrate TalkEachOther audio, video, chat, moderation, filters, and usage billing into their own apps.',
      selling_unit: 'Company app package with SDK credentials, feature controls, and participant-minute billing.',
      rtc_provider: dashboard?.rtc_status || 'online',
      connection_indicator: dashboard?.rtc_status === 'online' ? 'online' : 'attention',
    },
    service_flow: SERVICE_FLOW,
    plans: plans.map((plan) => ({
      ...plan,
      feature_count: plan.included_features.length,
      preview_features: plan.included_features.slice(0, 6).map((key) => catalogFeature(key).label),
    })),
    clients,
    apps,
    plan_requests: planRequests,
    current_plan: currentPlan,
    feature_controls: featureControls,
    limits: currentPlan ? {
      max_room_admins: currentPlan.max_room_admins,
      max_rooms: currentPlan.max_rooms,
      max_apps: currentPlan.max_apps,
      max_participants_per_room: currentPlan.max_participants_per_room,
      monthly_minute_allowance: currentPlan.monthly_minute_allowance,
    } : null,
    billing: buildBillingSummary({ dashboard, clients, plan: currentPlan }),
    platform_totals: {
      active_clients: activeClients.length,
      total_clients: clients.length,
      active_apps: apps.filter((app) => app.status === 'active').length,
      total_apps: apps.length,
      minutes_month: Number(aggregateMinutes.toFixed(2)),
      estimated_invoice: Number(aggregateInvoice.toFixed(2)),
    },
    sdk_status: {
      generated_apps: apps.length,
      active_apps: apps.filter((app) => app.status === 'active').length,
      token_strategy: 'App key + API key + SDK token per client app',
      auth_flow: 'Client app requests a room token, then initializes the WebRTC SDK with that token.',
    },
  }
}

async function buildScopePayload({ adminRow = null, roomIds, enterpriseScope = 'client_admin', tenantId = null }) {
  const [dashboard, rooms, dailyUsage, records] = await Promise.all([
    getDashboard(roomIds),
    getRoomRows(roomIds),
    getDailyUsage(roomIds),
    getParticipantRecords(roomIds),
  ])
  const enterprise = await buildEnterprisePayload({
    scope: enterpriseScope,
    tenantId: tenantId || adminRow?.tenant_id || null,
    dashboard,
  })

  return {
    admin: adminRow ? normalizeAdmin(adminRow, await getAdminStats(roomIds)) : null,
    dashboard,
    enterprise,
    rooms,
    daily_usage: dailyUsage,
    participant_records: records,
  }
}

async function updateClientCompany(companyId, payload) {
  await ensureTenantCompanyColumns()

  return transaction(async (connection) => {
    const [tenants] = await connection.execute(
      `
      SELECT id, name
      FROM tenants
      WHERE id = ?
      LIMIT 1
      `,
      [companyId]
    )

    if (!tenants.length) {
      const error = new Error('Company was not found.')
      error.status = 404
      throw error
    }

    const [plans] = await connection.execute(
      `
      SELECT id, name, code, minute_rate, max_apps, max_rooms, max_participants_per_room
      FROM service_plans
      WHERE id = ?
      AND status = 'active'
      LIMIT 1
      `,
      [payload.planId]
    )
    const plan = plans[0]

    if (!plan) {
      const error = new Error('Select an active service plan for this company.')
      error.status = 422
      throw error
    }

    const [duplicateNames] = await connection.execute(
      `
      SELECT id
      FROM tenants
      WHERE LOWER(name) = LOWER(?)
      AND id <> ?
      LIMIT 1
      `,
      [payload.companyName, companyId]
    )

    if (duplicateNames.length) {
      const error = new Error('A company with this name already exists.')
      error.status = 409
      throw error
    }

    const planLimits = planDefaultLimits(plan)
    const billingEmail = payload.billingEmail || payload.companyEmail || payload.primaryContactEmail || null
    const defaultAppLimit = positiveInteger(payload.defaultAppLimit, planLimits.app_limit)
    const defaultRoomLimit = positiveInteger(payload.defaultRoomLimit, planLimits.room_limit)
    const defaultParticipantLimit = positiveInteger(payload.defaultParticipantLimit, planLimits.participant_limit)

    await connection.execute(
      `
      UPDATE tenants
      SET name = ?,
          legal_name = ?,
          industry = ?,
          company_email = ?,
          phone = ?,
          website_url = ?,
          app_url = ?,
          telegram_contact = ?,
          whatsapp_contact = ?,
          discord_contact = ?,
          address = ?,
          country = ?,
          timezone = ?,
          primary_contact_name = ?,
          primary_contact_email = ?,
          billing_email = ?,
          billing_type = ?,
          status = ?,
          billing_rate_per_minute = ?,
          default_app_limit = ?,
          default_room_limit = ?,
          default_participant_limit = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [
        payload.companyName,
        payload.legalName,
        payload.industry,
        payload.companyEmail,
        payload.phone,
        payload.websiteUrl,
        payload.appUrl,
        payload.telegramContact,
        payload.whatsappContact,
        payload.discordContact,
        payload.address,
        payload.country,
        payload.timezone,
        payload.primaryContactName || null,
        payload.primaryContactEmail,
        billingEmail,
        payload.billingType,
        payload.status,
        Number(plan.minute_rate || 0),
        defaultAppLimit,
        defaultRoomLimit,
        defaultParticipantLimit,
        companyId,
      ]
    )

    await connection.execute(
      `
      UPDATE tenant_plan_assignments
      SET status = 'inactive',
          ends_at = COALESCE(ends_at, NOW()),
          updated_at = NOW()
      WHERE tenant_id = ?
      AND status = 'active'
      `,
      [companyId]
    )

    await connection.execute(
      `
      INSERT INTO tenant_plan_assignments (
        tenant_id, plan_id, status, starts_at, created_at, updated_at
      )
      VALUES (?, ?, 'active', NOW(), NOW(), NOW())
      `,
      [companyId, plan.id]
    )

    await connection.execute(
      `
      UPDATE client_apps
      SET plan_id = ?,
          updated_at = NOW()
      WHERE tenant_id = ?
      `,
      [plan.id, companyId]
    )

    return companyId
  })
}

async function inviteClientCompanyAdmin(companyId, body = {}) {
  await ensureTenantCompanyColumns()

  return transaction(async (connection) => {
    const [tenants] = await connection.execute(
      `
      SELECT id, name, status, phone, primary_contact_name, primary_contact_email
      FROM tenants
      WHERE id = ?
      LIMIT 1
      `,
      [companyId]
    )
    const tenant = tenants[0]

    if (!tenant) {
      const error = new Error('Company was not found.')
      error.status = 404
      throw error
    }

    const invitedName = cleanString(readBodyValue(body, 'primary_contact_name', 'primaryContactName') || tenant.primary_contact_name || `${tenant.name} Admin`, 150)
    const invitedEmail = normalizeEmail(readBodyValue(body, 'primary_contact_email', 'primaryContactEmail') || tenant.primary_contact_email)

    if (!invitedEmail || !isValidEmail(invitedEmail)) {
      const error = new Error('Primary contact email is required before creating an admin invite.')
      error.status = 422
      throw error
    }

    await connection.execute(
      `
      UPDATE tenants
      SET primary_contact_name = ?,
          primary_contact_email = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [invitedName, invitedEmail, companyId]
    )

    const adminAccount = await createClientAdmin(connection, companyId, tenant.status, {
      name: invitedName,
      email: invitedEmail,
      phone: tenant.phone,
    })
    const adminInvite = await createCompanyAdminInvite(connection, companyId, {
      name: invitedName,
      email: invitedEmail,
    })

    return { adminAccount, adminInvite }
  })
}

module.exports = {
  ADMIN_ROLES,
  cleanString,
  createAdminRoom,
  createClientAppForTenant,
  createClientCompany,
  createPlanRequest,
  ensureTenantCompanyColumns,
  getAdminStats,
  getAdminUser,
  getClientAdmins,
  getClientApps,
  getClientRows,
  getDashboard,
  getPlanRequests,
  getRoomRows,
  getScopedRoomIds,
  getServicePlans,
  getTenantRoomIds,
  getTenantUsers,
  getUniqueTenantUid,
  buildScopePayload,
  inviteClientCompanyAdmin,
  normalizeAdmin,
  normalizeAdminRoomStatus,
  normalizeCompanyStatus,
  parseAdminRoomPayload,
  parseCompanyPayload,
  parseServicePlanPayload,
  reviewPlanRequest,
  roleList,
  rotateClientAppCredentials,
  setAdminRoomStatus,
  updateClientAppForTenant,
  updateClientCompany,
}
