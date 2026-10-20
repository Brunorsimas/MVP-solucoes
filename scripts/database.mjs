import { connectPostgres } from '../lib/postgres-store.mjs';
import { passwordCredentials } from '../lib/shared-api.mjs';
import { requireThat } from '../public/domain.js';
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';

const command = process.argv[2];
requireThat(['init', 'specialist'].includes(command), 'Use npm run db:init ou npm run db:specialist -- bruno.');
const database = await connectPostgres(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
try {
  if (command === 'init') console.log('Banco inicializado. Nenhuma senha temporária pública foi habilitada.');
  else {
    const id = process.argv[3];
    requireThat(['tayane', 'miguel', 'feuzer', 'marcos', 'maria', 'bruno', 'stefanny', 'kleber'].includes(id), 'Informe um login da equipe, como bruno ou tayane.');
    const input = createInterface({ input: process.stdin, output: process.stdout });
    let email;
    try { email = (await input.question(`E-mail de acesso de ${id}: `)).trim().toLowerCase(); }
    finally { input.close(); }
    requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length < 255, 'Informe um e-mail válido.');
    const password = randomBytes(18).toString('base64url');
    await database.store.provision(id, email, passwordCredentials(password));
    console.log(`Acesso criado/atualizado. Login: ${id}\nSenha individual: ${password}\nEntregue esta senha somente ao titular. Executar novamente substitui a senha e encerra as sessões anteriores.`);
  }
} finally { await database.close(); }
