const express = require('express')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { query, transaction } = require('../config/db')

const router = express.Router()
const EXTERNAL_USER_STATUSES = new Set(['active', 'inactive', 'banned'])
const RTC_ROLES = new Set(['audience', 'publisher', 'moderator', 'admin', 'owner'])
const CLIENT_ROOM_TYPES = new Set(['audio', 'video', 'group_audio', 'group_video', 'solo_live', 'pk_live'])
const CLIENT_PRIVACY_TYPES = new Set(['public', 'private', 'password'])
const CLIENT_ROOM_STATUSES = new Set(['active', 'inactive', 'ended'])
const CLIENT_ROOM_THEMES = new Set(['neon', 'midnight', 'studio', 'mint'])
const RTC_TOKEN_TTL_SECONDS = Number(process.env.CLIENT_RTC_TOKEN_TTL_SECONDS || 900)
const MAX_CLIENT_ROOM_SEATS = 20
let clientSchemaPromise = null

function cleanString(value, maxLength = 255) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength)
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

function normalizeStatus(value) {
  const status = cleanString(value, 30).toLowerCase() || 'active'
  return EXTERNAL_USER_STATUSES.has(status) ? status : 'active'
}

function readBodyValue(body, snakeKey, camelKey = snakeKey) {
  return body?.[snakeKey] ?? body?.[camelKey]
}

function hasBodyValue(body, snakeKey, camelKey = snakeKey) {
  return Object.prototype.hasOwnProperty.call(body || {}, snakeKey)
    || Object.prototype.hasOwnProperty.call(body || {}, camelKey)
}

function getApiKey(req) {
  const authHeader = req.headers.authorization || ''
  if (authHeader.startsWith('Bearer ')) return authHeader.replace('Bearer ', '').trim()
  return cleanString(req.headers['x-rtc-api-key'] || req.headers['x-api-key'] || '', 255)
}

function hashSecret(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function maskSecret(value) {
  const text = String(value || '')
  if (!text) return ''
  if (text.includes('...')) return text
  if (text.length <= 8) return `${text.slice(0, 2)}...${text.slice(-2)}`
  return `${text.slice(0, 6)}...${text.slice(-4)}`
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value
  if (!value) return []

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function originFromRequest(req) {
  const originHeader = cleanString(req.headers.origin, 255)
  const refererHeader = cleanString(req.headers.referer || req.headers.referrer, 255)
  const rawOrigin = originHeader || refererHeader
  if (!rawOrigin) return ''

  try {
    return new URL(rawOrigin).origin
  } catch {
    return rawOrigin.replace(/\/+$/g, '')
  }
}

function allowedOriginSet(value) {
  return new Set(parseJsonArray(value).map((origin) => {
    try {
      return new URL(origin).origin
    } catch {
      return cleanString(origin, 255).replace(/\/+$/g, '')
    }
  }).filter(Boolean))
}

function clientError(res, status, code, message, extra = {}) {
  return res.status(status).json({ code, message, ...extra })
}

function parseMetadata(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'object' && !Array.isArray(value)) return value
  return { value }
}

function parsePermissionList(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '')
      .split(',')

  return [...new Set(raw
    .map((permission) => cleanString(permission, 60).toLowerCase())
    .filter(Boolean))]
    .slice(0, 30)
}

function normalizeRtcRole(value) {
  const role = cleanString(value, 30).toLowerCase() || 'publisher'
  return RTC_ROLES.has(role) ? role : 'publisher'
}

function parseInteger(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue
  const number = Number(value)
  return Number.isInteger(number) ? number : null
}

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null) return defaultValue
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1

  const normalized = String(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  return defaultValue
}

function createHttpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function createClientError(status, code, message, errors = null) {
  const error = createHttpError(status, message)
  error.code = code
  if (errors) error.errors = errors
  return error
}

function clientBillingPolicy(tenant = {}) {
  return {
    payer: 'client_company',
    user_pays: false,
    billing_scope: 'client_company',
    tenant_id: tenant.id ? Number(tenant.id) : tenant.tenant_id ? Number(tenant.tenant_id) : null,
    tenant_name: tenant.name || tenant.tenant_name || null,
    note: 'The client company is billed for invited user RTC usage. Synced external users are not charged by this platform.',
  }
}

async function ensureClientSchema() {
  if (!clientSchemaPromise) {
    clientSchemaPromise = (async () => {
      await query(
        `
        CREATE TABLE IF NOT EXISTS client_external_users (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          tenant_id BIGINT UNSIGNED NOT NULL,
          app_id BIGINT UNSIGNED NOT NULL,
          user_id BIGINT UNSIGNED NOT NULL,
          external_user_id VARCHAR(190) NOT NULL,
          display_name VARCHAR(150) NOT NULL,
          avatar_url VARCHAR(255) NULL,
          email VARCHAR(180) NULL,
          phone VARCHAR(60) NULL,
          billing_scope ENUM('client_company') DEFAULT 'client_company',
          user_pays TINYINT(1) DEFAULT 0,
          metadata_json JSON NULL,
          status ENUM('active', 'inactive', 'banned') DEFAULT 'active',
          last_synced_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY unique_client_external_user (app_id, external_user_id),
          INDEX idx_client_external_tenant_id (tenant_id),
          INDEX idx_client_external_user_id (user_id),
          CONSTRAINT fk_client_external_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          CONSTRAINT fk_client_external_app FOREIGN KEY (app_id) REFERENCES client_apps(id) ON DELETE CASCADE,
          CONSTRAINT fk_client_external_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        `
      )

      const externalUserColumns = await query(
        `
        SELECT COLUMN_NAME AS column_name
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'client_external_users'
        `
      )
      const externalUserColumnNames = new Set(externalUserColumns.map((row) => row.column_name))
      if (!externalUserColumnNames.has('billing_scope')) {
        await query("ALTER TABLE client_external_users ADD COLUMN billing_scope ENUM('client_company') DEFAULT 'client_company' AFTER phone")
      }
      if (!externalUserColumnNames.has('user_pays')) {
        await query('ALTER TABLE client_external_users ADD COLUMN user_pays TINYINT(1) DEFAULT 0 AFTER billing_scope')
      }
      await query("UPDATE client_external_users SET billing_scope = 'client_company', user_pays = 0 WHERE billing_scope IS NULL OR user_pays IS NULL OR user_pays <> 0")

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

      await query("ALTER TABLE rtc_sessions MODIFY COLUMN rtc_provider ENUM('native_webrtc', 'mediasoup', 'janus', 'livekit_style') NOT NULL DEFAULT 'native_webrtc'")

      await query(
        `
        CREATE TABLE IF NOT EXISTS rtc_tokens (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          tenant_id BIGINT UNSIGNED NOT NULL,
          app_id BIGINT UNSIGNED NOT NULL,
          room_id BIGINT UNSIGNED NOT NULL,
          user_id BIGINT UNSIGNED NOT NULL,
          external_user_id VARCHAR(190) NOT NULL,
          token_hash CHAR(64) NOT NULL,
          role VARCHAR(40) NOT NULL,
          permissions_json JSON NULL,
          claims_json JSON NULL,
          issued_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP NULL,
          revoked_at TIMESTAMP NULL,
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_rtc_token_hash (token_hash),
          INDEX idx_rtc_tokens_tenant_id (tenant_id),
          INDEX idx_rtc_tokens_app_id (app_id),
          INDEX idx_rtc_tokens_room_id (room_id),
          INDEX idx_rtc_tokens_external_user_id (external_user_id),
          INDEX idx_rtc_tokens_expires_at (expires_at),
          CONSTRAINT fk_rtc_tokens_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          CONSTRAINT fk_rtc_tokens_app FOREIGN KEY (app_id) REFERENCES client_apps(id) ON DELETE CASCADE,
          CONSTRAINT fk_rtc_tokens_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
          CONSTRAINT fk_rtc_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        `
      )

      await query(
        `
        CREATE TABLE IF NOT EXISTS usage_daily (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          tenant_id BIGINT UNSIGNED NOT NULL,
          app_id BIGINT UNSIGNED NULL,
          usage_date DATE NOT NULL,
          participant_minutes DECIMAL(14,2) DEFAULT 0.00,
          room_minutes DECIMAL(14,2) DEFAULT 0.00,
          session_count INT DEFAULT 0,
          token_count INT DEFAULT 0,
          peak_concurrency INT DEFAULT 0,
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY unique_usage_daily_scope (tenant_id, app_id, usage_date),
          INDEX idx_usage_daily_tenant_date (tenant_id, usage_date),
          CONSTRAINT fk_usage_daily_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          CONSTRAINT fk_usage_daily_app FOREIGN KEY (app_id) REFERENCES client_apps(id) ON DELETE SET NULL
        )
        `
      )

      await query(
        `
        CREATE TABLE IF NOT EXISTS billing_invoices (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          tenant_id BIGINT UNSIGNED NOT NULL,
          plan_id BIGINT UNSIGNED NULL,
          invoice_month DATE NOT NULL,
          status ENUM('draft', 'issued', 'paid', 'overdue', 'void') DEFAULT 'draft',
          participant_minutes DECIMAL(14,2) DEFAULT 0.00,
          included_minutes DECIMAL(14,2) DEFAULT 0.00,
          overage_minutes DECIMAL(14,2) DEFAULT 0.00,
          subtotal_amount DECIMAL(12,2) DEFAULT 0.00,
          total_amount DECIMAL(12,2) DEFAULT 0.00,
          currency CHAR(3) DEFAULT 'USD',
          metadata_json JSON NULL,
          issued_at TIMESTAMP NULL,
          due_at TIMESTAMP NULL,
          paid_at TIMESTAMP NULL,
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY unique_billing_invoice_month (tenant_id, invoice_month),
          INDEX idx_billing_invoices_tenant_id (tenant_id),
          INDEX idx_billing_invoices_status (status),
          CONSTRAINT fk_billing_invoices_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          CONSTRAINT fk_billing_invoices_plan FOREIGN KEY (plan_id) REFERENCES service_plans(id) ON DELETE SET NULL
        )
        `
      )

      await query(
        `
        CREATE TABLE IF NOT EXISTS webhooks (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          tenant_id BIGINT UNSIGNED NOT NULL,
          app_id BIGINT UNSIGNED NULL,
          name VARCHAR(150) NOT NULL,
          target_url VARCHAR(500) NOT NULL,
          secret_hash CHAR(64) NULL,
          event_types JSON NULL,
          status ENUM('active', 'inactive') DEFAULT 'active',
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_webhooks_tenant_id (tenant_id),
          INDEX idx_webhooks_app_id (app_id),
          CONSTRAINT fk_webhooks_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          CONSTRAINT fk_webhooks_app FOREIGN KEY (app_id) REFERENCES client_apps(id) ON DELETE CASCADE
        )
        `
      )

      await query(
        `
        CREATE TABLE IF NOT EXISTS webhook_events (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          tenant_id BIGINT UNSIGNED NOT NULL,
          app_id BIGINT UNSIGNED NULL,
          event_type VARCHAR(120) NOT NULL,
          payload_json JSON NULL,
          status ENUM('pending', 'processing', 'delivered', 'failed') DEFAULT 'pending',
          attempts INT DEFAULT 0,
          last_attempt_at TIMESTAMP NULL,
          delivered_at TIMESTAMP NULL,
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_webhook_events_tenant_id (tenant_id),
          INDEX idx_webhook_events_app_id (app_id),
          INDEX idx_webhook_events_status (status),
          INDEX idx_webhook_events_event_type (event_type),
          CONSTRAINT fk_webhook_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          CONSTRAINT fk_webhook_events_app FOREIGN KEY (app_id) REFERENCES client_apps(id) ON DELETE SET NULL
        )
        `
      )

      await query(
        `
        CREATE TABLE IF NOT EXISTS audit_logs (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          tenant_id BIGINT UNSIGNED NULL,
          actor_user_id BIGINT UNSIGNED NULL,
          actor_type ENUM('user', 'client_api', 'system') DEFAULT 'system',
          action VARCHAR(120) NOT NULL,
          entity_type VARCHAR(80) NULL,
          entity_id VARCHAR(80) NULL,
          ip_address VARCHAR(64) NULL,
          metadata_json JSON NULL,
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_audit_logs_tenant_id (tenant_id),
          INDEX idx_audit_logs_actor_user_id (actor_user_id),
          INDEX idx_audit_logs_action (action),
          INDEX idx_audit_logs_created_at (created_at),
          CONSTRAINT fk_audit_logs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
          CONSTRAINT fk_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
        )
        `
      )
    })().catch((error) => {
      clientSchemaPromise = null
      throw error
    })
  }

  return clientSchemaPromise
}

