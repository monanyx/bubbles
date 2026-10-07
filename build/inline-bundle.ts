import type { Plugin } from 'vite';

/**
 * Inlines every emitted JS chunk and CSS asset into `index.html`, producing a
 * single self-contained file that works when opened straight from disk
 * (`file://`), just like the original one-file prototype did.
 *
 * Kept in-repo instead of pulling in a third-party plugin: it is ~40 lines and
 * avoids an extra transitive dependency tree for a build-only convenience.
 */
export function inlineBundle(): Plugin {
  return {
    name: 'aero-bubbles:inline-bundle',
    apply: 'build',
    enforce: 'post',
    config: () => ({
      build: {
        assetsInlineLimit: Number.MAX_SAFE_INTEGER,
        cssCodeSplit: false,
        modulePreload: false,
      },
    }),
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find(
        (file) => file.type === 'asset' && file.fileName.endsWith('.html'),
      );
      if (html?.type !== 'asset') return;

      let source = String(html.source);

      for (const [fileName, file] of Object.entries(bundle)) {
        const ref = new RegExp(`(?:\\./|/)?${escapeRegExp(fileName)}`);

        if (file.type === 'chunk' && fileName.endsWith('.js')) {
          const tag = new RegExp(`<script[^>]*src="${ref.source}"[^>]*></script>`);
          if (!tag.test(source)) continue;
          // `</script` inside the code would terminate the inline tag early.
          const code = file.code.replace(/<\/script/gi, '<\\/script');
          source = source.replace(tag, () => `<script type="module">${code}</script>`);
          delete bundle[fileName];
        } else if (file.type === 'asset' && fileName.endsWith('.css')) {
          const tag = new RegExp(`<link[^>]*href="${ref.source}"[^>]*>`);
          if (!tag.test(source)) continue;
          const css = String(file.source).replace(/<\/style/gi, '<\\/style');
          source = source.replace(tag, () => `<style>${css}</style>`);
          delete bundle[fileName];
        }
      }

      html.source = source;
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
