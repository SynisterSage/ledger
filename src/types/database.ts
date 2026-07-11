// Database types - generated from Supabase (placeholder for now)
// Run: npx supabase gen types typescript --project-id <your-project-id> > src/types/database.ts

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          active_workspace_id: string | null;
          onboarding_completed: boolean;
          onboarding_completed_at: string | null;
          preferences: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          active_workspace_id?: string | null;
          onboarding_completed?: boolean;
          onboarding_completed_at?: string | null;
          preferences?: Record<string, unknown>;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          active_workspace_id?: string | null;
          onboarding_completed?: boolean;
          onboarding_completed_at?: string | null;
          preferences?: Record<string, unknown>;
          updated_at?: string;
        };
      };
      workspaces: {
        Row: {
          id: string;
          name: string;
          owner_id: string;
          is_personal: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          owner_id: string;
          is_personal?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          is_personal?: boolean;
          updated_at?: string;
        };
      };
      inbox_items: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string | null;
          updated_by: string | null;
          source: string;
          source_provider: string | null;
          source_id: string | null;
          source_url: string | null;
          title: string;
          body: string | null;
          raw_payload: Record<string, unknown> | null;
          suggested_type: string | null;
          suggested_project_id: string | null;
          suggested_assignee_id: string | null;
          suggested_calendar_id: string | null;
          suggested_note_section_id: string | null;
          suggested_date: string | null;
          suggested_due_at: string | null;
          status: 'unprocessed' | 'converted' | 'snoozed' | 'archived';
          converted_type: string | null;
          converted_id: string | null;
          converted_at: string | null;
          converted_by: string | null;
          archived_at: string | null;
          archived_by: string | null;
          snoozed_until: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          user_id?: string | null;
          updated_by?: string | null;
          source: string;
          source_provider?: string | null;
          source_id?: string | null;
          source_url?: string | null;
          title: string;
          body?: string | null;
          raw_payload?: Record<string, unknown> | null;
          suggested_type?: string | null;
          suggested_project_id?: string | null;
          suggested_assignee_id?: string | null;
          suggested_calendar_id?: string | null;
          suggested_note_section_id?: string | null;
          suggested_date?: string | null;
          suggested_due_at?: string | null;
          status?: 'unprocessed' | 'converted' | 'snoozed' | 'archived';
          converted_type?: string | null;
          converted_id?: string | null;
          converted_at?: string | null;
          converted_by?: string | null;
          archived_at?: string | null;
          archived_by?: string | null;
          snoozed_until?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string | null;
          updated_by?: string | null;
          source?: string;
          source_provider?: string | null;
          source_id?: string | null;
          source_url?: string | null;
          title?: string;
          body?: string | null;
          raw_payload?: Record<string, unknown> | null;
          suggested_type?: string | null;
          suggested_project_id?: string | null;
          suggested_assignee_id?: string | null;
          suggested_calendar_id?: string | null;
          suggested_note_section_id?: string | null;
          suggested_date?: string | null;
          suggested_due_at?: string | null;
          status?: 'unprocessed' | 'converted' | 'snoozed' | 'archived';
          converted_type?: string | null;
          converted_id?: string | null;
          converted_at?: string | null;
          converted_by?: string | null;
          archived_at?: string | null;
          archived_by?: string | null;
          snoozed_until?: string | null;
          updated_at?: string;
        };
      };
      categories: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          color: string;
          icon: string | null;
          order: number;
          created_at: string;
        };
      };
      projects: {
        Row: {
          id: string;
          workspace_id: string;
          category_id: string;
          name: string;
          description: string | null;
          status: 'NotStarted' | 'InProgress' | 'Paused' | 'Completed';
          start_date: string | null;
          end_date: string | null;
          project_type: string | null;
          lead_id: string | null;
          color: string;
          created_at: string;
          updated_at: string;
        };
      };
      tasks: {
        Row: {
          id: string;
          workspace_id: string;
          project_id: string | null;
          milestone_id: string | null;
          title: string;
          description: string | null;
          notes: string | null;
          due_date: string | null;
          due_time: string | null;
          status: 'todo' | 'in_progress' | 'completed' | 'cancelled';
          priority: 'low' | 'medium' | 'high' | 'urgent';
          assigned_to: string | null;
          tags: string[];
          task_horizon: 'today' | 'long_term';
          show_in_today: boolean;
          is_today_focus: boolean;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      time_entries: {
        Row: {
          id: string;
          workspace_id: string;
          task_id: string | null;
          project_id: string | null;
          user_id: string;
          duration_minutes: number;
          date: string;
          start_time: string | null;
          end_time: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      goals: {
        Row: {
          id: string;
          workspace_id: string;
          title: string;
          target_value: number;
          unit: string;
          start_date: string;
          end_date: string | null;
          progress: number;
          status: 'active' | 'completed' | 'failed';
          created_at: string;
        };
      };
      notes: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          updated_by: string | null;
          title: string;
          content: string;
          date: string;
          mood: string | null;
          source: string;
          parent_id: string | null;
          sort_order: number;
          depth: number;
          created_at: string;
          updated_at: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
