import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Carrier, Location, LocationType } from '@/types/database'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Badge from '@/components/ui/Badge'

// ── Carriers ─────────────────────────────────────────────────────────────────

function CarriersPanel() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', scac: '' })
  const [editId, setEditId] = useState<string | null>(null)

  const { data: carriers = [], isLoading } = useQuery<Carrier[]>({
    queryKey: ['carriers'],
    queryFn: async () => {
      const { data } = await supabase.from('carriers').select('*').order('name')
      return data ?? []
    },
  })

  const save = useMutation({
    mutationFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any
      if (editId) {
        await db.from('carriers').update({ name: form.name, scac: form.scac || null }).eq('id', editId)
      } else {
        await db.from('carriers').insert({ name: form.name, scac: form.scac || null, modes: ['ocean'] })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['carriers'] })
      setShowForm(false)
      setForm({ name: '', scac: '' })
      setEditId(null)
    },
  })

  function startEdit(c: Carrier) {
    setForm({ name: c.name, scac: c.scac ?? '' })
    setEditId(c.id)
    setShowForm(true)
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Carriers</h3>
        <Button size="sm" variant="secondary" onClick={() => { setShowForm(s => !s); setEditId(null); setForm({ name: '', scac: '' }) }}>
          <Plus className="w-3.5 h-3.5" /> Add
        </Button>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {showForm && (
          <form
            onSubmit={e => { e.preventDefault(); save.mutate() }}
            className="flex gap-2 items-end p-3 bg-gray-50 rounded border border-gray-200"
          >
            <Input label="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className="w-44" />
            <Input label="SCAC" value={form.scac} onChange={e => setForm(f => ({ ...f, scac: e.target.value }))} placeholder="4-letter code" className="w-28" />
            <Button type="submit" size="sm" loading={save.isPending}>{editId ? 'Save' : 'Add'}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setShowForm(false); setEditId(null) }}>Cancel</Button>
          </form>
        )}
        {isLoading ? (
          <div className="py-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-200">
                <th className="py-1.5 text-left font-medium">Name</th>
                <th className="py-1.5 text-left font-medium">SCAC</th>
                <th className="py-1.5 text-left font-medium">Modes</th>
                <th className="py-1.5 text-left font-medium">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {carriers.map(c => (
                <tr key={c.id} className="border-b border-gray-100">
                  <td className="py-2 font-medium pr-4">{c.name}</td>
                  <td className="py-2 font-mono text-xs text-gray-600 pr-4">{c.scac ?? '—'}</td>
                  <td className="py-2 pr-4">
                    <div className="flex gap-1 flex-wrap">
                      {c.modes.map(m => <Badge key={m} variant="blue">{m}</Badge>)}
                    </div>
                  </td>
                  <td className="py-2 pr-4">
                    <Badge variant={c.active ? 'green' : 'gray'}>{c.active ? 'Active' : 'Inactive'}</Badge>
                  </td>
                  <td className="py-2">
                    <button onClick={() => startEdit(c)} className="text-brand-500 hover:text-brand-600">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {carriers.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-gray-400">No carriers yet</td></tr>
              )}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  )
}

// ── Locations ─────────────────────────────────────────────────────────────────

function LocationsPanel() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ locode: '', name: '', type: 'port' as LocationType, country: '' })

  const { data: locations = [], isLoading } = useQuery<Location[]>({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('*').order('name')
      return data ?? []
    },
  })

  const add = useMutation({
    mutationFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('locations').insert({
        locode: form.locode || null,
        name: form.name,
        type: form.type,
        country: form.country || null,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations'] })
      setShowForm(false)
      setForm({ locode: '', name: '', type: 'port', country: '' })
    },
  })

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Locations / Ports</h3>
        <Button size="sm" variant="secondary" onClick={() => setShowForm(s => !s)}>
          <Plus className="w-3.5 h-3.5" /> Add
        </Button>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {showForm && (
          <form
            onSubmit={e => { e.preventDefault(); add.mutate() }}
            className="flex flex-wrap gap-2 items-end p-3 bg-gray-50 rounded border border-gray-200"
          >
            <Input label="UN/LOCODE" value={form.locode} onChange={e => setForm(f => ({ ...f, locode: e.target.value }))} placeholder="e.g. NLRTM" className="w-28" />
            <Input label="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className="w-44" />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-700">Type</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as LocationType }))}
                className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400">
                {['port','airport','city','zip_zone','customs_zone'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <Input label="Country" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} placeholder="NL" className="w-20" />
            <Button type="submit" size="sm" loading={add.isPending}>Add</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          </form>
        )}
        {isLoading ? (
          <div className="py-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-200">
                {['LOCODE','Name','Type','Country'].map(h => <th key={h} className="py-1.5 text-left font-medium pr-4">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {locations.map(l => (
                <tr key={l.id} className="border-b border-gray-100">
                  <td className="py-2 font-mono text-xs text-gray-600 pr-4">{l.locode ?? '—'}</td>
                  <td className="py-2 font-medium pr-4">{l.name}</td>
                  <td className="py-2 pr-4"><Badge>{l.type}</Badge></td>
                  <td className="py-2 text-gray-600">{l.country ?? '—'}</td>
                </tr>
              ))}
              {locations.length === 0 && (
                <tr><td colSpan={4} className="py-6 text-center text-gray-400">No locations yet</td></tr>
              )}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function MasterDataPage() {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-bold text-gray-900">Master Data</h2>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <CarriersPanel />
        <LocationsPanel />
      </div>
    </div>
  )
}
