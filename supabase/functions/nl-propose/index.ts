// nl-propose: Parse an NL rate-update prompt → dry-run changeset (no DB writes)
import { createClient } from 'jsr:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

interface ProposeRequest {
  prompt: string
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Verify user session
  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 })

  const { prompt }: ProposeRequest = await req.json()
  if (!prompt?.trim()) {
    return new Response(JSON.stringify({ message: 'prompt is required' }), { status: 400 })
  }

  // Load guardrail settings
  const { data: maxPctSetting } = await supabase
    .from('runtime_settings')
    .select('value')
    .eq('key', 'nl_max_pct_change')
    .single()
  const maxPctChange = Number(maxPctSetting?.value ?? 25)

  // Load active rates for context (we'll pass a summary to the LLM)
  const { data: activeRates } = await supabase
    .from('active_ocean_rates')
    .select('rate_line_id,carrier_name,carrier_scac,origin_locode,origin_name,destination_locode,destination_name,container_type,charge_component,amount,currency')
    .limit(500)

  const carriers = [...new Set((activeRates ?? []).map((r: { carrier_name: string }) => r.carrier_name))]
  const context = `
Active carriers: ${carriers.join(', ')}
Total rate lines: ${(activeRates ?? []).length}
Charge components available: BASE, BAF, CAF, EBS, LSS, THC_ORIGIN, THC_DEST, BL_FEE, DOC_FEE, PSS, GRI, PCS, ISPS, AMS, ENS, OTHER
Container types: 20DV, 40DV, 40HC, 45HC, RF20, RF40, 20OT, 40OT
`

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })

  const systemPrompt = `You are a freight rate assistant. A user will describe a rate change in natural language.
Your job is to extract a structured filter + operation from their description.
Return ONLY valid JSON matching this schema (no markdown):
{
  "carrier_filter": "string or null - partial carrier name match",
  "origin_filter": "string or null - partial origin port/locode match",
  "destination_filter": "string or null - partial destination port/locode match",
  "container_types": ["array of container type codes, or null for all"],
  "charge_components": ["array of charge component codes, or null for all"],
  "operation": "pct_increase | pct_decrease | set_amount",
  "value": number,
  "field": "amount | min_charge",
  "confidence": "high | medium | low",
  "ambiguity_note": "string or null - note if the instruction was unclear"
}
Context about current data:
${context}`

  const completion = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  })

  let parsedIntent: Record<string, unknown>
  try {
    const text = completion.content[0].type === 'text' ? completion.content[0].text : ''
    parsedIntent = JSON.parse(text)
  } catch {
    return new Response(
      JSON.stringify({ message: 'Failed to parse LLM response as JSON' }),
      { status: 422, headers: corsHeaders }
    )
  }

  // Filter active rates based on parsed intent
  let filtered = [...(activeRates ?? [])]
  if (parsedIntent.carrier_filter) {
    const cf = String(parsedIntent.carrier_filter).toLowerCase()
    filtered = filtered.filter((r: { carrier_name: string; carrier_scac: string | null }) =>
      r.carrier_name.toLowerCase().includes(cf) ||
      (r.carrier_scac ?? '').toLowerCase().includes(cf)
    )
  }
  if (parsedIntent.origin_filter) {
    const of_ = String(parsedIntent.origin_filter).toLowerCase()
    filtered = filtered.filter((r: { origin_locode: string | null; origin_name: string }) =>
      (r.origin_locode ?? '').toLowerCase().includes(of_) ||
      r.origin_name.toLowerCase().includes(of_)
    )
  }
  if (parsedIntent.destination_filter) {
    const df = String(parsedIntent.destination_filter).toLowerCase()
    filtered = filtered.filter((r: { destination_locode: string | null; destination_name: string }) =>
      (r.destination_locode ?? '').toLowerCase().includes(df) ||
      r.destination_name.toLowerCase().includes(df)
    )
  }
  if (Array.isArray(parsedIntent.container_types) && parsedIntent.container_types.length > 0) {
    filtered = filtered.filter((r: { container_type: string }) =>
      (parsedIntent.container_types as string[]).includes(r.container_type)
    )
  }
  if (Array.isArray(parsedIntent.charge_components) && parsedIntent.charge_components.length > 0) {
    filtered = filtered.filter((r: { charge_component: string }) =>
      (parsedIntent.charge_components as string[]).includes(r.charge_component)
    )
  }

  // Compute new values
  const field = String(parsedIntent.field ?? 'amount') as 'amount' | 'min_charge'
  const op = String(parsedIntent.operation)
  const value = Number(parsedIntent.value)

  const guardrailWarnings: string[] = []
  if (parsedIntent.ambiguity_note) {
    guardrailWarnings.push(`Ambiguity: ${parsedIntent.ambiguity_note}`)
  }
  if (parsedIntent.confidence === 'low') {
    guardrailWarnings.push('Low confidence interpretation — please review carefully')
  }

  interface ActiveRate {
    rate_line_id: string
    carrier_name: string
    carrier_scac: string | null
    origin_locode: string | null
    origin_name: string
    destination_locode: string | null
    destination_name: string
    container_type: string
    charge_component: string
    amount: number
    currency: string
    [key: string]: unknown
  }

  const lines = filtered.map((r: ActiveRate) => {
    const oldValue = r[field] as number | null
    if (oldValue == null) return null

    let newValue: number
    let pctChange: number

    if (op === 'pct_increase') {
      newValue = oldValue * (1 + value / 100)
      pctChange = value
    } else if (op === 'pct_decrease') {
      newValue = oldValue * (1 - value / 100)
      pctChange = -value
    } else {
      newValue = value
      pctChange = oldValue !== 0 ? ((value - oldValue) / oldValue) * 100 : 0
    }

    // Round to 2 dp
    newValue = Math.round(newValue * 100) / 100

    if (Math.abs(pctChange) > maxPctChange) {
      guardrailWarnings.push(
        `Rate line ${r.rate_line_id}: change of ${pctChange.toFixed(1)}% exceeds max allowed ${maxPctChange}%`
      )
    }

    return {
      id: crypto.randomUUID(),
      rate_table: 'ocean_rate_lines',
      rate_line_id: r.rate_line_id,
      field_name: field,
      old_value: oldValue,
      new_value: newValue,
      pct_change: Math.round(pctChange * 100) / 100,
      rate_label: `${r.carrier_name} | ${r.origin_locode ?? r.origin_name} → ${r.destination_locode ?? r.destination_name} | ${r.container_type} | ${r.charge_component}`,
      currency: r.currency,
    }
  }).filter(Boolean)

  // Persist the changeset (pending_review, no rate writes yet)
  const { data: changeset, error: csErr } = await supabase
    .from('nl_changesets')
    .insert({
      submitted_by: user.id,
      raw_prompt: prompt,
      parsed_intent: parsedIntent,
      affected_mode: 'ocean',
      status: 'pending_review',
    })
    .select()
    .single()

  if (csErr || !changeset) {
    return new Response(JSON.stringify({ message: 'Failed to save changeset' }), { status: 500, headers: corsHeaders })
  }

  // Persist changeset lines
  if (lines.length > 0) {
    await supabase.from('nl_changeset_lines').insert(
      lines.map(l => ({
        changeset_id: changeset.id,
        rate_table: l!.rate_table,
        rate_line_id: l!.rate_line_id,
        field_name: l!.field_name,
        old_value: l!.old_value,
        new_value: l!.new_value,
        pct_change: l!.pct_change,
      }))
    )
  }

  // Write audit entry
  await supabase.from('audit_log').insert({
    actor: user.id,
    action: 'nl_submit',
    entity_type: 'nl_changesets',
    entity_id: changeset.id,
    diff: { prompt, matched: lines.length },
  })

  return new Response(
    JSON.stringify({
      changeset_id: changeset.id,
      matched: lines.length,
      lines,
      guardrail_warnings: guardrailWarnings,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
