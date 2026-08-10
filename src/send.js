import axios from 'axios';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { env } from './config.js';

const INSTANCE_NAME = 'minha-conexao';
const EVOLUTION_API_URL = env.EVOLUTION_API_URL || 'http://localhost:8082';
const MEDIA_DIR = '/opt/whatsapp-bot/media';

// Cache: phone -> { mediaUrl, timestamp } — tracks last sent media per phone
const recentSentMedia = new Map();

/**
 * Get the last locally-saved media URL for a phone number (used by webhook handler)
 */
export function getLastSentMediaUrl(phone) {
  const entry = recentSentMedia.get(phone);
  if (!entry) return null;
  // Expire after 60 seconds
  if (Date.now() - entry.timestamp > 60000) {
    recentSentMedia.delete(phone);
    return null;
  }
  return entry.mediaUrl;
}

/**
 * Get the Evolution API key from config env, process env, or .env file
 */
function getApiKey() {
  // 1) From the project's config.js (process.env.EVOLUTION_API_KEY)
  if (env.EVOLUTION_API_KEY) return env.EVOLUTION_API_KEY;

  // 2) From process.env directly
  if (process.env.AUTHENTICATION_API_KEY) return process.env.AUTHENTICATION_API_KEY;

  // 3) Fallback: read from .env file in the project root
  try {
    const dotenvPath = new URL('../.env', import.meta.url).pathname;
    if (fs.existsSync(dotenvPath)) {
      const content = fs.readFileSync(dotenvPath, 'utf-8');
      const match = content.match(/AUTHENTICATION_API_KEY=(.+)/);
      if (match) return match[1].trim();
    }
  } catch (e) {
    // Ignore read errors
  }

  console.warn('[SEND] No Evolution API key found');
  return '';
}

function getHeaders() {
  return {
    'apikey': getApiKey(),
    'Content-Type': 'application/json'
  };
}

/**
 * Convert audio from webm to ogg/opus format for WhatsApp
 */
async function convertAudioToOgg(base64Data, fromMimetype) {
  // Always convert to ensure correct format (browser records webm, WhatsApp needs ogg)
  console.log(`[SEND] Converting audio from ${fromMimetype || 'unknown'} to ogg/opus`);
  
  try {
    // Decode base64 to buffer
    const inputBuffer = Buffer.from(base64Data, 'base64');
    const inputPath = '/tmp/audio_input_' + Date.now() + '.webm';
    const outputPath = '/tmp/audio_output_' + Date.now() + '.ogg';
    
    fs.writeFileSync(inputPath, inputBuffer);
    
    // Convert with ffmpeg
    execSync(`ffmpeg -y -i "${inputPath}" -c:a libopus -b:a 32k -ar 48000 -ac 1 "${outputPath}" 2>/dev/null`);
    
    const outputBuffer = fs.readFileSync(outputPath);
    const outputBase64 = outputBuffer.toString('base64');
    
    // Cleanup
    try { fs.unlinkSync(inputPath); } catch(e) {}
    try { fs.unlinkSync(outputPath); } catch(e) {}
    
    console.log(`[SEND] Audio converted: ${inputBuffer.length}B → ${outputBuffer.length}B (webm→ogg)`);
    console.log(`[SEND] Output mimetype will be: audio/ogg; codecs=opus`);
    return outputBase64;
  } catch (err) {
    console.error('[SEND] Audio conversion failed:', err.message);
    return base64Data; // Return original on failure
  }
}

/**
 * Send a text message directly (for bulk module)
 */
export async function sendTextMessage(number, text) {
  const resp = await axios.post(
    `${EVOLUTION_API_URL}/message/sendText/${INSTANCE_NAME}`,
    { number, text: text.slice(0, 4096) },
    { headers: getHeaders() }
  );
  return resp.data;
}

/**
 * Send a media message directly (for bulk module)
 */
export async function sendMediaMessage(number, caption, mediatype, mediaUrl) {
  // For local media files, read from disk
  let media = mediaUrl;
  if (mediaUrl.startsWith('/media/')) {
    const filePath = path.join('/opt/whatsapp-bot/media', mediaUrl.replace('/media/', ''));
    const buffer = fs.readFileSync(filePath);
    media = buffer.toString('base64');
  }

  const payload = {
    number,
    mediatype: mediatype || 'image',
    mimetype: 'application/octet-stream',
    media,
  };
  if (caption) payload.caption = caption;

  const resp = await axios.post(
    `${EVOLUTION_API_URL}/message/sendMedia/${INSTANCE_NAME}`,
    payload,
    { headers: getHeaders() }
  );
  return resp.data;
}

