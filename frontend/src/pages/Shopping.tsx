import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ShoppingCart,
  Copy,
  Download,
  Calendar,
  Check,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import type { ShoppingItem, WeekPlan } from '../types'
import { getShoppingList, getIcal, getPlans } from '../api'

const CATEGORY_ORDER = [
  'Gemüse',
  'Obst',
  'Fleisch & Fisch',
  'Milchprodukte',
  'Getreide & Backwaren',
  'Hülsenfrüchte',
  'Gewürze & Öle',
  'Sonstiges',
]

function sortCategories(a: string, b: string): number {
  const ai = CATEGORY_ORDER.indexOf(a)
  const bi = CATEGORY_ORDER.indexOf(b)
  if (ai === -1 && bi === -1) return a.localeCompare(b, 'de')
  if (ai === -1) return 1
  if (bi === -1) return -1
  return ai - bi
}

interface CategoryGroupProps {
  category: string
  items: ShoppingItem[]
  checked: Set<string>
  hideOwned: boolean
  markOwned: boolean
  onToggle: (key: string) => void
}

function CategoryGroup({ category, items, checked, hideOwned, markOwned, onToggle }: CategoryGroupProps) {
  const [collapsed, setCollapsed] = useState(false)

  const visible = items.filter((item) => {
    if (hideOwned && item.owned) return false
    return true
  })

  if (visible.length === 0) return null

  return (
    <div className="mb-4">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-2 w-full text-left mb-2 group"
      >
        {collapsed ? (
          <ChevronRight size={14} className="text-gray-400" />
        ) : (
          <ChevronDown size={14} className="text-gray-400" />
        )}
        <span className="text-xs font-bold text-primary/60 uppercase tracking-wider">
          {category}
        </span>
        <span className="text-xs text-gray-400 ml-1">({visible.length})</span>
      </button>

      {!collapsed && (
        <ul className="space-y-1.5">
          {visible.map((item) => {
            const key = item.ingredient
            const isChecked = checked.has(key)
            const isOwned = markOwned && item.owned

            return (
              <li
                key={key}
                className={[
                  'flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-all',
                  isChecked
                    ? 'bg-gray-50 border-gray-200 opacity-60'
                    : isOwned
                    ? 'bg-emerald-50/60 border-emerald-100'
                    : 'bg-white border-sand',
                ].join(' ')}
              >
                <button
                  onClick={() => onToggle(key)}
                  className={[
                    'flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all mt-0.5',
                    isChecked
                      ? 'bg-primary border-primary'
                      : 'border-sand-dark hover:border-primary/50',
                  ].join(' ')}
                >
                  {isChecked && <Check size={11} className="text-white" />}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`text-sm font-medium transition-all ${
                        isChecked ? 'text-gray-400 line-through' : 'text-gray-800'
                      }`}
                    >
                      {item.amount && item.unit
                        ? `${item.amount} ${item.unit} `
                        : item.amount
                        ? `${item.amount} `
                        : ''}
                      {item.ingredient}
                    </span>
                    {isOwned && !isChecked && (
                      <span className="text-xs text-emerald-600 font-medium bg-emerald-100 px-1.5 py-0.5 rounded-full">
                        vorrätig
                      </span>
                    )}
                  </div>
                  {item.recipes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {item.recipes.map((r) => (
                        <span
                          key={r}
                          className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default function Shopping() {
  const [searchParams] = useSearchParams()
  const planIdParam = searchParams.get('plan')

  const [plans, setPlans] = useState<WeekPlan[]>([])
  const [activePlanId, setActivePlanId] = useState<number | null>(
    planIdParam ? Number(planIdParam) : null
  )
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [hideOwned, setHideOwned] = useState(false)
  const [markOwned, setMarkOwned] = useState(true)
  const [copySuccess, setCopySuccess] = useState(false)

  useEffect(() => {
    getPlans().then((p) => {
      setPlans(p)
      if (!activePlanId && p.length > 0) {
        setActivePlanId(p[0].id)
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activePlanId) { setLoading(false); return }
    setLoading(true)
    getShoppingList(activePlanId)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [activePlanId])

  const toggleItem = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Group by category
  const grouped: Record<string, ShoppingItem[]> = {}
  for (const item of items) {
    const cat = item.category || 'Sonstiges'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(item)
  }
  const sortedCategories = Object.keys(grouped).sort(sortCategories)

  const totalItems = items.length
  const checkedCount = checked.size

  const handleCopy = () => {
    const lines: string[] = []
    for (const cat of sortedCategories) {
      lines.push(`## ${cat}`)
      for (const item of grouped[cat]) {
        const qty = item.amount ? `${item.amount}${item.unit ? ' ' + item.unit : ''} ` : ''
        lines.push(`- ${qty}${item.ingredient}`)
      }
      lines.push('')
    }
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    })
  }

  const handleCsv = () => {
    const rows = [['Kategorie', 'Menge', 'Einheit', 'Zutat', 'Rezepte']]
    for (const cat of sortedCategories) {
      for (const item of grouped[cat]) {
        rows.push([
          cat,
          String(item.amount ?? ''),
          item.unit ?? '',
          item.ingredient,
          item.recipes.join('; '),
        ])
      }
    }
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'einkaufsliste.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleIcal = async () => {
    if (!activePlanId) return
    const ics = await getIcal(activePlanId)
    const blob = new Blob([ics], { type: 'text/calendar' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'wochenplan.ics'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="animate-fade-in max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1
            className="text-primary text-4xl font-bold mb-2"
            style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
          >
            Einkaufsliste
          </h1>
          <p className="text-gray-500">
            {totalItems > 0
              ? `${checkedCount} von ${totalItems} Artikeln erledigt`
              : 'Wählen Sie einen Wochenplan aus'}
          </p>
        </div>

        {/* Plan selector */}
        {plans.length > 0 && (
          <div className="relative flex-shrink-0">
            <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <select
              value={activePlanId ?? ''}
              onChange={(e) => setActivePlanId(Number(e.target.value))}
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
      </div>

      {/* Settings panel */}
      <div className="paper-card p-5 mb-6">
        <h2
          className="text-primary font-semibold mb-4 text-sm uppercase tracking-wide"
          style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
        >
          Einstellungen
        </h2>
        <div className="space-y-3">
          {/* Hide owned toggle */}
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-gray-700">Basisvorrat ausblenden</span>
            <button
              onClick={() => setHideOwned((v) => !v)}
              className={`relative w-11 h-6 rounded-full toggle-track transition-colors ${
                hideOwned ? 'bg-primary' : 'bg-gray-200'
              }`}
            >
              <span
                className={`toggle-thumb absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  hideOwned ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </label>

          {/* Mark owned toggle */}
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-gray-700">Vorhandene Zutaten markieren</span>
            <button
              onClick={() => setMarkOwned((v) => !v)}
              className={`relative w-11 h-6 rounded-full toggle-track transition-colors ${
                markOwned ? 'bg-primary' : 'bg-gray-200'
              }`}
            >
              <span
                className={`toggle-thumb absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  markOwned ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </label>
        </div>
      </div>

      {/* Export buttons */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={handleCopy}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-sand-dark text-primary text-sm font-medium rounded-lg hover:bg-sand/30 transition-colors"
        >
          {copySuccess ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
          {copySuccess ? 'Kopiert!' : 'In Zwischenablage'}
        </button>
        <button
          onClick={handleCsv}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-sand-dark text-primary text-sm font-medium rounded-lg hover:bg-sand/30 transition-colors"
        >
          <Download size={14} />
          Als CSV
        </button>
        <button
          onClick={handleIcal}
          disabled={!activePlanId}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-sand-dark text-primary text-sm font-medium rounded-lg hover:bg-sand/30 disabled:opacity-50 transition-colors"
        >
          <Calendar size={14} />
          Wochenplan (.ics)
        </button>
      </div>

      {/* Shopping list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-primary/40" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20">
          <ShoppingCart size={40} className="text-gray-200 mx-auto mb-4" />
          <p className="text-gray-400 text-base">Keine Artikel in dieser Liste</p>
          <p className="text-gray-300 text-sm mt-1">
            Fügen Sie Rezepte zum Wochenplan hinzu, um eine Liste zu generieren.
          </p>
        </div>
      ) : (
        <div>
          {sortedCategories.map((cat) => (
            <CategoryGroup
              key={cat}
              category={cat}
              items={grouped[cat]}
              checked={checked}
              hideOwned={hideOwned}
              markOwned={markOwned}
              onToggle={toggleItem}
            />
          ))}
        </div>
      )}
    </div>
  )
}
