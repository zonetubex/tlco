import { DatabaseAdapter, DatabaseConfig, DatabaseType } from './types';
import { SupabaseAdapter } from './supabase-adapter';
import { JsonBinAdapter } from './jsonbin-adapter';
import { FirebaseAdapter } from './firebase-adapter';
import { CpanelAdapter } from './cpanel-adapter';
import { PocketHostAdapter } from './pockethost-adapter';
import { RestdbAdapter } from './restdb-adapter';
import { NeonAdapter } from './neon-adapter';

// Re-export types for consumers
export type { DatabaseAdapter, DatabaseConfig, DatabaseType };
export type { ShortLinkData, SettingRow, ClickLogData } from './types';

// ─── Config Persistence ───────────────────────────────────────────────

const STORAGE_KEY = 'safelink_db_config';

// NO default config — clean slate. Config comes from safelink-config.json or admin setup.
const DEFAULT_CONFIG: DatabaseConfig = {
  type: 'cpanel',
};

export function loadConfig(): DatabaseConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DatabaseConfig;
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch {
    // Ignore parse errors
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(config: DatabaseConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage errors
  }
}

// ─── Adapter Factory ──────────────────────────────────────────────────

export function createAdapter(config: DatabaseConfig): DatabaseAdapter {
  switch (config.type) {
    case 'supabase':
      return new SupabaseAdapter(config);
    case 'jsonbin':
      return new JsonBinAdapter(config);
    case 'firebase':
      return new FirebaseAdapter(config);
    case 'cpanel':
      return new CpanelAdapter(config);
    case 'pockethost':
      return new PocketHostAdapter(config);
    case 'restdb':
      return new RestdbAdapter(config);
    case 'neon':
      return new NeonAdapter(config);
    default:
      return new CpanelAdapter(config);
  }
}

// ─── Singleton Database Instance ──────────────────────────────────────

let _config: DatabaseConfig = loadConfig();
let _adapter: DatabaseAdapter = createAdapter(_config);
let _configInitialized = false;

/**
 * Get the current database adapter instance.
 */
export function getDb(): DatabaseAdapter {
  return _adapter;
}

/**
 * Get the current database configuration.
 */
export function getDbConfig(): DatabaseConfig {
  return { ..._config };
}

/**
 * Get the active database type.
 */
export function getDbType(): DatabaseType {
  return _config.type;
}

/**
 * Get the human-readable name of the active database.
 */
export function getDbName(): string {
  return _adapter.name;
}

/**
 * Switch to a different database configuration.
 */
export function switchDatabase(config: DatabaseConfig): DatabaseAdapter {
  _config = config;
  _adapter = createAdapter(config);
  saveConfig(config);
  return _adapter;
}

/**
 * IMPORTANT: Call this on app startup BEFORE rendering anything.
 * Loads DB config from /safelink-config.json (deployed on server).
 * This makes the app work for ALL visitors, not just the admin browser.
 *
 * Priority:
 *  1. /safelink-config.json (online — works for everyone)
 *  2. localStorage (fallback — admin's browser)
 */
export async function initDbConfig(): Promise<void> {
  if (_configInitialized) return;
  _configInitialized = true;

  // 1. Try online config first (deployed safelink-config.json)
  try {
    const res = await fetch('/safelink-config.json?t=' + Date.now());
    if (res.ok) {
      const config = await res.json();
      if (config && config.type && config.type !== 'cpanel' || (config.type === 'cpanel' && config.cpanelApiUrl)) {
        _config = { ...DEFAULT_CONFIG, ...config };

        // Validate cpanel API URL if type is cpanel
        if (_config.type === 'cpanel' && _config.cpanelApiUrl) {
          try {
            const url = new URL(_config.cpanelApiUrl);
            if (!['http:', 'https:'].includes(url.protocol)) {
              console.warn('[SafeLink] Invalid cpanel API URL protocol');
              _config.cpanelApiUrl = undefined;
            }
          } catch {
            console.warn('[SafeLink] Invalid cpanel API URL');
            _config.cpanelApiUrl = undefined;
          }
        }

        _adapter = createAdapter(_config);
        // Also save to localStorage so admin panel sees it
        saveConfig(_config);
        console.log('[SafeLink] DB config loaded from safelink-config.json →', config.type);
        return;
      }
    }
  } catch { /* silent */ }

  // 2. Fall back to localStorage (admin browser)
  const localConfig = loadConfig();
  if (localConfig.type && localConfig.type !== 'cpanel' || (localConfig.type === 'cpanel' && localConfig.cpanelApiUrl)) {
    _config = localConfig;
    _adapter = createAdapter(_config);
    console.log('[SafeLink] DB config loaded from localStorage →', localConfig.type);
    return;
  }

  console.log('[SafeLink] No database configured yet');
}

/**
 * Whether the database has been configured.
 */
export function isDbConfigured(): boolean {
  const c = _config;
  if (!c.type || c.type === 'cpanel') {
    return !!(c.cpanelApiUrl);
  }
  return true;
}

/**
 * List of all available database types with descriptions.
 */
export const DATABASE_OPTIONS: Array<{
  type: DatabaseType;
  name: string;
  description: string;
  free: string;
  setupUrl: string;
}> = [
  {
    type: 'supabase',
    name: 'Supabase',
    description: 'PostgreSQL database with real-time capabilities. Best free tier.',
    free: '500MB, 50K rows, unlimited API',
    setupUrl: 'https://supabase.com',
  },
  {
    type: 'jsonbin',
    name: 'JSONBin.io',
    description: 'Simple JSON storage API. No database setup needed.',
    free: '10K requests/month, 3 bins',
    setupUrl: 'https://jsonbin.io',
  },
  {
    type: 'firebase',
    name: 'Firebase Realtime DB',
    description: 'Google Cloud NoSQL database. REST API, no SDK required.',
    free: '1GB stored, 10GB/month download',
    setupUrl: 'https://console.firebase.google.com',
  },
  {
    type: 'cpanel',
    name: 'cPanel MySQL',
    description: 'MySQL database via PHP proxy on your cPanel hosting.',
    free: 'Free with cPanel hosting plan',
    setupUrl: '#cpanel',
  },
  {
    type: 'pockethost',
    name: 'PocketHost',
    description: 'PocketBase as a service. REST API, auto-hosted.',
    free: '3 projects, unlimited records',
    setupUrl: 'https://pockethost.io',
  },
  {
    type: 'restdb',
    name: 'Restdb.io',
    description: 'Simple REST database. No schema setup needed.',
    free: '1000 records, 25K requests/month',
    setupUrl: 'https://restdb.io',
  },
  {
    type: 'neon',
    name: 'Neon',
    description: 'Serverless Postgres by Neon. SQL over HTTP.',
    free: '0.5GB storage, 100 compute hrs/month',
    setupUrl: 'https://neon.tech',
  },
];