import { useState, useEffect, useCallback } from 'react'
import {
  X,
  Clock,
  Users,
  ExternalLink,
  Star,
  ChefHat,
  Plus,
} from 'lucide-react'
import type { Recipe, Ingredient } from '../../types'
import { rateRecipe, createRecipe, getProfile, toggleOwned } from '../../api'

interface RecipeModalProps {
  recipe: Recipe
  onClose: () => void
  onSaved?: () => void
}

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
  const parts: string[] = []
  if (ing.amount) parts.push(String(ing.amount))
  if (ing.unit) parts.push(ing.unit)
  parts.push(ing.item)
  return parts.join(' ')
}

export default function RecipeModal({ recipe, onClose, onSaved }: RecipeModalProps) {
  const [checkedIngredients, setCheckedIngredients] = useState<Set<string>>(new Set())
  const [rating, setRating] = useState<number>(recipe.rating ?? 0)
  const [hoverRating, setHoverRating] = useState<number>(0)
  const [notes, setNotes] = useState<string>(recipe.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [addingToBook, setAddingToBook] = useState(false)
  const [saved, setSaved] = useState(false)

  // Load owned ingredients from profile on mount
  useEffect(() => {
    getProfile().then((profile) => {
      const owned = new Set(profile.owned_ingredients.map((s) => s.toLowerCase()))
      const initialChecked = new Set<string>()
      for (const ing of recipe.ingredients) {
        if (owned.has(ing.item.toLowerCase())) {
          initialChecked.add(ing.item.toLowerCase())
        }
      }
      setCheckedIngredients(initialChecked)
    }).catch(() => { /* ignore */ })
  }, [recipe.ingredients])

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const toggleIngredient = useCallback(async (itemName: string) => {
    const key = itemName.toLowerCase()
    setCheckedIngredients((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    try {
      await toggleOwned(itemName)
    } catch {
      // revert on error
      setCheckedIngredients((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    }
  }, [])

  const handleSaveRating = async () => {
    if (!rating) return
    setSaving(true)
    try {
      await rateRecipe(recipe.id, rating, notes)
    } finally {
      setSaving(false)
    }
  }

  const handleAddToBook = async () => {
    setAddingToBook(true)
    try {
      const { id: _id, created_at: _ca, ...recipeData } = recipe
      await createRecipe({ ...recipeData, is_custom: true })
      setSaved(true)
      onSaved?.()
    } finally {
      setAddingToBook(false)
    }
  }

  const totalTime = (recipe.prep_time ?? 0) + (recipe.cook_time ?? 0)

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15, 25, 20, 0.7)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="modal-content bg-cream rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero image */}
        <div className="relative h-64 flex-shrink-0 overflow-hidden rounded-t-2xl">
          {recipe.image_url ? (
            <>
              <img
                src={recipe.image_url}
                alt={recipe.title}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                  e.currentTarget.nextElementSibling?.classList.remove('hidden')
                }}
              />
              <div
                className="hidden w-full h-full flex items-center justify-center absolute inset-0"
                style={{ background: 'linear-gradient(135deg, #2D4A3E 0%, #3D6354 50%, #E8D5B7 100%)' }}
              >
                <ChefHat size={64} className="text-white/40" />
              </div>
            </>
          ) : (
            <div
              className="w-full h-full flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #2D4A3E 0%, #3D6354 50%, #E8D5B7 100%)',
              }}
            >
              <ChefHat size={64} className="text-white/40" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

          {/* Title overlay */}
          <div className="absolute bottom-0 left-0 right-0 p-6">
            <h2
              className="text-white text-2xl md:text-3xl font-bold leading-tight mb-2"
              style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
            >
              {recipe.title}
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {recipe.dietary_tags.map((tag) => (
                <span
                  key={tag}
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TAG_COLORS[tag] ?? 'bg-white/20 text-white'}`}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-9 h-9 bg-black/40 hover:bg-black/60 rounded-full flex items-center justify-center text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6">
            {/* Meta bar */}
            <div className="flex flex-wrap items-center gap-4 mb-6 pb-5 border-b border-sand">
              {totalTime > 0 && (
                <div className="flex items-center gap-1.5 text-sm text-gray-600">
                  <Clock size={15} className="text-primary/60" />
                  <span><strong className="text-primary">{totalTime}</strong> Minuten</span>
                </div>
              )}
              {recipe.prep_time && (
                <div className="text-sm text-gray-500">
                  Vorbereitung: {recipe.prep_time} Min.
                </div>
              )}
              {recipe.cook_time && (
                <div className="text-sm text-gray-500">
                  Kochen: {recipe.cook_time} Min.
                </div>
              )}
              {recipe.servings && (
                <div className="flex items-center gap-1.5 text-sm text-gray-600">
                  <Users size={15} className="text-primary/60" />
                  <span><strong className="text-primary">{recipe.servings}</strong> Portionen</span>
                </div>
              )}
              {recipe.source_url && (
                <a
                  href={recipe.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-accent hover:text-accent-dark transition-colors ml-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink size={13} />
                  {recipe.source_name ?? 'Originalrezept'}
                </a>
              )}
            </div>

            {/* Description */}
            {recipe.description && (
              <p className="text-gray-600 text-sm leading-relaxed mb-6 italic">
                {recipe.description}
              </p>
            )}

            {/* Two-column: ingredients + instructions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
              {/* Ingredients */}
              <div>
                <h3
                  className="text-primary text-lg font-semibold mb-4"
                  style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
                >
                  Zutaten
                </h3>
                {recipe.ingredients.length === 0 ? (
                  <p className="text-gray-400 text-sm italic">Keine Zutaten angegeben.</p>
                ) : (
                  <ul className="space-y-2">
                    {recipe.ingredients.map((ing, i) => {
                      const isChecked = checkedIngredients.has(ing.item.toLowerCase())
                      return (
                      <li key={i}>
                        <label
                          className={`flex items-start gap-2.5 cursor-pointer group ${isChecked ? 'ingredient-done' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleIngredient(ing.item)}
                            className="mt-0.5 flex-shrink-0 accent-primary cursor-pointer"
                          />
                          <span className={`text-sm ingredient-text transition-all duration-300 ${isChecked ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                            {formatIngredient(ing)}
                          </span>
                        </label>
                      </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              {/* Instructions */}
              <div>
                <h3
                  className="text-primary text-lg font-semibold mb-4"
                  style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
                >
                  Zubereitung
                </h3>
                {recipe.instructions.length === 0 ? (
                  <p className="text-gray-400 text-sm italic">Keine Anleitung angegeben.</p>
                ) : (
                  <ol className="space-y-4">
                    {recipe.instructions.map((step, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 bg-primary text-white text-xs font-bold rounded-full flex items-center justify-center mt-0.5">
                          {i + 1}
                        </span>
                        <p className="text-sm text-gray-700 leading-relaxed">{step}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>

            {/* Rating & Notes */}
            <div className="paper-card p-5">
              <h3
                className="text-primary text-base font-semibold mb-3"
                style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
              >
                Ihre Bewertung
              </h3>
              <div className="flex items-center gap-1 mb-4">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    className="star-btn p-0.5"
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    onClick={() => setRating(star)}
                  >
                    <Star
                      size={24}
                      className={
                        star <= (hoverRating || rating)
                          ? 'text-amber-400 fill-amber-400'
                          : 'text-gray-300'
                      }
                    />
                  </button>
                ))}
                {rating > 0 && (
                  <span className="ml-2 text-sm text-gray-500">{rating}/5</span>
                )}
              </div>

              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Persönliche Notizen (Änderungen, Tipps, …)"
                rows={3}
                className="w-full text-sm border border-sand-dark rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/30 focus:border-primary/50 bg-white/60 resize-none transition"
              />

              <div className="flex gap-3 mt-3">
                <button
                  onClick={handleSaveRating}
                  disabled={saving || !rating}
                  className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? 'Speichern…' : 'Bewertung speichern'}
                </button>

                {!recipe.is_custom && (
                  <button
                    onClick={handleAddToBook}
                    disabled={addingToBook || saved}
                    className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm font-semibold rounded-lg hover:bg-accent-dark disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  >
                    <Plus size={14} />
                    {saved ? 'Gespeichert!' : addingToBook ? 'Wird gespeichert…' : 'In Mein Rezeptbuch'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
