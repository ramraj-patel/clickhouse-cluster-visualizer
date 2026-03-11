import express from 'express'
import cors from 'cors'
import axios from 'axios'
import { existsSync } from 'fs'
import { join } from 'path'

const app = express()

// In production restrict to the origins that need to call this proxy.
// Set ALLOWED_ORIGINS="https://your-domain.com" in the environment.
// In development (NODE_ENV != 'production') all origins are allowed for convenience.
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:3001']

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? ALLOWED_ORIGINS : true,
  credentials: false,
}))

// Limit request body to 64 KB — sufficient for any SQL query + credentials.
app.use(express.json({ limit: '64kb' }))

// Serve built frontend when dist/ exists (Docker / production mode)
const distDir = join(process.cwd(), 'dist')
if (existsSync(distDir)) {
  app.use(express.static(distDir))
}

/** Basic hostname validation — must be a domain name or IPv4/IPv6, no URL paths. */
const VALID_HOST_RE = /^[a-zA-Z0-9.\-:[\]]+$/

/** Extract a safe error summary from a raw ClickHouse error payload. */
function sanitizeError(data: unknown): string {
  if (typeof data === 'string') {
    // ClickHouse format: "Code: N. DB::Exception: <message> (version ...)"
    const match = data.match(/^Code:\s*(\d+)\.\s*DB::Exception:\s*([^\n(]+)/)
    if (match) return `ClickHouse error ${match[1]}: ${match[2].trim()}`
  }
  return 'ClickHouse query failed'
}

app.post('/api/query', async (req, res) => {
  const { host, port, username, password, query } = req.body

  if (!host || !query) {
    return res.status(400).json({ error: 'host and query are required' })
  }

  // Validate host to prevent SSRF — reject anything that looks like a URL path or
  // contains characters that don't belong in a hostname or IP address.
  if (!VALID_HOST_RE.test(host)) {
    return res.status(400).json({ error: 'Invalid host' })
  }

  const resolvedPort = typeof port === 'number' && port >= 1 && port <= 65535
    ? port
    : 8123

  const url = `http://${host}:${resolvedPort}/`

  try {
    const response = await axios.post(url, query, {
      params: { default_format: 'JSON' },
      auth: username ? { username, password: password ?? '' } : undefined,
      headers: { 'Content-Type': 'text/plain' },
      timeout: 30000,
    })
    res.json(response.data)
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? 500
      // Sanitize: don't forward raw ClickHouse error payloads which may contain
      // internal table names, file paths, or query text with embedded credentials.
      const message = sanitizeError(err.response?.data)
      console.error('[proxy error]', err.response?.data ?? err.message)
      return res.status(status).json({ error: message })
    }
    res.status(500).json({ error: 'Unknown error' })
  }
})

app.get('/api/ping', (_req, res) => res.json({ ok: true }))

// SPA fallback — serve index.html for any non-API route (production mode)
if (existsSync(distDir)) {
  app.get('*', (_req, res) => res.sendFile(join(process.cwd(), 'dist', 'index.html')))
}

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
