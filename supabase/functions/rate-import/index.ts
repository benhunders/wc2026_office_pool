// rate-import: Parse an uploaded carrier rate sheet (CSV) → preview or import.
// Supports mode: 'preview' (dry-run, returns summary) or 'import' (write to DB).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

interface ImportRequest {
  file_path: string
  mode: 'preview' | 'import'
  contract_ref?: string
}

interface ParsedRow {
  carrier: string
  origin: string
  destination: string
  container_type: string
  charge_component: string
  rate_basis: string
  amount: number
  currency: string
  valid_from: string
  valid_to?: string
  service_loop?: string
}

// Map common header synonyms to canonical field names
const HEADER_MAP: Record<string, string> = {
  carrier: 'carrier', carrier_name: 'carrier', scac: 'carrier',
  origin: 'origin', pol: 'origin', port_of_loading: 'origin', source: 'origin',
  destination: 'destination', pod: 'destination', port_of_discharge: 'destination',
  container: 'container_type', equipment: 'container_type', container_type: 'container_type',
  charge: 'charge_component', charge_type: 'charge_component', component: 'charge_component',
  amount: 'amount', rate: 'amount', freight: 'amount',
  currency: 'currency', curr: 'currency',
  valid_from: 'valid_from', effective: 'valid_from', start_date: 'valid_from',
  valid_to: 'valid_to', expiry: 'valid_to', end_date: 'valid_to',
  basis: 'rate_basis', rate_basis: 'rate_basis',
  service: 'service_loop', loop: 'service_loop',
}

function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.trim().split('\n')
  if (lines.length < 2) return []
  const rawHeaders = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, '_'))
  const headers = rawHeaders.map(h => HEADER_MAP[h] ?? h)

  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']))
  })
}

function detectCarrier(rows: Record<string, string>[]): string {
  const carriers = rows.map(r => r.carrier).filter(Boolean)
  return carriers[0] ?? 'Unknown'
}

function detectDateRange(rows: Record<string, string>[]): string {
  const dates = rows.map(r => r.valid_from).filter(Boolean).sort()
  if (!dates.length) return 'Unknown'
  return `${dates[0]} – ${dates[dates.length - 1]}`
}

