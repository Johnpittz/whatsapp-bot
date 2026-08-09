import express from 'express';
import { env, isBotEnabled, setBotEnabled } from './config.js';
import { sendWhatsApp } from './evolutionapi.js';
import { generateReply } from './chatbot.js';
import { registerPanelRoutes } from './panel.js';

const app = express();
app.use(express.json());

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
      setBotEnabled(false);
      await sendWhatsApp(from, 'Bot desativado! Para ativar novamente, envie: ativar bot');
      console.log('Bot desativado via comando');
      return res.sendStatus(200);
    }

    // Command: ativar bot
    if (text.toLowerCase().trim() === 'ativar bot') {
      setBotEnabled(true);
      await sendWhatsApp(from, 'Bot ativado! Estou pronto para ajudar.');
      console.log('Bot ativado via comando');
      return res.sendStatus(200);
    }

    // If bot is disabled, ignore
    if (!isBotEnabled()) {
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

// ======= PANEL ROUTES =======
registerPanelRoutes(app);

// ======= START =======
app.listen(env.PORT, '0.0.0.0', () => {
  console.log('Bot rodando na porta ' + env.PORT);
  console.log('Status: ' + (isBotEnabled() ? 'ATIVADO' : 'DESATIVADO'));
});
