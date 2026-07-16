import { DatabaseAdapter, DatabaseConfig, ShortLinkData, SettingRow, ClickLogData } from './types';

/**
 * Restdb.io Adapter
 *
 * Uses Restdb.io REST API. Simple document-based storage.
 *
 * Collections:
 *   "settings"  -> [{ _id, key, value }]
 *   "short_links" -> [{ _id, code, url, clicks, created_at }]
 *   "click_logs"  -> [{ _id, code, url, device, browser, os, referrer, created_at }]
 *
 * Free tier: 1000 records total, 25K requests/month
 * Signup: https://restdb.io
 */

export class RestdbAdapter implements DatabaseAdapter {
  name = 'Restdb.io';
  private apiKey: string;
  private dbName: string;
  private baseUrl: string;

  constructor(config: DatabaseConfig) {
    this.apiKey = config.restdbApiKey || '';
    this.dbName = config.restdbDbName || '';
    this.baseUrl = `https://${this.dbName}.restdb.io/rest`;
  }

  private async request<T = any>(
    method: string,
    collection: string,
    query: string = '',
    body?: any
  ): Promise<T> {
    const url = `${this.baseUrl}/${collection}${query}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-apikey': this.apiKey,
      'cache-control': 'no-cache',
    };
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Restdb error ${res.status}: ${text}`);
    }
    if (res.status === 204) return null as T;
    return res.json();
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.apiKey || !this.dbName) {
      return { success: false, message: 'API Key and Database Name are required' };
    }
    try {
      // Try fetching settings - if collection doesn't exist it will error,
      // but we can still confirm the API key works by checking the error type
      await this.request('GET', 'settings', '?h={"$fields":1,"$limit":1}');
      return { success: true, message: 'Connected to Restdb.io successfully' };
    } catch (err: any) {
      const msg = String(err);
      // 404 means key works but collection doesn't exist yet - that's OK
      if (msg.includes('404')) {
        return { success: true, message: 'Connected (collections will be auto-created)' };
      }
      return { success: false, message: msg };
    }
  }

  async getAllSettings(): Promise<SettingRow[]> {
    try {
      const data = await this.request<any[]>('GET', 'settings');
      return (data || []).map((r) => ({ key: r.key, value: r.value }));
    } catch {
      return [];
    }
  }

  async getSetting(key: string): Promise<string | null> {
    try {
      const data = await this.request<any[]>('GET', 'settings', `?q={"key":"${key}"}`);
      if (Array.isArray(data) && data.length > 0) return data[0].value;
      return null;
    } catch { return null; }
  }

  async upsertSettings(kvs: SettingRow[]): Promise<{ success: boolean; error?: string }> {
    try {
      for (const { key, value } of kvs) {
        try {
          const existing = await this.request<any[]>('GET', 'settings', `?q={"key":"${key}"}`);
          if (Array.isArray(existing) && existing.length > 0) {
            const id = existing[0]._id;
            await this.request('PUT', `settings/${id}`, '', { key, value });
          } else {
            await this.request('POST', 'settings', '', { key, value });
          }
        } catch {
          await this.request('POST', 'settings', '', { key, value });
        }
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async getAllLinks(): Promise<ShortLinkData[]> {
    try {
      const data = await this.request<any[]>('GET', 'short_links', '?sort=-created_at');
      return (data || []).map((r) => ({
        id: r._id, code: r.code, url: r.url,
        clicks: r.clicks || 0, created_at: r.created_at,
      }));
    } catch { return []; }
  }

  async getLinkByCode(code: string): Promise<ShortLinkData | null> {
    try {
      const data = await this.request<any[]>('GET', 'short_links', `?q={"code":"${code}"}`);
      if (Array.isArray(data) && data.length > 0) {
        const r = data[0];
        return { id: r._id, code: r.code, url: r.url, clicks: r.clicks || 0, created_at: r.created_at };
      }
      return null;
    } catch { return null; }
  }

  async createLink(code: string, url: string): Promise<ShortLinkData> {
    const now = new Date().toISOString();
    const res = await this.request<any>('POST', 'short_links', '', {
      code, url, clicks: 0, created_at: now,
    });
    return { id: res._id || res.id, code: res.code, url: res.url, clicks: 0, created_at: res.created_at || now };
  }

  async createLinks(links: Array<{ code: string; url: string }>): Promise<ShortLinkData[]> {
    const results: ShortLinkData[] = [];
    for (const { code, url } of links) {
      const link = await this.createLink(code, url);
      results.push(link);
    }
    return results;
  }

  async incrementClicks(code: string): Promise<void> {
    const link = await this.getLinkByCode(code);
    if (link) {
      await this.request('PUT', `short_links/${link.id}`, '', {
        clicks: (link.clicks || 0) + 1,
      });
    }
  }

  async deleteLink(code: string): Promise<{ success: boolean; error?: string }> {
    try {
      const link = await this.getLinkByCode(code);
      if (link) {
        await this.request('DELETE', `short_links/${link.id}`);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async clearAllLinks(): Promise<{ success: boolean; error?: string }> {
    try {
      const links = await this.getAllLinks();
      for (const link of links) {
        await this.request('DELETE', `short_links/${link.id}`);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async isCodeUnique(code: string): Promise<boolean> {
    const link = await this.getLinkByCode(code);
    return !link;
  }

  async cleanupOldLinks(days: number): Promise<{ deleted: number }> {
    try {
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const oldLinks = await this.request<any[]>(
        'GET', 'short_links', `?q={"created_at":{"$lt":"${cutoff}"}}`
      );
      if (!Array.isArray(oldLinks) || oldLinks.length === 0) return { deleted: 0 };

      for (const link of oldLinks) {
        await this.request('DELETE', `short_links/${link._id}`);
      }
      return { deleted: oldLinks.length };
    } catch {
      return { deleted: 0 };
    }
  }

  async logClick(data: { code: string; url: string; device: string; browser: string; os: string; referrer: string }): Promise<void> {
    try {
      await this.request('POST', 'click_logs', '', {
        code: data.code,
        url: data.url,
        device: data.device,
        browser: data.browser,
        os: data.os,
        referrer: data.referrer,
        created_at: new Date().toISOString(),
      });
    } catch { /* fire-and-forget */ }
  }

  async getClickLogs(limit: number = 500): Promise<ClickLogData[]> {
    try {
      const data = await this.request<any[]>('GET', 'click_logs', `?sort=-created_at&h={"$limit":${limit}}`);
      return (data || []).map((r) => ({
        id: r._id || r.id, code: r.code, url: r.url,
        device: r.device || 'Unknown', browser: r.browser || 'Unknown',
        os: r.os || 'Unknown', referrer: r.referrer || '', created_at: r.created_at,
      }));
    } catch { return []; }
  }

  async clearClickLogs(): Promise<void> {
    try {
      await this.request('DELETE', 'click_logs');
    } catch { /* silent */ }
  }

  async cleanupOldClickLogs(days: number): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const oldLogs = await this.request<any[]>('GET', 'click_logs', `?q={"created_at":{"$lt":"${cutoff}"}}`);
      if (!Array.isArray(oldLogs)) return;
      for (const log of oldLogs) {
        await this.request('DELETE', `click_logs/${log._id}`);
      }
    } catch { /* silent */ }
  }
}