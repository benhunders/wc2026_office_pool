import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Search, FilterX } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { ActiveOceanRate } from '@/types/database'
import { formatAmount, formatDate } from '@/lib/utils'
import Input from '@/components/ui/Input'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

const CHARGE_COLORS: Record<string, 'default' | 'blue' | 'yellow' | 'green' | 'gray'> = {
  BASE: 'blue',
  BAF: 'yellow',
  CAF: 'yellow',
  THC_ORIGIN: 'green',
  THC_DEST: 'green',
}

function useActiveRates(asOf: string | null) {
  return useQuery<ActiveOceanRate[]>({
    queryKey: ['active_ocean_rates', asOf],
    queryFn: async () => {
      if (asOf) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.rpc as any)('ocean_rates_at', { query_date: asOf })
        if (error) throw error
        return (data ?? []) as ActiveOceanRate[]
      }
      const { data, error } = await supabase.from('active_ocean_rates').select('*')
      if (error) throw error
      return (data ?? []) as ActiveOceanRate[]
    },
  })
}

export default function RatesPage() {
  const [search, setSearch] = useState('')
  const [asOf, setAsOf] = useState('')
  const [carrier, setCarrier] = useState('')
  const [component, setComponent] = useState('')

  const { data: rates = [], isLoading, error } = useActiveRates(asOf || null)

  const filtered = rates.filter(r => {
    const q = search.toLowerCase()
    const matchSearch = !q || [
      r.carrier_name, r.carrier_scac ?? '',
      r.origin_locode ?? '', r.origin_name,
      r.destination_locode ?? '', r.destination_name,
      r.service_loop ?? '',
    ].some(v => v.toLowerCase().includes(q))
    const matchCarrier = !carrier || r.carrier_name.toLowerCase().includes(carrier.toLowerCase())
    const matchComponent = !component || r.charge_component === component
    return matchSearch && matchCarrier && matchComponent
  })

  const hasFilters = !!(search || asOf || carrier || component)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Ocean Rates</h2>
        <span className="text-sm text-gray-500">{filtered.length} rate lines</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search carrier, port, lane…"
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <Input
          label="As of date"
          type="date"
          value={asOf}
          onChange={e => setAsOf(e.target.value)}
          className="w-40"
        />
        <Input
          label="Carrier"
          value={carrier}
          onChange={e => setCarrier(e.target.value)}
          placeholder="Filter carrier…"
          className="w-44"
        />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-700">Charge type</label>
          <select
            value={component}
            onChange={e => setComponent(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="">All</option>
            {['BASE','BAF','CAF','EBS','LSS','THC_ORIGIN','THC_DEST','BL_FEE','DOC_FEE','PSS','GRI','OTHER'].map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setAsOf(''); setCarrier(''); setComponent('') }}>
            <FilterX className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
                {['Carrier','Origin','Destination','Loop','Container','Charge','Basis','Amount','Valid From','Valid To',''].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-gray-400">Loading…</td></tr>
              )}
              {error && (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-red-500">Error: {String(error)}</td></tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-gray-400">No rates found</td></tr>
              )}
              {filtered.map(r => (
                <tr key={r.rate_line_id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-2.5 font-medium text-gray-900">
                    {r.carrier_scac ? `${r.carrier_name} (${r.carrier_scac})` : r.carrier_name}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {r.origin_locode && <span className="font-mono text-xs mr-1 text-gray-500">{r.origin_locode}</span>}
                    {r.origin_name}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {r.destination_locode && <span className="font-mono text-xs mr-1 text-gray-500">{r.destination_locode}</span>}
                    {r.destination_name}
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">{r.service_loop ?? '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{r.container_type}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant={CHARGE_COLORS[r.charge_component] ?? 'default'}>
                      {r.charge_component}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-gray-600 text-xs">{r.rate_basis}</td>
                  <td className="px-3 py-2.5 font-medium tabular-nums">
                    {formatAmount(r.amount, r.currency)}
                  </td>
                  <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{formatDate(r.valid_from)}</td>
                  <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{r.valid_to ? formatDate(r.valid_to) : 'Open'}</td>
                  <td className="px-3 py-2.5">
                    <Link
                      to={`/rates/${r.version_id}`}
                      className="text-xs text-brand-500 hover:underline whitespace-nowrap"
                    >
                      History →
                    </Link>
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
