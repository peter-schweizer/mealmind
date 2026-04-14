import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Wand2,
  ShoppingCart,
  ChevronDown,
  X,
  Search,
  Loader2,
  Trash2,
  Calendar,
} from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { WeekPlan, MealSlot, Recipe } from '../types'
import { DAYS, MEAL_TYPES, MEAL_LABELS } from '../types'
import {
  getPlans,
  createPlan,
  getPlan,
  generateWeek,
  addSlot,
  deleteSlot,
  getRecipes,
} from '../api'
import RecipeModal from '../components/recipes/RecipeModal'

// ─── Sortable Cell ─────────────────────────────────────────────────────────

interface SortableCellProps {
  id: string
  slot?: MealSlot
  day: number
  mealType: string
  onAdd: (day: number, mealType: string) => void
  onRemove: (slot: MealSlot) => void
  onView: (recipe: Recipe) => void
}

function SortableCell({ id, slot, day, mealType, onAdd, onRemove, onView }: SortableCellProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className="planner-cell border border-sand rounded-lg overflow-hidden bg-white/50"
    >
      {slot?.recipe ? (
        <div
          {...listeners}
          className="planner-cell-filled h-full p-2 group relative"
          onClick={() => slot.recipe && onView(slot.recipe)}
        >
          {slot.recipe.image_url && (
            <div className="h-10 -mx-2 -mt-2 mb-2 overflow-hidden">
              <img
                src={slot.recipe.image_url}
                alt={slot.recipe.title}
                className="w-full h-full object-cover"
              />
            </div>
          )}
          <p className="text-xs font-semibold text-primary leading-tight line-clamp-2">
            {slot.recipe.title}
          </p>
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(slot) }}
            className="absolute top-1 right-1 w-5 h-5 bg-white/80 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-red-500"
          >
            <X size={10} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => onAdd(day, mealType)}
          className="w-full h-full flex items-center justify-center text-gray-300 hover:text-primary/50 hover:bg-sand/20 transition-all min-h-[80px]"
        >
          <Plus size={18} />
        </button>
      )}
    </div>
  )
}

// ─── Recipe Picker Modal ───────────────────────────────────────────────────

interface RecipePickerProps {
  onPick: (recipe: Recipe) => void
  onClose: () => void
}

