/**
 * Phase 0 placeholder: proves the pipeline works in the browser by loading the core mod,
 * creating a game state from it, simulating one game day and showing the result.
 * The WebGL map replaces this page in Phase 1.
 */
import { formatDate, parseDay, tickToDate } from '../../engine/src/calendar.ts';
import { loadMods } from '../../engine/src/content/loader.ts';
import { CORE_SCHEMAS, type CountryDef, type Defines } from '../../engine/src/content/schemas.ts';
import { parseYaml } from '../../engine/src/content/yaml.ts';
import { hashState } from '../../engine/src/hash.ts';
import { advanceDays } from '../../engine/src/sim.ts';
import { createState } from '../../engine/src/state.ts';
import { coreModSource } from './content-files.ts';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function row(label: string, value: Node | string): Node[] {
  return [el('dt', { textContent: label }), el('dd', {}, [value])];
}

function render(): void {
  const app = document.getElementById('app');
  if (!app) return;

  const loadStart = performance.now();
  const content = loadMods([coreModSource()], parseYaml, CORE_SCHEMAS);
  const loadMs = performance.now() - loadStart;

  const countries = (content.collections.countries ?? []) as CountryDef[];
  const defines = content.defines as Defines;

  const children: Node[] = [
    el('h1', { textContent: 'WarRoom' }),
    el('p', { className: 'subtitle', textContent: 'Phase 0 — foundations. No gameplay yet.' }),
    el('p', {
      className: 'mobile-notice',
      textContent: 'WarRoom is designed for desktop browsers.',
    }),
  ];

  if (content.errors.length > 0) {
    children.push(
      el('section', { className: 'panel' }, [
        el('h2', { textContent: `${content.errors.length} content error(s)` }),
        el(
          'ul',
          { className: 'errors' },
          content.errors.map((e) =>
            el('li', {
              textContent: `${[e.mod, e.file, e.record].filter(Boolean).join(' › ')}: ${e.message}`,
            }),
          ),
        ),
      ]),
    );
  } else {
    const startDay = parseDay(defines.game.start_date);
    const state = createState({
      seed: defines.game.default_seed,
      startDay,
      countryTags: countries.map((c) => c.id),
      provinceCount: 0,
    });
    const simStart = performance.now();
    advanceDays(state, 1);
    const simMs = performance.now() - simStart;

    children.push(
      el('section', { className: 'panel' }, [
        el('h2', { textContent: 'Engine' }),
        el('dl', {}, [
          ...row('Game date', formatDate(tickToDate(state.tick, startDay))),
          ...row('Ticks simulated', String(state.tick)),
          ...row('State hash', el('code', { textContent: hashState(state) })),
          ...row('Content load', `${loadMs.toFixed(1)} ms`),
          ...row('One game day', `${simMs.toFixed(2)} ms`),
        ]),
      ]),
      el('section', { className: 'panel' }, [
        el('h2', {
          textContent: `Mods: ${content.mods.map((m) => `${m.name} ${m.version}`).join(', ')}`,
        }),
        el(
          'ul',
          { className: 'countries' },
          countries.map((c) => {
            const swatch = el('span', { className: 'swatch' });
            swatch.style.background = `rgb(${c.color.join(',')})`;
            return el('li', {}, [
              swatch,
              c.name,
              el('span', { className: 'tag', textContent: c.id }),
            ]);
          }),
        ),
      ]),
    );
  }

  app.replaceChildren(...children);
}

render();
