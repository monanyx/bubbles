const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short, URL-safe random id such as `n_k3x9q2m1`. */
export function createId(prefix: string, length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let id = `${prefix}_`;
  for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length];
  return id;
}

export const nodeId = (): string => createId('n');
export const linkId = (): string => createId('l');
