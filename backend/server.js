import express from 'express'
import cors from 'cors'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import crypto from 'node:crypto'

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
const workspaceRoleRank = { viewer: 1, member: 2, admin: 3, owner: 4 }
const workspaceMemberRoles = ['admin', 'member', 'viewer']

const normalizeProjectSemanticStatus = (status) => {
  const value = String(status ?? '').toLowerCase()
  if (value.includes('complete')) return 'completed'
  if (value.includes('pause') || value.includes('archiv') || value.includes('hold')) return 'paused'
  if (value.includes('progress') || value.includes('doing') || value.includes('in_')) return 'in_progress'
  return 'not_started'
}

const normalizeProjectNameKey = (value) => String(value ?? '').trim().toLowerCase()

const dedupeProjectsByName = (projects) => {
  const seen = new Set()
  return (projects ?? []).filter((project) => {
    const key = `${project.workspace_id ?? ''}:${normalizeProjectNameKey(project.name)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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

const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase()

const isValidWorkspaceMemberRole = (role) => workspaceMemberRoles.includes(String(role ?? '').toLowerCase())

const roleAtLeast = (role, minimumRole) => {
  const currentRank = workspaceRoleRank[String(role ?? '').toLowerCase()] ?? 0
  const minimumRank = workspaceRoleRank[String(minimumRole ?? '').toLowerCase()] ?? 0
  return currentRank >= minimumRank
}

const isMissingColumnError = (error, columnName) => {
  const message = String(error?.message ?? '').toLowerCase()
  return message.includes('column') && message.includes(String(columnName).toLowerCase()) && message.includes('does not exist')
}

const getRequestedWorkspaceId = (req) => {
  const headerWorkspace = req.headers['x-workspace-id']
  if (typeof headerWorkspace === 'string' && headerWorkspace.trim()) {
    return headerWorkspace.trim()
  }

  if (Array.isArray(headerWorkspace) && headerWorkspace[0]?.trim()) {
    return headerWorkspace[0].trim()
  }

  const queryWorkspace = String(req.query?.workspaceId ?? '').trim()
  if (queryWorkspace) {
    return queryWorkspace
  }

  return null
}

const getUserWorkspaceIds = async (userId) => {
  const [ownedResult, memberResult] = await Promise.all([
    supabase
      .from('workspaces')
      .select('id')
      .eq('owner_id', userId),
    supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId),
  ])

  if (ownedResult.error) throw ownedResult.error
  if (memberResult.error) throw memberResult.error

  const ids = new Set()
  for (const row of ownedResult.data ?? []) {
    if (row?.id) ids.add(row.id)
  }
  for (const row of memberResult.data ?? []) {
    if (row?.workspace_id) ids.add(row.workspace_id)
  }

  return ids
}

const isWorkspaceAccessibleToUser = async (userId, workspaceId) => {
  if (!workspaceId) return false
  const workspaceIds = await getUserWorkspaceIds(userId)
  return workspaceIds.has(workspaceId)
}

const getWorkspaceAccess = async (userId, workspaceId) => {
  const workspaceResult = await supabase
    .from('workspaces')
    .select('id, owner_id, name, description, is_personal, color, created_at, updated_at')
    .eq('id', workspaceId)
    .maybeSingle()

  if (workspaceResult.error) throw workspaceResult.error
  const workspace = workspaceResult.data
  if (!workspace) return null

  if (workspace.owner_id === userId) {
    return { workspace, role: 'owner' }
  }

  const memberResult = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()

  if (memberResult.error) throw memberResult.error
  if (!memberResult.data?.role) {
    return null
  }

  return {
    workspace,
    role: String(memberResult.data.role).toLowerCase(),
  }
}

const requireWorkspaceAccess = async (userId, workspaceId, minimumRole = 'member') => {
  const access = await getWorkspaceAccess(userId, workspaceId)
  if (!access || !roleAtLeast(access.role, minimumRole)) {
    const error = new Error('Workspace access denied')
    error.statusCode = 403
    throw error
  }

  return access
}

const getUserActiveWorkspaceId = async (userId) => {
  const result = await supabase
    .from('users')
    .select('active_workspace_id')
    .eq('id', userId)
    .maybeSingle()

  if (result.error) {
    if (isMissingColumnError(result.error, 'active_workspace_id')) {
      return null
    }
    throw result.error
  }

  return result.data?.active_workspace_id ?? null
}

const setUserActiveWorkspaceId = async (userId, workspaceId) => {
  const result = await supabase
    .from('users')
    .update({ active_workspace_id: workspaceId, updated_at: new Date().toISOString() })
    .eq('id', userId)

  if (result.error && !isMissingColumnError(result.error, 'active_workspace_id')) {
    throw result.error
  }
}

const resolveWorkspaceId = async (userId, requestedWorkspaceId = null) => {
  if (requestedWorkspaceId) {
    const allowed = await isWorkspaceAccessibleToUser(userId, requestedWorkspaceId)
    if (allowed) {
      await setUserActiveWorkspaceId(userId, requestedWorkspaceId)
      return requestedWorkspaceId
    }
  }

  const activeWorkspaceId = await getUserActiveWorkspaceId(userId)
  if (activeWorkspaceId) {
    const allowed = await isWorkspaceAccessibleToUser(userId, activeWorkspaceId)
    if (allowed) {
      return activeWorkspaceId
    }
  }

  const personalWorkspace = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_id', userId)
    .eq('is_personal', true)
    .maybeSingle()

  if (personalWorkspace.error) throw personalWorkspace.error
  if (personalWorkspace.data?.id) {
    await setUserActiveWorkspaceId(userId, personalWorkspace.data.id)
    return personalWorkspace.data.id
  }

  const membershipWorkspace = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (membershipWorkspace.error) throw membershipWorkspace.error
  if (membershipWorkspace.data?.workspace_id) {
    await setUserActiveWorkspaceId(userId, membershipWorkspace.data.workspace_id)
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

  if (createdWorkspace.error) throw createdWorkspace.error
  if (createdWorkspace.data?.id) {
    await setUserActiveWorkspaceId(userId, createdWorkspace.data.id)
    return createdWorkspace.data.id
  }

  throw new Error('Workspace not available')
}

const resolveWorkspaceIdForRequest = async (req) => {
  const requestedWorkspaceId = getRequestedWorkspaceId(req)
  return resolveWorkspaceId(req.authUser.id, requestedWorkspaceId)
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

const writeWorkspaceAuditLog = async ({
  workspaceId,
  actorUserId,
  action,
  targetType = null,
  targetId = null,
  metadata = null,
}) => {
  try {
    const payload = {
      workspace_id: workspaceId,
      actor_user_id: actorUserId,
      action: String(action ?? '').trim(),
      target_type: targetType,
      target_id: targetId,
      metadata: metadata ?? null,
    }

    if (!payload.workspace_id || !payload.actor_user_id || !payload.action) {
      return
    }

    const { error } = await supabase
      .from('workspace_audit_logs')
      .insert(payload)

    if (error && !isMissingTableError(error)) {
      console.error('Failed to write workspace audit log:', error.message)
    }
  } catch (error) {
    console.error('Unexpected audit log failure:', error?.message ?? error)
  }
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
    const workspaceId = await resolveWorkspaceIdForRequest(req)
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

app.get('/api/workspaces', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const userId = req.authUser.id
    const [ownedResult, memberResult] = await Promise.all([
      supabase
        .from('workspaces')
        .select('id, name, description, is_personal, color, owner_id, created_at, updated_at')
        .eq('owner_id', userId)
        .order('created_at', { ascending: true }),
      supabase
        .from('workspace_members')
        .select('workspace_id, role, joined_at')
        .eq('user_id', userId),
    ])

    if (ownedResult.error) throw ownedResult.error
    if (memberResult.error) throw memberResult.error

    const memberWorkspaceIds = (memberResult.data ?? []).map((row) => row.workspace_id)
    let memberWorkspaces = []

    if (memberWorkspaceIds.length > 0) {
      const memberWorkspaceResult = await supabase
        .from('workspaces')
        .select('id, name, description, is_personal, color, owner_id, created_at, updated_at')
        .in('id', memberWorkspaceIds)

      if (memberWorkspaceResult.error) throw memberWorkspaceResult.error
      memberWorkspaces = memberWorkspaceResult.data ?? []
    }

    const roleByWorkspaceId = new Map((memberResult.data ?? []).map((row) => [row.workspace_id, row.role]))
    const merged = [...(ownedResult.data ?? []), ...memberWorkspaces]
    const dedupedById = new Map()

    for (const workspace of merged) {
      if (!workspace?.id) continue
      const role = workspace.owner_id === userId ? 'owner' : (roleByWorkspaceId.get(workspace.id) ?? 'member')
      dedupedById.set(workspace.id, {
        ...workspace,
        role,
      })
    }

    const sorted = [...dedupedById.values()].sort((a, b) => {
      if (a.is_personal !== b.is_personal) return a.is_personal ? -1 : 1
      return String(a.name ?? '').localeCompare(String(b.name ?? ''))
    })

    res.json(sorted)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/workspaces/active', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const activeWorkspaceId = await resolveWorkspaceIdForRequest(req)
    const { data, error } = await supabase
      .from('workspaces')
      .select('id, name, description, is_personal, color, owner_id, created_at, updated_at')
      .eq('id', activeWorkspaceId)
      .maybeSingle()

    if (error) throw error
    res.json({ workspace_id: activeWorkspaceId, workspace: data ?? null })
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message })
  }
})

app.patch('/api/workspaces/active', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = String(req.body?.workspace_id ?? '').trim()
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspace_id is required' })
    }

    const allowed = await isWorkspaceAccessibleToUser(req.authUser.id, workspaceId)
    if (!allowed) {
      return res.status(403).json({ error: 'Workspace access denied' })
    }

    await setUserActiveWorkspaceId(req.authUser.id, workspaceId)
    const activeWorkspaceId = workspaceId
    const { data, error } = await supabase
      .from('workspaces')
      .select('id, name, description, is_personal, color, owner_id, created_at, updated_at')
      .eq('id', activeWorkspaceId)
      .maybeSingle()

    if (error) throw error

    res.json({ workspace_id: activeWorkspaceId, workspace: data ?? null })
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message })
  }
})

app.get('/api/workspaces/:workspaceId/members', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = String(req.params.workspaceId)
    const access = await requireWorkspaceAccess(req.authUser.id, workspaceId, 'member')

    const membersResult = await supabase
      .from('workspace_members')
      .select('user_id, role, joined_at')
      .eq('workspace_id', workspaceId)

    if (membersResult.error) throw membersResult.error
    const memberRows = membersResult.data ?? []

    const userIds = [access.workspace.owner_id, ...memberRows.map((row) => row.user_id)]
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))]

    const usersResult = uniqueUserIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from('users')
          .select('id, email, full_name')
          .in('id', uniqueUserIds)

    if (usersResult.error) throw usersResult.error

    const userMap = new Map((usersResult.data ?? []).map((user) => [user.id, user]))

    const ownerUser = userMap.get(access.workspace.owner_id)
    const ownerRow = {
      user_id: access.workspace.owner_id,
      role: 'owner',
      joined_at: access.workspace.created_at,
      email: ownerUser?.email ?? null,
      full_name: ownerUser?.full_name ?? null,
      is_owner: true,
    }

    const normalizedMembers = memberRows
      .filter((row) => row.user_id !== access.workspace.owner_id)
      .map((row) => {
        const user = userMap.get(row.user_id)
        return {
          user_id: row.user_id,
          role: String(row.role).toLowerCase(),
          joined_at: row.joined_at,
          email: user?.email ?? null,
          full_name: user?.full_name ?? null,
          is_owner: false,
        }
      })
      .sort((a, b) => String(a.joined_at ?? '').localeCompare(String(b.joined_at ?? '')))

    res.json({
      current_user_role: access.role,
      members: [ownerRow, ...normalizedMembers],
    })
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message })
  }
})

app.patch('/api/workspaces/:workspaceId/members/:userId', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = String(req.params.workspaceId)
    const targetUserId = String(req.params.userId)
    const role = String(req.body?.role ?? '').toLowerCase()

    if (!isValidWorkspaceMemberRole(role)) {
      return res.status(400).json({ error: 'Invalid role' })
    }

    const access = await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin')

    if (targetUserId === access.workspace.owner_id) {
      return res.status(400).json({ error: 'Owner role cannot be changed' })
    }

    const existing = await supabase
      .from('workspace_members')
      .select('user_id, role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', targetUserId)
      .maybeSingle()

    if (existing.error) throw existing.error
    if (!existing.data?.user_id) {
      return res.status(404).json({ error: 'Member not found' })
    }

    const currentRole = String(existing.data.role ?? '').toLowerCase()
    if (access.role !== 'owner') {
      if (role === 'admin') {
        return res.status(403).json({ error: 'Only owners can assign admin role' })
      }
      if (currentRole === 'admin') {
        return res.status(403).json({ error: 'Only owners can modify admin members' })
      }
    }

    const updated = await supabase
      .from('workspace_members')
      .update({ role })
      .eq('workspace_id', workspaceId)
      .eq('user_id', targetUserId)
      .select('user_id, role, joined_at')
      .single()

    if (updated.error) throw updated.error
    await writeWorkspaceAuditLog({
      workspaceId,
      actorUserId: req.authUser.id,
      action: 'member.role_updated',
      targetType: 'workspace_member',
      targetId: targetUserId,
      metadata: {
        previous_role: currentRole,
        next_role: role,
        actor_role: access.role,
      },
    })
    res.json(updated.data)
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message })
  }
})

app.delete('/api/workspaces/:workspaceId/members/:userId', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = String(req.params.workspaceId)
    const targetUserId = String(req.params.userId)
    const access = await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin')

    if (targetUserId === access.workspace.owner_id) {
      return res.status(400).json({ error: 'Owner cannot be removed' })
    }

    if (targetUserId === req.authUser.id) {
      return res.status(400).json({ error: 'Use leave workspace flow for your own membership' })
    }

    const existing = await supabase
      .from('workspace_members')
      .select('user_id, role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', targetUserId)
      .maybeSingle()

    if (existing.error) throw existing.error
    if (!existing.data?.user_id) {
      return res.status(404).json({ error: 'Member not found' })
    }

    const currentRole = String(existing.data.role ?? '').toLowerCase()
    if (access.role !== 'owner' && currentRole === 'admin') {
      return res.status(403).json({ error: 'Only owners can remove admin members' })
    }

    const removed = await supabase
      .from('workspace_members')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', targetUserId)

    if (removed.error) throw removed.error
    await writeWorkspaceAuditLog({
      workspaceId,
      actorUserId: req.authUser.id,
      action: 'member.removed',
      targetType: 'workspace_member',
      targetId: targetUserId,
      metadata: {
        removed_role: currentRole,
        actor_role: access.role,
      },
    })
    res.json({ success: true })
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message })
  }
})

app.get('/api/workspaces/:workspaceId/invitations', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = String(req.params.workspaceId)
    const access = await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin')

    const invitationsResult = await supabase
      .from('workspace_invitations')
      .select('id, invited_email, role, status, expires_at, invited_by, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (invitationsResult.error) throw invitationsResult.error

    res.json({
      current_user_role: access.role,
      invitations: invitationsResult.data ?? [],
    })
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message })
  }
})

app.post('/api/workspaces/:workspaceId/invitations', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = String(req.params.workspaceId)
    const access = await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin')
    const invitedEmail = normalizeEmail(req.body?.email)
    const role = String(req.body?.role ?? 'member').toLowerCase()

    if (!invitedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invitedEmail)) {
      return res.status(400).json({ error: 'Valid email is required' })
    }

    if (!isValidWorkspaceMemberRole(role)) {
      return res.status(400).json({ error: 'Invalid invitation role' })
    }

    if (access.role !== 'owner' && role === 'admin') {
      return res.status(403).json({ error: 'Only owners can invite admins' })
    }

    const ownerEmailResult = await supabase
      .from('users')
      .select('email')
      .eq('id', access.workspace.owner_id)
      .maybeSingle()

    if (ownerEmailResult.error) throw ownerEmailResult.error
    if (normalizeEmail(ownerEmailResult.data?.email) === invitedEmail) {
      return res.status(409).json({ error: 'User is already the workspace owner' })
    }

    const existingUserResult = await supabase
      .from('users')
      .select('id, email')
      .ilike('email', invitedEmail)
      .maybeSingle()

    if (existingUserResult.error) throw existingUserResult.error

    if (existingUserResult.data?.id) {
      const membershipResult = await supabase
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', workspaceId)
        .eq('user_id', existingUserResult.data.id)
        .maybeSingle()

      if (membershipResult.error) throw membershipResult.error
      if (membershipResult.data?.user_id) {
        return res.status(409).json({ error: 'User is already a member of this workspace' })
      }
    }

    const existingPending = await supabase
      .from('workspace_invitations')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('invited_email', invitedEmail)
      .eq('status', 'pending')
      .maybeSingle()

    if (existingPending.error) throw existingPending.error
    if (existingPending.data?.id) {
      return res.status(409).json({ error: 'A pending invitation already exists for this email' })
    }

    const token = crypto.randomBytes(24).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const insertResult = await supabase
      .from('workspace_invitations')
      .insert({
        workspace_id: workspaceId,
        invited_email: invitedEmail,
        role,
        invited_by: req.authUser.id,
        token_hash: tokenHash,
        status: 'pending',
        expires_at: expiresAt,
      })
      .select('id, invited_email, role, status, expires_at, invited_by, created_at')
      .single()

    if (insertResult.error) throw insertResult.error

    await writeWorkspaceAuditLog({
      workspaceId,
      actorUserId: req.authUser.id,
      action: 'invitation.created',
      targetType: 'workspace_invitation',
      targetId: insertResult.data.id,
      metadata: {
        invited_email: invitedEmail,
        role,
      },
    })

    const appUrl = process.env.APP_URL || process.env.VITE_APP_URL || 'http://localhost:5173'
    const inviteUrl = `${appUrl.replace(/\/$/, '')}/invite?token=${encodeURIComponent(token)}`

    res.json({
      invitation: insertResult.data,
      invite_url: inviteUrl,
      invite_token: token,
      current_user_role: access.role,
    })
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message })
  }
})

app.delete('/api/workspaces/:workspaceId/invitations/:invitationId', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = String(req.params.workspaceId)
    const invitationId = String(req.params.invitationId)
    await requireWorkspaceAccess(req.authUser.id, workspaceId, 'admin')

    const existing = await supabase
      .from('workspace_invitations')
      .select('id, status, role, invited_email')
      .eq('id', invitationId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (existing.error) throw existing.error
    if (!existing.data?.id) {
      return res.status(404).json({ error: 'Invitation not found' })
    }

    if (existing.data.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending invitations can be revoked' })
    }

    const existingRole = String(existing.data.role ?? '').toLowerCase()
    if (access.role !== 'owner' && existingRole === 'admin') {
      return res.status(403).json({ error: 'Only owners can revoke admin invitations' })
    }

    const updated = await supabase
      .from('workspace_invitations')
      .update({ status: 'revoked', updated_at: new Date().toISOString() })
      .eq('id', invitationId)
      .eq('workspace_id', workspaceId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()

    if (updated.error) throw updated.error
    if (!updated.data?.id) {
      return res.status(409).json({ error: 'Invitation state changed. Refresh and try again.' })
    }

    await writeWorkspaceAuditLog({
      workspaceId,
      actorUserId: req.authUser.id,
      action: 'invitation.revoked',
      targetType: 'workspace_invitation',
      targetId: invitationId,
      metadata: {
        invited_email: existing.data.invited_email,
        role: existingRole,
      },
    })

    res.json({ success: true })
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message })
  }
})

app.post('/api/invitations/accept', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const token = String(req.body?.token ?? '').trim()
    if (!token) {
      return res.status(400).json({ error: 'Invitation token is required' })
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const nowIso = new Date().toISOString()
    const authEmail = normalizeEmail(req.authUser.email)

    const claimedInviteResult = await supabase
      .from('workspace_invitations')
      .update({
        status: 'accepted',
        accepted_by: req.authUser.id,
        accepted_at: nowIso,
        updated_at: nowIso,
      })
      .eq('token_hash', tokenHash)
      .eq('status', 'pending')
      .eq('invited_email', authEmail)
      .gt('expires_at', nowIso)
      .select('id, workspace_id, invited_email, role, status, expires_at')
      .maybeSingle()

    if (claimedInviteResult.error) throw claimedInviteResult.error
    let invitation = claimedInviteResult.data

    if (!invitation?.id) {
      const existingInviteResult = await supabase
        .from('workspace_invitations')
        .select('id, workspace_id, invited_email, role, status, expires_at')
        .eq('token_hash', tokenHash)
        .maybeSingle()

      if (existingInviteResult.error) throw existingInviteResult.error
      const existingInvite = existingInviteResult.data

      if (!existingInvite?.id) {
        return res.status(404).json({ error: 'Invitation not found' })
      }

      if (String(existingInvite.expires_at) <= nowIso && existingInvite.status === 'pending') {
        await supabase
          .from('workspace_invitations')
          .update({ status: 'expired', updated_at: nowIso })
          .eq('id', existingInvite.id)
          .eq('status', 'pending')

        return res.status(400).json({ error: 'Invitation has expired' })
      }

      if (normalizeEmail(existingInvite.invited_email) !== authEmail) {
        return res.status(403).json({ error: 'Invitation email does not match your account' })
      }

      if (existingInvite.status !== 'pending') {
        return res.status(400).json({ error: 'Invitation is no longer active' })
      }

      return res.status(409).json({ error: 'Invitation state changed. Please retry.' })
    }

    const upsertMembership = await supabase
      .from('workspace_members')
      .upsert({
        workspace_id: invitation.workspace_id,
        user_id: req.authUser.id,
        role: String(invitation.role).toLowerCase(),
      }, { onConflict: 'workspace_id,user_id' })

    if (upsertMembership.error) throw upsertMembership.error

    await setUserActiveWorkspaceId(req.authUser.id, invitation.workspace_id)

    await writeWorkspaceAuditLog({
      workspaceId: invitation.workspace_id,
      actorUserId: req.authUser.id,
      action: 'invitation.accepted',
      targetType: 'workspace_invitation',
      targetId: invitation.id,
      metadata: {
        invited_email: invitation.invited_email,
        role: String(invitation.role).toLowerCase(),
      },
    })

    res.json({
      success: true,
      workspace_id: invitation.workspace_id,
    })
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message })
  }
})

app.get('/api/projects', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req)
    const includeCompleted = ['true', '1', 'yes'].includes(String(req.query?.includeCompleted ?? '').toLowerCase())
    const { data, error } = await supabase
      .from('projects')
      .select(projectSelectColumns)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(24)

    if (error) throw error
    const projects = dedupeProjectsByName(data ?? [])
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

    const { data: existingProject, error: existingError } = await supabase
      .from('projects')
      .select(projectSelectColumns)
      .eq('workspace_id', req.workspaceId)
      .ilike('name', name)
      .maybeSingle()

    if (existingError) throw existingError
    if (existingProject) {
      return res.json(existingProject)
    }

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
    const workspaceId = await resolveWorkspaceIdForRequest(req)
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
      const nameConflict = await supabase
        .from('projects')
        .select('id')
        .eq('workspace_id', workspaceId)
        .ilike('name', nextName)
        .neq('id', req.params.id)
        .maybeSingle()

      if (nameConflict.error) throw nameConflict.error
      if (nameConflict.data) {
        return res.status(409).json({ error: 'A project with that name already exists in this workspace' })
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
    const workspaceId = await resolveWorkspaceIdForRequest(req)
    const { error } = await supabase.from('projects').delete().eq('id', req.params.id).eq('workspace_id', workspaceId)
    if (error) throw error
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/tasks', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req)
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
    const workspaceId = await resolveWorkspaceIdForRequest(req)
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
    const workspaceId = await resolveWorkspaceIdForRequest(req)
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
    const workspaceId = await resolveWorkspaceIdForRequest(req)
    const { error } = await supabase.from('tasks').delete().eq('id', req.params.id).eq('workspace_id', workspaceId)
    if (error) throw error
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/calendars', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req)
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
    const workspaceId = await resolveWorkspaceIdForRequest(req)
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
    const workspaceId = await resolveWorkspaceIdForRequest(req)
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
    const workspaceId = await resolveWorkspaceIdForRequest(req)
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
    const workspaceId = await resolveWorkspaceIdForRequest(req)
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
    const workspaceId = await resolveWorkspaceIdForRequest(req)
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
    const workspaceId = await resolveWorkspaceIdForRequest(req)
    const { error } = await supabase.from('events').delete().eq('id', req.params.id).eq('workspace_id', workspaceId)
    if (error) throw error
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/reminders', authMiddleware, rateLimit('read'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req)
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
    const workspaceId = await resolveWorkspaceIdForRequest(req)
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
    const workspaceId = await resolveWorkspaceIdForRequest(req)
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
    const workspaceId = await resolveWorkspaceIdForRequest(req)
    const { data, error } = await supabase
      .from('notes')
      .select('id, title, content, date, mood, source, mode, mind_map_structure, created_at, updated_at')
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
    const workspaceId = req.workspaceId ?? await resolveWorkspaceIdForRequest(req)
    const title = String(req.body?.title ?? 'Untitled').trim() || 'Untitled'
    const content = String(req.body?.content ?? '').trim()
    const date = String(req.body?.date ?? new Date().toISOString().slice(0, 10)).trim()
    const mood = req.body?.mood ? String(req.body.mood).trim() : null
    const source = req.body?.source ? String(req.body.source).trim() : 'workspace'
    const mode = ['text', 'mind_map'].includes(req.body?.mode) ? req.body.mode : 'text'
    const mindMapStructure = mode === 'mind_map' && req.body?.mind_map_structure ? req.body.mind_map_structure : null

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
        mode,
        mind_map_structure: mindMapStructure,
      })
      .select('id, title, content, date, mood, source, mode, mind_map_structure, created_at, updated_at')
      .single()

    if (error) throw error
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.patch('/api/notes/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req)
    const update = {}

    if (req.body?.title !== undefined) update.title = String(req.body.title ?? '').trim() || 'Untitled'
    if (req.body?.content !== undefined) update.content = String(req.body.content ?? '')
    if (req.body?.date !== undefined) update.date = String(req.body.date ?? new Date().toISOString().slice(0, 10)).trim()
    if (req.body?.mood !== undefined) update.mood = req.body.mood ? String(req.body.mood).trim() : null
    if (req.body?.source !== undefined) update.source = String(req.body.source ?? 'workspace').trim() || 'workspace'
    if (req.body?.mode !== undefined) {
      const validMode = ['text', 'mind_map'].includes(req.body.mode) ? req.body.mode : 'text'
      update.mode = validMode
    }
    if (req.body?.mind_map_structure !== undefined) {
      update.mind_map_structure = req.body.mind_map_structure
    }

    update.updated_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('notes')
      .update(update)
      .eq('id', req.params.id)
      .eq('workspace_id', workspaceId)
      .select('id, title, content, date, mood, source, mode, mind_map_structure, created_at, updated_at')
      .single()

    if (error) throw error
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.delete('/api/notes/:id', authMiddleware, rateLimit('write'), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceIdForRequest(req)
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
