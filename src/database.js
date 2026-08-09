import { createClient } from '@supabase/supabase-js';
import { env } from './config.js';

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

/**
 * Salva ou atualiza uma conversa
 */
export async function upsertConversation(phone, contactName = null) {
  const { data, error } = await supabase
    .from('conversations')
    .upsert(
      { phone, contact_name: contactName, updated_at: new Date() },
      { onConflict: 'phone' }
    )
    .select()
    .single();

  if (error) {
    console.error('Erro ao salvar conversa:', error.message);
    return null;
  }
  return data;
}

/**
 * Salva uma mensagem no banco
 */
export async function saveMessage(conversationId, direction, content, messageType = 'text') {
  const { error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      direction,
      content,
      message_type: messageType
    });

  if (error) {
    console.error('Erro ao salvar mensagem:', error.message);
    return false;
  }
  return true;
}

/**
 * Atualiza a última mensagem da conversa
 */
export async function updateLastMessage(phone, lastMessage) {
  const { error } = await supabase
    .from('conversations')
    .update({
      last_message: lastMessage,
      last_message_at: new Date(),
      updated_at: new Date()
    })
    .eq('phone', phone);

  if (error) {
    console.error('Erro ao atualizar conversa:', error.message);
  }
}

/**
 * Busca conversas com paginação
 */
export async function getConversations(page = 1, limit = 50) {
  const offset = (page - 1) * limit;

  const { data, error, count } = await supabase
    .from('conversations')
    .select('*', { count: 'exact' })
    .order('last_message_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('Erro ao buscar conversas:', error.message);
    return { data: [], total: 0 };
  }

  return { data, total: count };
}

/**
 * Busca mensagens de uma conversa
 */
export async function getMessages(conversationId, page = 1, limit = 50) {
  const offset = (page - 1) * limit;

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('Erro ao buscar mensagens:', error.message);
    return [];
  }

  return data;
}

/**
 * Busca conversas por telefone ou nome
 */
export async function searchConversations(query) {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .or(`phone.ilike.%${query}%,contact_name.ilike.%${query}%`)
    .order('last_message_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Erro ao buscar conversas:', error.message);
    return [];
  }

  return data;
}
