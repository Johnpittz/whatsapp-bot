'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

// Use Vercel proxy API routes (avoids mixed content HTTPS→HTTP)
const API_URL = '';

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
  media_url: string | null;
  file_name: string | null;
  created_at: string;
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    loadConversations();
    const interval = setInterval(loadConversations, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadConversations() {
    setLoading(true);
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .order('last_message_at', { ascending: false });

    if (data) setConversations(data);
    setLoading(false);
  }

  async function loadMessages(conversation: Conversation) {
    setSelectedConversation(conversation);
    const { data } = await supabase
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

  async function sendMessage() {
    if (!messageText.trim() || !selectedConversation) return;
    setSending(true);
    try {
      await fetch(`/api/send/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: selectedConversation.phone,
          text: messageText.trim()
        })
      });
      setMessageText('');
      setTimeout(() => loadMessages(selectedConversation), 1000);
    } catch (err) {
      console.error('Erro ao enviar:', err);
    }
    setSending(false);
  }

  async function sendFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedConversation) return;

    setSending(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;
        const isAudio = file.type.startsWith('audio/');
        const isVideo = file.type.startsWith('video/');
        const isImage = file.type.startsWith('image/');

        let mediatype = 'document';
        if (isImage) mediatype = 'image';
        else if (isAudio) mediatype = 'audio';
        else if (isVideo) mediatype = 'video';

        await fetch(`/api/send/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            number: selectedConversation.phone,
            mediatype,
            mimetype: file.type,
            media: base64,
            fileName: file.name,
            caption: isImage || isVideo ? file.name : undefined
          })
        });
        setTimeout(() => loadMessages(selectedConversation), 1000);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Erro ao enviar arquivo:', err);
    }
    setSending(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
        stream.getTracks().forEach(track => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm;codecs=opus' });
        
        // Convert to base64
        const reader = new FileReader();
        reader.onload = async () => {
          const dataUrl = reader.result as string;
          // Strip data URL prefix: "data:audio/webm;codecs=opus;base64," → just base64
          const base64 = dataUrl.split(',')[1] || dataUrl;
          if (!selectedConversation) return;
          
          setSending(true);
          try {
            await fetch(`/api/send/media`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                number: selectedConversation.phone,
                mediatype: 'audio',
                mimetype: 'audio/ogg; codecs=opus',
                media: base64,
              })
            });
            setTimeout(() => loadMessages(selectedConversation), 1000);
          } catch (err) {
            console.error('Erro ao enviar áudio:', err);
          }
          setSending(false);
        };
        reader.readAsDataURL(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      // Timer
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Erro ao acessar microfone:', err);
      alert('Não foi possível acessar o microfone. Verifique as permissões do navegador.');
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

  function formatRecordingTime(seconds: number) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleString('pt-BR');
  }

  // All media goes through Vercel proxy (avoids Mixed Content HTTPS→HTTP)
  function mediaUrl(url: string | null, type: string = 'image') {
    if (!url) return '';
    // data URLs pass through directly
    if (url.startsWith('data:')) return url;
    // Everything else goes through the Vercel API proxy
    return `/api/media?url=${encodeURIComponent(url)}&type=${type}`;
  }

  function renderMessageContent(msg: Message) {
    const type = msg.message_type || 'text';

    if (type === 'image' && msg.media_url) {
      return (
        <div>
          <img src={mediaUrl(msg.media_url, "image")} alt="Imagem" className="rounded-lg max-w-full max-h-64 mb-1 cursor-pointer hover:opacity-90" onClick={() => window.open(mediaUrl(msg.media_url, 'image'), '_blank')} />
          {msg.content && msg.content !== '[image]' && <p className="whitespace-pre-wrap">{msg.content}</p>}
        </div>
      );
    }

    if (type === 'video' && msg.media_url) {
      return (
        <div>
          <video src={mediaUrl(msg.media_url, "video")} controls className="rounded-lg max-w-full max-h-64 mb-1" />
          {msg.content && msg.content !== '[video]' && <p className="whitespace-pre-wrap">{msg.content}</p>}
        </div>
      );
    }

    if (type === 'audio') {
      return (
        <div className="flex items-center gap-2 min-w-[200px]">
          <span className="text-lg">🎵</span>
          <audio src={mediaUrl(msg.media_url, "audio") || undefined} controls className="flex-1 h-8" style={{ filter: 'invert(1) hue-rotate(180deg)' }} />
        </div>
      );
    }

    if (type === 'document') {
      return (
        <a href={mediaUrl(msg.media_url, 'document') || '#'} target="_blank" rel="noopener noreferrer"
           className="flex items-center gap-2 text-white hover:underline">
          <span className="text-2xl">📄</span>
          <div>
            <p className="font-medium">{msg.file_name || 'Documento'}</p>
            <p className="text-xs opacity-60">Clique para baixar</p>
          </div>
        </a>
      );
    }

    if (type === 'sticker') {
      return msg.media_url
        ? <img src={mediaUrl(msg.media_url, "sticker")} alt="Sticker" className="max-h-32" />
        : <p className="whitespace-pre-wrap">{msg.content}</p>;
    }

    if (type === 'location') {
      return (
        <div className="flex items-center gap-2">
          <span className="text-lg">📍</span>
          <p>{msg.content}</p>
        </div>
      );
    }

    if (type === 'contact') {
      return (
        <div className="flex items-center gap-2">
          <span className="text-lg">👤</span>
          <p>{msg.content}</p>
        </div>
      );
    }

    return <p className="whitespace-pre-wrap">{msg.content}</p>;
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" style={{ height: 'calc(100vh - 140px)' }}>
          {/* Lista de Conversas */}
          <div className="lg:col-span-1 bg-gray-900 rounded-xl p-4 flex flex-col">
            <div className="mb-4">
              <input
                type="text"
                placeholder="🔍 Buscar por telefone ou nome..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); searchConversations(); }}
                className="w-full bg-gray-800 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div className="space-y-2 flex-1 overflow-y-auto">
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
                <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: 'calc(100vh - 320px)' }}>
                  {messages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-lg px-4 py-2 ${
                        msg.direction === 'outgoing'
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-800 text-gray-200'
                      }`}>
                        {renderMessageContent(msg)}
                        <p className="text-xs opacity-50 mt-1">{formatDate(msg.created_at)}</p>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="border-t border-gray-800 p-4">
                  {isRecording ? (
                    /* Recording UI */
                    <div className="flex items-center gap-3">
                      <div className="flex-1 flex items-center gap-3 bg-red-900/30 rounded-lg px-4 py-3">
                        <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                        <span className="text-red-400 font-mono text-sm">{formatRecordingTime(recordingTime)}</span>
                        <span className="text-gray-400 text-sm">Gravando áudio...</span>
                      </div>
                      <button
                        onClick={stopRecording}
                        className="bg-red-600 hover:bg-red-500 rounded-full p-3 transition"
                        title="Parar gravação e enviar"
                      >
                        ⏹
                      </button>
                    </div>
                  ) : (
                    /* Normal Input */
                    <div className="flex items-center gap-3">
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={sendFile}
                        accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                        className="hidden"
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={sending}
                        className="bg-gray-700 hover:bg-gray-600 rounded-full p-3 transition disabled:opacity-50"
                        title="Enviar arquivo"
                      >
                        📎
                      </button>
                      <button
                        onClick={startRecording}
                        disabled={sending}
                        className={`rounded-full p-3 transition disabled:opacity-50 ${
                          isRecording ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'
                        }`}
                        title="Gravar áudio"
                      >
                        🎤
                      </button>
                      <input
                        type="text"
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                        placeholder="Digite sua mensagem..."
                        disabled={sending}
                        className="flex-1 bg-gray-800 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                      />
                      <button
                        onClick={sendMessage}
                        disabled={sending || !messageText.trim()}
                        className="bg-green-600 hover:bg-green-500 rounded-full p-3 transition disabled:opacity-50"
                        title="Enviar mensagem"
                      >
                        {sending ? '⏳' : '➤'}
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                <p>Selecione uma conversa para ver as mensagens</p>
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
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
