import axios from 'axios';
import * as cheerio from 'cheerio';

// ─── Auth field & config types ────────────────────────────────────────────────

export interface AuthField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'email';
  placeholder?: string;
  hint?: string;
}

export interface AuthConfig {
  /** Displayed in the UI */
  label: string;
  /** Short explanation shown below the login button */
  description: string;
  /** Privacy note shown in the modal footer */
  privacyNote?: string;
  /** Form fields to render in the login modal */
  fields: AuthField[];
  /**
   * URL to the source's own login page.
   * When set, a "Auf Website anmelden" button is shown for users
   * who use Apple, Google or other SSO providers.
   */
  webLoginUrl?: string;
  /** Label for the web-login button, e.g. "Auf Chefkoch.de anmelden" */
  webLoginLabel?: string;
}

/** Stored in the DB `auth_data` column (JSON) */
export interface StoredAuthData {
  cookies?: string;          // raw "Cookie:" header value
  token?: string;            // bearer / API token
  username?: string;         // display name (no password stored)
  authenticated_at?: string; // ISO timestamp
}

export interface SourceDefinition {
  /** Matches `scraper_type` in the DB */
  scraper_type: string;
  /** Human-readable name */
  name: string;
  defaultUrl: string;
  description: string;
  /** Emoji / small icon string */
  icon: string;
  /** If absent the source has no login feature */
  authConfig?: AuthConfig;
  /**
   * Perform the actual login. Returns StoredAuthData on success, throws on failure.
   * Only cookies / tokens are stored – never the raw password.
   */
  login?: (
    credentials: Record<string, string>,
    sourceUrl: string,
  ) => Promise<StoredAuthData>;
  /**
   * Optional: verify that a stored session is still valid.
   * Returns true if still authenticated.
   */
  validateSession?: (authData: StoredAuthData, sourceUrl: string) => Promise<boolean>;
  /**
   * Build the axios config additions needed to use the stored auth.
   * Injected into every scrape request for this source.
   */
  authHeaders?: (authData: StoredAuthData) => Record<string, string>;
}

// ─── Chefkoch definition ──────────────────────────────────────────────────────

const chefkoch: SourceDefinition = {
  scraper_type: 'chefkoch',
  name: 'Chefkoch',
  defaultUrl: 'https://www.chefkoch.de',
  description: 'Deutschlands größte Rezeptplattform',
  icon: '🍳',

  authConfig: {
    label: 'Chefkoch-Konto',
    description:
      'Mit Ihrem Chefkoch-Konto (auch Pro) erhalten Sie Zugang zu Ihrer persönlichen Rezeptsammlung und Premium-Rezepten.',
    privacyNote:
      'Ihr Passwort wird nie gespeichert. Es wird einmalig für die Anmeldung verwendet; danach speichert MealMind nur das verschlüsselte Sitzungs-Cookie.',
    fields: [
      {
        key: 'email',
        label: 'E-Mail-Adresse',
        type: 'email',
        placeholder: 'ihre@email.de',
      },
      {
        key: 'password',
        label: 'Passwort',
        type: 'password',
        placeholder: '••••••••',
      },
    ],
  },

  login: async (credentials) => {
    const { email, password } = credentials;
    if (!email || !password) throw new Error('E-Mail und Passwort sind erforderlich.');

    // Step 1 – fetch login page to get CSRF token
    const loginPageUrl = 'https://www.chefkoch.de/benutzer/login/';
    const pageResp = await axios.get<string>(loginPageUrl, {
      timeout: 10_000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      withCredentials: true,
    });

    // Collect initial cookies
    const setCookieHeaders: string[] = ([] as string[]).concat(
      (pageResp.headers['set-cookie'] as unknown as string[]) ?? [],
    );
    const initialCookies = parseCookiesFromHeaders(setCookieHeaders);

    // Extract CSRF token from the login form
    const $ = cheerio.load(pageResp.data as string);
    const csrfToken =
      $('input[name="_token"]').val() ||
      $('meta[name="csrf-token"]').attr('content') ||
      '';

    // Step 2 – POST credentials
    const params = new URLSearchParams();
    params.append('email', email);
    params.append('password', password);
    if (csrfToken) params.append('_token', String(csrfToken));

    const loginResp = await axios.post(loginPageUrl, params.toString(), {
      timeout: 10_000,
      maxRedirects: 5,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: loginPageUrl,
        Cookie: initialCookies,
      },
      validateStatus: (s) => s < 400,
    });

    const allSetCookies: string[] = ([] as string[]).concat(
      (loginResp.headers['set-cookie'] as unknown as string[]) ?? [],
    );

    if (allSetCookies.length === 0 && !loginResp.data?.includes('abmelden')) {
      throw new Error(
        'Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.',
      );
    }

    const sessionCookies = parseCookiesFromHeaders([
      ...setCookieHeaders,
      ...allSetCookies,
    ]);

    return {
      cookies: sessionCookies,
      username: email,
      authenticated_at: new Date().toISOString(),
    };
  },

  validateSession: async (authData, sourceUrl) => {
    if (!authData.cookies) return false;
    try {
      const resp = await axios.get<string>(sourceUrl, {
        timeout: 8_000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          Cookie: authData.cookies,
        },
      });
      // If response contains logout link the session is still alive
      return String(resp.data).toLowerCase().includes('abmelden');
    } catch {
      return false;
    }
  },

  authHeaders: (authData) => {
    const h: Record<string, string> = {};
    if (authData.cookies) h['Cookie'] = authData.cookies;
    return h;
  },
};

