import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { RateVersion, OceanRateLine, RateContract, Carrier } from '@/types/database'
import { formatDate, formatAmount } from '@/lib/utils'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'

interface VersionWithDetails extends RateVersion {
  contract: RateContract & { carrier: Carrier }
  lines: OceanRateLine[]
}

export default function RateDetailPage() {
  const { versionId } = useParams<{ versionId: string }>()

  const { data: version, isLoading } = useQuery<VersionWithDetails | null>({
    queryKey: ['rate_version_detail', versionId],
    queryFn: async () => {
      if (!versionId) return null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any
      const { data: rv, error: rvErr } = await db
        .from('rate_versions')
        .select('*')
        .eq('id', versionId)
        .single() as { data: RateVersion | null; error: unknown }
      if (rvErr || !rv) return null

      const { data: rc } = await db
        .from('rate_contracts')
        .select('*')
        .eq('id', rv.contract_id)
        .single() as { data: RateContract | null }
      if (!rc) return null

      const { data: carrier } = await db
        .from('carriers')
        .select('*')
        .eq('id', rc.carrier_id)
        .single() as { data: Carrier | null }

      const { data: lines } = await db
        .from('ocean_rate_lines')
        .select('*')
        .eq('version_id', versionId) as { data: OceanRateLine[] | null }

      return {
        ...rv,
        contract: { ...rc, carrier: carrier! },
        lines: lines ?? [],
      } as VersionWithDetails
    },
    enabled: !!versionId,
  })

  // Load all versions for the same contract to show history
  const { data: allVersions = [] } = useQuery<RateVersion[]>({
    queryKey: ['rate_versions_history', version?.contract_id],
    queryFn: async () => {
      if (!version?.contract_id) return []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('rate_versions')
        .select('*')
        .eq('contract_id', version.contract_id)
        .order('version_seq', { ascending: false }) as { data: RateVersion[] | null }
      return data ?? []
    },
    enabled: !!version?.contract_id,
  })

  if (isLoading) return <div className="py-12 text-center text-gray-400">Loading…</div>
  if (!version) return <div className="py-12 text-center text-red-500">Version not found.</div>

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link to="/rates" className="text-brand-500 hover:underline flex items-center gap-1 text-sm">
          <ArrowLeft className="w-4 h-4" /> Rates
        </Link>
        <span className="text-gray-400">/</span>
        <span className="text-sm font-medium text-gray-700">
          {version.contract.carrier.name} — Version {version.version_seq}
        </span>
      </div>

      {/* Contract summary */}
      <Card>
        <CardHeader>
          <h3 className="font-semibold text-gray-900">Contract details</h3>
        </CardHeader>
        <CardBody className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-500">Carrier</p>
            <p className="font-medium">{version.contract.carrier.name}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">SCAC</p>
            <p className="font-medium">{version.contract.carrier.scac ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Contract ref</p>
            <p className="font-medium">{version.contract.contract_ref ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Currency</p>
            <p className="font-medium">{version.contract.currency}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Valid from</p>
            <p className="font-medium">{formatDate(version.valid_from)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Valid to</p>
            <p className="font-medium">{version.valid_to ? formatDate(version.valid_to) : 'Open'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Change source</p>
            <Badge variant={version.change_source === 'nl_update' ? 'blue' : 'gray'}>
              {version.change_source}
            </Badge>
          </div>
          <div>
            <p className="text-xs text-gray-500">Recorded</p>
            <p className="font-medium">{formatDate(version.recorded_at)}</p>
          </div>
        </CardBody>
      </Card>

      {/* Rate lines */}
      <Card className="overflow-hidden">
        <CardHeader>
          <h3 className="font-semibold text-gray-900">Rate lines ({version.lines.length})</h3>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
                {['Container','Charge','Basis','Amount','Min Charge','Currency'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {version.lines.map(l => (
                <tr key={l.id} className="border-b border-gray-100">
                  <td className="px-3 py-2.5 font-mono text-xs">{l.container_type}</td>
                  <td className="px-3 py-2.5">
                    <Badge>{l.charge_component}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">{l.rate_basis}</td>
                  <td className="px-3 py-2.5 font-medium tabular-nums">
                    {formatAmount(l.amount, l.currency ?? version.contract.currency)}
                  </td>
                  <td className="px-3 py-2.5 text-gray-600 tabular-nums">
                    {l.min_charge ? formatAmount(l.min_charge, l.currency ?? version.contract.currency) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">{l.currency ?? '(contract)'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Version history */}
      <Card>
        <CardHeader>
          <h3 className="font-semibold text-gray-900">Version history</h3>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
                {['Version','Valid From','Valid To','Recorded','Source','Status',''].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allVersions.map(v => (
                <tr key={v.id} className={`border-b border-gray-100 ${v.id === versionId ? 'bg-brand-50' : ''}`}>
                  <td className="px-3 py-2.5 font-medium">v{v.version_seq}</td>
                  <td className="px-3 py-2.5">{formatDate(v.valid_from)}</td>
                  <td className="px-3 py-2.5">{v.valid_to ? formatDate(v.valid_to) : 'Open'}</td>
                  <td className="px-3 py-2.5 text-gray-600">{formatDate(v.recorded_at)}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant={v.change_source === 'nl_update' ? 'blue' : 'gray'}>
                      {v.change_source}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    {v.superseded_at
                      ? <Badge variant="gray">Superseded</Badge>
                      : <Badge variant="green">Active</Badge>}
                  </td>
                  <td className="px-3 py-2.5">
                    {v.id !== versionId && (
                      <Link to={`/rates/${v.id}`} className="text-xs text-brand-500 hover:underline">
                        View
                      </Link>
                    )}
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
