#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const mysql = require('mysql2/promise')

const args = new Set(process.argv.slice(2))
const getArgValue = (name) => {
  const prefix = `${name}=`
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : ''
}

const confirmed = args.has('--confirm') || process.env.PURGE_ROOMS_CONFIRM === 'DELETE_ROOMS'
const allTenants = args.has('--all-tenants')
const tenantId = Number(getArgValue('--tenant-id') || process.env.PURGE_ROOMS_TENANT_ID || 1)
const keepRoomId = Number(getArgValue('--keep-room-id') || process.env.PURGE_ROOMS_KEEP_ROOM_ID || 0)

const connectionConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_DATABASE || 'rtc_platform',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
}

const resetIfEmptyTables = [
  'rooms',
  'room_roles',
  'room_bans',
  'rtc_tokens',
  'rtc_sessions',
  'rtc_session_participants',
  'rtc_events',
  'rtc_quality_samples',
  'chat_messages',
  'chat_message_hides',
  'chat_user_blocks',
  'usage_logs',
]

function escapeIdentifier(value) {
  return `\`${String(value || '').replace(/`/g, '``')}\``
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.execute(
    `
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = ?
    LIMIT 1
    `,
    [tableName]
  )
  return rows.length > 0
}

async function countRows(connection, tableName) {
  const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM ${escapeIdentifier(tableName)}`)
  return Number(rows[0]?.count || 0)
}

async function resetAutoIncrementWhenEmpty(connection, tableName) {
  if (!(await tableExists(connection, tableName))) return null
  const count = await countRows(connection, tableName)
  if (count !== 0) return null
  await connection.query(`ALTER TABLE ${escapeIdentifier(tableName)} AUTO_INCREMENT = 1`)
  return tableName
}

async function main() {
  if (!confirmed) {
    throw new Error('Refusing to purge rooms without --confirm or PURGE_ROOMS_CONFIRM=DELETE_ROOMS.')
  }
  if (!allTenants && (!Number.isInteger(tenantId) || tenantId <= 0)) {
    throw new Error('Use a positive --tenant-id value, or pass --all-tenants.')
  }
  if (keepRoomId && (!Number.isInteger(keepRoomId) || keepRoomId <= 0)) {
    throw new Error('--keep-room-id must be a positive room id.')
  }

  const connection = await mysql.createConnection(connectionConfig)

  try {
    await connection.beginTransaction()

    const where = []
    const values = []
    if (!allTenants) {
      where.push('tenant_id = ?')
      values.push(tenantId)
    }
    if (keepRoomId) {
      where.push('id <> ?')
      values.push(keepRoomId)
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const [beforeRows] = await connection.execute(
      `
      SELECT id, tenant_id, owner_id, name, status
      FROM rooms
      ${whereSql}
      ORDER BY id
      `,
      values
    )

    const [deleteResult] = await connection.execute(`DELETE FROM rooms ${whereSql}`, values)
    await connection.commit()

    const resetTables = []
    for (const tableName of resetIfEmptyTables) {
      const resetTable = await resetAutoIncrementWhenEmpty(connection, tableName)
      if (resetTable) resetTables.push(resetTable)
    }

    const [remainingRows] = await connection.execute('SELECT COUNT(*) AS count, COALESCE(MAX(id), 0) AS max_id FROM rooms')
    const remainingCount = Number(remainingRows[0]?.count || 0)
    const maxRoomId = Number(remainingRows[0]?.max_id || 0)

    console.log(JSON.stringify({
      deleted_count: Number(deleteResult.affectedRows || 0),
      deleted_rooms: beforeRows.map((room) => ({
        id: Number(room.id),
        tenant_id: Number(room.tenant_id),
        owner_id: Number(room.owner_id),
        name: room.name,
        status: room.status,
      })),
      kept_room_id: keepRoomId || null,
      remaining_rooms: remainingCount,
      next_room_id_note: remainingCount === 0
        ? 'rooms AUTO_INCREMENT reset; the next room can be ID 1.'
        : `rooms still has data; MySQL will continue above current max id ${maxRoomId}.`,
      reset_auto_increment_tables: resetTables,
    }, null, 2))
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    await connection.end()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
