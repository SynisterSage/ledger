import express from 'express'
import cors from 'cors'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

// Supabase with service role (backend only - full permissions)
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false } }
)

// Middleware
app.use(cors())
app.use(express.json())

// Tier limits (adjust as needed)
const TIER_LIMITS = {
  free: {
    projects: 3,
    tasks: 50,
    events: 100,
    notes: 100,
  },
  pro: {
    projects: Infinity,
    tasks: Infinity,
    events: Infinity,
    notes: Infinity,
  },
}

// Auth middleware - verify Supabase token
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    return res.status(401).json({ error: 'Missing token' })
  }

  try {
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data.user) {
      return res.status(401).json({ error: 'Invalid token' })
    }
    req.user = data.user
    next()
  } catch (err) {
    res.status(401).json({ error: 'Auth failed' })
  }
}

// Check quota middleware
const checkQuota = (resource) => async (req, res, next) => {
  try {
    // Get user subscription tier (for now assume free)
    const tier = 'free' // TODO: fetch from users table

    const limit = TIER_LIMITS[tier][resource]
    if (limit === Infinity) {
      return next()
    }

    // Check current count
    const { count, error } = await supabase
      .from(resource === 'tasks' ? 'daily_accountability' : resource + 's')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', req.workspaceId)

    if (error) throw error

    if (count >= limit) {
      return res.status(429).json({
        error: `${resource} limit reached for your tier`,
        limit,
        current: count,
      })
    }

    next()
  } catch (err) {
    res.status(500).json({ error: 'Quota check failed' })
  }
}

// Get workspace ID from user
const getWorkspaceId = async (userId) => {
  const { data } = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_id', userId)
    .eq('is_personal', true)
    .single()

  return data?.id
}

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

// Projects
app.get('/api/projects', authMiddleware, async (req, res) => {
  try {
    const workspaceId = await getWorkspaceId(req.user.id)
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, status, completeness')
      .eq('workspace_id', workspaceId)
      .neq('status', 'Completed')
      .limit(5)

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/projects', authMiddleware, checkQuota('projects'), async (req, res) => {
  try {
    const { name } = req.body
    if (!name?.trim()) {
      return res.status(400).json({ error: 'Project name required' })
    }

    const workspaceId = await getWorkspaceId(req.user.id)
    const { data, error } = await supabase
      .from('projects')
      .insert({
        workspace_id: workspaceId,
        created_by: req.user.id,
        name: name.trim(),
        status: 'NotStarted',
        completeness: 0,
      })
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/projects/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params
    const { status, completeness } = req.body

    const update = {}
    if (status) update.status = status
    if (completeness !== undefined) update.completeness = Math.max(0, Math.min(100, completeness))

    const { data, error } = await supabase
      .from('projects')
      .update(update)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/projects/:id', authMiddleware, async (req, res) => {
  try {
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Events
app.get('/api/events/upcoming', authMiddleware, async (req, res) => {
  try {
    const workspaceId = await getWorkspaceId(req.user.id)
    const today = new Date().toISOString().slice(0, 10)
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)

    const { data, error } = await supabase
      .from('events')
      .select('id, title, start_at')
      .eq('workspace_id', workspaceId)
      .gte('start_at', today)
      .lte('start_at', future)
      .limit(10)

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/events', authMiddleware, checkQuota('events'), async (req, res) => {
  try {
    const { title, start_at, end_at } = req.body
    if (!title?.trim()) {
      return res.status(400).json({ error: 'Event title required' })
    }

    const workspaceId = await getWorkspaceId(req.user.id)

    // Get or create default calendar
    let { data: calendar, error: calError } = await supabase
      .from('calendars')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('is_personal', true)
      .single()

    if (!calendar) {
      const { data: newCal } = await supabase
        .from('calendars')
        .insert({
          workspace_id: workspaceId,
          name: 'Personal',
          color: '#007AFF',
          is_personal: true,
        })
        .select()
        .single()
      calendar = newCal
    }

    const { data, error } = await supabase
      .from('events')
      .insert({
        workspace_id: workspaceId,
        calendar_id: calendar.id,
        title: title.trim(),
        start_at,
        end_at,
        status: 'planned',
      })
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Daily accountability
app.get('/api/daily-accountability', authMiddleware, async (req, res) => {
  try {
    const workspaceId = await getWorkspaceId(req.user.id)
    const today = new Date().toISOString().slice(0, 10)

    const { data, error } = await supabase
      .from('daily_accountability')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('date', today)
      .single()

    if (error && error.code !== 'PGRST116') throw error
    res.json(data || null)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/daily-accountability', authMiddleware, async (req, res) => {
  try {
    const { focus_items, finished, blocked, first_task_tomorrow } = req.body
    const workspaceId = await getWorkspaceId(req.user.id)
    const today = new Date().toISOString().slice(0, 10)

    const { data, error } = await supabase
      .from('daily_accountability')
      .upsert(
        {
          workspace_id: workspaceId,
          user_id: req.user.id,
          date: today,
          focus_items,
          finished,
          blocked,
          first_task_tomorrow,
        },
        { onConflict: 'workspace_id,user_id,date' }
      )
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Notes
app.get('/api/notes', authMiddleware, async (req, res) => {
  try {
    const workspaceId = await getWorkspaceId(req.user.id)
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/notes', authMiddleware, checkQuota('notes'), async (req, res) => {
  try {
    const { title, body } = req.body
    const workspaceId = await getWorkspaceId(req.user.id)

    const { data, error } = await supabase
      .from('notes')
      .insert({
        workspace_id: workspaceId,
        user_id: req.user.id,
        title: title || 'Untitled',
        body,
      })
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Start server
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`)
})
