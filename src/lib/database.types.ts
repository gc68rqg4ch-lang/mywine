// Generiert aus dem Supabase-Projekt "mywine" (supabase gen types typescript).
// Nicht von Hand bearbeiten – nach Schemaänderungen neu generieren.

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
      app_members: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ingest_jobs: {
        Row: {
          confidence: number | null
          created_at: string
          error: string | null
          extracted: Json | null
          id: string
          inventory_item_id: string | null
          matched_wine_id: string | null
          photo_paths: string[]
          source: string
          status: Database["public"]["Enums"]["ingest_status"]
          telegram_chat_id: number | null
          telegram_message_ids: number[]
          updated_at: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          error?: string | null
          extracted?: Json | null
          id?: string
          inventory_item_id?: string | null
          matched_wine_id?: string | null
          photo_paths?: string[]
          source?: string
          status?: Database["public"]["Enums"]["ingest_status"]
          telegram_chat_id?: number | null
          telegram_message_ids?: number[]
          updated_at?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          error?: string | null
          extracted?: Json | null
          id?: string
          inventory_item_id?: string | null
          matched_wine_id?: string | null
          photo_paths?: string[]
          source?: string
          status?: Database["public"]["Enums"]["ingest_status"]
          telegram_chat_id?: number | null
          telegram_message_ids?: number[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingest_jobs_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "cellar_overview"
            referencedColumns: ["inventory_item_id"]
          },
          {
            foreignKeyName: "ingest_jobs_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingest_jobs_matched_wine_id_fkey"
            columns: ["matched_wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_overview"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "ingest_jobs_matched_wine_id_fkey"
            columns: ["matched_wine_id"]
            isOneToOne: false
            referencedRelation: "wines"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          bottle_size_ml: number | null
          created_at: string
          currency: string | null
          drunk_at: string | null
          id: string
          personal_vintage_rating: number | null
          personal_wine_rating: number | null
          photo_urls: string[]
          purchase_price: number | null
          quantity: number
          regular_price: number | null
          status: Database["public"]["Enums"]["inventory_status"]
          storage_compartment: string | null
          storage_house: string | null
          storage_location: string | null
          storage_room: string | null
          updated_at: string
          vintage_notes: string | null
          vintage_rating: string | null
          vintage_year: number | null
          wine_id: string
        }
        Insert: {
          bottle_size_ml?: number | null
          created_at?: string
          currency?: string | null
          drunk_at?: string | null
          id?: string
          personal_vintage_rating?: number | null
          personal_wine_rating?: number | null
          photo_urls?: string[]
          purchase_price?: number | null
          quantity?: number
          regular_price?: number | null
          status?: Database["public"]["Enums"]["inventory_status"]
          storage_compartment?: string | null
          storage_house?: string | null
          storage_location?: string | null
          storage_room?: string | null
          updated_at?: string
          vintage_notes?: string | null
          vintage_rating?: string | null
          vintage_year?: number | null
          wine_id: string
        }
        Update: {
          bottle_size_ml?: number | null
          created_at?: string
          currency?: string | null
          drunk_at?: string | null
          id?: string
          personal_vintage_rating?: number | null
          personal_wine_rating?: number | null
          photo_urls?: string[]
          purchase_price?: number | null
          quantity?: number
          regular_price?: number | null
          status?: Database["public"]["Enums"]["inventory_status"]
          storage_compartment?: string | null
          storage_house?: string | null
          storage_location?: string | null
          storage_room?: string | null
          updated_at?: string
          vintage_notes?: string | null
          vintage_rating?: string | null
          vintage_year?: number | null
          wine_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_overview"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "inventory_items_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "wines"
            referencedColumns: ["id"]
          },
        ]
      }
      open_bottle_details: {
        Row: {
          created_at: string
          date_opened: string | null
          fill_level_percent: number | null
          inventory_item_id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_opened?: string | null
          fill_level_percent?: number | null
          inventory_item_id: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_opened?: string | null
          fill_level_percent?: number | null
          inventory_item_id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "open_bottle_details_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: true
            referencedRelation: "cellar_overview"
            referencedColumns: ["inventory_item_id"]
          },
          {
            foreignKeyName: "open_bottle_details_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: true
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      wine_grape_shares: {
        Row: {
          created_at: string
          grape: string
          id: string
          percent: number | null
          sort_order: number
          source: string
          updated_at: string
          vintage_year: number | null
          wine_id: string
        }
        Insert: {
          created_at?: string
          grape: string
          id?: string
          percent?: number | null
          sort_order?: number
          source?: string
          updated_at?: string
          vintage_year?: number | null
          wine_id: string
        }
        Update: {
          created_at?: string
          grape?: string
          id?: string
          percent?: number | null
          sort_order?: number
          source?: string
          updated_at?: string
          vintage_year?: number | null
          wine_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wine_grape_shares_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_overview"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_grape_shares_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "wines"
            referencedColumns: ["id"]
          },
        ]
      }
      wines: {
        Row: {
          alcohol_content: number | null
          appellation: string | null
          country: string | null
          created_at: string
          grapes: string[]
          id: string
          name: string
          producer: string
          region: string | null
          type: Database["public"]["Enums"]["wine_type"] | null
        }
        Insert: {
          alcohol_content?: number | null
          appellation?: string | null
          country?: string | null
          created_at?: string
          grapes?: string[]
          id?: string
          name: string
          producer: string
          region?: string | null
          type?: Database["public"]["Enums"]["wine_type"] | null
        }
        Update: {
          alcohol_content?: number | null
          appellation?: string | null
          country?: string | null
          created_at?: string
          grapes?: string[]
          id?: string
          name?: string
          producer?: string
          region?: string | null
          type?: Database["public"]["Enums"]["wine_type"] | null
        }
        Relationships: []
      }
    }
    Views: {
      cellar_overview: {
        Row: {
          alcohol_content: number | null
          appellation: string | null
          bottle_size_ml: number | null
          country: string | null
          currency: string | null
          date_opened: string | null
          fill_level_percent: number | null
          grapes: string[] | null
          inventory_item_id: string | null
          name: string | null
          personal_vintage_rating: number | null
          personal_wine_rating: number | null
          producer: string | null
          purchase_price: number | null
          quantity: number | null
          region: string | null
          regular_price: number | null
          status: Database["public"]["Enums"]["inventory_status"] | null
          stock_value: number | null
          stock_value_regular: number | null
          storage_compartment: string | null
          storage_house: string | null
          storage_location: string | null
          storage_room: string | null
          type: Database["public"]["Enums"]["wine_type"] | null
          vintage_rating: string | null
          vintage_year: number | null
          wine_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      open_bottle: {
        Args: {
          p_date_opened?: string
          p_fill_level_percent?: number
          p_item_id: string
        }
        Returns: string
      }
    }
    Enums: {
      ingest_status:
        | "received"
        | "processing"
        | "needs_review"
        | "confirmed"
        | "discarded"
        | "failed"
      inventory_status: "sealed" | "open" | "drunk"
      wine_type:
        | "red"
        | "white"
        | "rose"
        | "sparkling"
        | "sweet"
        | "fortified"
        | "orange"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof (PublicSchema["Tables"] & PublicSchema["Views"])> =
  (PublicSchema["Tables"] & PublicSchema["Views"])[T] extends { Row: infer R } ? R : never

export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T]

export const Constants = {
  public: {
    Enums: {
      ingest_status: [
        "received",
        "processing",
        "needs_review",
        "confirmed",
        "discarded",
        "failed",
      ],
      inventory_status: ["sealed", "open", "drunk"],
      wine_type: [
        "red",
        "white",
        "rose",
        "sparkling",
        "sweet",
        "fortified",
        "orange",
      ],
    },
  },
} as const
