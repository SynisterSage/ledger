# Ledger - Architecture & Planning

## 1. HIGH-LEVEL OVERVIEW

### Vision
A macOS Electron app that lives as a persistent sidebar widget on the desktop, expandable to a full dashboard. Users can track work (internships/jobs), school, and personal tasks with time tracking, scheduling, and progress reports.

### App Name
**Ledger** - A reference to accounting ledgers, tracking your work like a ledger tracks transactions.

### Tech Stack
- **Frontend**: Electron + React + TypeScript + Tailwind CSS (macOS native styling)
- **Backend**: Supabase (PostgreSQL + Auth + Real-time Sync)
- **Database**: PostgreSQL (via Supabase)
- **State Management**: Zustand
- **UI**: macOS native design system
- **Icons**: Lucide React
- **Build**: Vite + Electron

---

## 2. DESIGN SYSTEM

### Color Palette
```
Primary:    #007AFF (macOS blue)
Secondary:  #5AC8FA (lighter blue)
Success:    #34C759 (green)
Warning:    #FF9500 (orange)
Error:      #FF3B30 (red)
Neutral:    #F5F5F7 (light gray)
Dark:       #1D1D1D (dark)
Text:       #000000 / #FFFFFF (light/dark mode)
```

### Typography
- Headline: SF Pro Display (24px, bold)
- Subheading: SF Pro Display (18px, semibold)
- Body: SF Pro Text (14px, regular)
- Caption: SF Pro Text (12px, regular)

### Component Library
- [ ] Button (primary, secondary, ghost, danger)
- [ ] Input (text, number, time, date, select)
- [ ] Card (task, project, activity)
- [ ] Modal/Dialog
- [ ] Sidebar/Navigation
- [ ] Timer widget
- [ ] Progress bar
- [ ] Tag/Badge
- [ ] Dropdown menu
- [ ] Calendar widget
- [ ] Time picker

---

## 3. DATABASE SCHEMA (PostgreSQL)

### Core Tables

#### `users`
```sql
id: UUID (primary key)
email: VARCHAR (unique)
name: VARCHAR
avatar_url: TEXT (nullable)
created_at: TIMESTAMP
updated_at: TIMESTAMP
```

#### `workspaces` (for team mode)
```sql
id: UUID
name: VARCHAR
owner_id: UUID (fk: users.id)
is_personal: BOOLEAN (default: true)
created_at: TIMESTAMP
updated_at: TIMESTAMP
```

#### `workspace_members`
```sql
id: UUID
workspace_id: UUID (fk: workspaces.id)
user_id: UUID (fk: users.id)
role: ENUM ('admin', 'member', 'viewer')
joined_at: TIMESTAMP
```

#### `categories`
```sql
id: UUID
workspace_id: UUID (fk: workspaces.id)
name: VARCHAR (e.g., "Internship", "School", "Personal")
color: VARCHAR (hex color)
icon: VARCHAR (SF Symbol name)
order: INTEGER
created_at: TIMESTAMP
```

#### `projects`
```sql
id: UUID
workspace_id: UUID (fk: workspaces.id)
category_id: UUID (fk: categories.id)
name: VARCHAR
description: TEXT (nullable)
status: ENUM ('active', 'archived', 'completed')
start_date: DATE (nullable)
end_date: DATE (nullable)
color: VARCHAR
created_at: TIMESTAMP
updated_at: TIMESTAMP
```

#### `tasks`
```sql
id: UUID
workspace_id: UUID (fk: workspaces.id)
project_id: UUID (fk: projects.id, nullable - for loose tasks)
title: VARCHAR
description: TEXT (nullable)
due_date: DATE (nullable)
due_time: TIME (nullable)
status: ENUM ('todo', 'in_progress', 'completed', 'cancelled')
priority: ENUM ('low', 'medium', 'high', 'urgent')
assigned_to: UUID (fk: users.id, nullable - for team)
tags: TEXT[] (array of strings)
created_at: TIMESTAMP
updated_at: TIMESTAMP
```

