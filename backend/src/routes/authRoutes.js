const express = require('express')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const { query, transaction } = require('../config/db')
const { verifyPassword } = require('../utils/password')
const { sendVerificationEmail } = require('../utils/email')
const { authMiddleware } = require('../middleware/auth')

const router = express.Router()
const VERIFICATION_CODE_TTL_MINUTES = 15
const MAX_VERIFICATION_ATTEMPTS = 5
const MAX_AVATAR_DATA_URL_LENGTH = 650000
const SUPERADMIN_TENANT_ID = 1
const SUPERADMIN_EMAIL = 'superadmin@chadnichok.com'
const LEGACY_SUPERADMIN_EMAIL = 'superadmin@talkeachother.com'
const validGenderValues = new Set(['male', 'female', 'non_binary', 'prefer_not_to_say'])
const avatarDataUrlPattern = /^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i
let authSchemaPromise = null

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function validateEmail(value) {
  const email = normalizeEmail(value)
  const emailPattern = /^[^\s@]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i
  return emailPattern.test(email)
}

function validateStrongPassword(value) {
  const password = String(value || '')
  return password.length >= 10
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password)
}

function normalizeGender(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeAge(value) {
  if (value === undefined || value === null || value === '') return null
  const age = Number(value)
  return Number.isInteger(age) ? age : null
}

function normalizeDate(value) {
  const date = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ''
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return ''
  if (parsed.toISOString().slice(0, 10) !== date) return ''
  return date
}

function normalizeResidence(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120)
}

function normalizeAvatarUrl(value) {
  if (value === undefined) return { hasValue: false, value: null }

  const text = String(value || '').trim()
  if (!text) return { hasValue: true, value: null }

  if (/^https?:\/\//i.test(text)) {
    if (text.length > 2000) {
      return { hasValue: true, error: 'Profile photo URL is too long.' }
    }
    return { hasValue: true, value: text }
  }

  const compactDataUrl = text.replace(/\s+/g, '')
  if (!avatarDataUrlPattern.test(compactDataUrl)) {
    return { hasValue: true, error: 'Choose a PNG, JPG, or WebP profile photo.' }
  }
  if (compactDataUrl.length > MAX_AVATAR_DATA_URL_LENGTH) {
    return { hasValue: true, error: 'Profile photo is too large. Choose a smaller photo.' }
  }

  return { hasValue: true, value: compactDataUrl }
}

function ageFromBirthday(value) {
  const birthday = normalizeDate(value)
  if (!birthday) return null

  const date = new Date(`${birthday}T00:00:00.000Z`)
  const today = new Date()
  let age = today.getUTCFullYear() - date.getUTCFullYear()
  const monthDiff = today.getUTCMonth() - date.getUTCMonth()
  const dayDiff = today.getUTCDate() - date.getUTCDate()
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1
  return age
}

function formatDateOnly(value) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  const text = String(value)
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text
}

function createHttpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

async function ensureAuthSchema() {
  if (!authSchemaPromise) {
    authSchemaPromise = (async () => {
      await addColumnIfMissing('users', 'avatar_url', 'ALTER TABLE users ADD COLUMN avatar_url MEDIUMTEXT NULL AFTER password_hash')
      await addColumnIfMissing('users', 'gender', 'ALTER TABLE users ADD COLUMN gender VARCHAR(30) NULL AFTER avatar_url')
      await addColumnIfMissing('users', 'age', 'ALTER TABLE users ADD COLUMN age INT UNSIGNED NULL AFTER gender')
      await addColumnIfMissing('users', 'birthday', 'ALTER TABLE users ADD COLUMN birthday DATE NULL AFTER age')
      await addColumnIfMissing('users', 'current_residence', 'ALTER TABLE users ADD COLUMN current_residence VARCHAR(120) NULL AFTER birthday')
      await query('ALTER TABLE users MODIFY COLUMN avatar_url MEDIUMTEXT NULL')

      await query(
        "ALTER TABLE users MODIFY COLUMN status ENUM('pending_verification', 'active', 'inactive', 'banned') DEFAULT 'active'"
      )

      await migrateLegacySuperadminEmail()

      await query(
        `
        CREATE TABLE IF NOT EXISTS email_verification_codes (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          user_id BIGINT UNSIGNED NOT NULL,
          email VARCHAR(180) NOT NULL,
          code_hash VARCHAR(255) NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          used_at TIMESTAMP NULL,
          attempt_count INT DEFAULT 0,
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_email_verification_user_id (user_id),
          INDEX idx_email_verification_email (email),
          INDEX idx_email_verification_expires_at (expires_at),
          CONSTRAINT fk_email_verification_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        `
      )
    })().catch((error) => {
      authSchemaPromise = null
      throw error
    })
  }

  return authSchemaPromise
}

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

