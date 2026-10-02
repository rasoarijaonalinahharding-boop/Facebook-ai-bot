const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "safidy_token_123";
const PAGE_ACCESS_TOKEN = "EAATZByEgoNvkBSj9zsQACNj6QBI05K4CyBbE9fRIZCtDF5HOBLRSpKt4IMKC2fulalqrvhrahT1MZCw3vkD2ghV3pCZBqY60dvz67ESeqBcD6fWz6IMMwjD3uVo9X58J3gs9xhi0ZCUjZAvFKInp65KqlJmYatNB9JQLCFbeGdtqsWmz1cyofE5o61qPoic5ASuosVP3HcmwZDZD";

// Fanombohana an'i Gemini API Key
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

// Fizarana handraisana ny hafatra rehetra avy amin'ny mpampiasa
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        for (let entry of body.entry) {
            let webhookEvent = entry.messaging[0];
            let senderPsid = webhookEvent.sender.id;

            if (webhookEvent.message && webhookEvent.message.text) {
                let userText = webhookEvent.message.text.trim();
                let replyMessage = await processUserMessage(userText);
                await sendTextMessage(senderPsid, replyMessage);
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// Asa mandamina sy manasokajy ny hafatra nalefan'ny mpampiasa
async function processUserMessage(message) {
    let lowerMsg = message.toLowerCase();

    if (lowerMsg.includes("menu") || lowerMsg.includes("safidy")) {
        return `🥰 Tsara tokoa! Indreto ny safidy azonao atao:\n\n` +
               `💬 Chat\n` +
               `🔎 Recherche\n` +
               `🎬 Vidéo\n` +
               `🖼️ Sary\n` +
               `🎙️ Voice\n` +
               `📄 Fichier\n` +
               `🛒 Business\n\n` +
               `Soraty fotsiny izay ilainao 😊`;
    }

    if (lowerMsg.startsWith("salama") || lowerMsg.startsWith("manao ahoana")) {
        return "Salama 😊 Tongasoa! Inona no azoko anampiana anao? (Soraty ny hoe 'menu' raha hijery ny safidy rehetra)";
    }

    if (lowerMsg.startsWith("chat ")) {
        return await chat_ai(message.substring(5).trim());
    }

    if (lowerMsg.startsWith("video ") || lowerMsg.startsWith("vidéo ")) {
        let query = message.split(" ", 1)[1] || message;
        return `🎬 Inty ny fizahana momba ilay video tadiavinao: ${query}`;
    }

    if (lowerMsg.includes("sary") || lowerMsg.includes("image")) {
        return "🖼️ Lazao tsara hoe karazan-sary manao ahoana no tianao hatao na tadiavinao.";
    }

    if (lowerMsg.includes("voice") || lowerMsg.includes("feo") || lowerMsg.includes("vocal")) {
        return "🎙️ Efa vonona hanampy amin'ny message vocal isika.";
    }

    if (lowerMsg.includes("pdf") || lowerMsg.includes("fichier") || lowerMsg.includes("document")) {
        return "📄 Alefaso ilay fichier rehefa hampidirintsika io fiasana io.";
    }

    if (lowerMsg.includes("business") || lowerMsg.includes("commande")) {
        return "🛒 Afaka mandray commande sy manampy amin'ny gestion boutique aho.";
    }

    if (lowerMsg.includes("prix") || lowerMsg.includes("vidiny")) {
        return "💰 Lazao ny produit tadiavinao dia hojerentsika ny vidiny.";
    }

    // Raha tsy misy amin'ireo dia alefa mivantana any amin'i Gemini AI izy
    return await chat_ai(message);
}

// Asa miantso an'i Gemini AI
async function chat_ai(prompt) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: prompt,
        });
        return response.text || "Tsy nahazo valiny mazava aho.";
    } catch (error) {
        console.error("Hadisoana tamin'ny AI:", error);
        return "Miala tsiny, nisy olana kely tamin'ny fiasan'ny AI tamin'ity indray mitoraka ity.";
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
    console.log(`Mandeha ny bot AI eo amin'ny port ${PORT}`);
});