#### `time_entries`
```sql
id: UUID
workspace_id: UUID
task_id: UUID (fk: tasks.id, nullable)
project_id: UUID (fk: projects.id, nullable)
user_id: UUID (fk: users.id)
duration_minutes: INTEGER
date: DATE
start_time: TIME (nullable)
end_time: TIME (nullable)
notes: TEXT (nullable)
created_at: TIMESTAMP
updated_at: TIMESTAMP
```

#### `goals`
```sql
id: UUID
workspace_id: UUID
title: VARCHAR
target_value: NUMERIC (e.g., 40 hours/week)
unit: VARCHAR (e.g., "hours", "tasks", "score")
start_date: DATE
end_date: DATE (nullable - ongoing)
progress: NUMERIC
status: ENUM ('active', 'completed', 'failed')
created_at: TIMESTAMP
```

#### `notes` (Journal entries)
```sql
id: UUID
workspace_id: UUID
user_id: UUID (fk: users.id)
title: VARCHAR
content: TEXT
date: DATE
mood: VARCHAR (nullable - emoji or 1-5)
created_at: TIMESTAMP
updated_at: TIMESTAMP
```

---

## 4. BACKEND (Supabase)

### Authentication
- Email/password signup + login
- Google OAuth (optional)
- Session management via JWT (Supabase handles)

### Row Level Security (RLS) Policies
- Users can only see their own workspaces
- Team members can see shared workspace data
- Personal workspace is private by default

### Real-time Features (Supabase Realtime)
- Live task updates in team mode
- Real-time time tracking
- Goal progress updates

---

## 5. FRONTEND ARCHITECTURE

### Directory Structure
```
src/
├── components/
│   ├── Sidebar/
│   │   ├── CompactSidebar.tsx      (widget mode)
│   │   ├── ExpandedSidebar.tsx     (semi-expanded)
│   │   └── SidebarToggle.tsx
│   ├── Dashboard/
│   │   ├── Dashboard.tsx
│   │   ├── DailyOverview.tsx
│   │   ├── WeeklyView.tsx
│   │   └── StatsPanel.tsx
│   ├── Tasks/
│   │   ├── TaskList.tsx
│   │   ├── TaskCard.tsx
│   │   └── TaskForm.tsx
│   ├── TimeTracking/
│   │   ├── Timer.tsx
│   │   ├── TimeEntryForm.tsx
│   │   └── TimeLog.tsx
│   ├── Goals/
│   │   ├── GoalCard.tsx
│   │   └── GoalProgress.tsx
│   ├── Calendar/
│   │   └── CalendarView.tsx
│   └── Common/
│       ├── Button.tsx
│       ├── Modal.tsx
│       ├── Input.tsx
│       └── Tag.tsx
├── pages/
│   ├── Home.tsx
│   ├── Projects.tsx
│   ├── Tasks.tsx
│   ├── TimeLog.tsx
│   ├── Goals.tsx
│   ├── Reports.tsx
│   ├── Journal.tsx
│   └── Settings.tsx
├── context/
│   ├── AuthContext.tsx
│   ├── WorkspaceContext.tsx
│   └── AppContext.tsx
├── hooks/
│   ├── useAuth.ts
│   ├── useTasks.ts
│   ├── useTimeTracking.ts
│   └── useGoals.ts
├── services/
│   ├── supabase.ts
│   ├── auth.ts
│   ├── tasks.ts
│   ├── timeTracking.ts
│   └── goals.ts
└── utils/
    ├── formatters.ts
    ├── calculations.ts
    └── validators.ts
```

### Key Contexts
- **AuthContext**: User auth state, login/logout
- **WorkspaceContext**: Current workspace, workspace members
- **AppContext**: UI state (sidebar expanded?, current view?, etc.)

