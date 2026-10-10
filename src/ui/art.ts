// The shipped art (src/assets/art, made by tools/art/build.py), as URLs Vite
// serves from this site: self-hosted, as the page's security policy requires.

const URLS = import.meta.glob<string>('../assets/art/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** The URL of art file `name` (no extension), or '' when there is none. */
export function artUrl(name: string): string {
  return URLS[`../assets/art/${name}.png`] ?? '';
}
