// First paint in the saved theme, before the app loads: dark unless Light (or
// Match system on a light OS) was chosen. A classic script so it blocks first
// paint, and a file (not inline) so the build's CSP (script-src 'self') allows
// it. Mirrors src/ui/theme.ts; theme.test.ts runs it against those rules.
try {
  var t = localStorage.getItem('office-immortal.theme');
  if (t === 'light' || (t === 'system' && !matchMedia('(prefers-color-scheme: dark)').matches))
    document.documentElement.dataset.theme = 'light';
} catch {
  // Blocked storage: stay dark.
}
