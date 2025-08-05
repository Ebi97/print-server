// server.js
const express = require('express');
const cors    = require('cors');
const { Pool } = require('pg');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// conexão PostgreSQL via ENV
const pool = new Pool({
  host:     process.env.PGHOST,
  port:     process.env.PGPORT,
  user:     process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
});

// cria extensão e tabela
async function initDb() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pdf_base64    TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      tries         INT  NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      numero_pedido TEXT UNIQUE
    );
  `);
  console.log('✅ Tabela jobs pronta');
}

// healthcheck
app.get('/health', (_, res) => res.status(200).json({ status: 'ok' }));

// enfileira, ignorando duplicados e sempre retornando o mesmo ID
app.post('/print', async (req, res) => {
  const { pdfbase64, numeroPedido } = req.body;
  if (!pdfbase64)    return res.status(400).json({ erro: 'pdfbase64 é obrigatório' });

  try {
    let sql, params;
    if (numeroPedido) {
      sql = `
        INSERT INTO jobs (numero_pedido, pdf_base64)
        VALUES ($1, $2)
        ON CONFLICT (numero_pedido) DO NOTHING
        RETURNING id;
      `;
      params = [numeroPedido, pdfbase64];
    } else {
      sql = `
        INSERT INTO jobs (pdf_base64)
        VALUES ($1)
        RETURNING id;
      `;
      params = [pdfbase64];
    }

    const result = await pool.query(sql, params);

    if (result.rowCount === 0 && numeroPedido) {
      // Pedido já existe! Busque o ID atual e retorne
      const existing = await pool.query(
        `SELECT id FROM jobs WHERE numero_pedido = $1`, [numeroPedido]
      );
      const id = existing.rows.length ? existing.rows[0].id : null;
      console.log(`⚠ Pedido ${numeroPedido} já estava na fila, ignorei.`);
      return res.json({ mensagem: 'Já estava na fila.', numeroPedido, id });
    }

    const id = result.rows[0].id;
    console.log(`✅ Pedido adicionado na fila (id=${id})${numeroPedido ? ' (numeroPedido='+numeroPedido+')' : ''}.`);
    return res.json({ mensagem: 'Pedido adicionado na fila.', id, numeroPedido: numeroPedido || null });

  } catch (err) {
    console.error('❌ Erro ao inserir no banco:', err);
    return res.status(500).json({ erro: 'Erro interno.' });
  }
});

// lista apenas os pending
app.get('/fila', async (_, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, numero_pedido AS "numeroPedido", pdf_base64 AS "pdfbase64"
      FROM jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error('❌ Erro ao buscar fila:', err.message);
    res.status(500).json({ erro: 'Erro interno.' });
  }
});

// rota de lock atômico: marca processing e retorna um único job
app.post('/lock', async (req, res) => {
  const { id } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE jobs
      SET status = 'processing'
      WHERE id = $1 AND status = 'pending'
      RETURNING id, pdf_base64 AS pdfbase64
    `, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'job não disponível ou já processado' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Erro no lock:', err.message);
    res.status(500).json({ erro: 'Erro interno.' });
  }
});

// marca sucesso (done)
app.post('/remover', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ erro: 'ID obrigatório.' });
  try {
    await pool.query(`UPDATE jobs SET status = 'done' WHERE id = $1`, [id]);
    console.log(`🗑 Pedido ${id} marcado como done.`);
    res.json({ mensagem: 'Pedido removido.' });
  } catch (err) {
    console.error('❌ Erro ao deletar pedido:', err.message);
    res.status(500).json({ erro: 'Erro interno.' });
  }
});

// rota opcional de fail (incrementa tentativas)
app.post('/fail', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ erro: 'ID obrigatório.' });
  try {
    await pool.query(`
      UPDATE jobs
      SET status = 'failed', tries = tries + 1
      WHERE id = $1
    `, [id]);
    console.log(`⚠ Pedido ${id} marcado como failed.`);
    res.send();
  } catch (err) {
    console.error('❌ Erro ao marcar fail:', err.message);
    res.status(500).json({ erro: 'Erro interno.' });
  }
});

// init + start
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 API rodando em http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ falha na inicialização do banco:', err);
    process.exit(1);
  });
