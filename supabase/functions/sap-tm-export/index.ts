// sap-tm-export: Generate a SAP TM-formatted CSV from active ocean rates.
// Mapping config is read from runtime_settings and snapshotted in export_log.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { format } from 'npm:date-fns'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

interface ExportRequest {
  mode: string
  format_: string
  filters?: {
    valid_from?: string
    valid_to?: string
    carrier_name?: string
  }
}

interface MappingConfig {
  format_version: string
  column_map: Record<string, string>
  date_format: string
}

interface ActiveOceanRate {
  rate_line_id: string
  carrier_scac: string | null
  carrier_name: string
  origin_locode: string | null
  destination_locode: string | null
  container_type: string
  charge_component: string
  rate_basis: string
  amount: number
  min_charge: number | null
  currency: string
  valid_from: string
  valid_to: string | null
  version_id: string
}

function formatDate(d: string | null, fmt: string): string {
  if (!d) return ''
  const date = new Date(d)
  // Map common format tokens
  if (fmt === 'YYYYMMDD') return format(date, 'yyyyMMdd')
  if (fmt === 'YYYY-MM-DD') return format(date, 'yyyy-MM-dd')
  return format(date, 'yyyy-MM-dd')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 })

  const body = await req.json() as ExportRequest
  const filters = body.filters ?? {}

  // Load mapping config
  const { data: mappingSetting } = await supabase
    .from('runtime_settings')
    .select('value')
    .eq('key', 'sap_tm_mapping')
    .single()

  const mapping: MappingConfig = (mappingSetting?.value as MappingConfig) ?? {
    format_version: 'sap_tm_ocean_v1',
    column_map: {
      carrier_scac: 'CARRIER_ID',
      origin_locode: 'SOURCE_LOCATION',
      destination_locode: 'DEST_LOCATION',
      container_type: 'FREIGHT_UNIT_TYPE',
      charge_component: 'CHARGE_TYPE',
      amount: 'RATE_AMOUNT',
      currency: 'CURRENCY',
      valid_from: 'VALID_FROM',
      valid_to: 'VALID_TO',
    },
    date_format: 'YYYYMMDD',
  }

  // Query active rates
  let query = supabase.from('active_ocean_rates').select('*')
  if (filters.carrier_name) {
    query = query.ilike('carrier_name', `%${filters.carrier_name}%`)
  }
  if (filters.valid_from) {
    query = query.gte('valid_from', filters.valid_from)
  }
  if (filters.valid_to) {
    query = query.lte('valid_from', filters.valid_to)
  }

  const { data: rates, error: qErr } = await query
  if (qErr) return new Response(JSON.stringify({ message: qErr.message }), { status: 500, headers: corsHeaders })

  const rows = (rates ?? []) as ActiveOceanRate[]

  // Build CSV using mapping config
  const canonicalToTm = mapping.column_map
  const headers = Object.values(canonicalToTm)

  const csvRows: string[] = [headers.join(',')]

  for (const r of rows) {
    const cells: string[] = []
    for (const canonKey of Object.keys(canonicalToTm)) {
      let val: string
      if (canonKey === 'carrier_scac') {
        val = r.carrier_scac ?? r.carrier_name
      } else if (canonKey === 'valid_from') {
        val = formatDate(r.valid_from, mapping.date_format)
      } else if (canonKey === 'valid_to') {
        val = formatDate(r.valid_to, mapping.date_format)
      } else {
        const raw = r[canonKey as keyof ActiveOceanRate]
        val = raw != null ? String(raw) : ''
      }
      // Escape commas
      cells.push(val.includes(',') ? `"${val}"` : val)
    }
    csvRows.push(cells.join(','))
  }

  const csv = csvRows.join('\n')
  const fileName = `sap_tm_ocean_${new Date().toISOString().slice(0, 10)}.csv`

  // Store export file in Supabase Storage
  const filePath = `exports/${fileName}`
  await supabase.storage
    .from('rate-exports')
    .upload(filePath, new Blob([csv], { type: 'text/csv' }), { upsert: true })

  // Log export
  const versionIds = [...new Set(rows.map(r => r.version_id))]
  await supabase.from('export_log').insert({
    exported_by: user.id,
    mode: 'ocean',
    format: mapping.format_version,
    rate_version_ids: versionIds,
    file_path: filePath,
    row_count: rows.length,
    mapping_config_snapshot: mapping as unknown as Record<string, unknown>,
  })

  await supabase.from('audit_log').insert({
    actor: user.id,
    action: 'export',
    entity_type: 'rate_versions',
    diff: { mode: 'ocean', rows: rows.length, format: mapping.format_version },
  })

  return new Response(csv, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  })
})
