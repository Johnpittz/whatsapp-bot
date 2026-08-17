'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

const API_BASE = '';

interface Conversation {
  id: string;
  phone: string;
  contact_name: string | null;
  last_message: string | null;
  last_message_at: string;
}

interface Message {
  id: string;
  conversation_id: string;
  direction: 'incoming' | 'outgoing';
  content: string;
  message_type: string;
  media_url: string | null;
  file_name: string | null;
  created_at: string;
}

interface GlobalStats {
  totalConversations: number;
  totalMessages: number;
  totalIncoming: number;
  totalOutgoing: number;
}

export default function Dashboard() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [globalStats, setGlobalStats] = useState<GlobalStats>({ totalConversations: 0, totalMessages: 0, totalIncoming: 0, totalOutgoing: 0 });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Load global stats (separate from conversation messages)
  const loadGlobalStats = useCallback(async () => {
    try {
      const [convRes, msgRes, inRes, outRes] = await Promise.all([
        supabase.from('conversations').select('id', { count: 'exact', head: true }),
        supabase.from('messages').select('id', { count: 'exact', head: true }),
        supabase.from('messages').select('id', { count: 'exact', head: true }).eq('direction', 'incoming'),
        supabase.from('messages').select('id', { count: 'exact', head: true }).eq('direction', 'outgoing'),
      ]);
      setGlobalStats({
        totalConversations: convRes.count || 0,
        totalMessages: msgRes.count || 0,
        totalIncoming: inRes.count || 0,
        totalOutgoing: outRes.count || 0,
      });
    } catch (e) {
      console.error('Erro ao carregar stats:', e);
    }
  }, []);

  // Load conversations without resetting scroll
  const loadConversations = useCallback(async () => {
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .order('last_message_at', { ascending: false });

    if (data) setConversations(data);
    setLoading(false);
    loadGlobalStats();
  }, [loadGlobalStats]);

  useEffect(() => {
    loadConversations();
    const interval = setInterval(loadConversations, 15000);
    return () => clearInterval(interval);
  }, [loadConversations]);

  // Only scroll to bottom when user sends a message or loads a new conversation
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  async function loadMessages(conversation: Conversation) {
    setSelectedConversation(conversation);
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true });

    if (data) setMessages(data);
    // Scroll to bottom when opening a new conversation
    setTimeout(scrollToBottom, 100);
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

  async function sendMessage() {
    if (!messageText.trim() || !selectedConversation) return;
    setSending(true);
    try {
      const resp = await fetch(`${API_BASE}/api/send/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: selectedConversation.phone,
          text: messageText,
        }),
      });

      if (resp.ok) {
        setMessageText('');
        // Reload messages and scroll to bottom
        await loadMessages(selectedConversation);
        scrollToBottom();
      }
    } catch (err) {
      console.error('Erro ao enviar:', err);
    } finally {
      setSending(false);
    }
  }

  async function sendFile() {
    const file = fileInputRef.current?.files?.[0];
    if (!file || !selectedConversation) return;

    setSending(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const isImage = file.type.startsWith('image/');
        const isAudio = file.type.startsWith('audio/');
        const isVideo = file.type.startsWith('video/');

        let mediatype = 'document';
        if (isImage) mediatype = 'image';
        else if (isAudio) mediatype = 'audio';
        else if (isVideo) mediatype = 'video';

        const resp = await fetch(`${API_BASE}/api/send/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            number: selectedConversation.phone,
            mediatype,
            mimetype: file.type,
            media: base64,
            fileName: file.name,
          }),
        });

        if (resp.ok) {
          await loadMessages(selectedConversation);
          scrollToBottom();
        }
        setSending(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Erro ao enviar arquivo:', err);
      setSending(false);
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm;codecs=opus' });
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(',')[1];

          if (selectedConversation) {
            try {
              await fetch(`${API_BASE}/api/send/media`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  number: selectedConversation.phone,
                  mediatype: 'audio',
                  mimetype: 'audio/ogg; codecs=opus',
                  media: base64,
                }),
              });
              await loadMessages(selectedConversation);
              scrollToBottom();
            } catch (err) {
              console.error('Erro ao enviar áudio:', err);
            }
          }
        };
        reader.readAsDataURL(audioBlob);

        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Erro ao iniciar gravação:', err);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
    }
    setIsRecording(false);
    setRecordingTime(0);
  }

  // All media goes through Vercel proxy (avoids Mixed Content HTTPS→HTTP)
  function mediaUrl(url: string | null, type: string = 'image') {
    if (!url) return null;
    // Already a proxy URL or blob
    if (url.startsWith('/api/') || url.startsWith('blob:')) return url;
    // Everything else goes through the Vercel API proxy
    return `/api/media?url=${encodeURIComponent(url)}&type=${type}`;
  }

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function renderMessage(msg: Message) {
    const isOutgoing = msg.direction === 'outgoing';
    const type = msg.message_type || 'text';

    if (type === 'image' && msg.media_url) {
      return (
        <div key={msg.id} className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'} mb-2`}>
          <div className={`${isOutgoing ? 'bg-green-800' : 'bg-gray-700'} rounded-lg overflow-hidden max-w-xs`}>
            <img src={mediaUrl(msg.media_url, "image")} alt="Imagem" className="rounded-lg max-w-full max-h-64 mb-1 cursor-pointer hover:opacity-90" onClick={() => window.open(mediaUrl(msg.media_url, 'image'), '_blank')} />
            {msg.content && msg.content !== '[image]' && <p className="px-3 pb-2 text-sm">{msg.content}</p>}
            <p className={`text-xs ${isOutgoing ? 'text-green-200' : 'text-gray-400'} px-3 pb-1`}>{formatDate(msg.created_at)}</p>
          </div>
        </div>
      );
    }

    if (type === 'video' && msg.media_url) {
      return (
        <div key={msg.id} className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'} mb-2`}>
          <div className={`${isOutgoing ? 'bg-green-800' : 'bg-gray-700'} rounded-lg overflow-hidden max-w-xs`}>
            <video src={mediaUrl(msg.media_url, "video")} controls className="rounded-lg max-w-full max-h-64 mb-1" />
            <p className={`text-xs ${isOutgoing ? 'text-green-200' : 'text-gray-400'} px-3 pb-1`}>{formatDate(msg.created_at)}</p>
          </div>
        </div>
      );
    }

    if (type === 'audio') {
      return (
        <div key={msg.id} className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'} mb-2`}>
          <div className={`${isOutgoing ? 'bg-green-800' : 'bg-gray-700'} rounded-lg p-3 max-w-xs`}>
            <div className="flex items-center gap-2">
              <span className="text-lg">🎵</span>
              <audio src={mediaUrl(msg.media_url, "audio") || undefined} controls className="flex-1 h-8" style={{ filter: 'invert(1) hue-rotate(180deg)' }} />
            </div>
            <p className={`text-xs ${isOutgoing ? 'text-green-200' : 'text-gray-400'} mt-1`}>{formatDate(msg.created_at)}</p>
          </div>
        </div>
      );
    }

    if (type === 'document') {
      return (
        <div key={msg.id} className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'} mb-2`}>
          <div className={`${isOutgoing ? 'bg-green-800' : 'bg-gray-700'} rounded-lg p-3 max-w-xs`}>
            <a href={mediaUrl(msg.media_url, 'document') || '#'} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 text-blue-400 hover:text-blue-300">
              <span className="text-2xl">📄</span>
              <span className="text-sm truncate">{msg.file_name || 'Documento'}</span>
            </a>
            <p className={`text-xs ${isOutgoing ? 'text-green-200' : 'text-gray-400'} mt-1`}>{formatDate(msg.created_at)}</p>
          </div>
        </div>
      );
    }

    if (type === 'sticker') {
      return (
        <div key={msg.id} className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'} mb-2`}>
          return msg.media_url
            ? <img src={mediaUrl(msg.media_url, "sticker")} alt="Sticker" className="max-h-32" />
            : null
        </div>
      );
    }

    // Default: text
    return (
      <div key={msg.id} className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'} mb-2`}>
        <div className={`${isOutgoing ? 'bg-green-800' : 'bg-gray-700'} rounded-lg px-4 py-2 max-w-md`}>
          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
          <p className={`text-xs ${isOutgoing ? 'text-green-200' : 'text-gray-400'} mt-1`}>{formatDate(msg.created_at)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto p-4">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">💬 Dashboard de Conversas</h1>
            <p className="text-gray-400">Envie e receba mensagens, áudios, imagens e documentos</p>
          </div>
          <a href="/bulk" className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium transition">
            📨 Disparo em Massa
          </a>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" style={{ height: 'calc(100vh - 180px)' }}>
          {/* Lista de Conversas */}
          <div className="lg:col-span-1 bg-gray-900 rounded-xl p-4 flex flex-col">
            <div className="mb-4">
              <input
                type="text"
                placeholder="🔍 Buscar por telefone ou nome..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); searchConversations(); }}
                className="w-full bg-gray-800 rounded-lg px-4 py-2 text-white placeholder-gray-500 border border-gray-700 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {loading ? (
                <p className="text-gray-400 text-center py-4">Carregando...</p>
              ) : conversations.length === 0 ? (
                <p className="text-gray-400 text-center py-4">Nenhuma conversa encontrada</p>
              ) : (
                conversations.map(conv => (
                  <button
                    key={conv.id}
                    onClick={() => loadMessages(conv)}
                    className={`w-full text-left p-3 rounded-lg transition ${
                      selectedConversation?.id === conv.id
                        ? 'bg-green-600'
                        : 'bg-gray-800 hover:bg-gray-700'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-semibold">{conv.contact_name || conv.phone}</p>
                        {conv.contact_name && <p className="text-sm text-gray-400">{conv.phone}</p>}
                      </div>
                      <span className="text-xs text-gray-500">{formatDate(conv.last_message_at)}</span>
                    </div>
                    {conv.last_message && (
                      <p className="text-sm text-gray-400 mt-1 truncate">{conv.last_message}</p>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Chat Area */}
          <div className="lg:col-span-2 bg-gray-900 rounded-xl flex flex-col">
            {selectedConversation ? (
              <>
                {/* Chat Header */}
                <div className="border-b border-gray-800 p-4">
                  <h2 className="text-xl font-bold">{selectedConversation.contact_name || selectedConversation.phone}</h2>
                  {selectedConversation.contact_name && (
                    <p className="text-gray-400">{selectedConversation.phone}</p>
                  )}
                </div>

                {/* Messages */}
                <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4">
                  {messages.map(msg => renderMessage(msg))}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="border-t border-gray-800 p-4">
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                      onChange={sendFile}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="p-2 bg-gray-800 rounded-lg hover:bg-gray-700 transition"
                      title="Enviar arquivo"
                    >
                      📎
                    </button>

                    {isRecording ? (
                      <div className="flex items-center gap-2">
                        <span className="text-red-500 animate-pulse">🔴</span>
                        <span className="text-sm">{formatTime(recordingTime)}</span>
                        <button
                          onClick={stopRecording}
                          className="p-2 bg-red-600 rounded-lg hover:bg-red-700 transition"
                        >
                          ⏹️
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={startRecording}
                        className="p-2 bg-gray-800 rounded-lg hover:bg-gray-700 transition"
                        title="Gravar áudio"
                      >
                        🎤
                      </button>
                    )}

                    <input
                      type="text"
                      value={messageText}
                      onChange={e => setMessageText(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                      placeholder="Digite sua mensagem..."
                      className="flex-1 bg-gray-800 rounded-lg px-4 py-2 text-white placeholder-gray-500 border border-gray-700 focus:border-blue-500 focus:outline-none"
                      disabled={sending}
                    />

                    <button
                      onClick={sendMessage}
                      disabled={sending || !messageText.trim()}
                      className="p-2 bg-green-600 rounded-lg hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {sending ? '⏳' : '📤'}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                <p>Selecione uma conversa para ver as mensagens</p>
              </div>
            )}
          </div>
        </div>

        {/* Stats - using global counts, not per-conversation */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="bg-gray-900 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-green-500">{globalStats.totalConversations}</p>
            <p className="text-gray-400 text-sm">Conversas</p>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-blue-500">{globalStats.totalMessages}</p>
            <p className="text-gray-400 text-sm">Mensagens</p>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-purple-500">{globalStats.totalIncoming}</p>
            <p className="text-gray-400 text-sm">Recebidas</p>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-yellow-500">{globalStats.totalOutgoing}</p>
            <p className="text-gray-400 text-sm">Enviadas</p>
          </div>
        </div>
      </div>
    </div>
  );
}
