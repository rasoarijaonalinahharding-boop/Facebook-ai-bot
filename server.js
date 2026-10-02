const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "safidy_token_123";
const PAGE_ACCESS_TOKEN = "EAATZByEgoNvkBSj9zsQACNj6QBI05K4CyBbE9fRIZCtDF5HOBLRSpKt4IMKC2fulalqrvhrahT1MZCw3vkD2ghV3pCZBqY60dvz67ESeqBcD6fWz6IMMwjD3uVo9X58J3gs9xhi0ZCUjZAvFKInp65KqlJmYatNB9JQLCFbeGdtqsWmz1cyofE5o61qPoic5ASuosVP3HcmwZDZD";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        for (let entry of body.entry) {
            
            // 1. Messenger messages
            if (entry.messaging) {
                let webhookEvent = entry.messaging[0];
                let senderPsid = webhookEvent.sender.id;

                if (webhookEvent.message && webhookEvent.message.text) {
                    let userText = webhookEvent.message.text.trim();
                    let aiReply = await chat_ai_safe(userText);
                    await sendTextMessage(senderPsid, aiReply);
                }
            }

            // 2. Comment reactions
            if (entry.changes) {
                for (let change of entry.changes) {
                    if (change.field === 'feed' && change.value.item === 'comment' && change.value.verb === 'add') {
                        let comment_id = change.value.comment_id;
                        await sendCommentReaction(comment_id);
                    }
                }
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// Fiarovana mahay: Mamaly tsara ny fanontaniana na dia tapaka aza ny AI
async function chat_ai_safe(prompt) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                systemInstruction: `Ianao dia i "Safidy", bot mpivarotra sady mpanampy malagasy. I Safidy no namorona anao. Valio mivantana, mazava, ary marina tsara amin'ny teny Malagasy ny fanontanian'ny mpanjifa rehetra.`
            }
        });
        if (response && response.text) {
            return response.text;
        } else {
            throw new Error("Tsy nisy valiny mazava.");
        }
    } catch (error) {
        console.error("Olana kely tamin'ny AI, mampiasa valiny marani-tsaina:", error.message);
        
        // Raha tapaka ny AI dia ampiasaina ny teny napetraky ny client mba hamaliana azy mivantana
        let lower = prompt.toLowerCase();
        
        if (lower.includes("iza") || lower.includes("ianao")) {
            return "Izaho dia i Safidy, bot mpivarotra noforonin'i Safidy tompoko! Inona no azoko anampiana anao amin'izao fotoana izao?";
        } else if (lower.includes("vidiny") || lower.includes("prix") || lower.includes("ohatrinona")) {
            return `Momba ilay hoe "${prompt}" dia efa voarainay tsara ny hafatrao tompoko. Hamaly anao mazava tsara ny momba izany izahay ato anatin'ny fotoana fohy!`;
        } else if (lower.includes("produit") || lower.includes("vokatra") || lower.includes("misy")) {
            return `Eny tompoko! Misy ireny karazana vokatra ireny eto aminay. Raha misy fanontaniana fanampiny momba ny "${prompt}" dia afaka soratanao eto ihany.`;
        } else {
            // Valiny mifandray mivantana amin'izay nosoratan'ny client mba tsy ho valiny blank
            return `Voarainay tsara ny hafatrao hoe: "${prompt}". Misaotra anao niresaka taminay tompoko, hiara-hizaha an'izany haingana isika!`;
        }
    }
}

async function sendCommentReaction(commentId) {
    try {
        await axios.post(`https://graph.facebook.com/v18.0/${commentId}/reactions?reaction_type=LIKE&access_token=` + PAGE_ACCESS_TOKEN);
    } catch (error) {
        console.error("Tsy tafita ny reaction:", error.message);
    }
}

async function sendTextMessage(recipientPsid, messageText) {
    try {
        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=` + PAGE_ACCESS_TOKEN, {
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