async function clientApiAuth(req, res, next) {
  try {
    await ensureClientSchema()

    const apiKey = getApiKey(req)
    if (!apiKey) return clientError(res, 401, 'invalid_api_key', 'Client API key is required.')

    const apiKeyHash = hashSecret(apiKey)

    const apps = await query(
      `
      SELECT
        ca.id, ca.tenant_id, ca.plan_id, ca.name, ca.platform, ca.app_key,
        ca.api_key, ca.api_key_hash, ca.allowed_origins, ca.status AS app_status,
        t.name AS tenant_name,
        t.status AS tenant_status,
        sp.name AS plan_name,
        sp.code AS plan_code
      FROM client_apps ca
      INNER JOIN tenants t ON t.id = ca.tenant_id
      LEFT JOIN service_plans sp ON sp.id = ca.plan_id
      WHERE ca.api_key_hash = :apiKeyHash
      OR ca.api_key = :apiKey
      LIMIT 1
      `,
      { apiKey, apiKeyHash }
    )
    const app = apps[0]

    if (!app) return clientError(res, 401, 'invalid_api_key', 'Invalid client API key.')
    if (app.app_status !== 'active') return clientError(res, 403, 'app_suspended', 'Client app is not active.')
    if (!['active', 'pending'].includes(app.tenant_status)) {
      return clientError(res, 403, 'company_suspended', 'Client company is not allowed to use RTC service.')
    }

    const requestOrigin = originFromRequest(req)
    const allowedOrigins = allowedOriginSet(app.allowed_origins)
    if (requestOrigin && allowedOrigins.size > 0 && !allowedOrigins.has('*') && !allowedOrigins.has(requestOrigin)) {
      return clientError(res, 403, 'origin_not_allowed', 'This web origin is not allowed for the client app.', {
        origin: requestOrigin,
      })
    }

    if (!app.api_key_hash || app.api_key === apiKey) {
      await query(
        `
        UPDATE client_apps
        SET api_key_hash = :apiKeyHash,
            api_key = :apiKeyMasked,
            updated_at = NOW()
        WHERE id = :appId
        AND (api_key_hash IS NULL OR api_key_hash = '' OR api_key = :apiKey)
        `,
        {
          apiKey,
          apiKeyHash,
          apiKeyMasked: maskSecret(apiKey),
          appId: app.id,
        }
      )
    }

    req.clientApp = {
      id: app.id,
      tenant_id: app.tenant_id,
      plan_id: app.plan_id,
      name: app.name,
      platform: app.platform,
      app_key: app.app_key,
      status: app.app_status,
      plan_name: app.plan_name,
      plan_code: app.plan_code,
      allowed_origins: [...allowedOrigins],
    }
    req.clientTenant = {
      id: app.tenant_id,
      name: app.tenant_name,
      status: app.tenant_status,
    }

    return next()
  } catch (error) {
    return next(error)
  }
}

async function getEndUserRoleId(connection) {
  const [roles] = await connection.execute(
    `
    SELECT id
    FROM roles
    WHERE name = 'end_user'
    LIMIT 1
    `
  )

  if (roles.length) return roles[0].id

  const [result] = await connection.execute(
    `
    INSERT INTO roles (name, label, created_at)
    VALUES ('end_user', 'End User', NOW())
    `
  )
  return result.insertId
}

async function assignEndUserRole(connection, userId, tenantId) {
  const roleId = await getEndUserRoleId(connection)
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
    [userId, roleId, tenantId, userId, roleId, tenantId]
  )
}

async function findOrCreateShadowUser(connection, tenantId, payload, mappedUserId = null) {
  const passwordHash = await bcrypt.hash(`external-user-${crypto.randomBytes(24).toString('hex')}`, 10)
  const userStatus = payload.status === 'banned' ? 'banned' : payload.status === 'inactive' ? 'inactive' : 'active'

  if (mappedUserId) {
    await connection.execute(
      `
      UPDATE users
      SET name = ?,
          email = ?,
          phone = ?,
          avatar_url = ?,
          status = ?,
          updated_at = NOW()
      WHERE id = ?
      AND tenant_id = ?
      `,
      [payload.name, payload.email, payload.phone, payload.avatarUrl, userStatus, mappedUserId, tenantId]
    )
    await assignEndUserRole(connection, mappedUserId, tenantId)
    return mappedUserId
  }

  if (payload.email) {
    const [existing] = await connection.execute(
      `
      SELECT id
      FROM users
      WHERE tenant_id = ?
      AND email = ?
      LIMIT 1
      `,
      [tenantId, payload.email]
    )

    if (existing.length) {
      await connection.execute(
        `
        UPDATE users
        SET name = ?,
            phone = ?,
            avatar_url = ?,
            status = ?,
            updated_at = NOW()
        WHERE id = ?
        `,
        [payload.name, payload.phone, payload.avatarUrl, userStatus, existing[0].id]
      )
      await assignEndUserRole(connection, existing[0].id, tenantId)
      return existing[0].id
    }
  }

  const [result] = await connection.execute(
    `
    INSERT INTO users (
      tenant_id, name, email, phone, avatar_url, password_hash, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `,
    [tenantId, payload.name, payload.email, payload.phone, payload.avatarUrl, passwordHash, userStatus]
  )
  await assignEndUserRole(connection, result.insertId, tenantId)
  return result.insertId
}

