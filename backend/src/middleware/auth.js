const jwt = require('jsonwebtoken')
const { query } = require('../config/db')

async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || ''

    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthenticated' })
    }

    const token = header.replace('Bearer ', '').trim()
    const payload = jwt.verify(token, process.env.JWT_SECRET)

    const users = await query(
      `
      SELECT id, tenant_id, name, email, phone, avatar_url, status, last_login_at, created_at, updated_at
      FROM users
      WHERE id = :id
      LIMIT 1
      `,
      { id: payload.sub }
    )

    if (!users.length) {
      return res.status(401).json({ message: 'Unauthenticated' })
    }

    const user = users[0]

    if (user.status !== 'active') {
      return res.status(403).json({ message: 'Your account is not active.' })
    }

    const roles = await query(
      `
      SELECT roles.name
      FROM user_roles
      JOIN roles ON roles.id = user_roles.role_id
      WHERE user_roles.user_id = :userId
      `,
      { userId: user.id }
    )

    user.roles = roles.map((role) => role.name)
    req.user = user
    next()
  } catch (error) {
    return res.status(401).json({ message: 'Unauthenticated' })
  }
}

module.exports = {
  authMiddleware,
}
