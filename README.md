# Facebook AI Bot — Grok + Imagine (v2.2.0)

Bot Facebook Messenger mampiasa ny xAI Responses API sy Imagine APIs. Afaka manao Chat AI, recherche Internet, mamorona sary sy vidéo, mamadika soratra ho feo, mandinika sary alefan'ny mpampiasa, ary manampy amin'ny Business/marketing.

## Files
- `server.js` — kaody fototra.
- `package.json` — dependencies sy scripts.
- `render.yaml` — Render configuration.
- `.env.example` — ohatra tsy misy secrets.
- `.gitignore` — manakana ny `.env` sy `node_modules` tsy ho ampidirina.

## Render Environment Variables
Ampidiro ao amin'ny Render → Web Service → Environment:
- `XAI_API_KEY` — API key avy amin'ny xAI Console.
- `PAGE_ACCESS_TOKEN` — Page Access Token avy amin'ny Meta.
- `VERIFY_TOKEN` — teny miafina noforoninao; tsy maintsy mitovy amin'ny Verify Token ao amin'ny Meta webhook.
- `META_APP_SECRET` — App Secret avy amin'ny Meta; takiana mba hanaovana fanamarinana sonia webhook.
- `XAI_MODEL` = `grok-4.7`
- `XAI_IMAGE_MODEL` = `grok-imagine-image-2.0`
- `XAI_VIDEO_MODEL` = `grok-imagine-video-1.5`
- `XAI_VOICE_ID` = `eve`
- `FB_API_VERSION` = `v26.0` (ovay raha mifanaraka amin'ny version ampiasain'ny app-nao)
- `PUBLIC_BASE_URL` = URL public an'ny Render, ohatra `https://anarana.onrender.com`. Matetika ny `RENDER_EXTERNAL_URL` ao Render no mameno azy ho azy.

Aza mampiditra API key, Page Access Token, App Secret, na `.env` ao amin'ny GitHub. Raha tsy napetraka ny `META_APP_SECRET`, dia lavina ny POST webhook ho fiarovana.

## Render
- Build Command: `npm install`
- Start Command: `npm start`
- Health check path (raha ilaina): `/health`

## Meta Webhook
- Callback URL: `https://YOUR-RENDER-SERVICE.onrender.com/webhook`
- Verify Token: ilay `VERIFY_TOKEN` napetrakao ao amin'ny Render.
- Ataovy subscribe amin'ny Page events `messages` sy `messaging_postbacks`.
- Tokony efa napetraka ao amin'ny Render ny `PAGE_ACCESS_TOKEN` sy `META_APP_SECRET`.

## Endpoints
- `/` — mijery raha mandeha ny service.
- `/health` — sata, model voafaritra, ary variables napetraka (tsy mampiseho ny secrets).
- `/webhook` — Meta Messenger webhook.
- `/media/audio/:token` — rohy feo vonjimaika, lany daty ao anatin'ny 15 minitra.

## Baiko ao amin'ny Messenger
- `/search fanontaniana` — recherche Internet live.
- `/image famaritana` — mamorona sary.
- `/video famaritana` — mamorona vidéo; afaka maharitra minitra vitsivitsy.
- `/voice soratra` — mamadika soratra ho feo.
- Mandefasa sary — dinihin'ny AI ilay sary.
- `/business fangatahana` — fanampiana amin'ny varotra/marketing.
- `/model` — model voafaritra ao amin'ny Render.
- `/models` — manontany mivantana ny xAI API hoe inona avy ny model IDs hitany amin'ny API key.
- `/reset` — mamafa ny conversation context.
- `/help` — fanampiana.

## Fiarovana sy fetrany
- Misy fetra anaty memory hanakanana hafatra sy fangatahana famoronana be loatra avy amin'ny olona iray. Miverina aotra izany rehefa restart ny service.
- Ny conversation history sy ny audio vokarina dia tehirizina ao amin'ny memory fotsiny; very rehefa restart ny service. Tapitra ao anatin'ny 15 minitra ny audio link.
- Tsy mbola mahavaky PDF/Word/audio mivantana ity kinova ity.
- Ny Chat, recherche, sary, vidéo, voice dia miankina amin'ny fahazoan-dàlana sy billing ao amin'ny xAI API. Ny `/models` dia mampiseho ny IDs hitan'ny API key, fa tsy manome antoka fa manana crédit ampy amin'ny feature tsirairay ilay kaonty.

## Test
Mampiasa Node.js 20 na mihoatra. Alefaso `npm test` mba hanamarinana ny syntax JavaScript. Tsy voatery hisy `package-lock.json`; ny Render no mametraka ny dependencies voatanisa ao amin’ny `package.json`.
