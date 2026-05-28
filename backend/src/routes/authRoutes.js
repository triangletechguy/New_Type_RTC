const express = require('express')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const { query } = require('../config/db')
const { verifyPassword } = require('../utils/password')
const { authMiddleware } = require('../middleware/auth')

const router = express.Router()

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function validateEmail(value) {
  const email = normalizeEmail(value)
  const emailPattern = /^[^\s@]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i
  if (!emailPattern.test(email)) return false

  const domain = email.split('@')[1]
  const tld = domain.split('.').pop()
  return tld.length >= 2
}

function validateStrongPassword(value) {
  const password = String(value || '')
  return password.length >= 10
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password)
}

function formatUser(user, roles = []) {
  return {
    id: user.id,
    tenant_id: user.tenant_id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    avatar_url: user.avatar_url,
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

router.post('/login', async (req, res, next) => {
  try {
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

    if (user.status !== 'active') {
      return res.status(403).json({ message: 'Your account is not active.' })
    }

    await query(
      `
      UPDATE users
      SET last_login_at = NOW()
      WHERE id = :id
      `,
      { id: user.id }
    )

    const roles = await getUserRoles(user.id)

    const accessToken = jwt.sign(
      {
        sub: user.id,
        tenant_id: user.tenant_id,
        email: user.email,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    )

    return res.json({
      message: 'Login successful',
      token_type: 'Bearer',
      access_token: accessToken,
      user: formatUser(user, roles),
    })
  } catch (error) {
    next(error)
  }
})

router.post('/register', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim()
    const email = normalizeEmail(req.body?.email)
    const password = String(req.body?.password || '')

    if (!name || !email || !password) {
      return res.status(422).json({ message: 'Name, email, and password are required.' })
    }

    if (name.length < 2) {
      return res.status(422).json({ message: 'Name must be at least 2 characters.' })
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
      SELECT id
      FROM users
      WHERE tenant_id = 1
      AND email = :email
      LIMIT 1
      `,
      { email }
    )

    if (existing.length) {
      return res.status(409).json({ message: 'Email already exists.' })
    }

    const passwordHash = await bcrypt.hash(password, 10)

    const result = await query(
      `
      INSERT INTO users (
        tenant_id,
        name,
        email,
        password_hash,
        status,
        created_at,
        updated_at
      )
      VALUES (
        1,
        :name,
        :email,
        :passwordHash,
        'active',
        NOW(),
        NOW()
      )
      `,
      { name, email, passwordHash }
    )

    const userId = result.insertId

    await query(
      `
      INSERT INTO user_roles (user_id, role_id, tenant_id, created_at)
      VALUES (:userId, 1, 1, NOW())
      `,
      { userId }
    )

    return res.status(201).json({ message: 'User registered successfully.' })
  } catch (error) {
    next(error)
  }
})

router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const roles = await getUserRoles(req.user.id)
    return res.json({ user: formatUser(req.user, roles) })
  } catch (error) {
    next(error)
  }
})

router.post('/logout', authMiddleware, async (req, res) => {
  return res.json({ message: 'Logged out successfully' })
})

module.exports = router
