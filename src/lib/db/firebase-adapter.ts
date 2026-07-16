import { DatabaseAdapter, DatabaseConfig, ShortLinkData, SettingRow, ClickLogData } from './types';

/**
 * Firebase Realtime Database Adapter
 *
 * Uses Firebase REST API (no SDK needed).
 * Data structure:
 *   /settings/{key} = "value"
 *   /links/{code} = { id, code, url, clicks, created_at }
 *
 * Free Spark plan: 1 GB stored, 10 GB/month download
 * Setup: https://console.firebase.google.com
 */

export class FirebaseAdapter implements DatabaseAdapter {
  name = 'Firebase';
  private baseUrl: string;
  private secret?: string;

  constructor(config: DatabaseConfig) {
    // Ensure URL ends without trailing slash
    this.baseUrl = (config.firebaseUrl || '').replace(/\/+$/, '');
    this.secret = config.firebaseSecret || undefined;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.secret) {
      headers['auth'] = this.secret;
    }
    return headers;
  }

  private async fetchJson(path: string, options?: RequestInit): Promise<any> {
    const url = `${this.baseUrl}/${path}.json`;
    const res = await fetch(url, {
      ...options,
      headers: { ...this.getHeaders(), ...(options?.headers as Record<string, string>) },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Firebase error ${res.status}: ${text || res.statusText}`);
    }
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.baseUrl) return { success: false, message: 'Database URL is required' };
    try {
      // Try reading settings - .json will return null if empty, which is fine
      await this.fetchJson('settings');
      return { success: true, message: 'Connected to Firebase successfully' };
    } catch (err) {
      return { success: false, message: String(err) };
    }
  }

  async getAllSettings(): Promise<SettingRow[]> {
    const data = await this.fetchJson('settings');
    if (!data || typeof data !== 'object') return [];
    return Object.entries(data as Record<string, string>).map(([key, value]) => ({
      key,
      value: String(value),
    }));
  }

  async getSetting(key: string): Promise<string | null> {
    const data = await this.fetchJson(`settings/${encodeURIComponent(key)}`);
    if (data === null || data === undefined) return null;
    return String(data);
  }

  async upsertSettings(kvs: SettingRow[]): Promise<{ success: boolean; error?: string }> {
    try {
      // Update each setting individually using PATCH
      const updates: Record<string, string> = {};
      for (const { key, value } of kvs) {
        updates[key] = value;
      }
      await this.fetchJson('settings', {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async getAllLinks(): Promise<ShortLinkData[]> {
    const data = await this.fetchJson('links');
    if (!data || typeof data !== 'object') return [];
    const links = Object.values(data) as ShortLinkData[];
    return links.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  async getLinkByCode(code: string): Promise<ShortLinkData | null> {
    const data = await this.fetchJson(`links/${encodeURIComponent(code)}`);
    if (!data) return null;
    return data as ShortLinkData;
  }

  async createLink(code: string, url: string): Promise<ShortLinkData> {
    const newLink: ShortLinkData = {
      id: crypto.randomUUID(),
      code,
      url,
      clicks: 0,
      created_at: new Date().toISOString(),
    };
    await this.fetchJson(`links/${encodeURIComponent(code)}`, {
      method: 'PUT',
      body: JSON.stringify(newLink),
    });
    return newLink;
  }

  async createLinks(links: Array<{ code: string; url: string }>): Promise<ShortLinkData[]> {
    const newLinks: ShortLinkData[] = links.map((l) => ({
      id: crypto.randomUUID(),
      code: l.code,
      url: l.url,
      clicks: 0,
      created_at: new Date().toISOString(),
    }));

    // Create each link individually
    for (const link of newLinks) {
      await this.fetchJson(`links/${encodeURIComponent(link.code)}`, {
        method: 'PUT',
        body: JSON.stringify(link),
      });
    }
    return newLinks;
  }

  async incrementClicks(code: string): Promise<void> {
    // Firebase REST API doesn't support atomic increments directly.
    // We read, increment, then write. For low-concurrency scenarios this is fine.
    const link = await this.getLinkByCode(code);
    if (link) {
      await this.fetchJson(`links/${encodeURIComponent(code)}/clicks`, {
        method: 'PUT',
        body: JSON.stringify((link.clicks || 0) + 1),
      });
    }
  }

  async deleteLink(code: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.fetchJson(`links/${encodeURIComponent(code)}`, { method: 'DELETE' });
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async clearAllLinks(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.fetchJson('links', { method: 'DELETE' });
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async isCodeUnique(code: string): Promise<boolean> {
    const data = await this.fetchJson(`links/${encodeURIComponent(code)}`);
    return data === null;
  }

  async cleanupOldLinks(days: number): Promise<{ deleted: number }> {
    try {
      const cutoff = new Date(Date.now() - days * 86400000).getTime();
      const data = await this.fetchJson('links');
      if (!data || typeof data !== 'object') return { deleted: 0 };

      const toDelete: string[] = [];
      for (const [code, link] of Object.entries(data as Record<string, any>)) {
        if (new Date((link as ShortLinkData).created_at).getTime() < cutoff) {
          toDelete.push(code);
        }
      }

      for (const code of toDelete) {
        await this.fetchJson(`links/${encodeURIComponent(code)}`, { method: 'DELETE' });
      }
      return { deleted: toDelete.length };
    } catch {
      return { deleted: 0 };
    }
  }

  async logClick(data: { code: string; url: string; device: string; browser: string; os: string; referrer: string }): Promise<void> {
    try {
      const logId = crypto.randomUUID();
      await this.fetchJson(`click_logs/${logId}`, {
        method: 'PUT',
        body: JSON.stringify({
          id: logId,
          code: data.code,
          url: data.url,
          device: data.device,
          browser: data.browser,
          os: data.os,
          referrer: data.referrer,
          created_at: new Date().toISOString(),
        }),
      });
    } catch { /* fire-and-forget */ }
  }

  async getClickLogs(limit: number = 500): Promise<ClickLogData[]> {
    try {
      const data = await this.fetchJson('click_logs');
      if (!data || typeof data !== 'object') return [];
      const logs = Object.values(data) as ClickLogData[];
      return logs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, limit);
    } catch { return []; }
  }

  async clearClickLogs(): Promise<void> {
    try {
      await this.fetchJson('click_logs', { method: 'DELETE' });
    } catch { /* silent */ }
  }

  async cleanupOldClickLogs(days: number): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - days * 86400000).getTime();
      const data = await this.fetchJson('click_logs');
      if (!data || typeof data !== 'object') return;
      for (const [id, log] of Object.entries(data as Record<string, any>)) {
        if (new Date((log as ClickLogData).created_at).getTime() < cutoff) {
          await this.fetchJson(`click_logs/${id}`, { method: 'DELETE' });
        }
      }
    } catch { /* silent */ }
  }
}