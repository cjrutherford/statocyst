import { Injectable, signal } from '@angular/core';
import type { JellyfinQuickConnectInit, JellyfinResult, JellyfinServerView, JellyfinSyncSummary } from '@statocyst/contracts';
import { bridge } from './bridge';
import { ToastStore } from './toast.store';

@Injectable({ providedIn: 'root' })
export class JellyfinStore {
  readonly servers = signal<JellyfinServerView[]>([]);
  readonly busy = signal(false);
  readonly encryptionAvailable = signal(true);
  readonly loaded = signal(false);

  constructor(private readonly toasts: ToastStore) {}

  async init(): Promise<void> {
    try {
      const [servers, available] = await Promise.all([
        bridge().jellyfin.listServers(),
        bridge().jellyfin.encryptionAvailable(),
      ]);
      this.servers.set(servers);
      this.encryptionAvailable.set(available);
    } catch (error) {
      this.toasts.error('Could not load servers', String(error));
    } finally {
      this.loaded.set(true);
    }
  }

  async addServer(url: string): Promise<JellyfinResult<JellyfinServerView>> {
    return this.run(async () => {
      const result = await bridge().jellyfin.addServer(url);
      if (result.ok) this.toasts.success('Server connected', result.value.name);
      else this.toasts.error('Could not add server', result.error.message);
      await this.refresh();
      return result;
    });
  }

  async login(url: string, username: string, password: string): Promise<JellyfinResult<JellyfinServerView>> {
    return this.run(async () => {
      const result = await bridge().jellyfin.login(url, username, password);
      if (result.ok) this.toasts.success('Signed in', `Connected as ${result.value.userName}`);
      else this.toasts.error('Sign-in failed', result.error.message);
      await this.refresh();
      return result;
    });
  }

  async logout(serverId: string): Promise<void> {
    await this.run(async () => {
      await bridge().jellyfin.logout(serverId);
      this.toasts.push('Signed out');
      await this.refresh();
    });
  }

  async removeServer(serverId: string): Promise<void> {
    await this.run(async () => {
      await bridge().jellyfin.removeServer(serverId);
      this.toasts.push('Server removed');
      await this.refresh();
    });
  }

  async sync(serverId: string): Promise<JellyfinResult<JellyfinSyncSummary>> {
    return this.run(async () => {
      const result = await bridge().jellyfin.sync(serverId);
      if (result.ok) {
        this.toasts.success(
          'Library synced',
          `${result.value.imported} new · ${result.value.updated} updated`,
        );
      } else {
        this.toasts.error('Sync failed', result.error.message);
      }
      return result;
    });
  }

  async initiateQuickConnect(url: string): Promise<JellyfinResult<JellyfinQuickConnectInit>> {
    return bridge().jellyfin.initiateQuickConnect(url);
  }

  async pollQuickConnect(url: string, secret: string): Promise<JellyfinResult<{ authenticated: boolean }>> {
    return bridge().jellyfin.pollQuickConnect(url, secret);
  }

  async loginWithQuickConnect(url: string, secret: string): Promise<JellyfinResult<JellyfinServerView>> {
    return this.run(async () => {
      const result = await bridge().jellyfin.loginWithQuickConnect(url, secret);
      if (result.ok) this.toasts.success('Signed in', `Connected as ${result.value.userName}`);
      else this.toasts.error('Sign-in failed', result.error.message);
      await this.refresh();
      return result;
    });
  }

  private async refresh(): Promise<void> {
    try {
      this.servers.set(await bridge().jellyfin.listServers());
    } catch (error) {
      this.toasts.error('Could not refresh servers', String(error));
    }
  }

  private async run<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy()) {
      throw new Error('Another operation is already in progress');
    }
    this.busy.set(true);
    try {
      return await action();
    } finally {
      this.busy.set(false);
    }
  }
}
