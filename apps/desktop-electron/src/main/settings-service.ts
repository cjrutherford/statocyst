import type { Settings, ThemePreference, DensityPreference } from '@statocyst/contracts';
import type { StatocystDatabase } from '@statocyst/persistence';
import type { Logger } from './logger';

const SETTINGS_KEY = 'settings';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  density: 'comfortable',
  volume: 0.85,
  muted: false,
};

const THEMES: readonly ThemePreference[] = ['system', 'dark', 'light'];
const DENSITIES: readonly DensityPreference[] = ['comfortable', 'compact'];

function isUnit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export class SettingsService {
  private settings: Settings = { ...DEFAULT_SETTINGS };

  constructor(
    private readonly database: StatocystDatabase,
    private readonly logger: Logger,
  ) {}

  async init(): Promise<void> {
    const raw = await this.database.getAppState(SETTINGS_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      this.settings = this.validate(parsed);
    } catch (error) {
      this.logger.warn('settings.corrupt', { error });
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  get(): Settings {
    return { ...this.settings };
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const next = this.validate({ ...this.settings, ...patch });
    this.settings = next;
    await this.database.setAppState(SETTINGS_KEY, JSON.stringify(next));
    return this.get();
  }

  private validate(input: Partial<Settings>): Settings {
    return {
      theme: THEMES.includes(input.theme as ThemePreference)
        ? (input.theme as ThemePreference)
        : DEFAULT_SETTINGS.theme,
      density: DENSITIES.includes(input.density as DensityPreference)
        ? (input.density as DensityPreference)
        : DEFAULT_SETTINGS.density,
      volume: isUnit(input.volume) ? input.volume : DEFAULT_SETTINGS.volume,
      muted: typeof input.muted === 'boolean' ? input.muted : DEFAULT_SETTINGS.muted,
    };
  }
}
