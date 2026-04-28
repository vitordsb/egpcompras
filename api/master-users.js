import { createClient } from '@supabase/supabase-js';
import { requireAccessAdmin } from './_master-auth.js';

function getAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Configure SUPABASE_SERVICE_ROLE_KEY e SUPABASE_URL/VITE_SUPABASE_URL.');
  }
  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    created_at: user.created_at,
    last_sign_in_at: user.last_sign_in_at,
  };
}

export default async function handler(req, res) {
  let supabase;
  try {
    supabase = getAdminClient();
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }

  if (!(await requireAccessAdmin(req, res, supabase))) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ users: data.users.map(publicUser) });
  }

  if (req.method === 'POST') {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Informe email e senha.' });
    }
    const { data, error } = await supabase.auth.admin.createUser({
      email: String(email).trim().toLowerCase(),
      password: String(password),
      email_confirm: true,
    });
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ user: publicUser(data.user) });
  }

  if (req.method === 'PATCH') {
    const { user_id: userId, password } = req.body || {};
    if (!userId || !password) {
      return res.status(400).json({ error: 'Informe user_id e nova senha.' });
    }
    const { data, error } = await supabase.auth.admin.updateUserById(String(userId), {
      password: String(password),
    });
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ user: publicUser(data.user) });
  }

  if (req.method === 'DELETE') {
    const userId = req.query?.id;
    if (!userId) return res.status(400).json({ error: 'Informe id.' });
    const { error } = await supabase.auth.admin.deleteUser(String(userId));
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ deleted: true });
  }

  res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
  return res.status(405).json({ error: 'Método não permitido.' });
}
