-- ── Core tables: master data, versioning spine, NL workflow, audit ──────────

create extension if not exists "pgcrypto";

-- ── Master data ─────────────────────────────────────────────────────────────

create table carriers (
  id          uuid primary key default gen_random_uuid(),
  scac        text unique,
  name        text not null,
  aliases     jsonb not null default '[]',
  modes       text[] not null default '{}',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table locations (
  id          uuid primary key default gen_random_uuid(),
  locode      text unique,                 -- UN/LOCODE or internal zone code
  name        text not null,
  type        text not null check (type in ('port','airport','city','zip_zone','customs_zone')),
  country     char(2),
  lat         numeric(9,6),
  lon         numeric(9,6),
  created_at  timestamptz not null default now()
);

-- ── Rate contracts ───────────────────────────────────────────────────────────

create table rate_contracts (
  id               uuid primary key default gen_random_uuid(),
  carrier_id       uuid not null references carriers(id),
  mode             text not null check (mode in ('ocean','road','air')),
  contract_ref     text,
  currency         char(3) not null,
  notes            text,
  source_file_path text,            -- path in Supabase Storage to original carrier sheet
  created_by       uuid,
  created_at       timestamptz not null default now()
);

create index on rate_contracts(carrier_id);
create index on rate_contracts(mode);

-- ── Rate versions (bitemporal spine) ────────────────────────────────────────

create table rate_versions (
  id               uuid primary key default gen_random_uuid(),
  contract_id      uuid not null references rate_contracts(id),
  version_seq      integer not null,
  -- Valid time (when the rate applies)
  valid_from       date not null,
  valid_to         date,
  -- Transaction time (when we recorded it)
  recorded_at      timestamptz not null default now(),
  superseded_at    timestamptz,             -- null = currently active
  -- Change provenance
  change_source    text not null check (change_source in ('import','manual','nl_update')),
  nl_changeset_id  uuid,                    -- → nl_changesets if source = nl_update
  changed_by       uuid,
  change_note      text,
  constraint valid_period_check check (valid_to is null or valid_to > valid_from),
  constraint version_seq_positive check (version_seq > 0)
);

create index on rate_versions(contract_id);
create index on rate_versions(superseded_at) where superseded_at is null;
create index on rate_versions(valid_from, valid_to);

-- ── NL changeset + approval workflow ────────────────────────────────────────

create table nl_changesets (
  id               uuid primary key default gen_random_uuid(),
  submitted_by     uuid,
  submitted_at     timestamptz not null default now(),
  raw_prompt       text not null,
  parsed_intent    jsonb,
  affected_mode    text,
  status           text not null default 'pending_review'
                   check (status in ('pending_review','approved','rejected','applied')),
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  rejection_reason text
);

create table nl_changeset_lines (
  id              uuid primary key default gen_random_uuid(),
  changeset_id    uuid not null references nl_changesets(id) on delete cascade,
  -- Reference to the specific rate line being changed (mode-agnostic via text+uuid)
  rate_table      text not null,            -- 'ocean_rate_lines' or future mode tables
  rate_line_id    uuid not null,
  field_name      text not null,
  old_value       numeric(14,4),
  new_value       numeric(14,4),
  pct_change      numeric(8,4)
);

create index on nl_changeset_lines(changeset_id);

-- ── Export log ───────────────────────────────────────────────────────────────

create table export_log (
  id                       uuid primary key default gen_random_uuid(),
  exported_at              timestamptz not null default now(),
  exported_by              uuid,
  mode                     text not null,
  format                   text not null,               -- e.g. 'sap_tm_ocean_v1'
  rate_version_ids         uuid[] not null default '{}',
  file_path                text,
  row_count                integer,
  mapping_config_snapshot  jsonb                        -- compliance snapshot
);

-- ── Audit log ────────────────────────────────────────────────────────────────

create table audit_log (
  id           uuid primary key default gen_random_uuid(),
  occurred_at  timestamptz not null default now(),
  actor        uuid,
  action       text not null,
  entity_type  text,
  entity_id    uuid,
  diff         jsonb
);

create index on audit_log(occurred_at desc);
create index on audit_log(entity_type, entity_id);

-- ── Runtime settings (NL guardrails, SAP TM mapping config, etc.) ───────────

create table runtime_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Seed defaults
insert into runtime_settings (key, value) values
  ('nl_max_pct_change',    '25'),
  ('nl_rounding_currency', '{"USD": 2, "EUR": 2, "CNY": 0}'),
  ('sap_tm_mapping',       '{
    "format_version": "sap_tm_ocean_v1",
    "column_map": {
      "carrier_scac":       "CARRIER_ID",
      "origin_locode":      "SOURCE_LOCATION",
      "destination_locode": "DEST_LOCATION",
      "container_type":     "FREIGHT_UNIT_TYPE",
      "charge_component":   "CHARGE_TYPE",
      "amount":             "RATE_AMOUNT",
      "currency":           "CURRENCY",
      "valid_from":         "VALID_FROM",
      "valid_to":           "VALID_TO"
    },
    "date_format": "YYYYMMDD",
    "decimal_separator": ".",
    "encoding": "UTF-8"
  }');
