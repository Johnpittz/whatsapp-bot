'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface Conversation {
  id: string;
  phone: string;
  contact_name: string | null;
  last_message: string | null;
  last_message_at: string;
  created_at: string;
}

interface Message {
  id: string;
  conversation_id: string;
  direction: 'incoming' | 'outgoing';
  content: string;
  message_type: string;
  created_at: string;
}

export default function Dashboard() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConversations();
    // Auto-refresh a cada 30 segundos
    const interval = setInterval(loadConversations, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadConversations() {
    setLoading(true);
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .order('last_message_at', { ascending: false });

    if (data) setConversations(data);
    setLoading(false);
  }

  async function loadMessages(conversation: Conversation) {
    setSelectedConversation(conversation);
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true });

    if (data) setMessages(data);
  }

  async function searchConversations() {
    if (!searchQuery) {
      loadConversations();
      return;
    }

    const { data } = await supabase
      .from('conversations')
      .select('*')
      .or(`phone.ilike.%${searchQuery}%,contact_name.ilike.%${searchQuery}%`)
      .order('last_message_at', { ascending: false });

    if (data) setConversations(data);
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleString('pt-BR');
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto p-4">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">💬 Dashboard de Conversas</h1>
          <p className="text-gray-400">Histórico completo de atendimentos via WhatsApp</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Lista de Conversas */}
          <div className="lg:col-span-1 bg-gray-900 rounded-xl p-4">
            <div className="mb-4">
              <input
                type="text"
                placeholder="🔍 Buscar por telefone ou nome..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  searchConversations();
                }}
                className="w-full bg-gray-800 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {loading ? (
                <p className="text-gray-500 text-center py-8">Carregando...</p>
              ) : conversations.length === 0 ? (
                <p className="text-gray-500 text-center py-8">Nenhuma conversa encontrada</p>
              ) : (
                conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => loadMessages(conv)}
                    className={`w-full text-left p-4 rounded-lg transition ${
                      selectedConversation?.id === conv.id
                        ? 'bg-green-600'
                        : 'bg-gray-800 hover:bg-gray-750'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-semibold">{conv.phone}</p>
                        {conv.contact_name && (
                          <p className="text-sm text-gray-400">{conv.contact_name}</p>
                        )}
                      </div>
                      <span className="text-xs text-gray-500">
                        {formatDate(conv.last_message_at)}
                      </span>
                    </div>
                    {conv.last_message && (
                      <p className="text-sm text-gray-400 mt-1 truncate">
                        {conv.last_message}
                      </p>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Mensagens */}
          <div className="lg:col-span-2 bg-gray-900 rounded-xl p-4">
            {selectedConversation ? (
              <>
                <div className="border-b border-gray-800 pb-4 mb-4">
                  <h2 className="text-xl font-bold">{selectedConversation.phone}</h2>
                  {selectedConversation.contact_name && (
                    <p className="text-gray-400">{selectedConversation.contact_name}</p>
                  )}
                </div>

                <div className="space-y-4 max-h-[500px] overflow-y-auto">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[70%] rounded-lg px-4 py-2 ${
                          msg.direction === 'outgoing'
                            ? 'bg-green-600 text-white'
                            : 'bg-gray-800 text-gray-200'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        <p className="text-xs opacity-60 mt-1">
                          {formatDate(msg.created_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-[500px] text-gray-500">
                <p>Selecione uma conversa para ver as mensagens</p>
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
          <div className="bg-gray-900 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-green-500">{conversations.length}</p>
            <p className="text-gray-400 text-sm">Conversas</p>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-blue-500">{messages.length}</p>
            <p className="text-gray-400 text-sm">Mensagens</p>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-purple-500">
              {messages.filter(m => m.direction === 'incoming').length}
            </p>
            <p className="text-gray-400 text-sm">Recebidas</p>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-yellow-500">
              {messages.filter(m => m.direction === 'outgoing').length}
            </p>
            <p className="text-gray-400 text-sm">Enviadas</p>
          </div>
        </div>
      </div>
    </div>
  );
}
