const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const envPath = path.join(__dirname, '..', 'backend', '.env')
const routePath = '/proc/net/route'

function gatewayFromProcRoute() {
  const rows = fs.readFileSync(routePath, 'utf8').trim().split('\n').slice(1)
  const defaultRoute = rows
    .map((row) => row.trim().split(/\s+/))
    .find((columns) => columns[1] === '00000000')

  if (!defaultRoute) return null

  const gatewayHex = defaultRoute[2]
  const octets = gatewayHex.match(/../g).reverse().map((part) => parseInt(part, 16))
  return octets.join('.')
}

function gatewayFromIpRoute() {
  try {
    const output = execFileSync('ip', ['route', 'show', 'default'], { encoding: 'utf8' })
    return output.match(/default via ([^\s]+)/)?.[1] || null
  } catch {
    return null
  }
}

function setEnvValue(source, key, value) {
  const line = `${key}=${value}`

  if (source.match(new RegExp(`^${key}=`, 'm'))) {
    return source.replace(new RegExp(`^${key}=.*$`, 'm'), line)
  }

  return `${source.trimEnd()}\n${line}\n`
}

const host = gatewayFromProcRoute() || gatewayFromIpRoute()

if (!host) {
  console.error('Could not detect the WSL Windows gateway IP.')
  process.exit(1)
}

const current = fs.readFileSync(envPath, 'utf8')
const next = setEnvValue(current, 'DB_HOST', host)
fs.writeFileSync(envPath, next)

console.log(`Updated backend/.env DB_HOST=${host}`)
