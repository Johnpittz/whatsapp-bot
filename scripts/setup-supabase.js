import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nizreygwaqqojwrorpqo.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5penJleWd3YXFxb2p3cm9ycHFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyNzMxNDksImV4cCI6MjEwMTg0OTE0OX0.lHj6WC5xNXTsriupHC1DEaeXF5DGAlONfyP71YNo5ug';

const supabase = createClient(supabaseUrl, supabaseKey);

async function setup() {
  console.log('Criando tabelas no Supabase...');

  // Create conversations table
  const { error: err1 } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS conversations (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        phone VARCHAR(20) UNIQUE NOT NULL,
        contact_name VARCHAR(100),
        last_message TEXT,
        last_message_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `
  });

  if (err1) {
    console.log('Tabela conversations pode já existir ou precisa ser criada manualmente');
    console.log('Erro:', err1.message);
  } else {
    console.log('✅ Tabela conversations criada!');
  }

  // Create messages table
  const { error: err2 } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS messages (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
        direction VARCHAR(10) NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
        content TEXT NOT NULL,
        message_type VARCHAR(20) DEFAULT 'text',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `
  });

  if (err2) {
    console.log('Tabela messages pode já existir ou precisa ser criada manualmente');
    console.log('Erro:', err2.message);
  } else {
    console.log('✅ Tabela messages criada!');
  }

  // Test connection
  const { data, error } = await supabase.from('conversations').select('*').limit(1);
  if (error) {
    console.log('\n⚠️  As tabelas precisam ser criadas manualmente no Supabase Dashboard');
    console.log('Acesse: https://supabase.com/dashboard/project/nizreygwaqqojwrorpqo/sql');
    console.log('\nExecute este SQL:');
    console.log(`
CREATE TABLE IF NOT EXISTS conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone VARCHAR(20) UNIQUE NOT NULL,
  contact_name VARCHAR(100),
  last_message TEXT,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  content TEXT NOT NULL,
  message_type VARCHAR(20) DEFAULT 'text',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS (Row Level Security)
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Políticas para permitir leitura/escrita
CREATE POLICY "Allow all operations" ON conversations FOR ALL USING (true);
CREATE POLICY "Allow all operations" ON messages FOR ALL USING (true);
    `);
  } else {
    console.log('\n✅ Conexão OK! Tabelas funcionando.');
  }
}

setup();
