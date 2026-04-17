import { useState, useEffect, useRef } from 'react'
import {
  Globe,
  Plus,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  X,
  Loader2,
  ExternalLink,
  LogIn,
  LogOut,
  Lock,
  Unlock,
  ShieldCheck,
  User,
  ChevronDown,
  ChevronUp,
  Search,
  Download,
  ChefHat,
  Check,
} from 'lucide-react'
import type { RecipeSource, SourceDefinition, AuthConfig } from '../types'
import type { ExternalSearchResult, SearchSource, RecipePreview } from '../api'
import {
  getSources,
  getSourceRegistry,
  addSource,
  deleteSource,
  discoverSource,
  importRecipes,
  loginSource,
  logoutSource,
  searchExternalRecipes,
  getSearchSources,
  scrapeRecipe,
} from '../api'

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, error }: { status: RecipeSource['status']; error?: string }) {
  if (status === 'active') {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full">
        <CheckCircle2 size={11} /> Aktiv
      </span>
    )
  }
  if (status === 'syncing') {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-100 px-2.5 py-1 rounded-full">
        <Loader2 size={11} className="animate-spin" /> Synchronisiert…
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span
        className="flex items-center gap-1 text-xs font-medium text-red-600 bg-red-100 px-2.5 py-1 rounded-full"
        title={error}
      >
        <AlertTriangle size={11} /> Fehler
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
      <Clock size={11} /> Ausstehend
    </span>
  )
}

// ─── Auth badge ───────────────────────────────────────────────────────────────

function AuthBadge({ source }: { source: RecipeSource }) {
  if (!source.auth_config) return null

  if (source.is_authenticated) {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 px-2.5 py-1 rounded-full">
        <ShieldCheck size={11} />
        {source.auth_username ? `Angemeldet als ${source.auth_username}` : 'Angemeldet'}
      </span>
    )
  }
  if (source.auth_status === 'error') {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full">
        <Lock size={11} /> Sitzung abgelaufen
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-xs font-medium text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
      <Lock size={11} /> Nicht angemeldet
    </span>
  )
}

// ─── Login modal ──────────────────────────────────────────────────────────────

interface LoginModalProps {
  source: RecipeSource
  authConfig: AuthConfig
  onClose: () => void
  onSuccess: (updated: RecipeSource) => void
}

