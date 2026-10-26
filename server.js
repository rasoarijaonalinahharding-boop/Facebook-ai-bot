import express from 'express';
import crypto from 'node:crypto';

const app = express();
app.disable('x-powered-by');
app.use(express.json({
  limit: '1mb',
  verify: (req, res, buffer) => { req.rawBody = buffer; }
}));

const PORT = Number(process.env.PORT || 10000);
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || '';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || '';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const FB_API_VERSION = process.env.FB_API_VERSION || 'v26.0';
const MAX_HISTORY_MESSAGES = 8;
const MAX_MESSAGE_CHARS = 1800;
const MAX_INPUT_CHARS = 4000;
const rateWindows = new Map();

// History remains in memory only; restarting the service clears it.
const histories = new Map();
const seenEvents = new Map();

const SYSTEM_PROMPT = `Ianao no AI Assistant amin'ny Facebook Messenger. Valio amin'ny teny ampiasain'ny olona: Malagasy raha Malagasy, Français raha Français, English raha English. Mahaiza manampy, mazava, sariaka, ary marina. Raha tsy azonao antoka ny vaovao, lazao mazava. Raha manontany momba ny zava-mitranga ankehitriny ny olona, ampiasao ny web search raha misy. Aza mamorona loharano na rohy. Ataovy mora vakina amin'ny Messenger ny valiny.`;

app.get('/', (req, res) => {
  res.status(200).send('🤖 Facebook AI Bot is running.');
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    ready: Boolean(GROQ_API_KEY && PAGE_ACCESS_TOKEN && VERIFY_TOKEN && META_APP_SECRET),
    service: 'facebook-ai-bot-groq-free',
    models: { chat: GROQ_MODEL, webSearch: 'browser_search (model-supported)' },
    graphApiVersion: FB_API_VERSION,
    configured: {
      groqApiKey: Boolean(GROQ_API_KEY),
      pageAccessToken: Boolean(PAGE_ACCESS_TOKEN),
      verifyToken: Boolean(VERIFY_TOKEN),
      metaAppSecret: Boolean(META_APP_SECRET)
    }
  });
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && VERIFY_TOKEN && token === VERIFY_TOKEN) {
    console.log('✅ Meta webhook verified.');
    return res.status(200).type('text/plain').send(String(challenge || ''));
  }
  return res.sendStatus(403);
});

