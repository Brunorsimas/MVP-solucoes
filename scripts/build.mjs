import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTORS } from '../public/domain.js';
import { build } from 'esbuild';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const neon = !process.argv.includes('--static') && !!(process.env.NEON_AUTH_BASE_URL && process.env.NEON_FUNCTION_HELLO_BASE_URL);
const shared = process.argv.includes('--shared') || neon;
const publicConfig = neon ? { authUrl: process.env.NEON_AUTH_BASE_URL, apiUrl: process.env.NEON_FUNCTION_HELLO_BASE_URL } : {};
for (const value of Object.values(publicConfig)) { if (new URL(value).protocol !== 'https:') throw Error('Neon public URLs must use HTTPS.'); }
const output = resolve(root, 'dist');
await mkdir(output, { recursive: true });
await cp(resolve(root, 'public'), output, { recursive: true });
await build({ entryPoints: [resolve(root, 'public/app.js')], outfile: resolve(output, 'app.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, define: { __NEON_PUBLIC_CONFIG__: JSON.stringify(publicConfig) } });
const original = await readFile(resolve(root, 'public/index.html'), 'utf8');
const home = original.replace('<html lang="pt-BR">', `<html lang="pt-BR" data-mode="${shared ? 'shared' : 'static'}">`).replace('<base href="/">', '<base href="./">');
await writeFile(resolve(output, 'index.html'), home);
await writeFile(resolve(output, '.nojekyll'), '');
await writeFile(resolve(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
const origin = process.env.SITE_URL?.replace(/\/$/, '');
const urls = [];
for (const [id, s] of Object.entries(SECTORS)) {
  const path = resolve(output, 'servicos', id); await mkdir(path, { recursive: true });
  const canonical = origin ? `<link rel="canonical" href="${origin}/servicos/${id}/">` : '';
  const html = home.replace('<base href="./">', '<base href="../../">')
    .replace('<title>MVP Soluções — Pessoas certas. Soluções de verdade.</title>', `<title>${s.name} em Pernambuco e Belém–PA | MVP Soluções</title>`)
    .replace('</head>', `${canonical}</head>`)
    .replace(/<main class="boot"[\s\S]*?<\/main>/, `<main class="boot" id="main"><h1>${s.name} em Pernambuco e Belém–PA</h1><p>${s.description}</p><ul>${s.services.map(service => `<li>${service}</li>`).join('')}</ul><p>Atendimento conforme disponibilidade. Chamados das 8h às 19h, horário de Brasília. Demonstração sem atendimento real.</p><a href="./#/novo?setor=${id}">Solicitar atendimento</a></main>`);
  await writeFile(resolve(path, 'index.html'), html);
  if (origin) urls.push(`${origin}/servicos/${id}/`);
}
if (origin) {
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[\w.-]+)*$/i.test(origin)) throw new Error('SITE_URL deve ser uma URL HTTPS válida sem query.');
  await writeFile(resolve(output, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[origin + '/', ...urls].map(url => `<url><loc>${url}</loc></url>`).join('')}</urlset>`);
}
console.log(neon ? 'Build Neon gerado em dist/. Auth e API conectados por URLs públicas; segredos não são incluídos.' : shared ? 'Piloto compartilhado gerado em dist/. Requer API e DATABASE_URL no Netlify.' : 'Demonstração estática gerada em dist/. Dados ficam somente no navegador. Indexação bloqueada durante o MVP.');
