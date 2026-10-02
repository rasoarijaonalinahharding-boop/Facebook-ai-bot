const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "safidy_token_123";
const PAGE_ACCESS_TOKEN = "EAATZByEgoNvkBSj9zsQACNj6QBI05K4CyBbE9fRIZCtDF5HOBLRSpKt4IMKC2fulalqrvhrahT1MZCw3vkD2ghV3pCZBqY60dvz67ESeqBcD6fWz6IMMwjD3uVo9X58J3gs9xhi0ZCUjZAvFKInp65KqlJmYatNB9JQLCFbeGdtqsWmz1cyofE5o61qPoic5ASuosVP3HcmwZDZD";

const GROQ_API_KEY = process.env.GROQ_API_KEY;

// 1. Fanamarinana ny Webhook avy amin'i Facebook
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

// 2. Fandraisana ny Hafatra sy Hevitra (Comments) avy amin'ny Page
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        for (let entry of body.entry) {
            
            // Raha toa ka hafatra tao amin'ny Messenger
            if (entry.messaging) {
                let webhookEvent = entry.messaging[0];
                let senderPsid = webhookEvent.sender.id;

                if (webhookEvent.message && webhookEvent.message.text) {
                    let userText = webhookEvent.message.text.trim();
                    let aiReply = await chat_groq(userText);
                    await sendTextMessage(senderPsid, aiReply);
                }
            }

            // Raha toa ka fanehoan-kevitra (comment) tamin'ny post
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

// 3. Fiantsoana ny Groq API miaraka amin'ny model openai/gpt-oss-120b
async function chat_groq(prompt) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "openai/gpt-oss-120b", // Ilay model nangatahinao
            messages: [
                {
                    role: "system",
                    content: "Ianao dia i 'Safidy', bot mpivarotra sady mpanampy malagasy. I Safidy no namorona anao. Valio mivantana, mazava, ary am-pitiavana amin'ny teny Malagasy ny fanontanian'ny mpanjifa rehetra."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.7
        }, {
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error("Hadisoana tamin'ny Groq API:", error.response?.data || error.message);
        return `Miala tsiny tompoko, nisy olana kely tamin'ny rafitra. Azonao averina alefa indray ilay hafatra azafady?`;
    }
}

// 4. Asiana "Like" ho otomatika ny Comment
async function sendCommentReaction(commentId) {
    try {
        await axios.post(`https://graph.facebook.com/v18.0/${commentId}/reactions?reaction_type=LIKE&access_token=` + PAGE_ACCESS_TOKEN);
    } catch (error) {
        console.error("Tsy tafita ny reaction:", error.message);
    }
}

// 5. Mandefa ny valinteny any amin'ny Messenger
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
    console.log(`Mandeha ny bot Safidy AI (Groq) eo amin'ny port ${PORT}`);
});
