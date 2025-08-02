// server.js
const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// --- configurações do PostgreSQL via ENV ---
const pool = new Pool({
  host:     process.env.PGHOST     || 'postgres',
  port:     process.env.PGPORT     || 5432,
  user:     process.env.PGUSER     || 'postgres',
  password: process.env.PGPASSWORD || '',
  database: process.env.PGDATABASE || 'postgres',
});

// --- inicialização: cria tabela se não existir ---
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id          UUID PRIMARY KEY,
      pdf_data    TEXT       NOT NULL,
      printer     TEXT,
      status      TEXT       NOT NULL DEFAULT 'pending',  -- pending, processing, done, failed
      tries       INT        NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log('✅ Tabela jobs pronta');
}

// --- rota para enfileirar um novo job ---
app.post('/print', async (req, res) => {
  const { pdfbase64, printer } = req.body;
  if (!pdfbase64) {
    return res.status(400).json({ error: 'pdfbase64 é obrigatório' });
  }
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO jobs(id, pdf_data, printer) VALUES($1, $2, $3)`,
    [id, pdfbase64, printer || null]
  );
  res.json({ id });
});

// --- rota para listar apenas os pending ---
app.get('/fila', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, pdf_data, printer 
     FROM jobs 
     WHERE status = 'pending' 
     ORDER BY created_at ASC`
  );
  res.json(rows);
});

// --- rota para dar lock (atômico) e marcar como processing ---
app.post('/lock', async (req, res) => {
  const { id } = req.body;
  const result = await pool.query(
    `UPDATE jobs 
     SET status = 'processing' 
     WHERE id = $1 AND status = 'pending' 
     RETURNING id, pdf_data AS pdfbase64, printer`,
    [id]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'job não disponível ou já processado' });
  }
  res.json(result.rows[0]);
});

// --- rota para marcar sucesso e não retornar mais na fila ---
app.post('/remover', async (req, res) => {
  const { id } = req.body;
  await pool.query(
    `UPDATE jobs SET status = 'done' WHERE id = $1`,
    [id]
  );
  res.send();
});

// --- rota opcional para marcar falha e incrementar tentativas ---
app.post('/fail', async (req, res) => {
  const { id } = req.body;
  await pool.query(
    `UPDATE jobs 
     SET status = 'failed', tries = tries + 1 
     WHERE id = $1`,
    [id]
  );
  res.send();
});

// --- inicializa DB e sobe servidor ---
initDb()
  .then(() => {
    app.listen(3000, () => {
      console.log('🚀 print-server rodando em http://localhost:3000');
    });
  })
  .catch(err => {
    console.error('❌ falha na inicialização do banco:', err);
    process.exit(1);
  });
