import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles, CheckCircle, XCircle, Clock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { NlChangeset, NlChangesetLine } from '@/types/database'
import { formatDate, formatAmount, formatPct } from '@/lib/utils'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'

// ── Propose (calls edge function) ────────────────────────────────────────────

interface ProposeResponse {
  changeset_id: string
  matched: number
  lines: (NlChangesetLine & { rate_label: string; currency: string })[]
  guardrail_warnings: string[]
}

async function proposeNlChange(prompt: string): Promise<ProposeResponse> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/nl-propose`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ prompt }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { message?: string }).message ?? 'Proposal failed')
  }
  return res.json() as Promise<ProposeResponse>
}

async function applyChangeset(changesetId: string, approved: boolean, reason?: string) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/nl-apply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ changeset_id: changesetId, approved, rejection_reason: reason }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { message?: string }).message ?? 'Apply failed')
  }
  return res.json()
}

// ── Status badge helpers ──────────────────────────────────────────────────────

const statusVariant: Record<string, 'yellow' | 'green' | 'red' | 'gray'> = {
  pending_review: 'yellow',
  approved: 'green',
  rejected: 'red',
  applied: 'green',
}

const statusIcon: Record<string, React.ReactNode> = {
  pending_review: <Clock className="w-3.5 h-3.5" />,
  approved:       <CheckCircle className="w-3.5 h-3.5" />,
  rejected:       <XCircle className="w-3.5 h-3.5" />,
  applied:        <CheckCircle className="w-3.5 h-3.5" />,
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function NlUpdatePage() {
  const qc = useQueryClient()
  const [prompt, setPrompt] = useState('')
  const [preview, setPreview] = useState<ProposeResponse | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const propose = useMutation({
    mutationFn: proposeNlChange,
    onSuccess: data => setPreview(data),
  })

  const apply = useMutation({
    mutationFn: ({ id, approved, reason }: { id: string; approved: boolean; reason?: string }) =>
      applyChangeset(id, approved, reason),
    onSuccess: () => {
      setPreview(null)
      setPrompt('')
      qc.invalidateQueries({ queryKey: ['active_ocean_rates'] })
      qc.invalidateQueries({ queryKey: ['nl_changesets'] })
    },
  })

  const { data: history = [] } = useQuery<NlChangeset[]>({
    queryKey: ['nl_changesets'],
    queryFn: async () => {
      const { data } = await supabase
        .from('nl_changesets')
        .select('*')
        .order('submitted_at', { ascending: false })
        .limit(20)
      return data ?? []
    },
  })

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <h2 className="text-xl font-bold text-gray-900">Natural Language Rate Update</h2>

      {/* Prompt input */}
      <Card>
        <CardBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-brand-400" />
              Describe the change
            </label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={3}
              placeholder={`e.g. "Increase all Hapag-Lloyd base rates on the ASIA–EUROPE lane by 3%"`}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
            <p className="text-xs text-gray-400">
              Tip: Be specific — carrier, lane, charge type, and change amount. Proposals are always previewed before applying.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => { setPreview(null); propose.mutate(prompt) }}
              loading={propose.isPending}
              disabled={!prompt.trim()}
            >
              Preview changes
            </Button>
            {preview && (
              <Button variant="ghost" onClick={() => setPreview(null)}>
                Cancel
              </Button>
            )}
          </div>
          {propose.isError && (
            <p className="text-sm text-red-600">{String(propose.error)}</p>
          )}
        </CardBody>
      </Card>

      {/* Preview diff */}
      {preview && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-900">
                Preview: {preview.matched} rate line{preview.matched !== 1 ? 's' : ''} affected
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">Review carefully before approving</p>
            </div>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            {preview.guardrail_warnings.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
                <p className="text-xs font-semibold text-yellow-800 mb-1">Guardrail warnings</p>
                {preview.guardrail_warnings.map((w, i) => (
                  <p key={i} className="text-xs text-yellow-700">{w}</p>
                ))}
              </div>
            )}

            {preview.matched === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">
                No rates matched your criteria. Try adjusting your description.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 bg-gray-50 border-b">
                      {['Rate','Field','Old value','New value','Change'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.lines.map(line => (
                      <tr key={line.id} className="border-b border-gray-100">
                        <td className="px-3 py-2 text-xs text-gray-700">{line.rate_label}</td>
                        <td className="px-3 py-2 text-xs font-mono text-gray-600">{line.field_name}</td>
                        <td className="px-3 py-2 tabular-nums text-gray-500">
                          {formatAmount(line.old_value, line.currency)}
                        </td>
                        <td className="px-3 py-2 tabular-nums font-medium text-gray-900">
                          {formatAmount(line.new_value, line.currency)}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-xs font-medium ${(line.pct_change ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                            {formatPct(line.pct_change)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex gap-2 pt-2 border-t border-gray-100">
              <Button
                variant="primary"
                disabled={preview.matched === 0}
                loading={apply.isPending}
                onClick={() => apply.mutate({ id: preview.changeset_id, approved: true })}
              >
                <CheckCircle className="w-4 h-4" /> Approve &amp; apply
              </Button>
              <Button
                variant="danger"
                loading={apply.isPending}
                onClick={() => apply.mutate({ id: preview.changeset_id, approved: false, reason: rejectReason })}
              >
                <XCircle className="w-4 h-4" /> Reject
              </Button>
            </div>
            <input
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Rejection reason (optional)"
              className="text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
            {apply.isError && (
              <p className="text-sm text-red-600">{String(apply.error)}</p>
            )}
          </CardBody>
        </Card>
      )}

      {/* History */}
      <Card>
        <CardHeader>
          <h3 className="font-semibold text-gray-900">Recent NL updates</h3>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 bg-gray-50 border-b">
                {['Submitted','Prompt','Status','Reviewed'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">No NL updates yet</td></tr>
              )}
              {history.map(cs => (
                <tr key={cs.id} className="border-b border-gray-100">
                  <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{formatDate(cs.submitted_at)}</td>
                  <td className="px-3 py-2.5 text-gray-800 max-w-xs truncate">{cs.raw_prompt}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant={statusVariant[cs.status]}>
                      <span className="inline-flex items-center gap-1">
                        {statusIcon[cs.status]} {cs.status.replace('_', ' ')}
                      </span>
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                    {cs.reviewed_at ? formatDate(cs.reviewed_at) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
