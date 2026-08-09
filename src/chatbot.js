import axios from 'axios';
import { env, getBotConfig } from './config.js';

const conversations = new Map();

/**
 * Gera resposta usando Gemini AI
 */
export async function generateReply(userId, message) {
  try {
    if (!conversations.has(userId)) conversations.set(userId, []);
    const history = conversations.get(userId);
    const botConfig = getBotConfig();

    const contents = [];
    contents.push({ role: 'user', parts: [{ text: botConfig.prompt }] });
    contents.push({ role: 'model', parts: [{ text: 'Entendido! Estou pronto para ajudar.' }] });

    for (const msg of history) {
      contents.push({ role: msg.role, parts: [{ text: msg.text }] });
    }

    contents.push({ role: 'user', parts: [{ text: message }] });

    const resp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
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

/**
 * Retorna todas as conversas ativas
 */
export function getConversations() {
  const data = [];
  for (const [phone, msgs] of conversations) {
    data.push({ phone, messages: msgs.length, last: msgs[msgs.length - 1] });
  }
  return data;
}
