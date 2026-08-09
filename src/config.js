import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_FILE = join(__dirname, '..', 'config.json');
const STATE_FILE = join(__dirname, '..', 'bot-state.json');

// Environment variables
export const env = {
  EVOLUTION_API_URL: process.env.EVOLUTION_API_URL || 'http://localhost:8082',
  EVOLUTION_API_KEY: process.env.EVOLUTION_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  PORT: parseInt(process.env.PORT) || 3100,
  INSTANCE_NAME: process.env.INSTANCE_NAME || 'minha-conexao',
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY
};

// Bot config (prompt, name, etc.)
let botConfig = {
  name: 'Meu Bot',
  prompt: 'Voce e um assistente virtual prestativo e amigavel. Responda sempre em portugues brasileiro.',
  welcome: 'Ola! Como posso ajudar?'
};

if (fs.existsSync(CONFIG_FILE)) {
  botConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

export function getBotConfig() {
  return botConfig;
}

export function updateBotConfig(updates) {
  Object.assign(botConfig, updates);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(botConfig, null, 2));
}

// Bot state (on/off)
let botEnabled = true;
if (fs.existsSync(STATE_FILE)) {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  botEnabled = state.enabled !== false;
}

export function isBotEnabled() {
  return botEnabled;
}

export function toggleBot() {
  botEnabled = !botEnabled;
  saveState();
  return botEnabled;
}

export function setBotEnabled(value) {
  botEnabled = value;
  saveState();
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ enabled: botEnabled }));
}
