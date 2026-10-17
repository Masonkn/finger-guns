// Packs the Vite build into one self-contained HTML body for sharing as a Claude artifact.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [, , distDir, outFile] = process.argv;
const html = readFileSync(join(distDir, 'index.html'), 'utf8');
const assets = readdirSync(join(distDir, 'assets'));
const css = assets.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(distDir, 'assets', f), 'utf8')).join('\n');
const js = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(distDir, 'assets', f), 'utf8')).join('\n');
if (/<\/script/i.test(js)) throw new Error('bundle contains a closing script tag');

const fonts = html.match(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/)?.[0] ?? '';
const body = html.split(/<body>/)[1].split(/<\/body>/)[0].replace(/<script[^>]*src=[^>]*><\/script>/g, '');

const out = `<title>Finger Guns</title>
${fonts}
<style>
:root { color-scheme: dark; }
${css}
</style>
${body}
<script type="module">
${js}
</script>
`;
writeFileSync(outFile, out);
console.log(`wrote ${outFile} (${(out.length / 1024).toFixed(0)} KB)`);
