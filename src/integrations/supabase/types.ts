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
          id: string
          ip: string | null
          key_id: string | null
          key_note: string | null
          result: string
          script_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ip?: string | null
          key_id?: string | null
          key_note?: string | null
          result: string
          script_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ip?: string | null
          key_id?: string | null
          key_note?: string | null
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
          last_used_at: string | null
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
          last_used_at?: string | null
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
          last_used_at?: string | null
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
          name: string
          owner_id: string
          source: string
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
          name: string
          owner_id?: string
          source?: string
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
          name?: string
          owner_id?: string
          source?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
