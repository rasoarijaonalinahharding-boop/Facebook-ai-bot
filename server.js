
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
const XAI_API_KEY = process.env.XAI_API_KEY || '';
const XAI_MODEL = process.env.XAI_MODEL || 'grok-4.7';
const XAI_IMAGE_MODEL = process.env.XAI_IMAGE_MODEL || 'grok-imagine-image-2.0';
const XAI_VIDEO_MODEL = process.env.XAI_VIDEO_MODEL || 'grok-imagine-video-1.5';
const XAI_VOICE_ID = process.env.XAI_VOICE_ID || 'eve';
const FB_API_VERSION = process.env.FB_API_VERSION || 'v26.0';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const MAX_HISTORY_MESSAGES = 8;
const MAX_MESSAGE_CHARS = 1800;
const MAX_INPUT_CHARS = 4000;
const audioFiles = new Map();
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
    ready: Boolean(XAI_API_KEY && PAGE_ACCESS_TOKEN && VERIFY_TOKEN && META_APP_SECRET),
    service: 'facebook-ai-bot',
    models: { chat: XAI_MODEL, image: XAI_IMAGE_MODEL, video: XAI_VIDEO_MODEL, voice: XAI_VOICE_ID },
    graphApiVersion: FB_API_VERSION,
    configured: {
      xaiApiKey: Boolean(XAI_API_KEY),
      pageAccessToken: Boolean(PAGE_ACCESS_TOKEN),
      verifyToken: Boolean(VERIFY_TOKEN),
      metaAppSecret: Boolean(META_APP_SECRET),
      publicBaseUrl: Boolean(PUBLIC_BASE_URL)
    }
  });
});

// Temporary public URLs let Messenger fetch generated audio. Audio expires after 15 minutes.
app.get('/media/audio/:token', (req, res) => {
  const item = audioFiles.get(req.params.token);
  if (!item || item.expiresAt < Date.now()) {
    audioFiles.delete(req.params.token);
    return res.sendStatus(404);
  }
  res.set({
    'Content-Type': item.contentType || 'audio/mpeg',
    'Content-Length': String(item.buffer.length),
    'Cache-Control': 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff'
  });
  return res.status(200).send(item.buffer);
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
    if (attachment.type === 'image' && attachment.payload?.url) {
      await analyzeImage(senderId, text, attachment.payload.url);
      return;
    }
    await sendText(senderId,
      '📎 Voaray ilay fichier, fa amin’ity kinova ity dia sary ihany no azoko dinihina mivantana. Raha PDF/Word/audio ilay izy, apetaho eto ny ampahany amin’ny soratra na soraty ny fanontanianao.');
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
      await sendText(senderId, '🖼️ Famoronana sary: soraty /image arahin’ny famaritana ny sary tianao.\nOhatra: /image affiche publicitaire moderne ho an’ny boutique eto Madagascar');
      return;
    case 'VIDEO':
      await sendText(senderId, '🎬 Famoronana vidéo: soraty /video arahin’ny famaritana. Mety haharitra minitra vitsivitsy ary mety handany crédit API.\nOhatra: /video cinematic 5-second view of Madagascar beach at sunset');
      return;
    case 'VOICE':
      await sendText(senderId, '🔊 Mamadika soratra ho feo: soraty /voice arahin’ny soratra hovakiana.\nOhatra: /voice Salama daholo, tongasoa eto amin’ny pejy!');
      return;
    case 'FILE':
      await sendText(senderId, '📎 Alefaso sary miaraka amin’ny fanontaniana raha tianao hodinihina. Tsy mbola mahavaky PDF/Word mivantana ity kinova ity.');
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
      `🤖 Model Chat: ${XAI_MODEL}\n🖼️ Model Sary: ${XAI_IMAGE_MODEL}\n🎬 Model Video: ${XAI_VIDEO_MODEL}\n🔊 Voice ID: ${XAI_VOICE_ID}\n🌐 Graph API: ${FB_API_VERSION}\n\nIreo no model voafaritra ao amin’ny Render, fa tsy manamarina availability. Ampiasao /models hijerena izay model asehon’ny xAI API key-nao.`);
    return;
  }
  if (lower === '/models' || lower === '/model-check') {
    return listAvailableXaiModels(senderId);
  }

  if (lower === '/search' || lower.startsWith('/search ')) {
    const prompt = rawText.slice(7).trim();
    if (!prompt) return sendText(senderId, 'Soraty ny fanontaniana aorian’ny /search.');
    return answerWithGrok(senderId, prompt, true);
  }
  if (lower === '/image' || lower.startsWith('/image ')) {
    const prompt = rawText.slice(6).trim();
    if (!prompt) return sendText(senderId, 'Soraty ny famaritana aorian’ny /image.');
    return generateImage(senderId, prompt);
  }
  if (lower === '/video' || lower.startsWith('/video ')) {
    const prompt = rawText.slice(6).trim();
    if (!prompt) return sendText(senderId, 'Soraty ny famaritana aorian’ny /video.');
    return generateVideo(senderId, prompt);
  }
  if (lower === '/voice' || lower.startsWith('/voice ')) {
    const speechText = rawText.slice(6).trim();
    if (!speechText) return sendText(senderId, 'Soraty ny teny hovakiana aorian’ny /voice.');
    return generateVoice(senderId, speechText);
  }
  if (lower === '/business' || lower.startsWith('/business ')) {
    const businessRequest = rawText.slice(9).trim();
    if (!businessRequest) return sendText(senderId, 'Ohatra: /business manorata texte hivarotana savon 5 000 Ar.');
    return answerWithGrok(senderId,
      `BUSINESS MODE: Ampio amin'ny varotra, marketing, service client, fanoratra annonce, valin-kafatra ho an'ny mpanjifa, na drafitra ara-barotra. Aza mamorona vidiny/stock raha tsy nomen'ny mpampiasa. Valio amin'ny fitenin'ny mpampiasa.\n\nFangatahana: ${businessRequest}`,
      false);
  }

  const useWebSearch = looksLikeCurrentInfoRequest(lower);
  return answerWithGrok(senderId, rawText, useWebSearch);
}

