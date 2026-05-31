#!/usr/bin/env node

/**
 * Database initialization script - Works on Windows, Linux, and macOS with XAMPP
 * Uses mysql2 library for direct database connection (no CLI required)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const fs = require('fs')
const path = require('path')
const mysql = require('mysql2/promise')

const DB_HOST = process.env.DB_HOST || '127.0.0.1'
const DB_PORT = parseInt(process.env.DB_PORT || '3306')
const DB_USER = process.env.DB_USER || 'root'
const DB_PASSWORD = process.env.DB_PASSWORD || ''
const DB_DATABASE = process.env.DB_DATABASE || 'rtc_platform'

const schemaFile = path.join(__dirname, '..', '..', 'database', 'schema.sql')

if (!fs.existsSync(schemaFile)) {
  console.error(`❌ Error: Schema file not found at ${schemaFile}`)
  process.exit(1)
}

const schema = fs.readFileSync(schemaFile, 'utf8')

function escapeIdentifier(value) {
  return `\`${String(value || '').replace(/`/g, '``')}\``
}

async function tableExists(connection, tableName) {
  const [tables] = await connection.query(
    `
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = ?
    LIMIT 1
    `,
    [tableName]
  )

  return tables.length > 0
}

async function addColumnIfMissing(connection, tableName, columnName, alterSql) {
  if (!(await tableExists(connection, tableName))) return

  const [columns] = await connection.query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = ?
    AND COLUMN_NAME = ?
    LIMIT 1
    `,
    [tableName, columnName]
  )

  if (!columns.length) await connection.query(alterSql)
}

async function indexExists(connection, tableName, indexName) {
  const [indexes] = await connection.query(
    `
    SELECT INDEX_NAME
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = ?
    AND INDEX_NAME = ?
    LIMIT 1
    `,
    [tableName, indexName]
  )

  return indexes.length > 0
}

async function addIndexIfMissing(connection, tableName, indexName, alterSql) {
  if (!(await tableExists(connection, tableName))) return
  if (!(await indexExists(connection, tableName, indexName))) await connection.query(alterSql)
}

async function dropIndexIfExists(connection, tableName, indexName) {
  if (!(await tableExists(connection, tableName))) return
  if (await indexExists(connection, tableName, indexName)) {
    await connection.query(`ALTER TABLE ${escapeIdentifier(tableName)} DROP INDEX ${escapeIdentifier(indexName)}`)
  }
}

async function runLegacyMigrations(connection) {
  await addColumnIfMissing(connection, 'client_apps', 'api_key_hash', 'ALTER TABLE client_apps ADD COLUMN api_key_hash CHAR(64) NULL AFTER api_key')
  await addColumnIfMissing(connection, 'client_apps', 'last_key_rotated_at', 'ALTER TABLE client_apps ADD COLUMN last_key_rotated_at TIMESTAMP NULL AFTER sdk_token')
  await addIndexIfMissing(connection, 'client_apps', 'unique_client_api_key_hash', 'ALTER TABLE client_apps ADD UNIQUE KEY unique_client_api_key_hash (api_key_hash)')
  await dropIndexIfExists(connection, 'client_apps', 'unique_client_api_key')

  if (await tableExists(connection, 'client_apps')) {
    await connection.query("UPDATE client_apps SET api_key_hash = COALESCE(NULLIF(api_key_hash, ''), SHA2(api_key, 256)), api_key = CONCAT(LEFT(api_key, 6), '...', RIGHT(api_key, 4)) WHERE api_key NOT LIKE '%...%'")
  }

  if (await tableExists(connection, 'rtc_sessions')) {
    await connection.query("ALTER TABLE rtc_sessions MODIFY COLUMN rtc_provider ENUM('native_webrtc', 'mediasoup', 'janus', 'livekit_style') NOT NULL DEFAULT 'native_webrtc'")
  }
}

async function initializeDatabase() {
  try {
    console.log(`📡 Connecting to database at ${DB_HOST}:${DB_PORT} as ${DB_USER}...`)
    
    const connection = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      multipleStatements: true
    })

    console.log('✓ Connected to MySQL')

    await connection.query(`CREATE DATABASE IF NOT EXISTS ${escapeIdentifier(DB_DATABASE)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    await connection.query(`USE ${escapeIdentifier(DB_DATABASE)}`)

    console.log('✓ Applied legacy table compatibility checks')
    await runLegacyMigrations(connection)

    console.log(`📝 Executing schema from ${schemaFile}...`)

    // Execute the schema SQL file
    await connection.query(schema)
    await runLegacyMigrations(connection)
    await addColumnIfMissing(connection, 'users', 'gender', 'ALTER TABLE users ADD COLUMN gender VARCHAR(30) NULL AFTER avatar_url')
    await addColumnIfMissing(connection, 'users', 'age', 'ALTER TABLE users ADD COLUMN age INT UNSIGNED NULL AFTER gender')
    await addColumnIfMissing(connection, 'users', 'birthday', 'ALTER TABLE users ADD COLUMN birthday DATE NULL AFTER age')
    await addColumnIfMissing(connection, 'users', 'current_residence', 'ALTER TABLE users ADD COLUMN current_residence VARCHAR(120) NULL AFTER birthday')
    await connection.query("ALTER TABLE users MODIFY COLUMN status ENUM('pending_verification', 'active', 'inactive', 'banned') DEFAULT 'active'")
    
    console.log('✅ Database initialized successfully')
    await connection.end()
    process.exit(0)
  } catch (error) {
    console.error('❌ Error:', error.message)
    if (error.code === 'PROTOCOL_CONNECTION_LOST') {
      console.error('Connection was closed unexpectedly')
    }
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('Access denied. Check your DB_USER and DB_PASSWORD in .env')
    }
    if (error.code === 'ER_BAD_DB_ERROR') {
      console.error('Database does not exist yet. The script will create it.')
    }
    console.error('\nMake sure MySQL is running:')
    console.error('  - XAMPP: Start MySQL from XAMPP Control Panel')
    console.error('  - Ubuntu/Linux: sudo systemctl start mysql')
    console.error('  - macOS: brew services start mysql')
    process.exit(1)
  }
}

initializeDatabase()
