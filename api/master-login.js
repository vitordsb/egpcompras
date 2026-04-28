import { createSessionToken, credentialsAreValid, setMasterCookie } from './_master-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }
  const { login, password } = req.body || {};
  if (!credentialsAreValid(String(login || ''), String(password || ''))) {
    return res.status(401).json({ error: 'Login ou senha inválidos.' });
  }
  setMasterCookie(res, createSessionToken());
  return res.status(200).json({ authenticated: true, master: true });
}
