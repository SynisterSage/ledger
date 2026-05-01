# Ledger - Auth Setup Guide

## ✅ What's Done

### Backend (Supabase)
- [x] All database tables created (users, workspaces, tasks, projects, etc.)
- [x] Row Level Security (RLS) policies configured
- [x] Database indexes for performance

### Frontend (App)
- [x] Authentication service (`src/services/auth.ts`)
- [x] useAuth hook for auth state management
- [x] AuthContext provider for global auth state
- [x] LoginForm component with sign up/sign in
- [x] Workspace initialization on first login
- [x] Dashboard UI with user info

---

## 📋 Your Checklist (Supabase End)

### Step 1: Enable Email Auth
- [ ] Go to Supabase Dashboard
- [ ] Click **Authentication** → **Providers**
- [ ] Make sure **Email** is enabled (toggle ON)
- [ ] Confirm SMTP is configured (check "Confirm Signup Required" setting)

### Step 2: Create the Auto-Signup Trigger
- [ ] Go to **SQL Editor** in Supabase
- [ ] Copy the trigger SQL from below ⬇️
- [ ] Run it to create the auto-profile trigger

**SQL Trigger to Run:**
```sql
-- Trigger to create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name');
  
  -- Create default personal workspace
  INSERT INTO public.workspaces (owner_id, name, is_personal)
  VALUES (new.id, 'My Work', true);
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### Step 3: (Optional) Enable Google OAuth
- [ ] Go to **Authentication** → **Providers**
- [ ] Enable **Google**
- [ ] Add Google OAuth credentials (if you have them)

---

## 🚀 Ready to Test?

Once you've completed the Supabase checklist above, run the app:

```bash
npm run dev
```

### Test Flow:
1. **Sign up** with email + password
2. User profile auto-created in `users` table
3. Personal workspace "My Work" auto-created
4. Login redirects to dashboard
5. See welcome message with email
6. Click sign out button to test logout
7. Should redirect back to login

---

## 🔧 What Happens Behind the Scenes

### On Sign Up:
1. User enters email, password, full name
2. Supabase Auth creates auth user
3. Trigger fires → creates profile in `users` table
4. Trigger fires → creates `workspaces` entry
5. App detects auth change → shows dashboard

### On Sign In:
1. User enters email + password
2. Supabase returns session token
3. App loads user data from `users` table
4. Shows dashboard with personalized message

### On Sign Out:
1. Session cleared from Supabase
2. User state set to null
3. Redirects to login form

---

## 📚 File Reference

- **Auth Service**: `src/services/auth.ts`
- **useAuth Hook**: `src/hooks/useAuth.ts`
- **useWorkspaceInit Hook**: `src/hooks/useWorkspaceInit.ts`
- **Auth Context**: `src/context/AuthContext.tsx`
- **Login Form**: `src/components/Common/LoginForm.tsx`
- **App Entry**: `src/App.tsx`

---

## ⚠️ Troubleshooting

**Q: Sign up doesn't work?**
- Check Supabase Auth is enabled
- Check trigger was created successfully

**Q: User profile not created?**
- Verify trigger exists in Supabase
- Check Supabase logs for trigger errors

**Q: Can't see tasks/projects?**
- Make sure personal workspace was created
- Check RLS policies are correctly set

---

## Next Steps After Auth Works

1. ✅ Create workspace management page
2. ✅ Build task CRUD operations
3. ✅ Implement time tracking timer
4. ✅ Add calendar/schedule view
5. ✅ Create goals tracking
6. ✅ Add notes/journal feature

Good luck! 🎉
