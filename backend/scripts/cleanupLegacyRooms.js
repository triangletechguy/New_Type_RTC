#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const mysql = require('mysql2/promise')

const tenantId = Number(process.env.CLEANUP_TENANT_ID || 1)
const defaultDescription = 'A hosted room for live video, music, chat, and creator collaboration.'

const connectionConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_DATABASE || 'rtc_platform',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
}

async function main() {
  const connection = await mysql.createConnection(connectionConfig)

  try {
    const [rooms] = await connection.execute(
      `
      SELECT id, name
      FROM rooms
      WHERE tenant_id = ?
      AND (
        name = 'Demo BuzzCast Stage'
        OR (name = 'Debug Live Room' AND description LIKE 'Testing create room from deploy diagnostic%')
        OR (name = 'talk-each-other Live Room' AND description = ?)
      )
      ORDER BY id
      `,
      [tenantId, defaultDescription]
    )

    if (!rooms.length) {
      console.log('No legacy room rows found.')
      return
    }

    const ids = rooms.map((room) => room.id)
    const placeholders = ids.map(() => '?').join(', ')
    await connection.execute(`DELETE FROM rooms WHERE id IN (${placeholders})`, ids)

    console.log(JSON.stringify({
      deleted_rooms: rooms.map((room) => ({ id: Number(room.id), name: room.name })),
    }, null, 2))
  } finally {
    await connection.end()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
