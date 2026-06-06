import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { AuditEntry } from '@/types/database'
import { formatDate } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Input from '@/components/ui/Input'

const actionVariant: Record<string, 'blue' | 'green' | 'yellow' | 'red' | 'default'> = {
  import:       'blue',
  nl_submit:    'yellow',
  nl_approve:   'green',
  nl_reject:    'red',
  export:       'default',
  manual_edit:  'yellow',
}

export default function AuditLogPage() {
  const [action, setAction] = useState('')
  const [entity, setEntity] = useState('')

  const { data: entries = [], isLoading } = useQuery<AuditEntry[]>({
    queryKey: ['audit_log', action, entity],
    queryFn: async () => {
      let q = supabase
        .from('audit_log')
        .select('*')
        .order('occurred_at', { ascending: false })
        .limit(100)
      if (action) q = q.eq('action', action)
      if (entity) q = q.ilike('entity_type', `%${entity}%`)
      const { data } = await q
      return data ?? []
    },
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Audit Log</h2>
        <span className="text-sm text-gray-500">Last 100 entries</span>
      </div>

      <div className="flex gap-3 items-end flex-wrap">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-700">Action</label>
          <select
            value={action}
            onChange={e => setAction(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="">All actions</option>
            {['import','nl_submit','nl_approve','nl_reject','export','manual_edit'].map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <Input
          label="Entity type"
          value={entity}
          onChange={e => setEntity(e.target.value)}
          placeholder="e.g. ocean_rate_lines"
          className="w-48"
        />
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
                {['Time','Action','Entity','Entity ID','Diff'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">Loading…</td></tr>
              )}
              {!isLoading && entries.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">No entries</td></tr>
              )}
              {entries.map(e => (
                <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50 align-top">
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{formatDate(e.occurred_at)}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant={actionVariant[e.action] ?? 'default'}>{e.action}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">{e.entity_type ?? '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-gray-400 max-w-[120px] truncate">
                    {e.entity_id ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 max-w-xs">
                    {e.diff ? (
                      <details>
                        <summary className="text-xs text-brand-500 cursor-pointer">View diff</summary>
                        <pre className="text-xs text-gray-600 mt-1 whitespace-pre-wrap bg-gray-50 rounded p-2 max-h-32 overflow-auto">
                          {JSON.stringify(e.diff, null, 2)}
                        </pre>
                      </details>
                    ) : '—'}
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
