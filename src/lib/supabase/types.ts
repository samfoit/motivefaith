export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      completions: {
        Row: {
          completed_at: string | null
          completed_date: string | null
          completion_type: Database["public"]["Enums"]["completion_type"] | null
          created_at: string | null
          evidence_url: string | null
          habit_id: string
          id: string
          notes: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          completed_date?: string | null
          completion_type?:
            | Database["public"]["Enums"]["completion_type"]
            | null
          created_at?: string | null
          evidence_url?: string | null
          habit_id: string
          id?: string
          notes?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          completed_date?: string | null
          completion_type?:
            | Database["public"]["Enums"]["completion_type"]
            | null
          created_at?: string | null
          evidence_url?: string | null
          habit_id?: string
          id?: string
          notes?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "completions_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_reports: {
        Row: {
          content_id: string
          content_type: string
          created_at: string | null
          description: string | null
          id: string
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id: string
          reviewed_at: string | null
          reviewer_notes: string | null
          status: Database["public"]["Enums"]["report_status"] | null
        }
        Insert: {
          content_id: string
          content_type: string
          created_at?: string | null
          description?: string | null
          id?: string
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id: string
          reviewed_at?: string | null
          reviewer_notes?: string | null
          status?: Database["public"]["Enums"]["report_status"] | null
        }
        Update: {
          content_id?: string
          content_type?: string
          created_at?: string | null
          description?: string | null
          id?: string
          reason?: Database["public"]["Enums"]["report_reason"]
          reporter_id?: string
          reviewed_at?: string | null
          reviewer_notes?: string | null
          status?: Database["public"]["Enums"]["report_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "content_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      encouragements: {
        Row: {
          content: string | null
          created_at: string | null
          encouragement_type:
            | Database["public"]["Enums"]["encouragement_type"]
            | null
          id: string
          is_read: boolean | null
          recipient_id: string
          user_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          encouragement_type?:
            | Database["public"]["Enums"]["encouragement_type"]
            | null
          id?: string
          is_read?: boolean | null
          recipient_id: string
          user_id: string
        }
        Update: {
          content?: string | null
          created_at?: string | null
          encouragement_type?:
            | Database["public"]["Enums"]["encouragement_type"]
            | null
          id?: string
          is_read?: boolean | null
          recipient_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "encouragements_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "encouragements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          addressee_id: string
          created_at: string | null
          id: string
          register_id: string
          status: Database["public"]["Enums"]["friendship_status"] | null
        }
        Insert: {
          addressee_id: string
          created_at?: string | null
          id?: string
          register_id: string
          status?: Database["public"]["Enums"]["friendship_status"] | null
        }
        Update: {
          addressee_id?: string
          created_at?: string | null
          id?: string
          register_id?: string
          status?: Database["public"]["Enums"]["friendship_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "friendships_addressee_id_fkey"
            columns: ["addressee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_register_id_fkey"
            columns: ["register_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_challenge_participants: {
        Row: {
          challenge_id: string
          habit_id: string | null
          id: string
          joined_at: string | null
          user_id: string
        }
        Insert: {
          challenge_id: string
          habit_id?: string | null
          id?: string
          joined_at?: string | null
          user_id: string
        }
        Update: {
          challenge_id?: string
          habit_id?: string | null
          id?: string
          joined_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_challenge_participants_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "group_challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_challenge_participants_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_challenge_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_challenges: {
        Row: {
          category: string | null
          color: string | null
          created_at: string | null
          created_by: string
          description: string | null
          emoji: string | null
          end_date: string | null
          frequency: Database["public"]["Enums"]["habit_frequency"]
          group_id: string
          id: string
          is_active: boolean | null
          schedule: Json | null
          start_date: string
          title: string
        }
        Insert: {
          category?: string | null
          color?: string | null
          created_at?: string | null
          created_by: string
          description?: string | null
          emoji?: string | null
          end_date?: string | null
          frequency?: Database["public"]["Enums"]["habit_frequency"]
          group_id: string
          id?: string
          is_active?: boolean | null
          schedule?: Json | null
          start_date?: string
          title: string
        }
        Update: {
          category?: string | null
          color?: string | null
          created_at?: string | null
          created_by?: string
          description?: string | null
          emoji?: string | null
          end_date?: string | null
          frequency?: Database["public"]["Enums"]["habit_frequency"]
          group_id?: string
          id?: string
          is_active?: boolean | null
          schedule?: Json | null
          start_date?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_challenges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_challenges_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_completion_reactions: {
        Row: {
          completion_id: string
          created_at: string | null
          emoji: string
          id: string
          user_id: string
        }
        Insert: {
          completion_id: string
          created_at?: string | null
          emoji?: string
          id?: string
          user_id: string
        }
        Update: {
          completion_id?: string
          created_at?: string | null
          emoji?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_completion_reactions_completion_id_fkey"
            columns: ["completion_id"]
            isOneToOne: false
            referencedRelation: "completions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_completion_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_habit_shares: {
        Row: {
          created_at: string | null
          group_id: string
          habit_id: string
          id: string
          shared_by: string
        }
        Insert: {
          created_at?: string | null
          group_id: string
          habit_id: string
          id?: string
          shared_by: string
        }
        Update: {
          created_at?: string | null
          group_id?: string
          habit_id?: string
          id?: string
          shared_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_habit_shares_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_habit_shares_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_habit_shares_shared_by_fkey"
            columns: ["shared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          group_id: string
          id: string
          joined_at: string | null
          notification_prefs: Json | null
          role: Database["public"]["Enums"]["group_role"] | null
          user_id: string
        }
        Insert: {
          group_id: string
          id?: string
          joined_at?: string | null
          notification_prefs?: Json | null
          role?: Database["public"]["Enums"]["group_role"] | null
          user_id: string
        }
        Update: {
          group_id?: string
          id?: string
          joined_at?: string | null
          notification_prefs?: Json | null
          role?: Database["public"]["Enums"]["group_role"] | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_message_reactions: {
        Row: {
          created_at: string | null
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          emoji?: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "group_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_message_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_messages: {
        Row: {
          content: string
          created_at: string | null
          group_id: string
          id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          group_id: string
          id?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          group_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_messages_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          created_by: string
          description: string | null
          id: string
          invite_code: string | null
          name: string
          settings: Json | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          created_by: string
          description?: string | null
          id?: string
          invite_code?: string | null
          name: string
          settings?: Json | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          created_by?: string
          description?: string | null
          id?: string
          invite_code?: string | null
          name?: string
          settings?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      habit_shares: {
        Row: {
          created_at: string | null
          habit_id: string
          id: string
          notify_complete: boolean | null
          notify_miss: boolean | null
          shared_with: string
        }
        Insert: {
          created_at?: string | null
          habit_id: string
          id?: string
          notify_complete?: boolean | null
          notify_miss?: boolean | null
          shared_with: string
        }
        Update: {
          created_at?: string | null
          habit_id?: string
          id?: string
          notify_complete?: boolean | null
          notify_miss?: boolean | null
          shared_with?: string
        }
        Relationships: [
          {
            foreignKeyName: "habit_shares_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "habit_shares_shared_with_fkey"
            columns: ["shared_with"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      habits: {
        Row: {
          category: string | null
          color: string | null
          created_at: string | null
          description: string | null
          emoji: string | null
          frequency: Database["public"]["Enums"]["habit_frequency"]
          id: string
          is_paused: boolean | null
          is_shared: boolean | null
          schedule: Json | null
          streak_best: number | null
          streak_current: number | null
          time_window: Json | null
          title: string
          total_completions: number | null
          user_id: string
        }
        Insert: {
          category?: string | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          emoji?: string | null
          frequency?: Database["public"]["Enums"]["habit_frequency"]
          id?: string
          is_paused?: boolean | null
          is_shared?: boolean | null
          schedule?: Json | null
          streak_best?: number | null
          streak_current?: number | null
          time_window?: Json | null
          title: string
          total_completions?: number | null
          user_id: string
        }
        Update: {
          category?: string | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          emoji?: string | null
          frequency?: Database["public"]["Enums"]["habit_frequency"]
          id?: string
          is_paused?: boolean | null
          is_shared?: boolean | null
          schedule?: Json | null
          streak_best?: number | null
          streak_current?: number | null
          time_window?: Json | null
          title?: string
          total_completions?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "habits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          date_of_birth: string | null
          display_name: string
          id: string
          notification_prefs: Json | null
          push_subscription: Json | null
          timezone: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          display_name: string
          id: string
          notification_prefs?: Json | null
          push_subscription?: Json | null
          timezone?: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          display_name?: string
          id?: string
          notification_prefs?: Json | null
          push_subscription?: Json | null
          timezone?: string
          username?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_view_completion_in_group: {
        Args: { c_id: string }
        Returns: boolean
      }
      get_feed_friends: {
        Args: { p_user_id: string }
        Returns: {
          avatar_url: string
          display_name: string
          friend_id: string
          friendship_since: string
          latest_completion: Json
          latest_encouragement: Json
          shared_habits: Json
          username: string
        }[]
      }
      get_group_by_invite_code: {
        Args: { p_code: string }
        Returns: {
          avatar_url: string
          description: string
          id: string
          name: string
        }[]
      }
      get_missed_habit_count: {
        Args: { p_timezone?: string }
        Returns: number
      }
      get_missed_habits:
        | {
            Args: { check_date: string; check_time: string }
            Returns: {
              emoji: string
              id: string
              title: string
              user_id: string
              user_name: string
            }[]
          }
        | {
            Args: { check_ts?: string }
            Returns: {
              emoji: string
              id: string
              title: string
              user_id: string
              user_name: string
            }[]
          }
      get_own_notification_settings: {
        Args: never
        Returns: {
          notification_prefs: Json
          push_subscription: Json
        }[]
      }
      insert_completion: {
        Args: {
          p_completion_type: Database["public"]["Enums"]["completion_type"]
          p_evidence_url?: string
          p_habit_id: string
          p_notes?: string
        }
        Returns: {
          completed_at: string | null
          completed_date: string | null
          completion_type: Database["public"]["Enums"]["completion_type"] | null
          created_at: string | null
          evidence_url: string | null
          habit_id: string
          id: string
          notes: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "completions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      insert_completions_batch: {
        Args: { p_items: Json }
        Returns: {
          completed_at: string | null
          completed_date: string | null
          completion_type: Database["public"]["Enums"]["completion_type"] | null
          created_at: string | null
          evidence_url: string | null
          habit_id: string
          id: string
          notes: string | null
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "completions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reset_stale_streaks: {
        Args: Record<string, never>
        Returns: number
      }
      is_group_admin: { Args: { g_id: string }; Returns: boolean }
      is_group_member: { Args: { g_id: string }; Returns: boolean }
      is_habit_owner: { Args: { h_id: string }; Returns: boolean }
      is_valid_schedule: { Args: { schedule: Json }; Returns: boolean }
      update_own_profile: {
        Args: { p_avatar_url?: string; p_display_name?: string }
        Returns: undefined
      }
    }
    Enums: {
      completion_type: "photo" | "video" | "message" | "quick"
      encouragement_type: "nudge" | "message" | "emoji" | "voice"
      friendship_status: "pending" | "accepted" | "blocked"
      group_role: "admin" | "member"
      habit_frequency:
        | "daily"
        | "weeksdays"
        | "weekends"
        | "specific_days"
        | "weekly"
      report_reason:
        | "illegal"
        | "csam"
        | "intimate_imagery"
        | "copyright"
        | "harassment"
        | "spam"
        | "other"
      report_status: "pending" | "reviewed" | "actioned" | "dismissed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      completion_type: ["photo", "video", "message", "quick"],
      encouragement_type: ["nudge", "message", "emoji", "voice"],
      friendship_status: ["pending", "accepted", "blocked"],
      group_role: ["admin", "member"],
      habit_frequency: [
        "daily",
        "weeksdays",
        "weekends",
        "specific_days",
        "weekly",
      ],
      report_reason: [
        "illegal",
        "csam",
        "intimate_imagery",
        "copyright",
        "harassment",
        "spam",
        "other",
      ],
      report_status: ["pending", "reviewed", "actioned", "dismissed"],
    },
  },
} as const