function validateRow(row: Record<string, string>, i: number): { valid: boolean; warning?: string; parsed?: ParsedRow } {
  const amount = parseFloat(row.amount)
  if (isNaN(amount)) return { valid: false, warning: `Row ${i}: invalid amount "${row.amount}"` }
  if (!row.carrier) return { valid: false, warning: `Row ${i}: missing carrier` }
  if (!row.origin || !row.destination) return { valid: false, warning: `Row ${i}: missing origin/destination` }

  const containerType = row.container_type?.toUpperCase()
  const validContainers = ['20DV','40DV','40HC','45HC','RF20','RF40','20OT','40OT']
  if (!validContainers.includes(containerType)) {
    return { valid: false, warning: `Row ${i}: unrecognised container type "${row.container_type}"` }
  }

  const chargeComponent = (row.charge_component || 'BASE').toUpperCase()
  const validCharges = ['BASE','BAF','CAF','EBS','LSS','THC_ORIGIN','THC_DEST','BL_FEE','DOC_FEE','PSS','GRI','PCS','ISPS','AMS','ENS','OTHER']
  const resolvedCharge = validCharges.includes(chargeComponent) ? chargeComponent : 'OTHER'

  return {
    valid: true,
    parsed: {
      carrier: row.carrier,
      origin: row.origin.toUpperCase(),
      destination: row.destination.toUpperCase(),
      container_type: containerType,
      charge_component: resolvedCharge,
      rate_basis: row.rate_basis?.toUpperCase() || 'PER_CONTAINER',
      amount,
      currency: (row.currency || 'USD').toUpperCase(),
      valid_from: row.valid_from || new Date().toISOString().slice(0, 10),
      valid_to: row.valid_to || undefined,
      service_loop: row.service_loop || undefined,
    }
  }
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

  const { file_path, mode, contract_ref }: ImportRequest = await req.json()

  // Download file from storage
  const { data: fileData, error: dlErr } = await supabase.storage
    .from('rate-sheets')
    .download(file_path)

  if (dlErr || !fileData) {
    return new Response(JSON.stringify({ message: 'File not found in storage' }), { status: 404, headers: corsHeaders })
  }

  const csvText = await fileData.text()
  const rawRows = parseCSV(csvText)

  const warnings: string[] = []
  const validParsed: ParsedRow[] = []

  for (let i = 0; i < rawRows.length; i++) {
    const result = validateRow(rawRows[i], i + 2)
    if (!result.valid) {
      warnings.push(result.warning!)
    } else if (result.parsed) {
      validParsed.push(result.parsed)
    }
  }

  const carrierName = detectCarrier(rawRows)
  const dateRange = detectDateRange(rawRows)

  if (mode === 'preview') {
    return new Response(
      JSON.stringify({
        upload_path: file_path,
        carrier_name: carrierName,
        row_count: validParsed.length,
        date_range: dateRange,
        warnings,
        sample_rows: rawRows.slice(0, 3),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // mode === 'import' — write to DB
  // 1. Find or create carrier
  let { data: carrier } = await supabase
    .from('carriers')
    .select('*')
    .ilike('name', `%${carrierName}%`)
    .maybeSingle()

  if (!carrier) {
    const { data: newCarrier } = await supabase
      .from('carriers')
      .insert({ name: carrierName, modes: ['ocean'] })
      .select()
      .single()
    carrier = newCarrier
  }

  if (!carrier) {
    return new Response(JSON.stringify({ message: 'Failed to find/create carrier' }), { status: 500, headers: corsHeaders })
  }

  // 2. Create rate contract
  const currency = validParsed[0]?.currency ?? 'USD'
  const { data: contract } = await supabase
    .from('rate_contracts')
    .insert({
      carrier_id: carrier.id,
      mode: 'ocean',
      contract_ref: contract_ref ?? null,
      currency,
      source_file_path: file_path,
      created_by: user.id,
    })
    .select()
    .single()

  if (!contract) {
    return new Response(JSON.stringify({ message: 'Failed to create contract' }), { status: 500, headers: corsHeaders })
  }

  // 3. Create a single rate version
  const validFrom = validParsed[0]?.valid_from ?? new Date().toISOString().slice(0, 10)
  const validTo = validParsed[0]?.valid_to ?? null

  const { data: version } = await supabase
    .from('rate_versions')
    .insert({
      contract_id: (contract as { id: string }).id,
      version_seq: 1,
      valid_from: validFrom,
      valid_to: validTo,
      change_source: 'import',
      changed_by: user.id,
    })
    .select()
    .single()

  if (!version) {
    return new Response(JSON.stringify({ message: 'Failed to create version' }), { status: 500, headers: corsHeaders })
  }

  // 4. Resolve locations (find or create)
  const locoCodes = [...new Set([...validParsed.map(r => r.origin), ...validParsed.map(r => r.destination)])]
  const { data: existingLocs } = await supabase
    .from('locations')
    .select('*')
    .in('locode', locoCodes)

  const locoMap = new Map((existingLocs ?? []).map((l: { locode: string | null; id: string }) => [l.locode, l.id]))

  for (const locode of locoCodes) {
    if (!locoMap.has(locode)) {
      const { data: newLoc } = await supabase
        .from('locations')
        .insert({ locode, name: locode, type: 'port' })
        .select()
        .single()
      if (newLoc) locoMap.set(locode, (newLoc as { id: string }).id)
    }
  }

  // 5. Insert rate lines
  const rateLines = validParsed
    .map(r => {
      const originId = locoMap.get(r.origin)
      const destId = locoMap.get(r.destination)
      if (!originId || !destId) return null
      return {
        version_id: (version as { id: string }).id,
        origin_id: originId,
        destination_id: destId,
        service_loop: r.service_loop ?? null,
        container_type: r.container_type,
        charge_component: r.charge_component,
        rate_basis: r.rate_basis,
        amount: r.amount,
        currency: r.currency !== currency ? r.currency : null,
      }
    })
    .filter(Boolean)

  if (rateLines.length > 0) {
    const { error: lineErr } = await supabase.from('ocean_rate_lines').insert(rateLines)
    if (lineErr) warnings.push(`Some rate lines failed to insert: ${lineErr.message}`)
  }

  // Audit
  await supabase.from('audit_log').insert({
    actor: user.id,
    action: 'import',
    entity_type: 'rate_contracts',
    entity_id: (contract as { id: string }).id,
    diff: { rows: rateLines.length, carrier: carrierName, file_path },
  })

  return new Response(
    JSON.stringify({
      status: 'imported',
      contract_id: (contract as { id: string }).id,
      version_id: (version as { id: string }).id,
      rows_imported: rateLines.length,
      warnings,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
