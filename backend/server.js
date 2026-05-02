import express from 'express'
import cors from 'cors'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000
const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const supabase = createClient(supabaseUrl, supabaseServiceRole, {
  auth: { persistSession: false },
})

app.use(cors())
app.use(express.json({ limit: '256kb' }))

const TIER_LIMITS = {
  free: { projects: 3, events: 100, notes: 100, reminders: 100 },
  pro: { projects: Infinity, events: Infinity, notes: Infinity, reminders: Infinity },
}

const REMINDER_TABLES = ['reminders', 'calendar_reminders']

const WINDOW_MS = 60_000
const RATE_LIMITS = {
  auth: { max: 60 },
  read: { max: 180 },
  write: { max: 60 },
}

const rateBuckets = new Map()

const getBucketKey = (scope, req, userId) => `${scope}:${userId ?? req.ip}`

const rateLimit = (scope) => (req, res, next) => {
  const now = Date.now()
  const bucketKey = getBucketKey(scope, req, req.authUser?.id)
  const bucket = rateBuckets.get(bucketKey) ?? { count: 0, resetAt: now + WINDOW_MS }

  if (now > bucket.resetAt) {
    bucket.count = 0
    bucket.resetAt = now + WINDOW_MS
  }

  bucket.count += 1
  rateBuckets.set(bucketKey, bucket)

  if (bucket.count > RATE_LIMITS[scope].max) {
    return res.status(429).json({ error: 'Too many requests. Slow down and try again.' })
  }

  next()
}

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

    req.authUser = data.user
    next()
  } catch (error) {
    return res.status(401).json({ error: 'Auth failed' })
  }
}

const safeJson = (value, fallback = null) => {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return fallback
    }
  }
  return value
}

const getUserTier = (user) => {
  const candidate = user?.app_metadata?.tier || user?.user_metadata?.tier || user?.user_metadata?.plan
  return candidate === 'pro' ? 'pro' : 'free'
}

const isCompletedProjectStatus = (status) => String(status ?? '').toLowerCase().includes('complete')

const projectStatusAliases = {
  not_started: ['NotStarted', 'not_started', 'todo'],
  in_progress: ['InProgress', 'in_progress', 'inprogress', 'doing'],
  paused: ['Paused', 'paused', 'archived', 'hold'],
  completed: ['Completed', 'completed', 'done'],
}

const projectSelectColumns = 'id, name, description, status, completeness, color, start_date, end_date, created_at, updated_at'
const taskSelectColumns = 'id, workspace_id, project_id, title, description, due_date, due_time, status, priority, assigned_to, tags, created_at, updated_at'

const normalizeProjectSemanticStatus = (status) => {
  const value = String(status ?? '').toLowerCase()
  if (value.includes('complete')) return 'completed'
  if (value.includes('pause') || value.includes('archiv') || value.includes('hold')) return 'paused'
  if (value.includes('progress') || value.includes('doing') || value.includes('in_')) return 'in_progress'
  return 'not_started'
}

const normalizeNullableText = (value) => {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  if (!trimmed || trimmed.toLowerCase() === 'null') return null
  return trimmed
}

