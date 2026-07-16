import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DatabaseAdapter, DatabaseConfig, ShortLinkData, SettingRow, ClickLogData } from './types';

export class SupabaseAdapter implements DatabaseAdapter {
  name = 'Supabase';
  private client: SupabaseClient;

  constructor(config: DatabaseConfig) {
    this.client = createClient(
      config.supabaseUrl || '',
      config.supabaseAnonKey || ''
    );
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const { error } = await this.client.from('settings').select('key').limit(1);
      if (error) return { success: false, message: error.message };
      return { success: true, message: 'Connected to Supabase successfully' };
    } catch (err) {
      return { success: false, message: String(err) };
    }
  }

  async getAllSettings(): Promise<SettingRow[]> {
    const { data } = await this.client.from('settings').select('*');
    return (data as SettingRow[]) || [];
  }

  async getSetting(key: string): Promise<string | null> {
    const { data } = await this.client
      .from('settings')
      .select('value')
      .eq('key', key)
      .single();
    return data?.value || null;
  }

  async upsertSettings(kvs: SettingRow[]): Promise<{ success: boolean; error?: string }> {
    const { error } = await this.client
      .from('settings')
      .upsert(kvs, { onConflict: 'key' });
    return { success: !error, error: error?.message };
  }

  async getAllLinks(): Promise<ShortLinkData[]> {
    const { data, error } = await this.client
      .from('short_links')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as ShortLinkData[]) || [];
  }

  async getLinkByCode(code: string): Promise<ShortLinkData | null> {
    const { data, error } = await this.client
      .from('short_links')
      .select('*')
      .eq('code', code)
      .single();
    if (error) return null;
    return data as ShortLinkData;
  }

  async createLink(code: string, url: string): Promise<ShortLinkData> {
    const { data, error } = await this.client
      .from('short_links')
      .insert({ code, url })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as ShortLinkData;
  }

  async createLinks(links: Array<{ code: string; url: string }>): Promise<ShortLinkData[]> {
    const { data, error } = await this.client
      .from('short_links')
      .insert(links)
      .select();
    if (error) throw new Error(error.message);
    return (data as ShortLinkData[]) || [];
  }

  async incrementClicks(code: string): Promise<void> {
    const { data: current } = await this.client
      .from('short_links')
      .select('clicks')
      .eq('code', code)
      .single();
    if (current) {
      await this.client
        .from('short_links')
        .update({ clicks: (current.clicks || 0) + 1 })
        .eq('code', code);
    }
  }

  async deleteLink(code: string): Promise<{ success: boolean; error?: string }> {
    const { error } = await this.client
      .from('short_links')
      .delete()
      .eq('code', code);
    return { success: !error, error: error?.message };
  }

  async clearAllLinks(): Promise<{ success: boolean; error?: string }> {
    const { error } = await this.client
      .from('short_links')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    return { success: !error, error: error?.message };
  }

  async isCodeUnique(code: string): Promise<boolean> {
    const { data } = await this.client
      .from('short_links')
      .select('id')
      .eq('code', code)
      .single();
    return !data;
  }

  async cleanupOldLinks(days: number): Promise<{ deleted: number }> {
    try {
      const cutoffDate = new Date(Date.now() - days * 86400000).toISOString();
      const { error, count } = await this.client
        .from('short_links')
        .delete({ count: 'exact' })
        .lt('created_at', cutoffDate);
      if (error) return { deleted: 0 };
      return { deleted: count ?? 0 };
    } catch {
      return { deleted: 0 };
    }
  }

  async logClick(data: Omit<ClickLogData, 'id' | 'created_at'>): Promise<ClickLogData> {
    const { data: row, error } = await this.client
      .from('click_logs')
      .insert(data)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row as ClickLogData;
  }

  async getClickLogs(limit = 500): Promise<ClickLogData[]> {
    const { data, error } = await this.client
      .from('click_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data as ClickLogData[]) || [];
  }

  async clearClickLogs(): Promise<{ success: boolean; error?: string }> {
    const { error } = await this.client
      .from('click_logs')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    return { success: !error, error: error?.message };
  }

  async cleanupOldClickLogs(days: number): Promise<{ deleted: number }> {
    try {
      const cutoffDate = new Date(Date.now() - days * 86400000).toISOString();
      const { error, count } = await this.client
        .from('click_logs')
        .delete({ count: 'exact' })
        .lt('created_at', cutoffDate);
      if (error) return { deleted: 0 };
      return { deleted: count ?? 0 };
    } catch {
      return { deleted: 0 };
    }
  }
}