function generateVerificationCode() {
  return String(crypto.randomInt(100000, 1000000))
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

  if (!roles.length) throw createHttpError(500, 'End user role is missing from the database.')
  return roles[0].id
}

async function createVerificationCode(connection, userId, email) {
  const code = generateVerificationCode()
  const codeHash = await bcrypt.hash(code, 10)

  await connection.execute(
    `
    UPDATE email_verification_codes
    SET used_at = NOW()
    WHERE user_id = ?
    AND used_at IS NULL
    `,
    [userId]
  )

  await connection.execute(
    `
    INSERT INTO email_verification_codes (
      user_id,
      email,
      code_hash,
      expires_at,
      created_at
    )
    VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), NOW())
    `,
    [userId, email, codeHash, VERIFICATION_CODE_TTL_MINUTES]
  )

  return code
}

function verificationDeliveryPayload(delivery) {
  if (!delivery) return null

  return {
    provider: delivery.provider || 'unknown',
    skipped: Boolean(delivery.skipped),
  }
}

function verificationResponse({ message, email, delivery }) {
  const response = {
    message,
    requires_verification: true,
    email,
  }
  const emailDelivery = verificationDeliveryPayload(delivery)

  if (emailDelivery) response.email_delivery = emailDelivery
  if (delivery?.verification_code) response.verification_code = delivery.verification_code

  return response
}

function classifyEmailDeliveryError(error) {
  const rawMessage = String(error?.message || '')
  const invalidKey = error.code === 'email_provider_invalid_key'
    || /api key is invalid/i.test(rawMessage)
    || /"statusCode"\s*:\s*401/i.test(rawMessage)
  const setupRequired = error.code === 'email_not_configured'
  const providerRejected = invalidKey
    || error.code === 'email_provider_rejected'
    || /validation_error|resend email failed|provider rejected/i.test(rawMessage)

  if (setupRequired) {
    return {
      code: 'email_not_configured',
      message: 'Verification code was created, but email delivery is not connected yet. Add email settings on the server, then request a new code.',
      providerRejected: false,
      setupRequired: true,
    }
  }

  if (invalidKey) {
    return {
      code: 'email_provider_invalid_key',
      message: 'Verification code was created, but the email provider rejected the API key. Add a valid email API key on the server, then request a new code.',
      providerRejected: true,
      setupRequired: false,
    }
  }

  if (providerRejected) {
    return {
      code: 'email_provider_rejected',
      message: 'Verification code was created, but the email provider rejected the request. Check the sender domain/settings, then request a new code.',
      providerRejected: true,
      setupRequired: false,
    }
  }

  return {
    code: error.code || 'failed',
    message: 'Verification code was created, but email delivery failed. Check the email provider settings, then request a new code.',
    providerRejected: false,
    setupRequired: false,
  }
}

function emailDeliveryFailureResponse(res, error, email) {
  const status = error.status || 502
  const deliveryError = classifyEmailDeliveryError(error)

  return res.status(status).json({
    message: deliveryError.message,
    requires_verification: true,
    email,
    email_delivery: {
      provider: deliveryError.code,
      skipped: false,
      setup_required: deliveryError.setupRequired,
      provider_rejected: deliveryError.providerRejected,
    },
  })
}

function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      tenant_id: user.tenant_id,
      email: user.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  )
}

async function loginResponse(user, message = 'Login successful') {
  await query(
    `
    UPDATE users
    SET last_login_at = NOW()
    WHERE id = :id
    `,
    { id: user.id }
  )

  const refreshedUsers = await query(
    `
    SELECT *
    FROM users
    WHERE id = :id
    LIMIT 1
    `,
    { id: user.id }
  )
  const refreshedUser = refreshedUsers[0] || user
  const roles = await getUserRoles(refreshedUser.id)
  const accessToken = signAccessToken(refreshedUser)

  return {
    message,
    token_type: 'Bearer',
    access_token: accessToken,
    user: formatUser(refreshedUser, roles),
  }
}

function formatUser(user, roles = []) {
  return {
    id: user.id,
    tenant_id: user.tenant_id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    avatar_url: user.avatar_url,
    gender: user.gender,
    age: user.age === null || user.age === undefined ? null : Number(user.age),
    birthday: formatDateOnly(user.birthday),
    current_residence: user.current_residence,
    status: user.status,
    last_login_at: user.last_login_at,
    roles,
  }
}