function RecipePicker({ onPick, onClose }: RecipePickerProps) {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getRecipes({ search: search || undefined })
      .then(setRecipes)
      .finally(() => setLoading(false))
  }, [search])

  return (
    <div
      className="modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15, 25, 20, 0.75)', backdropFilter: 'blur(4px)' }}
    >
      <div className="modal-content bg-cream rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-sand flex-shrink-0">
          <h3
            className="text-primary font-semibold text-lg"
            style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
          >
            Rezept auswählen
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-sand/60 hover:bg-sand flex items-center justify-center text-gray-500"
          >
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-sand flex-shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rezept suchen…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-sand-dark rounded-lg focus:ring-2 focus:ring-primary/20 transition bg-white/70"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={20} className="animate-spin text-primary/50" />
            </div>
          ) : recipes.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-10">Keine Rezepte gefunden</p>
          ) : (
            <ul className="divide-y divide-sand/60">
              {recipes.map((recipe) => (
                <li key={recipe.id}>
                  <button
                    onClick={() => onPick(recipe)}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-sand/30 transition-colors text-left"
                  >
                    {recipe.image_url ? (
                      <img
                        src={recipe.image_url}
                        alt={recipe.title}
                        className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 text-primary text-sm font-bold">
                        {recipe.title.charAt(0)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-primary truncate">{recipe.title}</p>
                      {recipe.source_name && (
                        <p className="text-xs text-gray-400 truncate">{recipe.source_name}</p>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Planner Page ─────────────────────────────────────────────────────

export default function Planner() {
  const navigate = useNavigate()
  const [plans, setPlans] = useState<WeekPlan[]>([])
  const [activePlan, setActivePlan] = useState<WeekPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [showNewPlan, setShowNewPlan] = useState(false)
  const [newPlanName, setNewPlanName] = useState('')
  const [newPlanWeek, setNewPlanWeek] = useState(() => {
    const now = new Date()
    const day = now.getDay()
    const diff = now.getDate() - day + (day === 0 ? -6 : 1)
    const monday = new Date(now.setDate(diff))
    return monday.toISOString().split('T')[0]
  })
  const [pickerTarget, setPickerTarget] = useState<{ day: number; mealType: string } | null>(null)
  const [viewingRecipe, setViewingRecipe] = useState<Recipe | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const fetchPlans = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getPlans()
      setPlans(data)
      if (data.length > 0 && !activePlan) {
        const full = await getPlan(data[0].id)
        setActivePlan(full)
      }
    } finally {
      setLoading(false)
    }
  }, [activePlan])

  useEffect(() => { fetchPlans() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const switchPlan = async (id: number) => {
    const full = await getPlan(id)
    setActivePlan(full)
  }

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault()
    const plan = await createPlan(newPlanName || `Woche ${newPlanWeek}`, newPlanWeek)
    const full = await getPlan(plan.id)
    setPlans((p) => [full, ...p])
    setActivePlan(full)
    setShowNewPlan(false)
    setNewPlanName('')
  }

  const handleGenerate = async () => {
    if (!activePlan) return
    setGenerating(true)
    try {
      const updated = await generateWeek(activePlan.id)
      setActivePlan(updated)
    } finally {
      setGenerating(false)
    }
  }

  const handlePick = async (recipe: Recipe) => {
    if (!activePlan || !pickerTarget) return
    await addSlot(activePlan.id, pickerTarget.day, pickerTarget.mealType, recipe.id)
    const fresh = await getPlan(activePlan.id)
    setActivePlan(fresh)
    setPickerTarget(null)
  }

  const handleRemoveSlot = async (slot: MealSlot) => {
    if (!activePlan) return
    await deleteSlot(activePlan.id, slot.id)
    const fresh = await getPlan(activePlan.id)
    setActivePlan(fresh)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id || !activePlan) return
    // Swap slots: find both slots and re-assign recipes
    const slots = activePlan.slots ?? []
    const activeSlot = slots.find((s) => getCellId(s.day, s.meal_type) === active.id)
    const overSlot = slots.find((s) => getCellId(s.day, s.meal_type) === over.id)
    if (!activeSlot?.recipe_id) return

    // Remove from active, add to over position
    const [overDay, overMeal] = String(over.id).split('-')
    await deleteSlot(activePlan.id, activeSlot.id)
    if (overSlot) await deleteSlot(activePlan.id, overSlot.id)
    await addSlot(activePlan.id, Number(overDay), overMeal, activeSlot.recipe_id)
    if (overSlot?.recipe_id) {
      const [activeDay, activeMeal] = String(active.id).split('-')
      await addSlot(activePlan.id, Number(activeDay), activeMeal, overSlot.recipe_id)
    }
    const fresh = await getPlan(activePlan.id)
    setActivePlan(fresh)
  }

  const getCellId = (day: number, mealType: string) => `${day}-${mealType}`

  const getSlot = (day: number, mealType: string): MealSlot | undefined =>
    activePlan?.slots?.find((s) => s.day === day && s.meal_type === mealType)

  const allCellIds = DAYS.flatMap((_, di) => MEAL_TYPES.map((mt) => getCellId(di, mt)))

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <Loader2 size={32} className="animate-spin text-primary/40" />
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1
            className="text-primary text-4xl font-bold mb-2"
            style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
          >
            Wochenplaner
          </h1>
          <p className="text-gray-500">Planen Sie Ihre Mahlzeiten für die ganze Woche</p>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Plan selector */}
          {plans.length > 0 && (
            <div className="relative">
              <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <select
                value={activePlan?.id ?? ''}
                onChange={(e) => switchPlan(Number(e.target.value))}
                className="pl-8 pr-8 py-2.5 text-sm border border-sand-dark rounded-xl bg-white focus:ring-2 focus:ring-primary/20 appearance-none cursor-pointer"
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={() => setShowNewPlan(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-sand-dark text-primary text-sm font-semibold rounded-xl hover:bg-sand/30 transition-colors"
          >
            <Plus size={15} />
            Neue Woche
          </button>

          <button
            onClick={handleGenerate}
            disabled={!activePlan || generating}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-light disabled:opacity-50 transition-colors"
          >
            {generating ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
            Woche generieren
          </button>

          <button
            onClick={() => activePlan && navigate(`/shopping?plan=${activePlan.id}`)}
            disabled={!activePlan}
            className="flex items-center gap-2 px-4 py-2.5 bg-accent text-white text-sm font-semibold rounded-xl hover:bg-accent-dark disabled:opacity-50 transition-colors"
          >
            <ShoppingCart size={15} />
            Einkaufsliste
          </button>
        </div>
      </div>

      {/* No plan state */}
      {!activePlan && (
        <div className="text-center py-24">
          <p className="text-gray-400 text-lg mb-3">Noch kein Wochenplan vorhanden</p>
          <button
            onClick={() => setShowNewPlan(true)}
            className="px-5 py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-light transition-colors"
          >
            Ersten Plan erstellen
          </button>
        </div>
      )}

      {/* Grid */}
      {activePlan && (
        <div className="paper-card-white p-4 overflow-x-auto">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={allCellIds} strategy={rectSortingStrategy}>
              <div className="min-w-[700px]">
                {/* Column headers */}
                <div className="grid grid-cols-8 gap-2 mb-2">
                  <div /> {/* Row header spacer */}
                  {DAYS.map((day) => (
                    <div
                      key={day}
                      className="text-center text-xs font-bold text-primary/70 py-1"
                    >
                      {day}
                    </div>
                  ))}
                </div>

                {/* Rows */}
                {MEAL_TYPES.map((mealType, mi) => (
                  <div key={mealType} className={`grid grid-cols-8 gap-2 ${mi < MEAL_TYPES.length - 1 ? 'mb-2' : ''}`}>
                    {/* Row header */}
                    <div className="flex items-center">
                      <span className="text-xs font-semibold text-primary/60 whitespace-nowrap">
                        {MEAL_LABELS[mealType]}
                      </span>
                    </div>

                    {/* Cells */}
                    {DAYS.map((_, di) => {
                      const slot = getSlot(di, mealType)
                      const cellId = getCellId(di, mealType)
                      return (
                        <SortableCell
                          key={cellId}
                          id={cellId}
                          slot={slot}
                          day={di}
                          mealType={mealType}
                          onAdd={(day, mt) => setPickerTarget({ day, mealType: mt })}
                          onRemove={handleRemoveSlot}
                          onView={setViewingRecipe}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* New Plan Modal */}
      {showNewPlan && (
        <div
          className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(15, 25, 20, 0.7)', backdropFilter: 'blur(4px)' }}
        >
          <div className="modal-content bg-cream rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h2
                className="text-primary text-xl font-semibold"
                style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
              >
                Neue Woche
              </h2>
              <button
                onClick={() => setShowNewPlan(false)}
                className="w-8 h-8 rounded-full bg-sand/60 hover:bg-sand flex items-center justify-center text-gray-500"
              >
                <X size={15} />
              </button>
            </div>
            <form onSubmit={handleCreatePlan} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-primary mb-1">
                  Plan-Name
                </label>
                <input
                  type="text"
                  value={newPlanName}
                  onChange={(e) => setNewPlanName(e.target.value)}
                  placeholder="z.B. Woche 13"
                  className="w-full border border-sand-dark rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 transition bg-white/70"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-primary mb-1">
                  Montag der Woche
                </label>
                <input
                  type="date"
                  value={newPlanWeek}
                  onChange={(e) => setNewPlanWeek(e.target.value)}
                  className="w-full border border-sand-dark rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 transition bg-white/70"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-light transition-colors"
              >
                Plan erstellen
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Recipe Picker */}
      {pickerTarget && (
        <RecipePicker
          onPick={handlePick}
          onClose={() => setPickerTarget(null)}
        />
      )}

      {/* View Recipe Modal */}
      {viewingRecipe && (
        <RecipeModal
          recipe={viewingRecipe}
          onClose={() => setViewingRecipe(null)}
        />
      )}
    </div>
  )
}