function validMetaSignature(req) {
  // Fail closed: never accept unsigned webhooks when the Meta App Secret is missing.
  if (!META_APP_SECRET) return false;
  const signature = req.get('x-hub-signature-256');
  if (!signature || !signature.startsWith('sha256=') || !req.rawBody) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', META_APP_SECRET)
    .update(req.rawBody)
    .digest('hex');
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

app.post('/webhook', (req, res) => {
  if (!META_APP_SECRET) {
    console.error('Webhook rejected: META_APP_SECRET is not configured.');
    return res.status(503).send('Webhook signature validation is not configured.');
  }
  if (!validMetaSignature(req)) {
    console.warn('Rejected webhook: invalid Meta signature.');
    return res.sendStatus(401);
  }

  const body = req.body;
  if (!body || body.object !== 'page') return res.sendStatus(404);

  // Return 200 quickly, then work on events so Meta won't time out the webhook.
  res.status(200).send('EVENT_RECEIVED');
  for (const entry of (body.entry || [])) {
    for (const event of (entry.messaging || [])) {
      void processMessengerEvent(event).catch((error) => {
        console.error('Messenger event processing failed:', error?.message || error);
      });
    }
  }
});

app.use((err, req, res, next) => {
  console.error('Express error:', err?.message || err);
  if (res.headersSent) return next(err);
  res.status(400).send('Bad request');
});

function rememberEvent(key) {
  if (!key) return false;
  if (seenEvents.has(key)) return true;
  seenEvents.set(key, Date.now());
  if (seenEvents.size > 5000) {
    const oldestKey = seenEvents.keys().next().value;
    if (oldestKey) seenEvents.delete(oldestKey);
  }
  return false;
}

async function processMessengerEvent(event) {
  const senderId = event?.sender?.id;
  if (!senderId || event.message?.is_echo) return;

  const messageId = event.message?.mid || event.postback?.mid ||
    `${senderId}:${event.timestamp || ''}:${event.message?.text || event.postback?.payload || ''}`;
  if (rememberEvent(messageId)) return;

  const payload = event.postback?.payload || event.message?.quick_reply?.payload || '';
  if (payload) {
    await handlePayload(senderId, payload);
    return;
  }

  const message = event.message || {};
  const text = String(message.text || '').trim().slice(0, MAX_INPUT_CHARS);
  const attachment = (message.attachments || [])[0];

  if (attachment) {
    if (attachment.type === 'image') {
      await sendText(senderId, '🖼️ Tsy mbola afaka mandinika sary ity kinova maimaim-poana mampiasa Groq GPT-OSS ity. Afaka manoratra ny fanontanianao na mamaritra izay hita amin’ilay sary ianao.');
      return;
    }
    await sendText(senderId,
      '📎 Voaray ilay fichier, fa amin’ity kinova ity dia tsy mbola vakiana mivantana ny PDF/Word/audio. Apetaho eto ny ampahany amin’ny soratra na soraty ny fanontanianao.');
    return;
  }

  if (text) await handleText(senderId, text);
}

async function handlePayload(senderId, payload) {
  switch (payload) {
    case 'CHAT_AI':
      await sendText(senderId, '🤖 Alefaso eto ny fanontanianao dia hamaly anao aho.');
      return;
    case 'SEARCH':
      await sendText(senderId, '🔎 Fikarohana Internet: soraty /search arahin’ny fanontanianao.\nOhatra: /search vaovao farany momba ny teknolojia');
      return;
    case 'IMAGE':
      await sendText(senderId, '🖼️ Tsy tafiditra amin’ity API maimaim-poana ity ny famoronana sary. Ity bot ity dia natao ho an’ny Chat AI sy recherche Internet.');
      return;
    case 'VIDEO':
      await sendText(senderId, '🎬 Tsy tafiditra amin’ity API maimaim-poana ity ny famoronana vidéo. Ity bot ity dia natao ho an’ny Chat AI sy recherche Internet.');
      return;
    case 'VOICE':
      await sendText(senderId, '🔊 Tsy misy famoronana feo (text-to-speech) ao amin’ity kinova maimaim-poana ity.');
      return;
    case 'FILE':
      await sendText(senderId, '📎 Tsy mbola mamaky mivantana PDF/Word na mandinika sary ity kinova maimaim-poana ity.');
      return;
    case 'SHOP':
      await sendText(senderId, '🛍️ Business mode: soraty /business arahin’ny zavatra ilainao. Ohatra: /business manorata annonce hivarotana tee-shirt 25 000 Ar');
      return;
    case 'HELP':
    case 'GET_STARTED':
      await sendHelp(senderId);
      return;
    case 'RESET_CHAT':
      histories.delete(senderId);
      await sendText(senderId, '✅ Voafafa ny tantaran’ny resaka tamin’ity bot ity. Afaka manomboka vaovao ianao.');
      return;
    default:
      await sendText(senderId, 'Tsy fantatro io safidy io. Soraty /help hijerena ny baiko misy.');
  }
}

async function handleText(senderId, rawText) {
  if (!allowRate(senderId, 'messages', 30, 60_000)) {
    return sendText(senderId, '⏳ Betsaka loatra ny hafatra nalefanao tao anatin’ny iray minitra. Andraso kely dia tohizo indray.');
  }
  rawText = String(rawText || '').slice(0, MAX_INPUT_CHARS);
  const lower = rawText.toLowerCase().trim();

  if (/^(hi|hello|salama|bonjour|manao ahoana|hey|menu)$/i.test(lower)) {
    await sendWelcome(senderId);
    return;
  }
  if (lower === '/help' || lower === 'help' || lower === 'fanampiana') {
    await sendHelp(senderId);
    return;
  }
  if (lower === '/reset' || lower === '/clear') {
    histories.delete(senderId);
    await sendText(senderId, '✅ Nodiovina ny tantaran’ny resaka. Afaka manoratra fanontaniana vaovao ianao.');
    return;
  }
  if (lower === '/model' || lower === '/status') {
    await sendText(senderId,
      `🤖 AI API: Groq Free Tier\n🧠 Chat model: ${GROQ_MODEL}\n🔎 Recherche: Groq browser_search (model-supported)\n🌐 Graph API: ${FB_API_VERSION}\n\nMety hisy fetra isan’andro/minitra amin’ny free tier. Ampiasao /models hijerena ny model IDs azon’ny API key-nao ampiasaina.`);
    return;
  }
  if (lower === '/models' || lower === '/model-check') {
    return listAvailableGroqModels(senderId);
  }

  if (lower === '/search' || lower.startsWith('/search ')) {
    const prompt = rawText.slice(7).trim();
    if (!prompt) return sendText(senderId, 'Soraty ny fanontaniana aorian’ny /search.');
    return answerWithGroq(senderId, prompt, true);
  }
  if (lower === '/image' || lower.startsWith('/image ')) {
    const prompt = rawText.slice(6).trim();
    if (!prompt) return sendText(senderId, 'Soraty ny famaritana aorian’ny /image.');
    return sendText(senderId, '🖼️ Tsy tafiditra amin’ny Groq Free API ampiasain’ity bot ity ny famoronana sary. Ny Chat AI sy recherche Internet ihany no mandeha amin’ity kinova ity.');
  }
  if (lower === '/video' || lower.startsWith('/video ')) {
    const prompt = rawText.slice(6).trim();
    if (!prompt) return sendText(senderId, 'Soraty ny famaritana aorian’ny /video.');
    return sendText(senderId, '🎬 Tsy tafiditra amin’ny Groq Free API ampiasain’ity bot ity ny famoronana vidéo.');
  }
  if (lower === '/voice' || lower.startsWith('/voice ')) {
    const speechText = rawText.slice(6).trim();
    if (!speechText) return sendText(senderId, 'Soraty ny teny hovakiana aorian’ny /voice.');
    return sendText(senderId, '🔊 Tsy tafiditra amin’ny Groq Free API ampiasain’ity bot ity ny famoronana feo avy amin’ny soratra.');
  }
  if (lower === '/business' || lower.startsWith('/business ')) {
    const businessRequest = rawText.slice(9).trim();
    if (!businessRequest) return sendText(senderId, 'Ohatra: /business manorata texte hivarotana savon 5 000 Ar.');
    return answerWithGroq(senderId,
      `BUSINESS MODE: Ampio amin'ny varotra, marketing, service client, fanoratra annonce, valin-kafatra ho an'ny mpanjifa, na drafitra ara-barotra. Aza mamorona vidiny/stock raha tsy nomen'ny mpampiasa. Valio amin'ny fitenin'ny mpampiasa.\n\nFangatahana: ${businessRequest}`,
      false);
  }

  const useWebSearch = looksLikeCurrentInfoRequest(lower);
  return answerWithGroq(senderId, rawText, useWebSearch);
}

function looksLikeCurrentInfoRequest(text) {
  return /\b(vao haingana|vaovao farany|amin izao fotoana izao|amin'izao fotoana izao|ankehitriny|anio|today|latest|current|right now|recent news|actualit[eé]s?|maintenant|aujourd'hui)\b/i.test(text);
}

async function answerWithGroq(senderId, prompt, useWebSearch) {
  if (useWebSearch && !allowRate(senderId, 'web-search', 8, 60_000)) {
    return sendText(senderId, '⏳ Fetran’ny recherche: 8 isaky ny iray minitra. Andraso kely dia andramo indray.');
  }
  await sendTyping(senderId, 'typing_on').catch(() => {});
  try {
    const answer = await askGroq(senderId, prompt, useWebSearch);
    await sendText(senderId, answer || 'Miala tsiny, tsy nahazo valiny aho. Andramo indray afaka kelikely.');
  } catch (error) {
    console.error('Groq request failed:', error?.message || error);
    await sendText(senderId, mapGroqError(error));
  } finally {
    await sendTyping(senderId, 'typing_off').catch(() => {});
  }
}

async function askGroq(senderId, userText, useWebSearch) {
  requireGroqKey();
  const history = histories.get(senderId) || [];
  const body = {
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: userText }
    ],
    max_completion_tokens: 1200,
    temperature: 0.7,
    stream: false
  };
  if (useWebSearch) {
    body.tools = [{ type: 'browser_search' }];
    body.tool_choice = 'required';
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw groqHttpError(payload, response.status);
  const answer = String(payload?.choices?.[0]?.message?.content || '').trim();
  if (!answer) throw new Error('Groq returned no text output');
  histories.set(senderId, [
    ...history,
    { role: 'user', content: userText },
    { role: 'assistant', content: answer }
  ].slice(-MAX_HISTORY_MESSAGES));
  return answer;
}

