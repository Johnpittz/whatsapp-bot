'use client';

import { useState, useEffect, useCallback } from 'react';

const API_BASE = ''; // Same domain (Vercel proxy)

interface CampaignNumber {
  phone: string;
  status: 'pending' | 'sent' | 'failed' | 'retrying';
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
}

interface Campaign {
  id: string;
  name: string;
  status: 'created' | 'running' | 'paused' | 'completed' | 'cancelled';
  numbers: CampaignNumber[] | number;
  preview?: string[];
  message: string;
  messageType: string;
  config: {
    minDelay: number;
    maxDelay: number;
    maxPerHour: number;
    maxPerDay: number;
    retryCount: number;
  };
  stats: {
    total: number;
    sent: number;
    failed: number;
    pending: number;
    startedAt: string | null;
    finishedAt: string | null;
    lastSentAt: string | null;
  };
  createdAt: string;
}

export default function BulkPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'list' | 'create'>('list');

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    numbers: '',
    message: '',
    minDelay: 3,
    maxDelay: 8,
    maxPerHour: 60,
    maxPerDay: 500,
  });

  // Fetch campaigns
  const fetchCampaigns = useCallback(async () => {
    try {
      const [campRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/api/bulk/list`),
        fetch(`${API_BASE}/api/bulk/stats`),
      ]);
      if (campRes.ok) setCampaigns(await campRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
    } catch (err) {
      console.error('Erro ao buscar campanhas:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCampaigns();
    const interval = setInterval(fetchCampaigns, 5000); // Refresh every 5s
    return () => clearInterval(interval);
  }, [fetchCampaigns]);

  // Fetch full campaign details
  const fetchCampaignDetail = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/bulk/${id}`);
      if (res.ok) setSelectedCampaign(await res.json());
    } catch (err) {
      console.error('Erro ao buscar detalhes:', err);
    }
  };

  // Create campaign
  const handleCreate = async () => {
    const numbers = formData.numbers
      .split('\n')
      .map(n => n.trim())
      .filter(n => n.length >= 10);

    if (numbers.length === 0) {
      alert('Adicione pelo menos um número válido');
      return;
    }
    if (!formData.message.trim()) {
      alert('Digite a mensagem');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/bulk/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name || `Campanha ${new Date().toLocaleString('pt-BR')}`,
          numbers,
          message: formData.message,
          config: {
            minDelay: formData.minDelay * 1000,
            maxDelay: formData.maxDelay * 1000,
            maxPerHour: formData.maxPerHour,
            maxPerDay: formData.maxPerDay,
          },
        }),
      });

      if (res.ok) {
        setFormData({ name: '', numbers: '', message: '', minDelay: 3, maxDelay: 8, maxPerHour: 60, maxPerDay: 500 });
        setActiveTab('list');
        fetchCampaigns();
      }
    } catch (err) {
      alert('Erro ao criar campanha');
    }
  };

  // Campaign actions
  const handleAction = async (id: string, action: string) => {
    try {
      const method = action === 'delete' ? 'DELETE' : 'POST';
      const res = await fetch(`${API_BASE}/api/bulk/${id}/${action === 'delete' ? '' : action}`, { method });
      if (res.ok) {
        fetchCampaigns();
        if (selectedCampaign?.id === id) fetchCampaignDetail(id);
      }
    } catch (err) {
      console.error('Erro na ação:', err);
    }
  };

  const statusColors: Record<string, string> = {
    created: 'bg-gray-600',
    running: 'bg-green-600',
    paused: 'bg-yellow-600',
    completed: 'bg-blue-600',
    cancelled: 'bg-red-600',
  };

  const statusLabels: Record<string, string> = {
    created: 'Criada',
    running: 'Em andamento',
    paused: 'Pausada',
    completed: 'Concluída',
    cancelled: 'Cancelada',
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">📨 Disparo em Massa</h1>
          <p className="text-gray-400 text-sm">Gerencie suas campanhas de envio</p>
        </div>
        <a href="/" className="text-sm text-gray-400 hover:text-white">← Voltar ao Chat</a>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="bg-gray-900 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold">{stats.totalCampaigns}</div>
            <div className="text-xs text-gray-400">Campanhas</div>
          </div>
          <div className="bg-gray-900 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-400">{stats.running}</div>
            <div className="text-xs text-gray-400">Rodando</div>
          </div>
          <div className="bg-gray-900 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-blue-400">{stats.totalSent}</div>
            <div className="text-xs text-gray-400">Enviados</div>
          </div>
          <div className="bg-gray-900 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-red-400">{stats.totalFailed}</div>
            <div className="text-xs text-gray-400">Falharam</div>
          </div>
          <div className="bg-gray-900 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-yellow-400">{stats.totalPending}</div>
            <div className="text-xs text-gray-400">Pendentes</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('list')}
          className={`px-4 py-2 rounded-lg font-medium transition ${activeTab === 'list' ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-700'}`}
        >
          📋 Campanhas
        </button>
        <button
          onClick={() => setActiveTab('create')}
          className={`px-4 py-2 rounded-lg font-medium transition ${activeTab === 'create' ? 'bg-green-600' : 'bg-gray-800 hover:bg-gray-700'}`}
        >
          ➕ Nova Campanha
        </button>
      </div>

      {/* Create Form */}
      {activeTab === 'create' && (
        <div className="bg-gray-900 rounded-xl p-6 max-w-2xl">
          <h2 className="text-lg font-bold mb-4">Nova Campanha</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Nome (opcional)</label>
              <input
                type="text"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="Ex: Promoção de Verão"
                className="w-full bg-gray-800 rounded-lg px-4 py-2 text-white border border-gray-700 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Números (um por linha, com DDD)
              </label>
              <textarea
                value={formData.numbers}
                onChange={e => setFormData({ ...formData, numbers: e.target.value })}
                placeholder={"62999887766\n11988776655\n21977665544"}
                rows={6}
                className="w-full bg-gray-800 rounded-lg px-4 py-2 text-white border border-gray-700 focus:border-blue-500 focus:outline-none font-mono text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">
                {formData.numbers.split('\n').filter(n => n.trim().length >= 10).length} números válidos
              </p>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Mensagem</label>
              <textarea
                value={formData.message}
                onChange={e => setFormData({ ...formData, message: e.target.value })}
                placeholder="Digite sua mensagem aqui..."
                rows={4}
                maxLength={4096}
                className="w-full bg-gray-800 rounded-lg px-4 py-2 text-white border border-gray-700 focus:border-blue-500 focus:outline-none"
              />
              <p className="text-xs text-gray-500 mt-1">{formData.message.length}/4096</p>
            </div>

            {/* Cadence Config */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold mb-3">⏱️ Cadência</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Intervalo mínimo (seg)</label>
                  <input
                    type="number"
                    value={formData.minDelay}
                    onChange={e => setFormData({ ...formData, minDelay: Number(e.target.value) })}
                    min={1}
                    max={60}
                    className="w-full bg-gray-700 rounded px-3 py-1.5 text-sm border border-gray-600"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Intervalo máximo (seg)</label>
                  <input
                    type="number"
                    value={formData.maxDelay}
                    onChange={e => setFormData({ ...formData, maxDelay: Number(e.target.value) })}
                    min={1}
                    max={120}
                    className="w-full bg-gray-700 rounded px-3 py-1.5 text-sm border border-gray-600"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Máx. por hora</label>
                  <input
                    type="number"
                    value={formData.maxPerHour}
                    onChange={e => setFormData({ ...formData, maxPerHour: Number(e.target.value) })}
                    min={1}
                    max={200}
                    className="w-full bg-gray-700 rounded px-3 py-1.5 text-sm border border-gray-600"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Máx. por dia</label>
                  <input
                    type="number"
                    value={formData.maxPerDay}
                    onChange={e => setFormData({ ...formData, maxPerDay: Number(e.target.value) })}
                    min={1}
                    max={5000}
                    className="w-full bg-gray-700 rounded px-3 py-1.5 text-sm border border-gray-600"
                  />
                </div>
              </div>
            </div>

            <button
              onClick={handleCreate}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg transition"
            >
              Criar Campanha
            </button>
          </div>
        </div>
      )}

      {/* Campaign List */}
      {activeTab === 'list' && (
        <div className="space-y-3">
          {loading ? (
            <p className="text-gray-400">Carregando...</p>
          ) : campaigns.length === 0 ? (
            <div className="bg-gray-900 rounded-xl p-8 text-center">
              <p className="text-gray-400 text-lg">Nenhuma campanha ainda</p>
              <p className="text-gray-500 text-sm mt-2">Clique em "Nova Campanha" para começar</p>
            </div>
          ) : (
            campaigns.map(camp => (
              <div
                key={camp.id}
                className="bg-gray-900 rounded-xl p-4 hover:bg-gray-800 transition cursor-pointer"
                onClick={() => { fetchCampaignDetail(camp.id); setSelectedCampaign(camp as any); }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold">{camp.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[camp.status]}`}>
                        {statusLabels[camp.status]}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400 mt-1 truncate">{camp.message}</p>
                    <div className="flex gap-4 mt-2 text-xs text-gray-500">
                      <span>📱 {typeof camp.numbers === 'number' ? camp.numbers : camp.numbers.length} números</span>
                      <span>✅ {camp.stats.sent} enviados</span>
                      <span>❌ {camp.stats.failed} falharam</span>
                      <span>⏳ {camp.stats.pending} pendentes</span>
                    </div>
                    {/* Progress bar */}
                    <div className="w-full bg-gray-700 rounded-full h-1.5 mt-2">
                      <div
                        className="bg-green-500 h-1.5 rounded-full transition-all"
                        style={{ width: `${((camp.stats.sent + camp.stats.failed) / camp.stats.total) * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 ml-4" onClick={e => e.stopPropagation()}>
                    {(camp.status === 'created' || camp.status === 'paused') && (
                      <button
                        onClick={() => handleAction(camp.id, 'start')}
                        className="px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded text-sm font-medium"
                      >
                        ▶️ Iniciar
                      </button>
                    )}
                    {camp.status === 'running' && (
                      <button
                        onClick={() => handleAction(camp.id, 'pause')}
                        className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 rounded text-sm font-medium"
                      >
                        ⏸️ Pausar
                      </button>
                    )}
                    {(camp.status === 'running' || camp.status === 'paused') && (
                      <button
                        onClick={() => handleAction(camp.id, 'cancel')}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded text-sm font-medium"
                      >
                        🛑 Cancelar
                      </button>
                    )}
                    {camp.status !== 'running' && (
                      <button
                        onClick={() => handleAction(camp.id, 'delete')}
                        className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Campaign Detail Modal */}
      {selectedCampaign && selectedCampaign.id && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setSelectedCampaign(null)}>
          <div className="bg-gray-900 rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold">{selectedCampaign.name}</h2>
                <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[selectedCampaign.status]}`}>
                  {statusLabels[selectedCampaign.status]}
                </span>
              </div>
              <button onClick={() => setSelectedCampaign(null)} className="text-gray-400 hover:text-white text-xl">✕</button>
            </div>

            {/* Message preview */}
            <div className="bg-gray-800 rounded-lg p-3 mb-4">
              <p className="text-sm text-gray-300">{selectedCampaign.message}</p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              <div className="text-center">
                <div className="text-xl font-bold text-green-400">{selectedCampaign.stats.sent}</div>
                <div className="text-xs text-gray-400">Enviados</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-red-400">{selectedCampaign.stats.failed}</div>
                <div className="text-xs text-gray-400">Falharam</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-yellow-400">{selectedCampaign.stats.pending}</div>
                <div className="text-xs text-gray-400">Pendentes</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold">{selectedCampaign.stats.total}</div>
                <div className="text-xs text-gray-400">Total</div>
              </div>
            </div>

            {/* Config */}
            <div className="bg-gray-800 rounded-lg p-3 mb-4 text-sm">
              <div className="grid grid-cols-2 gap-2 text-gray-400">
                <span>⏱️ Intervalo: {selectedCampaign.config.minDelay/1000}s - {selectedCampaign.config.maxDelay/1000}s</span>
                <span>📊 Máx/hora: {selectedCampaign.config.maxPerHour}</span>
                <span>🔄 Tentativas: {selectedCampaign.config.retryCount}</span>
                <span>📊 Máx/dia: {selectedCampaign.config.maxPerDay}</span>
              </div>
            </div>

            {/* Numbers list (first 20) */}
            {Array.isArray(selectedCampaign.numbers) && (
              <div className="max-h-60 overflow-y-auto">
                <h3 className="text-sm font-semibold text-gray-400 mb-2">Números</h3>
                {selectedCampaign.numbers.slice(0, 20).map((n, i) => (
                  <div key={i} className="flex items-center justify-between py-1 text-sm border-b border-gray-800">
                    <span className="font-mono">{n.phone}</span>
                    <span className={`text-xs ${
                      n.status === 'sent' ? 'text-green-400' :
                      n.status === 'failed' ? 'text-red-400' :
                      n.status === 'retrying' ? 'text-yellow-400' : 'text-gray-500'
                    }`}>
                      {n.status === 'sent' ? '✅ Enviado' :
                       n.status === 'failed' ? `❌ ${n.lastError || 'Falhou'}` :
                       n.status === 'retrying' ? `🔄 Tentativa ${n.attempts}` : '⏳ Pendente'}
                    </span>
                  </div>
                ))}
                {selectedCampaign.numbers.length > 20 && (
                  <p className="text-xs text-gray-500 mt-2">
                    ...e mais {selectedCampaign.numbers.length - 20} números
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
