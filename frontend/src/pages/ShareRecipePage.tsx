import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ChefHat, Clock, Users, ExternalLink, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react'
import { getSharedRecipe } from '../api'
import type { Recipe, Ingredient } from '../types'

const TAG_COLORS: Record<string, string> = {
  Vegan: 'bg-emerald-100 text-emerald-700',
  Vegetarisch: 'bg-green-100 text-green-700',
  Pescetarisch: 'bg-cyan-100 text-cyan-700',
  'Low Carb': 'bg-blue-100 text-blue-700',
  Keto: 'bg-indigo-100 text-indigo-700',
  'Diabetiker-geeignet': 'bg-violet-100 text-violet-700',
  Glutenfrei: 'bg-amber-100 text-amber-700',
  Laktosefrei: 'bg-yellow-100 text-yellow-700',
  Hochprotein: 'bg-orange-100 text-orange-700',
}

function formatIngredient(ing: Ingredient): string {
  return [ing.amount, ing.unit, ing.item].filter(Boolean).join(' ')
}

export default function ShareRecipePage() {
  const { token } = useParams<{ token: string }>()
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [checked, setChecked] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!token) return
    getSharedRecipe(token)
      .then(setRecipe)
      .catch(() => setError('Dieses Rezept wurde nicht gefunden oder der Link ist abgelaufen.'))
      .finally(() => setLoading(false))
  }, [token])

  const toggleCheck = (i: number) => {
    setChecked((prev) => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary/40" />
      </div>
    )
  }

  if (error || !recipe) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <AlertTriangle size={40} className="text-amber-400 mx-auto mb-4" />
          <p className="text-primary font-semibold mb-2">Link ungültig</p>
          <p className="text-gray-500 text-sm mb-6">{error}</p>
          <Link to="/discover" className="text-accent hover:text-accent-dark text-sm font-semibold transition-colors">
            → MealMind öffnen
          </Link>
        </div>
      </div>
    )
  }

  const totalTime = (recipe.prep_time ?? 0) + (recipe.cook_time ?? 0)

  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <header className="border-b border-sand-dark/30 bg-white/70 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <ChefHat size={16} className="text-white" />
            </div>
            <span className="text-primary font-bold text-lg" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
              MealMind
            </span>
          </div>
          <Link to="/discover"
            className="text-xs font-semibold text-primary/60 hover:text-primary transition-colors border border-primary/20 px-3 py-1.5 rounded-lg hover:bg-primary/5">
            App öffnen →
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8">
        {/* Hero image */}
        {recipe.image_url ? (
          <div className="rounded-2xl overflow-hidden mb-6 aspect-video">
            <img src={recipe.image_url} alt={recipe.title} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="rounded-2xl bg-primary/5 mb-6 h-48 flex items-center justify-center">
            <ChefHat size={48} className="text-primary/20" />
          </div>
        )}

        {/* Title & meta */}
        <h1 className="text-primary text-3xl font-bold mb-3" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
          {recipe.title}
        </h1>

        <div className="flex items-center gap-4 mb-4 flex-wrap">
          {totalTime > 0 && (
            <span className="flex items-center gap-1.5 text-sm text-gray-500">
              <Clock size={15} className="text-primary/40" /> {totalTime} Min.
            </span>
          )}
          {(recipe.servings ?? 0) > 0 && (
            <span className="flex items-center gap-1.5 text-sm text-gray-500">
              <Users size={15} className="text-primary/40" /> {recipe.servings} Portionen
            </span>
          )}
          {recipe.source_name && (
            <span className="text-sm text-gray-400">Quelle: {recipe.source_name}</span>
          )}
          {recipe.source_url && (
            <a href={recipe.source_url} target="_blank" rel="noopener noreferrer"
              className="ml-auto flex items-center gap-1 text-xs text-accent hover:text-accent-dark transition-colors font-semibold">
              Originalrezept <ExternalLink size={11} />
            </a>
          )}
        </div>

        {/* Dietary tags */}
        {recipe.dietary_tags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-5">
            {recipe.dietary_tags.map((tag) => (
              <span key={tag} className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${TAG_COLORS[tag] ?? 'bg-gray-100 text-gray-600'}`}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {recipe.description && (
          <p className="text-gray-600 text-sm leading-relaxed mb-8">{recipe.description}</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
          {/* Ingredients */}
          {recipe.ingredients?.length > 0 && (
            <section>
              <h2 className="text-primary text-lg font-semibold mb-3" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
                Zutaten
              </h2>
              <ul className="space-y-1.5">
                {recipe.ingredients.map((ing, i) => (
                  <li key={i}>
                    <button
                      onClick={() => toggleCheck(i)}
                      className="flex items-center gap-2.5 text-sm text-left w-full group"
                    >
                      <span className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${
                        checked.has(i) ? 'bg-primary border-primary' : 'border-sand-dark group-hover:border-primary/40'
                      }`}>
                        {checked.has(i) && <CheckCircle2 size={12} className="text-white" />}
                      </span>
                      <span className={checked.has(i) ? 'line-through text-gray-300' : 'text-gray-700'}>
                        {formatIngredient(ing)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Instructions */}
          {recipe.instructions?.length > 0 && (
            <section>
              <h2 className="text-primary text-lg font-semibold mb-3" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
                Zubereitung
              </h2>
              <ol className="space-y-3">
                {recipe.instructions.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <p className="text-sm text-gray-700 leading-relaxed">{step}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <p className="text-center text-xs text-gray-300 mt-12">
          Geteilt mit <span className="font-semibold">MealMind</span> · smarter essen, besser leben
        </p>
      </main>
    </div>
  )
}
