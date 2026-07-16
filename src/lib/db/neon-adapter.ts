import { DatabaseAdapter, DatabaseConfig, ShortLinkData, SettingRow, ClickLogData } from './types';

/**
 * Neon Adapter (Serverless Postgres via HTTP SQL API)
 *
 * Uses Neon's REST SQL endpoint to run raw SQL queries.
 * No ORM needed - pure SQL over HTTP.
 *
 * Free tier: 0.5GB storage, 100 compute hours/month
 * Signup: https://neon.tech
 *
 * Required SQL tables (run once via Neon console or SQL editor):
 *   CREATE TABLE settings (key VARCHAR(100) PRIMARY KEY, value TEXT);
 *   CREATE TABLE short_links (
 *     id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
 *     code VARCHAR(50) UNIQUE NOT NULL,
 *     url TEXT NOT NULL,
 *     clicks INT DEFAULT 0,
 *     created_at TIMESTAMPTZ DEFAULT NOW()
 *   );
 */

export class NeonAdapter implements DatabaseAdapter {
  name = 'Neon';
  private endpoint: string; // e.g., ep-cool-name-12345.us-east-2.aws.neon.tech
  private roleKey: string;  // Database role password for authentication

  constructor(config: DatabaseConfig) {
    this.endpoint = (config.neonEndpoint || '').replace(/\/+$/, '').replace(/^https?:\/\//, '');
    this.roleKey = config.neonRoleKey || '';
  }

  private async query<T = any>(sql: string): Promise<T> {
    const res = await fetch(`https://${this.endpoint}/sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.roleKey}`,
        'Neon-Connection-String': `postgresql://neondb_owner:${this.roleKey}@${this.endpoint}/neondb?sslmode=require`,
      },
      body: JSON.stringify({ query: sql }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Neon SQL error ${res.status}: ${text}`);
    }

    const data = await res.json();
    return data;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.endpoint || !this.roleKey) {
      return { success: false, message: 'Endpoint Hostname and Role Key are required' };
    }
    try {
      await this.query('SELECT 1 as test');
      return { success: true, message: 'Connected to Neon successfully' };
    } catch (err) {
      return { success: false, message: String(err) };
    }
  }

  async getAllSettings(): Promise<SettingRow[]> {
    const data = await this.query<{ rows: Array<{ key: string; value: string }> }>(
      "SELECT key, value FROM settings"
    );
    return data?.rows || [];
  }

  async getSetting(key: string): Promise<string | null> {
    const data = await this.query<{ rows: Array<{ value: string }> }>(
      `SELECT value FROM settings WHERE key = '${key.replace(/'/g, "''")}' LIMIT 1`
    );
    if (data?.rows?.length > 0) return data.rows[0].value;
    return null;
  }

  async upsertSettings(kvs: SettingRow[]): Promise<{ success: boolean; error?: string }> {
    try {
      const sqlParts = kvs.map(
        ({ key, value }) =>
          `('${key.replace(/'/g, "''")}', '${value.replace(/'/g, "''")}')`
      ).join(', ');
      await this.query(
        `INSERT INTO settings (key, value) VALUES ${sqlParts} ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async getAllLinks(): Promise<ShortLinkData[]> {
    const data = await this.query<{ rows: ShortLinkData[] }>(
      'SELECT id, code, url, clicks, created_at FROM short_links ORDER BY created_at DESC'
    );
    return (data?.rows || []).map((r) => ({
      ...r,
      created_at: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
    }));
  }

  async getLinkByCode(code: string): Promise<ShortLinkData | null> {
    const data = await this.query<{ rows: ShortLinkData[] }>(
      `SELECT id, code, url, clicks, created_at FROM short_links WHERE code = '${code.replace(/'/g, "''")}' LIMIT 1`
    );
    if (data?.rows?.length > 0) {
      const r = data.rows[0];
      return {
        ...r,
        created_at: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
      };
    }
    return null;
  }

  async createLink(code: string, url: string): Promise<ShortLinkData> {
    const data = await this.query<{ rows: ShortLinkData[] }>(
      `INSERT INTO short_links (code, url) VALUES ('${code.replace(/'/g, "''")}', '${url.replace(/'/g, "''")}') RETURNING id, code, url, clicks, created_at`
    );
    const r = data.rows[0];
    return {
      ...r,
      created_at: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
    };
  }

  async createLinks(links: Array<{ code: string; url: string }>): Promise<ShortLinkData[]> {
    if (links.length === 0) return [];
    const values = links
      .map((l) => `('${l.code.replace(/'/g, "''")}', '${l.url.replace(/'/g, "''")}')`)
      .join(', ');
    const data = await this.query<{ rows: ShortLinkData[] }>(
      `INSERT INTO short_links (code, url) VALUES ${values} RETURNING id, code, url, clicks, created_at`
    );
    return (data.rows || []).map((r) => ({
      ...r,
      created_at: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
    }));
  }

  async incrementClicks(code: string): Promise<void> {
    await this.query(
      `UPDATE short_links SET clicks = clicks + 1 WHERE code = '${code.replace(/'/g, "''")}'`
    );
  }

  async deleteLink(code: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.query(`DELETE FROM short_links WHERE code = '${code.replace(/'/g, "''")}'`);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async clearAllLinks(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.query('DELETE FROM short_links');
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async isCodeUnique(code: string): Promise<boolean> {
    const data = await this.query<{ rows: Array<{ count: number }> }>(
      `SELECT COUNT(*) as count FROM short_links WHERE code = '${code.replace(/'/g, "''")}'`
    );
    return (data?.rows?.[0]?.count ?? 0) === 0;
  }

  async cleanupOldLinks(days: number): Promise<{ deleted: number }> {
    try {
      const data = await this.query<{ rows: Array<{ count: number }> }>(
        `DELETE FROM short_links WHERE created_at < NOW() - INTERVAL '${Math.max(0, days)} days' RETURNING id`
      );
      return { deleted: data?.rows?.length ?? 0 };
    } catch {
      return { deleted: 0 };
    }
  }

  async logClick(data: { code: string; url: string; device: string; browser: string; os: string; referrer: string }): Promise<void> {
    try {
      const code = data.code.replace(/'/g, "''");
      const url = data.url.replace(/'/g, "''");
      const device = data.device.replace(/'/g, "''");
      const browser = data.browser.replace(/'/g, "''");
      const os = data.os.replace(/'/g, "''");
      const referrer = data.referrer.replace(/'/g, "''");
      await this.query(
        `INSERT INTO click_logs (code, url, device, browser, os, referrer) VALUES ('${code}', '${url}', '${device}', '${browser}', '${os}', '${referrer}')`
      );
    } catch { /* fire-and-forget */ }
  }

  async getClickLogs(limit: number = 500): Promise<ClickLogData[]> {
    try {
      const data = await this.query<{ rows: any[] }>(
        `SELECT id, code, url, device, browser, os, referrer, created_at FROM click_logs ORDER BY created_at DESC LIMIT ${Math.max(1, limit)}`
      );
      return (data?.rows || []).map((r) => ({
        ...r,
        created_at: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
      }));
    } catch { return []; }
  }

  async clearClickLogs(): Promise<void> {
    try {
      await this.query('DELETE FROM click_logs');
    } catch { /* silent */ }
  }

  async cleanupOldClickLogs(days: number): Promise<void> {
    try {
      await this.query(`DELETE FROM click_logs WHERE created_at < NOW() - INTERVAL '${Math.max(0, days)} days'`);
    } catch { /* silent */ }
  }
}