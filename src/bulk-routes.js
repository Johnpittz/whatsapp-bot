/**
 * Bulk Sending API Routes
 * 
 * POST   /api/bulk/create       — Create a new campaign
 * GET    /api/bulk/list          — List all campaigns
 * GET    /api/bulk/:id           — Get campaign details
 * POST   /api/bulk/:id/start     — Start sending
 * POST   /api/bulk/:id/pause     — Pause sending
 * POST   /api/bulk/:id/cancel    — Cancel campaign
 * DELETE /api/bulk/:id           — Delete campaign
 * GET    /api/bulk/:id/status    — Real-time queue status
 * GET    /api/bulk/stats         — Global statistics
 */

import {
  createCampaign,
  listCampaigns,
  getCampaign,
  startCampaign,
  pauseCampaign,
  cancelCampaign,
  deleteCampaign,
  getQueueStatus,
  updateCampaignConfig,
  getGlobalStats,
} from './bulk.js';

// Import send function from send.js
import { sendTextMessage, sendMediaMessage } from './send.js';

/**
 * Register bulk routes on Express app
 */
export function registerBulkRoutes(app) {

  // ======= POST /api/bulk/create =======
  app.post('/api/bulk/create', (req, res) => {
    try {
      const { name, numbers, message, messageType, mediaUrl, config } = req.body;

      if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
        return res.status(400).json({ error: 'Lista de números é obrigatória' });
      }
      if (!message || message.trim() === '') {
        return res.status(400).json({ error: 'Mensagem é obrigatória' });
      }

      // Clean numbers
      const cleanNumbers = numbers
        .map(n => String(n).replace(/\D/g, ''))
        .filter(n => n.length >= 10);

      if (cleanNumbers.length === 0) {
        return res.status(400).json({ error: 'Nenhum número válido encontrado' });
      }

      const campaign = createCampaign({
        name,
        numbers: cleanNumbers,
        message: message.trim(),
        messageType: messageType || 'text',
        mediaUrl,
        config,
      });

      console.log(`[BULK API] Campanha criada: ${campaign.id}`);
      res.json(campaign);
    } catch (err) {
      console.error('[BULK API] Erro ao criar campanha:', err.message);
      res.status(500).json({ error: 'Erro ao criar campanha' });
    }
  });

  // ======= GET /api/bulk/list =======
  app.get('/api/bulk/list', (req, res) => {
    try {
      const { status } = req.query;
      const campaigns = listCampaigns(status);
      res.json(campaigns);
    } catch (err) {
      res.status(500).json({ error: 'Erro ao listar campanhas' });
    }
  });

  // ======= GET /api/bulk/stats =======
  app.get('/api/bulk/stats', (req, res) => {
    try {
      res.json(getGlobalStats());
    } catch (err) {
      res.status(500).json({ error: 'Erro ao obter estatísticas' });
    }
  });

  // ======= GET /api/bulk/:id =======
  app.get('/api/bulk/:id', (req, res) => {
    try {
      const campaign = getCampaign(req.params.id);
      if (!campaign) {
        return res.status(404).json({ error: 'Campanha não encontrada' });
      }
      res.json(campaign);
    } catch (err) {
      res.status(500).json({ error: 'Erro ao buscar campanha' });
    }
  });

  // ======= POST /api/bulk/:id/start =======
  app.post('/api/bulk/:id/start', async (req, res) => {
    try {
      const result = await startCampaign(req.params.id, async (phone, message, type, mediaUrl) => {
        if (type === 'text' || !mediaUrl) {
          await sendTextMessage(phone, message);
        } else {
          await sendMediaMessage(phone, message, type, mediaUrl);
        }
      });

      if (result.error) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (err) {
      console.error('[BULK API] Erro ao iniciar campanha:', err.message);
      res.status(500).json({ error: 'Erro ao iniciar campanha' });
    }
  });

  // ======= POST /api/bulk/:id/pause =======
  app.post('/api/bulk/:id/pause', (req, res) => {
    try {
      const result = pauseCampaign(req.params.id);
      if (result?.error) {
        return res.status(400).json(result);
      }
      res.json({ success: true, message: 'Campanha pausada' });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao pausar campanha' });
    }
  });

  // ======= POST /api/bulk/:id/cancel =======
  app.post('/api/bulk/:id/cancel', (req, res) => {
    try {
      const result = cancelCampaign(req.params.id);
      if (result?.error) {
        return res.status(400).json(result);
      }
      res.json({ success: true, message: 'Campanha cancelada' });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao cancelar campanha' });
    }
  });

  // ======= DELETE /api/bulk/:id =======
  app.delete('/api/bulk/:id', (req, res) => {
    try {
      const result = deleteCampaign(req.params.id);
      if (result?.error) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Erro ao excluir campanha' });
    }
  });

  // ======= GET /api/bulk/:id/status =======
  app.get('/api/bulk/:id/status', (req, res) => {
    try {
      const status = getQueueStatus(req.params.id);
      if (!status) {
        return res.status(404).json({ error: 'Campanha não encontrada' });
      }
      res.json(status);
    } catch (err) {
      res.status(500).json({ error: 'Erro ao obter status' });
    }
  });
}
