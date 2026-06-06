// nl-apply: Approve or reject a pending NL changeset.
// On approve: creates new rate_versions (immutable) and supersedes old ones.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

interface ApplyRequest {
  changeset_id: string
  approved: boolean
  rejection_reason?: string
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

  const { changeset_id, approved, rejection_reason }: ApplyRequest = await req.json()

  // Load changeset
  const { data: cs, error: csErr } = await supabase
    .from('nl_changesets')
    .select('*')
    .eq('id', changeset_id)
    .single()

  if (csErr || !cs) {
    return new Response(JSON.stringify({ message: 'Changeset not found' }), { status: 404, headers: corsHeaders })
  }
  if (cs.status !== 'pending_review') {
    return new Response(JSON.stringify({ message: `Changeset is already ${cs.status}` }), { status: 409, headers: corsHeaders })
  }

  const now = new Date().toISOString()

  if (!approved) {
    await supabase.from('nl_changesets').update({
      status: 'rejected',
      reviewed_by: user.id,
      reviewed_at: now,
      rejection_reason: rejection_reason ?? null,
    }).eq('id', changeset_id)

    await supabase.from('audit_log').insert({
      actor: user.id,
      action: 'nl_reject',
      entity_type: 'nl_changesets',
      entity_id: changeset_id,
      diff: { rejection_reason },
    })

    return new Response(JSON.stringify({ status: 'rejected' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  // Load changeset lines
  const { data: lines } = await supabase
    .from('nl_changeset_lines')
    .select('*')
    .eq('changeset_id', changeset_id)

  if (!lines?.length) {
    // Mark approved but nothing to apply
    await supabase.from('nl_changesets').update({ status: 'applied', reviewed_by: user.id, reviewed_at: now }).eq('id', changeset_id)
    return new Response(JSON.stringify({ status: 'applied', updated_versions: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Group lines by version_id (each version gets one new version row)
  interface ChangeLine {
    id: string
    changeset_id: string
    rate_table: string
    rate_line_id: string
    field_name: string
    old_value: number | null
    new_value: number | null
    pct_change: number | null
  }

  // For ocean_rate_lines: look up which version each line belongs to
  const rateLineIds = (lines as ChangeLine[])
    .filter(l => l.rate_table === 'ocean_rate_lines')
    .map(l => l.rate_line_id)

  const { data: rateLinesData } = await supabase
    .from('ocean_rate_lines')
    .select('id, version_id')
    .in('id', rateLineIds)

  const lineToVersion = new Map((rateLinesData ?? []).map((r: { id: string; version_id: string }) => [r.id, r.version_id]))

  // Load version details to copy when creating new versions
  const versionIds = [...new Set([...lineToVersion.values()])]
  const { data: versionsData } = await supabase
    .from('rate_versions')
    .select('*')
    .in('id', versionIds)

  const versionsMap = new Map((versionsData ?? []).map((v: { id: string }) => [v.id, v]))

  // For each affected version: create a new version, copy all rate lines, apply changes
  const oldToNew = new Map<string, string>()
  let updatedVersions = 0

  for (const oldVersionId of versionIds) {
    const oldVersion = versionsMap.get(oldVersionId)
    if (!oldVersion) continue

    // Get next version_seq
    const { data: latestSeq } = await supabase
      .from('rate_versions')
      .select('version_seq')
      .eq('contract_id', oldVersion.contract_id)
      .order('version_seq', { ascending: false })
      .limit(1)
      .single()

    const nextSeq = ((latestSeq as { version_seq: number } | null)?.version_seq ?? 0) + 1

    // Create new version row
    const { data: newVersion, error: nvErr } = await supabase
      .from('rate_versions')
      .insert({
        contract_id: oldVersion.contract_id,
        version_seq: nextSeq,
        valid_from: oldVersion.valid_from,
        valid_to: oldVersion.valid_to,
        change_source: 'nl_update',
        nl_changeset_id: changeset_id,
        changed_by: user.id,
        change_note: cs.raw_prompt,
      })
      .select()
      .single()

    if (nvErr || !newVersion) continue

    oldToNew.set(oldVersionId, (newVersion as { id: string }).id)

    // Copy all rate lines from old version, applying changes where applicable
    const { data: oldLines } = await supabase
      .from('ocean_rate_lines')
      .select('*')
      .eq('version_id', oldVersionId)

    const changedLineIds = new Map(
      (lines as ChangeLine[])
        .filter(l => l.rate_table === 'ocean_rate_lines' && lineToVersion.get(l.rate_line_id) === oldVersionId)
        .map(l => [l.rate_line_id, l])
    )

    const newLines = (oldLines ?? []).map((ol: { id: string; version_id: string; [key: string]: unknown }) => {
      const change = changedLineIds.get(ol.id)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, version_id: _vid, ...rest } = ol
      if (change) {
        return { ...rest, version_id: (newVersion as { id: string }).id, [change.field_name]: change.new_value }
      }
      return { ...rest, version_id: (newVersion as { id: string }).id }
    })

    if (newLines.length > 0) {
      await supabase.from('ocean_rate_lines').insert(newLines)
    }

    // Supersede the old version
    await supabase.from('rate_versions').update({ superseded_at: now }).eq('id', oldVersionId)

    updatedVersions++
  }

  // Mark changeset as applied
  await supabase.from('nl_changesets').update({
    status: 'applied',
    reviewed_by: user.id,
    reviewed_at: now,
  }).eq('id', changeset_id)

  // Audit
  await supabase.from('audit_log').insert({
    actor: user.id,
    action: 'nl_approve',
    entity_type: 'nl_changesets',
    entity_id: changeset_id,
    diff: {
      updated_versions: updatedVersions,
      old_to_new: Object.fromEntries(oldToNew),
    },
  })

  return new Response(
    JSON.stringify({ status: 'applied', updated_versions: updatedVersions }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
