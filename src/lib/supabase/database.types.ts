export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      business_purchases: {
        Row: {
          currency: string
          id: string
          idempotency_key: string
          quantity: number
          received_on: string
          recorded_at: string
          recorded_by: string
          recorded_order: number
          stock_item_id: string
          total_cost: number | null
          unit_cost: number
        }
        Insert: {
          currency?: string
          id?: string
          idempotency_key: string
          quantity: number
          received_on: string
          recorded_at?: string
          recorded_by: string
          recorded_order?: never
          stock_item_id: string
          total_cost?: number | null
          unit_cost: number
        }
        Update: {
          currency?: string
          id?: string
          idempotency_key?: string
          quantity?: number
          received_on?: string
          recorded_at?: string
          recorded_by?: string
          recorded_order?: never
          stock_item_id?: string
          total_cost?: number | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "business_purchases_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_purchases_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "business_stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      business_sale_allocations: {
        Row: {
          purchase_id: string
          quantity: number
          received_on: string
          sale_id: string
          unit_cost: number
        }
        Insert: {
          purchase_id: string
          quantity: number
          received_on: string
          sale_id: string
          unit_cost: number
        }
        Update: {
          purchase_id?: string
          quantity?: number
          received_on?: string
          sale_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "business_sale_allocations_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "business_purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_sale_allocations_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "business_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      business_sales: {
        Row: {
          buyer_name: string
          buyer_profile_id: string | null
          buyer_type: Database["public"]["Enums"]["business_buyer_type"]
          cost: number
          currency: string
          gross_profit: number | null
          id: string
          idempotency_key: string
          quantity: number
          recorded_at: string
          recorded_by: string
          revenue: number
          sold_on: string
          stock_item_id: string
          unit_price: number
        }
        Insert: {
          buyer_name: string
          buyer_profile_id?: string | null
          buyer_type: Database["public"]["Enums"]["business_buyer_type"]
          cost: number
          currency?: string
          gross_profit?: number | null
          id?: string
          idempotency_key: string
          quantity: number
          recorded_at?: string
          recorded_by: string
          revenue: number
          sold_on: string
          stock_item_id: string
          unit_price: number
        }
        Update: {
          buyer_name?: string
          buyer_profile_id?: string | null
          buyer_type?: Database["public"]["Enums"]["business_buyer_type"]
          cost?: number
          currency?: string
          gross_profit?: number | null
          id?: string
          idempotency_key?: string
          quantity?: number
          recorded_at?: string
          recorded_by?: string
          revenue?: number
          sold_on?: string
          stock_item_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "business_sales_buyer_profile_id_fkey"
            columns: ["buyer_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_sales_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_sales_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "business_stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      business_stock_items: {
        Row: {
          created_at: string
          id: string
          peptide_id: string
          strength_mg: number
        }
        Insert: {
          created_at?: string
          id?: string
          peptide_id: string
          strength_mg: number
        }
        Update: {
          created_at?: string
          id?: string
          peptide_id?: string
          strength_mg?: number
        }
        Relationships: [
          {
            foreignKeyName: "business_stock_items_peptide_id_fkey"
            columns: ["peptide_id"]
            isOneToOne: false
            referencedRelation: "peptides"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_plans: {
        Row: {
          created_at: string
          cycle_id: string
          id: string
          owner_id: string
          peptide_id: string
        }
        Insert: {
          created_at?: string
          cycle_id: string
          id?: string
          owner_id: string
          peptide_id: string
        }
        Update: {
          created_at?: string
          cycle_id?: string
          id?: string
          owner_id?: string
          peptide_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_plans_cycle"
            columns: ["cycle_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "cycles"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "cycle_plans_peptide_id_fkey"
            columns: ["peptide_id"]
            isOneToOne: false
            referencedRelation: "peptides"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_revision_phases: {
        Row: {
          dose_change_from: string[]
          dose_change_mg: number[]
          dose_mg: number | null
          end_date: string
          every_days: number | null
          kind: string
          local_time: string | null
          owner_id: string
          phase_id: string
          plan_id: string
          revision_id: string
          schedule_type: string | null
          start_date: string
          time_change_from: string[]
          time_change_time: string[]
          weekdays: number[] | null
        }
        Insert: {
          dose_change_from?: string[]
          dose_change_mg?: number[]
          dose_mg?: number | null
          end_date: string
          every_days?: number | null
          kind: string
          local_time?: string | null
          owner_id: string
          phase_id: string
          plan_id: string
          revision_id: string
          schedule_type?: string | null
          start_date: string
          time_change_from?: string[]
          time_change_time?: string[]
          weekdays?: number[] | null
        }
        Update: {
          dose_change_from?: string[]
          dose_change_mg?: number[]
          dose_mg?: number | null
          end_date?: string
          every_days?: number | null
          kind?: string
          local_time?: string | null
          owner_id?: string
          phase_id?: string
          plan_id?: string
          revision_id?: string
          schedule_type?: string | null
          start_date?: string
          time_change_from?: string[]
          time_change_time?: string[]
          weekdays?: number[] | null
        }
        Relationships: [
          {
            foreignKeyName: "cycle_revision_phases_plan"
            columns: ["revision_id", "plan_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "cycle_revision_plans"
            referencedColumns: ["revision_id", "plan_id", "owner_id"]
          },
        ]
      }
      cycle_revision_plans: {
        Row: {
          cycle_id: string
          effective_from: string | null
          owner_id: string
          peptide_id: string
          plan_id: string
          position: number
          revision_id: string
        }
        Insert: {
          cycle_id: string
          effective_from?: string | null
          owner_id: string
          peptide_id: string
          plan_id: string
          position: number
          revision_id: string
        }
        Update: {
          cycle_id?: string
          effective_from?: string | null
          owner_id?: string
          peptide_id?: string
          plan_id?: string
          position?: number
          revision_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_revision_plans_plan"
            columns: ["plan_id", "cycle_id", "peptide_id"]
            isOneToOne: false
            referencedRelation: "cycle_plans"
            referencedColumns: ["id", "cycle_id", "peptide_id"]
          },
          {
            foreignKeyName: "cycle_revision_plans_revision"
            columns: ["revision_id", "cycle_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "cycle_revisions"
            referencedColumns: ["id", "cycle_id", "owner_id"]
          },
        ]
      }
      cycle_revisions: {
        Row: {
          created_at: string
          cycle_id: string
          id: string
          number: number
          owner_id: string
          time_zone: string
        }
        Insert: {
          created_at?: string
          cycle_id: string
          id?: string
          number: number
          owner_id: string
          time_zone: string
        }
        Update: {
          created_at?: string
          cycle_id?: string
          id?: string
          number?: number
          owner_id?: string
          time_zone?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_revisions_cycle"
            columns: ["cycle_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "cycles"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      cycle_template_phases: {
        Row: {
          dose_mg: number | null
          every_days: number | null
          id: string
          kind: string
          length_days: number
          local_time: string | null
          offset_days: number
          plan_id: string
          schedule_type: string | null
          weekdays: number[] | null
        }
        Insert: {
          dose_mg?: number | null
          every_days?: number | null
          id?: string
          kind: string
          length_days: number
          local_time?: string | null
          offset_days: number
          plan_id: string
          schedule_type?: string | null
          weekdays?: number[] | null
        }
        Update: {
          dose_mg?: number | null
          every_days?: number | null
          id?: string
          kind?: string
          length_days?: number
          local_time?: string | null
          offset_days?: number
          plan_id?: string
          schedule_type?: string | null
          weekdays?: number[] | null
        }
        Relationships: [
          {
            foreignKeyName: "cycle_template_phases_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "cycle_template_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_template_plans: {
        Row: {
          id: string
          peptide_id: string
          position: number
          template_id: string
        }
        Insert: {
          id?: string
          peptide_id: string
          position: number
          template_id: string
        }
        Update: {
          id?: string
          peptide_id?: string
          position?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_template_plans_peptide_id_fkey"
            columns: ["peptide_id"]
            isOneToOne: false
            referencedRelation: "peptides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_template_plans_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "cycle_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      cycle_templates: {
        Row: {
          created_at: string
          guidance: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          guidance?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          guidance?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      cycles: {
        Row: {
          baseline: string
          created_at: string
          current_revision: number
          goal: string
          id: string
          name: string
          owner_id: string
          template_guidance: string
          template_id: string | null
          template_name: string
          template_updated_at: string | null
          updated_at: string
          version: number
        }
        Insert: {
          baseline?: string
          created_at?: string
          current_revision?: number
          goal: string
          id?: string
          name: string
          owner_id: string
          template_guidance?: string
          template_id?: string | null
          template_name?: string
          template_updated_at?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          baseline?: string
          created_at?: string
          current_revision?: number
          goal?: string
          id?: string
          name?: string
          owner_id?: string
          template_guidance?: string
          template_id?: string | null
          template_name?: string
          template_updated_at?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "cycles_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycles_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "cycle_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          last_send_error: string | null
          name: string
          sent_at: string
          state: Database["public"]["Enums"]["invitation_state"]
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          last_send_error?: string | null
          name?: string
          sent_at?: string
          state?: Database["public"]["Enums"]["invitation_state"]
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          last_send_error?: string | null
          name?: string
          sent_at?: string
          state?: Database["public"]["Enums"]["invitation_state"]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      peptides: {
        Row: {
          available: boolean
          created_at: string
          cycling_off_guidance: string
          id: string
          information: string
          name: string
          supplement_guidance: string
          updated_at: string
        }
        Insert: {
          available?: boolean
          created_at?: string
          cycling_off_guidance?: string
          id?: string
          information: string
          name: string
          supplement_guidance?: string
          updated_at?: string
        }
        Update: {
          available?: boolean
          created_at?: string
          cycling_off_guidance?: string
          id?: string
          information?: string
          name?: string
          supplement_guidance?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          acknowledged_at: string | null
          acknowledgement_version: string | null
          created_at: string
          email: string
          id: string
          name: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledgement_version?: string | null
          created_at?: string
          email: string
          id: string
          name: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          acknowledged_at?: string | null
          acknowledgement_version?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      push_device_off: {
        Row: {
          device_id: string
          off_at: string
          profile_id: string
          reason: string
        }
        Insert: {
          device_id: string
          off_at?: string
          profile_id: string
          reason: string
        }
        Update: {
          device_id?: string
          off_at?: string
          profile_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_device_off_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          device_id: string | null
          device_label: string
          disabled_at: string | null
          disabled_reason: string | null
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          profile_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          device_id?: string | null
          device_label?: string
          disabled_at?: string | null
          disabled_reason?: string | null
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          profile_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          device_id?: string | null
          device_label?: string
          disabled_at?: string | null
          disabled_reason?: string | null
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_grants: {
        Row: {
          admin_id: string
          granted_at: string
          id: string
          researcher_id: string
          revoked_at: string | null
        }
        Insert: {
          admin_id: string
          granted_at?: string
          id?: string
          researcher_id: string
          revoked_at?: string | null
        }
        Update: {
          admin_id?: string
          granted_at?: string
          id?: string
          researcher_id?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_grants_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_grants_researcher_id_fkey"
            columns: ["researcher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_business_lots: {
        Args: { p_stock_item_id: string }
        Returns: {
          allocated: number
          purchase_id: string
          quantity: number
          received_on: string
          recorded_at: string
          recorded_order: number
          remaining: number
          total_cost: string
          unit_cost: string
        }[]
      }
      admin_business_sales_totals: {
        Args: { p_from?: string; p_stock_item_id?: string; p_to?: string }
        Returns: {
          cost: string
          gross_profit: string
          revenue: string
          sales: number
          stock_item_id: string
          vials: number
        }[]
      }
      admin_business_stock: {
        Args: never
        Returns: {
          created_at: string
          on_hand: number
          peptide_available: boolean
          peptide_id: string
          peptide_name: string
          purchased: number
          sold: number
          stock_item_id: string
          strength_mg: string
        }[]
      }
      admin_cycle_template_usage: {
        Args: never
        Returns: {
          cycle_count: number
          template_id: string
        }[]
      }
      admin_library_peptides: {
        Args: never
        Returns: {
          available: boolean
          created_at: string
          cycling_off_guidance: string
          id: string
          information: string
          name: string
          supplement_guidance: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "peptides"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      business_buyer_accounts: {
        Args: never
        Returns: {
          email: string
          name: string
          profile_id: string
        }[]
      }
      business_check_sale: { Args: { p_sale_id: string }; Returns: undefined }
      business_latest_date: { Args: never; Returns: string }
      can_read_researcher: { Args: { p_owner: string }; Returns: boolean }
      can_write_researcher: { Args: { p_owner: string }; Returns: boolean }
      claim_invitation: {
        Args: { p_token_hash: string }
        Returns: {
          email: string
          id: string
          name: string
        }[]
      }
      complete_invitation: {
        Args: { p_id: string; p_name: string; p_user_id: string }
        Returns: undefined
      }
      cycle_dose_changes_valid: {
        Args: {
          p_end: string
          p_from: string[]
          p_mg: number[]
          p_start: string
        }
        Returns: boolean
      }
      cycle_local_instant: {
        Args: { p_date: string; p_time: string; p_time_zone: string }
        Returns: string
      }
      cycle_phase_instants: {
        Args: {
          p_from: string
          p_phase: Database["public"]["Tables"]["cycle_revision_phases"]["Row"]
          p_time_zone: string
          p_to: string
        }
        Returns: {
          key: string
          planned_at: string
        }[]
      }
      cycle_revision_content: { Args: { p_revision_id: string }; Returns: Json }
      cycle_template_content: { Args: { p_template_id: string }; Returns: Json }
      cycle_time_changes_valid: {
        Args: {
          p_end: string
          p_from: string[]
          p_start: string
          p_time: string[]
        }
        Returns: boolean
      }
      disable_push_subscription: {
        Args: { p_device_id: string; p_endpoint?: string; p_reason: string }
        Returns: boolean
      }
      grant_support_access: { Args: { p_admin_id: string }; Returns: string }
      has_research_access: { Args: never; Returns: boolean }
      invite_researcher: {
        Args: { p_email: string; p_name: string; p_token_hash: string }
        Returns: {
          invitation_id: string
          outcome: string
        }[]
      }
      is_acknowledged_researcher: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_canonical_push_endpoint: {
        Args: { p_endpoint: string }
        Returns: boolean
      }
      is_time_zone: { Args: { p_name: string }; Returns: boolean }
      is_weekday_set: { Args: { p_days: number[] }; Returns: boolean }
      library_name_key: { Args: { p_name: string }; Returns: string }
      library_reference_counts: {
        Args: never
        Returns: {
          cycle_count: number
          peptide_id: string
          template_count: number
        }[]
      }
      mark_invitation_send_failed: {
        Args: { p_error: string; p_id: string }
        Returns: undefined
      }
      parse_cad_amount: { Args: { p_text: string }; Returns: number }
      parse_strength_mg: { Args: { p_text: string }; Returns: number }
      record_acknowledgement: { Args: { p_version: string }; Returns: boolean }
      record_business_purchase: {
        Args: {
          p_idempotency_key: string
          p_peptide_id?: string
          p_quantity: number
          p_received_on: string
          p_stock_item_id?: string
          p_strength_mg?: string
          p_unit_cost: string
        }
        Returns: {
          purchase_id: string
          replayed: boolean
          stock_item_id: string
        }[]
      }
      record_business_sale: {
        Args: {
          p_buyer_name?: string
          p_buyer_profile_id?: string
          p_idempotency_key: string
          p_quantity: number
          p_sold_on: string
          p_stock_item_id: string
          p_unit_price: string
        }
        Returns: {
          replayed: boolean
          sale_id: string
        }[]
      }
      release_invitation: { Args: { p_id: string }; Returns: undefined }
      resend_invitation: {
        Args: { p_id: string; p_token_hash: string }
        Returns: {
          email: string
          name: string
        }[]
      }
      revoke_support_access: { Args: { p_admin_id: string }; Returns: boolean }
      save_cycle: {
        Args: {
          p_baseline: string
          p_cycle_id?: string
          p_goal: string
          p_name: string
          p_plans: Json
          p_template_id?: string
          p_time_zone: string
          p_version?: number
        }
        Returns: string
      }
      save_cycle_template: {
        Args: {
          p_guidance: string
          p_id?: string
          p_name: string
          p_plans: Json
        }
        Returns: string
      }
      save_library_peptide: {
        Args: {
          p_available: boolean
          p_cycling_off_guidance: string
          p_id?: string
          p_information: string
          p_name: string
          p_supplement_guidance: string
        }
        Returns: string
      }
      save_push_subscription: {
        Args: {
          p_auth: string
          p_device_id: string
          p_device_label: string
          p_endpoint: string
          p_mode: string
          p_p256dh: string
        }
        Returns: string
      }
      template_peptides: {
        Args: { p_template_id: string }
        Returns: {
          available: boolean
          id: string
          name: string
        }[]
      }
      trim_whitespace: { Args: { p_text: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "researcher"
      business_buyer_type: "account" | "outside"
      invitation_state: "pending" | "accepted" | "failed"
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
  public: {
    Enums: {
      app_role: ["admin", "researcher"],
      business_buyer_type: ["account", "outside"],
      invitation_state: ["pending", "accepted", "failed"],
    },
  },
} as const

