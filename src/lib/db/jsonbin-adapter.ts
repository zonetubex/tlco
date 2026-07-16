import { DatabaseAdapter, DatabaseConfig, ShortLinkData, SettingRow, ClickLogData } from './types';

/**
 * JSONBin.io Adapter
 *
 * Uses a single JSON bin with structure:
 * {
 *   "settings": { "admin_pin": "...", "redirect_time": "5", ... },
 *   "links": [ { "id": "...", "code": "abc", "url": "...", "clicks": 0, "created_at": "..." }, ... ]
 * }
 *
 * Free tier: 10,000 API requests/month, 3 bins max
 * Sign up at: https://jsonbin.io
 */

interface BinData {
  settings: Record<string, string>;
  links: ShortLinkData[];
  click_logs: ClickLogData[];
}

const DEFAULT_BIN_DATA: BinData = {
  settings: {},
  links: [],
  click_logs: [],
};

export class JsonBinAdapter implements DatabaseAdapter {
  name = 'JSONBin.io';
  private apiKey: string;
  private binId: string;
  private baseUrl = 'https://api.jsonbin.io/v3';

  constructor(config: DatabaseConfig) {
    this.apiKey = config.jsonbinApiKey || '';
    this.binId = config.jsonbinBinId || '';
  }

  private async readBin(): Promise<BinData> {
    if (!this.binId) {
      // Auto-create a new bin
      return this.createBin();
    }

    const res = await fetch(`${this.baseUrl}/b/${this.binId}/latest`, {
      headers: {
        'X-Master-Key': this.apiKey,
        'X-Bin-Meta': 'false',
      },
    });

    if (!res.ok) {
      if (res.status === 404) {
        // Bin not found, create new one
        return this.createBin();
      }
      throw new Error(`JSONBin read error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    // JSONBin wraps data, unwrap if needed
    if (data && typeof data === 'object' && 'record' in data) {
      return (data as any).record || DEFAULT_BIN_DATA;
    }
    if (data && typeof data === 'object' && 'settings' in data) {
      return data as BinData;
    }
    return DEFAULT_BIN_DATA;
  }

  private async createBin(): Promise<BinData> {
    const res = await fetch(`${this.baseUrl}/b`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': this.apiKey,
        'X-Bin-Private': 'true',
        'X-Bin-Name': 'safelink-data',
      },
      body: JSON.stringify(DEFAULT_BIN_DATA),
    });

    if (!res.ok) {
      throw new Error(`JSONBin create error: ${res.status} ${res.statusText}`);
    }

    const result = await res.json();
    this.binId = result.metadata?.id || result.id || '';
    // Persist the new bin ID
    this.saveBinId();
    return DEFAULT_BIN_DATA;
  }

  private async writeBin(data: BinData): Promise<void> {
    if (!this.binId) {
      await this.createBin();
    }

    const res = await fetch(`${this.baseUrl}/b/${this.binId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': this.apiKey,
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      throw new Error(`JSONBin write error: ${res.status} ${res.statusText}`);
    }
  }

  private saveBinId(): void {
    try {
      const stored = localStorage.getItem('safelink_db_config');
      if (stored) {
        const config = JSON.parse(stored);
        config.jsonbinBinId = this.binId;
        localStorage.setItem('safelink_db_config', JSON.stringify(config));
      }
    } catch { /* ignore */ }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.apiKey) return { success: false, message: 'API Key is required' };
    try {
      const data = await this.readBin();
      if (data && typeof data === 'object') {
        return { success: true, message: 'Connected to JSONBin.io successfully' };
      }
      return { success: false, message: 'Invalid bin data' };
    } catch (err) {
      return { success: false, message: String(err) };
    }
  }

  async getAllSettings(): Promise<SettingRow[]> {
    const bin = await this.readBin();
    return Object.entries(bin.settings || {}).map(([key, value]) => ({ key, value }));
  }

  async getSetting(key: string): Promise<string | null> {
    const bin = await this.readBin();
    return bin.settings?.[key] ?? null;
  }

  async upsertSettings(kvs: SettingRow[]): Promise<{ success: boolean; error?: string }> {
    try {
      const bin = await this.readBin();
      for (const { key, value } of kvs) {
        bin.settings[key] = value;
      }
      await this.writeBin(bin);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async getAllLinks(): Promise<ShortLinkData[]> {
    const bin = await this.readBin();
    return (bin.links || []).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  async getLinkByCode(code: string): Promise<ShortLinkData | null> {
    const bin = await this.readBin();
    return (bin.links || []).find((l) => l.code === code) || null;
  }

  async createLink(code: string, url: string): Promise<ShortLinkData> {
    const bin = await this.readBin();
    const newLink: ShortLinkData = {
      id: crypto.randomUUID(),
      code,
      url,
      clicks: 0,
      created_at: new Date().toISOString(),
    };
    bin.links.push(newLink);
    await this.writeBin(bin);
    return newLink;
  }

  async createLinks(links: Array<{ code: string; url: string }>): Promise<ShortLinkData[]> {
    const bin = await this.readBin();
    const newLinks: ShortLinkData[] = links.map((l) => ({
      id: crypto.randomUUID(),
      code: l.code,
      url: l.url,
      clicks: 0,
      created_at: new Date().toISOString(),
    }));
    bin.links.push(...newLinks);
    await this.writeBin(bin);
    return newLinks;
  }

  async incrementClicks(code: string): Promise<void> {
    const bin = await this.readBin();
    const link = (bin.links || []).find((l) => l.code === code);
    if (link) {
      link.clicks = (link.clicks || 0) + 1;
      await this.writeBin(bin);
    }
  }

  async deleteLink(code: string): Promise<{ success: boolean; error?: string }> {
    try {
      const bin = await this.readBin();
      bin.links = (bin.links || []).filter((l) => l.code !== code);
      await this.writeBin(bin);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async clearAllLinks(): Promise<{ success: boolean; error?: string }> {
    try {
      const bin = await this.readBin();
      bin.links = [];
      await this.writeBin(bin);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  async isCodeUnique(code: string): Promise<boolean> {
    const bin = await this.readBin();
    return !(bin.links || []).some((l) => l.code === code);
  }

  async cleanupOldLinks(days: number): Promise<{ deleted: number }> {
    try {
      const bin = await this.readBin();
      const cutoff = new Date(Date.now() - days * 86400000).getTime();
      const before = (bin.links || []).length;
      bin.links = (bin.links || []).filter(
        (l) => new Date(l.created_at).getTime() >= cutoff
      );
      const deleted = before - bin.links.length;
      if (deleted > 0) {
        await this.writeBin(bin);
      }
      return { deleted };
    } catch {
      return { deleted: 0 };
    }
  }

  async logClick(data: { code: string; url: string; device: string; browser: string; os: string; referrer: string }): Promise<void> {
    try {
      const bin = await this.readBin();
      if (!bin.click_logs) bin.click_logs = [];
      bin.click_logs.push({
        id: crypto.randomUUID(),
        code: data.code,
        url: data.url,
        device: data.device,
        browser: data.browser,
        os: data.os,
        referrer: data.referrer,
        created_at: new Date().toISOString(),
      });
      // Keep last 1000 logs max to avoid bin size limits
      if (bin.click_logs.length > 1000) {
        bin.click_logs = bin.click_logs.slice(-1000);
      }
      await this.writeBin(bin);
    } catch { /* fire-and-forget */ }
  }

  async getClickLogs(limit: number = 500): Promise<ClickLogData[]> {
    try {
      const bin = await this.readBin();
      return (bin.click_logs || []).slice(-limit).reverse();
    } catch { return []; }
  }

  async clearClickLogs(): Promise<void> {
    try {
      const bin = await this.readBin();
      bin.click_logs = [];
      await this.writeBin(bin);
    } catch { /* silent */ }
  }

  async cleanupOldClickLogs(days: number): Promise<void> {
    try {
      const bin = await this.readBin();
      const cutoff = new Date(Date.now() - days * 86400000).getTime();
      bin.click_logs = (bin.click_logs || []).filter(l => new Date(l.created_at).getTime() >= cutoff);
      await this.writeBin(bin);
    } catch { /* silent */ }
  }
}