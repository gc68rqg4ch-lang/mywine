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
      api_budget: {
        Row: {
          extra_usd: number
          month: string
          notified_on: string | null
          updated_at: string
        }
        Insert: {
          extra_usd?: number
          month: string
          notified_on?: string | null
          updated_at?: string
        }
        Update: {
          extra_usd?: number
          month?: string
          notified_on?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      api_usage: {
        Row: {
          cache_read_tokens: number
          cache_write_tokens: number
          cost_usd: number
          created_at: string
          id: string
          input_tokens: number
          job_ref: string | null
          model: string
          output_tokens: number
          purpose: string
          web_fetches: number
          web_searches: number
          wine_id: string | null
        }
        Insert: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number
          job_ref?: string | null
          model: string
          output_tokens?: number
          purpose: string
          web_fetches?: number
          web_searches?: number
          wine_id?: string | null
        }
        Update: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number
          job_ref?: string | null
          model?: string
          output_tokens?: number
          purpose?: string
          web_fetches?: number
          web_searches?: number
          wine_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "wines"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_notes: {
        Row: {
          created_at: string
          error: string | null
          generated_at: string | null
          id: string
          model: string | null
          note_date: string
          person_id: string
          status: string
          text: string | null
          wines: Json
        }
        Insert: {
          created_at?: string
          error?: string | null
          generated_at?: string | null
          id?: string
          model?: string | null
          note_date: string
          person_id: string
          status?: string
          text?: string | null
          wines?: Json
        }
        Update: {
          created_at?: string
          error?: string | null
          generated_at?: string | null
          id?: string
          model?: string | null
          note_date?: string
          person_id?: string
          status?: string
          text?: string | null
          wines?: Json
        }
        Relationships: [
          {
            foreignKeyName: "daily_notes_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "cellar_wine_summary"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "ingest_jobs_matched_wine_id_fkey"
            columns: ["matched_wine_id"]
            isOneToOne: false
            referencedRelation: "tasted_wines"
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
      inventory_events: {
        Row: {
          bottle_size_ml: number | null
          created_at: string
          currency: string | null
          event_type: Database["public"]["Enums"]["event_type"]
          fill_level_percent: number | null
          id: string
          inventory_item_id: string | null
          note: string | null
          occurred_at: string
          place_id: string | null
          price: number | null
          quantity: number | null
          rating: number | null
          source: string
          storage_from: string | null
          storage_to: string | null
          vendor_id: string | null
          vintage_year: number | null
          wine_id: string
        }
        Insert: {
          bottle_size_ml?: number | null
          created_at?: string
          currency?: string | null
          event_type: Database["public"]["Enums"]["event_type"]
          fill_level_percent?: number | null
          id?: string
          inventory_item_id?: string | null
          note?: string | null
          occurred_at?: string
          place_id?: string | null
          price?: number | null
          quantity?: number | null
          rating?: number | null
          source?: string
          storage_from?: string | null
          storage_to?: string | null
          vendor_id?: string | null
          vintage_year?: number | null
          wine_id: string
        }
        Update: {
          bottle_size_ml?: number | null
          created_at?: string
          currency?: string | null
          event_type?: Database["public"]["Enums"]["event_type"]
          fill_level_percent?: number | null
          id?: string
          inventory_item_id?: string | null
          note?: string | null
          occurred_at?: string
          place_id?: string | null
          price?: number | null
          quantity?: number | null
          rating?: number | null
          source?: string
          storage_from?: string | null
          storage_to?: string | null
          vendor_id?: string | null
          vintage_year?: number | null
          wine_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_events_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "cellar_overview"
            referencedColumns: ["inventory_item_id"]
          },
          {
            foreignKeyName: "inventory_events_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_events_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_events_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_events_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_overview"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "inventory_events_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_wine_summary"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "inventory_events_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "tasted_wines"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "inventory_events_wine_id_fkey"
            columns: ["wine_id"]
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
          gift_from: string | null
          id: string
          is_gift: boolean
          personal_vintage_rating: number | null
          personal_wine_rating: number | null
          photo_urls: string[]
          price_note: string | null
          price_source: string | null
          purchase_price: number | null
          purchased_at: string | null
          quantity: number
          regular_price: number | null
          status: Database["public"]["Enums"]["inventory_status"]
          storage_compartment: string | null
          storage_house: string | null
          storage_location: string | null
          storage_room: string | null
          updated_at: string
          vendor_id: string | null
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
          gift_from?: string | null
          id?: string
          is_gift?: boolean
          personal_vintage_rating?: number | null
          personal_wine_rating?: number | null
          photo_urls?: string[]
          price_note?: string | null
          price_source?: string | null
          purchase_price?: number | null
          purchased_at?: string | null
          quantity?: number
          regular_price?: number | null
          status?: Database["public"]["Enums"]["inventory_status"]
          storage_compartment?: string | null
          storage_house?: string | null
          storage_location?: string | null
          storage_room?: string | null
          updated_at?: string
          vendor_id?: string | null
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
          gift_from?: string | null
          id?: string
          is_gift?: boolean
          personal_vintage_rating?: number | null
          personal_wine_rating?: number | null
          photo_urls?: string[]
          price_note?: string | null
          price_source?: string | null
          purchase_price?: number | null
          purchased_at?: string | null
          quantity?: number
          regular_price?: number | null
          status?: Database["public"]["Enums"]["inventory_status"]
          storage_compartment?: string | null
          storage_house?: string | null
          storage_location?: string | null
          storage_room?: string | null
          updated_at?: string
          vendor_id?: string | null
          vintage_notes?: string | null
          vintage_rating?: string | null
          vintage_year?: number | null
          wine_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "cellar_wine_summary"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "inventory_items_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "tasted_wines"
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
      login_codes: {
        Row: {
          attempts: number
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          invalidated_at: string | null
          used_at: string | null
          user_id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          invalidated_at?: string | null
          used_at?: string | null
          user_id: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          invalidated_at?: string | null
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
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
      persons: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          telegram_user_id: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          telegram_user_id?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          telegram_user_id?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      places: {
        Row: {
          city: string | null
          created_at: string
          description: string | null
          id: string
          is_home: boolean
          kind: string | null
          name: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_home?: boolean
          kind?: string | null
          name: string
        }
        Update: {
          city?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_home?: boolean
          kind?: string | null
          name?: string
        }
        Relationships: []
      }
      research_jobs: {
        Row: {
          attempts: number
          created_at: string
          created_by: string | null
          error: string | null
          finished_at: string | null
          hold: string | null
          id: string
          kind: string
          notified_at: string | null
          params: Json
          position: number
          result: Json | null
          run_id: string
          started_at: string | null
          status: string
          summary: string | null
          vintage_year: number | null
          wine_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          hold?: string | null
          id?: string
          kind: string
          notified_at?: string | null
          params?: Json
          position?: number
          result?: Json | null
          run_id: string
          started_at?: string | null
          status?: string
          summary?: string | null
          vintage_year?: number | null
          wine_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          hold?: string | null
          id?: string
          kind?: string
          notified_at?: string | null
          params?: Json
          position?: number
          result?: Json | null
          run_id?: string
          started_at?: string | null
          status?: string
          summary?: string | null
          vintage_year?: number | null
          wine_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_jobs_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_overview"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "research_jobs_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_wine_summary"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "research_jobs_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "tasted_wines"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "research_jobs_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "wines"
            referencedColumns: ["id"]
          },
        ]
      }
      research_suggestions: {
        Row: {
          created_at: string
          current_value: Json | null
          decided_at: string | null
          decided_by: string | null
          field: string
          id: string
          source_note: string | null
          status: string
          suggested_value: Json
          vintage_year: number | null
          wine_id: string
        }
        Insert: {
          created_at?: string
          current_value?: Json | null
          decided_at?: string | null
          decided_by?: string | null
          field: string
          id?: string
          source_note?: string | null
          status?: string
          suggested_value: Json
          vintage_year?: number | null
          wine_id: string
        }
        Update: {
          created_at?: string
          current_value?: Json | null
          decided_at?: string | null
          decided_by?: string | null
          field?: string
          id?: string
          source_note?: string | null
          status?: string
          suggested_value?: Json
          vintage_year?: number | null
          wine_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_suggestions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_suggestions_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_overview"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "research_suggestions_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_wine_summary"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "research_suggestions_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "tasted_wines"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "research_suggestions_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "wines"
            referencedColumns: ["id"]
          },
        ]
      }
      research_worker_lock: {
        Row: {
          id: number
          locked_until: string | null
          owner: string | null
        }
        Insert: {
          id: number
          locked_until?: string | null
          owner?: string | null
        }
        Update: {
          id?: number
          locked_until?: string | null
          owner?: string | null
        }
        Relationships: []
      }
      spirit_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "spirit_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "spirit_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_chat_messages: {
        Row: {
          chat_id: number
          content: string
          created_at: string
          id: number
          role: string
        }
        Insert: {
          chat_id: number
          content: string
          created_at?: string
          id?: never
          role: string
        }
        Update: {
          chat_id?: number
          content?: string
          created_at?: string
          id?: never
          role?: string
        }
        Relationships: []
      }
      vendors: {
        Row: {
          archived: boolean
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      wine_encounters: {
        Row: {
          companions: string | null
          created_at: string
          currency: string
          id: string
          note: string | null
          occasion: string | null
          person_id: string | null
          place_id: string | null
          price: number | null
          price_unit: string | null
          source: string
          tasted_on: string
          updated_at: string
          vintage_year: number | null
          wine_id: string
        }
        Insert: {
          companions?: string | null
          created_at?: string
          currency?: string
          id?: string
          note?: string | null
          occasion?: string | null
          person_id?: string | null
          place_id?: string | null
          price?: number | null
          price_unit?: string | null
          source?: string
          tasted_on?: string
          updated_at?: string
          vintage_year?: number | null
          wine_id: string
        }
        Update: {
          companions?: string | null
          created_at?: string
          currency?: string
          id?: string
          note?: string | null
          occasion?: string | null
          person_id?: string | null
          place_id?: string | null
          price?: number | null
          price_unit?: string | null
          source?: string
          tasted_on?: string
          updated_at?: string
          vintage_year?: number | null
          wine_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wine_encounters_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wine_encounters_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wine_encounters_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_overview"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_encounters_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_wine_summary"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_encounters_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "tasted_wines"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_encounters_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "wines"
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
            referencedRelation: "cellar_wine_summary"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_grape_shares_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "tasted_wines"
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
      wine_media: {
        Row: {
          created_at: string
          file_name: string | null
          id: string
          inventory_item_id: string | null
          kind: Database["public"]["Enums"]["media_kind"]
          mime_type: string | null
          sort_order: number
          storage_bucket: string
          storage_path: string
          thumb_path: string | null
          vintage_year: number | null
          wine_id: string
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          id?: string
          inventory_item_id?: string | null
          kind: Database["public"]["Enums"]["media_kind"]
          mime_type?: string | null
          sort_order?: number
          storage_bucket: string
          storage_path: string
          thumb_path?: string | null
          vintage_year?: number | null
          wine_id: string
        }
        Update: {
          created_at?: string
          file_name?: string | null
          id?: string
          inventory_item_id?: string | null
          kind?: Database["public"]["Enums"]["media_kind"]
          mime_type?: string | null
          sort_order?: number
          storage_bucket?: string
          storage_path?: string
          thumb_path?: string | null
          vintage_year?: number | null
          wine_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wine_media_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "cellar_overview"
            referencedColumns: ["inventory_item_id"]
          },
          {
            foreignKeyName: "wine_media_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wine_media_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_overview"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_media_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_wine_summary"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_media_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "tasted_wines"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_media_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "wines"
            referencedColumns: ["id"]
          },
        ]
      }
      wine_ratings: {
        Row: {
          created_at: string
          encounter_id: string | null
          id: string
          inventory_item_id: string | null
          note: string | null
          person_id: string
          rated_at: string
          rating: number
          source: string
          updated_at: string
          vintage_year: number | null
          wine_id: string
        }
        Insert: {
          created_at?: string
          encounter_id?: string | null
          id?: string
          inventory_item_id?: string | null
          note?: string | null
          person_id: string
          rated_at?: string
          rating: number
          source?: string
          updated_at?: string
          vintage_year?: number | null
          wine_id: string
        }
        Update: {
          created_at?: string
          encounter_id?: string | null
          id?: string
          inventory_item_id?: string | null
          note?: string | null
          person_id?: string
          rated_at?: string
          rating?: number
          source?: string
          updated_at?: string
          vintage_year?: number | null
          wine_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wine_ratings_encounter_id_fkey"
            columns: ["encounter_id"]
            isOneToOne: false
            referencedRelation: "wine_encounters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wine_ratings_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "cellar_overview"
            referencedColumns: ["inventory_item_id"]
          },
          {
            foreignKeyName: "wine_ratings_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wine_ratings_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wine_ratings_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_overview"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_ratings_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_wine_summary"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_ratings_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "tasted_wines"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_ratings_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "wines"
            referencedColumns: ["id"]
          },
        ]
      }
      wine_taste_profiles: {
        Row: {
          acidity: string | null
          alcohol: string | null
          aromas: Json
          body: string | null
          confidence: string | null
          created_at: string
          evidence: Json
          finish: string | null
          flavour_intensity: string | null
          food_pairing: string[]
          id: string
          researched_at: string | null
          source: string
          source_note: string | null
          sources: Json
          style_summary: string | null
          sweetness: string | null
          tannin: string | null
          updated_at: string
          vintage_year: number | null
          wine_id: string
        }
        Insert: {
          acidity?: string | null
          alcohol?: string | null
          aromas?: Json
          body?: string | null
          confidence?: string | null
          created_at?: string
          evidence?: Json
          finish?: string | null
          flavour_intensity?: string | null
          food_pairing?: string[]
          id?: string
          researched_at?: string | null
          source?: string
          source_note?: string | null
          sources?: Json
          style_summary?: string | null
          sweetness?: string | null
          tannin?: string | null
          updated_at?: string
          vintage_year?: number | null
          wine_id: string
        }
        Update: {
          acidity?: string | null
          alcohol?: string | null
          aromas?: Json
          body?: string | null
          confidence?: string | null
          created_at?: string
          evidence?: Json
          finish?: string | null
          flavour_intensity?: string | null
          food_pairing?: string[]
          id?: string
          researched_at?: string | null
          source?: string
          source_note?: string | null
          sources?: Json
          style_summary?: string | null
          sweetness?: string | null
          tannin?: string | null
          updated_at?: string
          vintage_year?: number | null
          wine_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wine_taste_profiles_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_overview"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_taste_profiles_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_wine_summary"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_taste_profiles_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "tasted_wines"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_taste_profiles_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "wines"
            referencedColumns: ["id"]
          },
        ]
      }
      wine_tastings: {
        Row: {
          created_at: string
          encounter_id: string | null
          id: string
          inventory_item_id: string | null
          notes: string | null
          person_id: string | null
          place_id: string | null
          quality_level: string | null
          quality_points: number | null
          readiness: string | null
          sat: Json
          source: string
          tasted_at: string
          tool_version: string
          updated_at: string
          vintage_year: number | null
          wine_id: string
          wine_style: string | null
        }
        Insert: {
          created_at?: string
          encounter_id?: string | null
          id?: string
          inventory_item_id?: string | null
          notes?: string | null
          person_id?: string | null
          place_id?: string | null
          quality_level?: string | null
          quality_points?: number | null
          readiness?: string | null
          sat?: Json
          source?: string
          tasted_at?: string
          tool_version?: string
          updated_at?: string
          vintage_year?: number | null
          wine_id: string
          wine_style?: string | null
        }
        Update: {
          created_at?: string
          encounter_id?: string | null
          id?: string
          inventory_item_id?: string | null
          notes?: string | null
          person_id?: string | null
          place_id?: string | null
          quality_level?: string | null
          quality_points?: number | null
          readiness?: string | null
          sat?: Json
          source?: string
          tasted_at?: string
          tool_version?: string
          updated_at?: string
          vintage_year?: number | null
          wine_id?: string
          wine_style?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wine_tastings_encounter_id_fkey"
            columns: ["encounter_id"]
            isOneToOne: false
            referencedRelation: "wine_encounters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wine_tastings_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "cellar_overview"
            referencedColumns: ["inventory_item_id"]
          },
          {
            foreignKeyName: "wine_tastings_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wine_tastings_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wine_tastings_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wine_tastings_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_overview"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_tastings_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_wine_summary"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_tastings_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "tasted_wines"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_tastings_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "wines"
            referencedColumns: ["id"]
          },
        ]
      }
      wine_vintages: {
        Row: {
          created_at: string
          drink_from_year: number | null
          drink_until_year: number | null
          drink_window_note: string | null
          drink_window_source: string | null
          id: string
          notes: string | null
          personal_rating: number | null
          taste_profile_checked_at: string | null
          updated_at: string
          vintage_rating: string | null
          vintage_year: number | null
          wine_id: string
        }
        Insert: {
          created_at?: string
          drink_from_year?: number | null
          drink_until_year?: number | null
          drink_window_note?: string | null
          drink_window_source?: string | null
          id?: string
          notes?: string | null
          personal_rating?: number | null
          taste_profile_checked_at?: string | null
          updated_at?: string
          vintage_rating?: string | null
          vintage_year?: number | null
          wine_id: string
        }
        Update: {
          created_at?: string
          drink_from_year?: number | null
          drink_until_year?: number | null
          drink_window_note?: string | null
          drink_window_source?: string | null
          id?: string
          notes?: string | null
          personal_rating?: number | null
          taste_profile_checked_at?: string | null
          updated_at?: string
          vintage_rating?: string | null
          vintage_year?: number | null
          wine_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wine_vintages_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_overview"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_vintages_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_wine_summary"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_vintages_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "tasted_wines"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_vintages_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "wines"
            referencedColumns: ["id"]
          },
        ]
      }
      wines: {
        Row: {
          age_years: number | null
          alcohol_content: number | null
          appellation: string | null
          bottled_year: number | null
          cask: string | null
          country: string | null
          created_at: string
          distilled_year: number | null
          grapes: string[]
          id: string
          name: string
          notes: string | null
          open_keep_days: number | null
          open_keep_note: string | null
          open_keep_source: string | null
          producer: string | null
          region: string | null
          researched_at: string | null
          spirit_category_id: string | null
          type: Database["public"]["Enums"]["wine_type"] | null
          want_to_buy: boolean
        }
        Insert: {
          age_years?: number | null
          alcohol_content?: number | null
          appellation?: string | null
          bottled_year?: number | null
          cask?: string | null
          country?: string | null
          created_at?: string
          distilled_year?: number | null
          grapes?: string[]
          id?: string
          name: string
          notes?: string | null
          open_keep_days?: number | null
          open_keep_note?: string | null
          open_keep_source?: string | null
          producer?: string | null
          region?: string | null
          researched_at?: string | null
          spirit_category_id?: string | null
          type?: Database["public"]["Enums"]["wine_type"] | null
          want_to_buy?: boolean
        }
        Update: {
          age_years?: number | null
          alcohol_content?: number | null
          appellation?: string | null
          bottled_year?: number | null
          cask?: string | null
          country?: string | null
          created_at?: string
          distilled_year?: number | null
          grapes?: string[]
          id?: string
          name?: string
          notes?: string | null
          open_keep_days?: number | null
          open_keep_note?: string | null
          open_keep_source?: string | null
          producer?: string | null
          region?: string | null
          researched_at?: string | null
          spirit_category_id?: string | null
          type?: Database["public"]["Enums"]["wine_type"] | null
          want_to_buy?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "wines_spirit_category_id_fkey"
            columns: ["spirit_category_id"]
            isOneToOne: false
            referencedRelation: "spirit_categories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      cellar_overview: {
        Row: {
          age_years: number | null
          alcohol_content: number | null
          appellation: string | null
          bottle_size_ml: number | null
          bottled_year: number | null
          cask: string | null
          country: string | null
          currency: string | null
          date_opened: string | null
          distilled_year: number | null
          drink_from_year: number | null
          drink_status: string | null
          drink_until_year: number | null
          drunk_at: string | null
          fill_level_percent: number | null
          grapes: string[] | null
          inventory_item_id: string | null
          is_gift: boolean | null
          name: string | null
          personal_vintage_rating: number | null
          personal_wine_rating: number | null
          producer: string | null
          purchase_price: number | null
          purchased_at: string | null
          quantity: number | null
          region: string | null
          regular_price: number | null
          spirit_category_id: string | null
          spirit_main_category: string | null
          spirit_main_category_id: string | null
          spirit_sub_category: string | null
          status: Database["public"]["Enums"]["inventory_status"] | null
          stock_value: number | null
          stock_value_regular: number | null
          storage_compartment: string | null
          storage_house: string | null
          storage_location: string | null
          storage_room: string | null
          type: Database["public"]["Enums"]["wine_type"] | null
          vendor_id: string | null
          vendor_name: string | null
          vintage_rating: string | null
          vintage_year: number | null
          wine_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wines_spirit_category_id_fkey"
            columns: ["spirit_category_id"]
            isOneToOne: false
            referencedRelation: "spirit_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      cellar_wine_summary: {
        Row: {
          age_years: number | null
          appellation: string | null
          bottled_year: number | null
          cask: string | null
          country: string | null
          distilled_year: number | null
          grapes: string[] | null
          locations: Json | null
          name: string | null
          open_bottles: number | null
          price_classes: string[] | null
          producer: string | null
          region: string | null
          sealed_bottles: number | null
          spirit_category_id: string | null
          spirit_main_category: string | null
          spirit_main_category_id: string | null
          spirit_sub_category: string | null
          stock_value: number | null
          stock_value_regular: number | null
          type: Database["public"]["Enums"]["wine_type"] | null
          vintage_details: Json | null
          vintages: number[] | null
          wine_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wines_spirit_category_id_fkey"
            columns: ["spirit_category_id"]
            isOneToOne: false
            referencedRelation: "spirit_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      cellar_wines: {
        Row: {
          age_years: number | null
          appellation: string | null
          avg_price: number | null
          bottle_size_ml: number | null
          bottled_year: number | null
          cask: string | null
          country: string | null
          distilled_year: number | null
          drink_from_year: number | null
          drink_status: string | null
          drink_until_year: number | null
          locations: Json | null
          name: string | null
          open_bottles: number | null
          price_class: string | null
          producer: string | null
          region: string | null
          sealed_bottles: number | null
          spirit_category_id: string | null
          spirit_main_category: string | null
          spirit_main_category_id: string | null
          spirit_sub_category: string | null
          stock_value: number | null
          stock_value_regular: number | null
          type: Database["public"]["Enums"]["wine_type"] | null
          vintage_year: number | null
          wine_id: string | null
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
            referencedRelation: "cellar_wine_summary"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "inventory_items_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "tasted_wines"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "inventory_items_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "wines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wines_spirit_category_id_fkey"
            columns: ["spirit_category_id"]
            isOneToOne: false
            referencedRelation: "spirit_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      latest_wine_ratings: {
        Row: {
          note: string | null
          person_id: string | null
          person_name: string | null
          rated_at: string | null
          rating: number | null
          vintage_year: number | null
          wine_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wine_ratings_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wine_ratings_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_overview"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_ratings_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "cellar_wine_summary"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_ratings_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "tasted_wines"
            referencedColumns: ["wine_id"]
          },
          {
            foreignKeyName: "wine_ratings_wine_id_fkey"
            columns: ["wine_id"]
            isOneToOne: false
            referencedRelation: "wines"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_locations: {
        Row: {
          open_bottles: number | null
          sealed_bottles: number | null
          storage_house: string | null
          storage_room: string | null
        }
        Relationships: []
      }
      tasted_wines: {
        Row: {
          bottles_in_stock: number | null
          encounter_count: number | null
          last_place_name: string | null
          last_tasted_on: string | null
          want_to_buy: boolean | null
          wine_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      acquire_research_worker: {
        Args: { p_owner: string; p_seconds: number }
        Returns: boolean
      }
      api_cost_by_purpose: {
        Args: { p_from: string; p_to: string }
        Returns: {
          calls: number
          cost_usd: number
          purpose: string
          web_searches: number
        }[]
      }
      change_vintage: {
        Args: {
          p_from: number
          p_item_id?: string
          p_to: number
          p_wine_id: string
        }
        Returns: undefined
      }
      claim_research_job: {
        Args: { p_owner: string }
        Returns: {
          attempts: number
          created_at: string
          created_by: string | null
          error: string | null
          finished_at: string | null
          hold: string | null
          id: string
          kind: string
          notified_at: string | null
          params: Json
          position: number
          result: Json | null
          run_id: string
          started_at: string | null
          status: string
          summary: string | null
          vintage_year: number | null
          wine_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "research_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cleanup_daily_notes: { Args: never; Returns: number }
      cleanup_login_codes: { Args: never; Returns: number }
      cleanup_research_jobs: { Args: never; Returns: number }
      delete_bottles: {
        Args: { p_item_id: string; p_quantity?: number }
        Returns: number
      }
      delete_wine: {
        Args: { p_wine_id: string }
        Returns: {
          storage_bucket: string
          storage_path: string
          thumb_path: string
        }[]
      }
      ensure_wine_vintage: {
        Args: { p_vintage_year?: number; p_wine_id: string }
        Returns: string
      }
      expire_stale_ingest_jobs: { Args: never; Returns: number }
      move_bottles: {
        Args: {
          p_compartment?: string
          p_house: string
          p_item_id: string
          p_location?: string
          p_quantity: number
          p_room: string
        }
        Returns: string
      }
      open_bottle: {
        Args: {
          p_date_opened?: string
          p_fill_level_percent?: number
          p_item_id: string
        }
        Returns: string
      }
      price_class: { Args: { p_price: number }; Returns: string }
      release_research_worker: { Args: { p_owner: string }; Returns: undefined }
      replace_grape_shares: {
        Args: { p_shares: Json; p_vintage_year: number; p_wine_id: string }
        Returns: {
          created_at: string
          grape: string
          id: string
          percent: number | null
          sort_order: number
          source: string
          updated_at: string
          vintage_year: number | null
          wine_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "wine_grape_shares"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      spirit_bottle_empty: { Args: { p_item_id: string }; Returns: Json }
    }
    Enums: {
      event_type:
        | "purchased"
        | "opened"
        | "fill_changed"
        | "drunk"
        | "moved"
        | "deleted"
      ingest_status:
        | "received"
        | "processing"
        | "needs_review"
        | "confirmed"
        | "discarded"
        | "failed"
      inventory_status: "sealed" | "open" | "drunk"
      media_kind: "label_front" | "label_back" | "photo" | "document"
      wine_type:
        | "red"
        | "white"
        | "rose"
        | "sparkling"
        | "sweet"
        | "fortified"
        | "orange"
        | "spirit"
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
      event_type: [
        "purchased",
        "opened",
        "fill_changed",
        "drunk",
        "moved",
        "deleted",
      ],
      ingest_status: [
        "received",
        "processing",
        "needs_review",
        "confirmed",
        "discarded",
        "failed",
      ],
      inventory_status: ["sealed", "open", "drunk"],
      media_kind: ["label_front", "label_back", "photo", "document"],
      wine_type: [
        "red",
        "white",
        "rose",
        "sparkling",
        "sweet",
        "fortified",
        "orange",
        "spirit",
      ],
    },
  },
} as const
