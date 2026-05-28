const bcrypt = require('bcryptjs')

function normalizeBcryptHash(hash) {
  if (!hash) return hash

  if (hash.startsWith('$2y$')) {
    return '$2b$' + hash.slice(4)
  }

  return hash
}

async function verifyPassword(plainPassword, storedHash) {
  return bcrypt.compare(plainPassword, normalizeBcryptHash(storedHash))
}

module.exports = {
  verifyPassword,
}
