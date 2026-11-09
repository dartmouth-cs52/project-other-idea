
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "memberships": {
                  Row: {
                    "created_at": string,"org_id": string,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"org_id": string,"role"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"org_id"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "cancels_at_period_end": boolean,"created_at": string,"current_period_end": string | null,"id": string,"monthly_turn_limit": number,"name": string,"plan": string,"stripe_customer_id": string | null,"stripe_subscription_id": string | null,"subscription_status": string,"trial_ends_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancels_at_period_end"?: boolean,"created_at"?: string,"current_period_end"?: string | null,"id"?: string,"monthly_turn_limit"?: number,"name": string,"plan"?: string,"stripe_customer_id"?: string | null,"stripe_subscription_id"?: string | null,"subscription_status"?: string,"trial_ends_at"?: string
                  }
                  Update: {
                    "cancels_at_period_end"?: boolean,"created_at"?: string,"current_period_end"?: string | null,"id"?: string,"monthly_turn_limit"?: number,"name"?: string,"plan"?: string,"stripe_customer_id"?: string | null,"stripe_subscription_id"?: string | null,"subscription_status"?: string,"trial_ends_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"outline_labels": {
                  Row: {
                    "hidden": boolean,"href": string | null,"kind": string,"label": string,"last_seen": string,"route": string,"seen_count": number,"site_id": string,"visitor_count": number | null,"visitors": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "hidden"?: boolean,"href"?: string | null,"kind": string,"label": string,"last_seen"?: string,"route": string,"seen_count"?: number,"site_id": string,"visitor_count"?: never,"visitors"?: (string)[]
                  }
                  Update: {
                    "hidden"?: boolean,"href"?: string | null,"kind"?: string,"label"?: string,"last_seen"?: string,"route"?: string,"seen_count"?: number,"site_id"?: string,"visitor_count"?: never,"visitors"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "outline_labels_site_id_fkey"
      columns: ["site_id"]
isOneToOne: false
      referencedRelation: "sites"
      referencedColumns: ["id"]
    }
                  ]
                },"sites": {
                  Row: {
                    "allowed_origins": (string)[],"appearance": NonNullable<Json>,"created_at": string,"id": string,"installed_at": string | null,"installed_origin": string | null,"learning_enabled": boolean,"name": string,"notes": string,"org_id": string,"publishable_key": string,"url": string,"voice_enabled": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "allowed_origins"?: (string)[],"appearance"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"installed_at"?: string | null,"installed_origin"?: string | null,"learning_enabled"?: boolean,"name": string,"notes"?: string,"org_id": string,"publishable_key"?: string,"url"?: string,"voice_enabled"?: boolean
                  }
                  Update: {
                    "allowed_origins"?: (string)[],"appearance"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"installed_at"?: string | null,"installed_origin"?: string | null,"learning_enabled"?: boolean,"name"?: string,"notes"?: string,"org_id"?: string,"publishable_key"?: string,"url"?: string,"voice_enabled"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "sites_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"turns": {
                  Row: {
                    "created_at": string,"first_point_ms": number | null,"first_token_ms": number | null,"id": number,"kind": string,"model": string,"outcome": string,"path": string | null,"question": string | null,"session_id": string,"site_id": string,"step": number,"tokens_in": number,"tokens_out": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"first_point_ms"?: number | null,"first_token_ms"?: number | null,"id"?: never,"kind": string,"model": string,"outcome": string,"path"?: string | null,"question"?: string | null,"session_id": string,"site_id": string,"step"?: number,"tokens_in"?: number,"tokens_out"?: number
                  }
                  Update: {
                    "created_at"?: string,"first_point_ms"?: number | null,"first_token_ms"?: number | null,"id"?: never,"kind"?: string,"model"?: string,"outcome"?: string,"path"?: string | null,"question"?: string | null,"session_id"?: string,"site_id"?: string,"step"?: number,"tokens_in"?: number,"tokens_out"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "turns_site_id_fkey"
      columns: ["site_id"]
isOneToOne: false
      referencedRelation: "sites"
      referencedColumns: ["id"]
    }
                  ]
                },"usage_monthly": {
                  Row: {
                    "month": string,"org_id": string,"turns": number
                  }
                  ComputedFields: never
                  Insert: {
                    "month": string,"org_id": string,"turns"?: number
                  }
                  Update: {
                    "month"?: string,"org_id"?: string,"turns"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "usage_monthly_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "bump_outline_labels":
{ Args: { "p_rows": Json,"p_site": string,"p_visitor": string }; Returns: undefined
                           },
"create_organization":
{ Args: { "org_name": string }; Returns: string
                           },
"is_member":
{ Args: { "org": string }; Returns: boolean
                           },
"record_turn":
{ Args: { "p_first_point_ms": number,"p_first_token_ms": number,"p_kind": string,"p_model": string,"p_org": string,"p_outcome": string,"p_path": string,"p_question": string,"p_session": string,"p_site": string,"p_step": number,"p_tokens_in": number,"p_tokens_out": number }; Returns: undefined
                           },
"rotate_site_key":
{ Args: { "site": string }; Returns: string
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