function LoginModal({ source, authConfig, onClose, onSuccess }: LoginModalProps) {
  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(authConfig.fields.map((f) => [f.key, '']))
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const updated = await loginSource(source.id, fields)
      onSuccess(updated)
      onClose()
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
            'Anmeldung fehlgeschlagen.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15,25,20,0.72)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-content bg-cream rounded-2xl shadow-2xl w-full max-w-md p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <LogIn size={15} className="text-primary" />
            </div>
            <h2
              className="text-primary text-xl font-semibold"
              style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
            >
              {authConfig.label}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-sand/60 hover:bg-sand flex items-center justify-center text-gray-500 transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        <p className="text-xs text-gray-500 mb-5 ml-10">{authConfig.description}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {authConfig.fields.map((field) => (
            <div key={field.key}>
              <label className="block text-sm font-semibold text-primary mb-1">
                {field.label}
              </label>
              <input
                type={field.type}
                required
                autoComplete={field.type === 'password' ? 'current-password' : 'email'}
                value={fields[field.key] ?? ''}
                onChange={(e) =>
                  setFields((prev) => ({ ...prev, [field.key]: e.target.value }))
                }
                placeholder={field.placeholder}
                className="w-full border border-sand-dark rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition bg-white/70"
              />
              {field.hint && (
                <p className="text-xs text-gray-400 mt-1">{field.hint}</p>
              )}
            </div>
          ))}

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg flex items-start gap-2">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <><Loader2 size={15} className="animate-spin" /> Anmelden…</>
            ) : (
              <><LogIn size={15} /> Anmelden</>
            )}
          </button>
        </form>

        {authConfig.privacyNote && (
          <div className="mt-4 flex gap-2 p-3 bg-sand/40 rounded-xl border border-sand-dark/30">
            <ShieldCheck size={13} className="text-primary/50 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-gray-500 leading-relaxed">{authConfig.privacyNote}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sync preview modal ───────────────────────────────────────────────────────

interface SyncPreviewModalProps {
  source: RecipeSource
  previews: RecipePreview[]
  totalDiscovered: number
  onClose: () => void
  onImport: (urls: string[]) => void
  importing: boolean
}

function SyncPreviewModal({
  source,
  previews,
  totalDiscovered,
  onClose,
  onImport,
  importing,
}: SyncPreviewModalProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(previews.map((p) => p.url)))

  const toggleAll = () => {
    if (selected.size === previews.length) setSelected(new Set())
    else setSelected(new Set(previews.map((p) => p.url)))
  }

  const toggle = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(url) ? next.delete(url) : next.add(url)
      return next
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15,25,20,0.72)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && !importing && onClose()}
    >
      <div className="modal-content bg-cream rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-sand-dark/30 flex-shrink-0">
          <div>
            <h2
              className="text-primary text-xl font-semibold"
              style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
            >
              Neue Rezepte gefunden
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {totalDiscovered} URLs entdeckt · {previews.length} neue Rezepte ·{' '}
              <span className="font-medium text-primary/70">{source.name}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={importing}
            className="w-8 h-8 rounded-full bg-sand/60 hover:bg-sand flex items-center justify-center text-gray-500 transition-colors disabled:opacity-40"
          >
            <X size={15} />
          </button>
        </div>

        {/* Selection toolbar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-sand-dark/20 flex-shrink-0 bg-sand/30">
          <button
            onClick={toggleAll}
            className="text-xs font-semibold text-primary/70 hover:text-primary transition-colors"
          >
            {selected.size === previews.length ? 'Alle abwählen' : 'Alle auswählen'}
          </button>
          <span className="text-xs text-gray-400">
            {selected.size} von {previews.length} ausgewählt
          </span>
        </div>

        {/* Recipe list */}
        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {previews.length === 0 ? (
            <div className="text-center py-12">
              <Search size={28} className="text-gray-200 mx-auto mb-3" />
              <p className="text-gray-400 text-sm">Keine neuen Rezepte gefunden.</p>
              <p className="text-gray-300 text-xs mt-1">Alle Rezepte dieser Quelle sind bereits importiert.</p>
            </div>
          ) : (
            previews.map((preview) => {
              const isSelected = selected.has(preview.url)
              return (
                <label
                  key={preview.url}
                  className={[
                    'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all',
                    isSelected
                      ? 'border-primary/30 bg-primary/5'
                      : 'border-sand-dark/30 bg-white/50 hover:bg-sand/40',
                  ].join(' ')}
                >
                  {/* Checkbox */}
                  <div
                    className={[
                      'w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border transition-colors',
                      isSelected ? 'bg-primary border-primary' : 'border-sand-dark bg-white',
                    ].join(' ')}
                  >
                    {isSelected && <Check size={11} className="text-white" />}
                  </div>

                  {/* Thumbnail */}
                  <div className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-sand">
                    {preview.image_url ? (
                      <img
                        src={preview.image_url}
                        alt={preview.title}
                        className="w-full h-full object-cover"
                        onError={(e) => { e.currentTarget.style.display = 'none' }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ChefHat size={20} className="text-primary/20" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-primary truncate">{preview.title}</p>
                    {preview.description && (
                      <p className="text-xs text-gray-400 line-clamp-1 mt-0.5">{preview.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1">
                      {preview.prep_time ? (
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          <Clock size={10} /> {preview.prep_time} Min.
                        </span>
                      ) : null}
                      {preview.servings ? (
                        <span className="text-xs text-gray-400">{preview.servings} Port.</span>
                      ) : null}
                    </div>
                  </div>

                  {/* External link */}
                  <a
                    href={preview.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="w-7 h-7 flex items-center justify-center text-gray-300 hover:text-accent rounded-lg hover:bg-sand transition-colors flex-shrink-0"
                  >
                    <ExternalLink size={13} />
                  </a>

                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(preview.url)}
                    className="sr-only"
                  />
                </label>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-sand-dark/30 flex items-center gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            disabled={importing}
            className="flex-1 py-2.5 text-sm font-semibold rounded-xl border border-sand-dark text-gray-500 hover:bg-sand transition-colors disabled:opacity-40"
          >
            Abbrechen
          </button>
          <button
            onClick={() => onImport([...selected])}
            disabled={importing || selected.size === 0}
            className="flex-[2] py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {importing ? (
              <><Loader2 size={15} className="animate-spin" /> Importiere {selected.size} Rezepte…</>
            ) : (
              <><Download size={15} /> {selected.size} Rezept{selected.size !== 1 ? 'e' : ''} importieren</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Source card ──────────────────────────────────────────────────────────────

interface SourceCardProps {
  source: RecipeSource
  onUpdate: (updated: RecipeSource) => void
  onDelete: (id: number) => void
}

function SourceCard({ source, onUpdate, onDelete }: SourceCardProps) {
  const [discovering, setDiscovering] = useState(false)
  const [importing, setImporting] = useState(false)
  const [previews, setPreviews] = useState<RecipePreview[] | null>(null)
  const [totalDiscovered, setTotalDiscovered] = useState(0)
  const [importResult, setImportResult] = useState<{ imported: number } | null>(null)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const handleDiscover = async () => {
    setDiscovering(true)
    setImportResult(null)
    try {
      const result = await discoverSource(source.id)
      setTotalDiscovered(result.total_discovered)
      setPreviews(result.previews)
    } catch {
      // error shown via source.status
    } finally {
      setDiscovering(false)
    }
  }

  const handleImport = async (urls: string[]) => {
    setImporting(true)
    try {
      const result = await importRecipes(source.id, urls)
      onUpdate(result.source)
      setImportResult({ imported: result.imported })
      setPreviews(null)
    } catch {
      // ignore — source status will reflect error
    } finally {
      setImporting(false)
    }
  }


  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      const updated = await logoutSource(source.id)
      onUpdate(updated)
    } finally {
      setLoggingOut(false)
    }
  }

  const formatDate = (d?: string) => {
    if (!d) return 'Noch nie'
    return new Date(d).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <>
      <div className="paper-card-white p-4">
        {/* Top row */}
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            {source.is_authenticated ? (
              <Unlock size={18} className="text-primary" />
            ) : (
              <Globe size={18} className="text-primary/60" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-sm font-bold text-primary">{source.name}</span>
              <StatusBadge status={source.status} error={source.error_message} />
              <AuthBadge source={source} />
            </div>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-accent transition-colors mb-1"
            >
              <ExternalLink size={10} /> {source.url}
            </a>
            <p className="text-xs text-gray-400">
              Zuletzt synchronisiert: {formatDate(source.last_sync)}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Login / Logout */}
            {source.auth_config && (
              source.is_authenticated ? (
                <button
                  onClick={handleLogout}
                  disabled={loggingOut}
                  title="Abmelden"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/8 text-primary/70 text-xs font-semibold rounded-lg hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-colors border border-primary/10"
                >
                  {loggingOut ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                  Abmelden
                </button>
              ) : (
                <button
                  onClick={() => setShowLoginModal(true)}
                  title="Anmelden"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 transition-colors"
                >
                  <LogIn size={12} /> Anmelden
                </button>
              )
            )}

            {/* Discover / Sync */}
            <button
              onClick={handleDiscover}
              disabled={discovering}
              title="Neue Rezepte suchen"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary text-xs font-semibold rounded-lg hover:bg-primary/20 disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={12} className={discovering ? 'animate-spin' : ''} />
              {discovering ? 'Suche…' : 'Sync'}
            </button>

            {/* Expand details */}
            <button
              onClick={() => setExpanded((v) => !v)}
              className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-primary rounded-lg hover:bg-primary/10 transition-colors"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {/* Delete */}
            <button
              onClick={() => {
                if (confirm('Rezeptquelle wirklich entfernen?')) onDelete(source.id)
              }}
              title="Entfernen"
              className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-3 pt-3 border-t border-sand-dark/30 space-y-2 text-xs text-gray-500">
            <div className="flex gap-6">
              <span><span className="font-semibold text-primary/70">Typ:</span> {source.scraper_type}</span>
              <span><span className="font-semibold text-primary/70">Auth:</span> {source.auth_type}</span>
            </div>
            {source.auth_username && (
              <div className="flex items-center gap-1.5 text-emerald-700">
                <User size={11} /> Angemeldet als <strong>{source.auth_username}</strong>
              </div>
            )}
          </div>
        )}

        {/* Error messages */}
        {source.error_message && (
          <p className="text-xs text-red-500 mt-2 bg-red-50 px-2 py-1 rounded flex items-start gap-1.5">
            <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
            {source.error_message}
          </p>
        )}
        {source.auth_error && !source.is_authenticated && (
          <p className="text-xs text-amber-600 mt-2 bg-amber-50 px-2 py-1 rounded flex items-start gap-1.5">
            <Lock size={11} className="flex-shrink-0 mt-0.5" />
            {source.auth_error}
          </p>
        )}

        {/* Import result flash */}
        {importResult && (
          <p className="text-xs text-emerald-700 mt-2 bg-emerald-50 px-2 py-1 rounded flex items-center gap-1.5">
            <Check size={11} /> {importResult.imported} Rezept{importResult.imported !== 1 ? 'e' : ''} importiert
          </p>
        )}
      </div>

      {/* Sync preview modal */}
      {previews !== null && (
        <SyncPreviewModal
          source={source}
          previews={previews}
          totalDiscovered={totalDiscovered}
          onClose={() => setPreviews(null)}
          onImport={handleImport}
          importing={importing}
        />
      )}

      {/* Login modal */}
      {showLoginModal && source.auth_config && (
        <LoginModal
          source={source}
          authConfig={source.auth_config}
          onClose={() => setShowLoginModal(false)}
          onSuccess={onUpdate}
        />
      )}
    </>
  )
}

// ─── Search result card ───────────────────────────────────────────────────────

interface SearchResultCardProps {
  result: ExternalSearchResult
}

function SearchResultCard({ result }: SearchResultCardProps) {
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState(false)
  const [error, setError] = useState('')

  const handleImport = async () => {
    setImporting(true)
    setError('')
    try {
      await scrapeRecipe(result.url, result.source_name)
      setImported(true)
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
            'Import fehlgeschlagen.'
      setError(msg)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="paper-card-white overflow-hidden flex flex-col">
      {/* Image */}
      <div className="relative h-36 flex-shrink-0 bg-sand overflow-hidden">
        {result.image_url ? (
          <img
            src={result.image_url}
            alt={result.title}
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
              const parent = e.currentTarget.parentElement
              if (parent) {
                const fallback = parent.querySelector('.img-fallback') as HTMLElement | null
                if (fallback) fallback.style.display = 'flex'
              }
            }}
          />
        ) : null}
        <div
          className="img-fallback w-full h-full items-center justify-center absolute inset-0"
          style={{
            display: result.image_url ? 'none' : 'flex',
            background: 'linear-gradient(135deg, #2D4A3E 0%, #3D6354 50%, #E8D5B7 100%)',
          }}
        >
          <ChefHat size={32} className="text-white/30" />
        </div>

        {/* Source badge */}
        <span className="absolute top-2 left-2 text-xs font-semibold bg-white/90 text-primary px-2 py-0.5 rounded-full">
          {result.source_name}
        </span>
      </div>

      {/* Content */}
      <div className="p-3 flex flex-col flex-1">
        <h3
          className="text-sm font-semibold text-primary leading-tight mb-1 line-clamp-2"
          style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
        >
          {result.title}
        </h3>
        {result.prep_time && (
          <p className="text-xs text-gray-400 mb-1 flex items-center gap-1">
            <Clock size={10} /> {result.prep_time} Min.
          </p>
        )}
        {result.description && (
          <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 flex-1 mb-2">
            {result.description}
          </p>
        )}

        {error && (
          <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1 mb-2 flex items-start gap-1">
            <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /> {error}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 mt-auto">
          <button
            onClick={handleImport}
            disabled={importing || imported}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex-1 justify-center',
              imported
                ? 'bg-emerald-100 text-emerald-700 cursor-default'
                : 'bg-primary text-white hover:bg-primary/90 disabled:opacity-60',
            ].join(' ')}
          >
            {importing ? (
              <><Loader2 size={11} className="animate-spin" /> Importiere…</>
            ) : imported ? (
              <><Check size={11} /> Importiert</>
            ) : (
              <><Download size={11} /> Importieren</>
            )}
          </button>
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Originalrezept öffnen"
            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-accent rounded-lg hover:bg-sand transition-colors flex-shrink-0"
          >
            <ExternalLink size={13} />
          </a>
        </div>
      </div>
    </div>
  )
}

// ─── Meta-search section ──────────────────────────────────────────────────────

function MetaSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ExternalSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const [availableSources, setAvailableSources] = useState<SearchSource[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getSearchSources()
      .then(setAvailableSources)
      .catch(() => {
        // fallback: assume only Chefkoch available
        setAvailableSources([{ id: 'chefkoch', name: 'Chefkoch', available: true }])
      })
  }, [])

  const activeSources = availableSources.filter((s) => s.available)

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setError('')
    setResults([])
    setSearched(true)
    try {
      const data = await searchExternalRecipes(
        query.trim(),
        activeSources.map((s) => s.id),
        12
      )
      setResults(data)
    } catch {
      setError('Suche fehlgeschlagen. Bitte später erneut versuchen.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="mb-10">
      <h2
        className="text-primary text-lg font-semibold mb-1"
        style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
      >
        Rezepte suchen
      </h2>
      <p className="text-xs text-gray-400 mb-4">
        Durchsuche Chefkoch und REWE direkt – importiere einzelne Rezepte mit einem Klick.
      </p>

      {/* Search form */}
      <form onSubmit={handleSearch} className="paper-card-white p-4 mb-4">
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="z.B. Pasta Carbonara, vegane Lasagne, Schnitzel…"
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-sand-dark rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition bg-white/80"
            />
          </div>
          <button
            type="submit"
            disabled={!query.trim() || loading}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-colors flex-shrink-0"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            {loading ? 'Suche…' : 'Suchen'}
          </button>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-400 flex-wrap">
          <span className="font-medium text-primary/60">Quellen:</span>
          {activeSources.length > 0 ? (
            activeSources.map((s) => (
              <span key={s.id} className="bg-sand px-2 py-0.5 rounded-full text-primary/70 font-medium">
                {s.name}
              </span>
            ))
          ) : (
            <span className="text-gray-300 italic">lädt…</span>
          )}
        </div>
      </form>

      {/* Results */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 mb-4">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-primary/40" />
        </div>
      )}

      {!loading && searched && results.length === 0 && !error && (
        <div className="text-center py-10">
          <Search size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Keine Ergebnisse gefunden.</p>
          <p className="text-gray-300 text-xs mt-1">Versuche andere Suchbegriffe oder wähle andere Quellen.</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {results.map((result, i) => (
            <SearchResultCard key={`${result.url}-${i}`} result={result} />
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Sources() {
  const [sources, setSources] = useState<RecipeSource[]>([])
  const [registry, setRegistry] = useState<SourceDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formError, setFormError] = useState('')
  const [adding, setAdding] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [s, r] = await Promise.all([getSources(), getSourceRegistry()])
      setSources(s)
      setRegistry(r)
    } catch {
      setSources([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const handleSourceUpdate = (updated: RecipeSource) => {
    setSources((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
  }

  const handleDelete = async (id: number) => {
    await deleteSource(id)
    setSources((prev) => prev.filter((s) => s.id !== id))
  }

  const handleAddPreset = async (def: SourceDefinition) => {
    const already = sources.some(
      (s) => s.url === def.defaultUrl || s.name === def.name
    )
    if (already || !def.defaultUrl) return
    setAdding(true)
    try {
      const created = await addSource(def.name, def.defaultUrl)
      setSources((prev) => [...prev, created])
    } finally {
      setAdding(false)
    }
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formUrl.trim() || !formName.trim()) return
    setAdding(true)
    setFormError('')
    try {
      const created = await addSource(formName.trim(), formUrl.trim())
      setSources((prev) => [...prev, created])
      setFormName('')
      setFormUrl('')
      setShowForm(false)
    } catch {
      setFormError('Quelle konnte nicht hinzugefügt werden. Bitte prüfen Sie die URL.')
    } finally {
      setAdding(false)
    }
  }

  // Registry entries that have a real default URL (exclude generic)
  const presets = registry.filter((d) => d.defaultUrl)

  return (
    <div className="animate-fade-in max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1
            className="text-primary text-4xl font-bold mb-2"
            style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
          >
            Rezeptquellen
          </h1>
          <p className="text-gray-500">
            Verwalten Sie Ihre Rezeptquellen und synchronisieren Sie neue Rezepte
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent text-white text-sm font-semibold rounded-xl hover:bg-accent-dark transition-colors shadow-sm flex-shrink-0"
        >
          <Plus size={15} /> Quelle hinzufügen
        </button>
      </div>

      {/* Disclaimer */}
      <div className="flex gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl mb-8">
        <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-800 mb-1">Hinweis zum Web-Scraping</p>
          <p className="text-xs text-amber-700 leading-relaxed">
            Das Scraping von Webseiten unterliegt den Nutzungsbedingungen der jeweiligen Plattform.
            Bitte beachten Sie die{' '}
            <code className="bg-amber-100 px-1 rounded">robots.txt</code> und AGB der Quellseiten.
            Die Nutzung der gesammelten Rezepte ist auf den privaten Gebrauch beschränkt.
          </p>
        </div>
      </div>

      {/* Meta-search */}
      <MetaSearch />

      {/* Preset registry */}
      <section className="mb-8">
        <h2
          className="text-primary text-lg font-semibold mb-4"
          style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
        >
          Bekannte Quellen
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {presets.map((def) => {
            const alreadyAdded = sources.some(
              (s) => s.url === def.defaultUrl || s.name === def.name
            )
            const addedSource = sources.find(
              (s) => s.url === def.defaultUrl || s.name === def.name
            )
            return (
              <div
                key={def.scraper_type}
                className={`paper-card p-4 flex flex-col gap-3 transition-opacity ${alreadyAdded ? 'opacity-75' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl leading-none">{def.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-primary">{def.name}</p>
                      {def.supportsAuth && (
                        <span
                          title="Unterstützt Account-Login"
                          className="flex items-center gap-0.5 text-xs text-primary/50"
                        >
                          {addedSource?.is_authenticated ? (
                            <ShieldCheck size={12} className="text-emerald-600" />
                          ) : (
                            <Lock size={12} />
                          )}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{def.description}</p>
                    <a
                      href={def.defaultUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-dark mt-1 transition-colors"
                    >
                      <ExternalLink size={10} />
                      {def.defaultUrl.replace('https://', '')}
                    </a>
                    {def.supportsAuth && (
                      <p className="text-xs text-primary/50 mt-1 flex items-center gap-1">
                        <LogIn size={10} /> Account-Login verfügbar
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleAddPreset(def)}
                  disabled={alreadyAdded || adding}
                  className="w-full py-1.5 text-xs font-semibold rounded-lg border transition-all disabled:cursor-not-allowed border-primary/30 text-primary hover:bg-primary hover:text-white disabled:opacity-50"
                >
                  {alreadyAdded ? 'Bereits hinzugefügt' : '+ Hinzufügen'}
                </button>
              </div>
            )
          })}
        </div>
      </section>

      {/* My sources */}
      <section>
        <h2
          className="text-primary text-lg font-semibold mb-4"
          style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
        >
          Meine Quellen
        </h2>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-primary/40" />
          </div>
        ) : sources.length === 0 ? (
          <div className="text-center py-16">
            <Globe size={36} className="text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">Noch keine Quellen hinzugefügt</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sources.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                onUpdate={handleSourceUpdate}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </section>

      {/* Add custom source modal */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(15,25,20,0.72)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => e.target === e.currentTarget && setShowForm(false)}
        >
          <div className="modal-content bg-cream rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2
                className="text-primary text-xl font-semibold"
                style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
              >
                Quelle hinzufügen
              </h2>
              <button
                onClick={() => { setShowForm(false); setFormError('') }}
                className="w-8 h-8 rounded-full bg-sand/60 hover:bg-sand flex items-center justify-center text-gray-500 transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-primary mb-1">
                  Name der Quelle
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="z.B. Mein Lieblingsblog"
                  className="w-full border border-sand-dark rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition bg-white/70"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-primary mb-1">URL</label>
                <input
                  type="url"
                  required
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="https://…"
                  className="w-full border border-sand-dark rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition bg-white/70"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Für Chefkoch- und REWE-URLs wird automatisch der passende Scraper gewählt.
                </p>
              </div>

              {formError && (
                <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg flex items-start gap-2">
                  <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                  {formError}
                </p>
              )}

              <button
                type="submit"
                disabled={adding}
                className="w-full py-2.5 bg-accent text-white text-sm font-semibold rounded-xl hover:bg-accent-dark disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
              >
                {adding && <Loader2 size={15} className="animate-spin" />}
                {adding ? 'Wird hinzugefügt…' : 'Quelle hinzufügen'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