async function getUserRoles(userId) {
  return query(
    `
    SELECT roles.id, roles.name, roles.label
    FROM user_roles
    JOIN roles ON roles.id = user_roles.role_id
    WHERE user_roles.user_id = :userId
    `,
    { userId }
  )
}

async function migrateLegacySuperadminEmail() {
  const legacyUsers = await query(
    `
    SELECT id
    FROM users
    WHERE tenant_id = :tenantId
    AND email = :legacyEmail
    LIMIT 1
    `,
    { tenantId: SUPERADMIN_TENANT_ID, legacyEmail: LEGACY_SUPERADMIN_EMAIL }
  )
  const legacyUser = legacyUsers[0]
  if (!legacyUser) return

  const currentUsers = await query(
    `
    SELECT id
    FROM users
    WHERE tenant_id = :tenantId
    AND email = :currentEmail
    LIMIT 1
    `,
    { tenantId: SUPERADMIN_TENANT_ID, currentEmail: SUPERADMIN_EMAIL }
  )
  const currentUser = currentUsers[0]

  if (!currentUser) {
    await query(
      `
      UPDATE users
      SET email = :currentEmail,
          name = 'TalkEachOther Super Admin',
          status = 'active',
          updated_at = NOW()
      WHERE id = :legacyId
      `,
      { currentEmail: SUPERADMIN_EMAIL, legacyId: legacyUser.id }
    )
    return
  }

  if (currentUser.id === legacyUser.id) return

  await query(
    `
    UPDATE users
    SET email = :archivedEmail,
        status = 'inactive',
        updated_at = NOW()
    WHERE id = :legacyId
    `,
    {
      archivedEmail: `legacy-${legacyUser.id}-${LEGACY_SUPERADMIN_EMAIL}`,
      legacyId: legacyUser.id,
    }
  )

  await query(
    `
    DELETE user_roles
    FROM user_roles
    INNER JOIN roles ON roles.id = user_roles.role_id
    WHERE user_roles.user_id = :legacyId
    AND roles.name IN ('client_admin', 'super_admin')
    `,
    { legacyId: legacyUser.id }
  )

  await query(
    `
    UPDATE users
    SET name = 'TalkEachOther Super Admin',
        status = 'active',
        updated_at = NOW()
    WHERE id = :currentId
    `,
    { currentId: currentUser.id }
  )
}

router.post('/login', async (req, res, next) => {
  try {
    await ensureAuthSchema()

    const email = normalizeEmail(req.body?.email)
    const password = String(req.body?.password || '')

    if (!email || !password) {
      return res.status(422).json({ message: 'Email and password are required.' })
    }

    if (!validateEmail(email)) {
      return res.status(422).json({ message: 'Enter a valid email address.' })
    }

    const users = await query(
      `
      SELECT *
      FROM users
      WHERE email = :email
      LIMIT 1
      `,
      { email }
    )

    const user = users[0]

    if (!user) {
      return res.status(422).json({ message: 'Invalid email or password.' })
    }

    const passwordOk = await verifyPassword(password, user.password_hash)

    if (!passwordOk) {
      return res.status(422).json({ message: 'Invalid email or password.' })
    }

    if (user.status === 'pending_verification') {
      return res.status(403).json({
        message: 'Please verify your email before logging in.',
        requires_verification: true,
        email: user.email,
      })
    }

    if (user.status !== 'active') {
      return res.status(403).json({ message: 'Your account is not active.' })
    }

    return res.json(await loginResponse(user))
  } catch (error) {
    next(error)
  }
})