function parseExternalUserPayload(body = {}) {
  const externalUserId = cleanString(
    readBodyValue(body, 'external_user_id', 'externalUserId')
      || readBodyValue(body, 'uid')
      || readBodyValue(body, 'user_id', 'userId'),
    190
  )
  const name = cleanString(
    readBodyValue(body, 'name')
      || readBodyValue(body, 'display_name', 'displayName')
      || readBodyValue(body, 'nickname'),
    150
  )
  const email = normalizeEmail(readBodyValue(body, 'email'))
  const metadata = parseMetadata(readBodyValue(body, 'metadata'))
  const errors = {}

  if (!externalUserId) errors.external_user_id = 'external_user_id is required.'
  if (!name) errors.name = 'User name or display_name is required.'
  if (!isValidEmail(email)) errors.email = 'Enter a valid email or omit email.'

  return {
    errors,
    payload: {
      externalUserId,
      name,
      email: email || null,
      phone: emptyToNull(readBodyValue(body, 'phone'), 60),
      avatarUrl: emptyToNull(readBodyValue(body, 'avatar_url', 'avatarUrl'), 255),
      metadata,
      status: normalizeStatus(readBodyValue(body, 'status')),
    },
  }
}

function parseJsonObject(value) {
  if (!value) return null
  if (typeof value === 'object') return value

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function formatExternalUser(row) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    app_id: row.app_id,
    user_id: row.user_id,
    external_user_id: row.external_user_id,
    name: row.display_name,
    email: row.email,
    phone: row.phone,
    billing_scope: row.billing_scope || 'client_company',
    user_pays: false,
    billing: clientBillingPolicy(row),
    avatar_url: row.avatar_url,
    status: row.status,
    metadata: parseJsonObject(row.metadata_json),
    last_synced_at: row.last_synced_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

async function getExternalUser(appId, externalUserId) {
  const rows = await query(
    `
    SELECT *
    FROM client_external_users
    WHERE app_id = :appId
    AND external_user_id = :externalUserId
    LIMIT 1
    `,
    { appId, externalUserId }
  )

  return rows[0] ? formatExternalUser(rows[0]) : null
}

function parseRoomListOptions(queryParams = {}) {
  const page = Math.max(1, parseInteger(queryParams.page, 1) || 1)
  const perPage = Math.min(60, Math.max(1, parseInteger(queryParams.per_page || queryParams.perPage, 24) || 24))
  const status = cleanString(queryParams.status, 30).toLowerCase() || 'active'
  const privacyType = cleanString(queryParams.privacy_type || queryParams.privacy, 30).toLowerCase() || 'all'
  const roomType = cleanString(queryParams.room_type || queryParams.type, 30).toLowerCase() || 'all'
  const search = cleanString(queryParams.q || queryParams.search, 80)
  const errors = {}

  if (status !== 'all' && !CLIENT_ROOM_STATUSES.has(status)) errors.status = 'Invalid room status.'
  if (privacyType !== 'all' && !CLIENT_PRIVACY_TYPES.has(privacyType)) errors.privacy_type = 'Invalid privacy type.'
  if (roomType !== 'all' && !CLIENT_ROOM_TYPES.has(roomType)) errors.room_type = 'Invalid room type.'

  return { errors, page, perPage, status, privacyType, roomType, search }
}

function parseClientRoomPayload(body = {}) {
  const externalUserId = cleanString(
    readBodyValue(body, 'external_user_id', 'externalUserId')
      || readBodyValue(body, 'owner_external_user_id', 'ownerExternalUserId')
      || readBodyValue(body, 'uid')
      || readBodyValue(body, 'user_id', 'userId'),
    190
  )
  const name = cleanString(readBodyValue(body, 'name'), 150)
  const description = emptyToNull(readBodyValue(body, 'description'), 700)
  const profileImage = emptyToNull(readBodyValue(body, 'profile_image', 'profileImage'), 255)
  const roomType = cleanString(readBodyValue(body, 'room_type', 'roomType'), 30).toLowerCase() || 'video'
  const privacyType = cleanString(readBodyValue(body, 'privacy_type', 'privacyType'), 30).toLowerCase() || 'public'
  const password = cleanString(readBodyValue(body, 'password'), 100)
  const maxMicCount = parseInteger(readBodyValue(body, 'max_mic_count', 'maxMicCount'), 8)
  const theme = emptyToNull(readBodyValue(body, 'theme'), 100)
  const errors = {}

  if (!externalUserId) errors.external_user_id = 'external_user_id is required.'
  if (!name) errors.name = 'Room name is required.'
  if (name && name.length < 3) errors.name = 'Room name must be at least 3 characters.'
  if (!CLIENT_ROOM_TYPES.has(roomType)) errors.room_type = 'Choose a valid room type.'
  if (!CLIENT_PRIVACY_TYPES.has(privacyType)) errors.privacy_type = 'Choose a valid privacy type.'
  if (!maxMicCount || maxMicCount < 1 || maxMicCount > MAX_CLIENT_ROOM_SEATS) errors.max_mic_count = `max_mic_count must be between 1 and ${MAX_CLIENT_ROOM_SEATS}.`
  if (privacyType === 'password' && password.length < 4) errors.password = 'Password rooms need a password of at least 4 characters.'

  return {
    errors,
    payload: {
      externalUserId,
      name,
      description,
      profileImage,
      roomType,
      privacyType,
      password: privacyType === 'password' ? password : '',
      maxMicCount,
      theme,
      chatEnabled: parseBoolean(readBodyValue(body, 'chat_enabled', 'chatEnabled'), true),
      giftEnabled: parseBoolean(readBodyValue(body, 'gift_enabled', 'giftEnabled'), false),
      screenShareEnabled: parseBoolean(readBodyValue(body, 'screen_share_enabled', 'screenShareEnabled'), false),
      aiSecurityEnabled: parseBoolean(readBodyValue(body, 'ai_security_enabled', 'aiSecurityEnabled'), false),
    },
  }
}

function formatClientRoom(row) {
  if (!row) return null

  return {
    id: Number(row.id),
    tenant_id: Number(row.tenant_id),
    billing: clientBillingPolicy(row),
    owner: {
      user_id: row.owner_id ? Number(row.owner_id) : null,
      name: row.owner_name || null,
      external_user_id: row.owner_external_user_id || null,
    },
    name: row.name,
    description: row.description,
    profile_image: row.profile_image,
    room_type: row.room_type,
    privacy_type: row.privacy_type,
    is_password_protected: row.privacy_type === 'password',
    max_mic_count: Number(row.max_mic_count || 0),
    active_participants: Number(row.active_participants || 0),
    theme: row.theme,
    controls: {
      chat_enabled: Boolean(Number(row.chat_enabled)),
      gift_enabled: Boolean(Number(row.gift_enabled)),
      screen_share_enabled: Boolean(Number(row.screen_share_enabled)),
      ai_security_enabled: Boolean(Number(row.ai_security_enabled)),
    },
    status: row.status,
    signaling_room: `webrtc_tenant_${row.tenant_id}_room_${row.id}`,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function clientRoomSelectSql() {
  return `
    SELECT
      r.id, r.tenant_id, r.owner_id, r.name, r.description, r.profile_image,
      r.room_type, r.privacy_type, r.max_mic_count, r.theme,
      r.chat_enabled, r.gift_enabled, r.screen_share_enabled, r.ai_security_enabled,
      r.status, r.created_at, r.updated_at,
      owner.name AS owner_name,
      owner_mapping.external_user_id AS owner_external_user_id,
      COALESCE(active_counts.active_participants, 0) AS active_participants
    FROM rooms r
    LEFT JOIN users owner ON owner.id = r.owner_id
    LEFT JOIN client_external_users owner_mapping
      ON owner_mapping.user_id = r.owner_id
      AND owner_mapping.app_id = :appId
    LEFT JOIN (
      SELECT active_sessions.room_id, COUNT(active_participants.id) AS active_participants
      FROM rtc_sessions active_sessions
      LEFT JOIN rtc_session_participants active_participants
        ON active_participants.session_id = active_sessions.id
        AND active_participants.left_at IS NULL
      WHERE active_sessions.status = 'active'
      GROUP BY active_sessions.room_id
    ) active_counts ON active_counts.room_id = r.id
  `
}

async function getClientRoom(appId, tenantId, roomId) {
  const rows = await query(
    `
    ${clientRoomSelectSql()}
    WHERE r.tenant_id = :tenantId
    AND r.id = :roomId
    LIMIT 1
    `,
    { appId, tenantId, roomId }
  )

  return rows[0] ? formatClientRoom(rows[0]) : null
}

function normalizeClientRoomStatus(value) {
  const status = cleanString(value, 30).toLowerCase() || 'active'
  return CLIENT_ROOM_STATUSES.has(status) ? status : 'active'
}

async function buildClientRoomUpdate(room, body = {}) {
  const updates = []
  const values = []
  const errors = {}

  if (hasBodyValue(body, 'name')) {
    const name = cleanString(readBodyValue(body, 'name'), 150)
    if (!name || name.length < 3) errors.name = 'Room name must be at least 3 characters.'
    else {
      updates.push('name = ?')
      values.push(name)
    }
  }

  if (hasBodyValue(body, 'description')) {
    updates.push('description = ?')
    values.push(emptyToNull(readBodyValue(body, 'description'), 700))
  }

  if (hasBodyValue(body, 'profile_image', 'profileImage')) {
    updates.push('profile_image = ?')
    values.push(emptyToNull(readBodyValue(body, 'profile_image', 'profileImage'), 255))
  }

  if (hasBodyValue(body, 'room_type', 'roomType')) {
    const roomType = cleanString(readBodyValue(body, 'room_type', 'roomType'), 30).toLowerCase()
    if (!CLIENT_ROOM_TYPES.has(roomType)) errors.room_type = 'Choose a valid room type.'
    else {
      updates.push('room_type = ?')
      values.push(roomType)
    }
  }

  if (hasBodyValue(body, 'privacy_type', 'privacyType')) {
    const privacyType = cleanString(readBodyValue(body, 'privacy_type', 'privacyType'), 30).toLowerCase()
    const password = cleanString(readBodyValue(body, 'password'), 100)

    if (!CLIENT_PRIVACY_TYPES.has(privacyType)) errors.privacy_type = 'Choose a valid privacy type.'
    else {
      updates.push('privacy_type = ?')
      values.push(privacyType)

      if (privacyType === 'password') {
        if (password) {
          if (password.length < 4) errors.password = 'Room password must be at least 4 characters.'
          else {
            updates.push('password_hash = ?')
            values.push(await bcrypt.hash(password, 10))
          }
        } else if (!room.password_hash || room.privacy_type !== 'password') {
          errors.password = 'A password is required when switching to password privacy.'
        }
      } else {
        updates.push('password_hash = NULL')
      }
    }
  } else if (hasBodyValue(body, 'password')) {
    const password = cleanString(readBodyValue(body, 'password'), 100)
    if (room.privacy_type !== 'password') errors.password = 'Switch room privacy to password before setting a password.'
    else if (password.length < 4) errors.password = 'Room password must be at least 4 characters.'
    else {
      updates.push('password_hash = ?')
      values.push(await bcrypt.hash(password, 10))
    }
  }

  if (hasBodyValue(body, 'max_mic_count', 'maxMicCount')) {
    const maxMicCount = parseInteger(readBodyValue(body, 'max_mic_count', 'maxMicCount'), null)
    if (!maxMicCount || maxMicCount < 1 || maxMicCount > MAX_CLIENT_ROOM_SEATS) {
      errors.max_mic_count = `max_mic_count must be between 1 and ${MAX_CLIENT_ROOM_SEATS}.`
    } else {
      updates.push('max_mic_count = ?')
      values.push(maxMicCount)
    }
  }

  if (hasBodyValue(body, 'theme')) {
    const theme = cleanString(readBodyValue(body, 'theme'), 100).toLowerCase()
    if (theme && !CLIENT_ROOM_THEMES.has(theme)) errors.theme = 'Choose a valid room theme.'
    else {
      updates.push('theme = ?')
      values.push(theme || null)
    }
  }

  const booleanFields = [
    ['chat_enabled', 'chatEnabled'],
    ['gift_enabled', 'giftEnabled'],
    ['screen_share_enabled', 'screenShareEnabled'],
    ['ai_security_enabled', 'aiSecurityEnabled'],
  ]

  for (const [snakeKey, camelKey] of booleanFields) {
    if (hasBodyValue(body, snakeKey, camelKey)) {
      const nextValue = parseBoolean(readBodyValue(body, snakeKey, camelKey), Boolean(Number(room[snakeKey]))) ? 1 : 0
      updates.push(`${snakeKey} = ?`)
      values.push(nextValue)
    }
  }

  return { errors, updates, values }
}

async function setClientRoomStatus(tenantId, roomId, status, appId = null) {
  return transaction(async (connection) => {
    const [rooms] = await connection.execute(
      `
      SELECT *
      FROM rooms
      WHERE tenant_id = ?
      AND id = ?
      LIMIT 1
      `,
      [tenantId, roomId]
    )
    const room = rooms[0]

    if (!room) throw createClientError(404, 'room_not_found', 'Room was not found for this client company.')

    await connection.execute(
      `
      UPDATE rooms
      SET status = ?,
          updated_at = NOW()
      WHERE tenant_id = ?
      AND id = ?
      `,
      [status, tenantId, roomId]
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
        [roomId]
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
        [roomId]
      )

      const webhookEvent = status === 'inactive' ? 'room.disabled' : 'room.ended'
      await queueWebhookEvent(connection, {
        tenantId,
        appId,
        eventType: webhookEvent,
        payload: {
          room_id: roomId,
          previous_status: room.status,
          status,
        },
      })
      await writeClientAuditLog(connection, {
        tenantId,
        action: `client_api.room.${status === 'inactive' ? 'disabled' : 'ended'}`,
        entityType: 'room',
        entityId: roomId,
        metadata: { app_id: appId, previous_status: room.status, status },
      })
    }

    return room
  })
}

function parseRtcTokenPayload(body = {}) {
  const externalUserId = cleanString(
    readBodyValue(body, 'external_user_id', 'externalUserId')
      || readBodyValue(body, 'uid')
      || readBodyValue(body, 'user_id', 'userId'),
    190
  )
  const roomId = Number(readBodyValue(body, 'room_id', 'roomId'))
  const role = normalizeRtcRole(readBodyValue(body, 'role'))
  const permissions = parsePermissionList(readBodyValue(body, 'permissions', 'scope'))
  const errors = {}

  if (!externalUserId) errors.external_user_id = 'external_user_id is required.'
  if (!Number.isInteger(roomId) || roomId <= 0) errors.room_id = 'room_id must be a positive integer.'

  const defaultPermissions = role === 'audience'
    ? ['room:join', 'media:subscribe', 'chat:read']
    : ['room:join', 'media:publish', 'media:subscribe', 'chat:write', 'chat:read']

  return {
    errors,
    payload: {
      externalUserId,
      roomId,
      role,
      permissions: permissions.length ? permissions : defaultPermissions,
      rtcMode: cleanString(readBodyValue(body, 'rtc_mode', 'rtcMode'), 20) || null,
    },
  }
}

async function getTokenRoom(tenantId, roomId) {
  const rows = await query(
    `
    SELECT
      id, tenant_id, owner_id, name, description, room_type, privacy_type,
      max_mic_count, chat_enabled, gift_enabled, screen_share_enabled,
      ai_security_enabled, status
    FROM rooms
    WHERE tenant_id = :tenantId
    AND id = :roomId
    LIMIT 1
    `,
    { tenantId, roomId }
  )

  return rows[0] || null
}

function signRtcToken({ app, tenant, externalUser, room, tokenPayload }) {
  const expiresIn = Math.max(60, Math.min(RTC_TOKEN_TTL_SECONDS, 3600))
  const now = Math.floor(Date.now() / 1000)
  const issuedAt = new Date(now * 1000).toISOString()
  const expiresAt = new Date((now + expiresIn) * 1000).toISOString()
  const tokenId = crypto.randomUUID()

  return {
    token: jwt.sign(
      {
        jti: tokenId,
        sub: externalUser.user_id,
        tenant_id: tenant.id,
        app_id: app.id,
        app_key: app.app_key,
        external_user_id: externalUser.external_user_id,
        room_id: room.id,
        rtc_role: tokenPayload.role,
        permissions: tokenPayload.permissions,
        billing_payer: 'client_company',
        billing_scope: 'client_company',
        user_pays: false,
        token_use: 'rtc_room',
        iat: now,
      },
      process.env.JWT_SECRET,
      { expiresIn }
    ),
    expiresIn,
    tokenId,
    issuedAt,
    expiresAt,
  }
}

async function storeRtcTokenRecord({ app, tenant, externalUser, room, tokenPayload, signed }) {
  const claims = {
    sub: externalUser.user_id,
    tenant_id: tenant.id,
    app_id: app.id,
    app_key: app.app_key,
    external_user_id: externalUser.external_user_id,
    room_id: room.id,
    role: tokenPayload.role,
    permissions: tokenPayload.permissions,
    token_use: 'rtc_room',
    jti: signed.tokenId,
    iat: signed.issuedAt,
    exp: signed.expiresAt,
  }

  await query(
    `
    INSERT INTO rtc_tokens (
      tenant_id, app_id, room_id, user_id, external_user_id,
      token_hash, role, permissions_json, claims_json, issued_at, expires_at, created_at
    )
    VALUES (
      :tenantId, :appId, :roomId, :userId, :externalUserId,
      :tokenHash, :role, :permissionsJson, :claimsJson, :issuedAt, :expiresAt, NOW()
    )
    `,
    {
      tenantId: tenant.id,
      appId: app.id,
      roomId: room.id,
      userId: externalUser.user_id,
      externalUserId: externalUser.external_user_id,
      tokenHash: hashSecret(signed.token),
      role: tokenPayload.role,
      permissionsJson: JSON.stringify(tokenPayload.permissions),
      claimsJson: JSON.stringify(claims),
      issuedAt: new Date(signed.issuedAt),
      expiresAt: new Date(signed.expiresAt),
    }
  )

  await query(
    `
    INSERT INTO usage_daily (
      tenant_id, app_id, usage_date, token_count, created_at, updated_at
    )
    VALUES (:tenantId, :appId, CURRENT_DATE(), 1, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      token_count = token_count + 1,
      updated_at = NOW()
    `,
    { tenantId: tenant.id, appId: app.id }
  )
}

async function queueWebhookEvent(connection, { tenantId, appId = null, eventType, payload = {} }) {
  await connection.execute(
    `
    INSERT INTO webhook_events (
      tenant_id, app_id, event_type, payload_json, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, 'pending', NOW(), NOW())
    `,
    [tenantId, appId, eventType, JSON.stringify(payload)]
  )
}

async function writeClientAuditLog(connection, { tenantId, action, entityType, entityId, metadata = {} }) {
  await connection.execute(
    `
    INSERT INTO audit_logs (
      tenant_id, actor_type, action, entity_type, entity_id, metadata_json, created_at
    )
    VALUES (?, 'client_api', ?, ?, ?, ?, NOW())
    `,
    [tenantId, action, entityType, String(entityId || ''), JSON.stringify(metadata)]
  )
}

async function recordUsageDailySessionStart(connection, { tenantId, appId, sessionStarted, peakConcurrency }) {
  await connection.execute(
    `
    INSERT INTO usage_daily (
      tenant_id, app_id, usage_date, session_count, peak_concurrency, created_at, updated_at
    )
    VALUES (?, ?, CURRENT_DATE(), ?, ?, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      session_count = session_count + VALUES(session_count),
      peak_concurrency = GREATEST(peak_concurrency, VALUES(peak_concurrency)),
      updated_at = NOW()
    `,
    [tenantId, appId, sessionStarted ? 1 : 0, peakConcurrency]
  )
}

async function recordUsageDailySessionEnd(connection, { tenantId, appId, participantMinutes, roomMinutes }) {
  await connection.execute(
    `
    INSERT INTO usage_daily (
      tenant_id, app_id, usage_date, participant_minutes, room_minutes, created_at, updated_at
    )
    VALUES (?, ?, CURRENT_DATE(), ?, ?, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      participant_minutes = participant_minutes + VALUES(participant_minutes),
      room_minutes = room_minutes + VALUES(room_minutes),
      updated_at = NOW()
    `,
    [tenantId, appId, participantMinutes, roomMinutes]
  )
}

function usageTypeFromRoomType(roomType) {
  return ['audio', 'group_audio'].includes(roomType) ? 'audio' : 'video'
}

function roleInRoomFromRtcRole(role, room, externalUser) {
  if (Number(room?.owner_id) === Number(externalUser?.user_id)) return 'owner'
  if (role === 'admin') return 'admin'
  if (role === 'moderator') return 'moderator'
  if (role === 'audience') return 'audience'
  return 'end_user'
}

function parseClientSessionPayload(body = {}) {
  const externalUserId = cleanString(
    readBodyValue(body, 'external_user_id', 'externalUserId')
      || readBodyValue(body, 'uid')
      || readBodyValue(body, 'user_id', 'userId'),
    190
  )
  const roomId = Number(readBodyValue(body, 'room_id', 'roomId'))
  const sessionId = parseInteger(readBodyValue(body, 'session_id', 'sessionId'), null)
  const role = normalizeRtcRole(readBodyValue(body, 'role'))
  const rtcMode = cleanString(readBodyValue(body, 'rtc_mode', 'rtcMode'), 20) || null
  const errors = {}

  if (!externalUserId) errors.external_user_id = 'external_user_id is required.'
  if (!Number.isInteger(roomId) || roomId <= 0) errors.room_id = 'room_id must be a positive integer.'
  if (sessionId !== null && (!Number.isInteger(sessionId) || sessionId <= 0)) errors.session_id = 'session_id must be a positive integer.'

  return {
    errors,
    payload: {
      externalUserId,
      roomId,
      sessionId,
      role,
      rtcMode,
      micEnabled: parseBoolean(readBodyValue(body, 'mic_enabled', 'micEnabled'), true),
      cameraEnabled: parseBoolean(readBodyValue(body, 'camera_enabled', 'cameraEnabled'), true),
      screenShared: parseBoolean(readBodyValue(body, 'screen_shared', 'screenShared'), false),
    },
  }
}

async function startClientRtcSession(clientApp, clientTenant, payload) {
  const [externalUser, room] = await Promise.all([
    getExternalUser(clientApp.id, payload.externalUserId),
    getTokenRoom(clientTenant.id, payload.roomId),
  ])

  if (!externalUser) throw createClientError(404, 'user_not_synced', 'External user was not found. Sync the user before starting a session.')
  if (externalUser.status !== 'active') throw createClientError(403, 'permission_denied', 'External user is not active.')
  if (!room) throw createClientError(404, 'room_not_found', 'Room was not found for this client company.')
  if (room.status !== 'active') throw createClientError(403, 'room_disabled', 'Room is disabled.')

  return transaction(async (connection) => {
    const [activeSessions] = await connection.execute(
      `
      SELECT *
      FROM rtc_sessions
      WHERE room_id = ?
      AND status = 'active'
      ORDER BY id DESC
      LIMIT 1
      `,
      [room.id]
    )

    let session = activeSessions[0]
    let createdSession = false
    const signalingRoom = `webrtc_tenant_${room.tenant_id}_room_${room.id}`

    if (!session) {
      createdSession = true
      const [insertSession] = await connection.execute(
        `
        INSERT INTO rtc_sessions (
          tenant_id, room_id, rtc_provider, signaling_room, session_type,
          started_by, started_at, status, total_duration_seconds,
          total_participant_minutes, created_at, updated_at
        )
        VALUES (?, ?, 'native_webrtc', ?, ?, ?, NOW(), 'active', 0, 0, NOW(), NOW())
        `,
        [room.tenant_id, room.id, signalingRoom, room.room_type, externalUser.user_id]
      )
      const [newSessions] = await connection.execute('SELECT * FROM rtc_sessions WHERE id = ? LIMIT 1', [insertSession.insertId])
      session = newSessions[0]
    }

    const [activeParticipants] = await connection.execute(
      `
      SELECT *
      FROM rtc_session_participants
      WHERE session_id = ?
      AND user_id = ?
      AND left_at IS NULL
      ORDER BY id DESC
      LIMIT 1
      `,
      [session.id, externalUser.user_id]
    )

    const cameraEnabled = room.room_type.includes('video') || room.room_type.includes('live')
      ? payload.cameraEnabled
      : false

    if (activeParticipants.length) {
      await connection.execute(
        `
        UPDATE rtc_session_participants
        SET mic_enabled = ?,
            camera_enabled = ?,
            screen_shared = ?,
            connection_status = 'connected',
            updated_at = NOW()
        WHERE id = ?
        `,
        [payload.micEnabled ? 1 : 0, cameraEnabled ? 1 : 0, payload.screenShared ? 1 : 0, activeParticipants[0].id]
      )
      const [participants] = await connection.execute('SELECT * FROM rtc_session_participants WHERE id = ? LIMIT 1', [activeParticipants[0].id])
      await queueWebhookEvent(connection, {
        tenantId: room.tenant_id,
        appId: clientApp.id,
        eventType: 'participant.reconnected',
        payload: {
          room_id: room.id,
          session_id: session.id,
          external_user_id: externalUser.external_user_id,
          user_id: externalUser.user_id,
        },
      })
      await writeClientAuditLog(connection, {
        tenantId: room.tenant_id,
        action: 'client_api.session.reconnected',
        entityType: 'rtc_session',
        entityId: session.id,
        metadata: { app_id: clientApp.id, room_id: room.id, external_user_id: externalUser.external_user_id },
      })
      return { alreadyStarted: true, session, participant: participants[0], room, externalUser }
    }

    const [activeCountRows] = await connection.execute(
      `
      SELECT COUNT(*) AS active_count
      FROM rtc_session_participants
      WHERE session_id = ?
      AND left_at IS NULL
      `,
      [session.id]
    )
    const activeCount = Number(activeCountRows[0]?.active_count || 0)
    const maxParticipants = Math.max(1, Number(room.max_mic_count || 1))
    if (activeCount >= maxParticipants) throw createClientError(409, 'room_capacity_reached', 'Room is full. Increase the room seat limit or end another participant session.')

    const [insertParticipant] = await connection.execute(
      `
      INSERT INTO rtc_session_participants (
        session_id, room_id, user_id, peer_uid, role_in_room, joined_at,
        duration_seconds, mic_enabled, camera_enabled, screen_shared,
        connection_status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, NOW(), 0, ?, ?, ?, 'connected', NOW(), NOW())
      `,
      [
        session.id,
        room.id,
        externalUser.user_id,
        externalUser.user_id,
        roleInRoomFromRtcRole(payload.role, room, externalUser),
        payload.micEnabled ? 1 : 0,
        cameraEnabled ? 1 : 0,
        payload.screenShared ? 1 : 0,
      ]
    )

    await connection.execute(
      `
      INSERT INTO rtc_events (tenant_id, room_id, session_id, user_id, event_type, event_data, created_at)
      VALUES (?, ?, ?, ?, 'join', ?, NOW())
      `,
      [
        room.tenant_id,
        room.id,
        session.id,
        externalUser.user_id,
        JSON.stringify({
          source: 'client_api',
          app_id: clientApp.id,
          external_user_id: externalUser.external_user_id,
          rtc_mode: payload.rtcMode || room.room_type,
        }),
      ]
    )

    const [participants] = await connection.execute('SELECT * FROM rtc_session_participants WHERE id = ? LIMIT 1', [insertParticipant.insertId])
    const nextConcurrency = activeCount + 1
    await recordUsageDailySessionStart(connection, {
      tenantId: room.tenant_id,
      appId: clientApp.id,
      sessionStarted: createdSession,
      peakConcurrency: nextConcurrency,
    })
    if (createdSession) {
      await queueWebhookEvent(connection, {
        tenantId: room.tenant_id,
        appId: clientApp.id,
        eventType: 'room.started',
        payload: {
          room_id: room.id,
          session_id: session.id,
          signaling_room: signalingRoom,
          room_type: room.room_type,
        },
      })
    }
    await queueWebhookEvent(connection, {
      tenantId: room.tenant_id,
      appId: clientApp.id,
      eventType: 'participant.joined',
      payload: {
        room_id: room.id,
        session_id: session.id,
        participant_id: insertParticipant.insertId,
        external_user_id: externalUser.external_user_id,
        user_id: externalUser.user_id,
        role: payload.role,
      },
    })
    await writeClientAuditLog(connection, {
      tenantId: room.tenant_id,
      action: 'client_api.session.started',
      entityType: 'rtc_session',
      entityId: session.id,
      metadata: {
        app_id: clientApp.id,
        room_id: room.id,
        participant_id: insertParticipant.insertId,
        external_user_id: externalUser.external_user_id,
        peak_concurrency: nextConcurrency,
      },
    })
    return { alreadyStarted: false, session, participant: participants[0], room, externalUser }
  })
}

async function endClientRtcSession(clientApp, clientTenant, payload) {
  const [externalUser, room] = await Promise.all([
    getExternalUser(clientApp.id, payload.externalUserId),
    getTokenRoom(clientTenant.id, payload.roomId),
  ])

  if (!externalUser) throw createClientError(404, 'user_not_synced', 'External user was not found. Sync the user before ending a session.')
  if (!room) throw createClientError(404, 'room_not_found', 'Room was not found for this client company.')

  return transaction(async (connection) => {
    const sessionClause = payload.sessionId ? 'AND p.session_id = ?' : ''
    const params = payload.sessionId
      ? [room.id, externalUser.user_id, payload.sessionId]
      : [room.id, externalUser.user_id]
    const [participants] = await connection.execute(
      `
      SELECT p.*, s.tenant_id, s.started_at
      FROM rtc_session_participants p
      INNER JOIN rtc_sessions s ON s.id = p.session_id
      WHERE p.room_id = ?
      AND p.user_id = ?
      AND p.left_at IS NULL
      ${sessionClause}
      ORDER BY p.id DESC
      LIMIT 1
      FOR UPDATE
      `,
      params
    )
    const participant = participants[0]
    if (!participant) throw createClientError(409, 'permission_denied', 'No active participant session was found for this user and room.')

    const [durationRows] = await connection.execute(
      'SELECT TIMESTAMPDIFF(SECOND, joined_at, NOW()) AS duration_seconds FROM rtc_session_participants WHERE id = ?',
      [participant.id]
    )
    const durationSeconds = Math.max(0, Number(durationRows[0]?.duration_seconds || 0))
    const billableMinutes = Number((durationSeconds / 60).toFixed(2))

    await connection.execute(
      `
      UPDATE rtc_session_participants
      SET left_at = NOW(),
          duration_seconds = ?,
          connection_status = 'disconnected',
          updated_at = NOW()
      WHERE id = ?
      AND left_at IS NULL
      `,
      [durationSeconds, participant.id]
    )

    const [usageInsert] = await connection.execute(
      `
      INSERT INTO usage_logs (
        tenant_id, room_id, session_id, user_id, usage_type,
        started_at, ended_at, duration_seconds, billable_minutes, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, NOW())
      `,
      [
        room.tenant_id,
        room.id,
        participant.session_id,
        externalUser.user_id,
        usageTypeFromRoomType(room.room_type),
        participant.joined_at,
        durationSeconds,
        billableMinutes,
      ]
    )

    await connection.execute(
      `
      INSERT INTO rtc_events (tenant_id, room_id, session_id, user_id, event_type, event_data, created_at)
      VALUES (?, ?, ?, ?, 'leave', ?, NOW())
      `,
      [
        room.tenant_id,
        room.id,
        participant.session_id,
        externalUser.user_id,
        JSON.stringify({
          source: 'client_api',
          app_id: clientApp.id,
          external_user_id: externalUser.external_user_id,
          duration_seconds: durationSeconds,
          billable_minutes: billableMinutes,
        }),
      ]
    )

    const [activeCountRows] = await connection.execute(
      'SELECT COUNT(*) AS active_count FROM rtc_session_participants WHERE session_id = ? AND left_at IS NULL',
      [participant.session_id]
    )
    const [totalRows] = await connection.execute(
      'SELECT COALESCE(SUM(duration_seconds), 0) AS total_seconds FROM rtc_session_participants WHERE session_id = ? AND left_at IS NOT NULL',
      [participant.session_id]
    )
    const activeCount = Number(activeCountRows[0]?.active_count || 0)
    const totalParticipantMinutes = Number((Number(totalRows[0]?.total_seconds || 0) / 60).toFixed(2))
    let roomMinutes = 0

    if (activeCount === 0) {
      const [sessionDurationRows] = await connection.execute(
        'SELECT TIMESTAMPDIFF(SECOND, started_at, NOW()) AS room_seconds FROM rtc_sessions WHERE id = ?',
        [participant.session_id]
      )
      roomMinutes = Number((Math.max(0, Number(sessionDurationRows[0]?.room_seconds || 0)) / 60).toFixed(2))
      await connection.execute(
        `
        UPDATE rtc_sessions
        SET status = 'ended',
            ended_at = NOW(),
            total_participant_minutes = ?,
            total_duration_seconds = TIMESTAMPDIFF(SECOND, started_at, NOW()),
            updated_at = NOW()
        WHERE id = ?
        `,
        [totalParticipantMinutes, participant.session_id]
      )
    } else {
      await connection.execute(
        `
        UPDATE rtc_sessions
        SET total_participant_minutes = ?,
            updated_at = NOW()
        WHERE id = ?
        `,
        [totalParticipantMinutes, participant.session_id]
      )
    }

    await recordUsageDailySessionEnd(connection, {
      tenantId: room.tenant_id,
      appId: clientApp.id,
      participantMinutes: billableMinutes,
      roomMinutes,
    })
    await queueWebhookEvent(connection, {
      tenantId: room.tenant_id,
      appId: clientApp.id,
      eventType: 'participant.left',
      payload: {
        room_id: room.id,
        session_id: participant.session_id,
        participant_id: participant.id,
        external_user_id: externalUser.external_user_id,
        user_id: externalUser.user_id,
        duration_seconds: durationSeconds,
        billable_minutes: billableMinutes,
      },
    })
    await queueWebhookEvent(connection, {
      tenantId: room.tenant_id,
      appId: clientApp.id,
      eventType: 'usage.updated',
      payload: {
        room_id: room.id,
        session_id: participant.session_id,
        usage_log_id: usageInsert.insertId,
        participant_minutes: billableMinutes,
        room_minutes: roomMinutes,
        active_participants: activeCount,
      },
    })
    if (activeCount === 0) {
      await queueWebhookEvent(connection, {
        tenantId: room.tenant_id,
        appId: clientApp.id,
        eventType: 'room.ended',
        payload: {
          room_id: room.id,
          session_id: participant.session_id,
          room_minutes: roomMinutes,
          participant_minutes: totalParticipantMinutes,
        },
      })
    }
    await writeClientAuditLog(connection, {
      tenantId: room.tenant_id,
      action: 'client_api.session.ended',
      entityType: 'rtc_session',
      entityId: participant.session_id,
      metadata: {
        app_id: clientApp.id,
        room_id: room.id,
        usage_log_id: usageInsert.insertId,
        external_user_id: externalUser.external_user_id,
        billable_minutes: billableMinutes,
        active_participants: activeCount,
      },
    })

    return {
      room,
      externalUser,
      session_id: participant.session_id,
      participant_id: participant.id,
      usage_log_id: usageInsert.insertId,
      duration_seconds: durationSeconds,
      billable_minutes: billableMinutes,
      room_minutes: roomMinutes,
      active_participants: activeCount,
    }
  })
}

router.use(clientApiAuth)

router.get('/me', (req, res) => {
  return res.json({
    tenant: req.clientTenant,
    app: req.clientApp,
    billing: clientBillingPolicy(req.clientTenant),
    auth: 'api_key',
  })
})

router.post('/users/sync', async (req, res, next) => {
  try {
    const { errors, payload } = parseExternalUserPayload(req.body || {})
    if (Object.keys(errors).length) {
      return res.status(422).json({ message: 'Check external user payload.', errors })
    }

    const externalUser = await transaction(async (connection) => {
      const [existingMappings] = await connection.execute(
        `
        SELECT *
        FROM client_external_users
        WHERE app_id = ?
        AND external_user_id = ?
        LIMIT 1
        `,
        [req.clientApp.id, payload.externalUserId]
      )
      const existingMapping = existingMappings[0]
      const userId = await findOrCreateShadowUser(
        connection,
        req.clientTenant.id,
        payload,
        existingMapping?.user_id || null
      )
      const metadataJson = payload.metadata ? JSON.stringify(payload.metadata) : null

      if (existingMapping) {
        await connection.execute(
          `
          UPDATE client_external_users
          SET user_id = ?,
              display_name = ?,
              avatar_url = ?,
              email = ?,
              phone = ?,
              billing_scope = 'client_company',
              user_pays = 0,
              metadata_json = ?,
              status = ?,
              last_synced_at = NOW(),
              updated_at = NOW()
          WHERE id = ?
          `,
          [
            userId,
            payload.name,
            payload.avatarUrl,
            payload.email,
            payload.phone,
            metadataJson,
            payload.status,
            existingMapping.id,
          ]
        )
      } else {
        await connection.execute(
          `
          INSERT INTO client_external_users (
            tenant_id, app_id, user_id, external_user_id, display_name,
            avatar_url, email, phone, billing_scope, user_pays, metadata_json, status,
            last_synced_at, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'client_company', 0, ?, ?, NOW(), NOW(), NOW())
          `,
          [
            req.clientTenant.id,
            req.clientApp.id,
            userId,
            payload.externalUserId,
            payload.name,
            payload.avatarUrl,
            payload.email,
            payload.phone,
            metadataJson,
            payload.status,
          ]
        )
      }

      const [rows] = await connection.execute(
        `
        SELECT *
        FROM client_external_users
        WHERE app_id = ?
        AND external_user_id = ?
        LIMIT 1
        `,
        [req.clientApp.id, payload.externalUserId]
      )
      if (!rows.length) throw createHttpError(500, 'External user sync failed.')
      return formatExternalUser(rows[0])
    })

    return res.status(200).json({
      message: 'External user synced.',
      external_user: externalUser,
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/rooms', async (req, res, next) => {
  try {
    const options = parseRoomListOptions(req.query || {})
    if (Object.keys(options.errors).length) {
      return res.status(422).json({ message: 'Check room filters.', errors: options.errors })
    }

    const where = ['r.tenant_id = :tenantId']
    const offset = (options.page - 1) * options.perPage
    const params = {
      appId: req.clientApp.id,
      tenantId: req.clientTenant.id,
    }

    if (options.status !== 'all') {
      where.push('r.status = :status')
      params.status = options.status
    }
    if (options.privacyType !== 'all') {
      where.push('r.privacy_type = :privacyType')
      params.privacyType = options.privacyType
    }
    if (options.roomType !== 'all') {
      where.push('r.room_type = :roomType')
      params.roomType = options.roomType
    }
    if (options.search) {
      where.push('(r.name LIKE :search OR r.description LIKE :search OR CAST(r.id AS CHAR) LIKE :search)')
      params.search = `%${options.search}%`
    }

    const whereSql = where.join(' AND ')
    const [rooms, countRows] = await Promise.all([
      query(
        `
        ${clientRoomSelectSql()}
        WHERE ${whereSql}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ${options.perPage} OFFSET ${offset}
        `,
        params
      ),
      query(
        `
        SELECT COUNT(*) AS total
        FROM rooms r
        WHERE ${whereSql}
        `,
        params
      ),
    ])

    const total = Number(countRows[0]?.total || 0)

    return res.json({
      rooms: rooms.map(formatClientRoom),
      pagination: {
        page: options.page,
        per_page: options.perPage,
        total,
        total_pages: Math.max(1, Math.ceil(total / options.perPage)),
      },
      filters: {
        status: options.status,
        privacy_type: options.privacyType,
        room_type: options.roomType,
        search: options.search,
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/rooms', async (req, res, next) => {
  try {
    const { errors, payload } = parseClientRoomPayload(req.body || {})
    if (Object.keys(errors).length) {
      return clientError(res, 422, 'permission_denied', 'Check room details.', { errors })
    }

    const externalUser = await getExternalUser(req.clientApp.id, payload.externalUserId)
    if (!externalUser) {
      return clientError(res, 404, 'user_not_synced', 'External owner was not found. Sync the user before creating a room.')
    }
    if (externalUser.status !== 'active') {
      return clientError(res, 403, 'permission_denied', 'External owner is not active.')
    }

    const passwordHash = payload.password ? await bcrypt.hash(payload.password, 10) : null
    const roomId = await transaction(async (connection) => {
      const [insertResult] = await connection.execute(
        `
        INSERT INTO rooms (
          tenant_id, owner_id, name, description, profile_image, room_type,
          privacy_type, password_hash, max_mic_count, theme,
          chat_enabled, gift_enabled, screen_share_enabled, ai_security_enabled,
          status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())
        `,
        [
          req.clientTenant.id,
          externalUser.user_id,
          payload.name,
          payload.description,
          payload.profileImage,
          payload.roomType,
          payload.privacyType,
          passwordHash,
          payload.maxMicCount,
          payload.theme,
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
        [insertResult.insertId, externalUser.user_id]
      )

      return insertResult.insertId
    })

    const room = await getClientRoom(req.clientApp.id, req.clientTenant.id, roomId)

    return res.status(201).json({
      message: 'Room created.',
      room,
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/rooms/:roomId', async (req, res, next) => {
  try {
    const roomId = parseInteger(req.params.roomId, null)
    if (!roomId || roomId < 1) return clientError(res, 422, 'room_not_found', 'Invalid room ID.')

    const room = await getClientRoom(req.clientApp.id, req.clientTenant.id, roomId)
    if (!room) return clientError(res, 404, 'room_not_found', 'Room was not found for this client company.')

    return res.json({ room })
  } catch (error) {
    return next(error)
  }
})

router.patch('/rooms/:roomId', async (req, res, next) => {
  try {
    const roomId = parseInteger(req.params.roomId, null)
    if (!roomId || roomId < 1) return clientError(res, 422, 'room_not_found', 'Invalid room ID.')

    await transaction(async (connection) => {
      const [rooms] = await connection.execute(
        `
        SELECT *
        FROM rooms
        WHERE tenant_id = ?
        AND id = ?
        LIMIT 1
        `,
        [req.clientTenant.id, roomId]
      )
      const room = rooms[0]

      if (!room) throw createClientError(404, 'room_not_found', 'Room was not found for this client company.')
      if (room.status === 'ended') throw createClientError(422, 'room_disabled', 'Ended rooms cannot be updated.')

      const { errors, updates, values } = await buildClientRoomUpdate(room, req.body || {})
      if (Object.keys(errors).length) {
        const error = createHttpError(422, 'Check room update details.')
        error.errors = errors
        throw error
      }

      if (!updates.length) return room

      await connection.execute(
        `
        UPDATE rooms
        SET ${updates.join(', ')},
            updated_at = NOW()
        WHERE tenant_id = ?
        AND id = ?
        `,
        [...values, req.clientTenant.id, roomId]
      )

      return room
    })

    const room = await getClientRoom(req.clientApp.id, req.clientTenant.id, roomId)

    return res.json({
      message: 'Room updated.',
      room,
    })
  } catch (error) {
    return next(error)
  }
})

router.patch('/rooms/:roomId/status', async (req, res, next) => {
  try {
    const roomId = parseInteger(req.params.roomId, null)
    const status = cleanString(readBodyValue(req.body || {}, 'status'), 30).toLowerCase()
    if (!roomId || roomId < 1) return clientError(res, 422, 'room_not_found', 'Invalid room ID.')
    if (!CLIENT_ROOM_STATUSES.has(status)) return clientError(res, 422, 'permission_denied', 'Choose active, inactive, or ended room status.')

    await setClientRoomStatus(req.clientTenant.id, roomId, normalizeClientRoomStatus(status), req.clientApp.id)
    const room = await getClientRoom(req.clientApp.id, req.clientTenant.id, roomId)

    return res.json({
      message: status === 'active' ? 'Room is active.' : 'Room availability updated.',
      room,
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/rooms/:roomId/disable', async (req, res, next) => {
  try {
    const roomId = parseInteger(req.params.roomId, null)
    if (!roomId || roomId < 1) return clientError(res, 422, 'room_not_found', 'Invalid room ID.')

    await setClientRoomStatus(req.clientTenant.id, roomId, 'inactive', req.clientApp.id)
    const room = await getClientRoom(req.clientApp.id, req.clientTenant.id, roomId)

    return res.json({
      message: 'Room disabled.',
      room,
    })
  } catch (error) {
    return next(error)
  }
})

router.delete('/rooms/:roomId', async (req, res, next) => {
  try {
    const roomId = parseInteger(req.params.roomId, null)
    if (!roomId || roomId < 1) return clientError(res, 422, 'room_not_found', 'Invalid room ID.')

    await setClientRoomStatus(req.clientTenant.id, roomId, 'ended', req.clientApp.id)

    return res.json({
      message: 'Room ended. Usage history is preserved.',
      room_id: roomId,
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/rtc/token', async (req, res, next) => {
  try {
    const { errors, payload } = parseRtcTokenPayload(req.body || {})
    if (Object.keys(errors).length) {
      return clientError(res, 422, 'permission_denied', 'Check RTC token payload.', { errors })
    }

    const [externalUser, room] = await Promise.all([
      getExternalUser(req.clientApp.id, payload.externalUserId),
      getTokenRoom(req.clientTenant.id, payload.roomId),
    ])

    if (!externalUser) {
      return clientError(res, 404, 'user_not_synced', 'External user was not found. Sync the user before requesting an RTC token.')
    }
    if (externalUser.status !== 'active') {
      return clientError(res, 403, 'permission_denied', 'External user is not active.')
    }
    if (!room) {
      return clientError(res, 404, 'room_not_found', 'Room was not found for this client company.')
    }
    if (room.status !== 'active') {
      return clientError(res, 403, 'room_disabled', 'Room is disabled.')
    }

    const signed = signRtcToken({
      app: req.clientApp,
      tenant: req.clientTenant,
      externalUser,
      room,
      tokenPayload: payload,
    })
    await storeRtcTokenRecord({
      app: req.clientApp,
      tenant: req.clientTenant,
      externalUser,
      room,
      tokenPayload: payload,
      signed,
    })

    return res.json({
      message: 'RTC token issued.',
      token_type: 'Bearer',
      rtc_token: signed.token,
      expires_in: signed.expiresIn,
      expires_at: signed.expiresAt,
      billing: clientBillingPolicy(req.clientTenant),
      external_user: {
        external_user_id: externalUser.external_user_id,
        user_id: externalUser.user_id,
        name: externalUser.name,
        avatar_url: externalUser.avatar_url,
        user_pays: false,
        billing_scope: 'client_company',
      },
      room: {
        id: room.id,
        tenant_id: room.tenant_id,
        billing: clientBillingPolicy(req.clientTenant),
        name: room.name,
        room_type: room.room_type,
        privacy_type: room.privacy_type,
        signaling_room: `webrtc_tenant_${room.tenant_id}_room_${room.id}`,
        controls: {
          chat_enabled: Boolean(Number(room.chat_enabled)),
          gift_enabled: Boolean(Number(room.gift_enabled)),
          screen_share_enabled: Boolean(Number(room.screen_share_enabled)),
          ai_security_enabled: Boolean(Number(room.ai_security_enabled)),
        },
      },
      grants: {
        role: payload.role,
        permissions: payload.permissions,
        room_id: room.id,
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/rtc/session/start', async (req, res, next) => {
  try {
    const { errors, payload } = parseClientSessionPayload(req.body || {})
    if (Object.keys(errors).length) {
      return clientError(res, 422, 'permission_denied', 'Check RTC session payload.', { errors })
    }

    const result = await startClientRtcSession(req.clientApp, req.clientTenant, payload)

    return res.status(result.alreadyStarted ? 200 : 201).json({
      message: result.alreadyStarted ? 'RTC session already active.' : 'RTC session started.',
      billing: clientBillingPolicy(req.clientTenant),
      session: result.session,
      participant: result.participant,
      room: {
        id: result.room.id,
        tenant_id: result.room.tenant_id,
        billing: clientBillingPolicy(req.clientTenant),
        name: result.room.name,
        room_type: result.room.room_type,
        signaling_room: `webrtc_tenant_${result.room.tenant_id}_room_${result.room.id}`,
      },
      external_user: {
        external_user_id: result.externalUser.external_user_id,
        user_id: result.externalUser.user_id,
        name: result.externalUser.name,
        user_pays: false,
        billing_scope: 'client_company',
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/rtc/session/end', async (req, res, next) => {
  try {
    const { errors, payload } = parseClientSessionPayload(req.body || {})
    if (Object.keys(errors).length) {
      return clientError(res, 422, 'permission_denied', 'Check RTC session payload.', { errors })
    }

    const result = await endClientRtcSession(req.clientApp, req.clientTenant, payload)

    return res.json({
      message: 'RTC session ended.',
      session_id: result.session_id,
      participant_id: result.participant_id,
      usage_log_id: result.usage_log_id,
      duration_seconds: result.duration_seconds,
      billable_minutes: result.billable_minutes,
      room_minutes: result.room_minutes,
      billing: clientBillingPolicy(req.clientTenant),
      active_participants: result.active_participants,
      room: {
        id: result.room.id,
        tenant_id: result.room.tenant_id,
        billing: clientBillingPolicy(req.clientTenant),
        name: result.room.name,
        room_type: result.room.room_type,
      },
      external_user: {
        external_user_id: result.externalUser.external_user_id,
        user_id: result.externalUser.user_id,
        name: result.externalUser.name,
        user_pays: false,
        billing_scope: 'client_company',
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/users/:externalUserId', async (req, res, next) => {
  try {
    const externalUserId = cleanString(req.params.externalUserId, 190)
    const externalUser = await getExternalUser(req.clientApp.id, externalUserId)
    if (!externalUser) return clientError(res, 404, 'user_not_synced', 'External user was not found.')
    return res.json({ external_user: externalUser })
  } catch (error) {
    return next(error)
  }
})

router.use((error, req, res, next) => {
  const payload = {
    code: error.code || 'client_api_error',
    message: error.message || 'Client API error',
  }
  if (error.errors) payload.errors = error.errors
  return res.status(error.status || 500).json(payload)
})

module.exports = router
