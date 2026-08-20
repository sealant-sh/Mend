/** Mend: the slice of t3code's lib/utils the vendored terminal modules use. */
export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}
