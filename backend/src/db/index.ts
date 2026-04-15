import 'dotenv/config';
import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
  ssl: { rejectUnauthorized: false },
  max: 10,
});

// ─── Query helpers ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query<T = Record<string, any>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const { rows } = await pool.query(sql, params);
  return rows as T[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function queryOne<T = Record<string, any>>(
  sql: string,
  params?: unknown[],
): Promise<T | undefined> {
  const { rows } = await pool.query(sql, params);
  return rows[0] as T | undefined;
}

// ─── Schema + seed ────────────────────────────────────────────────────────────

export async function initDb(): Promise<void> {
  // ── Schema migrations (idempotent) ───────────────────────────────────────
  await pool.query(`
    ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS clerk_user_id TEXT UNIQUE;
    ALTER TABLE week_plans    ADD COLUMN IF NOT EXISTS user_id TEXT;
    ALTER TABLE recipe_sources ADD COLUMN IF NOT EXISTS user_id TEXT;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS recipes (
      id          SERIAL PRIMARY KEY,
      title       TEXT    NOT NULL,
      description TEXT    DEFAULT '',
      image_url   TEXT    DEFAULT '',
      source_url  TEXT    DEFAULT '',
      source_name TEXT    DEFAULT '',
      prep_time   INTEGER DEFAULT 0,
      cook_time   INTEGER DEFAULT 0,
      servings    INTEGER DEFAULT 4,
      dietary_tags    JSONB DEFAULT '[]',
      ingredients     JSONB DEFAULT '[]',
      instructions    JSONB DEFAULT '[]',
      rating      REAL    DEFAULT NULL,
      notes       TEXT    DEFAULT '',
      is_custom   BOOLEAN DEFAULT FALSE,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      id                   SERIAL PRIMARY KEY,
      name                 TEXT    NOT NULL DEFAULT 'Mein Profil',
      dietary_preferences  JSONB   DEFAULT '[]',
      dislikes             JSONB   DEFAULT '[]',
      allergies            JSONB   DEFAULT '[]',
      household_size       INTEGER DEFAULT 2,
      pantry_staples       JSONB   DEFAULT '[]',
      owned_ingredients    JSONB   DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS recipe_sources (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      url           TEXT NOT NULL UNIQUE,
      scraper_type  TEXT DEFAULT 'generic',
      status        TEXT DEFAULT 'active',
      last_sync     TIMESTAMPTZ DEFAULT NULL,
      error_message TEXT DEFAULT NULL,
      auth_type     TEXT DEFAULT 'none',
      auth_data     TEXT DEFAULT NULL,
      auth_status   TEXT DEFAULT 'unauthenticated',
      auth_error    TEXT DEFAULT NULL,
      auth_username TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS week_plans (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      week_start DATE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS meal_slots (
      id        SERIAL PRIMARY KEY,
      plan_id   INTEGER NOT NULL REFERENCES week_plans(id) ON DELETE CASCADE,
      day       INTEGER NOT NULL CHECK(day BETWEEN 0 AND 6),
      meal_type TEXT    NOT NULL CHECK(meal_type IN ('breakfast','lunch','dinner','snack')),
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS meal_history (
      id        SERIAL PRIMARY KEY,
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      eaten_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // ── Seed user profile ──────────────────────────────────────────────────────
  const profileCount = await queryOne<{ cnt: string }>('SELECT COUNT(*) as cnt FROM user_profile');
  if (profileCount && parseInt(profileCount.cnt, 10) === 0) {
    await pool.query(`
      INSERT INTO user_profile (name, dietary_preferences, dislikes, allergies, household_size, pantry_staples, owned_ingredients)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      'Mein Profil',
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify([]),
      2,
      JSON.stringify(['Salz', 'Pfeffer', 'Mehl', 'Öl', 'Zucker', 'Butter', 'Knoblauch', 'Zwiebeln', 'Essig']),
      JSON.stringify([]),
    ]);
  }

  // ── Seed recipe sources ────────────────────────────────────────────────────
  const sourceCount = await queryOne<{ cnt: string }>('SELECT COUNT(*) as cnt FROM recipe_sources');
  if (sourceCount && parseInt(sourceCount.cnt, 10) === 0) {
    await pool.query(
      'INSERT INTO recipe_sources (name, url, scraper_type, status) VALUES ($1,$2,$3,$4) ON CONFLICT (url) DO NOTHING',
      ['Chefkoch', 'https://www.chefkoch.de', 'chefkoch', 'active'],
    );
    await pool.query(
      'INSERT INTO recipe_sources (name, url, scraper_type, status) VALUES ($1,$2,$3,$4) ON CONFLICT (url) DO NOTHING',
      ['REWE', 'https://www.rewe.de/rezepte', 'rewe', 'active'],
    );
  }

  // ── Seed sample recipes ────────────────────────────────────────────────────
  const recipeCount = await queryOne<{ cnt: string }>('SELECT COUNT(*) as cnt FROM recipes');
  if (recipeCount && parseInt(recipeCount.cnt, 10) === 0) {
    const recipes = [
      {
        title: 'Spaghetti Carbonara',
        description: 'Ein klassisches italienisches Nudelgericht mit cremiger Ei-Käse-Sauce und knusprigem Speck.',
        image_url: 'https://images.unsplash.com/photo-1612874742237-6526221588e3?w=800&q=80',
        source_url: 'https://www.chefkoch.de/rezepte/spaghetti-carbonara',
        source_name: 'Chefkoch',
        prep_time: 10, cook_time: 20, servings: 4,
        dietary_tags: [],
        ingredients: [
          { amount: 400, unit: 'g', item: 'Spaghetti' },
          { amount: 150, unit: 'g', item: 'Pancetta oder Speck' },
          { amount: 4, unit: '', item: 'Eier' },
          { amount: 100, unit: 'g', item: 'Pecorino Romano, gerieben' },
          { amount: 50, unit: 'g', item: 'Parmesan, gerieben' },
          { amount: 2, unit: 'Zehe', item: 'Knoblauch' },
          { amount: 1, unit: 'TL', item: 'schwarzer Pfeffer, frisch gemahlen' },
          { amount: 1, unit: 'TL', item: 'Salz' },
        ],
        instructions: [
          'Spaghetti in reichlich Salzwasser al dente kochen. Etwa 200 ml Kochwasser aufheben.',
          'Pancetta oder Speck in Streifen schneiden und in einer großen Pfanne ohne Öl knusprig auslassen.',
          'Eier mit geriebenem Pecorino und Parmesan verquirlen. Großzügig pfeffern.',
          'Heiße Spaghetti (nicht kochend!) zur Speck-Pfanne geben, vom Herd nehmen.',
          'Ei-Käse-Mischung schnell unterheben und mit Kochwasser zur gewünschten Cremigkeit verdünnen.',
          'Sofort servieren und mit extra Käse und Pfeffer garnieren.',
        ],
        rating: 4.8, notes: 'Wichtig: Die Pfanne muss vom Herd sein wenn die Eier dazukommen.',
      },
      {
        title: 'Bayerischer Kartoffelsalat',
        description: 'Traditioneller Kartoffelsalat mit Speck, Zwiebeln und Essig-Marinade – ohne Mayonnaise.',
        image_url: 'https://images.unsplash.com/photo-1576867757603-05b134ebc379?w=800&q=80',
        source_url: 'https://www.chefkoch.de/rezepte/bayerischer-kartoffelsalat',
        source_name: 'Chefkoch',
        prep_time: 20, cook_time: 25, servings: 4,
        dietary_tags: [],
        ingredients: [
          { amount: 1000, unit: 'g', item: 'festkochende Kartoffeln' },
          { amount: 200, unit: 'g', item: 'Speck, gewürfelt' },
          { amount: 2, unit: '', item: 'Zwiebeln, fein gewürfelt' },
          { amount: 4, unit: 'EL', item: 'Weißweinessig' },
          { amount: 200, unit: 'ml', item: 'Fleisch- oder Gemüsebrühe, heiß' },
          { amount: 1, unit: 'TL', item: 'Senf, mittelscharf' },
          { amount: 1, unit: 'Bund', item: 'Schnittlauch' },
        ],
        instructions: [
          'Kartoffeln in der Schale in Salzwasser ca. 25 Minuten kochen, pellen und in Scheiben schneiden.',
          'Speck knusprig auslassen. Zwiebeln dazugeben und glasig braten.',
          'Essig, heiße Brühe, Öl und Senf vermengen. Mit Salz und Pfeffer abschmecken.',
          'Marinade sofort über die noch warmen Kartoffelscheiben gießen.',
          'Mindestens 30 Minuten ziehen lassen. Mit Schnittlauch garniert servieren.',
        ],
        rating: 4.5, notes: 'Am besten lauwarm servieren.',
      },
      {
        title: 'Veganes Rotes Thai-Curry',
        description: 'Aromatisches Thai-Curry mit Kokosmilch, frischem Gemüse und Tofu – schnell und einfach.',
        image_url: 'https://images.unsplash.com/photo-1455619452474-d2be8b1e70cd?w=800&q=80',
        source_url: 'https://www.rewe.de/rezepte/veganes-rotes-thai-curry',
        source_name: 'REWE',
        prep_time: 15, cook_time: 20, servings: 4,
        dietary_tags: ['vegan', 'vegetarisch', 'glutenfrei'],
        ingredients: [
          { amount: 400, unit: 'g', item: 'Tofu, fest' },
          { amount: 400, unit: 'ml', item: 'Kokosmilch' },
          { amount: 2, unit: 'EL', item: 'rote Currypaste' },
          { amount: 1, unit: '', item: 'Zucchini' },
          { amount: 1, unit: '', item: 'rote Paprika' },
          { amount: 200, unit: 'g', item: 'Brokkoliröschen' },
          { amount: 2, unit: 'EL', item: 'Sojasoße' },
          { amount: 300, unit: 'g', item: 'Jasminreis' },
        ],
        instructions: [
          'Reis nach Packungsanleitung kochen.',
          'Tofu in Würfel schneiden und in Kokosöl goldbraun braten.',
          'Zwiebel, Knoblauch und Ingwer anschwitzen. Currypaste rösten.',
          'Kokosmilch angießen, Gemüse hinzufügen und 8–10 Minuten köcheln.',
          'Mit Sojasoße abschmecken und über Reis servieren.',
        ],
        rating: 4.6, notes: 'Für mehr Schärfe mehr Currypaste verwenden.',
      },
      {
        title: 'Linsensuppe mit Räucherwurst',
        description: 'Herzhafte, sättigende Linsensuppe – ein deutsches Wohlfühlgericht für kalte Tage.',
        image_url: 'https://images.unsplash.com/photo-1547592180-85f173990554?w=800&q=80',
        source_url: 'https://www.chefkoch.de/rezepte/linsensuppe-mit-raeucherwurst',
        source_name: 'Chefkoch',
        prep_time: 15, cook_time: 45, servings: 6,
        dietary_tags: [],
        ingredients: [
          { amount: 400, unit: 'g', item: 'braune Linsen' },
          { amount: 2, unit: '', item: 'Räucherwürste (Mettenden)' },
          { amount: 2, unit: '', item: 'Karotten' },
          { amount: 2, unit: '', item: 'Kartoffeln' },
          { amount: 1500, unit: 'ml', item: 'Gemüsebrühe' },
          { amount: 2, unit: 'EL', item: 'Tomatenmark' },
          { amount: 3, unit: 'EL', item: 'Weinessig' },
        ],
        instructions: [
          'Linsen abspülen.',
          'Gemüse würfeln, Zwiebeln und Knoblauch anschwitzen.',
          'Linsen und Brühe hinzufügen, 30 Minuten köcheln.',
          'Räucherwurst dazugeben, weitere 10 Minuten köcheln.',
          'Mit Essig, Salz und Pfeffer abschmecken.',
        ],
        rating: 4.7, notes: 'Schmeckt am nächsten Tag noch besser.',
      },
      {
        title: 'Griechischer Bauernsalat (Horiatiki)',
        description: 'Frischer mediterraner Salat mit Tomaten, Gurke, Feta und Oliven – schnell und gesund.',
        image_url: 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=800&q=80',
        source_url: 'https://www.rewe.de/rezepte/griechischer-bauernsalat',
        source_name: 'REWE',
        prep_time: 15, cook_time: 0, servings: 2,
        dietary_tags: ['vegetarisch', 'glutenfrei'],
        ingredients: [
          { amount: 3, unit: '', item: 'Tomaten, reif' },
          { amount: 0.5, unit: '', item: 'Salatgurke' },
          { amount: 200, unit: 'g', item: 'Feta-Käse' },
          { amount: 80, unit: 'g', item: 'Kalamata-Oliven' },
          { amount: 5, unit: 'EL', item: 'Olivenöl, extra vergine' },
          { amount: 1, unit: 'TL', item: 'getrockneter Oregano' },
        ],
        instructions: [
          'Tomaten und Gurke grob würfeln, Paprika in Streifen schneiden.',
          'Zwiebel in dünne Ringe hobeln.',
          'Alles mit Oliven vermischen.',
          'Olivenöl und Rotweinessig drüber träufeln, mit Oregano würzen.',
          'Feta in Scheiben obenauf legen und sofort servieren.',
        ],
        rating: 4.4, notes: 'Gutes Olivenöl macht den Unterschied.',
      },
    ];

    for (const r of recipes) {
      await pool.query(`
        INSERT INTO recipes
          (title, description, image_url, source_url, source_name, prep_time, cook_time, servings,
           dietary_tags, ingredients, instructions, rating, notes, is_custom)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,FALSE)
      `, [
        r.title, r.description, r.image_url, r.source_url, r.source_name,
        r.prep_time, r.cook_time, r.servings,
        JSON.stringify(r.dietary_tags),
        JSON.stringify(r.ingredients),
        JSON.stringify(r.instructions),
        r.rating, r.notes,
      ]);
    }
  }

  console.log('  Database initialized (Neon PostgreSQL)');
}

export default pool;