async function listAvailableGroqModels(senderId) {
  if (!allowRate(senderId, 'models', 3, 60_000)) {
    return sendText(senderId, '⏳ Andraso kely vao mijery ny lisitry ny model indray.');
  }
  await sendTyping(senderId, 'typing_on').catch(() => {});
  try {
    requireGroqKey();
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      signal: AbortSignal.timeout(20000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw groqHttpError(data, response.status);
    const ids = Array.isArray(data?.data)
      ? data.data.map((item) => String(item?.id || '')).filter(Boolean)
      : [];
    if (!ids.length) {
      await sendText(senderId, 'Tsy nahazo lisitry ny model avy amin’ny Groq API aho. Jereo ny API key sy ny Render Logs.');
      return;
    }
    const output = ids.slice(0, 24);
    const more = ids.length > output.length ? '\n…misy model hafa koa.' : '';
    await sendText(senderId,
      `✅ Model IDs azon’ny API key-nao jerena (${output.length} aseho):\n\n${output.map((id) => `• ${id}`).join('\n')}${more}\n\nTsy midika ho azy fa maimaim-poana na manana quota ny model rehetra. Ho an’ny free-tier chat, andramo: openai/gpt-oss-120b.`);
  } catch (error) {
    console.error('Listing Groq models failed:', error?.message || error);
    await sendText(senderId, mapGroqError(error));
  } finally {
    await sendTyping(senderId, 'typing_off').catch(() => {});
  }
}

function requireGroqKey() {
  if (!GROQ_API_KEY) throw new Error('Missing GROQ_API_KEY');
}

function groqHttpError(payload, status) {
  const message = payload?.error?.message || payload?.message || `Groq returned HTTP ${status}`;
  const error = new Error(message);
  error.status = status;
  return error;
}

function mapGroqError(error) {
  const message = String(error?.message || '');
  const status = Number(error?.status || 0);
  if (message === 'Missing GROQ_API_KEY') return '⚠️ Tsy mbola napetraka ao amin’ny Render ny GROQ_API_KEY. Ampio ao amin’ny Environment Variables dia avereno deploy.';
  if (status === 401 || /unauthorized|invalid api key|authentication/i.test(message)) return '⚠️ Tsy neken’ny Groq ny API key. Jereo raha marina ny GROQ_API_KEY ao amin’ny Render.';
  if (status === 403 || /forbidden|permission|not allowed/i.test(message)) return '⚠️ Tsy manana alalana hampiasa ilay model/tool ity API key ity. Andramo ny openai/gpt-oss-120b ary jereo ny Groq Console.';
  if (status === 429 || /rate limit|quota|too many requests/i.test(message)) return '⚠️ Tratra ny fetra maimaim-poana an’ny Groq (rate limit/quota). Tsy tokony hampisy sarany ny free tier; andraso ny reset dia andramo indray.';
  if (/timed out|timeout|abort/i.test(message)) return '⏳ Ela loatra ny valin’ny AI. Andramo indray amin’ny fanontaniana fohy kokoa.';
  if (/model/i.test(message) && /not found|does not exist|invalid|unsupported/i.test(message)) return '⚠️ Tsy eken’ny Groq ilay model. Ampidiro ao Render ny GROQ_MODEL = openai/gpt-oss-120b.';
  if (status === 400 || status === 422) return '⚠️ Tsy neken’ny Groq ny fangatahana. Jereo ny model sy ny Render Logs.';
  if (status >= 500) return '⚠️ Misy olana vetivety amin’ny Groq API. Andramo indray afaka kelikely.';
  return '⚠️ Nisy olana tamin’ny Groq API. Jereo ny Render Logs sy ny Groq Console, dia andramo indray.';
}

function allowRate(senderId, bucket, limit, windowMs) {
  const now = Date.now();
  const key = `${senderId}:${bucket}`;
  const recent = (rateWindows.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= limit) {
    rateWindows.set(key, recent);
    return false;
  }
  recent.push(now);
  rateWindows.set(key, recent);

  // Periodically remove stale entries to prevent an unbounded in-memory map.
  if (rateWindows.size > 5000) {
    for (const [storedKey, timestamps] of rateWindows) {
      const filtered = timestamps.filter((timestamp) => now - timestamp < 10 * 60_000);
      if (filtered.length) rateWindows.set(storedKey, filtered);
      else rateWindows.delete(storedKey);
      if (rateWindows.size <= 4000) break;
    }
    while (rateWindows.size > 4000) {
      const oldestKey = rateWindows.keys().next().value;
      if (!oldestKey) break;
      rateWindows.delete(oldestKey);
    }
  }
  return true;
}

async function sendWelcome(senderId) {
  await sendMessage(senderId, {
    text: '👋 Salama! Izaho no AI Assistant Madagascar. Afaka miresaka amiko amin’ny teny Malagasy, Français na English ianao.\n\nSafidio eto ambany na soraty ny fanontanianao/baiko.',
    quick_replies: [
      { content_type: 'text', title: '💬 Chat AI', payload: 'CHAT_AI' },
      { content_type: 'text', title: '🔎 Recherche', payload: 'SEARCH' },
      { content_type: 'text', title: '🛍️ Business', payload: 'SHOP' },
      { content_type: 'text', title: '🧭 Aide', payload: 'HELP' }
    ]
  });
}

async function sendHelp(senderId) {
  await sendText(senderId,
    '🧭 BAOKY ATO AMIN’NY AI BOT\n\n' +
    '• Manorata fanontaniana — Chat AI\n' +
    '• /search fanontaniana — fikarohana Internet\n' +
    '• /business fangatahana — fanampiana amin’ny varotra/marketing\n' +
    '• /model — model voafidy ao amin’ny Render\n' +
    '• /models — mijery ny model IDs azon’ny Groq API key-nao jerena\n' +
    '• /reset — mamafa ny tantaran’ny resaka\n\n' +
    '✅ Ity bot ity dia mampiasa ny Groq Free Tier ho an’ny Chat AI sy recherche Internet. Misy fetra fampiasana maimaim-poana. Tsy tafiditra amin’ity kinova ity ny famoronana sary/vidéo/feo na famakafakana sary/PDF/Word.');
}

async function sendText(senderId, text) {
  return sendMessage(senderId, { text: String(text || ' ').slice(0, MAX_MESSAGE_CHARS) });
}

async function sendTyping(senderId, action) {
  if (!PAGE_ACCESS_TOKEN) return;
  const response = await fetch(`https://graph.facebook.com/${FB_API_VERSION}/me/messages?access_token=${encodeURIComponent(PAGE_ACCESS_TOKEN)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: senderId }, sender_action: action }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    console.warn(`Messenger typing action failed (${response.status}):`, details.slice(0, 300));
  }
}

async function sendMessage(senderId, message) {
  if (!PAGE_ACCESS_TOKEN) throw new Error('Missing PAGE_ACCESS_TOKEN');
  const response = await fetch(`https://graph.facebook.com/${FB_API_VERSION}/me/messages?access_token=${encodeURIComponent(PAGE_ACCESS_TOKEN)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: senderId }, messaging_type: 'RESPONSE', message }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    console.error(`Messenger Send API failed (${response.status}):`, details.slice(0, 700));
    throw new Error(`Messenger Send API returned HTTP ${response.status}`);
  }
  return response.json().catch(() => ({}));
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🤖 Facebook AI Bot listening on port ${PORT}`);
  console.log(`Chat: ${GROQ_MODEL}; Groq Free API; Graph API: ${FB_API_VERSION}`);
  if (!VERIFY_TOKEN) console.warn('Missing VERIFY_TOKEN environment variable.');
  if (!META_APP_SECRET) console.error('Missing META_APP_SECRET: webhook POST requests will be rejected until it is configured.');
  if (!PAGE_ACCESS_TOKEN) console.warn('Missing PAGE_ACCESS_TOKEN environment variable.');
  if (!GROQ_API_KEY) console.warn('Missing GROQ_API_KEY environment variable.');
});
