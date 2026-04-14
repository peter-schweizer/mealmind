import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(__dirname, '../../data/mealmind.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for better performance
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ─── Schema creation ────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS recipes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    description TEXT    DEFAULT '',
    image_url   TEXT    DEFAULT '',
    source_url  TEXT    DEFAULT '',
    source_name TEXT    DEFAULT '',
    prep_time   INTEGER DEFAULT 0,
    cook_time   INTEGER DEFAULT 0,
    servings    INTEGER DEFAULT 4,
    dietary_tags    TEXT DEFAULT '[]',
    ingredients     TEXT DEFAULT '[]',
    instructions    TEXT DEFAULT '[]',
    rating      REAL    DEFAULT NULL,
    notes       TEXT    DEFAULT '',
    is_custom   INTEGER DEFAULT 0,
    created_at  TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_profile (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT    NOT NULL DEFAULT 'Mein Profil',
    dietary_preferences  TEXT    DEFAULT '[]',
    dislikes             TEXT    DEFAULT '[]',
    allergies            TEXT    DEFAULT '[]',
    household_size       INTEGER DEFAULT 2,
    pantry_staples       TEXT    DEFAULT '[]',
    owned_ingredients    TEXT    DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS recipe_sources (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    url          TEXT NOT NULL UNIQUE,
    scraper_type TEXT DEFAULT 'generic',
    status       TEXT DEFAULT 'active',
    last_sync    TEXT DEFAULT NULL,
    error_message TEXT DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS week_plans (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    week_start TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS meal_slots (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id   INTEGER NOT NULL REFERENCES week_plans(id) ON DELETE CASCADE,
    day       INTEGER NOT NULL CHECK(day BETWEEN 0 AND 6),
    meal_type TEXT    NOT NULL CHECK(meal_type IN ('breakfast','lunch','dinner','snack')),
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS meal_history (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    eaten_at  TEXT    DEFAULT (datetime('now'))
  );
`);

// ─── Migrations ──────────────────────────────────────────────────────────────
// Safely add new columns that may not exist in older DB files

const migrations: [string, string][] = [
  ['recipe_sources', 'ALTER TABLE recipe_sources ADD COLUMN auth_type TEXT DEFAULT \'none\''],
  ['recipe_sources', 'ALTER TABLE recipe_sources ADD COLUMN auth_data TEXT DEFAULT NULL'],
  ['recipe_sources', 'ALTER TABLE recipe_sources ADD COLUMN auth_status TEXT DEFAULT \'unauthenticated\''],
  ['recipe_sources', 'ALTER TABLE recipe_sources ADD COLUMN auth_error TEXT DEFAULT NULL'],
  ['recipe_sources', 'ALTER TABLE recipe_sources ADD COLUMN auth_username TEXT DEFAULT NULL'],
];

for (const [, sql] of migrations) {
  try { db.exec(sql); } catch { /* column already exists – safe to ignore */ }
}

// ─── Seed helpers ────────────────────────────────────────────────────────────

function tableIsEmpty(table: string): boolean {
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number };
  return row.cnt === 0;
}

// ─── Default user profile ────────────────────────────────────────────────────

if (tableIsEmpty('user_profile')) {
  db.prepare(`
    INSERT INTO user_profile (name, dietary_preferences, dislikes, allergies, household_size, pantry_staples, owned_ingredients)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'Mein Profil',
    JSON.stringify([]),
    JSON.stringify([]),
    JSON.stringify([]),
    2,
    JSON.stringify([
      'Salz', 'Pfeffer', 'Mehl', 'Öl', 'Zucker', 'Butter',
      'Knoblauch', 'Zwiebeln', 'Essig',
    ]),
    JSON.stringify([]),
  );
}

// ─── Default recipe sources ──────────────────────────────────────────────────

if (tableIsEmpty('recipe_sources')) {
  const insertSource = db.prepare(`
    INSERT OR IGNORE INTO recipe_sources (name, url, scraper_type, status)
    VALUES (?, ?, ?, ?)
  `);
  insertSource.run('Chefkoch', 'https://www.chefkoch.de', 'chefkoch', 'active');
  insertSource.run('REWE', 'https://www.rewe.de/rezepte', 'rewe', 'active');
}

// ─── Sample recipes ──────────────────────────────────────────────────────────

if (tableIsEmpty('recipes')) {
  const insertRecipe = db.prepare(`
    INSERT INTO recipes
      (title, description, image_url, source_url, source_name, prep_time, cook_time, servings,
       dietary_tags, ingredients, instructions, rating, notes, is_custom)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const recipes = [
    {
      title: 'Spaghetti Carbonara',
      description: 'Ein klassisches italienisches Nudelgericht mit cremiger Ei-Käse-Sauce und knusprigem Speck.',
      image_url: 'https://images.unsplash.com/photo-1612874742237-6526221588e3?w=800&q=80',
      source_url: 'https://www.chefkoch.de/rezepte/spaghetti-carbonara',
      source_name: 'Chefkoch',
      prep_time: 10,
      cook_time: 20,
      servings: 4,
      dietary_tags: JSON.stringify([]),
      ingredients: JSON.stringify([
        { amount: 400, unit: 'g', item: 'Spaghetti' },
        { amount: 150, unit: 'g', item: 'Pancetta oder Speck' },
        { amount: 4, unit: '', item: 'Eier' },
        { amount: 100, unit: 'g', item: 'Pecorino Romano, gerieben' },
        { amount: 50, unit: 'g', item: 'Parmesan, gerieben' },
        { amount: 2, unit: 'Zehe', item: 'Knoblauch' },
        { amount: 1, unit: 'TL', item: 'schwarzer Pfeffer, frisch gemahlen' },
        { amount: 1, unit: 'TL', item: 'Salz' },
      ]),
      instructions: JSON.stringify([
        'Spaghetti in reichlich Salzwasser al dente kochen. Etwa 200 ml Kochwasser aufheben.',
        'Pancetta oder Speck in Streifen schneiden und in einer großen Pfanne ohne Öl knusprig auslassen. Knoblauch kurz mitbraten, dann entfernen.',
        'Eier mit geriebenem Pecorino und Parmesan verquirlen. Großzügig pfeffern.',
        'Heiße Spaghetti (nicht kochend!) zur Speck-Pfanne geben, vom Herd nehmen.',
        'Ei-Käse-Mischung schnell unterheben und mit Kochwasser zur gewünschten Cremigkeit verdünnen.',
        'Sofort servieren und mit extra Käse und Pfeffer garnieren.',
      ]),
      rating: 4.8,
      notes: 'Wichtig: Die Pfanne muss vom Herd sein wenn die Eier dazukommen, sonst gerinnen sie.',
      is_custom: 0,
    },
    {
      title: 'Bayerischer Kartoffelsalat',
      description: 'Traditioneller Kartoffelsalat mit Speck, Zwiebeln und Essig-Marinade – ohne Mayonnaise.',
      image_url: 'https://images.unsplash.com/photo-1576867757603-05b134ebc379?w=800&q=80',
      source_url: 'https://www.chefkoch.de/rezepte/bayerischer-kartoffelsalat',
      source_name: 'Chefkoch',
      prep_time: 20,
      cook_time: 25,
      servings: 4,
      dietary_tags: JSON.stringify([]),
      ingredients: JSON.stringify([
        { amount: 1000, unit: 'g', item: 'festkochende Kartoffeln' },
        { amount: 200, unit: 'g', item: 'Speck, gewürfelt' },
        { amount: 2, unit: '', item: 'Zwiebeln, fein gewürfelt' },
        { amount: 4, unit: 'EL', item: 'Weißweinessig' },
        { amount: 200, unit: 'ml', item: 'Fleisch- oder Gemüsebrühe, heiß' },
        { amount: 2, unit: 'EL', item: 'Sonnenblumenöl' },
        { amount: 1, unit: 'TL', item: 'Senf, mittelscharf' },
        { amount: 1, unit: 'Bund', item: 'Schnittlauch' },
        { amount: 1, unit: 'TL', item: 'Salz' },
        { amount: 0.5, unit: 'TL', item: 'Pfeffer' },
      ]),
      instructions: JSON.stringify([
        'Kartoffeln in der Schale in Salzwasser ca. 25 Minuten kochen bis sie gar sind. Abgießen, kurz abkühlen lassen, pellen und in Scheiben schneiden.',
        'Speck in einer Pfanne knusprig auslassen. Zwiebeln dazugeben und glasig braten.',
        'Essig, heiße Brühe, Öl und Senf vermengen. Mit Salz und Pfeffer abschmecken.',
        'Marinade sofort über die noch warmen Kartoffelscheiben gießen.',
        'Speck-Zwiebel-Mischung unterheben.',
        'Mindestens 30 Minuten ziehen lassen. Mit Schnittlauch garniert servieren.',
      ]),
      rating: 4.5,
      notes: 'Am besten lauwarm servieren. Die Kartoffeln müssen noch warm sein wenn die Marinade drüber kommt.',
      is_custom: 0,
    },
    {
      title: 'Veganes Rotes Thai-Curry',
      description: 'Aromatisches Thai-Curry mit Kokosmilch, frischem Gemüse und Tofu – schnell und einfach.',
      image_url: 'https://images.unsplash.com/photo-1455619452474-d2be8b1e70cd?w=800&q=80',
      source_url: 'https://www.rewe.de/rezepte/veganes-rotes-thai-curry',
      source_name: 'REWE',
      prep_time: 15,
      cook_time: 20,
      servings: 4,
      dietary_tags: JSON.stringify(['vegan', 'vegetarisch', 'glutenfrei']),
      ingredients: JSON.stringify([
        { amount: 400, unit: 'g', item: 'Tofu, fest' },
        { amount: 400, unit: 'ml', item: 'Kokosmilch' },
        { amount: 2, unit: 'EL', item: 'rote Currypaste' },
        { amount: 1, unit: '', item: 'Zucchini' },
        { amount: 1, unit: '', item: 'rote Paprika' },
        { amount: 200, unit: 'g', item: 'Brokkoliröschen' },
        { amount: 1, unit: '', item: 'Zwiebel' },
        { amount: 2, unit: 'Zehe', item: 'Knoblauch' },
        { amount: 1, unit: 'Stück', item: 'Ingwer, daumengroß' },
        { amount: 2, unit: 'EL', item: 'Sojasoße' },
        { amount: 1, unit: 'EL', item: 'Limettensaft' },
        { amount: 1, unit: 'EL', item: 'Kokosöl' },
        { amount: 1, unit: 'Bund', item: 'Koriander' },
        { amount: 300, unit: 'g', item: 'Jasminreis' },
      ]),
      instructions: JSON.stringify([
        'Reis nach Packungsanleitung kochen.',
        'Tofu in Würfel schneiden und in Kokosöl von allen Seiten goldbraun braten. Herausnehmen.',
        'Zwiebel, Knoblauch und Ingwer fein hacken, im selben Topf anschwitzen.',
        'Currypaste einrühren und 1 Minute rösten.',
        'Kokosmilch angießen und aufkochen.',
        'Zucchini, Paprika und Brokkoli hinzufügen und 8–10 Minuten köcheln lassen.',
        'Tofu zurück in den Topf geben.',
        'Mit Sojasoße, Limettensaft und eventuell etwas Zucker abschmecken.',
        'Mit Koriander garniert über Reis servieren.',
      ]),
      rating: 4.6,
      notes: 'Für mehr Schärfe mehr Currypaste verwenden. Statt Tofu geht auch Kichererbsen.',
      is_custom: 0,
    },
    {
      title: 'Linsensuppe mit Räucherwurst',
      description: 'Herzhafte, sättigende Linsensuppe – ein deutsches Wohlfühlgericht für kalte Tage.',
      image_url: 'https://images.unsplash.com/photo-1547592180-85f173990554?w=800&q=80',
      source_url: 'https://www.chefkoch.de/rezepte/linsensuppe-mit-raeucherwurst',
      source_name: 'Chefkoch',
      prep_time: 15,
      cook_time: 45,
      servings: 6,
      dietary_tags: JSON.stringify([]),
      ingredients: JSON.stringify([
        { amount: 400, unit: 'g', item: 'braune Linsen' },
        { amount: 2, unit: '', item: 'Räucherwürste (Mettenden)' },
        { amount: 2, unit: '', item: 'Karotten' },
        { amount: 2, unit: '', item: 'Kartoffeln' },
        { amount: 1, unit: '', item: 'Staudensellerie, 2 Stangen' },
        { amount: 1, unit: '', item: 'Zwiebel' },
        { amount: 2, unit: 'Zehe', item: 'Knoblauch' },
        { amount: 1500, unit: 'ml', item: 'Gemüsebrühe' },
        { amount: 2, unit: 'EL', item: 'Tomatenmark' },
        { amount: 3, unit: 'EL', item: 'Weinessig' },
        { amount: 1, unit: 'TL', item: 'Kreuzkümmel, gemahlen' },
        { amount: 1, unit: 'TL', item: 'Paprikapulver, geräuchert' },
        { amount: 2, unit: 'EL', item: 'Öl' },
        { amount: 1, unit: 'TL', item: 'Salz' },
        { amount: 0.5, unit: 'TL', item: 'Pfeffer' },
      ]),
      instructions: JSON.stringify([
        'Linsen in ein Sieb geben und gut unter fließendem Wasser abspülen.',
        'Zwiebel und Knoblauch fein würfeln. Karotten, Kartoffeln und Sellerie in kleine Würfel schneiden.',
        'Öl in einem großen Topf erhitzen. Zwiebeln und Knoblauch glasig anschwitzen.',
        'Gemüse hinzufügen und kurz mitbraten. Tomatenmark einrühren und 2 Minuten rösten.',
        'Linsen und Brühe hinzufügen. Kreuzkümmel und Paprika einrühren.',
        'Aufkochen und bei mittlerer Hitze 30 Minuten köcheln lassen.',
        'Räucherwurst in Scheiben schneiden und in die Suppe geben, weitere 10 Minuten köcheln.',
        'Mit Essig, Salz und Pfeffer abschmecken. Mit Brot servieren.',
      ]),
      rating: 4.7,
      notes: 'Schmeckt am nächsten Tag noch besser. Wer mag, kann vor dem Servieren einen Teil pürieren.',
      is_custom: 0,
    },
    {
      title: 'Griechischer Bauernsalat (Horiatiki)',
      description: 'Frischer mediterraner Salat mit Tomaten, Gurke, Feta und Oliven – schnell und gesund.',
      image_url: 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=800&q=80',
      source_url: 'https://www.rewe.de/rezepte/griechischer-bauernsalat',
      source_name: 'REWE',
      prep_time: 15,
      cook_time: 0,
      servings: 2,
      dietary_tags: JSON.stringify(['vegetarisch', 'glutenfrei']),
      ingredients: JSON.stringify([
        { amount: 3, unit: '', item: 'Tomaten, reif' },
        { amount: 0.5, unit: '', item: 'Salatgurke' },
        { amount: 1, unit: '', item: 'grüne Paprika' },
        { amount: 0.5, unit: '', item: 'rote Zwiebel' },
        { amount: 200, unit: 'g', item: 'Feta-Käse' },
        { amount: 80, unit: 'g', item: 'Kalamata-Oliven' },
        { amount: 5, unit: 'EL', item: 'Olivenöl, extra vergine' },
        { amount: 2, unit: 'EL', item: 'Rotweinessig' },
        { amount: 1, unit: 'TL', item: 'getrockneter Oregano' },
        { amount: 0.5, unit: 'TL', item: 'Salz' },
        { amount: 0.25, unit: 'TL', item: 'Pfeffer' },
      ]),
      instructions: JSON.stringify([
        'Tomaten in grobe Würfel schneiden. Gurke schälen, halbieren und in halbmondförmige Scheiben schneiden.',
        'Paprika entkernen und in Streifen schneiden. Rote Zwiebel in dünne Ringe hobeln.',
        'Alles in einer großen Schüssel vermengen.',
        'Oliven dazugeben.',
        'Olivenöl und Rotweinessig vermischen und über den Salat träufeln.',
        'Mit Salz, Pfeffer und Oregano würzen.',
        'Feta in große Scheiben schneiden und obenauf legen (nicht zerbröseln).',
        'Noch etwas Olivenöl über den Feta träufeln und sofort servieren.',
      ]),
      rating: 4.4,
      notes: 'Authentisch: Den Feta nicht untermischen, sondern ganz oben drauflegen. Gutes Olivenöl macht den Unterschied.',
      is_custom: 0,
    },
  ];

  for (const r of recipes) {
    insertRecipe.run(
      r.title, r.description, r.image_url, r.source_url, r.source_name,
      r.prep_time, r.cook_time, r.servings,
      r.dietary_tags, r.ingredients, r.instructions,
      r.rating, r.notes, r.is_custom,
    );
  }
}

export default db;
