import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, CheckCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { ExportLog } from '@/types/database'
import { formatDate } from '@/lib/utils'
import Button from '@/components/ui/Button'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import Input from '@/components/ui/Input'

export default function ExportPage() {
  const [validFrom, setValidFrom] = useState('')
  const [validTo, setValidTo] = useState('')
  const [carrierFilter, setCarrierFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const { data: logs = [] } = useQuery<ExportLog[]>({
    queryKey: ['export_log'],
    queryFn: async () => {
      const { data } = await supabase
        .from('export_log')
        .select('*')
        .order('exported_at', { ascending: false })
        .limit(25)
      return data ?? []
    },
  })

  async function handleExport() {
    setLoading(true)
    setError(null)
    setDone(false)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sap-tm-export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          mode: 'ocean',
          format: 'sap_tm_ocean_v1',
          filters: {
            valid_from: validFrom || undefined,
            valid_to: validTo || undefined,
            carrier_name: carrierFilter || undefined,
          },
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { message?: string }).message ?? 'Export failed')
      }

      // Stream the file download
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `sap_tm_ocean_export_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setDone(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-bold text-gray-900">Export to SAP TM</h2>

      <Card className="max-w-xl">
        <CardHeader>
          <h3 className="font-semibold text-gray-900">Generate export file</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Exports all currently active ocean rates. Optionally filter by validity window or carrier.
          </p>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Valid from (on or after)"
              type="date"
              value={validFrom}
              onChange={e => setValidFrom(e.target.value)}
            />
            <Input
              label="Valid to (on or before)"
              type="date"
              value={validTo}
              onChange={e => setValidTo(e.target.value)}
            />
          </div>
          <Input
            label="Carrier filter"
            value={carrierFilter}
            onChange={e => setCarrierFilter(e.target.value)}
            placeholder="e.g. Hapag-Lloyd"
          />

          <div className="bg-gray-50 rounded p-3 text-xs text-gray-600 border border-gray-200">
            <p className="font-medium mb-1">Format: SAP TM Ocean v1</p>
            <p>CSV, UTF-8, dates as YYYYMMDD. Mapping config from <code>runtime_settings</code>. A snapshot of the config is saved to the export log for compliance.</p>
          </div>

          <Button onClick={handleExport} loading={loading} className="w-fit">
            <Download className="w-4 h-4" /> Export CSV
          </Button>

          {done && (
            <p className="text-sm text-green-700 flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4" /> Export downloaded and logged.
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </CardBody>
      </Card>

      {/* Export history */}
      <Card>
        <CardHeader>
          <h3 className="font-semibold text-gray-900">Export history</h3>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 bg-gray-50 border-b">
                {['Date','Mode','Format','Rows','File'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">No exports yet</td></tr>
              )}
              {logs.map(l => (
                <tr key={l.id} className="border-b border-gray-100">
                  <td className="px-3 py-2.5 whitespace-nowrap">{formatDate(l.exported_at)}</td>
                  <td className="px-3 py-2.5">{l.mode}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{l.format}</td>
                  <td className="px-3 py-2.5 tabular-nums">{l.row_count ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    {l.file_path ? (
                      <span className="text-xs font-mono text-gray-500 truncate max-w-xs block">{l.file_path.split('/').pop()}</span>
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