// ─── REWE definition ──────────────────────────────────────────────────────────

const rewe: SourceDefinition = {
  scraper_type: 'rewe',
  name: 'REWE',
  defaultUrl: 'https://www.rewe.de/rezepte',
  description: 'Rezepte vom deutschen Supermarkt',
  icon: '🛒',

  authConfig: {
    label: 'REWE-Konto',
    description:
      'Mit Ihrem REWE-Konto können Sie personalisierte Rezeptvorschläge und Ihren REWE-Einkaufskorb nutzen.',
    privacyNote:
      'Ihr Passwort wird nie gespeichert. Nur das Sitzungs-Cookie wird lokal abgelegt.',
    fields: [
      {
        key: 'email',
        label: 'E-Mail-Adresse',
        type: 'email',
        placeholder: 'ihre@email.de',
      },
      {
        key: 'password',
        label: 'Passwort',
        type: 'password',
        placeholder: '••••••••',
      },
    ],
  },

  login: async (credentials) => {
    const { email, password } = credentials;
    if (!email || !password) throw new Error('E-Mail und Passwort sind erforderlich.');

    // REWE uses OAuth via their API
    const loginResp = await axios.post(
      'https://www.rewe.de/api/login',
      { email, password },
      {
        timeout: 10_000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        },
        validateStatus: (s) => s < 500,
      },
    );

    if (loginResp.status === 401 || loginResp.status === 403) {
      throw new Error('Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.');
    }

    const setCookies: string[] = ([] as string[]).concat(
      (loginResp.headers['set-cookie'] as unknown as string[]) ?? [],
    );
    const token: string =
      (loginResp.data as Record<string, string>)?.token ||
      (loginResp.data as Record<string, string>)?.access_token ||
      '';

    return {
      cookies: setCookies.length > 0 ? parseCookiesFromHeaders(setCookies) : undefined,
      token: token || undefined,
      username: email,
      authenticated_at: new Date().toISOString(),
    };
  },

  authHeaders: (authData) => {
    const headers: Record<string, string> = {};
    if (authData.cookies) headers['Cookie'] = authData.cookies;
    if (authData.token) headers['Authorization'] = `Bearer ${authData.token}`;
    return headers;
  },
};

// ─── Generic definition (no auth) ────────────────────────────────────────────

const generic: SourceDefinition = {
  scraper_type: 'generic',
  name: 'Benutzerdefiniert',
  defaultUrl: '',
  description: 'Beliebige Rezeptwebseite (generisches Scraping)',
  icon: '🌐',
  // No authConfig — generic sources don't support login
};

// ─── Registry ────────────────────────────────────────────────────────────────

const REGISTRY: Record<string, SourceDefinition> = {
  chefkoch,
  rewe,
  generic,
};

export function getSourceDefinition(scraperType: string): SourceDefinition {
  return REGISTRY[scraperType] ?? REGISTRY['generic']!;
}

export function getAllSourceDefinitions(): SourceDefinition[] {
  return Object.values(REGISTRY);
}

/** Returns the auth config for a scraper type, or null if none. */
export function getAuthConfig(scraperType: string): AuthConfig | null {
  return REGISTRY[scraperType]?.authConfig ?? null;
}

// ─── Helper: parse Set-Cookie headers into a single Cookie string ─────────────

function parseCookiesFromHeaders(headers: string[]): string {
  return headers
    .map((h) => h.split(';')[0]) // only name=value part
    .filter(Boolean)
    .join('; ');
}
