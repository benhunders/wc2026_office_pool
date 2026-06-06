-- ── Ocean rate lines (v1 mode-specific extension) ───────────────────────────

create table ocean_rate_lines (
  id               uuid primary key default gen_random_uuid(),
  version_id       uuid not null references rate_versions(id) on delete cascade,
  origin_id        uuid not null references locations(id),
  destination_id   uuid not null references locations(id),
  service_loop     text,                       -- e.g. 'AEX2', 'TP5'
  container_type   text not null
                   check (container_type in ('20DV','40DV','40HC','45HC','RF20','RF40','20OT','40OT')),
  charge_component text not null
                   check (charge_component in (
                     'BASE','BAF','CAF','EBS','LSS',
                     'THC_ORIGIN','THC_DEST',
                     'BL_FEE','DOC_FEE',
                     'PSS','GRI','PCS',
                     'ISPS','AMS','ENS',
                     'OTHER'
                   )),
  rate_basis       text not null default 'PER_CONTAINER'
                   check (rate_basis in ('PER_CONTAINER','PER_CBM','PER_TON','PER_KG','FLAT')),
  amount           numeric(14,4) not null,
  min_charge       numeric(14,4),
  currency         char(3),                   -- overrides contract currency if set
  constraint no_self_lane check (origin_id != destination_id)
);

-- Unique: one amount per version × lane × container × charge component
create unique index ocean_rate_lines_unique_key
  on ocean_rate_lines(version_id, origin_id, destination_id, container_type, charge_component);

create index on ocean_rate_lines(version_id);
create index on ocean_rate_lines(origin_id, destination_id);
create index on ocean_rate_lines(container_type);
create index on ocean_rate_lines(charge_component);

-- ── Helper view: active ocean rates (no superseded, currently valid) ─────────

create or replace view active_ocean_rates as
select
  orl.id                  as rate_line_id,
  orl.version_id,
  rv.version_seq,
  rv.valid_from,
  rv.valid_to,
  rv.contract_id,
  rc.carrier_id,
  c.name                  as carrier_name,
  c.scac                  as carrier_scac,
  ol.locode               as origin_locode,
  ol.name                 as origin_name,
  dl.locode               as destination_locode,
  dl.name                 as destination_name,
  orl.service_loop,
  orl.container_type,
  orl.charge_component,
  orl.rate_basis,
  orl.amount,
  orl.min_charge,
  coalesce(orl.currency, rc.currency) as currency
from ocean_rate_lines orl
join rate_versions rv  on rv.id = orl.version_id
join rate_contracts rc on rc.id = rv.contract_id
join carriers c        on c.id  = rc.carrier_id
join locations ol      on ol.id = orl.origin_id
join locations dl      on dl.id = orl.destination_id
where rv.superseded_at is null
  and rv.valid_from <= current_date
  and (rv.valid_to is null or rv.valid_to >= current_date);

-- ── Point-in-time query function ─────────────────────────────────────────────

create or replace function ocean_rates_at(query_date date)
returns table (
  rate_line_id      uuid,
  version_id        uuid,
  version_seq       int,
  valid_from        date,
  valid_to          date,
  contract_id       uuid,
  carrier_id        uuid,
  carrier_name      text,
  carrier_scac      text,
  origin_locode     text,
  origin_name       text,
  destination_locode text,
  destination_name  text,
  service_loop      text,
  container_type    text,
  charge_component  text,
  rate_basis        text,
  amount            numeric,
  min_charge        numeric,
  currency          char
) language sql stable as $$
  select
    orl.id,
    orl.version_id,
    rv.version_seq,
    rv.valid_from,
    rv.valid_to,
    rv.contract_id,
    rc.carrier_id,
    c.name,
    c.scac,
    ol.locode,
    ol.name,
    dl.locode,
    dl.name,
    orl.service_loop,
    orl.container_type,
    orl.charge_component,
    orl.rate_basis,
    orl.amount,
    orl.min_charge,
    coalesce(orl.currency, rc.currency)
  from ocean_rate_lines orl
  join rate_versions rv  on rv.id = orl.version_id
  join rate_contracts rc on rc.id = rv.contract_id
  join carriers c        on c.id  = rc.carrier_id
  join locations ol      on ol.id = orl.origin_id
  join locations dl      on dl.id = orl.destination_id
  where rv.superseded_at is null
    and rv.valid_from <= query_date
    and (rv.valid_to is null or rv.valid_to >= query_date);
$$;
