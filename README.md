# Facebook AI Bot — Groq Free Tier (v3.0.0)

Bot Facebook Messenger mampiasa ny Groq API Free Tier ho an'ny **Chat AI** sy **recherche web**. Ny model default dia `openai/gpt-oss-120b`; manohana browser search ao amin'ny Groq API izy io. Misy fetra fampiasana maimaim-poana, ka rehefa tratra ny quota dia mety hiverina ny HTTP 429 mandra-piverin'ny quota. Tsy tokony hisy sarany raha mijanona amin'ny Free Tier ianao; aza manavao ho Developer/Paid raha tsy te handoa.

## Rakitra
- `server.js` — kaody fototra.
- `package.json` — dependencies sy baiko start/test.
- `render.yaml` — Render configuration.
- `.env.example` — ohatra tsy misy secrets.
- `.gitignore` — manakana ny `.env` sy `node_modules` tsy ho ampidirina.
- `README.md` — torolalana.

## API key maimaim-poana
1. Sokafy ny [Groq Console](https://console.groq.com/).
2. Mamoròna kaonty ary sokafy ny API Keys: <https://console.groq.com/keys>.
3. Mamoròna API key vaovao.
4. Ao amin'ny Render → Web Service → Environment, ampio `GROQ_API_KEY` miaraka amin'ilay key.
5. Apetraho `GROQ_MODEL` = `openai/gpt-oss-120b`.

Aza mampiditra API key, Page Access Token, App Secret, na `.env` ao amin'ny GitHub. Tehirizo ho secrets ao amin'ny Render izy ireo.

## Render Environment Variables
- `GROQ_API_KEY` — API key avy amin'ny Groq Console.
- `GROQ_MODEL` = `openai/gpt-oss-120b`.
- `PAGE_ACCESS_TOKEN` — Page Access Token avy amin'ny Meta.
- `VERIFY_TOKEN` — teny miafina noforoninao; tsy maintsy mitovy amin'ny Verify Token ao amin'ny Meta Webhook.
- `META_APP_SECRET` — App Secret avy amin'ny Meta; ilaina amin'ny fanamarinana sonia webhook.
- `FB_API_VERSION` = `v26.0` (ovay raha version hafa no ampiasain'ny app-nao).

## Fametrahana ao amin'ny GitHub
Ampidiro eo amin'ny **fototry** (root) an'ilay repository ny rakitra rehetra ao amin'ity ZIP ity; aza mampiditra ny ZIP ho rakitra tokana. Raha efa ao ireo rakitra taloha, soloy amin'ireto version vaovao ireto. Hamarino fa `server.js` sy `package.json` no eo amin'ny root.

## Render
- Build Command: `npm install`
- Start Command: `npm start`
- Health check path: `/health`

## Meta Webhook
- Callback URL: `https://YOUR-RENDER-SERVICE.onrender.com/webhook`
- Verify Token: ilay `VERIFY_TOKEN` napetrakao ao amin'ny Render.
- Ataovy subscribe amin'ny Page events `messages` sy `messaging_postbacks`.
- Tokony efa napetraka ao amin'ny Render ny `PAGE_ACCESS_TOKEN` sy `META_APP_SECRET`.

## Baiko ao amin'ny Messenger
- Manorata fanontaniana tsotra — Chat AI.
- `/search fanontaniana` — recherche web amin'ny Groq built-in browser search.
- `/business fangatahana` — fanampiana amin'ny varotra, marketing, annonce ary service client.
- `/model` — mijery ny model voafaritra sy ny status.
- `/models` — mijery ny model IDs azon'ny API key-nao jerena.
- `/reset` — mamafa ny tantaran'ny resaka ao amin'ny memory.
- `/help` — fanampiana.

## Fetra amin'ity kinova maimaim-poana ity
Ity ZIP ity dia natao ho an'ny **chat sy recherche web ihany**. Tsy mamorona sary, vidéo, na feo (text-to-speech) izy ary tsy mamakafaka sary/attachments. Mila API/service hafa mety handoa vola ireo features ireo. Ny quota sy rate limits dia miankina amin'ny kaonty sy model; jereo ao amin'ny [Groq rate limits](https://console.groq.com/docs/rate-limits). Ny model ID dia azo hamarinina ao amin'ny [Groq supported models](https://console.groq.com/docs/models).

## Fitsapana
Mampiasa Node.js 20 na mihoatra. Alefaso `npm test` mba hanamarinana ny syntax JavaScript. Tsy voatery hisy `package-lock.json`; ny Render no mametraka ny dependencies ao amin'ny `package.json`.
