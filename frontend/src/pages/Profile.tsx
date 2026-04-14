import { useState, useEffect, useRef } from 'react'
import { X, Plus, Check, Loader2, User, Home, Leaf, AlertTriangle } from 'lucide-react'
import type { UserProfile } from '../types'
import { DIETARY_TAGS } from '../types'
import { getProfile, updateProfile, updatePantry } from '../api'

// ─── Tag Input Component ───────────────────────────────────────────────────

interface TagInputProps {
  label: string
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
}

function TagInput({ label, tags, onChange, placeholder = 'Eingabe + Enter' }: TagInputProps) {
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const addTag = () => {
    const val = input.trim()
    if (val && !tags.includes(val)) {
      onChange([...tags, val])
    }
    setInput('')
  }

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag))
  }

  return (
    <div>
      <label className="block text-sm font-semibold text-primary mb-2">{label}</label>
      <div
        className="min-h-[42px] flex flex-wrap gap-1.5 p-2 border border-sand-dark rounded-xl bg-white/70 cursor-text tag-input-container"
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 bg-sand text-primary text-xs font-medium px-2.5 py-1 rounded-full"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(tag) }}
              className="text-primary/50 hover:text-accent transition-colors"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); addTag() }
            if (e.key === 'Backspace' && !input && tags.length) {
              onChange(tags.slice(0, -1))
            }
          }}
          placeholder={tags.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] bg-transparent text-xs outline-none text-gray-700 placeholder-gray-400 py-0.5"
        />
      </div>
    </div>
  )
}

// ─── Main Profile Page ─────────────────────────────────────────────────────

