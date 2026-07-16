// ─── Database Types & Adapter Interface ──────────────────────────────

export interface ShortLinkData {
  id: string;
  code: string;
  url: string;
  clicks: number;
  created_at: string;
}

export interface ClickLogData {
  id: string;
  code: string;
  url: string;
  device: string;   // Mobile, Desktop, Tablet
  browser: string;  // Chrome, Firefox, Safari, Opera, Edge, Other
  os: string;       // Windows, Android, iOS, macOS, Linux, Other
  referrer: string;
  created_at: string;
}

export interface SettingRow {
  key: string;
  value: string;
}

export interface DatabaseAdapter {
  /** Human-readable name for display */
  name: string;

  /** Test the database connection */
  testConnection(): Promise<{ success: boolean; message: string }>;

  // ─── Settings ──────────────────────────────────────────────────────
  /** Fetch all settings as key-value pairs */
  getAllSettings(): Promise<SettingRow[]>;
  /** Fetch a single setting value by key */
  getSetting(key: string): Promise<string | null>;
  /** Insert or update multiple settings */
  upsertSettings(kvs: SettingRow[]): Promise<{ success: boolean; error?: string }>;

  // ─── Links ─────────────────────────────────────────────────────────
  /** Fetch all short links, ordered newest first */
  getAllLinks(): Promise<ShortLinkData[]>;
  /** Fetch a single link by its short code */
  getLinkByCode(code: string): Promise<ShortLinkData | null>;
  /** Create a single short link, returns the created link */
  createLink(code: string, url: string): Promise<ShortLinkData>;
  /** Create multiple short links at once */
  createLinks(links: Array<{ code: string; url: string }>): Promise<ShortLinkData[]>;
  /** Atomically increment click count for a link */
  incrementClicks(code: string): Promise<void>;
  /** Delete a link by its code */
  deleteLink(code: string): Promise<{ success: boolean; error?: string }>;
  /** Delete all links */
  clearAllLinks(): Promise<{ success: boolean; error?: string }>;
  /** Check if a code is not yet used */
  isCodeUnique(code: string): Promise<boolean>;
  /** Delete links older than N days */
  cleanupOldLinks(days: number): Promise<{ deleted: number }>;

  // ─── Click Logs ─────────────────────────────────────────────────
  /** Log a click with device/browser info (fire-and-forget, never throws) */
  logClick(data: { code: string; url: string; device: string; browser: string; os: string; referrer: string }): Promise<void>;
  /** Get all click logs (for admin stats) */
  getClickLogs(limit?: number): Promise<ClickLogData[]>;
  /** Clear all click logs */
  clearClickLogs(): Promise<void>;
  /** Cleanup click logs older than N days */
  cleanupOldClickLogs(days: number): Promise<void>;
}

// ─── Database Configuration ──────────────────────────────────────────

export type DatabaseType = 'supabase' | 'jsonbin' | 'firebase' | 'cpanel' | 'pockethost' | 'restdb' | 'neon';

export interface DatabaseConfig {
  type: DatabaseType;

  // Supabase
  supabaseUrl?: string;
  supabaseAnonKey?: string;

  // JSONBin.io
  jsonbinApiKey?: string;
  jsonbinBinId?: string;

  // Firebase Realtime Database
  firebaseUrl?: string;
  firebaseSecret?: string; // optional, for auth

  // cPanel MySQL (via PHP proxy)
  cpanelApiUrl?: string;

  // PocketHost (PocketBase)
  pockethostUrl?: string;
  pockethostEmail?: string;
  pockethostPassword?: string;

  // Restdb.io
  restdbApiKey?: string;
  restdbDbName?: string;

  // Neon (Serverless Postgres)
  neonEndpoint?: string;  // e.g., ep-name-12345.us-east-2.aws.neon.tech
  neonRoleKey?: string;   // Role password for auth
}