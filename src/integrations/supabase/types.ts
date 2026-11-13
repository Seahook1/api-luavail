export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      api_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          last_used_at: string | null
          name: string
          owner_id: string
          prefix: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          last_used_at?: string | null
          name: string
          owner_id?: string
          prefix: string
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          last_used_at?: string | null
          name?: string
          owner_id?: string
          prefix?: string
        }
        Relationships: []
      }
      banned_hwids: {
        Row: {
          created_at: string
          hwid: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          hwid: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          hwid?: string
          reason?: string | null
        }
        Relationships: []
      }
      discord_links: {
        Row: {
          created_at: string
          guild_id: string | null
          link_code: string
          user_id: string
        }
        Insert: {
          created_at?: string
          guild_id?: string | null
          link_code: string
          user_id: string
        }
        Update: {
          created_at?: string
          guild_id?: string | null
          link_code?: string
          user_id?: string
        }
        Relationships: []
      }
      execution_logs: {
        Row: {
          created_at: string
          executor: string | null
          id: string
          ip: string | null
          key_id: string | null
          key_note: string | null
          roblox_display_name: string | null
          roblox_username: string | null
          result: string
          script_id: string
        }
        Insert: {
          created_at?: string
          executor?: string | null
          id?: string
          ip?: string | null
          key_id?: string | null
          key_note?: string | null
          roblox_display_name?: string | null
          roblox_username?: string | null
          result: string
          script_id: string
        }
        Update: {
          created_at?: string
          executor?: string | null
          id?: string
          ip?: string | null
          key_id?: string | null
          key_note?: string | null
          roblox_display_name?: string | null
          roblox_username?: string | null
          result?: string
          script_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_logs_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_tokens: {
        Row: {
          canary: string | null
          consumed: boolean
          created_at: string
          executor: string | null
          expires_at: string
          heartbeat_token: string | null
          hwid: string
          id: string
          ip: string | null
          key_id: string | null
          last_heartbeat_at: string | null
          roblox_display_name: string | null
          roblox_username: string | null
          revoked: boolean
          script_id: string
          session_expires_at: string | null
          token: string
        }
        Insert: {
          canary?: string | null
          consumed?: boolean
          created_at?: string
          executor?: string | null
          expires_at: string
          heartbeat_token?: string | null
          hwid: string
          id?: string
          ip?: string | null
          key_id?: string | null
          last_heartbeat_at?: string | null
          roblox_display_name?: string | null
          roblox_username?: string | null
          revoked?: boolean
          script_id: string
          session_expires_at?: string | null
          token: string
        }
        Update: {
          canary?: string | null
          consumed?: boolean
          created_at?: string
          executor?: string | null
          expires_at?: string
          heartbeat_token?: string | null
          hwid?: string
          id?: string
          ip?: string | null
          key_id?: string | null
          last_heartbeat_at?: string | null
          roblox_display_name?: string | null
          roblox_username?: string | null
          revoked?: boolean
          script_id?: string
          session_expires_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_tokens_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "license_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_tokens_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      getkey_sessions: {
        Row: {
          created_at: string
          id: string
          ip: string | null
          key: string | null
          script_id: string
          step: number
          step_started_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip?: string | null
          key?: string | null
          script_id: string
          step?: number
          step_started_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip?: string | null
          key?: string | null
          script_id?: string
          step?: number
          step_started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "getkey_sessions_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      license_keys: {
        Row: {
          banned: boolean
          created_at: string
          expires_at: string | null
          hwid: string | null
          hwid_reset_at: string | null
          id: string
          key: string
          last_rebind_at: string | null
          last_used_at: string | null
          max_concurrent_sessions: number
          note: string | null
          owner_id: string
          script_id: string
        }
        Insert: {
          banned?: boolean
          created_at?: string
          expires_at?: string | null
          hwid?: string | null
          hwid_reset_at?: string | null
          id?: string
          key: string
          last_rebind_at?: string | null
          last_used_at?: string | null
          max_concurrent_sessions?: number
          note?: string | null
          owner_id?: string
          script_id: string
        }
        Update: {
          banned?: boolean
          created_at?: string
          expires_at?: string | null
          hwid?: string | null
          hwid_reset_at?: string | null
          id?: string
          key?: string
          last_rebind_at?: string | null
          last_used_at?: string | null
          max_concurrent_sessions?: number
          note?: string | null
          owner_id?: string
          script_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "license_keys_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      scripts: {
        Row: {
          checkpoints: string[]
          created_at: string
          discord_webhook: string | null
          enabled: boolean
          executions: number
          getkey_enabled: boolean
          getkey_hours: number
          id: string
          keyless: boolean
          maintenance_mode: boolean
          moderation_disabled: boolean
          name: string
          owner_id: string
          source: string
          webhook_failure_enabled: boolean
          webhook_success_enabled: boolean
        }
        Insert: {
          checkpoints?: string[]
          created_at?: string
          discord_webhook?: string | null
          enabled?: boolean
          executions?: number
          getkey_enabled?: boolean
          getkey_hours?: number
          id?: string
          keyless?: boolean
          maintenance_mode?: boolean
          moderation_disabled?: boolean
          name: string
          owner_id?: string
          source?: string
          webhook_failure_enabled?: boolean
          webhook_success_enabled?: boolean
        }
        Update: {
          checkpoints?: string[]
          created_at?: string
          discord_webhook?: string | null
          enabled?: boolean
          executions?: number
          getkey_enabled?: boolean
          getkey_hours?: number
          id?: string
          keyless?: boolean
          maintenance_mode?: boolean
          moderation_disabled?: boolean
          name?: string
          owner_id?: string
          source?: string
          webhook_failure_enabled?: boolean
          webhook_success_enabled?: boolean
        }
        Relationships: []
      }
      api_usage_events: {
        Row: { api_key_id: string | null; created_at: string; id: string; method: string; owner_id: string; path: string }
        Insert: { api_key_id?: string | null; created_at?: string; id?: string; method: string; owner_id: string; path: string }
        Update: { api_key_id?: string | null; created_at?: string; id?: string; method?: string; owner_id?: string; path?: string }
        Relationships: []
      }
      audit_events: {
        Row: { action: string; created_at: string; details: Json; entity_id: string | null; entity_type: string; id: string; owner_id: string }
        Insert: { action: string; created_at?: string; details?: Json; entity_id?: string | null; entity_type: string; id?: string; owner_id: string }
        Update: { action?: string; created_at?: string; details?: Json; entity_id?: string | null; entity_type?: string; id?: string; owner_id?: string }
        Relationships: []
      }
      script_versions: {
        Row: { created_at: string; id: string; owner_id: string; script_id: string; source: string }
        Insert: { created_at?: string; id?: string; owner_id: string; script_id: string; source: string }
        Update: { created_at?: string; id?: string; owner_id?: string; script_id?: string; source?: string }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_list_scripts: {
        Args: never
        Returns: {
          checkpoints: string[]
          created_at: string
          discord_webhook: string | null
          enabled: boolean
          executions: number
          getkey_enabled: boolean
          getkey_hours: number
          id: string
          keyless: boolean
          moderation_disabled: boolean
          name: string
          owner_id: string
          source: string
        }[]
        SetofOptions: {
          from: "*"
          to: "scripts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_moderate_script: {
        Args: { _action: string; _script_id: string }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin"],
    },
  },
} as const