const normalizeNullableDate = (value, fieldName) => {
  const normalized = normalizeNullableText(value)
  if (normalized === null) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid ${fieldName} format`)
  }
  return normalized
}

const resolveWorkspaceId = async (userId) => {
  const personalWorkspace = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_id', userId)
    .eq('is_personal', true)
    .maybeSingle()

  if (personalWorkspace.data?.id) {
    return personalWorkspace.data.id
  }

  const membershipWorkspace = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()

  if (membershipWorkspace.data?.workspace_id) {
    return membershipWorkspace.data.workspace_id
  }

  const createdWorkspace = await supabase
    .from('workspaces')
    .insert({
      owner_id: userId,
      name: 'My Work',
      is_personal: true,
    })
    .select('id')
    .single()

  if (createdWorkspace.data?.id) {
    return createdWorkspace.data.id
  }

  throw new Error('Workspace not available')
}

const getCalendarId = async (workspaceId, userId) => {
  const existing = await supabase
    .from('calendars')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('is_personal', true)
    .maybeSingle()

  if (existing.data?.id) {
    return existing.data.id
  }

  const created = await supabase
    .from('calendars')
    .insert({
      workspace_id: workspaceId,
      owner_id: userId,
      name: 'Personal',
      color: '#3B82F6',
      is_personal: true,
      is_default: true,
    })
    .select('id')
    .single()

  return created.data?.id ?? null
}

const ensureWorkspaceResource = async (table, id, workspaceId) => {
  const result = await supabase.from(table).select('id').eq('id', id).eq('workspace_id', workspaceId).maybeSingle()
  return Boolean(result.data?.id)
}

const isMissingTableError = (error) => {
  const message = String(error?.message ?? '').toLowerCase()
  return message.includes('relation') && message.includes('does not exist')
}

const withReminderTable = async (queryFactory) => {
  let lastError = null

  for (const table of REMINDER_TABLES) {
    const result = await queryFactory(table)
    if (!result?.error) {
      return result
    }

    lastError = result.error
    if (!isMissingTableError(result.error)) {
      return result
    }
  }

  return { data: null, error: lastError ?? new Error('Reminder table lookup failed') }
}

const getLimitCount = async (resource, workspaceId) => {
  const tableMap = {
    projects: 'projects',
    tasks: 'tasks',
    events: 'events',
    reminders: 'calendar_reminders',
    notes: 'notes',
  }

  const selectColumns = resource === 'projects' ? 'status' : 'id'
  const reminderCount = resource === 'reminders'
    ? await withReminderTable((table) =>
        supabase
          .from(table)
          .select(selectColumns)
          .eq('workspace_id', workspaceId)
      )
    : null

  const { data, error } = resource === 'reminders'
    ? reminderCount
    : await supabase
        .from(tableMap[resource])
        .select(selectColumns)
        .eq('workspace_id', workspaceId)

  if (error) {
    throw error
  }

  if (resource === 'projects') {
    return (data ?? []).filter((project) => !isCompletedProjectStatus(project?.status)).length
  }

  return (data ?? []).length
}

const quotaGuard = (resource) => async (req, res, next) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    req.workspaceId = workspaceId

    const tier = getUserTier(req.authUser)
    const limit = TIER_LIMITS[tier][resource]
    if (limit === Infinity) {
      return next()
    }

    const current = await getLimitCount(resource, workspaceId)
    if (current >= limit) {
      return res.status(429).json({ error: `${resource} limit reached for your tier`, limit, current })
    }

    next()
  } catch (error) {
    return res.status(500).json({ error: 'Quota check failed' })
  }
}

app.get('/health', (req, res) => res.json({ status: 'ok' }))

app.get('/api/user/onboarding', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('onboarding_completed')
      .eq('id', req.authUser.id)
      .maybeSingle()

    if (error) throw error
    res.json({ onboarding_completed: Boolean(data?.onboarding_completed) })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.patch('/api/user/onboarding', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .update({ onboarding_completed: true, onboarding_completed_at: new Date().toISOString() })
      .eq('id', req.authUser.id)
      .select('onboarding_completed')
      .single()

    if (error) throw error
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/projects', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    const includeCompleted = ['true', '1', 'yes'].includes(String(req.query?.includeCompleted ?? '').toLowerCase())
    const { data, error } = await supabase
      .from('projects')
      .select(projectSelectColumns)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(24)

    if (error) throw error
    const projects = data ?? []
    res.json(includeCompleted ? projects : projects.filter((project) => !isCompletedProjectStatus(project.status)).slice(0, 8))
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/projects', authMiddleware, rateLimit('write'), quotaGuard('projects'), async (req, res) => {
  try {
    const name = String(req.body?.name ?? '').trim()
    if (!name) {
      return res.status(400).json({ error: 'Project name required' })
    }

    const description = normalizeNullableText(req.body?.description)
    const startDate = normalizeNullableDate(req.body?.start_date, 'start date')
    const endDate = normalizeNullableDate(req.body?.end_date, 'end date')
    const color = normalizeNullableText(req.body?.color)
    const status = req.body?.status ? projectStatusAliases[normalizeProjectSemanticStatus(req.body.status)][0] : 'NotStarted'

    const { data, error } = await supabase
      .from('projects')
      .insert({
        workspace_id: req.workspaceId,
        created_by: req.authUser.id,
        name,
        description,
        status,
        completeness: 0,
        color: color || '#007AFF',
        start_date: startDate,
        end_date: endDate,
      })
      .select(projectSelectColumns)
      .single()

    if (error) throw error
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.patch('/api/projects/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    const allowed = await ensureWorkspaceResource('projects', req.params.id, workspaceId)
    if (!allowed) {
      return res.status(404).json({ error: 'Project not found' })
    }

    const update = {}
    if (req.body?.name !== undefined) {
      const nextName = String(req.body.name).trim()
      if (!nextName) {
        return res.status(400).json({ error: 'Project name required' })
      }
      update.name = nextName
    }
    if (req.body?.description !== undefined) update.description = normalizeNullableText(req.body.description)
    if (req.body?.status) {
      const semantic = normalizeProjectSemanticStatus(req.body.status)
      update.status = projectStatusAliases[semantic][0]
    }
    if (req.body?.completeness !== undefined) {
      update.completeness = Math.max(0, Math.min(100, Number(req.body.completeness)))
    }
    if (req.body?.color !== undefined) update.color = normalizeNullableText(req.body.color) || '#007AFF'
    if (req.body?.start_date !== undefined) update.start_date = normalizeNullableDate(req.body.start_date, 'start date')
    if (req.body?.end_date !== undefined) update.end_date = normalizeNullableDate(req.body.end_date, 'end date')
    update.updated_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('projects')
      .update(update)
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId)
      .select(projectSelectColumns)
      .single()

    if (error) throw error
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.delete('/api/projects/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    const { error } = await supabase.from('projects').delete().eq('id', req.params.id).eq('workspace_id', workspaceId)
    if (error) throw error
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/tasks', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    let query = supabase
      .from('tasks')
      .select(taskSelectColumns)
      .eq('workspace_id', workspaceId)

    if (req.query?.projectId) {
      query = query.eq('project_id', String(req.query.projectId))
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(500)
    if (error) throw error
    res.json(data ?? [])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/tasks', authMiddleware, rateLimit('write'), quotaGuard('tasks'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    const title = String(req.body?.title ?? '').trim()
    if (!title) {
      return res.status(400).json({ error: 'Task title required' })
    }

    const projectId = req.body?.project_id ? String(req.body.project_id) : null
    if (projectId) {
      const allowed = await ensureWorkspaceResource('projects', projectId, workspaceId)
      if (!allowed) {
        return res.status(404).json({ error: 'Project not found' })
      }
    }

    const tags = Array.isArray(req.body?.tags) ? req.body.tags.map((tag) => String(tag).trim()).filter(Boolean) : []
    const description = normalizeNullableText(req.body?.description)
    const dueDate = normalizeNullableDate(req.body?.due_date, 'due date')
    const dueTime = normalizeNullableText(req.body?.due_time)

    const { data, error } = await supabase
      .from('tasks')
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        title,
        description,
        due_date: dueDate,
        due_time: dueTime,
        status: req.body?.status ? String(req.body.status) : 'todo',
        priority: req.body?.priority ? String(req.body.priority) : 'medium',
        tags,
      })
      .select(taskSelectColumns)
      .single()

    if (error) throw error
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.patch('/api/tasks/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    const allowed = await ensureWorkspaceResource('tasks', req.params.id, workspaceId)
    if (!allowed) {
      return res.status(404).json({ error: 'Task not found' })
    }

    const update = {}
    if (req.body?.title !== undefined) {
      const nextTitle = String(req.body.title).trim()
      if (!nextTitle) {
        return res.status(400).json({ error: 'Task title required' })
      }
      update.title = nextTitle
    }
    if (req.body?.description !== undefined) update.description = normalizeNullableText(req.body.description)
    if (req.body?.due_date !== undefined) update.due_date = normalizeNullableDate(req.body.due_date, 'due date')
    if (req.body?.due_time !== undefined) update.due_time = normalizeNullableText(req.body.due_time)
    if (req.body?.status !== undefined) update.status = String(req.body.status)
    if (req.body?.priority !== undefined) update.priority = String(req.body.priority)
    if (req.body?.tags !== undefined) {
      update.tags = Array.isArray(req.body.tags) ? req.body.tags.map((tag) => String(tag).trim()).filter(Boolean) : []
    }
    if (req.body?.project_id !== undefined) {
      const nextProjectId = req.body.project_id ? String(req.body.project_id) : null
      if (nextProjectId) {
        const projectAllowed = await ensureWorkspaceResource('projects', nextProjectId, workspaceId)
        if (!projectAllowed) {
          return res.status(404).json({ error: 'Project not found' })
        }
      }
      update.project_id = nextProjectId
    }
    update.updated_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('tasks')
      .update(update)
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId)
      .select(taskSelectColumns)
      .single()

    if (error) throw error
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.delete('/api/tasks/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    const { error } = await supabase.from('tasks').delete().eq('id', req.params.id).eq('workspace_id', workspaceId)
    if (error) throw error
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/calendars', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    const { data, error } = await supabase
      .from('calendars')
      .select('id, name, color, workspace_id, is_personal')
      .eq('workspace_id', workspaceId)
      .order('is_personal', { ascending: false })

    if (error) throw error
    res.json(data ?? [])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/calendars', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    const name = String(req.body?.name ?? 'Personal').trim() || 'Personal'

    const { data, error } = await supabase
      .from('calendars')
      .insert({
        workspace_id: workspaceId,
        owner_id: req.authUser.id,
        name,
        color: req.body?.color || '#3B82F6',
        is_personal: Boolean(req.body?.is_personal ?? false),
        is_default: Boolean(req.body?.is_default ?? false),
      })
      .select('id, name, color, workspace_id, is_personal')
      .single()

    if (error) throw error
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.patch('/api/calendars/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    const allowed = await ensureWorkspaceResource('calendars', req.params.id, workspaceId)
    if (!allowed) {
      return res.status(404).json({ error: 'Calendar not found' })
    }

    const update = {}
    if (req.body?.name !== undefined) update.name = String(req.body.name).trim()
    if (req.body?.color !== undefined) update.color = String(req.body.color)

    const { data, error } = await supabase
      .from('calendars')
      .update(update)
      .eq('id', req.params.id)
      .select('id, name, color, workspace_id, is_personal')
      .single()

    if (error) throw error
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/events', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    let query = supabase
      .from('events')
      .select('id, title, start_at, end_at, calendar_id, color, status, recurrence_rule, created_at')
      .eq('workspace_id', workspaceId)

    if (req.query?.startDate) {
      query = query.gte('start_at', String(req.query.startDate))
    }
    if (req.query?.endDate) {
      query = query.lte('start_at', String(req.query.endDate))
    }

    const { data, error } = await query.order('start_at', { ascending: true }).limit(500)
    if (error) throw error
    res.json(data ?? [])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/events/upcoming', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const end = new Date(today)
    end.setDate(end.getDate() + 30)

    const { data, error } = await supabase
      .from('events')
      .select('id, title, start_at, end_at, calendar_id, color, status, recurrence_rule')
      .eq('workspace_id', workspaceId)
      .gte('start_at', today.toISOString())
      .lte('start_at', end.toISOString())
      .order('start_at', { ascending: true })
      .limit(20)

    if (error) throw error
    res.json(data ?? [])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/events', authMiddleware, rateLimit('write'), quotaGuard('events'), async (req, res) => {
  try {
    const workspaceId = req.workspaceId
    const title = String(req.body?.title ?? '').trim()
    if (!title) {
      return res.status(400).json({ error: 'Event title required' })
    }

    const calendarId = req.body?.calendar_id || (await getCalendarId(workspaceId, req.authUser.id))

    const { data, error } = await supabase
      .from('events')
      .insert({
        workspace_id: workspaceId,
        calendar_id: calendarId,
        created_by: req.authUser.id,
        title,
        start_at: req.body?.start_at,
        end_at: req.body?.end_at,
        color: req.body?.color || null,
        status: req.body?.status || 'NotStarted',
        recurrence_rule: req.body?.recurrence_rule || 'none',
        notes: req.body?.notes || null,
        location: req.body?.location || null,
        all_day: Boolean(req.body?.all_day ?? false),
      })
      .select('id, title, start_at, end_at, calendar_id, color, status, recurrence_rule')
      .single()

    if (error) throw error
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.patch('/api/events/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    const allowed = await ensureWorkspaceResource('events', req.params.id, workspaceId)
    if (!allowed) {
      return res.status(404).json({ error: 'Event not found' })
    }

    const update = {}
    for (const key of ['title', 'start_at', 'end_at', 'calendar_id', 'color', 'status', 'recurrence_rule', 'notes', 'location']) {
      if (req.body?.[key] !== undefined) update[key] = req.body[key]
    }

    const { data, error } = await supabase
      .from('events')
      .update(update)
      .eq('id', req.params.id)
      .select('id, title, start_at, end_at, calendar_id, color, status, recurrence_rule')
      .single()

    if (error) throw error
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.delete('/api/events/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    const { error } = await supabase.from('events').delete().eq('id', req.params.id).eq('workspace_id', workspaceId)
    if (error) throw error
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/reminders', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    const { data, error } = await withReminderTable((table) =>
      supabase
        .from(table)
        .select('id, title, remind_at, calendar_id, color, is_done')
        .eq('workspace_id', workspaceId)
        .order('remind_at', { ascending: true })
    )

    if (error) throw error
    res.json(data ?? [])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/reminders', authMiddleware, rateLimit('write'), quotaGuard('reminders'), async (req, res) => {
  try {
    const workspaceId = req.workspaceId
    const calendarId = req.body?.calendar_id || (await getCalendarId(workspaceId, req.authUser.id))

    const insertPayload = {
      workspace_id: workspaceId,
      calendar_id: calendarId,
      created_by: req.authUser.id,
      title: String(req.body?.title ?? 'Reminder').trim() || 'Reminder',
      remind_at: req.body?.remind_at,
      color: req.body?.color || null,
      is_done: Boolean(req.body?.is_done ?? false),
    }

    const { data, error } = await withReminderTable((table) =>
      supabase
        .from(table)
        .insert(insertPayload)
        .select('id, title, remind_at, calendar_id, color, is_done')
        .single()
    )

    if (error) throw error
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.patch('/api/reminders/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    const allowedResult = await withReminderTable((table) =>
      supabase.from(table).select('id').eq('id', req.params.id).eq('workspace_id', workspaceId).maybeSingle()
    )
    if (!allowedResult?.data?.id) {
      return res.status(404).json({ error: 'Reminder not found' })
    }

    const update = {}
    for (const key of ['title', 'remind_at', 'calendar_id', 'color', 'is_done']) {
      if (req.body?.[key] !== undefined) update[key] = req.body[key]
    }

    const { data, error } = await withReminderTable((table) =>
      supabase
        .from(table)
        .update(update)
        .eq('id', req.params.id)
        .select('id, title, remind_at, calendar_id, color, is_done')
        .single()
    )

    if (error) throw error
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.delete('/api/reminders/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    const { error } = await withReminderTable((table) =>
      supabase
        .from(table)
        .delete()
        .eq('id', req.params.id)
        .eq('workspace_id', workspaceId)
    )

    if (error) throw error
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/notes', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    const { data, error } = await supabase
      .from('notes')
      .select('id, title, content, date, mood, source, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .limit(100)

    if (error) throw error
    res.json(data ?? [])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/notes', authMiddleware, rateLimit('write'), quotaGuard('notes'), async (req, res) => {
  try {
    const workspaceId = req.workspaceId
    const title = String(req.body?.title ?? 'Untitled').trim() || 'Untitled'
    const content = String(req.body?.content ?? '').trim()
    const date = String(req.body?.date ?? new Date().toISOString().slice(0, 10)).trim()
    const mood = req.body?.mood ? String(req.body.mood).trim() : null
    const source = req.body?.source ? String(req.body.source).trim() : 'workspace'

    const { data, error } = await supabase
      .from('notes')
      .insert({
        workspace_id: workspaceId,
        user_id: req.authUser.id,
        title,
        content,
        date,
        mood,
        source,
      })
      .select('id, title, content, date, mood, source, created_at, updated_at')
      .single()

    if (error) throw error
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.patch('/api/notes/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    const update = {}

    if (req.body?.title !== undefined) update.title = String(req.body.title ?? '').trim() || 'Untitled'
    if (req.body?.content !== undefined) update.content = String(req.body.content ?? '')
    if (req.body?.date !== undefined) update.date = String(req.body.date ?? new Date().toISOString().slice(0, 10)).trim()
    if (req.body?.mood !== undefined) update.mood = req.body.mood ? String(req.body.mood).trim() : null
    if (req.body?.source !== undefined) update.source = String(req.body.source ?? 'workspace').trim() || 'workspace'

    update.updated_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('notes')
      .update(update)
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId)
      .select('id, title, content, date, mood, source, created_at, updated_at')
      .single()

    if (error) throw error
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.delete('/api/notes/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req.authUser.id)
    const { error } = await supabase.from('notes').delete().eq('id', req.params.id).eq('workspace_id', workspaceId)
    if (error) throw error
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/daily-accountability', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const today = String(req.headers['x-ledger-day-key'] ?? new Date().toISOString().slice(0, 10))

    const { data, error } = await supabase
      .from('daily_accountability')
      .select('focus_items, checkin_finished, checkin_blocked, checkin_first_task_tomorrow, entry_date, updated_at')
      .eq('user_id', req.authUser.id)
      .eq('entry_date', today)
      .maybeSingle()

    if (error) throw error
    res.json(data ?? null)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/daily-accountability', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const today = String(req.headers['x-ledger-day-key'] ?? new Date().toISOString().slice(0, 10))

    const payload = {
      user_id: req.authUser.id,
      entry_date: today,
      focus_items: safeJson(req.body?.focus_items, []),
      checkin_finished: String(req.body?.finished ?? '').trim(),
      checkin_blocked: String(req.body?.blocked ?? '').trim(),
      checkin_first_task_tomorrow: String(req.body?.first_task_tomorrow ?? '').trim(),
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('daily_accountability')
      .upsert(payload, { onConflict: 'user_id,entry_date' })
      .select('focus_items, checkin_finished, checkin_blocked, checkin_first_task_tomorrow, entry_date, updated_at')
      .single()

    if (error) throw error
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.use((error, req, res, next) => {
  console.error(error)
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`)
})