function looksLikeCurrentInfoRequest(text) {
  return /\b(vao haingana|vaovao farany|amin izao fotoana izao|amin'izao fotoana izao|ankehitriny|anio|today|latest|current|right now|recent news|actualit[eé]s?|maintenant|aujourd'hui)\b/i.test(text);
}

async function answerWithGrok(senderId, prompt, useWebSearch, imageUrl = null) {
  if (useWebSearch && !allowRate(senderId, 'web-search', 8, 60_000)) {
    return sendText(senderId, '⏳ Fetran’ny recherche: 8 isaky ny iray minitra. Andraso kely dia andramo indray.');
  }
  await sendTyping(senderId, 'typing_on').catch(() => {});
  try {
    const answer = await askGrok(senderId, prompt, useWebSearch, imageUrl);
    await sendText(senderId, answer || 'Miala tsiny, tsy nahazo valiny aho. Andramo indray afaka kelikely.');
  } catch (error) {
    console.error('xAI request failed:', error?.message || error);
    await sendText(senderId, mapXaiError(error));
  } finally {
    await sendTyping(senderId, 'typing_off').catch(() => {});
  }
}

async function askGrok(senderId, userText, useWebSearch, imageUrl = null) {
  requireXaiKey();
  const history = histories.get(senderId) || [];
  let currentInput;
  if (imageUrl) {
    currentInput = {
      role: 'user',
      content: [
        { type: 'input_text', text: userText || 'Diniho ity sary ity ary hazavao izay hita.' },
        { type: 'input_image', image_url: imageUrl }
      ]
    };
  } else {
    currentInput = { role: 'user', content: userText };
  }

  const body = {
    model: XAI_MODEL,
    input: [ { role: 'system', content: SYSTEM_PROMPT }, ...history, currentInput ],
    max_output_tokens: 900,
    store: false
  };
  if (useWebSearch) body.tools = [{ type: 'web_search' }];

  const response = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${XAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw xaiHttpError(payload, response.status);

  const answer = extractResponseText(payload);
  if (!answer) throw new Error('xAI returned no text output');
  if (!imageUrl) {
    histories.set(senderId, [
      ...history,
      { role: 'user', content: userText },
      { role: 'assistant', content: answer }
    ].slice(-MAX_HISTORY_MESSAGES));
  }
  return answer;
}

async function listAvailableXaiModels(senderId) {
  if (!allowRate(senderId, 'models', 3, 60_000)) {
    return sendText(senderId, '⏳ Andraso kely vao mijery ny lisitry ny model indray.');
  }
  await sendTyping(senderId, 'typing_on').catch(() => {});
  try {
    requireXaiKey();
    const response = await fetch('https://api.x.ai/v1/models', {
      headers: { 'Authorization': `Bearer ${XAI_API_KEY}` },
      signal: AbortSignal.timeout(20000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw xaiHttpError(data, response.status);
    const ids = Array.isArray(data?.data)
      ? data.data.map((item) => String(item?.id || '')).filter(Boolean)
      : [];
    if (!ids.length) {
      await sendText(senderId, 'Tsy nahazo model avy amin’ny xAI API aho. Jereo ny API key sy ny Render Logs.');
      return;
    }
    const relevant = ids.filter((id) => /grok|imagine|tts|voice/i.test(id));
    const output = (relevant.length ? relevant : ids).slice(0, 24);
    const more = (relevant.length ? relevant : ids).length > output.length ? '\n…misy model hafa koa.' : '';
    await sendText(senderId,
      `✅ Model hitan’ny API key-nao izao (${output.length} aseho):\n\n${output.map((id) => `• ${id}`).join('\n')}${more}\n\nMarihina: ny model hita dia tsy midika foana fa manana crédit na fahazoan-dàlana hampiasa azy amin’ny fangatahana rehetra ianao.`);
  } catch (error) {
    console.error('Listing xAI models failed:', error?.message || error);
    await sendText(senderId, mapXaiError(error));
  } finally {
    await sendTyping(senderId, 'typing_off').catch(() => {});
  }
}

async function analyzeImage(senderId, prompt, imageUrl) {
  let parsed;
  try { parsed = new URL(imageUrl); } catch { return sendText(senderId, 'Tsy afaka novakiana ny rohy misy an’ilay sary.'); }
  if (parsed.protocol !== 'https:') return sendText(senderId, 'Tsy ekena ilay rohy sary.');
  const actualPrompt = prompt || 'Diniho ity sary ity ary hazavao amin’ny fomba tsotra izay hita. Raha misy soratra hita, vakio araka izay azo atao.';
  await answerWithGrok(senderId, actualPrompt, false, imageUrl);
}

async function generateImage(senderId, prompt) {
  if (!allowRate(senderId, 'image', 3, 10 * 60_000)) {
    return sendText(senderId, '⏳ Fetran’ny famoronana sary: sary 3 isaky ny 10 minitra. Andraso kely dia andramo indray.');
  }
  await sendTyping(senderId, 'typing_on').catch(() => {});
  try {
    requireXaiKey();
    await sendText(senderId, '🖼️ Mamorona sary aho…');
    const response = await fetch('https://api.x.ai/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${XAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: XAI_IMAGE_MODEL, prompt: prompt.slice(0, 1800), n: 1, response_format: 'url' }),
      signal: AbortSignal.timeout(120000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw xaiHttpError(data, response.status);
    const imageUrl = data?.data?.[0]?.url;
    if (!imageUrl) throw new Error('No image URL returned by xAI');
    await sendMessage(senderId, { attachment: { type: 'image', payload: { url: imageUrl, is_reusable: true } } });
  } catch (error) {
    console.error('Image generation failed:', error?.message || error);
    await sendText(senderId, mapXaiError(error));
  } finally {
    await sendTyping(senderId, 'typing_off').catch(() => {});
  }
}

async function generateVideo(senderId, prompt) {
  if (!allowRate(senderId, 'video', 2, 10 * 60_000)) {
    return sendText(senderId, '⏳ Fetran’ny famoronana vidéo: vidéo 2 isaky ny 10 minitra. Andraso kely dia andramo indray.');
  }
  await sendTyping(senderId, 'typing_on').catch(() => {});
  try {
    requireXaiKey();
    await sendText(senderId, '🎬 Nanomboka namorona vidéo aho. Mety haharitra minitra vitsivitsy izany; miankina amin’ny model sy ny crédit API.');
    const startResponse = await fetch('https://api.x.ai/v1/videos/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${XAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: XAI_VIDEO_MODEL, prompt: prompt.slice(0, 1800) }),
      signal: AbortSignal.timeout(60000)
    });
    const startData = await startResponse.json().catch(() => ({}));
    if (!startResponse.ok) throw xaiHttpError(startData, startResponse.status);
    if (!startData.request_id) throw new Error('No video request_id returned by xAI');

    let videoUrl = null;
    for (let attempt = 0; attempt < 48; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const pollResponse = await fetch(`https://api.x.ai/v1/videos/${encodeURIComponent(startData.request_id)}`, {
        headers: { 'Authorization': `Bearer ${XAI_API_KEY}` },
        signal: AbortSignal.timeout(30000)
      });
      const pollData = await pollResponse.json().catch(() => ({}));
      if (!pollResponse.ok) throw xaiHttpError(pollData, pollResponse.status);
      if (pollData.status === 'done' && pollData.video?.url) {
        videoUrl = pollData.video.url;
        break;
      }
      if (pollData.status === 'failed') throw new Error('Video generation failed in xAI');
    }

    if (!videoUrl) {
      await sendText(senderId, '⏳ Mbola amboarina ilay vidéo ka tsy mbola vonona tao anatin’ny fotoana niandrasana. Andramo indray afaka kelikely.');
      return;
    }
    await sendMessage(senderId, { attachment: { type: 'video', payload: { url: videoUrl, is_reusable: true } } });
  } catch (error) {
    console.error('Video generation failed:', error?.message || error);
    await sendText(senderId, mapXaiError(error));
  } finally {
    await sendTyping(senderId, 'typing_off').catch(() => {});
  }
}

async function generateVoice(senderId, textToSpeak) {
  if (!allowRate(senderId, 'voice', 5, 10 * 60_000)) {
    return sendText(senderId, '⏳ Fetran’ny voice: feo 5 isaky ny 10 minitra. Andraso kely dia andramo indray.');
  }
  await sendTyping(senderId, 'typing_on').catch(() => {});
  try {
    requireXaiKey();
    if (!PUBLIC_BASE_URL) {
      await sendText(senderId, '⚠️ Tsy fantatro ny public URL an’ity bot ity. Apetraho ao amin’ny Render ny PUBLIC_BASE_URL (ohatra: https://anarana.onrender.com) dia avereno deploy.');
      return;
    }
    const response = await fetch('https://api.x.ai/v1/tts', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${XAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: textToSpeak.slice(0, 3000),
        voice_id: XAI_VOICE_ID,
        language: 'auto',
        output_format: { codec: 'mp3', sample_rate: 24000, bit_rate: 128000 }
      }),
      signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) {
      const details = await response.text().catch(() => '');
      throw new Error(details || `xAI TTS returned HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) throw new Error('xAI TTS returned an empty audio file');
    const token = crypto.randomBytes(18).toString('hex');
    const responseContentType = response.headers.get('content-type') || '';
    const contentType = responseContentType.toLowerCase().startsWith('audio/') ? responseContentType : 'audio/mpeg';
    audioFiles.set(token, { buffer, contentType, expiresAt: Date.now() + 15 * 60 * 1000 });
    for (const [key, value] of audioFiles) if (value.expiresAt < Date.now()) audioFiles.delete(key);
    while (audioFiles.size > 100) audioFiles.delete(audioFiles.keys().next().value);
    const url = `${PUBLIC_BASE_URL}/media/audio/${token}`;
    await sendMessage(senderId, { attachment: { type: 'audio', payload: { url, is_reusable: true } } });
    await sendText(senderId, '🔊 Ity ny feo novokarina. Marihina fa mety tsy ho lavorary ny fanononana teny Malagasy amin’ny TTS.');
  } catch (error) {
    console.error('Voice generation failed:', error?.message || error);
    await sendText(senderId, mapXaiError(error));
  } finally {
    await sendTyping(senderId, 'typing_off').catch(() => {});
  }
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

function requireXaiKey() {
  if (!XAI_API_KEY) throw new Error('Missing XAI_API_KEY');
}

function xaiHttpError(payload, status) {
  const message = payload?.error?.message || payload?.message || `xAI returned HTTP ${status}`;
  const error = new Error(message);
  error.status = status;
  return error;
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  const chunks = [];
  for (const item of (payload?.output || [])) {
    for (const content of (item?.content || [])) {
      if ((content?.type === 'output_text' || content?.type === 'text') && typeof content.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

function mapXaiError(error) {
  const message = String(error?.message || '');
  const status = Number(error?.status || 0);
  if (message === 'Missing XAI_API_KEY') return '⚠️ Tsy mbola napetraka ao amin’ny Render ny XAI_API_KEY. Ampio ao amin’ny Environment Variables dia avereno deploy.';
  if (status === 401 || /unauthorized|invalid api key|authentication/i.test(message)) return '⚠️ Tsy neken’ny xAI ny API key. Jereo raha marina ny XAI_API_KEY ao amin’ny Render.';
  if (status === 403 || /forbidden|permission|not allowed/i.test(message)) return '⚠️ Tsy manana alalana hampiasa io model/API io ilay API key-nao. Jereo ao amin’ny xAI Console ny fahazoan-dàlana sy ny billing.';
  if (status === 429 || /rate limit|quota|billing|insufficient funds/i.test(message)) return '⚠️ Be loatra ny fangatahana na tsy ampy ny quota/balance. Jereo ny usage sy billing ao amin’ny xAI Console.';
  if (/timed out|timeout|abort/i.test(message)) return '⏳ Ela loatra ny valin’ny AI. Andramo indray amin’ny fanontaniana fohy kokoa.';
  if (/model/i.test(message) && /not found|does not exist|invalid|unsupported/i.test(message)) return '⚠️ Tsy eken’ny API key/model service ny model voafidy. Jereo ao amin’ny xAI Console ny model azo ampiasaina.';
  if (status === 400 || status === 422) return '⚠️ Tsy neken’ny xAI ny fangatahana. Jereo ny model, ny endriky ny fangatahana, ary ny Render Logs.';
  if (status >= 500) return '⚠️ Misy olana vetivety amin’ny xAI API. Andramo indray afaka kelikely.';
  return '⚠️ Nisy olana tamin’ny fifandraisana tamin’ny AI. Jereo ny Render Logs sy ny xAI Console, dia andramo indray.';
}

async function sendWelcome(senderId) {
  await sendMessage(senderId, {
    text: '👋 Salama! Izaho no AI Assistant Madagascar. Afaka miresaka amiko amin’ny teny Malagasy, Français na English ianao.\n\nSafidio eto ambany na soraty ny fanontanianao/baiko.',
    quick_replies: [
      { content_type: 'text', title: '💬 Chat AI', payload: 'CHAT_AI' },
      { content_type: 'text', title: '🔎 Recherche', payload: 'SEARCH' },
      { content_type: 'text', title: '🖼️ Sary', payload: 'IMAGE' },
      { content_type: 'text', title: '🎬 Video', payload: 'VIDEO' },
      { content_type: 'text', title: '🔊 Voice', payload: 'VOICE' },
      { content_type: 'text', title: '📎 Fichier', payload: 'FILE' },
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
    '• /image famaritana — mamorona sary\n' +
    '• /video famaritana — mamorona vidéo\n' +
    '• /voice soratra — mamadika soratra ho feo\n' +
    '• Mandefasa sary — dinihin’ny AI ilay sary\n' +
    '• /business fangatahana — fanampiana amin’ny varotra/marketing\n' +
    '• /model — model voafidy ao amin’ny Render\n' +
    '• /models — mijery ny model hitan’ny xAI API key-nao\n' +
    '• /reset — mamafa ny tantaran’ny resaka\n\n' +
    '⚠️ Ny Chat, recherche, sary, vidéo, voice dia miankina amin’ny fahazoan-dàlana sy billing ao amin’ny xAI API. Mety handany crédit ny sary/vidéo/recherche. Tsy mbola mahavaky PDF/Word mivantana ity kinova ity.');
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
  console.log(`Chat: ${XAI_MODEL}; image: ${XAI_IMAGE_MODEL}; video: ${XAI_VIDEO_MODEL}; Graph API: ${FB_API_VERSION}`);
  if (!VERIFY_TOKEN) console.warn('Missing VERIFY_TOKEN environment variable.');
  if (!META_APP_SECRET) console.error('Missing META_APP_SECRET: webhook POST requests will be rejected until it is configured.');
  if (!PAGE_ACCESS_TOKEN) console.warn('Missing PAGE_ACCESS_TOKEN environment variable.');
  if (!XAI_API_KEY) console.warn('Missing XAI_API_KEY environment variable.');
  if (!PUBLIC_BASE_URL) console.warn('Missing PUBLIC_BASE_URL / RENDER_EXTERNAL_URL: voice attachment generation will not work.');
});
