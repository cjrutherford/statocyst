import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '..');

async function launch(dataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ['.', '--no-sandbox', '--disable-gpu', '--ozone-platform=headless', '--headless=new'],
    cwd: root,
    env: {
      ...process.env,
      STATOCYST_DATA_DIR: dataDir,
      STATOCYST_LOG_CONSOLE: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('sc-root .app', { timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('.boot'), undefined, {
    timeout: 30_000,
  });
  return { app, page };
}

interface AuditViolation {
  rule: string;
  detail: string;
}

/** Runs a dependency-free accessibility audit inside the renderer. */
async function audit(page: Page): Promise<AuditViolation[]> {
  return page.evaluate(() => {
    const violations: Array<{ rule: string; detail: string }> = [];

    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        Number(style.opacity) > 0
      );
    };

    const textName = (element: Element): string => {
      const aria = element.getAttribute('aria-label');
      if (aria && aria.trim()) return aria.trim();
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        return labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
      }
      if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
        if (element.id) {
          const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
          if (label?.textContent?.trim()) return label.textContent.trim();
        }
        const wrapping = element.closest('label');
        if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();
        const placeholder = element.getAttribute('placeholder');
        if (placeholder?.trim()) return placeholder.trim();
      }
      return (element as HTMLElement).innerText?.trim() ?? '';
    };

    // 1. Every interactive control needs an accessible name.
    const controls = document.querySelectorAll(
      'button, a[href], input, select, textarea, [role="button"], [role="radio"]',
    );
    for (const control of controls) {
      if (!isVisible(control)) continue;
      if (!textName(control)) {
        violations.push({
          rule: 'control-name',
          detail: `${control.tagName.toLowerCase()} has no accessible name`,
        });
      }
    }

    // 2. Images must be decorative (alt="") or described.
    for (const image of document.querySelectorAll('img')) {
      if (!image.hasAttribute('alt')) {
        violations.push({ rule: 'image-alt', detail: image.getAttribute('src') ?? 'unknown image' });
      }
    }

    // 3. Landmarks and a top-level heading.
    if (!document.querySelector('main#main-content')) {
      violations.push({ rule: 'landmark-main', detail: 'No main landmark' });
    }
    if (!document.querySelector('nav[aria-label]')) {
      violations.push({ rule: 'landmark-nav', detail: 'Navigation has no accessible label' });
    }
    const visibleH1 = Array.from(document.querySelectorAll('h1')).filter(isVisible);
    if (visibleH1.length === 0) {
      violations.push({ rule: 'heading-h1', detail: 'No visible h1' });
    }

    // 4. No positive tabindex and no duplicate ids.
    for (const element of document.querySelectorAll('[tabindex]')) {
      const value = Number(element.getAttribute('tabindex'));
      if (value > 0) {
        violations.push({
          rule: 'tabindex',
          detail: `${element.tagName.toLowerCase()} uses tabindex="${value}"`,
        });
      }
    }
    const ids = new Set<string>();
    for (const element of document.querySelectorAll('[id]')) {
      const id = element.id;
      if (ids.has(id)) violations.push({ rule: 'duplicate-id', detail: id });
      ids.add(id);
    }

    // 5. Text contrast against the nearest opaque background.
    const parse = (color: string): [number, number, number, number] => {
      const match = color.match(/rgba?\(([^)]+)\)/);
      if (!match) return [0, 0, 0, 1];
      const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [parts[0], parts[1], parts[2], parts[3] ?? 1];
    };
    const blend = (
      top: [number, number, number, number],
      bottom: [number, number, number, number],
    ): [number, number, number, number] => {
      const alpha = top[3] + bottom[3] * (1 - top[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        (top[0] * top[3] + bottom[0] * bottom[3] * (1 - top[3])) / alpha,
        (top[1] * top[3] + bottom[1] * bottom[3] * (1 - top[3])) / alpha,
        (top[2] * top[3] + bottom[2] * bottom[3] * (1 - top[3])) / alpha,
        alpha,
      ];
    };
    const background = (element: Element): [number, number, number, number] => {
      let current: Element | null = element;
      let color: [number, number, number, number] = [3, 7, 16, 1];
      const layers: Array<[number, number, number, number]> = [];
      while (current) {
        const style = getComputedStyle(current);
        const parsed = parse(style.backgroundColor);
        if (parsed[3] > 0) layers.push(parsed);
        if (parsed[3] >= 1) break;
        current = current.parentElement;
      }
      for (let index = layers.length - 1; index >= 0; index -= 1) {
        color = blend(layers[index], color);
      }
      return color;
    };
    const luminance = (rgb: [number, number, number, number]): number => {
      const channel = (value: number): number => {
        const normalized = value / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    };
    const ratio = (a: number, b: number): number => {
      const lighter = Math.max(a, b);
      const darker = Math.min(a, b);
      return (lighter + 0.05) / (darker + 0.05);
    };

    const samples = document.querySelectorAll(
      'h1, h2, p, span, dt, dd, button, a, label, .lede, .card__hint',
    );
    for (const sample of samples) {
      if (!isVisible(sample)) continue;
      // Skip elements whose only content is decorative children.
      const directText = Array.from(sample.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join('')
        .trim();
      if (!directText) continue;
      const style = getComputedStyle(sample);
      if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      // Gradient/background-image surfaces cannot be reduced to one colour;
      // skip them rather than report a guess.
      if (style.backgroundImage && style.backgroundImage !== 'none') continue;
      const fontSize = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      const large = fontSize >= 24 || (fontSize >= 18.66 && bold);
      const foreground = parse(style.color);
      const backgroundRgb = background(sample);
      const contrast = ratio(luminance(foreground), luminance(backgroundRgb));
      const required = large ? 3 : 4.5;
      if (contrast + 0.01 < required) {
        violations.push({
          rule: 'contrast',
          detail: `${sample.tagName.toLowerCase()}${sample.className ? `.${String(sample.className).split(' ').join('.')}` : ''} "${directText.slice(0, 40)}" is ${contrast.toFixed(2)}:1 (needs ${required}:1)`,
        });
      }
    }

    return violations;
  });
}

