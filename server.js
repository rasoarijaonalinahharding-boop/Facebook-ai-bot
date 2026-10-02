const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "safidy_token_123";
const PAGE_ACCESS_TOKEN = "EAATZByEgoNvkBSj9zsQACNj6QBI05K4CyBbE9fRIZCtDF5HOBLRSpKt4IMKC2fulalqrvhrahT1MZCw3vkD2ghV3pCZBqY60dvz67ESeqBcD6fWz6IMMwjD3uVo9X58J3gs9xhi0ZCUjZAvFKInp65KqlJmYatNB9JQLCFbeGdtqsWmz1cyofE5o61qPoic5ASuosVP3HcmwZDZD";

// Fiantsoana an'i Gemini API Key
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Fizarana Webhook Verification ho an'ny Facebook
app.get('/webhook', (req, res) => {
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];
    if (mode && token === VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// Fizarana handraisana ny hafatra (Messenger) sy ny Commentaire (Feed) avy amin'ny Facebook
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        for (let entry of body.entry) {
            
            // 1. Raha misy mandefa message ao amin'ny Messenger
            if (entry.messaging) {
                let webhookEvent = entry.messaging[0];
                let senderPsid = webhookEvent.sender.id;

                if (webhookEvent.message && webhookEvent.message.text) {
                    let userText = webhookEvent.message.text.trim();
                    
                    // Alaina ny zava-misy sy ny vokatra avy amin'ny publication ao amin'ny pejy
                    let productContext = await getPagePostsContext();
                    
                    // Alefa any amin'i Safidy AI miaraka amin'ny tsipiriany momba ny vokatra
                    let aiReply = await chat_ai(userText, productContext);
                    await sendTextMessage(senderPsid, aiReply);
                }
            }

            // 2. Raha misy mametraka commentaire amin'ny publication dia asiany reaction ho azy
            if (entry.changes) {
                for (let change of entry.changes) {
                    if (change.field === 'feed' && change.value.item === 'comment' && change.value.verb === 'add') {
                        let commentId = change.value.comment_id;
                        await sendCommentReaction(commentId);
                    }
                }
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// Asa fakana ny "légende" na vokatra ao amin'ny publication an'ny pejy
async function getPagePostsContext() {
    try {
        const response = et response = await axios.get(`https://graph.facebook.com/v18.0/me/posts?fields=message&access_token=` + PAGE_ACCESS_TOKEN);
        let posts = response.data.data || [];
        let captions = posts.map(p => p.message).filter(Boolean).join("\n---\n");
        return captions;
    } catch (error) {
        console.error("Tsy tafita ny fakana ny posts:", error.response?.data || error.message);
        return "";
    }
}

// Asa mandefa reaction (Like/Love) amin'ny commentaire iray
async function sendCommentReaction(commentId) {
    try {
        await axios.post(`https://graph.facebook.com/v18.0/${commentId}/reactions?reaction_type=LIKE&access_token=` + PAGE_ACCESS_TOKEN);
        console.log(`Voatsindry soa aman-tsara ny reaction tamin'ny commentaire: ${commentId}`);
    } catch (error) {
        console.error("Tsy tafita ny fametrahana reaction:", error.response?.data || error.message);
    }
}

// Asa miantso an'i Safidy AI (mampiasa ny gemini-3.8-flash)
async function chat_ai(prompt, productContext) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: `Fanontanian'ny mpanjifa: ${prompt}`,
            config: {
                systemInstruction: `Ianao dia bot mpanampy ara-tsaina sady mpivarotra mahay antsoina hoe "Safidy". I Safidy (olona) no namorona anao. 
                Ireto avy ireo vokatra sy fampahalalana nalaina tamin'ny publication/légende tao amin'ny pejy Facebook anay ahafahanao mivarotra:
                ${productContext}
                
                Torohevitra ho anao: 
                - Valio tsara sy am-pitiavana ny mpanjifa.
                - Ampiasao ireo vokatra sy vidiny hita ao amin'ny légende etsy ambony mba hivarotana amin'ny mpanjifa.
                - Aza milaza mihitsy fa i Google no namorona anao, fa i Safidy (mpamorona) no tomponao.`
            }
        });
        return response.text || "Tsy nahazo valiny mazava aho.";
    } catch (error) {
        console.error("Hadisoana tamin'ny AI:", error);
        return "Miala tsiny, be ny mpampiasa an'izao fotoana izao ka mbola mitohana kely ny AI. Andramo alefa indray ilay hafatra afaka segondra vitsy azafady! 🙏";
    }
}

// Asa mandefa ny valiny any amin'ny Facebook Messenger
async function sendTextMessage(recipientPsid, messageText) {
    try {
        await axios.post('https://graph.facebook.com/v18.0/me/messages?access_token=' + PAGE_ACCESS_TOKEN, {
            recipient: { id: recipientPsid },
            message: { text: messageText }
        });
    } catch (error) {
        console.error("Tsy tafita ilay hafatra:", error.response?.data || error.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Mandeha ny bot Safidy AI eo amin'ny port ${PORT}`);
});
