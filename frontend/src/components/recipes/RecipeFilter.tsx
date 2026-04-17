import { Search, SlidersHorizontal, ArrowDownUp } from 'lucide-react'
import { DIETARY_TAGS } from '../../types'

export type SortOption = 'newest' | 'oldest' | 'fastest'

export interface FilterState {
  search: string
  tags: string[]
  source: string
  sort: SortOption
}

interface RecipeFilterProps {
  value: FilterState
  onChange: (filters: FilterState) => void
  sources?: string[]
}

const TAG_COLORS_ACTIVE: Record<string, string> = {
  Vegan: 'bg-emerald-600 text-white border-emerald-600',
  Vegetarisch: 'bg-green-600 text-white border-green-600',
  Pescetarisch: 'bg-cyan-600 text-white border-cyan-600',
  'Low Carb': 'bg-blue-600 text-white border-blue-600',
  Keto: 'bg-indigo-600 text-white border-indigo-600',
  'Diabetiker-geeignet': 'bg-violet-600 text-white border-violet-600',
  Glutenfrei: 'bg-amber-600 text-white border-amber-600',
  Laktosefrei: 'bg-yellow-600 text-white border-yellow-600',
  Hochprotein: 'bg-orange-600 text-white border-orange-600',
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'newest',  label: 'Neueste' },
  { value: 'oldest',  label: 'Älteste' },
  { value: 'fastest', label: 'Schnellste' },
]

export default function RecipeFilter({ value, onChange, sources = [] }: RecipeFilterProps) {
  const toggleTag = (tag: string) => {
    const tags = value.tags.includes(tag)
      ? value.tags.filter((t) => t !== tag)
      : [...value.tags, tag]
    onChange({ ...value, tags })
  }

  return (
    <div className="space-y-3">
      {/* Search row */}
      <div className="flex gap-3 items-center flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <input
            type="text"
            value={value.search}
            onChange={(e) => onChange({ ...value, search: e.target.value })}
            placeholder="Rezepte suchen…"
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-sand-dark rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition placeholder-gray-400"
          />
        </div>

        {/* Sort pills */}
        <div className="flex items-center gap-1.5 bg-white border border-sand-dark rounded-xl px-2 py-1.5">
          <ArrowDownUp size={13} className="text-gray-400 flex-shrink-0" />
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChange({ ...value, sort: opt.value })}
              className={[
                'text-xs font-medium px-2.5 py-1 rounded-lg transition-all',
                value.sort === opt.value
                  ? 'bg-primary text-white'
                  : 'text-gray-500 hover:bg-sand hover:text-primary',
              ].join(' ')}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Source dropdown */}
        {sources.length > 0 && (
          <div className="relative">
            <SlidersHorizontal
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
            <select
              value={value.source}
              onChange={(e) => onChange({ ...value, source: e.target.value })}
              className="pl-8 pr-8 py-2.5 text-sm bg-white border border-sand-dark rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition appearance-none cursor-pointer"
            >
              <option value="">Alle Quellen</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Dietary tag pills */}
      <div className="flex flex-wrap gap-1.5">
        {DIETARY_TAGS.map((tag) => {
          const active = value.tags.includes(tag)
          return (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={[
                'text-xs font-medium px-3 py-1 rounded-full border transition-all duration-150',
                active
                  ? (TAG_COLORS_ACTIVE[tag] ?? 'bg-primary text-white border-primary')
                  : 'bg-white text-gray-500 border-sand-dark hover:border-gray-400 hover:text-gray-700',
              ].join(' ')}
            >
              {tag}
            </button>
          )
        })}
        {value.tags.length > 0 && (
          <button
            onClick={() => onChange({ ...value, tags: [] })}
            className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 transition-colors"
          >
            Zurücksetzen
          </button>
        )}
      </div>
    </div>
  )
}
