// Consulta o status da Conta Comercial Oficial (OBA) na Meta WhatsApp Business API.
// Endpoint: GET /{phone-number-id}?fields=official_business_account

const WA_TOKEN    = Deno.env.get('WA_TOKEN') ?? '';
const WA_PHONE_ID = Deno.env.get('WA_PHONE_ID') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  if (!WA_TOKEN || !WA_PHONE_ID) {
    return new Response(JSON.stringify({ error: 'WA_TOKEN ou WA_PHONE_ID não configurado' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = `https://graph.facebook.com/v25.0/${WA_PHONE_ID}?fields=official_business_account,verified_name,display_phone_number,quality_rating,name_status,code_verification_status`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${WA_TOKEN}` },
    });
    const json = await res.json();

    if (!res.ok) {
      return new Response(JSON.stringify({ error: json.error?.message ?? 'Falha ao consultar Meta', details: json }), {
        status: res.status, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      phone_id: json.id,
      display_phone_number: json.display_phone_number ?? null,
      verified_name: json.verified_name ?? null,
      name_status: json.name_status ?? null,
      quality_rating: json.quality_rating ?? null,
      code_verification_status: json.code_verification_status ?? null,
      oba_status: json.official_business_account?.oba_status ?? 'NOT_STARTED',

      checked_at: new Date().toISOString(),
    }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
