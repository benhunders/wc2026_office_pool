-- ── Row Level Security ───────────────────────────────────────────────────────
-- All tables require auth. Reads are open to authenticated users.
-- Writes to core tables are restricted to service_role (edge functions use service key).
-- The frontend uses anon/user key which is read-only for rate data.

alter table carriers           enable row level security;
alter table locations          enable row level security;
alter table rate_contracts     enable row level security;
alter table rate_versions      enable row level security;
alter table ocean_rate_lines   enable row level security;
alter table nl_changesets      enable row level security;
alter table nl_changeset_lines enable row level security;
alter table export_log         enable row level security;
alter table audit_log          enable row level security;
alter table runtime_settings   enable row level security;

-- Authenticated users can read everything
create policy "auth_read_carriers"           on carriers           for select using (auth.role() = 'authenticated');
create policy "auth_read_locations"          on locations          for select using (auth.role() = 'authenticated');
create policy "auth_read_rate_contracts"     on rate_contracts     for select using (auth.role() = 'authenticated');
create policy "auth_read_rate_versions"      on rate_versions      for select using (auth.role() = 'authenticated');
create policy "auth_read_ocean_rate_lines"   on ocean_rate_lines   for select using (auth.role() = 'authenticated');
create policy "auth_read_nl_changesets"      on nl_changesets      for select using (auth.role() = 'authenticated');
create policy "auth_read_nl_changeset_lines" on nl_changeset_lines for select using (auth.role() = 'authenticated');
create policy "auth_read_export_log"         on export_log         for select using (auth.role() = 'authenticated');
create policy "auth_read_audit_log"          on audit_log          for select using (auth.role() = 'authenticated');
create policy "auth_read_runtime_settings"   on runtime_settings   for select using (auth.role() = 'authenticated');

-- Authenticated users can submit NL changesets and approve/reject them
create policy "auth_insert_nl_changesets"
  on nl_changesets for insert
  with check (auth.role() = 'authenticated');

create policy "auth_update_nl_changesets"
  on nl_changesets for update
  using (auth.role() = 'authenticated')
  with check (status in ('approved','rejected'));

-- Master data management: authenticated users can insert/update carriers and locations
create policy "auth_write_carriers"
  on carriers for all
  using (auth.role() = 'authenticated');

create policy "auth_write_locations"
  on locations for all
  using (auth.role() = 'authenticated');

-- Service role (edge functions) bypass RLS implicitly via service key.
-- No explicit service_role policies needed — service role bypasses RLS by default.
