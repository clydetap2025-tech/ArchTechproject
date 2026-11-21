import { cp, mkdir, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
for (const path of ['index.html', 'brand.svg', 'css', 'js', 'demo']) {
  await cp(path, 'dist/' + path, { recursive: true });
}
if (process.env.POCKETBASE_URL) {
  const endpoint = new URL(process.env.POCKETBASE_URL);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('POCKETBASE_URL must be a public HTTPS URL without credentials.');
  }
  await writeFile('dist/js/account-config.js', 'export const accountServer = ' +
    JSON.stringify(endpoint.href.replace(/\/$/, '')) + ';\n');
}
