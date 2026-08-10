/**
 * Bulk Messaging Module — Disparo em Massa Cadenceado
 * 
 * Features:
 * - Cadência com intervalo aleatório entre envios
 * - Pausa/Retomada em tempo real
 * - Retry automático com delay crescente
 * - Limite de envios por hora/dia
 * - Relatório detalhado de status
 * - Persistência em arquivo JSON
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = '/opt/whatsapp-bot/data';
const CAMPAIGNS_FILE = path.join(DATA_DIR, 'campaigns.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ======= CAMPAIGN STORAGE =======

function loadCampaigns() {
  try {
    if (!fs.existsSync(CAMPAIGNS_FILE)) return [];
    return JSON.parse(fs.readFileSync(CAMPAIGNS_FILE, 'utf-8'));
  } catch { return []; }
}

function saveCampaigns(campaigns) {
  fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(campaigns, null, 2));
}

function generateId() {
  return `camp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ======= ACTIVE QUEUE =======

const activeQueues = new Map(); // campaignId -> { running, paused, intervalId }

// ======= DEFAULT CONFIG =======

const DEFAULT_CONFIG = {
  minDelay: 3000,      // 3 seconds minimum between sends
  maxDelay: 8000,      // 8 seconds maximum between sends
  maxPerHour: 60,      // Max messages per hour
  maxPerDay: 500,      // Max messages per day
  retryCount: 3,       // Max retries per failed message
  retryDelay: 30000,   // 30 seconds base delay for retries
};

// ======= PUBLIC API =======

/**
 * Create a new campaign
 */
