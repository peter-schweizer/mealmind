import { Clock, Users, Plus, Star } from 'lucide-react'
import type { Recipe } from '../../types'

interface RecipeCardProps {
  recipe: Recipe
  onSelect: (recipe: Recipe) => void
  onAdd?: () => void
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

function getTagColor(tag: string): string {
  return TAG_COLORS[tag] ?? 'bg-gray-100 text-gray-600'
}

export default function RecipeCard({ recipe, onSelect, onAdd }: RecipeCardProps) {
  const totalTime = (recipe.prep_time ?? 0) + (recipe.cook_time ?? 0)

  return (
    <div
      className="recipe-card paper-card overflow-hidden cursor-pointer group"
      onClick={() => onSelect(recipe)}
    >
      {/* Image */}
      <div className="relative h-44 overflow-hidden rounded-t-xl">
        {recipe.image_url ? (
          <img
            src={recipe.image_url}
            alt={recipe.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            onError={(e) => {
              const target = e.currentTarget
              target.style.display = 'none'
              target.nextElementSibling?.classList.remove('hidden')
            }}
          />
        ) : null}
        {/* Fallback gradient */}
        <div
          className={`absolute inset-0 flex items-center justify-center ${recipe.image_url ? 'hidden' : ''}`}
          style={{
            background: 'linear-gradient(135deg, #2D4A3E 0%, #3D6354 40%, #E8D5B7 100%)',
          }}
        >
          <span
            className="text-white/80 text-3xl"
            style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
          >
            {recipe.title.charAt(0)}
          </span>
        </div>

        {/* Source badge */}
        {recipe.source_name && (
          <div className="absolute top-2 left-2">
            <span className="bg-black/50 backdrop-blur-sm text-white text-xs px-2 py-0.5 rounded-full font-medium">
              {recipe.source_name}
            </span>
          </div>
        )}

        {/* Rating */}
        {recipe.rating && (
          <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/50 backdrop-blur-sm rounded-full px-2 py-0.5">
            <Star size={11} className="text-amber-400 fill-amber-400" />
            <span className="text-white text-xs font-medium">{recipe.rating}</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Dietary tags */}
        {recipe.dietary_tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {recipe.dietary_tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${getTagColor(tag)}`}
              >
                {tag}
              </span>
            ))}
            {recipe.dietary_tags.length > 2 && (
              <span className="text-xs text-gray-400 px-1 py-0.5">
                +{recipe.dietary_tags.length - 2}
              </span>
            )}
          </div>
        )}

        {/* Title */}
        <h3
          className="text-primary font-semibold text-base leading-snug mb-2 line-clamp-2 group-hover:text-primary-light transition-colors"
          style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
        >
          {recipe.title}
        </h3>

        {/* Meta row */}
        <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
          {totalTime > 0 && (
            <div className="flex items-center gap-1">
              <Clock size={12} />
              <span>{totalTime} Min.</span>
            </div>
          )}
          {recipe.servings && (
            <div className="flex items-center gap-1">
              <Users size={12} />
              <span>{recipe.servings} Port.</span>
            </div>
          )}
        </div>

        {/* Match score bar */}
        {recipe.match_score !== undefined && (
          <div className="mb-3">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-gray-400">Passt zu Ihnen</span>
              <span className="text-xs font-semibold text-primary">
                {Math.round(recipe.match_score * 100)}%
              </span>
            </div>
            <div className="match-bar">
              <div
                className="match-bar-fill"
                style={{ width: `${recipe.match_score * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Add button */}
        {onAdd && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAdd()
            }}
            className="w-full flex items-center justify-center gap-1.5 py-2 bg-accent text-white text-xs font-semibold rounded-lg hover:bg-accent-dark transition-colors duration-150 mt-1"
          >
            <Plus size={14} />
            Zum Plan hinzufügen
          </button>
        )}
      </div>
    </div>
  )
}
