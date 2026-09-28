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
      account_preference_requests: {
        Row: {
          created_at: string
          owner_id: string
          request_hash: string
          request_key: string
          result: Json
        }
        Insert: {
          created_at?: string
          owner_id: string
          request_hash: string
          request_key: string
          result: Json
        }
        Update: {
          created_at?: string
          owner_id?: string
          request_hash?: string
          request_key?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "account_preference_requests_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      account_preferences: {
        Row: {
          appearance: string | null
          default_syringe: number
          owner_id: string
          updated_at: string
          weight_unit: string
        }
        Insert: {
          appearance?: string | null
          default_syringe?: number
          owner_id: string
          updated_at?: string
          weight_unit?: string
        }
        Update: {
          appearance?: string | null
          default_syringe?: number
          owner_id?: string
          updated_at?: string
          weight_unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_preferences_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      business_purchases: {
        Row: {
          currency: string
          fx_rate: number | null
          fx_rate_date: string | null
          id: string
          idempotency_key: string
          original_currency: string
          original_unit_cost: number | null
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
          fx_rate?: number | null
          fx_rate_date?: string | null
          id?: string
          idempotency_key: string
          original_currency?: string
          original_unit_cost?: number | null
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
          fx_rate?: number | null
          fx_rate_date?: string | null
          id?: string
          idempotency_key?: string
          original_currency?: string
          original_unit_cost?: number | null
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
          linked_at: string | null
          linked_by: string | null
          original_buyer_name: string | null
          quantity: number
          recorded_at: string
          recorded_by: string
          revenue: number
          seller_id: string | null
          seller_name: string | null
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
          linked_at?: string | null
          linked_by?: string | null
          original_buyer_name?: string | null
          quantity: number
          recorded_at?: string
          recorded_by: string
          revenue: number
          seller_id?: string | null
          seller_name?: string | null
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
          linked_at?: string | null
          linked_by?: string | null
          original_buyer_name?: string | null
          quantity?: number
          recorded_at?: string
          recorded_by?: string
          revenue?: number
          seller_id?: string | null
          seller_name?: string | null
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
            foreignKeyName: "business_sales_linked_by_fkey"
            columns: ["linked_by"]
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
            foreignKeyName: "business_sales_seller_id_fkey"
            columns: ["seller_id"]
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
      cycle_plan_mixtures: {
        Row: {
          id: string
          linked_at: string
          mixture_id: string
          owner_id: string
          peptide_id: string
          plan_id: string
          unlinked_at: string | null
        }
        Insert: {
          id?: string
          linked_at: string
          mixture_id: string
          owner_id: string
          peptide_id: string
          plan_id: string
          unlinked_at?: string | null
        }
        Update: {
          id?: string
          linked_at?: string
          mixture_id?: string
          owner_id?: string
          peptide_id?: string
          plan_id?: string
          unlinked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cycle_plan_mixtures_mixture"
            columns: ["mixture_id", "owner_id", "peptide_id"]
            isOneToOne: false
            referencedRelation: "mixtures"
            referencedColumns: ["id", "owner_id", "peptide_id"]
          },
          {
            foreignKeyName: "cycle_plan_mixtures_plan"
            columns: ["plan_id", "owner_id", "peptide_id"]
            isOneToOne: false
            referencedRelation: "cycle_plans"
            referencedColumns: ["id", "owner_id", "peptide_id"]
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
          schedule_version: number
        }
        Insert: {
          created_at?: string
          cycle_id: string
          id?: string
          owner_id: string
          peptide_id: string
          schedule_version?: number
        }
        Update: {
          created_at?: string
          cycle_id?: string
          id?: string
          owner_id?: string
          peptide_id?: string
          schedule_version?: number
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
      cycle_save_requests: {
        Row: {
          created_at: string
          cycle_id: string
          owner_id: string
          request_hash: string
          request_key: string
        }
        Insert: {
          created_at?: string
          cycle_id: string
          owner_id: string
          request_hash: string
          request_key: string
        }
        Update: {
          created_at?: string
          cycle_id?: string
          owner_id?: string
          request_hash?: string
          request_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "cycle_save_requests_cycle"
            columns: ["cycle_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "cycles"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "cycle_save_requests_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
      dose_records: {
        Row: {
          actual_at: string
          amount_mg: number
          cycle_id: string
          id: string
          mixture_version_id: string | null
          notes: string
          occurrence_key: string
          owner_id: string
          peptide_id: string
          phase_id: string
          plan_id: string
          planned_mg: number
          recorded_at: string
          request_key: string
          schedule_version_after: number | null
          scheduled_at: string
          site: string
        }
        Insert: {
          actual_at: string
          amount_mg: number
          cycle_id: string
          id?: string
          mixture_version_id?: string | null
          notes?: string
          occurrence_key: string
          owner_id: string
          peptide_id: string
          phase_id: string
          plan_id: string
          planned_mg: number
          recorded_at: string
          request_key: string
          schedule_version_after?: number | null
          scheduled_at: string
          site?: string
        }
        Update: {
          actual_at?: string
          amount_mg?: number
          cycle_id?: string
          id?: string
          mixture_version_id?: string | null
          notes?: string
          occurrence_key?: string
          owner_id?: string
          peptide_id?: string
          phase_id?: string
          plan_id?: string
          planned_mg?: number
          recorded_at?: string
          request_key?: string
          schedule_version_after?: number | null
          scheduled_at?: string
          site?: string
        }
        Relationships: [
          {
            foreignKeyName: "dose_records_mixture"
            columns: ["mixture_version_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "mixture_versions"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "dose_records_plan"
            columns: ["plan_id", "cycle_id", "owner_id", "peptide_id"]
            isOneToOne: false
            referencedRelation: "cycle_plans"
            referencedColumns: ["id", "cycle_id", "owner_id", "peptide_id"]
          },
        ]
      }
      dose_request_keys: {
        Row: {
          claimed_at: string
          kind: string
          owner_id: string
          request_key: string
        }
        Insert: {
          claimed_at?: string
          kind: string
          owner_id: string
          request_key: string
        }
        Update: {
          claimed_at?: string
          kind?: string
          owner_id?: string
          request_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "dose_request_keys_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dose_skips: {
        Row: {
          cycle_id: string
          id: string
          occurrence_key: string
          owner_id: string
          peptide_id: string
          phase_id: string
          plan_id: string
          planned_mg: number
          recorded_at: string
          request_key: string
          schedule_version_after: number
          scheduled_at: string
        }
        Insert: {
          cycle_id: string
          id?: string
          occurrence_key: string
          owner_id: string
          peptide_id: string
          phase_id: string
          plan_id: string
          planned_mg: number
          recorded_at: string
          request_key: string
          schedule_version_after: number
          scheduled_at: string
        }
        Update: {
          cycle_id?: string
          id?: string
          occurrence_key?: string
          owner_id?: string
          peptide_id?: string
          phase_id?: string
          plan_id?: string
          planned_mg?: number
          recorded_at?: string
          request_key?: string
          schedule_version_after?: number
          scheduled_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dose_skips_plan"
            columns: ["plan_id", "cycle_id", "owner_id", "peptide_id"]
            isOneToOne: false
            referencedRelation: "cycle_plans"
            referencedColumns: ["id", "cycle_id", "owner_id", "peptide_id"]
          },
        ]
      }
      dose_voids: {
        Row: {
          cycle_id: string
          deduction: Json | null
          entry: Json
          entry_id: string
          entry_request_key: string
          id: string
          kind: string
          occurrence_key: string
          owner_id: string
          peptide_id: string
          plan_id: string
          request_key: string
          voided_at: string
        }
        Insert: {
          cycle_id: string
          deduction?: Json | null
          entry: Json
          entry_id: string
          entry_request_key: string
          id?: string
          kind: string
          occurrence_key: string
          owner_id: string
          peptide_id: string
          plan_id: string
          request_key: string
          voided_at: string
        }
        Update: {
          cycle_id?: string
          deduction?: Json | null
          entry?: Json
          entry_id?: string
          entry_request_key?: string
          id?: string
          kind?: string
          occurrence_key?: string
          owner_id?: string
          peptide_id?: string
          plan_id?: string
          request_key?: string
          voided_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dose_voids_plan"
            columns: ["plan_id", "cycle_id", "owner_id", "peptide_id"]
            isOneToOne: false
            referencedRelation: "cycle_plans"
            referencedColumns: ["id", "cycle_id", "owner_id", "peptide_id"]
          },
        ]
      }
      fx_rates: {
        Row: {
          fetched_at: string
          rate_date: string
          source: string
          usd_cad: number
        }
        Insert: {
          fetched_at?: string
          rate_date: string
          source?: string
          usd_cad: number
        }
        Update: {
          fetched_at?: string
          rate_date?: string
          source?: string
          usd_cad?: number
        }
        Relationships: []
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
          role: Database["public"]["Enums"]["app_role"]
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
          role?: Database["public"]["Enums"]["app_role"]
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
          role?: Database["public"]["Enums"]["app_role"]
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
      mixture_versions: {
        Row: {
          created_at: string
          id: string
          line_spacing: number | null
          liquid_ml: number
          mixture_id: string
          number: number
          owner_id: string
          syringe_units: number
          vial_mg: number
        }
        Insert: {
          created_at?: string
          id?: string
          line_spacing?: number | null
          liquid_ml: number
          mixture_id: string
          number: number
          owner_id: string
          syringe_units: number
          vial_mg: number
        }
        Update: {
          created_at?: string
          id?: string
          line_spacing?: number | null
          liquid_ml?: number
          mixture_id?: string
          number?: number
          owner_id?: string
          syringe_units?: number
          vial_mg?: number
        }
        Relationships: [
          {
            foreignKeyName: "mixture_versions_mixture"
            columns: ["mixture_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "mixtures"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      mixtures: {
        Row: {
          created_at: string
          current_version: number
          deleted_at: string | null
          id: string
          owner_id: string
          peptide_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          current_version?: number
          deleted_at?: string | null
          id?: string
          owner_id: string
          peptide_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          current_version?: number
          deleted_at?: string | null
          id?: string
          owner_id?: string
          peptide_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "mixtures_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mixtures_peptide_id_fkey"
            columns: ["peptide_id"]
            isOneToOne: false
            referencedRelation: "peptides"
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
      personal_supply_settings: {
        Row: {
          owner_id: string
          tracking_enabled: boolean
          updated_at: string
        }
        Insert: {
          owner_id: string
          tracking_enabled?: boolean
          updated_at?: string
        }
        Update: {
          owner_id?: string
          tracking_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "personal_supply_settings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      personal_vial_deductions: {
        Row: {
          amount_mg: number
          dose_id: string | null
          id: string
          kind: string
          owner_id: string
          recorded_at: string
          remaining_after_mg: number
          remaining_before_mg: number
          request_key: string | null
          stock_discrepancy: boolean | null
          vial_id: string
          vial_sequence: number
        }
        Insert: {
          amount_mg: number
          dose_id?: string | null
          id?: string
          kind?: string
          owner_id: string
          recorded_at: string
          remaining_after_mg: number
          remaining_before_mg: number
          request_key?: string | null
          stock_discrepancy?: boolean | null
          vial_id: string
          vial_sequence: number
        }
        Update: {
          amount_mg?: number
          dose_id?: string | null
          id?: string
          kind?: string
          owner_id?: string
          recorded_at?: string
          remaining_after_mg?: number
          remaining_before_mg?: number
          request_key?: string | null
          stock_discrepancy?: boolean | null
          vial_id?: string
          vial_sequence?: number
        }
        Relationships: [
          {
            foreignKeyName: "personal_vial_deductions_dose"
            columns: ["dose_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "dose_records"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "personal_vial_deductions_vial"
            columns: ["vial_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "personal_vials"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      personal_vials: {
        Row: {
          created_at: string
          finished_at: string | null
          id: string
          label: string
          mixed_at: string | null
          mixture_id: string | null
          owner_id: string
          peptide_id: string
          request_hash: string | null
          request_key: string | null
          strength_mg: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          finished_at?: string | null
          id?: string
          label: string
          mixed_at?: string | null
          mixture_id?: string | null
          owner_id: string
          peptide_id: string
          request_hash?: string | null
          request_key?: string | null
          strength_mg: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          finished_at?: string | null
          id?: string
          label?: string
          mixed_at?: string | null
          mixture_id?: string | null
          owner_id?: string
          peptide_id?: string
          request_hash?: string | null
          request_key?: string | null
          strength_mg?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "personal_vials_mixture"
            columns: ["mixture_id", "owner_id", "peptide_id"]
            isOneToOne: false
            referencedRelation: "mixtures"
            referencedColumns: ["id", "owner_id", "peptide_id"]
          },
          {
            foreignKeyName: "personal_vials_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_vials_peptide_id_fkey"
            columns: ["peptide_id"]
            isOneToOne: false
            referencedRelation: "peptides"
            referencedColumns: ["id"]
          },
        ]
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
      progress_check_ins: {
        Row: {
          created_at: string
          day: string
          effects: string[]
          effects_other: string
          feeling: number
          id: string
          measured_at: string | null
          measurement_name: string | null
          measurement_unit: string | null
          measurement_value: number | null
          note: string
          owner_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          day: string
          effects?: string[]
          effects_other?: string
          feeling: number
          id?: string
          measured_at?: string | null
          measurement_name?: string | null
          measurement_unit?: string | null
          measurement_value?: number | null
          note?: string
          owner_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          day?: string
          effects?: string[]
          effects_other?: string
          feeling?: number
          id?: string
          measured_at?: string | null
          measurement_name?: string | null
          measurement_unit?: string | null
          measurement_value?: number | null
          note?: string
          owner_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "progress_check_ins_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      supplement_routines: {
        Row: {
          amount: number
          created_at: string
          definition_from: string
          end_date: string | null
          id: string
          name: string
          owner_id: string
          schedule_version: number
          start_date: string
          time_of_day: string
          time_zone: string
          unit: string
          updated_at: string
          version: number
        }
        Insert: {
          amount: number
          created_at?: string
          definition_from: string
          end_date?: string | null
          id?: string
          name: string
          owner_id: string
          schedule_version?: number
          start_date: string
          time_of_day: string
          time_zone?: string
          unit: string
          updated_at?: string
          version?: number
        }
        Update: {
          amount?: number
          created_at?: string
          definition_from?: string
          end_date?: string | null
          id?: string
          name?: string
          owner_id?: string
          schedule_version?: number
          start_date?: string
          time_of_day?: string
          time_zone?: string
          unit?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplement_routines_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      supplement_settings: {
        Row: {
          owner_id: string
          tracking_enabled: boolean
          updated_at: string
        }
        Insert: {
          owner_id: string
          tracking_enabled?: boolean
          updated_at?: string
        }
        Update: {
          owner_id?: string
          tracking_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplement_settings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      supplement_taken: {
        Row: {
          actual_at: string
          amount: number
          id: string
          local_date: string
          name: string
          occurrence_key: string
          owner_id: string
          recorded_at: string
          request_key: string
          routine_id: string
          scheduled_at: string
          unit: string
        }
        Insert: {
          actual_at: string
          amount: number
          id?: string
          local_date: string
          name: string
          occurrence_key: string
          owner_id: string
          recorded_at: string
          request_key: string
          routine_id: string
          scheduled_at: string
          unit: string
        }
        Update: {
          actual_at?: string
          amount?: number
          id?: string
          local_date?: string
          name?: string
          occurrence_key?: string
          owner_id?: string
          recorded_at?: string
          request_key?: string
          routine_id?: string
          scheduled_at?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplement_taken_routine"
            columns: ["routine_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "supplement_routines"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      supplement_write_requests: {
        Row: {
          created_at: string
          kind: string
          owner_id: string
          request_hash: string
          request_key: string
          result: Json
        }
        Insert: {
          created_at?: string
          kind: string
          owner_id: string
          request_hash: string
          request_key: string
          result: Json
        }
        Update: {
          created_at?: string
          kind?: string
          owner_id?: string
          request_hash?: string
          request_key?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "supplement_write_requests_owner_id_fkey"
            columns: ["owner_id"]
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
      support_share_requests: {
        Row: {
          created_at: string
          kind: string
          request_key: string
          researcher_id: string
          result: Json
        }
        Insert: {
          created_at?: string
          kind: string
          request_key: string
          researcher_id: string
          result: Json
        }
        Update: {
          created_at?: string
          kind?: string
          request_key?: string
          researcher_id?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "support_share_requests_researcher_id_fkey"
            columns: ["researcher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_shares: {
        Row: {
          id: string
          researcher_id: string
          started_at: string
          stopped_at: string | null
        }
        Insert: {
          id?: string
          researcher_id: string
          started_at?: string
          stopped_at?: string | null
        }
        Update: {
          id?: string
          researcher_id?: string
          started_at?: string
          stopped_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_shares_researcher_id_fkey"
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
      add_personal_vial: {
        Args: {
          p_label: string
          p_mixture_id?: string
          p_peptide_id: string
          p_request_hash: string
          p_request_key: string
          p_strength_mg: string
        }
        Returns: Json
      }
      admin_business_lots: {
        Args: { p_stock_item_id: string }
        Returns: {
          allocated: number
          fx_rate: string
          fx_rate_date: string
          original_currency: string
          original_unit_cost: string
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
      admin_business_outside_buyers: {
        Args: { p_search?: string }
        Returns: {
          buyer_name: string
          last_sold: string
          revenue: string
          sales: number
          vials: number
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
      admin_business_seller_totals: {
        Args: { p_from?: string; p_stock_item_id?: string; p_to?: string }
        Returns: {
          cost: string
          gross_profit: string
          revenue: string
          sales: number
          seller_email: string
          seller_id: string
          seller_key: string
          seller_name: string
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
      admin_support_researchers: {
        Args: { p_researcher_id?: string }
        Returns: {
          email: string
          name: string
          profile_id: string
          shared_since: string
          stopped_at: string
        }[]
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
      business_sellers: {
        Args: never
        Returns: {
          email: string
          name: string
          profile_id: string
        }[]
      }
      can_read_researcher: { Args: { p_owner: string }; Returns: boolean }
      can_write_researcher: { Args: { p_owner: string }; Returns: boolean }
      check_in_effect_list: { Args: never; Returns: string[] }
      check_in_effect_list_v3: { Args: never; Returns: string[] }
      check_in_effects_v3_valid: {
        Args: { p_effects: string[]; p_other: string }
        Returns: boolean
      }
      check_in_effects_valid: {
        Args: { p_effects: string[] }
        Returns: boolean
      }
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
      confirm_dose: {
        Args: {
          p_actual_at?: string
          p_amount_mg: string
          p_notes?: string
          p_occurrence_key: string
          p_request_key: string
          p_seen_dose_mg: string
          p_seen_mixture_version_id: string
          p_seen_scheduled_at: string
          p_site?: string
        }
        Returns: Json
      }
      correct_personal_vial: {
        Args: {
          p_remaining_mg: string
          p_request_key: string
          p_seen_remaining_mg: string
          p_vial_id: string
        }
        Returns: Json
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
      cycle_interval_next_wall: {
        Args: {
          p_anchor: string
          p_phase: Database["public"]["Tables"]["cycle_revision_phases"]["Row"]
        }
        Returns: string
      }
      cycle_interval_slots: {
        Args: {
          p_confirmations: Json
          p_phase: Database["public"]["Tables"]["cycle_revision_phases"]["Row"]
          p_prefix: string
          p_time_zone: string
        }
        Returns: {
          actual_at: string
          occurrence_key: string
          scheduled_at: string
        }[]
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
      cycle_phase_occurrences: {
        Args: {
          p_confirmations: Json
          p_phase: Database["public"]["Tables"]["cycle_revision_phases"]["Row"]
          p_plan_id: string
          p_time_zone: string
        }
        Returns: Database["public"]["CompositeTypes"]["cycle_occurrence"][]
        SetofOptions: {
          from: "*"
          to: "cycle_occurrence"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cycle_plan_occurrences: {
        Args: { p_confirmations?: Json; p_plan_id: string }
        Returns: Database["public"]["CompositeTypes"]["cycle_occurrence"][]
        SetofOptions: {
          from: "*"
          to: "cycle_occurrence"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cycle_revision_content: { Args: { p_revision_id: string }; Returns: Json }
      cycle_revision_plan_occurrences: {
        Args: {
          p_confirmations: Json
          p_plan_id: string
          p_revision_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["cycle_occurrence"][]
        SetofOptions: {
          from: "*"
          to: "cycle_occurrence"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cycle_save_replay: {
        Args: { p_request_hash: string; p_request_key: string }
        Returns: string
      }
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
      cycle_wall_instant: {
        Args: { p_time_zone: string; p_wall: string }
        Returns: string
      }
      delete_mixture: {
        Args: { p_mixture_id: string; p_version: number }
        Returns: boolean
      }
      disable_push_subscription: {
        Args: { p_device_id: string; p_endpoint?: string; p_reason: string }
        Returns: boolean
      }
      dose_confirmations: { Args: { p_plan_id: string }; Returns: Json }
      dose_result: {
        Args: { p_dose_id: string; p_replayed: boolean }
        Returns: Json
      }
      dose_skip_result: {
        Args: { p_replayed: boolean; p_skip_id: string }
        Returns: Json
      }
      dose_void_result: {
        Args: { p_replayed: boolean; p_void_id: string }
        Returns: Json
      }
      due_supplement_occurrences: {
        Args: {
          p_after_at?: string
          p_after_routine?: string
          p_from: string
          p_limit?: number
          p_to: string
        }
        Returns: {
          amount: string
          local_date: string
          name: string
          occurrence_key: string
          owner_id: string
          routine_id: string
          schedule_version: number
          scheduled_at: string
          unit: string
        }[]
      }
      end_supplement_routine:
        | { Args: { p_id: string; p_version: number }; Returns: Json }
        | {
            Args: {
              p_id: string
              p_request_hash: string
              p_request_key: string
              p_version: number
            }
            Returns: Json
          }
      finish_personal_vial: { Args: { p_vial_id: string }; Returns: boolean }
      has_research_access: { Args: never; Returns: boolean }
      invite_researcher: {
        Args: {
          p_email: string
          p_name: string
          p_role?: Database["public"]["Enums"]["app_role"]
          p_token_hash: string
        }
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
      is_dose_site: { Args: { p_site: string }; Returns: boolean }
      is_measurement_name: { Args: { p_name: string }; Returns: boolean }
      is_supplement_amount: { Args: { p_amount: number }; Returns: boolean }
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
      link_business_sale: {
        Args: {
          p_buyer_profile_id: string
          p_sale_id: string
          p_same_name?: boolean
        }
        Returns: number
      }
      mark_invitation_send_failed: {
        Args: { p_error: string; p_id: string }
        Returns: undefined
      }
      mixture_check_peptide: {
        Args: { p_owner: string; p_peptide_id: string }
        Returns: undefined
      }
      mixture_decimal: { Args: { p_text: string }; Returns: number }
      open_vial_of: {
        Args: { p_mixture: string; p_owner: string; p_tracking: boolean }
        Returns: string
      }
      parse_cad_amount: { Args: { p_text: string }; Returns: number }
      parse_fx_rate: { Args: { p_text: string }; Returns: number }
      parse_strength_mg: { Args: { p_text: string }; Returns: number }
      plan_mixture_version_at: {
        Args: { p_at: string; p_plan_id: string }
        Returns: string
      }
      progress_day: { Args: { p_at: string }; Returns: string }
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
      record_business_purchase_fx: {
        Args: {
          p_fx_rate?: string
          p_fx_rate_date?: string
          p_idempotency_key: string
          p_original_currency: string
          p_original_unit_cost?: string
          p_peptide_id?: string
          p_quantity: number
          p_received_on: string
          p_stock_item_id?: string
          p_strength_mg?: string
          p_unit_cost?: string
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
          p_seller_id?: string
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
      reopen_personal_vial: { Args: { p_vial_id: string }; Returns: string }
      resend_invitation: {
        Args: { p_id: string; p_token_hash: string }
        Returns: {
          email: string
          name: string
        }[]
      }
      save_account_preferences: {
        Args: {
          p_appearance?: string
          p_default_syringe?: number
          p_request_hash: string
          p_request_key: string
          p_weight_unit?: string
        }
        Returns: Json
      }
      save_check_in: {
        Args: {
          p_day: string
          p_effects: string[]
          p_effects_other?: string
          p_feeling: number
          p_measurement_name?: string
          p_measurement_unit?: string
          p_measurement_value?: number
          p_note: string
          p_version: number
        }
        Returns: Json
      }
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
      save_cycle_with_mixtures: {
        Args: {
          p_baseline: string
          p_cycle_id?: string
          p_goal: string
          p_mixtures?: Json
          p_name: string
          p_plans: Json
          p_request_hash: string
          p_request_key: string
          p_template_id?: string
          p_time_zone: string
          p_version?: number
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
      save_mixture: {
        Args: {
          p_line_spacing: string
          p_liquid_ml: string
          p_mixture_id?: string
          p_peptide_id: string
          p_plan_ids?: string[]
          p_syringe_units: number
          p_version?: number
          p_vial_mg: string
        }
        Returns: string
      }
      save_personal_vial: {
        Args: {
          p_label: string
          p_mixture_id?: string
          p_peptide_id: string
          p_strength_mg: string
          p_vial_id?: string
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
      save_supplement_routine:
        | {
            Args: {
              p_amount: string
              p_id: string
              p_name: string
              p_time: string
              p_unit: string
              p_version: number
            }
            Returns: Json
          }
        | {
            Args: {
              p_amount: string
              p_end_date: string
              p_id: string
              p_name: string
              p_request_hash: string
              p_request_key: string
              p_start_date: string
              p_time: string
              p_unit: string
              p_version: number
            }
            Returns: Json
          }
      set_supplement_tracking: {
        Args: { p_enabled: boolean }
        Returns: boolean
      }
      set_supply_tracking: { Args: { p_enabled: boolean }; Returns: boolean }
      share_with_team:
        | { Args: never; Returns: string }
        | { Args: { p_request_key: string }; Returns: Json }
      skip_dose: {
        Args: {
          p_occurrence_key: string
          p_request_key: string
          p_seen_dose_mg: string
          p_seen_scheduled_at: string
        }
        Returns: Json
      }
      stop_sharing_with_team:
        | { Args: never; Returns: boolean }
        | { Args: { p_request_key: string }; Returns: Json }
      store_fx_rates: {
        Args: { p_rates: Json }
        Returns: {
          conflicts: string[]
          invalid: number
          stored: number
          unchanged: number
        }[]
      }
      supplement_decimal: { Args: { p_text: string }; Returns: number }
      supplement_routine_end: {
        Args: { p_id: string; p_uid: string; p_version: number }
        Returns: Json
      }
      supplement_routine_ended: {
        Args: { p_definition_from: string; p_end_date: string; p_today: string }
        Returns: boolean
      }
      supplement_routine_save: {
        Args: {
          p_amount: string
          p_end_date: string
          p_id: string
          p_name: string
          p_start_date: string
          p_time: string
          p_uid: string
          p_unit: string
          p_version: number
        }
        Returns: Json
      }
      supplement_taken_result: {
        Args: { p_id: string; p_replayed: boolean }
        Returns: Json
      }
      supplement_tracking_of: { Args: { p_owner: string }; Returns: boolean }
      supplement_write_replay: {
        Args: {
          p_kind: string
          p_request_hash: string
          p_request_key: string
          p_uid: string
        }
        Returns: Json
      }
      support_share_replay: {
        Args: { p_kind: string; p_request_key: string; p_uid: string }
        Returns: Json
      }
      take_supplement: {
        Args: {
          p_actual_at?: string
          p_occurrence_key: string
          p_request_key: string
          p_seen_amount: string
          p_seen_name: string
          p_seen_scheduled_at: string
          p_seen_unit: string
        }
        Returns: Json
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
      undo_dose: {
        Args: { p_entry_id: string; p_request_key: string }
        Returns: Json
      }
      vial_correction_result: {
        Args: { p_id: string; p_replayed: boolean }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "researcher"
      business_buyer_type: "account" | "outside"
      invitation_state: "pending" | "accepted" | "failed"
    }
    CompositeTypes: {
      cycle_occurrence: {
        occurrence_key: string | null
        phase_id: string | null
        scheduled_at: string | null
        time_zone: string | null
        local_date: string | null
        dose_mg: number | null
        actual_at: string | null
      }
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

