import { useState, useEffect, useCallback, useRef } from 'react'
import { Sparkles, ChevronRight, Download, ExternalLink, Loader2, Check, AlertTriangle, ChefHat, Clock, History } from 'lucide-react'
import type { Recipe } from '../types'
import type { ExternalSearchResult } from '../api'
import { getRecipes, getSuggestions, searchExternalRecipes, scrapeRecipe } from '../api'
import RecipeCard from '../components/recipes/RecipeCard'
import RecipeModal from '../components/recipes/RecipeModal'
import RecipeFilter, { type FilterState } from '../components/recipes/RecipeFilter'

// ─── External result card (inline, compact) ───────────────────────────────────

function ExternalCard({ result, onImported }: { result: ExternalSearchResult; onImported: () => void }) {
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState(false)
  const [error, setError] = useState('')

  const handleImport = async () => {
    setImporting(true)
    setError('')
    try {
      await scrapeRecipe(result.url, result.source_name)
      setImported(true)
      onImported()
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
              const fallback = e.currentTarget.parentElement?.querySelector('.img-fallback') as HTMLElement | null
              if (fallback) fallback.style.display = 'flex'
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
            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-accent rounded-lg hover:bg-sand transition-colors flex-shrink-0"
          >
            <ExternalLink size={13} />
          </a>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Discover() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [suggestions, setSuggestions] = useState<Recipe[]>([])
  const [recentRecipes, setRecentRecipes] = useState<Recipe[]>([])
  const [externalResults, setExternalResults] = useState<ExternalSearchResult[]>([])
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null)
  const [loading, setLoading] = useState(true)
  const [suggestionsLoading, setSuggestionsLoading] = useState(true)
  const [recentLoading, setRecentLoading] = useState(true)
  const [externalLoading, setExternalLoading] = useState(false)
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    tags: [],
    source: '',
  })

  // Debounce ref for external search
  const externalSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sources = Array.from(
    new Set(recipes.filter((r) => r.source_name).map((r) => r.source_name!))
  )

  // Local DB search
  const fetchRecipes = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, unknown> = {}
      if (filters.search) params.search = filters.search
      if (filters.tags.length) params.tags = filters.tags.join(',')
      if (filters.source) params.source = filters.source
      const data = await getRecipes(params)
      setRecipes(data)
    } catch (err) {
      console.error('Failed to fetch recipes', err)
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    fetchRecipes()
  }, [fetchRecipes])

  // External search — debounced, only when there's a search term
  useEffect(() => {
    if (externalSearchTimer.current) clearTimeout(externalSearchTimer.current)

    if (!filters.search.trim()) {
      setExternalResults([])
      setExternalLoading(false)
      return
    }

    setExternalLoading(true)
    externalSearchTimer.current = setTimeout(async () => {
      try {
        const results = await searchExternalRecipes(filters.search.trim(), undefined, 30)
        setExternalResults(results)
      } catch {
        setExternalResults([])
      } finally {
        setExternalLoading(false)
      }
    }, 600) // wait 600ms after last keystroke

    return () => {
      if (externalSearchTimer.current) clearTimeout(externalSearchTimer.current)
    }
  }, [filters.search])

  useEffect(() => {
    setSuggestionsLoading(true)
    getSuggestions()
      .then(setSuggestions)
      .catch(() => setSuggestions([]))
      .finally(() => setSuggestionsLoading(false))
  }, [])

  // Fetch 8 most recently added recipes (for the "Zuletzt hinzugefügt" strip)
  const fetchRecent = useCallback(async () => {
    setRecentLoading(true)
    try {
      const data = await getRecipes({ limit: 8 })
      setRecentRecipes(data)
    } catch {
      setRecentRecipes([])
    } finally {
      setRecentLoading(false)
    }
  }, [])

  useEffect(() => { fetchRecent() }, [fetchRecent])

  const isSearchActive = !!(filters.search || filters.tags.length || filters.source)

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <h1
          className="text-primary text-4xl font-bold mb-2"
          style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
        >
          Entdecken
        </h1>
        <p className="text-gray-500 text-base">
          Frische Inspiration für Ihre nächste Mahlzeit – kuratiert nach Ihrem Geschmack.
        </p>
      </div>

      {/* Filters */}
      <div className="mb-8 paper-card-white p-4">
        <RecipeFilter value={filters} onChange={setFilters} sources={sources} />
      </div>

      {/* Suggestions strip — hide when searching */}
      {!isSearchActive && (suggestions.length > 0 || suggestionsLoading) && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles size={18} className="text-accent" />
            <h2
              className="text-primary text-xl font-semibold"
              style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
            >
              Empfehlungen für Sie
            </h2>
            <ChevronRight size={16} className="text-gray-400 ml-auto" />
          </div>

          {suggestionsLoading ? (
            <div className="flex gap-4 overflow-x-auto scroll-strip pb-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex-shrink-0 w-52 h-64 paper-card animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="flex gap-4 overflow-x-auto scroll-strip pb-2 -mx-1 px-1">
              {suggestions.map((recipe) => (
                <div key={recipe.id} className="flex-shrink-0 w-52">
                  <RecipeCard recipe={recipe} onSelect={setSelectedRecipe} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Zuletzt hinzugefügt strip — hidden when searching ── */}
      {!isSearchActive && (recentRecipes.length > 0 || recentLoading) && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <History size={18} className="text-primary/60" />
            <h2
              className="text-primary text-xl font-semibold"
              style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
            >
              Zuletzt hinzugefügt
            </h2>
            <ChevronRight size={16} className="text-gray-400 ml-auto" />
          </div>

          {recentLoading ? (
            <div className="flex gap-4 overflow-x-auto scroll-strip pb-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex-shrink-0 w-52 h-64 paper-card animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="flex gap-4 overflow-x-auto scroll-strip pb-2 -mx-1 px-1">
              {recentRecipes.map((recipe) => (
                <div key={recipe.id} className="flex-shrink-0 w-52">
                  <RecipeCard recipe={recipe} onSelect={setSelectedRecipe} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Local results ── */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2
            className="text-primary text-xl font-semibold"
            style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
          >
            {isSearchActive ? 'In meiner Sammlung' : 'Alle Rezepte'}
          </h2>
          {!loading && (
            <span className="text-sm text-gray-400">{recipes.length} Rezepte</span>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="paper-card h-72 animate-pulse" />
            ))}
          </div>
        ) : recipes.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-gray-400 text-base mb-1">Keine Rezepte in Ihrer Sammlung</p>
            <p className="text-gray-300 text-sm">
              {isSearchActive
                ? 'Schauen Sie unten bei den Web-Ergebnissen oder passen Sie die Filter an.'
                : 'Fügen Sie Rezeptquellen hinzu und synchronisieren Sie sie.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {recipes.map((recipe) => (
              <RecipeCard key={recipe.id} recipe={recipe} onSelect={setSelectedRecipe} />
            ))}
          </div>
        )}
      </section>

      {/* ── External / web results — only when search is active ── */}
      {filters.search.trim() && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2
              className="text-primary text-xl font-semibold"
              style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
            >
              Im Web gefunden
            </h2>
            {externalLoading && (
              <span className="flex items-center gap-1.5 text-sm text-gray-400">
                <Loader2 size={14} className="animate-spin" /> Suche läuft…
              </span>
            )}
            {!externalLoading && externalResults.length > 0 && (
              <span className="text-sm text-gray-400">{externalResults.length} Treffer</span>
            )}
          </div>

          {externalLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="paper-card h-64 animate-pulse" />
              ))}
            </div>
          ) : externalResults.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-gray-300 text-sm">Keine Web-Ergebnisse gefunden.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {externalResults.map((result, i) => (
                <ExternalCard
                  key={`${result.url}-${i}`}
                  result={result}
                  onImported={fetchRecipes}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Recipe modal */}
      {selectedRecipe && (
        <RecipeModal
          recipe={selectedRecipe}
          onClose={() => setSelectedRecipe(null)}
          onSaved={() => setSelectedRecipe(null)}
        />
      )}
    </div>
  )
}