router.post('/register', async (req, res, next) => {
  try {
    await ensureAuthSchema()

    const name = String(req.body?.name || '').trim()
    const gender = normalizeGender(req.body?.gender)
    const age = normalizeAge(req.body?.age)
    const birthday = normalizeDate(req.body?.birthday)
    const currentResidence = normalizeResidence(req.body?.current_residence || req.body?.currentResidence)
    const email = normalizeEmail(req.body?.email)
    const password = String(req.body?.password || '')

    if (!name || !email || !password) {
      return res.status(422).json({
        message: 'Name, email, and password are required.',
      })
    }

    if (name.length < 2) {
      return res.status(422).json({ message: 'Name must be at least 2 characters.' })
    }

    if (gender && !validGenderValues.has(gender)) {
      return res.status(422).json({ message: 'Choose a valid gender option.' })
    }

    if (age !== null && (age < 13 || age > 120)) {
      return res.status(422).json({ message: 'Age must be between 13 and 120.' })
    }

    if (currentResidence && currentResidence.length < 2) {
      return res.status(422).json({ message: 'Current residence country is required.' })
    }

    if (birthday) {
      const birthdayAge = ageFromBirthday(birthday)
      if (birthdayAge === null || birthdayAge < 13 || birthdayAge > 120) {
        return res.status(422).json({ message: 'Choose a valid birthday for a user age between 13 and 120.' })
      }
    }

    if (!validateEmail(email)) {
      return res.status(422).json({ message: 'Use a valid Gmail, Outlook, Hotmail, or company email address.' })
    }

    if (!validateStrongPassword(password)) {
      return res.status(422).json({
        message: 'Password must be at least 10 characters and include uppercase, lowercase, number, and symbol.',
      })
    }

    const existing = await query(
      `
      SELECT *
      FROM users
      WHERE tenant_id = 1
      AND email = :email
      LIMIT 1
      `,
      { email }
    )

    if (existing.length && existing[0].status !== 'pending_verification') {
      return res.status(409).json({ message: 'Email already exists.' })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    let userId = existing[0]?.id || null

    const code = await transaction(async (connection) => {
      if (userId) {
        await connection.execute(
          `
          UPDATE users
          SET name = ?,
              gender = ?,
              age = ?,
              birthday = ?,
              current_residence = ?,
              password_hash = ?,
              status = 'pending_verification',
              updated_at = NOW()
          WHERE id = ?
          `,
          [name, gender || null, age, birthday || null, currentResidence || null, passwordHash, userId]
        )
      } else {
        const [result] = await connection.execute(
          `
          INSERT INTO users (
            tenant_id,
            name,
            email,
            gender,
            age,
            birthday,
            current_residence,
            password_hash,
            status,
            created_at,
            updated_at
          )
          VALUES (
            1,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            'pending_verification',
            NOW(),
            NOW()
          )
          `,
          [name, email, gender || null, age, birthday || null, currentResidence || null, passwordHash]
        )

        userId = result.insertId
      }

      const roleId = await getEndUserRoleId(connection)
      await connection.execute(
        `
        INSERT INTO user_roles (user_id, role_id, tenant_id, created_at)
        SELECT ?, ?, 1, NOW()
        WHERE NOT EXISTS (
          SELECT 1
          FROM user_roles
          WHERE user_id = ?
          AND role_id = ?
          AND tenant_id = 1
        )
        `,
        [userId, roleId, userId, roleId]
      )

      return createVerificationCode(connection, userId, email)
    })

    let delivery
    try {
      delivery = await sendVerificationEmail({ to: email, name, code })
    } catch (error) {
      return emailDeliveryFailureResponse(res, error, email)
    }

    return res.status(201).json(verificationResponse({
      message: 'Verification code sent. Check your email inbox to finish signup.',
      email,
      delivery,
    }))
  } catch (error) {
    next(error)
  }
})

router.post('/verify-email', async (req, res, next) => {
  try {
    await ensureAuthSchema()

    const email = normalizeEmail(req.body?.email)
    const code = String(req.body?.code || '').replace(/\D/g, '').slice(0, 6)

    if (!validateEmail(email) || code.length !== 6) {
      return res.status(422).json({ message: 'Enter a valid email and 6-digit verification code.' })
    }

    const rows = await query(
      `
      SELECT
        verification.id AS verification_id,
        verification.code_hash,
        verification.expires_at,
        verification.attempt_count,
        users.*
      FROM email_verification_codes verification
      JOIN users ON users.id = verification.user_id
      WHERE verification.email = :email
      AND verification.used_at IS NULL
      ORDER BY verification.created_at DESC, verification.id DESC
      LIMIT 1
      `,
      { email }
    )

    const verification = rows[0]
    if (!verification || verification.status !== 'pending_verification') {
      return res.status(422).json({ message: 'No pending verification was found for this email.' })
    }

    if (Number(verification.attempt_count || 0) >= MAX_VERIFICATION_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many verification attempts. Request a new code.' })
    }

    if (new Date(verification.expires_at).getTime() < Date.now()) {
      return res.status(422).json({ message: 'Verification code expired. Request a new code.' })
    }

    const codeOk = await bcrypt.compare(code, verification.code_hash)
    if (!codeOk) {
      await query(
        `
        UPDATE email_verification_codes
        SET attempt_count = attempt_count + 1
        WHERE id = :id
        `,
        { id: verification.verification_id }
      )

      return res.status(422).json({ message: 'Verification code is incorrect.' })
    }

    await transaction(async (connection) => {
      await connection.execute(
        `
        UPDATE users
        SET status = 'active',
            updated_at = NOW()
        WHERE id = ?
        `,
        [verification.id]
      )

      await connection.execute(
        `
        UPDATE email_verification_codes
        SET used_at = NOW()
        WHERE id = ?
        `,
        [verification.verification_id]
      )
    })

    return res.json(await loginResponse({ ...verification, status: 'active' }, 'Email verified successfully'))
  } catch (error) {
    next(error)
  }
})

router.post('/resend-verification', async (req, res, next) => {
  try {
    await ensureAuthSchema()

    const email = normalizeEmail(req.body?.email)
    if (!validateEmail(email)) return res.status(422).json({ message: 'Enter a valid email address.' })

    const users = await query(
      `
      SELECT *
      FROM users
      WHERE email = :email
      AND status = 'pending_verification'
      LIMIT 1
      `,
      { email }
    )

    const user = users[0]
    if (!user) {
      return res.status(422).json({ message: 'No pending verification was found for this email.' })
    }

    const code = await transaction((connection) => createVerificationCode(connection, user.id, email))
    let delivery
    try {
      delivery = await sendVerificationEmail({ to: email, name: user.name, code })
    } catch (error) {
      return emailDeliveryFailureResponse(res, error, email)
    }

    return res.json(verificationResponse({
      message: 'A new verification code was sent. Check your email inbox.',
      email,
      delivery,
    }))
  } catch (error) {
    next(error)
  }
})

router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    await ensureAuthSchema()

    const users = await query(
      `
      SELECT *
      FROM users
      WHERE id = :id
      LIMIT 1
      `,
      { id: req.user.id }
    )
    const currentUser = users[0] || req.user
    const roles = await getUserRoles(currentUser.id)
    return res.json({ user: formatUser(currentUser, roles) })
  } catch (error) {
    next(error)
  }
})

