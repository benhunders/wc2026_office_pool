// Hand-authored types matching the Supabase schema.
// Re-generate with `supabase gen types typescript` once connected to a project.

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type Mode = 'ocean' | 'road' | 'air'
export type ChangeSource = 'import' | 'manual' | 'nl_update'
export type NlStatus = 'pending_review' | 'approved' | 'rejected' | 'applied'
export type LocationType = 'port' | 'airport' | 'city' | 'zip_zone' | 'customs_zone'

export interface Carrier {
  id: string
  scac: string | null
  name: string
  aliases: string[]
  modes: Mode[]
  active: boolean
  created_at: string
}

export interface Location {
  id: string
  locode: string | null
  name: string
  type: LocationType
  country: string | null
  lat: number | null
  lon: number | null
  created_at: string
}

export interface RateContract {
  id: string
  carrier_id: string
  mode: Mode
  contract_ref: string | null
  currency: string
  notes: string | null
  source_file_path: string | null
  created_by: string | null
  created_at: string
}

export interface RateVersion {
  id: string
  contract_id: string
  version_seq: number
  valid_from: string
  valid_to: string | null
  recorded_at: string
  superseded_at: string | null
  change_source: ChangeSource
  nl_changeset_id: string | null
  changed_by: string | null
  change_note: string | null
}

export interface OceanRateLine {
  id: string
  version_id: string
  origin_id: string
  destination_id: string
  service_loop: string | null
  container_type: ContainerType
  charge_component: ChargeComponent
  rate_basis: RateBasis
  amount: number
  min_charge: number | null
  currency: string | null
}

export type ContainerType = '20DV' | '40DV' | '40HC' | '45HC' | 'RF20' | 'RF40' | '20OT' | '40OT'
export type ChargeComponent =
  | 'BASE' | 'BAF' | 'CAF' | 'EBS' | 'LSS'
  | 'THC_ORIGIN' | 'THC_DEST'
  | 'BL_FEE' | 'DOC_FEE'
  | 'PSS' | 'GRI' | 'PCS'
  | 'ISPS' | 'AMS' | 'ENS'
  | 'OTHER'
export type RateBasis = 'PER_CONTAINER' | 'PER_CBM' | 'PER_TON' | 'PER_KG' | 'FLAT'

export interface NlChangeset {
  id: string
  submitted_by: string | null
  submitted_at: string
  raw_prompt: string
  parsed_intent: Json | null
  affected_mode: string | null
  status: NlStatus
  reviewed_by: string | null
  reviewed_at: string | null
  rejection_reason: string | null
}

export interface NlChangesetLine {
  id: string
  changeset_id: string
  rate_table: string
  rate_line_id: string
  field_name: string
  old_value: number | null
  new_value: number | null
  pct_change: number | null
}

export interface ActiveOceanRate {
  rate_line_id: string
  version_id: string
  version_seq: number
  valid_from: string
  valid_to: string | null
  contract_id: string
  carrier_id: string
  carrier_name: string
  carrier_scac: string | null
  origin_locode: string | null
  origin_name: string
  destination_locode: string | null
  destination_name: string
  service_loop: string | null
  container_type: ContainerType
  charge_component: ChargeComponent
  rate_basis: RateBasis
  amount: number
  min_charge: number | null
  currency: string
}

export interface ExportLog {
  id: string
  exported_at: string
  exported_by: string | null
  mode: string
  format: string
  rate_version_ids: string[]
  file_path: string | null
  row_count: number | null
  mapping_config_snapshot: Json | null
}

export interface AuditEntry {
  id: string
  occurred_at: string
  actor: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  diff: Json | null
}

// Supabase client Database interface
export interface Database {
  public: {
    Tables: {
      carriers: {
        Row: Carrier
        Insert: Omit<Carrier, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Carrier>
      }
      locations: {
        Row: Location
        Insert: Omit<Location, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Location>
      }
      rate_contracts: {
        Row: RateContract
        Insert: Omit<RateContract, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<RateContract>
      }
      rate_versions: {
        Row: RateVersion
        Insert: Omit<RateVersion, 'id' | 'recorded_at'> & { id?: string; recorded_at?: string }
        Update: Partial<RateVersion>
      }
      ocean_rate_lines: {
        Row: OceanRateLine
        Insert: Omit<OceanRateLine, 'id'> & { id?: string }
        Update: Partial<OceanRateLine>
      }
      nl_changesets: {
        Row: NlChangeset
        Insert: Omit<NlChangeset, 'id' | 'submitted_at'> & { id?: string; submitted_at?: string }
        Update: Partial<NlChangeset>
      }
      nl_changeset_lines: {
        Row: NlChangesetLine
        Insert: Omit<NlChangesetLine, 'id'> & { id?: string }
        Update: Partial<NlChangesetLine>
      }
      export_log: {
        Row: ExportLog
        Insert: Omit<ExportLog, 'id' | 'exported_at'> & { id?: string; exported_at?: string }
        Update: Partial<ExportLog>
      }
      audit_log: {
        Row: AuditEntry
        Insert: Omit<AuditEntry, 'id' | 'occurred_at'> & { id?: string; occurred_at?: string }
        Update: never
      }
      runtime_settings: {
        Row: { key: string; value: Json; updated_at: string; updated_by: string | null }
        Insert: { key: string; value: Json; updated_at?: string; updated_by?: string | null }
        Update: { value?: Json; updated_at?: string; updated_by?: string | null }
      }
    }
    Views: {
      active_ocean_rates: { Row: ActiveOceanRate }
    }
    Functions: {
      ocean_rates_at: {
        Args: { query_date: string }
        Returns: ActiveOceanRate[]
      }
    }
  }
}