/**
 * Register send routes on the Express app
 *
 * POST /api/send/text   – Send a text message
 * POST /api/send/media  – Send media (image, video, audio, document)
 * POST /api/send/file   – Send a file/document
 */
export function registerSendRoutes(app) {

  // ======= POST /api/send/text =======
  app.post('/api/send/text', async (req, res) => {
    try {
      const { number, text } = req.body;

      if (!number || !text) {
        return res.status(400).json({ error: 'Missing required fields: number, text' });
      }

      console.log(`[SEND] Text to ${number}: ${text.substring(0, 50)}...`);

      const resp = await axios.post(
        `${EVOLUTION_API_URL}/message/sendText/${INSTANCE_NAME}`,
        { number, text: text.slice(0, 4096) },
        { headers: getHeaders() }
      );

      console.log(`[SEND] Text sent successfully to ${number}`);
      res.json(resp.data);
    } catch (err) {
      console.error('[SEND] Error sending text:', err.response?.data || err.message);
      res.status(err.response?.status || 500).json({
        error: 'Failed to send text message',
        details: err.response?.data || err.message
      });
    }
  });

  // ======= POST /api/send/media =======
  app.post('/api/send/media', async (req, res) => {
    try {
      const { number, mediatype, mimetype, caption, media, fileName } = req.body;

      if (!number || !media || !mediatype) {
        return res.status(400).json({
          error: 'Missing required fields: number, media, mediatype'
        });
      }

      console.log(`[SEND] Media (${mediatype}) to ${number}`);

      const payload = {
        number,
        mediatype,
        mimetype: mimetype || 'application/octet-stream',
        media
      };

      if (caption) payload.caption = caption;
      if (fileName) payload.fileName = fileName;
      
      // Audio → convert to ogg/opus, save to disk, and send as voice note (PTT)
      if (mediatype === 'audio') {
        const oggBase64 = await convertAudioToOgg(media, mimetype || 'audio/webm');
        payload.media = oggBase64;
        payload.ptt = true;
        payload.mimetype = 'audio/ogg; codecs=opus';
        console.log(`[SEND] Audio will be sent as voice note (PTT)`);

        // Save converted OGG to disk so dashboard can play it
        try {
          const oggBuffer = Buffer.from(oggBase64, 'base64');
          const filename = `sent_audio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.ogg`;
          const filepath = path.join(MEDIA_DIR, filename);
          fs.mkdirSync(MEDIA_DIR, { recursive: true });
          fs.writeFileSync(filepath, oggBuffer);
          const localUrl = `/media/${filename}`;
          console.log(`[SEND] Converted audio saved to disk: ${filename} (${Math.round(oggBuffer.length / 1024)}KB)`);
          // Cache for webhook handler
          recentSentMedia.set(number, { mediaUrl: localUrl, timestamp: Date.now() });
        } catch (e) {
          console.error('[SEND] Failed to save converted audio to disk:', e.message);
        }
      }

      const resp = await axios.post(
        `${EVOLUTION_API_URL}/message/sendMedia/${INSTANCE_NAME}`,
        payload,
        { headers: getHeaders() }
      );

      console.log(`[SEND] Media sent successfully to ${number} (${mediatype})`);
      res.json(resp.data);
    } catch (err) {
      console.error('[SEND] Error sending media:', err.response?.data || err.message);
      res.status(err.response?.status || 500).json({
        error: 'Failed to send media',
        details: err.response?.data || err.message
      });
    }
  });

  // ======= POST /api/send/file =======
  app.post('/api/send/file', async (req, res) => {
    try {
      const { number, media, fileName, mimetype, caption } = req.body;

      if (!number || !media || !fileName) {
        return res.status(400).json({
          error: 'Missing required fields: number, media, fileName'
        });
      }

      console.log(`[SEND] File "${fileName}" to ${number}`);

      const payload = {
        number,
        mediatype: 'document',
        mimetype: mimetype || 'application/octet-stream',
        media,
        fileName
      };

      if (caption) payload.caption = caption;

      const resp = await axios.post(
        `${EVOLUTION_API_URL}/message/sendMedia/${INSTANCE_NAME}`,
        payload,
        { headers: getHeaders() }
      );

      console.log(`[SEND] File sent successfully to ${number}: ${fileName}`);
      res.json(resp.data);
    } catch (err) {
      console.error('[SEND] Error sending file:', err.response?.data || err.message);
      res.status(err.response?.status || 500).json({
        error: 'Failed to send file',
        details: err.response?.data || err.message
      });
    }
  });
}