router.patch('/me', authMiddleware, async (req, res, next) => {
  try {
    await ensureAuthSchema()

    const name = String(req.body?.name || '').trim()
    const gender = normalizeGender(req.body?.gender)
    const age = normalizeAge(req.body?.age)
    const birthday = normalizeDate(req.body?.birthday)
    const currentResidence = normalizeResidence(req.body?.current_residence || req.body?.currentResidence)
    const hasAvatarUrl = Object.prototype.hasOwnProperty.call(req.body || {}, 'avatar_url')
    const hasAvatarUrlCamel = Object.prototype.hasOwnProperty.call(req.body || {}, 'avatarUrl')
    const avatar = normalizeAvatarUrl(hasAvatarUrl ? req.body.avatar_url : hasAvatarUrlCamel ? req.body.avatarUrl : undefined)

    if (!name || !gender || age === null || !currentResidence || !birthday) {
      return res.status(422).json({ message: 'Name, gender, age, current residence, and birthday are required.' })
    }

    if (name.length < 2) {
      return res.status(422).json({ message: 'Name must be at least 2 characters.' })
    }

    if (!validGenderValues.has(gender)) {
      return res.status(422).json({ message: 'Choose a valid gender option.' })
    }

    if (age < 13 || age > 120) {
      return res.status(422).json({ message: 'Age must be between 13 and 120.' })
    }

    if (currentResidence.length < 2) {
      return res.status(422).json({ message: 'Current residence country is required.' })
    }

    const birthdayAge = ageFromBirthday(birthday)
    if (birthdayAge === null || birthdayAge < 13 || birthdayAge > 120) {
      return res.status(422).json({ message: 'Choose a valid birthday for a user age between 13 and 120.' })
    }

    if (avatar.error) {
      return res.status(422).json({ message: avatar.error })
    }

    await query(
      `
      UPDATE users
      SET name = :name,
          gender = :gender,
          age = :age,
          birthday = :birthday,
          current_residence = :currentResidence,
          avatar_url = :avatarUrl,
          updated_at = NOW()
      WHERE id = :id
      AND tenant_id = :tenantId
      `,
      {
        id: req.user.id,
        tenantId: req.user.tenant_id,
        name,
        gender,
        age,
        birthday,
        currentResidence,
        avatarUrl: avatar.hasValue ? avatar.value : req.user.avatar_url || null,
      }
    )

    const users = await query(
      `
      SELECT *
      FROM users
      WHERE id = :id
      LIMIT 1
      `,
      { id: req.user.id }
    )
    const roles = await getUserRoles(req.user.id)

    return res.json({
      message: 'Profile updated successfully.',
      user: formatUser(users[0] || req.user, roles),
    })
  } catch (error) {
    next(error)
  }
})

router.post('/logout', authMiddleware, async (req, res) => {
  return res.json({ message: 'Logged out successfully' })
})

module.exports = router