export function createCampaign({ name, numbers, message, messageType = 'text', mediaUrl = null, config = {} }) {
  const campaign = {
    id: generateId(),
    name: name || `Campanha ${new Date().toLocaleString('pt-BR')}`,
    status: 'created', // created | running | paused | completed | cancelled
    numbers: numbers.map(n => ({
      phone: n.replace(/\D/g, ''),
      status: 'pending', // pending | sent | failed | retrying
      attempts: 0,
      lastError: null,
      sentAt: null,
    })),
    message,
    messageType, // text | image | video | audio
    mediaUrl,
    config: { ...DEFAULT_CONFIG, ...config },
    stats: {
      total: numbers.length,
      sent: 0,
      failed: 0,
      pending: numbers.length,
      startedAt: null,
      finishedAt: null,
      lastSentAt: null,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const campaigns = loadCampaigns();
  campaigns.unshift(campaign);
  saveCampaigns(campaigns);

  console.log(`[BULK] Campanha criada: ${campaign.name} (${campaign.stats.total} números)`);
  return campaign;
}

/**
 * List all campaigns with optional status filter
 */
export function listCampaigns(status = null) {
  let campaigns = loadCampaigns();
  if (status) {
    campaigns = campaigns.filter(c => c.status === status);
  }
  // Return summary (not full number lists for performance)
  return campaigns.map(c => ({
    ...c,
    numbers: c.numbers.length, // Replace array with count
    preview: c.numbers.slice(0, 3).map(n => n.phone), // Show first 3
  }));
}

/**
 * Get full campaign details
 */
export function getCampaign(id) {
  const campaigns = loadCampaigns();
  return campaigns.find(c => c.id === id) || null;
}

/**
 * Update campaign status
 */
function updateCampaign(id, updates) {
  const campaigns = loadCampaigns();
  const idx = campaigns.findIndex(c => c.id === id);
  if (idx === -1) return null;

  Object.assign(campaigns[idx], updates, { updatedAt: new Date().toISOString() });
  saveCampaigns(campaigns);
  return campaigns[idx];
}

/**
 * Delete a campaign (only if not running)
 */
export function deleteCampaign(id) {
  const campaigns = loadCampaigns();
  const campaign = campaigns.find(c => c.id === id);
  if (!campaign) return { error: 'Campanha não encontrada' };
  if (campaign.status === 'running') return { error: 'Não é possível excluir campanha em andamento' };

  const filtered = campaigns.filter(c => c.id !== id);
  saveCampaigns(filtered);
  console.log(`[BULK] Campanha excluída: ${campaign.name}`);
  return { success: true };
}

/**
 * Cancel a running campaign
 */
export function cancelCampaign(id) {
  const queue = activeQueues.get(id);
  if (queue) {
    queue.cancelled = true;
    if (queue.intervalId) clearTimeout(queue.intervalId);
  }
  activeQueues.delete(id);
  return updateCampaign(id, { status: 'cancelled' });
}

/**
 * Start a campaign (begins sending)
 */
export async function startCampaign(id, sendFunction) {
  const campaign = getCampaign(id);
  if (!campaign) return { error: 'Campanha não encontrada' };
  if (campaign.status === 'running') return { error: 'Campanha já está em andamento' };
  if (campaign.status === 'completed') return { error: 'Campanha já foi concluída' };

  // Reset failed messages for retry if resuming
  if (campaign.status === 'paused') {
    const campaigns = loadCampaigns();
    const idx = campaigns.findIndex(c => c.id === id);
    campaigns[idx].numbers.forEach(n => {
      if (n.status === 'failed' && n.attempts < campaign.config.retryCount) {
        n.status = 'pending';
      }
    });
    campaigns[idx].stats.pending = campaigns[idx].numbers.filter(n => n.status === 'pending').length;
    saveCampaigns(campaigns);
  }

  updateCampaign(id, { 
    status: 'running',
    stats: { ...campaign.stats, startedAt: campaign.stats.startedAt || new Date().toISOString() }
  });

  // Start the send loop
  const queue = { running: true, paused: false, cancelled: false, intervalId: null };
  activeQueues.set(id, queue);

  console.log(`[BULK] Iniciando campanha: ${campaign.name}`);
  processQueue(id, sendFunction);

  return { success: true, message: 'Campanha iniciada' };
}

/**
 * Pause a running campaign
 */
export function pauseCampaign(id) {
  const queue = activeQueues.get(id);
  if (queue) {
    queue.paused = true;
    if (queue.intervalId) clearTimeout(queue.intervalId);
  }
  return updateCampaign(id, { status: 'paused' });
}

/**
 * Get queue status (real-time)
 */
export function getQueueStatus(id) {
  const queue = activeQueues.get(id);
  const campaign = getCampaign(id);
  if (!campaign) return null;

  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    stats: campaign.stats,
    isActive: queue?.running && !queue?.paused && !queue?.cancelled,
    isPaused: queue?.paused || false,
  };
}

/**
 * Update campaign config
 */
export function updateCampaignConfig(id, config) {
  const campaign = getCampaign(id);
  if (!campaign) return { error: 'Campanha não encontrada' };
  if (campaign.status === 'running') return { error: 'Não é possível alterar configuração durante execução' };

  const updated = { ...campaign.config, ...config };
  return updateCampaign(id, { config: updated });
}

// ======= QUEUE PROCESSOR =======

async function processQueue(campaignId, sendFunction) {
  const queue = activeQueues.get(campaignId);
  if (!queue || queue.cancelled) return;

  const campaign = getCampaign(campaignId);
  if (!campaign) return;

  // Find next number to send
  const nextNumber = campaign.numbers.find(n => n.status === 'pending');
  if (!nextNumber) {
    // All done!
    updateCampaign(campaignId, { status: 'completed' });
    activeQueues.delete(campaignId);
    console.log(`[BULK] ✅ Campanha concluída: ${campaign.name}`);
    return;
  }

  // Check rate limits
  const now = new Date();
  const hourAgo = new Date(now - 3600000);
  const dayAgo = new Date(now - 86400000);

  const recentSends = campaign.numbers.filter(n => 
    n.sentAt && new Date(n.sentAt) > hourAgo
  ).length;
  const daySends = campaign.numbers.filter(n => 
    n.sentAt && new Date(n.sentAt) > dayAgo
  ).length;

  if (recentSends >= campaign.config.maxPerHour) {
    console.log(`[BULK] Limite por hora atingido (${recentSends}/${campaign.config.maxPerHour}). Aguardando...`);
    queue.intervalId = setTimeout(() => processQueue(campaignId, sendFunction), 60000);
    return;
  }

  if (daySends >= campaign.config.maxPerDay) {
    console.log(`[BULK] Limite por dia atingido (${daySends}/${campaign.config.maxPerDay}). Campanha pausada.`);
    updateCampaign(campaignId, { status: 'paused' });
    activeQueues.delete(campaignId);
    return;
  }

  // Send the message
  try {
    console.log(`[BULK] Enviando para ${nextNumber.phone} (${campaign.stats.sent + 1}/${campaign.stats.total})`);
    
    await sendFunction(nextNumber.phone, campaign.message, campaign.messageType, campaign.mediaUrl);

    // Update status
    const idx = campaign.numbers.findIndex(n => n.phone === nextNumber.phone);
    campaign.numbers[idx].status = 'sent';
    campaign.numbers[idx].sentAt = new Date().toISOString();
    campaign.stats.sent++;
    campaign.stats.pending--;
    campaign.stats.lastSentAt = new Date().toISOString();

    saveCampaigns([campaign, ...loadCampaigns().filter(c => c.id !== campaignId)]);
    console.log(`[BULK] ✅ Enviado para ${nextNumber.phone}`);
  } catch (err) {
    console.error(`[BULK] ❌ Falha ao enviar para ${nextNumber.phone}:`, err.message);
    
    const idx = campaign.numbers.findIndex(n => n.phone === nextNumber.phone);
    campaign.numbers[idx].attempts++;
    campaign.numbers[idx].lastError = err.message;

    if (campaign.numbers[idx].attempts >= campaign.config.retryCount) {
      campaign.numbers[idx].status = 'failed';
      campaign.stats.failed++;
      campaign.stats.pending--;
      console.log(`[BULK] Número ${nextNumber.phone} falhou após ${campaign.config.retryCount} tentativas`);
    } else {
      campaign.numbers[idx].status = 'retrying';
      // Retry with increasing delay
      const retryDelay = campaign.config.retryDelay * campaign.numbers[idx].attempts;
      console.log(`[BULK] Retry ${campaign.numbers[idx].attempts}/${campaign.config.retryCount} para ${nextNumber.phone} em ${retryDelay/1000}s`);
      
      saveCampaigns([campaign, ...loadCampaigns().filter(c => c.id !== campaignId)]);
      
      queue.intervalId = setTimeout(() => processQueue(campaignId, sendFunction), retryDelay);
      return;
    }
  }

  saveCampaigns([campaign, ...loadCampaigns().filter(c => c.id !== campaignId)]);

  // Schedule next send with random delay
  if (!queue.cancelled && !queue.paused) {
    const delay = campaign.config.minDelay + 
      Math.random() * (campaign.config.maxDelay - campaign.config.minDelay);
    
    console.log(`[BULK] Próximo envio em ${(delay/1000).toFixed(1)}s`);
    queue.intervalId = setTimeout(() => processQueue(campaignId, sendFunction), delay);
  }
}

/**
 * Get statistics summary across all campaigns
 */
export function getGlobalStats() {
  const campaigns = loadCampaigns();
  return {
    totalCampaigns: campaigns.length,
    running: campaigns.filter(c => c.status === 'running').length,
    completed: campaigns.filter(c => c.status === 'completed').length,
    totalSent: campaigns.reduce((sum, c) => sum + c.stats.sent, 0),
    totalFailed: campaigns.reduce((sum, c) => sum + c.stats.failed, 0),
    totalPending: campaigns.reduce((sum, c) => sum + c.stats.pending, 0),
  };
}
