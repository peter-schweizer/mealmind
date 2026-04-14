import { useState, useEffect, useCallback } from 'react'
import { Sparkles, ChevronRight } from 'lucide-react'
import type { Recipe } from '../types'
import { getRecipes, getSuggestions } from '../api'
import RecipeCard from '../components/recipes/RecipeCard'
import RecipeModal from '../components/recipes/RecipeModal'
import RecipeFilter, { type FilterState } from '../components/recipes/RecipeFilter'

export default function Discover() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [suggestions, setSuggestions] = useState<Recipe[]>([])
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null)
  const [loading, setLoading] = useState(true)
  const [suggestionsLoading, setSuggestionsLoading] = useState(true)
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    tags: [],
    source: '',
  })

  const sources = Array.from(
    new Set(recipes.filter((r) => r.source_name).map((r) => r.source_name!))
  )

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

  useEffect(() => {
    setSuggestionsLoading(true)
    getSuggestions()
      .then(setSuggestions)
      .catch(() => setSuggestions([]))
      .finally(() => setSuggestionsLoading(false))
  }, [])

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

      {/* Suggestions strip */}
      {(suggestions.length > 0 || suggestionsLoading) && (
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
                <div
                  key={i}
                  className="flex-shrink-0 w-52 h-64 paper-card animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="flex gap-4 overflow-x-auto scroll-strip pb-2 -mx-1 px-1">
              {suggestions.map((recipe) => (
                <div key={recipe.id} className="flex-shrink-0 w-52">
                  <RecipeCard
                    recipe={recipe}
                    onSelect={setSelectedRecipe}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Main recipe grid */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2
            className="text-primary text-xl font-semibold"
            style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
          >
            {filters.search || filters.tags.length || filters.source
              ? 'Suchergebnisse'
              : 'Alle Rezepte'}
          </h2>
          {!loading && (
            <span className="text-sm text-gray-400">{recipes.length} Rezepte</span>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[...Array(9)].map((_, i) => (
              <div key={i} className="paper-card h-72 animate-pulse" />
            ))}
          </div>
        ) : recipes.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 text-lg mb-2">Keine Rezepte gefunden</p>
            <p className="text-gray-300 text-sm">
              Versuchen Sie andere Filter oder fügen Sie Rezeptquellen hinzu.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {recipes.map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                onSelect={setSelectedRecipe}
              />
            ))}
          </div>
        )}
      </section>

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
