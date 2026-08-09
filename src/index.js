import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());

const {
  EVOLUTION_API_URL = 'http://localhost:8082',
  EVOLUTION_API_KEY,
  GEMINI_API_KEY,
  PORT = 3100,
  INSTANCE_NAME = 'minha-conexao'
} = process.env;

const CONFIG_FILE = join(__dirname, '..', 'config.json');
const STATE_FILE = join(__dirname, '..', 'bot-state.json');

let botConfig = {
  name: 'Meu Bot',
  prompt: 'Voce e um assistente virtual prestativo e amigavel. Responda sempre em portugues brasileiro.',
  welcome: 'Ola! Como posso ajudar?'
};

if (fs.existsSync(CONFIG_FILE)) {
  botConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

// Bot state (on/off)
let botEnabled = true;
if (fs.existsSync(STATE_FILE)) {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  botEnabled = state.enabled !== false;
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ enabled: botEnabled }));
}

const conversations = new Map();

// ======= WEB PANEL =======
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
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
    <div class="status ${botEnabled ? 'on' : 'off'}" id="status">
      ${botEnabled ? '✅ Bot ATIVADO' : '❌ Bot DESATIVADO'}
    </div>
    <button class="toggle-btn ${botEnabled ? 'on' : 'off'}" onclick="toggle()">
      ${botEnabled ? 'Desativar Bot' : 'Ativar Bot'}
    </button>
    <p class="info">WhatsApp: ${INSTANCE_NAME}</p>
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
</html>`);
});

// ======= API ROUTES =======
app.post('/api/toggle', (req, res) => {
  botEnabled = !botEnabled;
  saveState();
  res.json({ enabled: botEnabled });
});

app.get('/api/status', (req, res) => {
  res.json({ enabled: botEnabled });
});

app.get('/api/config', (req, res) => res.json(botConfig));

app.post('/api/config', (req, res) => {
  Object.assign(botConfig, req.body);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(botConfig, null, 2));
  res.json({ success: true });
});

app.get('/api/conversations', (req, res) => {
  const data = [];
  for (const [phone, msgs] of conversations) {
    data.push({ phone, messages: msgs.length, last: msgs[msgs.length - 1] });
  }
  res.json(data);
});

// ======= WEBHOOK =======
app.post('/webhook', async (req, res) => {
  try {
    const { event, data } = req.body;
    if (event !== 'messages.upsert') return res.sendStatus(200);
    const msg = data;
    const from = msg.key?.remoteJid;
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    if (!from || from.includes('@g.us') || msg.key?.fromMe) return res.sendStatus(200);

    console.log('Mensagem de ' + from + ': ' + text);

    // Command: desativar bot
    if (text.toLowerCase().trim() === 'desativar bot') {
      botEnabled = false;
      saveState();
      await sendWhatsApp(from, 'Bot desativado! Para ativar novamente, envie: ativar bot');
      console.log('Bot desativado via comando');
      return res.sendStatus(200);
    }

    // Command: ativar bot
    if (text.toLowerCase().trim() === 'ativar bot') {
      botEnabled = true;
      saveState();
      await sendWhatsApp(from, 'Bot ativado! Estou pronto para ajudar.');
      console.log('Bot ativado via comando');
      return res.sendStatus(200);
    }

    // If bot is disabled, ignore
    if (!botEnabled) {
      console.log('Bot desativado, ignorando mensagem');
      return res.sendStatus(200);
    }

    const reply = await generateReply(from, text);
    await sendWhatsApp(from, reply);
    console.log('Resposta enviada');
    res.sendStatus(200);
  } catch (err) {
    console.error('Erro webhook:', err.message);
    res.sendStatus(500);
  }
});

async function generateReply(userId, message) {
  try {
    if (!conversations.has(userId)) conversations.set(userId, []);
    const history = conversations.get(userId);

    const contents = [];
    contents.push({ role: 'user', parts: [{ text: botConfig.prompt }] });
    contents.push({ role: 'model', parts: [{ text: 'Entendido! Estou pronto para ajudar.' }] });

    for (const msg of history) {
      contents.push({ role: msg.role, parts: [{ text: msg.text }] });
    }

    contents.push({ role: 'user', parts: [{ text: message }] });

    const resp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      { contents },
      { headers: { 'Content-Type': 'application/json' } }
    );

    const reply = resp.data.candidates?.[0]?.content?.parts?.[0]?.text || 'Desculpe, nao consegui processar.';

    history.push({ role: 'user', text: message });
    history.push({ role: 'model', text: reply });
    if (history.length > 20) history.splice(0, history.length - 20);

    return reply;
  } catch (err) {
    console.error('Erro IA:', err.message);
    return 'Desculpe, tive um problema tecnico. Tente novamente.';
  }
}

async function sendWhatsApp(to, text) {
  const number = to.replace('@s.whatsapp.net', '').replace('@lid', '');
  await axios.post(
    EVOLUTION_API_URL + '/message/sendText/' + INSTANCE_NAME,
    { number, text: text.slice(0, 4096) },
    { headers: { 'apikey': EVOLUTION_API_KEY, 'Content-Type': 'application/json' } }
  );
}

app.listen(PORT, '0.0.0.0', () => {
  console.log('Bot rodando na porta ' + PORT);
  console.log('Status: ' + (botEnabled ? 'ATIVADO' : 'DESATIVADO'));
});
