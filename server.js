const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;


// Configurações
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Fila em memória
const fila = [];

/**
 * Endpoint para adicionar pedido na fila
 * Espera receber:
 * {
 *   pdfbase64: '...',
 *   numeroPedido: '12345', // ou outro identificador único
 *   outros_campos...
 * }
 */
app.post('/print', (req, res) => {
    const { pdfbase64, numeroPedido } = req.body;

    if (!pdfbase64) {
        return res.status(400).json({ erro: "PDF não enviado." });
    }

    if (!numeroPedido) {
        // Se não vier identificador, cria um novo id interno
        const id = uuidv4();
        fila.push({ id, pdfbase64, data: req.body });
        console.log(`✅ Pedido sem numeroPedido, adicionado com id interno: ${id}`);
        return res.json({ mensagem: "Pedido adicionado na fila.", id });
    }

    // Verifica se já tem na fila (proteção)
    const jaTem = fila.find(p => p.numeroPedido === numeroPedido);
    if (jaTem) {
        console.log(`⚠ Pedido ${numeroPedido} já está na fila, ignorado.`);
        return res.json({ mensagem: "Pedido já estava na fila.", numeroPedido });
    }

    // Adiciona normalmente
    const id = uuidv4();
    fila.push({ id, numeroPedido, pdfbase64, data: req.body });
    console.log(`✅ Pedido ${numeroPedido} adicionado na fila.`);
    return res.json({ mensagem: "Pedido adicionado na fila.", id, numeroPedido });
});

/**
 * Endpoint para consultar a fila
 */
app.get('/fila', (req, res) => {
    res.json(fila);
});

/**
 * Endpoint para remover um pedido da fila
 * Espera: { id: '...' }
 */
app.post('/remover', (req, res) => {
    const { id } = req.body;
    const index = fila.findIndex(p => p.id === id);
    if (index !== -1) {
        fila.splice(index, 1);
        console.log(`🗑 Pedido removido da fila: ${id}`);
        return res.json({ mensagem: "Pedido removido da fila." });
    } else {
        console.log(`⚠ Pedido não encontrado para remover: ${id}`);
        return res.status(404).json({ erro: "Pedido não encontrado." });
    }
});


app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));
app.listen(PORT, () => {
    console.log(`🚀 API rodando em http://localhost:${PORT}`);
});