export default function Profile() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingPantry, setSavingPantry] = useState(false)
  const [saved, setSaved] = useState(false)

  // Form state
  const [name, setName] = useState('')
  const [householdSize, setHouseholdSize] = useState(2)
  const [dietaryPrefs, setDietaryPrefs] = useState<string[]>([])
  const [dislikes, setDislikes] = useState<string[]>([])
  const [allergies, setAllergies] = useState<string[]>([])
  const [customTags, setCustomTags] = useState<string[]>([])
  const [pantryInput, setPantryInput] = useState('')
  const [pantry, setPantry] = useState<string[]>([])

  useEffect(() => {
    getProfile()
      .then((p) => {
        setProfile(p)
        setName(p.name)
        setHouseholdSize(p.household_size)
        setDietaryPrefs(p.dietary_preferences)
        setDislikes(p.dislikes)
        setAllergies(p.allergies)
        setPantry(p.pantry_staples)
        // Custom tags = dietary_prefs not in DIETARY_TAGS
        const known = new Set(DIETARY_TAGS as unknown as string[])
        setCustomTags(p.dietary_preferences.filter((t) => !known.has(t)))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const toggleDietaryPref = (tag: string) => {
    setDietaryPrefs((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const allPrefs = [
        ...dietaryPrefs.filter((t) => (DIETARY_TAGS as readonly string[]).includes(t)),
        ...customTags,
      ]
      await updateProfile({
        name,
        household_size: householdSize,
        dietary_preferences: allPrefs,
        dislikes,
        allergies,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  const addPantryItem = () => {
    const val = pantryInput.trim()
    if (val && !pantry.includes(val)) {
      setPantry((p) => [...p, val])
    }
    setPantryInput('')
  }

  const removePantryItem = (item: string) => {
    setPantry((p) => p.filter((i) => i !== item))
  }

  const handleSavePantry = async () => {
    setSavingPantry(true)
    try {
      await updatePantry(pantry)
    } finally {
      setSavingPantry(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <Loader2 size={32} className="animate-spin text-primary/40" />
      </div>
    )
  }

  return (
    <div className="animate-fade-in max-w-2xl">
      {/* Header */}
      <div className="mb-8">
        <h1
          className="text-primary text-4xl font-bold mb-2"
          style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
        >
          Mein Profil
        </h1>
        <p className="text-gray-500">Personalisieren Sie Ihre Rezeptempfehlungen</p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Basic info */}
        <div className="paper-card-white p-6">
          <div className="flex items-center gap-2 mb-5">
            <User size={16} className="text-primary/60" />
            <h2
              className="text-primary font-semibold"
              style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
            >
              Grundinformationen
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-sm font-semibold text-primary mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ihr Name"
                className="w-full border border-sand-dark rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition bg-white/70"
              />
            </div>

            <div className="col-span-2 sm:col-span-1">
              <label className="block text-sm font-semibold text-primary mb-1">
                <span className="flex items-center gap-1.5">
                  <Home size={13} />
                  Haushaltsgröße
                </span>
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={householdSize}
                  onChange={(e) => setHouseholdSize(Number(e.target.value))}
                  className="flex-1 accent-primary"
                />
                <span className="w-8 text-center text-sm font-bold text-primary">
                  {householdSize}
                </span>
              </div>
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>1 Person</span>
                <span>10 Personen</span>
              </div>
            </div>
          </div>
        </div>

        {/* Dietary preferences */}
        <div className="paper-card-white p-6">
          <div className="flex items-center gap-2 mb-5">
            <Leaf size={16} className="text-primary/60" />
            <h2
              className="text-primary font-semibold"
              style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
            >
              Ernährungsweise
            </h2>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {DIETARY_TAGS.map((tag) => {
              const active = dietaryPrefs.includes(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleDietaryPref(tag)}
                  className={[
                    'flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full border transition-all',
                    active
                      ? 'bg-primary text-white border-primary shadow-sm'
                      : 'bg-white text-gray-600 border-sand-dark hover:border-primary/50',
                  ].join(' ')}
                >
                  {active && <Check size={12} />}
                  {tag}
                </button>
              )
            })}
          </div>

          <TagInput
            label="Eigene Ernährungsweisen"
            tags={customTags}
            onChange={setCustomTags}
            placeholder="z.B. Rohkost, Ayurvedisch + Enter"
          />
        </div>

        {/* Dislikes + Allergies */}
        <div className="paper-card-white p-6 space-y-5">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={16} className="text-primary/60" />
            <h2
              className="text-primary font-semibold"
              style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
            >
              Abneigungen & Allergien
            </h2>
          </div>

          <TagInput
            label="Zutaten, die ich nicht mag"
            tags={dislikes}
            onChange={setDislikes}
            placeholder="z.B. Rosenkohl, Leber + Enter"
          />

          <TagInput
            label="Allergien & Unverträglichkeiten"
            tags={allergies}
            onChange={setAllergies}
            placeholder="z.B. Erdnüsse, Gluten + Enter"
          />
        </div>

        {/* Save button */}
        <button
          type="submit"
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light disabled:opacity-60 transition-colors text-sm"
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : saved ? (
            <Check size={16} />
          ) : null}
          {saved ? 'Gespeichert!' : saving ? 'Wird gespeichert…' : 'Profil speichern'}
        </button>
      </form>

      {/* Pantry staples */}
      <div className="paper-card-white p-6 mt-6">
        <h2
          className="text-primary font-semibold mb-1"
          style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
        >
          Basisvorrat
        </h2>
        <p className="text-xs text-gray-400 mb-4">
          Zutaten, die Sie immer zu Hause haben – diese werden bei der Einkaufsliste berücksichtigt.
        </p>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={pantryInput}
            onChange={(e) => setPantryInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPantryItem() } }}
            placeholder="Zutat eingeben + Enter"
            className="flex-1 border border-sand-dark rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 transition bg-white/70"
          />
          <button
            type="button"
            onClick={addPantryItem}
            className="px-3 py-2 bg-primary text-white rounded-lg hover:bg-primary-light transition-colors"
          >
            <Plus size={16} />
          </button>
        </div>

        {pantry.length === 0 ? (
          <p className="text-gray-400 text-sm italic">Noch keine Vorräte hinzugefügt.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {pantry.map((item) => (
              <span
                key={item}
                className="flex items-center gap-1 bg-sand text-primary text-xs font-medium px-2.5 py-1 rounded-full"
              >
                {item}
                <button
                  onClick={() => removePantryItem(item)}
                  className="text-primary/40 hover:text-accent transition-colors ml-0.5"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={handleSavePantry}
          disabled={savingPantry}
          className="flex items-center gap-2 px-4 py-2 bg-sand text-primary text-sm font-semibold rounded-lg hover:bg-sand-dark transition-colors disabled:opacity-60"
        >
          {savingPantry && <Loader2 size={13} className="animate-spin" />}
          Vorrat speichern
        </button>
      </div>
    </div>
  )
}