test.describe('accessibility', () => {
  let app: ElectronApplication;
  let page: Page;
  let dataDir: string;

  const VIEWS = ['Library', 'Now playing', 'Queue', 'Settings'] as const;

  async function visit(view: (typeof VIEWS)[number]): Promise<void> {
    if (view === 'Now playing') {
      await page.getByRole('button', { name: /Open now playing/i }).click();
    } else {
      await page.getByRole('button', { name: view, exact: true }).click();
    }
    const heading = view === 'Now playing' ? 'The deep channel' : view;
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  }

  test.beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'statocyst-a11y-'));
    const launched = await launch(dataDir);
    app = launched.app;
    page = launched.page;
    // Drive the real UI path so the store refreshes after the import.
    await page.getByRole('button', { name: /Load demo library/i }).click();
    await page.waitForSelector('.track-row', { timeout: 30_000 });
  });

  test.afterAll(async () => {
    await app?.close().catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('has no automated accessibility violations in dark mode', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-resolved-theme', 'dark');
    for (const view of VIEWS) {
      await visit(view);
      const violations = await audit(page);
      expect(violations, `${view}: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
    }
  });

  test('has no automated accessibility violations in light mode', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('radio', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-resolved-theme', 'light');
    for (const view of VIEWS) {
      await visit(view);
      const violations = await audit(page);
      expect(violations, `${view}: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
    }
    await page.getByRole('radio', { name: 'System' }).click();
  });

  test('skip link is the first tab stop and moves focus to main', async () => {
    const firstFocusable = await page.evaluate(() => {
      const candidate = document.querySelector(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      return candidate?.getAttribute('href') ?? candidate?.textContent?.trim() ?? null;
    });
    expect(firstFocusable).toBe('#main-content');
    await page.locator('.skip-link').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });

  test('phone layout meets the 44px touch-target minimum on every view', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const view of VIEWS) {
      await visit(view);
      const undersized = await page.evaluate(() => {
        const problems: string[] = [];
        for (const element of document.querySelectorAll('button, a[href], select, input')) {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          if (rect.width === 0 || rect.height === 0) continue;
          if (style.visibility === 'hidden' || style.display === 'none') continue;
          let box = rect;
          // A native checkbox/radio keeps its 20px glyph; the clickable target is
          // the wrapping label, so measure that instead.
          if (
            element instanceof HTMLInputElement &&
            (element.type === 'checkbox' || element.type === 'radio')
          ) {
            const label = element.closest('label');
            if (label) box = label.getBoundingClientRect();
          }
          // Round before comparing: a 44px CSS box can measure 43.99 due to
          // device pixel scaling.
          const width = Math.round(box.width);
          const height = Math.round(box.height);
          if (height < 44 || width < 44) {
            const label =
              element.getAttribute('aria-label') ??
              element.closest('label')?.textContent?.trim() ??
              (element as HTMLElement).innerText?.trim() ??
              '';
            problems.push(
              `${element.tagName.toLowerCase()} "${label.slice(0, 30)}" ${width}×${height}`,
            );
          }
        }
        return problems;
      });
      expect(undersized, `${view}: ${undersized.join('\n')}`).toEqual([]);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
  });
});
