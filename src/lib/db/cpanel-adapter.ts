import { DatabaseAdapter, DatabaseConfig, ShortLinkData, SettingRow, ClickLogData } from './types';

/**
 * cPanel MySQL Adapter
 *
 * Communicates with a PHP proxy file hosted on cPanel.
 * The PHP file handles all MySQL operations and returns JSON responses.
 *
 * Required: Upload cpanel-api.php to your cPanel public_html directory
 * Required: Create MySQL database and import cpanel-database.sql
 *
 * This is effectively free if you already have cPanel hosting.
 */

interface CpanelResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export class CpanelAdapter implements DatabaseAdapter {
  name = 'cPanel MySQL';
  private apiUrl: string;

  constructor(config: DatabaseConfig) {
    this.apiUrl = (config.cpanelApiUrl || '').replace(/\/+$/, '');
  }

  private async request<T = any>(action: string, body?: Record<string, any>): Promise<CpanelResponse<T>> {
    const res = await fetch(`${this.apiUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    });

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
    }

    try {
      return await res.json();
    } catch {
      return { success: false, error: 'Invalid JSON response from server' };
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.apiUrl) return { success: false, message: 'API URL is required' };
    try {
      const res = await this.request('ping');
      if (res.success) {
        return { success: true, message: 'Connected to cPanel MySQL successfully' };
      }
      return { success: false, message: res.error || 'Connection failed' };
    } catch (err) {
      return { success: false, message: String(err) };
    }
  }

  async getAllSettings(): Promise<SettingRow[]> {
    const res = await this.request<SettingRow[]>('get_settings');
    if (!res.success || !res.data) return [];
    return res.data;
  }

  async getSetting(key: string): Promise<string | null> {
    const res = await this.request<string>('get_setting', { key });
    if (!res.success || !res.data) return null;
    return res.data;
  }

  async upsertSettings(kvs: SettingRow[]): Promise<{ success: boolean; error?: string }> {
    const res = await this.request('upsert_settings', { settings: kvs });
    return { success: !!res.success, error: res.error };
  }

  async getAllLinks(): Promise<ShortLinkData[]> {
    const res = await this.request<ShortLinkData[]>('get_links');
    if (!res.success || !res.data) return [];
    return res.data;
  }

  async getLinkByCode(code: string): Promise<ShortLinkData | null> {
    const res = await this.request<ShortLinkData>('get_link', { code });
    if (!res.success || !res.data) return null;
    return res.data;
  }

  async createLink(code: string, url: string): Promise<ShortLinkData> {
    const res = await this.request<ShortLinkData>('create_link', { code, url });
    if (!res.success || !res.data) throw new Error(res.error || 'Failed to create link');
    return res.data;
  }

  async createLinks(links: Array<{ code: string; url: string }>): Promise<ShortLinkData[]> {
    const res = await this.request<ShortLinkData[]>('create_links', { links });
    if (!res.success || !res.data) throw new Error(res.error || 'Failed to create links');
    return res.data;
  }

  async incrementClicks(code: string): Promise<void> {
    await this.request('increment_clicks', { code });
  }

  async deleteLink(code: string): Promise<{ success: boolean; error?: string }> {
    const res = await this.request('delete_link', { code });
    return { success: !!res.success, error: res.error };
  }

  async clearAllLinks(): Promise<{ success: boolean; error?: string }> {
    const res = await this.request('clear_all_links');
    return { success: !!res.success, error: res.error };
  }

  async isCodeUnique(code: string): Promise<boolean> {
    const res = await this.request<boolean>('is_code_unique', { code });
    return !!res.data;
  }

  async cleanupOldLinks(days: number): Promise<{ deleted: number }> {
    try {
      const res = await this.request<{ deleted: number }>('cleanup', { days });
      return { deleted: res.data?.deleted ?? 0 };
    } catch {
      return { deleted: 0 };
    }
  }

  async logClick(data: { code: string; url: string; device: string; browser: string; os: string; referrer: string }): Promise<void> {
    try {
      await this.request('log_click', {
        click: {
          id: crypto.randomUUID(),
          code: data.code,
          url: data.url,
          device: data.device,
          browser: data.browser,
          os: data.os,
          referrer: data.referrer,
          created_at: new Date().toISOString(),
        },
      });
    } catch { /* fire-and-forget */ }
  }

  async getClickLogs(limit: number = 500): Promise<ClickLogData[]> {
    try {
      const res = await this.request<ClickLogData[]>('get_click_logs', { limit });
      return res.data || [];
    } catch { return []; }
  }

  async clearClickLogs(): Promise<void> {
    try {
      await this.request('clear_click_logs');
    } catch { /* silent */ }
  }

  async cleanupOldClickLogs(days: number): Promise<void> {
    try {
      await this.request('cleanup_click_logs', { days });
    } catch { /* silent */ }
  }
}