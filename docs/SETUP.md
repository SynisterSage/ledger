# Ledger - Setup Guide

## Project Structure Setup ✅

Your project is now scaffolded with:

```
ledger/
├── src/
│   ├── components/
│   │   ├── Sidebar/
│   │   ├── Dashboard/
│   │   ├── Tasks/
│   │   ├── TimeTracking/
│   │   ├── Goals/
│   │   ├── Calendar/
│   │   └── Common/
│   ├── pages/
│   ├── context/
│   ├── hooks/
│   ├── services/
│   │   └── supabase.ts (ready to connect)
│   ├── types/
│   │   └── database.ts (schema types)
│   ├── utils/
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css (Tailwind)
├── electron/
│   ├── main.ts
│   └── preload.ts
├── tailwind.config.ts ✅
├── postcss.config.js ✅
├── vite.config.ts (React configured) ✅
└── package.json (React + Supabase ready) ✅
```

## Tech Stack
- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS
- **Desktop**: Electron (macOS app)
- **State**: Zustand (ready to use)
- **Backend**: Supabase (PostgreSQL + Auth)
- **Icons**: Lucide React

## Next Steps

### 1. Set Up Environment Variables
```bash
cp .env.example .env.local
```

Then add your Supabase credentials:
- `VITE_SUPABASE_URL` - Your project URL
- `VITE_SUPABASE_ANON_KEY` - Your anon key

### 2. (On Your End) Set Up Supabase
1. Create a new Supabase project at https://supabase.com
2. Run the SQL migrations (we'll create these next)
3. Configure RLS policies
4. Generate TypeScript types with:
   ```bash
   npx supabase gen types typescript --project-id <your-project-id> > src/types/database.ts
   ```

### 3. Test the Dev Environment
```bash
npm run dev
```

The app should open with Vite dev server + Electron.

## File Reference

### Supabase Configuration
- **Client**: `src/services/supabase.ts`
- **Types**: `src/types/database.ts`
- **Env**: `.env.local` (not tracked, see `.env.example`)

### Design System
- **Colors**: `tailwind.config.ts` (macOS colors)
- **Typography**: SF Pro (Display/Text)
- **Base CSS**: `src/index.css`

### App Entry Points
- **Electron Main**: `electron/main.ts`
- **React App**: `src/App.tsx`
- **Styles**: `src/index.css`

## What's Ready

✅ Electron + React + TypeScript scaffold
✅ Tailwind CSS with macOS color palette
✅ Supabase client configured (needs .env.local)
✅ Database types placeholder (ready for generation)
✅ Folder structure for all planned features
✅ Package.json with all dependencies

## What's Next (Your End)

1. Add `.env.local` with Supabase credentials
2. Set up Supabase project + create SQL tables
3. I'll help you build:
   - Auth system (login/signup)
   - Sidebar widget component
   - Task management
   - Time tracking
   - Dashboard

---

Ready to dive into Supabase setup on your end, or should we start building components?
