import { isBotEnabled, toggleBot, getBotConfig, updateBotConfig, env } from './config.js';
import { getConversations as getMemoryConversations } from './chatbot.js';
import { getConversations, getMessages, searchConversations } from './database.js';

/**
 * Retorna HTML do painel de controle
 */
export function getPanelHTML() {
  const enabled = isBotEnabled();
  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Painel do Bot</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, sans-serif; background: #0a0a0a; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #1a1a2e; border-radius: 16px; padding: 40px; width: 90%; max-width: 400px; text-align: center; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
    h1 { font-size: 24px; margin-bottom: 8px; }
    .subtitle { color: #888; margin-bottom: 30px; }
    .status { font-size: 16px; margin-bottom: 24px; padding: 12px; border-radius: 8px; }
    .status.on { background: rgba(34,197,94,0.15); color: #22c55e; }
    .status.off { background: rgba(239,68,68,0.15); color: #ef4444; }
    .toggle-btn { width: 100%; padding: 16px; border: none; border-radius: 12px; font-size: 18px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
    .toggle-btn.on { background: #ef4444; color: #fff; }
    .toggle-btn.on:hover { background: #dc2626; }
    .toggle-btn.off { background: #22c55e; color: #fff; }
    .toggle-btn.off:hover { background: #16a34a; }
    .info { margin-top: 20px; color: #666; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🤖 WhatsApp Bot</h1>
    <p class="subtitle">Controle rápido</p>
    <div class="status ${enabled ? 'on' : 'off'}" id="status">
      ${enabled ? '✅ Bot ATIVADO' : '❌ Bot DESATIVADO'}
    </div>
    <button class="toggle-btn ${enabled ? 'on' : 'off'}" onclick="toggle()">
      ${enabled ? 'Desativar Bot' : 'Ativar Bot'}
    </button>
    <p class="info">WhatsApp: ${env.INSTANCE_NAME}</p>
  </div>
  <script>
    async function toggle() {
      const base = window.location.pathname.split('/').slice(0, -1).join('/') || '';
      const resp = await fetch(base + '/api/toggle', { method: 'POST' });
      const data = await resp.json();
      location.reload();
    }
  </script>
</body>
</html>`;
}

/**
 * Registra rotas do painel no Express
 */
export function registerPanelRoutes(app) {
  // Painel principal
  app.get('/', (req, res) => {
    res.send(getPanelHTML());
  });

  // Toggle on/off
  app.post('/api/toggle', (req, res) => {
    const enabled = toggleBot();
    res.json({ enabled });
  });

  // Status
  app.get('/api/status', (req, res) => {
    res.json({ enabled: isBotEnabled() });
  });

  // Config
  app.get('/api/config', (req, res) => {
    res.json(getBotConfig());
  });

  app.post('/api/config', (req, res) => {
    updateBotConfig(req.body);
    res.json({ success: true });
  });

  // Conversas em memória (bot)
  app.get('/api/conversations', (req, res) => {
    res.json(getMemoryConversations());
  });

  // ======= ROTAS DO DASHBOARD (Supabase) =======

  // Lista conversas do banco
  app.get('/api/dashboard/conversations', async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
      const result = await getConversations(page, limit);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Busca conversas
  app.get('/api/dashboard/search', async (req, res) => {
    try {
      const query = req.query.q || '';
      if (!query) return res.json([]);
      const results = await searchConversations(query);
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Mensagens de uma conversa
  app.get('/api/dashboard/messages/:conversationId', async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
      const messages = await getMessages(req.params.conversationId, page, limit);
      res.json(messages);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
