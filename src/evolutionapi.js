import axios from 'axios';
import { env } from './config.js';

/**
 * Envia mensagem de texto via Evolution API
 */
export async function sendWhatsApp(to, text) {
  const number = to.replace('@s.whatsapp.net', '').replace('@lid', '');
  await axios.post(
    env.EVOLUTION_API_URL + '/message/sendText/' + env.INSTANCE_NAME,
    { number, text: text.slice(0, 4096) },
    { headers: { 'apikey': env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' } }
  );
}

/**
 * Lista todas as instâncias
 */
export async function fetchInstances() {
  const resp = await axios.get(
    env.EVOLUTION_API_URL + '/instance/fetchInstances',
    { headers: { 'apikey': env.EVOLUTION_API_KEY } }
  );
  return resp.data;
}

/**
 * Retorna estado da conexão de uma instância
 */
export async function getConnectionState(instanceName) {
  const resp = await axios.get(
    env.EVOLUTION_API_URL + '/instance/connectionState/' + instanceName,
    { headers: { 'apikey': env.EVOLUTION_API_KEY } }
  );
  return resp.data;
}

/**
 * Configura webhook na instância
 */
export async function setWebhook(instanceName, webhookUrl, events = ['MESSAGES_UPSERT']) {
  const resp = await axios.post(
    env.EVOLUTION_API_URL + '/webhook/set/' + instanceName,
    {
      webhook: {
        url: webhookUrl,
        enabled: true,
        events
      }
    },
    { headers: { 'apikey': env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' } }
  );
  return resp.data;
}