---

## 6. WIDGET/SIDEBAR MECHANICS

### State Flow
```
Minimized (30px bar on left)
├─ Shows: date, quick stats (tasks due today, time logged)
├─ Always visible on desktop
└─ On hover/click → Semi-expanded

Semi-expanded (200px)
├─ Shows: today's summary, quick action buttons
├─ Quick add task, start timer buttons
├─ Close button
└─ On full click/button → Fully expanded

Fully expanded (Full app window)
├─ Dashboard with all features
├─ All navigation options
├─ Can collapse back to semi-expanded or minimize
```

### Auto-hide Behavior
- Always-on-top toggle in settings
- Snap to left side of screen
- Optional minimize to taskbar on focus loss

---

## 7. CORE FEATURES (MVP → v2)

### MVP (Phase 1)
- [ ] User auth (signup/login)
- [ ] Personal workspace setup
- [ ] Basic task CRUD
- [ ] Basic time tracking (timer + manual entry)
- [ ] Today's overview
- [ ] Sidebar widget (compact + semi-expanded views)

### Phase 2
- [ ] Projects organization
- [ ] Categories
- [ ] Recurring tasks
- [ ] Weekly/monthly reports
- [ ] Calendar view
- [ ] Journal/notes

### Phase 3
- [ ] Team workspaces
- [ ] Task sharing & assignment
- [ ] Goals tracking
- [ ] Advanced analytics
- [ ] Mobile companion (iOS app)

---

## 8. SECURITY CONSIDERATIONS

### Data Protection
- All data encrypted in transit (HTTPS/TLS)
- Supabase handles password hashing (bcrypt)
- JWT tokens expire after 1 hour (Supabase default)
- Refresh token stored securely in electron-store

### Privacy
- Personal workspace data never shared by default
- Users must explicitly invite others to team workspace
- RLS policies enforce workspace isolation
- No tracking/analytics without consent

### Best Practices
- No sensitive data (passwords, tokens) logged to console
- Secure storage for auth tokens (electron-store with encryption)
- CORS properly configured on Supabase
- Supabase RLS policies reviewed before deploy

---

## 9. DEVELOPMENT ROADMAP

### Week 1: Setup & Auth ✅ (In Progress)
- [x] Electron + React scaffold
- [x] Tailwind CSS setup
- [x] Supabase client configured
- [ ] Auth flow (signup/login)
- [ ] Basic routing

### Week 2: Sidebar & UI System
- [ ] Design system components
- [ ] Sidebar toggle logic
- [ ] Responsive widget states

### Week 3: Tasks & Core Features
- [ ] Task CRUD
- [ ] Task list UI
- [ ] Basic time tracking

### Week 4: Dashboard & Reports
- [ ] Dashboard layout
- [ ] Daily/weekly overview
- [ ] Reports generation

### Week 5+: Polish & Advanced Features
- [ ] User testing
- [ ] Performance optimization
- [ ] Team mode setup
- [ ] Goals & journal

---

## 10. DEPLOYMENT & DISTRIBUTION

### macOS App Distribution
- Option 1: Direct app (.dmg) distribution from website
- Option 2: Mac App Store
- Option 3: Homebrew cask

### Backend (Supabase)
- Already hosted on Supabase cloud
- No deployment needed (managed service)

### Versioning & Updates
- Use electron-updater for auto-updates
- Semantic versioning (v1.0.0, etc.)

---

## Project Status

**Completed:**
✅ Architecture planning
✅ Tech stack selection (Electron + React + Supabase)
✅ Database schema design
✅ Folder structure
✅ Design system colors & typography
✅ Tailwind CSS configured
✅ Supabase client ready

**Current Phase:**
🔄 Environment setup (waiting on your Supabase project)
🔄 Auth system implementation

**Next:**
- Set up Supabase project + SQL migrations
- Build auth flow
- Create sidebar widget
- Build task management
