/** Resolve a path under public/ against the deployment base (e.g. "/wayfarer-rescue/" on GitHub Pages). */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}
