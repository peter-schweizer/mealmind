import { useState, useEffect, useCallback } from 'react'
import {
  Plus,
  Link,
  X,
  Trash2,
  Pencil,
  Loader2,
  FileText,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react'
import type { Recipe, Ingredient } from '../types'
import { DIETARY_TAGS } from '../types'
import {
  getRecipes, createRecipe, updateRecipe, deleteRecipe,
  scrapeRecipe, parseRecipeText,
} from '../api'
import type { ParsedRecipePreview } from '../api'
import RecipeCard from '../components/recipes/RecipeCard'
import RecipeModal from '../components/recipes/RecipeModal'
import RecipeFilter, { type FilterState } from '../components/recipes/RecipeFilter'

interface RecipeForm {
  title: string
  description: string
  image_url: string
  servings: string
  prep_time: string
  cook_time: string
  dietary_tags: string[]
  ingredients: Ingredient[]
  instructions: string
}

const emptyForm: RecipeForm = {
  title: '',
  description: '',
  image_url: '',
  servings: '',
  prep_time: '',
  cook_time: '',
  dietary_tags: [],
  ingredients: [{ item: '', amount: undefined, unit: '' }],
  instructions: '',
}

export default function MyRecipes() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<FilterState>({ search: '', tags: [], source: '' })
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<RecipeForm>(emptyForm)
  const [formSaving, setFormSaving] = useState(false)
  // ─── Import modal state ────────────────────────────────────────────────────
  const [showScrapeModal, setShowScrapeModal] = useState(false)
  const [importTab, setImportTab] = useState<'url' | 'text'>('url')
  // URL tab
  const [scrapeUrl, setScrapeUrl] = useState('')
  const [scrapeName, setScrapeName] = useState('')
  const [scraping, setScraping] = useState(false)
  const [scrapeError, setScrapeError] = useState('')
  // Text tab
  const [pasteText, setPasteText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [preview, setPreview] = useState<ParsedRecipePreview | null>(null)
  const [saving, setSaving] = useState(false)

  const fetchRecipes = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getRecipes({
        is_custom: true,
        search: filters.search || undefined,
        tags: filters.tags.length ? filters.tags : undefined,
      })
      setRecipes(data)
    } catch {
      setRecipes([])
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { fetchRecipes() }, [fetchRecipes])

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  const openEdit = (recipe: Recipe) => {
    setEditingId(recipe.id)
    setForm({
      title: recipe.title,
      description: recipe.description ?? '',
      image_url: recipe.image_url ?? '',
      servings: recipe.servings ? String(recipe.servings) : '',
      prep_time: recipe.prep_time ? String(recipe.prep_time) : '',
      cook_time: recipe.cook_time ? String(recipe.cook_time) : '',
      dietary_tags: recipe.dietary_tags,
      ingredients: recipe.ingredients.length
        ? recipe.ingredients
        : [{ item: '', amount: undefined, unit: '' }],
      instructions: recipe.instructions.join('\n'),
    })
    setShowForm(true)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Rezept wirklich löschen?')) return
    await deleteRecipe(id)
    fetchRecipes()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormSaving(true)
    try {
      const payload = {
        title: form.title,
        description: form.description || undefined,
        image_url: form.image_url || undefined,
        servings: form.servings ? Number(form.servings) : undefined,
        prep_time: form.prep_time ? Number(form.prep_time) : undefined,
        cook_time: form.cook_time ? Number(form.cook_time) : undefined,
        dietary_tags: form.dietary_tags,
        ingredients: form.ingredients.filter((i) => i.item.trim()),
        instructions: form.instructions
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        is_custom: true,
        rating: undefined,
        notes: undefined,
        source_url: undefined,
        source_name: undefined,
      }
      if (editingId) {
        await updateRecipe(editingId, payload)
      } else {
        await createRecipe(payload)
      }
      setShowForm(false)
      fetchRecipes()
    } finally {
      setFormSaving(false)
    }
  }

  const addIngredientRow = () => {
    setForm((f) => ({
      ...f,
      ingredients: [...f.ingredients, { item: '', amount: undefined, unit: '' }],
    }))
  }

  const removeIngredientRow = (i: number) => {
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.filter((_, idx) => idx !== i),
    }))
  }

  const updateIngredient = (i: number, field: keyof Ingredient, value: string) => {
    setForm((f) => {
      const ingredients = [...f.ingredients]
      if (field === 'amount') {
        ingredients[i] = { ...ingredients[i], amount: value ? Number(value) : undefined }
      } else {
        ingredients[i] = { ...ingredients[i], [field]: value }
      }
      return { ...f, ingredients }
    })
  }

  const toggleTag = (tag: string) => {
    setForm((f) => ({
      ...f,
      dietary_tags: f.dietary_tags.includes(tag)
        ? f.dietary_tags.filter((t) => t !== tag)
        : [...f.dietary_tags, tag],
    }))
  }

  const closeImportModal = () => {
    setShowScrapeModal(false)
    setScrapeUrl('')
    setScrapeName('')
    setScrapeError('')
    setPasteText('')
    setParseError('')
    setPreview(null)
    setImportTab('url')
  }

  const handleScrape = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!scrapeUrl.trim()) return
    setScraping(true)
    setScrapeError('')
    try {
      await scrapeRecipe(scrapeUrl.trim(), scrapeName.trim() || undefined)
      closeImportModal()
      fetchRecipes()
    } catch {
      setScrapeError('Rezept konnte nicht importiert werden. Bitte prüfen Sie die URL.')
    } finally {
      setScraping(false)
    }
  }

  /** Step 1: Parse text and show preview */
  const handleParsePreview = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pasteText.trim().length < 10) return
    setParsing(true)
    setParseError('')
    setPreview(null)
    try {
      const result = await parseRecipeText(pasteText.trim(), false)
      setPreview(result)
    } catch {
      setParseError('Text konnte nicht analysiert werden. Bitte prüfen Sie das Format.')
    } finally {
      setParsing(false)
    }
  }

  /** Step 2: Save the previewed recipe */
  const handleSavePreview = async () => {
    if (!preview) return
    setSaving(true)
    try {
      await parseRecipeText(pasteText.trim(), true, 'Text-Import')
      closeImportModal()
      fetchRecipes()
    } catch {
      setParseError('Speichern fehlgeschlagen. Bitte versuchen Sie es erneut.')
    } finally {
      setSaving(false)
    }
  }

  const filteredRecipes = recipes.filter((r) => {
    if (filters.tags.length && !filters.tags.some((t) => r.dietary_tags.includes(t))) return false
    return true
  })

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1
            className="text-primary text-4xl font-bold mb-2"
            style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
          >
            Mein Rezeptbuch
          </h1>
          <p className="text-gray-500">Ihre persönliche Rezeptsammlung</p>
        </div>
        <div className="flex gap-3 flex-shrink-0">
          <button
            onClick={() => setShowScrapeModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-sand-dark text-primary text-sm font-semibold rounded-xl hover:bg-sand/40 transition-colors"
          >
            <Link size={15} />
            Per URL importieren
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 bg-accent text-white text-sm font-semibold rounded-xl hover:bg-accent-dark transition-colors shadow-sm"
          >
            <Plus size={15} />
            Rezept hinzufügen
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-8 paper-card-white p-4">
        <RecipeFilter value={filters} onChange={setFilters} />
      </div>

      {/* Recipe grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="paper-card h-64 animate-pulse" />
          ))}
        </div>
      ) : filteredRecipes.length === 0 ? (
        <div className="text-center py-24">
          <p className="text-gray-400 text-lg mb-3">Noch keine Rezepte</p>
          <p className="text-gray-300 text-sm mb-6">
            Fügen Sie Ihr erstes Rezept hinzu oder importieren Sie eines per URL.
          </p>
          <button
            onClick={openCreate}
            className="px-5 py-2.5 bg-accent text-white text-sm font-semibold rounded-xl hover:bg-accent-dark transition-colors"
          >
            Erstes Rezept erstellen
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredRecipes.map((recipe) => (
            <div key={recipe.id} className="relative group">
              <RecipeCard recipe={recipe} onSelect={setSelectedRecipe} />
              {/* Edit / Delete overlay */}
              <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); openEdit(recipe) }}
                  className="w-8 h-8 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow text-primary transition-colors"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(recipe.id) }}
                  className="w-8 h-8 bg-white/90 hover:bg-red-50 rounded-full flex items-center justify-center shadow text-red-500 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Form Modal */}
      {showForm && (
        <div
          className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(15, 25, 20, 0.7)', backdropFilter: 'blur(4px)' }}
        >
          <div className="modal-content bg-cream rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-sand flex-shrink-0">
              <h2
                className="text-primary text-xl font-semibold"
                style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
              >
                {editingId ? 'Rezept bearbeiten' : 'Neues Rezept'}
              </h2>
              <button
                onClick={() => setShowForm(false)}
                className="w-8 h-8 rounded-full bg-sand/60 hover:bg-sand flex items-center justify-center text-gray-500 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Title */}
              <div>
                <label className="block text-sm font-semibold text-primary mb-1">
                  Titel <span className="text-accent">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Rezeptname"
                  className="w-full border border-sand-dark rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition bg-white/70"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-semibold text-primary mb-1">
                  Beschreibung
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Kurze Beschreibung des Rezepts"
                  rows={2}
                  className="w-full border border-sand-dark rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition bg-white/70 resize-none"
                />
              </div>

              {/* Image URL */}
              <div>
                <label className="block text-sm font-semibold text-primary mb-1">
                  Bild-URL
                </label>
                <input
                  type="url"
                  value={form.image_url}
                  onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))}
                  placeholder="https://…"
                  className="w-full border border-sand-dark rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition bg-white/70"
                />
              </div>

              {/* Servings / Prep / Cook */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-primary mb-1">
                    Portionen
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={form.servings}
                    onChange={(e) => setForm((f) => ({ ...f, servings: e.target.value }))}
                    className="w-full border border-sand-dark rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 transition bg-white/70"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-primary mb-1">
                    Vorbereitung (Min.)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={form.prep_time}
                    onChange={(e) => setForm((f) => ({ ...f, prep_time: e.target.value }))}
                    className="w-full border border-sand-dark rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 transition bg-white/70"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-primary mb-1">
                    Kochen (Min.)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={form.cook_time}
                    onChange={(e) => setForm((f) => ({ ...f, cook_time: e.target.value }))}
                    className="w-full border border-sand-dark rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 transition bg-white/70"
                  />
                </div>
              </div>

              {/* Dietary tags */}
              <div>
                <label className="block text-sm font-semibold text-primary mb-2">
                  Ernährungsweise
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {DIETARY_TAGS.map((tag) => {
                    const active = form.dietary_tags.includes(tag)
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={[
                          'text-xs font-medium px-2.5 py-1 rounded-full border transition-all',
                          active
                            ? 'bg-primary text-white border-primary'
                            : 'bg-white text-gray-500 border-sand-dark hover:border-gray-400',
                        ].join(' ')}
                      >
                        {tag}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Ingredients */}
              <div>
                <label className="block text-sm font-semibold text-primary mb-2">
                  Zutaten
                </label>
                <div className="space-y-2">
                  {form.ingredients.map((ing, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input
                        type="number"
                        placeholder="Menge"
                        value={ing.amount ?? ''}
                        onChange={(e) => updateIngredient(i, 'amount', e.target.value)}
                        className="w-20 border border-sand-dark rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-primary/20 transition bg-white/70"
                      />
                      <input
                        type="text"
                        placeholder="Einheit"
                        value={ing.unit ?? ''}
                        onChange={(e) => updateIngredient(i, 'unit', e.target.value)}
                        className="w-20 border border-sand-dark rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-primary/20 transition bg-white/70"
                      />
                      <input
                        type="text"
                        placeholder="Zutat"
                        value={ing.item}
                        onChange={(e) => updateIngredient(i, 'item', e.target.value)}
                        className="flex-1 border border-sand-dark rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-primary/20 transition bg-white/70"
                      />
                      <button
                        type="button"
                        onClick={() => removeIngredientRow(i)}
                        disabled={form.ingredients.length === 1}
                        className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-500 disabled:opacity-30 transition-colors"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addIngredientRow}
                  className="mt-2 text-xs text-primary/70 hover:text-primary flex items-center gap-1 transition-colors"
                >
                  <Plus size={12} /> Zutat hinzufügen
                </button>
              </div>

              {/* Instructions */}
              <div>
                <label className="block text-sm font-semibold text-primary mb-1">
                  Zubereitung
                </label>
                <p className="text-xs text-gray-400 mb-1.5">
                  Jeden Schritt in einer neuen Zeile eingeben
                </p>
                <textarea
                  value={form.instructions}
                  onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
                  placeholder="Schritt 1: …&#10;Schritt 2: …"
                  rows={6}
                  className="w-full border border-sand-dark rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition bg-white/70 resize-none"
                />
              </div>

              {/* Submit */}
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={formSaving}
                  className="flex-1 py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-light disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
                >
                  {formSaving && <Loader2 size={15} className="animate-spin" />}
                  {editingId ? 'Änderungen speichern' : 'Rezept erstellen'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-5 py-2.5 bg-sand text-primary text-sm font-semibold rounded-xl hover:bg-sand-dark transition-colors"
                >
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showScrapeModal && (
        <div
          className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(15, 25, 20, 0.7)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) closeImportModal() }}
        >
          <div className="modal-content bg-cream rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <h2
                className="text-primary text-xl font-semibold"
                style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
              >
                Rezept importieren
              </h2>
              <button
                onClick={closeImportModal}
                className="w-8 h-8 rounded-full bg-sand/60 hover:bg-sand flex items-center justify-center text-gray-500"
              >
                <X size={16} />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 p-1 bg-sand rounded-xl mb-5">
              {([
                { id: 'url', label: 'Per URL', icon: <Link size={13} /> },
                { id: 'text', label: 'Text einfügen', icon: <FileText size={13} /> },
              ] as const).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => { setImportTab(tab.id); setPreview(null); setScrapeError(''); setParseError('') }}
                  className={[
                    'flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold rounded-lg transition-all',
                    importTab === tab.id
                      ? 'bg-white text-primary shadow-sm'
                      : 'text-gray-500 hover:text-primary',
                  ].join(' ')}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ── URL Tab ───────────────────────────────────────────────────── */}
            {importTab === 'url' && (
              <form onSubmit={handleScrape} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-primary mb-1">
                    Rezept-URL
                  </label>
                  <input
                    type="url"
                    required
                    autoFocus
                    value={scrapeUrl}
                    onChange={(e) => setScrapeUrl(e.target.value)}
                    placeholder="https://www.chefkoch.de/rezepte/…"
                    className="w-full border border-sand-dark rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition bg-white/70"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Funktioniert mit Chefkoch, REWE und den meisten anderen Rezeptseiten (Schema.org-Standard).
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-primary mb-1">
                    Quellname <span className="font-normal text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={scrapeName}
                    onChange={(e) => setScrapeName(e.target.value)}
                    placeholder="z.B. Chefkoch, Mama's Blog …"
                    className="w-full border border-sand-dark rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition bg-white/70"
                  />
                </div>
                {scrapeError && (
                  <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
                    <AlertTriangle size={12} className="flex-shrink-0" /> {scrapeError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={scraping || !scrapeUrl.trim()}
                  className="w-full py-2.5 bg-accent text-white text-sm font-semibold rounded-xl hover:bg-accent-dark disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
                >
                  {scraping ? <><Loader2 size={15} className="animate-spin" /> Wird importiert…</> : 'Rezept importieren'}
                </button>
              </form>
            )}

            {/* ── Text Tab ──────────────────────────────────────────────────── */}
            {importTab === 'text' && (
              <div className="space-y-4">
                {/* Hint */}
                <div className="flex gap-2.5 p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700 leading-relaxed">
                  <FileText size={14} className="flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold mb-0.5">Instagram, TikTok & Co.</p>
                    <p>
                      Öffne das Posting, kopiere den kompletten Text (Beschreibung / Caption)
                      und füge ihn hier ein. Das System erkennt Zutaten, Zubereitung und
                      Zeiten automatisch.
                    </p>
                  </div>
                </div>

                {!preview ? (
                  <form onSubmit={handleParsePreview} className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-primary mb-1">
                        Rezept-Text einfügen
                      </label>
                      <textarea
                        required
                        autoFocus
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        rows={10}
                        placeholder={`Spaghetti Carbonara 🍝\n\nZutaten für 4 Personen:\n- 400g Spaghetti\n- 200g Pancetta\n...\n\nZubereitung:\n1. Wasser aufkochen...\n\n#pasta #carbonara`}
                        className="w-full border border-sand-dark rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition bg-white/70 resize-none leading-relaxed"
                      />
                    </div>
                    {parseError && (
                      <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
                        <AlertTriangle size={12} className="flex-shrink-0" /> {parseError}
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={parsing || pasteText.trim().length < 10}
                      className="w-full py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
                    >
                      {parsing ? <><Loader2 size={15} className="animate-spin" /> Analysiere…</> : <><ChevronRight size={15} /> Analysieren & Vorschau</>}
                    </button>
                  </form>
                ) : (
                  /* ── Preview ─────────────────────────────────────────────── */
                  <div className="space-y-4">
                    {/* Confidence badge */}
                    <div className={[
                      'flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg',
                      preview.confidence === 'high' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                      preview.confidence === 'medium' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                      'bg-red-50 text-red-700 border border-red-200',
                    ].join(' ')}>
                      {preview.confidence === 'high'
                        ? <><CheckCircle2 size={13} /> Hohe Erkennungsqualität — alles gefunden</>
                        : preview.confidence === 'medium'
                        ? <><AlertTriangle size={13} /> Mittlere Qualität — bitte Vorschau prüfen</>
                        : <><AlertTriangle size={13} /> Niedrige Qualität — Rezept manuell ergänzen</>
                      }
                    </div>

                    {/* Preview card */}
                    <div className="border border-sand-dark rounded-xl p-4 bg-white/60 space-y-3 text-sm">
                      <div>
                        <span className="text-xs font-bold text-primary/50 uppercase tracking-wide">Titel</span>
                        <p className="font-semibold text-primary mt-0.5">{preview.recipe.title}</p>
                      </div>

                      {(preview.recipe.servings ?? 0) > 0 && (
                        <div className="flex gap-4 text-xs text-gray-500">
                          <span>🍽 {preview.recipe.servings} Portionen</span>
                          {(preview.recipe.prep_time ?? 0) > 0 && <span>⏱ {preview.recipe.prep_time} Min. Vorbereitung</span>}
                          {(preview.recipe.cook_time ?? 0) > 0 && <span>🔥 {preview.recipe.cook_time} Min. Kochen</span>}
                        </div>
                      )}

                      <div>
                        <span className="text-xs font-bold text-primary/50 uppercase tracking-wide">
                          Zutaten ({preview.recipe.ingredients.length})
                        </span>
                        {preview.recipe.ingredients.length === 0 ? (
                          <p className="text-gray-400 text-xs italic mt-1">Keine erkannt</p>
                        ) : (
                          <ul className="mt-1 space-y-0.5">
                            {preview.recipe.ingredients.slice(0, 6).map((ing, i) => (
                              <li key={i} className="text-gray-700 text-xs">
                                {ing.amount ? `${ing.amount}${ing.unit ? ' ' + ing.unit : ''} ` : ''}{ing.item}
                              </li>
                            ))}
                            {preview.recipe.ingredients.length > 6 && (
                              <li className="text-gray-400 text-xs">+{preview.recipe.ingredients.length - 6} weitere…</li>
                            )}
                          </ul>
                        )}
                      </div>

                      <div>
                        <span className="text-xs font-bold text-primary/50 uppercase tracking-wide">
                          Zubereitungsschritte ({preview.recipe.instructions.length})
                        </span>
                        {preview.recipe.instructions.length === 0 ? (
                          <p className="text-gray-400 text-xs italic mt-1">Keine erkannt</p>
                        ) : (
                          <p className="text-gray-600 text-xs mt-1 line-clamp-2">
                            {preview.recipe.instructions[0]}…
                          </p>
                        )}
                      </div>
                    </div>

                    {parseError && (
                      <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                        {parseError}
                      </p>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => { setPreview(null); setParseError('') }}
                        className="flex-1 py-2 border border-sand-dark text-primary text-sm font-semibold rounded-xl hover:bg-sand/40 transition-colors"
                      >
                        Zurück
                      </button>
                      <button
                        onClick={handleSavePreview}
                        disabled={saving}
                        className="flex-1 py-2 bg-accent text-white text-sm font-semibold rounded-xl hover:bg-accent-dark disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
                      >
                        {saving ? <><Loader2 size={14} className="animate-spin" /> Wird gespeichert…</> : 'Rezept speichern'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recipe modal */}
      {selectedRecipe && (
        <RecipeModal
          recipe={selectedRecipe}
          onClose={() => setSelectedRecipe(null)}
          onSaved={() => { setSelectedRecipe(null); fetchRecipes() }}
        />
      )}
    </div>
  )
}
