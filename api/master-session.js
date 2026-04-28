import { isValidSessionToken, readCookie } from './_master-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método não permitido.' });
  }
  return res.status(200).json({
    authenticated: isValidSessionToken(readCookie(req)),
    master: isValidSessionToken(readCookie(req)),
  });
}
