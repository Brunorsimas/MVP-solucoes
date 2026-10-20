import { connectPostgres } from '../lib/postgres-store.mjs';
import { requireThat } from '../public/domain.js';
const [professional, subject] = process.argv.slice(2);
requireThat(professional && subject, 'Use npm run db:neon-specialist -- bruno ID-DA-CONTA-NEON. A conta deve ter e-mail verificado.');
const database = await connectPostgres(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
try { await database.store.linkNeonSpecialist(subject, professional); console.log('Identidade verificada vinculada ao especialista. O login utiliza o e-mail e a senha cadastrados no Neon Auth.'); }
finally { await database.close(); }
