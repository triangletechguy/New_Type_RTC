const endpoints = [
  ['backend', 'http://127.0.0.1:8000/health'],
  ['database', 'http://127.0.0.1:8000/api/health'],
  ['frontend', 'http://127.0.0.1:5173/'],
]

async function check(name, url) {
  try {
    const response = await fetch(url)
    const contentType = response.headers.get('content-type') || ''
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.text()

    if (!response.ok) {
      console.log(`[fail] ${name}: HTTP ${response.status}`)
      return false
    }

    const details = typeof body === 'string'
      ? 'ok'
      : body.message || body.status || 'ok'

    console.log(`[ok] ${name}: ${details}`)
    return true
  } catch (error) {
    console.log(`[fail] ${name}: ${error.message}`)
    return false
  }
}

async function main() {
  const results = []

  for (const [name, url] of endpoints) {
    results.push(await check(name, url))
  }

  if (results.some((result) => !result)) process.exit(1)
}

main()
