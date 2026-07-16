import { DatabaseAdapter, DatabaseConfig, ShortLinkData, SettingRow, ClickLogData } from './types';

/**
 * PocketHost Adapter (PocketBase as a Service)
 *
 * Uses PocketBase REST API hosted on pockethost.io.
 * Data structure mirrors PocketBase collections:
 *   Collection "settings": { key, value }
 *   Collection "short_links": { code, url, clicks, created_at }
 *
 * Free tier: 3 projects, unlimited records
 * Signup: https://pockethost.io
 */

export class PocketHostAdapter implements DatabaseAdapter {
  name = 'PocketHost';
  private url: string;
  private email: string;
  private password: string;
  private token: string | null = null;

  constructor(config: DatabaseConfig) {
    this.url = (config.pockethostUrl || '').replace(/\/+$/, '');
    this.email = config.pockethostEmail || '';
    this.password = config.pockethostPassword || '';
  }

  private async ensureAuth(): Promise<string> {
    if (this.token) return this.token;
    const res = await fetch(`${this.url}/api/collections/_superusers/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: this.email, password: this.password }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`PocketHost auth failed: ${err}`);
    }
    const data = await res.json();
    this.token = data.token;
    return this.token!;
  }

  private async request<T = any>(
    method: string,
    collection: string,
    path: string = '',
    body?: any
  ): Promise<T> {
    const token = await this.ensureAuth();
    const url = `${this.url}/api/collections/${collection}/records${path ? '/' + path : ''}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': token,
    };
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PocketHost error ${res.status}: ${text}`);
    }
    if (res.status === 204) return null as T;
    return res.json();
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.url || !this.email || !this.password) {
      return { success: false, message: 'URL, Email, and Password are required' };
    }
    try {
      await this.ensureAuth();
      return { success: true, message: 'Connected to PocketHost successfully' };
    } catch (err) {
      return { success: false, message: String(err) };
    }
  }

  async getAllSettings(): Promise<SettingRow[]> {
    const res = await this.request<{ items: any[] }>('GET', 'settings');
    return (res?.items || []).map((r) => ({ key: r.key, value: r.value }));
  }

  async getSetting(key: string): Promise<string | null> {
    try {
      const res = await this.request<any>('GET', 'settings', `?filter=(key='${encodeURIComponent(key)}')`);
      if (res?.items?.length > 0) return res.items[0].value;
      return null;
    } catch {
      return null;
    }
  }

  async upsertSettings(kvs: SettingRow[]): Promise<{ success: boolean; error?: string }> {
    try {
      for (const { key, value } of kvs) {
        // Check if exists
        try {
          const existing = await this.request<any>('GET', 'settings', `?filter=(key='${encodeURIComponent(key)}')`);
          if (existing?.items?.length > 0) {
            const id = existing.items[0].id;
            await this.request('PATCH', 'settings', id, { key, value });
          } else {
            await this.request('POST', 'settings', '', { key, value });
          }
        } catch {
          // Try creating directly
          await this.request('POST', 'settings', '', { key, value });
        }
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async getAllLinks(): Promise<ShortLinkData[]> {
    const res = await this.request<{ items: any[] }>('GET', 'short_links', '?sort=-created_at');
    return (res?.items || []).map((r) => ({
      id: r.id, code: r.code, url: r.url,
      clicks: r.clicks || 0, created_at: r.created_at,
    }));
  }

  async getLinkByCode(code: string): Promise<ShortLinkData | null> {
    try {
      const res = await this.request<any>('GET', 'short_links', `?filter=(code='${encodeURIComponent(code)}')`);
      if (res?.items?.length > 0) {
        const r = res.items[0];
        return { id: r.id, code: r.code, url: r.url, clicks: r.clicks || 0, created_at: r.created_at };
      }
      return null;
    } catch { return null; }
  }

  async createLink(code: string, url: string): Promise<ShortLinkData> {
    const res = await this.request<any>('POST', 'short_links', '', {
      code, url, clicks: 0,
    });
    return { id: res.id, code: res.code, url: res.url, clicks: res.clicks || 0, created_at: res.created_at };
  }

  async createLinks(links: Array<{ code: string; url: string }>): Promise<ShortLinkData[]> {
    const results: ShortLinkData[] = [];
    for (const { code, url } of links) {
      const res = await this.request<any>('POST', 'short_links', '', { code, url, clicks: 0 });
      results.push({ id: res.id, code: res.code, url: res.url, clicks: res.clicks || 0, created_at: res.created_at });
    }
    return results;
  }

  async incrementClicks(code: string): Promise<void> {
    const link = await this.getLinkByCode(code);
    if (link) {
      await this.request('PATCH', 'short_links', link.id, { clicks: (link.clicks || 0) + 1 });
    }
  }

  async deleteLink(code: string): Promise<{ success: boolean; error?: string }> {
    try {
      const link = await this.getLinkByCode(code);
      if (link) {
        await this.request('DELETE', 'short_links', link.id);
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
        await this.request('DELETE', 'short_links', link.id);
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
      const res = await this.request<{ items: any[]}>(
        'GET', 'short_links', `?filter=created_at<'${cutoff}'`
      );
      const toDelete = res?.items || [];
      for (const item of toDelete) {
        await this.request('DELETE', 'short_links', item.id);
      }
      return { deleted: toDelete.length };
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
      });
    } catch { /* fire-and-forget */ }
  }

  async getClickLogs(limit: number = 500): Promise<ClickLogData[]> {
    try {
      const res = await this.request<{ items: any[] }>('GET', 'click_logs', `?sort=-created_at&per_page=${limit}`);
      return (res?.items || []).map((r) => ({
        id: r.id, code: r.code, url: r.url,
        device: r.device || 'Unknown', browser: r.browser || 'Unknown',
        os: r.os || 'Unknown', referrer: r.referrer || '', created_at: r.created_at,
      }));
    } catch { return []; }
  }

  async clearClickLogs(): Promise<void> {
    try {
      const logs = await this.getClickLogs(500);
      for (const log of logs) {
        await this.request('DELETE', 'click_logs', log.id);
      }
    } catch { /* silent */ }
  }

  async cleanupOldClickLogs(days: number): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const res = await this.request<{ items: any[] }>('GET', 'click_logs', `?filter=created_at<'${cutoff}'`);
      for (const item of (res?.items || [])) {
        await this.request('DELETE', 'click_logs', item.id);
      }
    } catch { /* silent */ }
  }
}