// GitHub Pages serves 404.html for unknown paths. Copying the SPA shell there makes deep links
// (e.g. /wayfarer-rescue/results) load the app instead of a blank 404. Harmless on other hosts.
import { copyFileSync, writeFileSync, existsSync } from 'node:fs';
if (existsSync('dist/index.html')) {
  copyFileSync('dist/index.html', 'dist/404.html');
  writeFileSync('dist/.nojekyll', '');
  console.log('postbuild: dist/404.html and dist/.nojekyll written');
}
