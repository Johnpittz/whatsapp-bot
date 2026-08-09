import express from 'express';
import { env, isBotEnabled, setBotEnabled } from './config.js';
import { sendWhatsApp } from './evolutionapi.js';
import { generateReply } from './chatbot.js';
import { registerPanelRoutes } from './panel.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

const app = express();
app.use(express.json());

// ======= SUPABASE HELPERS =======
async function upsertConversation(phone, contactName = null, lastMessage = null) {
  const { data, error } = await supabase
    .from('conversations')
    .upsert(
      { phone, contact_name: contactName, last_message: lastMessage, last_message_at: new Date().toISOString() },
      { onConflict: 'phone' }
    )
    .select()
    .single();
  if (error) console.error('Erro upsert conversation:', error.message);
  return data;
}

async function insertMessage(conversationId, direction, content, messageType = 'text') {
  const { error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, direction, content, message_type: messageType });
  if (error) console.error('Erro insert message:', error.message);
}

async function getConversationByPhone(phone) {
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('phone', phone)
    .single();
  return data;
}

// ======= WEBHOOK =======
app.post('/webhook', async (req, res) => {
  try {
    const { event, data } = req.body;
    console.log('Evento recebido:', event);

    // ---- MENSAGENS RECEBIDAS ----
    if (event === 'messages.upsert') {
      const msg = data;
      const from = msg.key?.remoteJid;
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
      const msgType = msg.message?.conversation ? 'text' : 
                      msg.message?.extendedTextMessage ? 'text' :
                      msg.message?.imageMessage ? 'image' :
                      msg.message?.videoMessage ? 'video' :
                      msg.message?.audioMessage ? 'audio' : 'other';

      if (!from || from.includes('@g.us')) return res.sendStatus(200);

      const phone = from.replace('@s.whatsapp.net', '').replace('@lid', '');
      const isFromMe = msg.key?.fromMe;

      // Sempre salvar no Supabase (independente do status do bot)
      try {
        const conv = await upsertConversation(phone, null, text || `[${msgType}]`);
        if (conv) {
          await insertMessage(conv.id, isFromMe ? 'outgoing' : 'incoming', text || `[${msgType}]`, msgType);
          console.log(`Mensagem salva: ${isFromMe ? 'enviada' : 'recebida'} de ${phone}`);
        }
      } catch (e) {
        console.error('Erro ao salvar mensagem:', e.message);
      }

      // Se for do bot e bot estiver desativado, ignorar
      if (isFromMe) return res.sendStatus(200);

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
    }

    // ---- MENSAGENS ENVIADAS (pelo WhatsApp normal) ----
    if (event === 'send.message') {
      const msg = data;
      const to = msg.key?.remoteJid;
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
      
      if (!to || to.includes('@g.us')) return res.sendStatus(200);

      const phone = to.replace('@s.whatsapp.net', '').replace('@lid', '');

      try {
        const conv = await upsertConversation(phone, null, text || '[media]');
        if (conv) {
          await insertMessage(conv.id, 'outgoing', text || '[media]', 'text');
          console.log(`Mensagem enviada salva para ${phone}`);
        }
      } catch (e) {
        console.error('Erro ao salvar mensagem enviada:', e.message);
      }
    }

    // ---- ATUALIZAÇÕES DE STATUS (entregue, lido, etc) ----
    if (event === 'messages.update') {
      // Apenas log, não precisa salvar no Supabase
      console.log('Status da mensagem atualizado');
    }

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
