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
app.use(express.static(join(__dirname, '..', 'public')));

const {
  EVOLUTION_API_URL = 'http://localhost:8080',
  EVOLUTION_API_KEY,
  AI_API_URL = 'https://openrouter.ai/api/v1/chat/completions',
  AI_API_KEY,
  PORT = 3100,
  INSTANCE_NAME = 'minha-conexao'
} = process.env;

const CONFIG_FILE = join(__dirname, '..', 'config.json');
let botConfig = {
  name: 'Meu Bot',
  prompt: 'Voce e um assistente virtual prestativo e amigavel.',
  welcome: 'Ola! Como posso ajudar?'
};

if (fs.existsSync(CONFIG_FILE)) {
  botConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

const conversations = new Map();

app.post('/webhook', async (req, res) => {
  try {
    const { event, data } = req.body;
    if (event !== 'messages.upsert') return res.sendStatus(200);
    const msg = data;
    const from = msg.key?.remoteJid;
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    if (!from || from.includes('@g.us') || msg.key?.fromMe) return res.sendStatus(200);
    console.log('Mensagem de ' + from + ': ' + text);
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
    history.push({ role: 'user', content: message });
    if (history.length > 10) history.splice(0, history.length - 10);
    const resp = await axios.post(AI_API_URL, {
      model: 'meta-llama/llama-3.1-8b-instruct:free',
      messages: [{ role: 'system', content: botConfig.prompt }, ...history],
      max_tokens: 500,
      temperature: 0.7
    }, {
      headers: { 'Authorization': 'Bearer ' + AI_API_KEY, 'Content-Type': 'application/json' }
    });
    const reply = resp.data.choices[0].message.content;
    history.push({ role: 'assistant', content: reply });
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

app.listen(PORT, '0.0.0.0', () => {
  console.log('Bot rodando na porta ' + PORT);
});
