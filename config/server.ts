import express from 'express'
import cors from 'cors'
import axios from 'axios'
import { existsSync } from 'fs'
import { join } from 'path'

const app = express()
app.use(cors())
app.use(express.json())

// Serve built frontend when dist/ exists (Docker / production mode)
// process.cwd() is always the project root regardless of where this file lives
const distDir = join(process.cwd(), 'dist')
if (existsSync(distDir)) {
  app.use(express.static(distDir))
}

app.post('/api/query', async (req, res) => {
  const { host, port, username, password, query } = req.body

  if (!host || !query) {
    return res.status(400).json({ error: 'host and query are required' })
  }

  const url = `http://${host}:${port ?? 8123}/`

  try {
    const response = await axios.post(url, query, {
      params: { default_format: 'JSON' },
      auth: username ? { username, password: password ?? '' } : undefined,
      headers: { 'Content-Type': 'text/plain' },
      timeout: 15000,
    })
    res.json(response.data)
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? 500
      const message = err.response?.data ?? err.message
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
