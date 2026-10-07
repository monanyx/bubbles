import { centralBubble } from '../model/map';
import type { MindMap } from '../model/types';

/** Saves a blob through a temporary download link. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Opens the system file picker; resolves with the chosen file's text, or null. */
export function pickTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) return resolve(null);
        file.text().then(
          (text) => resolve({ name: file.name, text }),
          () => resolve(null),
        );
      },
      { once: true },
    );
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    document.body.append(input);
    input.click();
  });
}

/** A filename derived from the map's central idea, e.g. `big-idea.json`. */
export function suggestFilename(map: MindMap, extension: string): string {
  const topic = centralBubble(map)?.text ?? '';
  const slug = topic
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return `${slug || 'mind-map'}.${extension}`;
}
