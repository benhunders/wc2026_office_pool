import { useState, useRef } from 'react'
import { Upload, FileText, CheckCircle, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import Button from '@/components/ui/Button'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'

type ImportState = 'idle' | 'uploading' | 'parsing' | 'preview' | 'importing' | 'done' | 'error'

interface ParsedPreview {
  upload_path: string
  carrier_name: string
  row_count: number
  date_range: string
  warnings: string[]
  sample_rows: Record<string, string>[]
}

export default function ImportPage() {
  const [state, setState] = useState<ImportState>('idle')
  const [dragOver, setDragOver] = useState(false)
  const [preview, setPreview] = useState<ParsedPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [contractRef, setContractRef] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setState('uploading')
    setError(null)

    try {
      // Upload raw file to Supabase Storage
      const path = `imports/${Date.now()}_${file.name}`
      const { error: uploadErr } = await supabase.storage
        .from('rate-sheets')
        .upload(path, file)
      if (uploadErr) throw uploadErr

      // Call parse edge function
      setState('parsing')
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rate-import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ file_path: path, mode: 'preview' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { message?: string }).message ?? 'Parse failed')
      }
      const data = await res.json() as ParsedPreview
      setPreview({ ...data, upload_path: path })
      setState('preview')
    } catch (e) {
      setError(String(e))
      setState('error')
    }
  }

  async function confirmImport() {
    if (!preview) return
    setState('importing')
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rate-import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          file_path: preview.upload_path,
          mode: 'import',
          contract_ref: contractRef,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { message?: string }).message ?? 'Import failed')
      }
      setState('done')
    } catch (e) {
      setError(String(e))
      setState('error')
    }
  }

  function reset() {
    setState('idle')
    setPreview(null)
    setError(null)
    setContractRef('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const isLoading = ['uploading', 'parsing', 'importing'].includes(state)

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <h2 className="text-xl font-bold text-gray-900">Import Rates</h2>
      <p className="text-sm text-gray-600">
        Upload a carrier rate sheet (CSV or Excel). The file is stored as the original source record — nothing is changed until you confirm.
      </p>

      {/* Drop zone */}
      {state === 'idle' && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault()
            setDragOver(false)
            const file = e.dataTransfer.files[0]
            if (file) handleFile(file)
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors',
            dragOver ? 'border-brand-400 bg-brand-50' : 'border-gray-300 hover:border-brand-300 hover:bg-gray-50'
          )}
        >
          <Upload className="w-8 h-8 mx-auto text-gray-400 mb-3" />
          <p className="text-sm font-medium text-gray-700">Drop a rate sheet here or click to browse</p>
          <p className="text-xs text-gray-400 mt-1">CSV, XLS, XLSX — max 10 MB</p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xls,.xlsx"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
        </div>
      )}

      {/* Loading states */}
      {isLoading && (
        <Card>
          <CardBody className="flex items-center gap-3 py-8 justify-center">
            <svg className="w-5 h-5 animate-spin text-brand-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span className="text-sm text-gray-600">
              {state === 'uploading' && 'Uploading file…'}
              {state === 'parsing' && 'Parsing rate sheet…'}
              {state === 'importing' && 'Importing rates…'}
            </span>
          </CardBody>
        </Card>
      )}

      {/* Preview */}
      {state === 'preview' && preview && (
        <Card>
          <CardHeader className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-brand-500" />
            <h3 className="font-semibold text-gray-900">Import preview</h3>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-500">Carrier detected</p>
                <p className="font-medium">{preview.carrier_name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Rate lines</p>
                <p className="font-medium">{preview.row_count}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Date range</p>
                <p className="font-medium">{preview.date_range}</p>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-700">Contract reference (optional)</label>
              <input
                value={contractRef}
                onChange={e => setContractRef(e.target.value)}
                placeholder="e.g. Q2-2026-HAP-001"
                className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>

            {preview.warnings.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
                <p className="text-xs font-semibold text-yellow-800 mb-1 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> Warnings
                </p>
                {preview.warnings.map((w, i) => <p key={i} className="text-xs text-yellow-700">{w}</p>)}
              </div>
            )}

            {/* Sample rows */}
            {preview.sample_rows.length > 0 && (
              <div className="overflow-x-auto">
                <p className="text-xs font-medium text-gray-600 mb-1">Sample rows</p>
                <table className="w-full text-xs border border-gray-200 rounded">
                  <thead>
                    <tr className="bg-gray-50">
                      {Object.keys(preview.sample_rows[0]).map(k => (
                        <th key={k} className="px-2 py-1.5 text-left font-medium text-gray-600 border-b border-gray-200">{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample_rows.map((row, i) => (
                      <tr key={i} className="border-b border-gray-100">
                        {Object.values(row).map((v, j) => (
                          <td key={j} className="px-2 py-1.5 text-gray-700">{v}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex gap-2 pt-2 border-t border-gray-100">
              <Button onClick={confirmImport} loading={isLoading}>
                Confirm import
              </Button>
              <Button variant="secondary" onClick={reset}>
                Cancel
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Done */}
      {state === 'done' && (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-10">
            <CheckCircle className="w-10 h-10 text-green-500" />
            <p className="font-semibold text-gray-900">Import complete</p>
            <p className="text-sm text-gray-500">Rates are now available in the Rates tab.</p>
            <Button variant="secondary" onClick={reset}>Import another file</Button>
          </CardBody>
        </Card>
      )}

      {/* Error */}
      {state === 'error' && (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-10">
            <AlertCircle className="w-8 h-8 text-red-500" />
            <p className="font-semibold text-gray-900">Import failed</p>
            <p className="text-sm text-red-600">{error}</p>
            <Button variant="secondary" onClick={reset}>Try again</Button>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
