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
    console.log(`📝 Executing schema from ${schemaFile}...`)

    // Execute the schema SQL file
    await connection.query(schema)
    
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
