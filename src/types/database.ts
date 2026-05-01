// Database types - generated from Supabase (placeholder for now)
// Run: npx supabase gen types typescript --project-id <your-project-id> > src/types/database.ts

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          name: string | null
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          email: string
          name?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          name?: string | null
          avatar_url?: string | null
          updated_at?: string
        }
      }
      workspaces: {
        Row: {
          id: string
          name: string
          owner_id: string
          is_personal: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          owner_id: string
          is_personal?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          is_personal?: boolean
          updated_at?: string
        }
      }
      categories: {
        Row: {
          id: string
          workspace_id: string
          name: string
          color: string
          icon: string | null
          order: number
          created_at: string
        }
      }
      projects: {
        Row: {
          id: string
          workspace_id: string
          category_id: string
          name: string
          description: string | null
          status: 'active' | 'archived' | 'completed'
          start_date: string | null
          end_date: string | null
          color: string
          created_at: string
          updated_at: string
        }
      }
      tasks: {
        Row: {
          id: string
          workspace_id: string
          project_id: string | null
          title: string
          description: string | null
          due_date: string | null
          due_time: string | null
          status: 'todo' | 'in_progress' | 'completed' | 'cancelled'
          priority: 'low' | 'medium' | 'high' | 'urgent'
          assigned_to: string | null
          tags: string[]
          created_at: string
          updated_at: string
        }
      }
      time_entries: {
        Row: {
          id: string
          workspace_id: string
          task_id: string | null
          project_id: string | null
          user_id: string
          duration_minutes: number
          date: string
          start_time: string | null
          end_time: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
      }
      goals: {
        Row: {
          id: string
          workspace_id: string
          title: string
          target_value: number
          unit: string
          start_date: string
          end_date: string | null
          progress: number
          status: 'active' | 'completed' | 'failed'
          created_at: string
        }
      }
      notes: {
        Row: {
          id: string
          workspace_id: string
          user_id: string
          title: string
          content: string
          date: string
          mood: string | null
          created_at: string
          updated_at: string
        }
      }
    }
  }
}
