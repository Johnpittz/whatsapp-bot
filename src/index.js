import express from 'express';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { env, isBotEnabled, setBotEnabled } from './config.js';
import { sendWhatsApp } from './evolutionapi.js';
import { generateReply } from './chatbot.js';
import { registerPanelRoutes } from './panel.js';
import { registerSendRoutes, getLastSentMediaUrl } from './send.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use('/media', express.static('/opt/whatsapp-bot/media'));

// MEDIA DIRECTORY
const MEDIA_DIR = '/opt/whatsapp-bot/media';
if (!existsSync(MEDIA_DIR)) mkdirSync(MEDIA_DIR, { recursive: true });

// MIME detection from buffer magic bytes
function detectMime(buffer) {
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'image/webp';
  if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) return 'video/mp4';
  if (buffer[0] === 0x4F && buffer[1] === 0x67 && buffer[2] === 0x67) return 'audio/ogg';
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44) return 'application/pdf';
  return 'application/octet-stream';
}

function extFromMime(mime) {
  const map = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'audio/ogg': '.ogg', 'application/pdf': '.pdf' };
  return map[mime] || '.bin';
}

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

async function insertMessage(conversationId, direction, content, messageType = 'text', mediaUrl = null, fileName = null) {
  const insertData = { conversation_id: conversationId, direction, content, message_type: messageType };
  if (mediaUrl) insertData.media_url = mediaUrl;
  if (fileName) insertData.file_name = fileName;
  const { error } = await supabase
    .from('messages')
    .insert(insertData);
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
    console.log('Evento recebido:', event); if (event === 'messages.upsert') console.log('PAYLOAD:', JSON.stringify(data).substring(0, 500));

    // ---- MENSAGENS RECEBIDAS ----
    if (event === 'messages.upsert') {
      const msg = data;
      const from = msg.key?.remoteJid;
      const text = msg.message?.conversation ||
                   msg.message?.extendedTextMessage?.text ||
                   msg.message?.imageMessage?.caption ||
                   msg.message?.videoMessage?.caption ||
                   '';
      
      // Detect message type
      const msgType = msg.message?.conversation ? 'text' : 
                      msg.message?.extendedTextMessage ? 'text' :
                      msg.message?.imageMessage ? 'image' :
                      msg.message?.videoMessage ? 'video' :
                      msg.message?.audioMessage ? 'audio' :
                      msg.message?.documentMessage ? 'document' :
                      msg.message?.stickerMessage ? 'sticker' :
                      msg.message?.locationMessage ? 'location' :
                      msg.message?.contactMessage ? 'contact' : 'other';
      
      // Extract media URL and file name from message content
      let mediaUrl = null;
      let fileName = null;
      
      // Check if base64 media is available (webhookBase64 enabled)
      const base64Data = msg.message?.base64;
      
      // Debug: log what keys arrive in message object for media
      if (msgType !== 'text') {
        const msgKeys = Object.keys(msg.message || {});
        console.log(`[DEBUG] message keys: ${msgKeys.join(', ')} | has base64: ${!!base64Data}`);
      }
      
      if (base64Data && msgType !== 'text') {
        // Save media to disk (much better than huge base64 in Supabase)
        try {
          const buffer = Buffer.from(base64Data, 'base64');
          const mime = detectMime(buffer);
          const ext = extFromMime(mime);
          const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
          const filepath = join(MEDIA_DIR, filename);
          writeFileSync(filepath, buffer);
          mediaUrl = `/media/${filename}`;
          console.log(`Mídia salva em disco: ${msgType} -> ${filename} (${Math.round(buffer.length / 1024)}KB, ${mime})`);
        } catch (e) {
          console.error('Erro ao salvar mídia em disco:', e.message);
        }
      } else if (msg.message?.imageMessage) {
        mediaUrl = msg.message.imageMessage.url || null;
        console.log(`[DEBUG] imageMessage without base64, URL: ${(msg.message.imageMessage.url || '').substring(0, 80)}`);
      } else if (msg.message?.videoMessage) {
        mediaUrl = msg.message.videoMessage.url || null;
      } else if (msg.message?.audioMessage) {
        mediaUrl = msg.message.audioMessage.url || null;
      } else if (msg.message?.documentMessage) {
        mediaUrl = msg.message.documentMessage.url || null;
        fileName = msg.message.documentMessage.fileName || null;
      } else if (msg.message?.stickerMessage) {
        mediaUrl = msg.message.stickerMessage.url || null;
        console.log(`[DEBUG] stickerMessage without base64, URL: ${(msg.message.stickerMessage.url || '').substring(0, 80)}`);
      } else if (msg.message?.locationMessage) {
        const lat = msg.message.locationMessage.degreesLatitude;
        const lng = msg.message.locationMessage.degreesLongitude;
        if (lat != null && lng != null) {
          mediaUrl = `geo:${lat},${lng}`;
        }
      } else if (msg.message?.contactMessage) {
        mediaUrl = msg.message.contactMessage.vcard || null;
      }

      if (!from || from.includes('@g.us')) return res.sendStatus(200);

      const phone = from.replace('@s.whatsapp.net', '').replace('@lid', '');
      const isFromMe = msg.key?.fromMe;

      // Sempre salvar no Supabase (independente do status do bot)
      try {
        const displayText = text || `[${msgType}]`;
        const conv = await upsertConversation(phone, null, displayText);
        if (conv) {
          await insertMessage(conv.id, isFromMe ? 'outgoing' : 'incoming', displayText, msgType, mediaUrl, fileName);
          console.log(`Mensagem salva: ${isFromMe ? 'enviada' : 'recebida'} de ${phone} (${msgType})${mediaUrl ? ' [media]' : ''}`);
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
      const text = msg.message?.conversation ||
                   msg.message?.extendedTextMessage?.text ||
                   msg.message?.imageMessage?.caption ||
                   msg.message?.videoMessage?.caption ||
                   '';
      
      if (!to || to.includes('@g.us')) return res.sendStatus(200);

      const phone = to.replace('@s.whatsapp.net', '').replace('@lid', '');

      // Detect message type and extract media for outgoing messages too
      const outMsgType = msg.message?.conversation ? 'text' : 
                         msg.message?.extendedTextMessage ? 'text' :
                         msg.message?.imageMessage ? 'image' :
                         msg.message?.videoMessage ? 'video' :
                         msg.message?.audioMessage ? 'audio' :
                         msg.message?.documentMessage ? 'document' :
                         msg.message?.stickerMessage ? 'sticker' :
                         msg.message?.locationMessage ? 'location' :
                         msg.message?.contactMessage ? 'contact' : 'other';
      
      let outMediaUrl = null;
      let outFileName = null;
      if (msg.message?.imageMessage) {
        outMediaUrl = msg.message.imageMessage.url || null;
      } else if (msg.message?.videoMessage) {
        outMediaUrl = msg.message.videoMessage.url || null;
      } else if (msg.message?.audioMessage) {
        // Use local file URL if available (converted OGG saved to disk)
        const localUrl = getLastSentMediaUrl(phone);
        outMediaUrl = localUrl || msg.message.audioMessage.url || null;
        if (localUrl) console.log(`[WEBHOOK] Using local audio URL: ${localUrl}`);
      } else if (msg.message?.documentMessage) {
        outMediaUrl = msg.message.documentMessage.url || null;
        outFileName = msg.message.documentMessage.fileName || null;
      } else if (msg.message?.stickerMessage) {
        outMediaUrl = msg.message.stickerMessage.url || null;
      } else if (msg.message?.locationMessage) {
        const lat = msg.message.locationMessage.degreesLatitude;
        const lng = msg.message.locationMessage.degreesLongitude;
        if (lat != null && lng != null) {
          outMediaUrl = `geo:${lat},${lng}`;
        }
      } else if (msg.message?.contactMessage) {
        outMediaUrl = msg.message.contactMessage.vcard || null;
      }
      
      try {
        const outDisplayText = text || `[${outMsgType}]`;
        const conv = await upsertConversation(phone, null, outDisplayText);
        if (conv) {
          await insertMessage(conv.id, 'outgoing', outDisplayText, outMsgType, outMediaUrl, outFileName);
          console.log(`Mensagem enviada salva para ${phone} (${outMsgType})`);
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

// ======= SEND ROUTES =======
registerSendRoutes(app);

// ======= START =======
app.listen(env.PORT, '0.0.0.0', () => {
  console.log('Bot rodando na porta ' + env.PORT);
  console.log('Status: ' + (isBotEnabled() ? 'ATIVADO' : 'DESATIVADO'));
});
