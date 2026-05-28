const { spawn } = require('node:child_process')

const commands = [
  {
    name: 'backend',
    command: 'npm',
    args: ['--prefix', 'backend', 'run', 'dev'],
  },
  {
    name: 'frontend',
    command: 'npm',
    args: ['--prefix', 'frontend', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173'],
  },
]

const children = []
let shuttingDown = false

function prefix(name, data) {
  for (const line of String(data).split(/\r?\n/)) {
    if (line.trim()) console.log(`[${name}] ${line}`)
  }
}

function stopAll(signal = 'SIGTERM') {
  if (shuttingDown) return
  shuttingDown = true

  for (const child of children) {
    if (!child.killed) child.kill(signal)
  }
}

for (const item of commands) {
  const child = spawn(item.command, item.args, {
    cwd: process.cwd(),
    shell: process.platform === 'win32',
    env: process.env,
  })

  children.push(child)
  child.stdout.on('data', (data) => prefix(item.name, data))
  child.stderr.on('data', (data) => prefix(item.name, data))

  child.on('exit', (code, signal) => {
    if (!shuttingDown && code !== 0) {
      console.error(`[${item.name}] exited with ${signal || code}`)
      stopAll()
      process.exitCode = code || 1
    }
  })
}

process.on('SIGINT', () => stopAll('SIGINT'))
process.on('SIGTERM', () => stopAll('SIGTERM'))
