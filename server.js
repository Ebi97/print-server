// server.js
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middlewares ---
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// --- Conexão PostgreSQL via ENV ---
const pool = new Pool({
  host:     process.env.PGHOST     || 'postgres',
  port:     process.env.PGPORT     || 5432,
  user:     process.env.PGUSER     || 'postgres',
  password: process.env.PGPASSWORD || '',
  database: process.env.PGDATABASE || 'postgres',
});

// --- Inicialização do banco ---
async function initDb() {
  // Garante a extensão para uuid
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`).catch(() => {});
  // Cria tabela jobs se não existir
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pdf_data    TEXT NOT NULL,
      printer     TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',
      tries       INT  NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log('✅ Tabela jobs pronta');
}

// --- Endpoints ---

// Health check
app.get('/health', (_, res) => {
  res.status(200).json({ status: 'ok' });
});

// Enfileirar um PDF
app.post('/print', async (req, res) => {
  const { pdfbase64, printer } = req.body;
  if (!pdfbase64) {
    return res.status(400).json({ error: 'pdfbase64 é obrigatório' });
  }
  const id = crypto.randomUUID();
  try {
    await pool.query(
      `INSERT INTO jobs(id, pdf_data, printer) VALUES($1, $2, $3)`,
      [id, pdfbase64, printer || null]
    );
    console.log(`✅ Job enfileirado: ${id}`);
    return res.json({ id });
  } catch (err) {
    console.error('❌ Erro ao inserir job:', err.message);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// Marcar job como concluído
app.post('/done', async (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'ID obrigatório.' });
  }
  try {
    await pool.query(
      `UPDATE jobs SET status = 'done' WHERE id = $1`,
      [id]
    );
    console.log(`🆗 Job marcado como done: ${id}`);
    return res.send();
  } catch (err) {
    console.error('❌ Erro ao marcar done:', err.message);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// Marcar job como falhado e incrementar tentativas
app.post('/fail', async (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'ID obrigatório.' });
  }
  try {
    await pool.query(
      `UPDATE jobs
         SET status = 'failed',
             tries  = tries + 1
       WHERE id = $1`,
      [id]
    );
    console.log(`⚠ Job marcado como failed: ${id}`);
    return res.send();
  } catch (err) {
    console.error('❌ Erro ao marcar fail:', err.message);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// Listar todos os jobs (debug)
app.get('/fila', async (_, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id,
        pdf_data    AS "pdfbase64",
        printer,
        status,
        tries,
        created_at
      FROM jobs
      ORDER BY created_at
    `);
    return res.json(rows);
  } catch (err) {
    console.error('❌ Erro ao buscar fila:', err.message);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// --- Start ---
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 print-server rodando em http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ Falha na inicialização do banco:', err);
    process.exit(1);
  });
