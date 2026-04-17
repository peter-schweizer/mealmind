import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ChefHat, Clock, Users, AlertTriangle, Loader2, ExternalLink } from 'lucide-react'
import { getSharedPlan } from '../api'
import type { WeekPlan, MealSlot, Recipe } from '../types'
import { DAYS, MEAL_LABELS, MEAL_TYPES } from '../types'

const MEAL_TYPE_ORDER = ['breakfast', 'lunch', 'dinner', 'snack']

function RecipeCard({ recipe }: { recipe: Recipe }) {
  return (
    <div className="bg-white rounded-xl overflow-hidden shadow-sm border border-sand-dark/20 flex flex-col h-full">
      {recipe.image_url ? (
        <img src={recipe.image_url} alt={recipe.title} className="w-full h-28 object-cover" />
      ) : (
        <div className="w-full h-28 flex items-center justify-center bg-primary/5">
          <ChefHat size={28} className="text-primary/20" />
        </div>
      )}
      <div className="p-2 flex-1 flex flex-col gap-1">
        <p className="text-xs font-semibold text-primary leading-tight line-clamp-2">{recipe.title}</p>
        <div className="flex items-center gap-2 mt-auto flex-wrap">
          {recipe.prep_time ? (
            <span className="flex items-center gap-0.5 text-xs text-gray-400">
              <Clock size={9} /> {recipe.prep_time}m
            </span>
          ) : null}
          {recipe.servings ? (
            <span className="flex items-center gap-0.5 text-xs text-gray-400">
              <Users size={9} /> {recipe.servings}
            </span>
          ) : null}
          {recipe.source_url && (
            <a href={recipe.source_url} target="_blank" rel="noopener noreferrer"
              className="ml-auto text-gray-300 hover:text-accent transition-colors">
              <ExternalLink size={10} />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

export default function SharePlanPage() {
  const { token } = useParams<{ token: string }>()
  const [plan, setPlan] = useState<WeekPlan | null>(null)
  const [slots, setSlots] = useState<MealSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return
    getSharedPlan(token)
      .then(({ plan, slots }) => { setPlan(plan); setSlots(slots) })
      .catch(() => setError('Dieser Wochenplan wurde nicht gefunden oder der Link ist abgelaufen.'))
      .finally(() => setLoading(false))
  }, [token])

  const getSlot = (day: number, mealType: string) =>
    slots.find((s) => s.day === day && s.meal_type === mealType)

  if (loading) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary/40" />
      </div>
    )
  }

  if (error) {
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

  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <header className="border-b border-sand-dark/30 bg-white/70 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
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

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Plan title */}
        <div className="mb-8">
          <h1 className="text-primary text-3xl font-bold mb-1"
            style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
            {plan?.name}
          </h1>
          <p className="text-gray-400 text-sm">
            Woche ab {plan?.week_start ? new Date(plan.week_start).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' }) : ''}
          </p>
        </div>

        {/* Week grid */}
        <div className="overflow-x-auto -mx-2 px-2">
          <table className="w-full border-separate border-spacing-1.5" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th className="w-24" />
                {DAYS.map((day) => (
                  <th key={day} className="text-xs font-bold text-primary/70 text-center pb-1">
                    {day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MEAL_TYPE_ORDER.filter((mt) => MEAL_TYPES.includes(mt as typeof MEAL_TYPES[number])).map((mealType) => (
                <tr key={mealType}>
                  <td className="text-xs font-semibold text-gray-400 pr-2 text-right align-middle whitespace-nowrap">
                    {MEAL_LABELS[mealType]}
                  </td>
                  {DAYS.map((_, di) => {
                    const slot = getSlot(di, mealType)
                    return (
                      <td key={di} className="align-top">
                        {slot?.recipe ? (
                          <RecipeCard recipe={slot.recipe as Recipe} />
                        ) : (
                          <div className="h-full min-h-16 rounded-xl bg-sand/40 border border-dashed border-sand-dark/30" />
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Recipe list — for easy reading / printing */}
        {slots.filter((s) => s.recipe).length > 0 && (
          <section className="mt-12">
            <h2 className="text-primary text-xl font-semibold mb-4"
              style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
              Alle Rezepte dieser Woche
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from(new Map(slots.filter((s) => s.recipe).map((s) => [s.recipe_id, s])).values())
                .map((slot) => {
                  const r = slot.recipe as Recipe
                  return (
                    <div key={slot.recipe_id} className="bg-white rounded-xl p-4 border border-sand-dark/20 flex gap-3">
                      {r.image_url && (
                        <img src={r.image_url} alt={r.title} className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-primary">{r.title}</p>
                        {r.source_name && <p className="text-xs text-gray-400 mt-0.5">{r.source_name}</p>}
                        <div className="flex items-center gap-3 mt-1">
                          {r.prep_time ? <span className="text-xs text-gray-400"><Clock size={10} className="inline mr-0.5" />{r.prep_time} Min.</span> : null}
                          {r.servings ? <span className="text-xs text-gray-400"><Users size={10} className="inline mr-0.5" />{r.servings} Port.</span> : null}
                          {r.source_url && (
                            <a href={r.source_url} target="_blank" rel="noopener noreferrer"
                              className="ml-auto text-xs text-accent hover:text-accent-dark flex items-center gap-1 transition-colors">
                              Rezept <ExternalLink size={10} />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
            </div>
          </section>
        )}

        <p className="text-center text-xs text-gray-300 mt-12">
          Geteilt mit <span className="font-semibold">MealMind</span> · smarter essen, besser leben
        </p>
      </main>
    </div>
  )
}
