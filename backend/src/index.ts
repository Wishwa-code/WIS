import express, { Express, Request, Response, RequestHandler } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
const { GoogleGenerativeAI } = require('@google/generative-ai');
import OpenAI from 'openai';
const dotenv = require('dotenv');
const cors = require('cors');
import multer from 'multer';
import fs from 'fs';
import path from 'path';

// Load environment variables from .env file
dotenv.config();


const app: Express = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set in the environment variables.');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set in the environment variables.');
}

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const openAIModelName = 'gpt-4o';

const chatHistories = new Map<string, any[]>();

const storage = multer.diskStorage({
	destination: function (req, file, cb) {
        // Use the consistent 'uploadsDir' path here
		cb(null, uploadsDir);
	},
	filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

/**
 * @route   GET /
 * @desc    Handle chat messages and return AI response
 * @access  Public
 */

app.get('/', (req: Request, res: Response) => {
    res.send('Hello from Express + TypeScript Server');
});

/**
 * @route   POST /upload
 * @desc    Handle chat messages and return AI response
 * @access  Public
 */

app.post('/upload', upload.single('image'), (req: Request, res: Response): void => {
    if (!req.file) {
        res.status(400).send('No file uploaded.');
        return;
    }
    res.json({ filePath: req.file.path });
});


const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    console.log('Client connected');

    const url = new URL(req.url!, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');

    // Session id is necessary at the moment to start a chat
    if (!sessionId) {
        console.log('Connection rejected: No sessionId provided.');
        ws.close(1008, 'Session ID is required');
        return;
    }

    console.log(`Client connected with sessionId: ${sessionId}`);

    // Retrieve existing history or notify that it's a new chat.
    if (chatHistories.has(sessionId)) {
        console.log(`Resuming chat for session: ${sessionId}`);
    } else {
        console.log(`Starting new chat for session: ${sessionId}`);
    }

    ws.on('message', async (message: string) => {
        try {
            const { message: userMessage, imagePath } = JSON.parse(message);

            if (!userMessage && !imagePath) {
                ws.send(JSON.stringify({ error: 'A message or an image is required.' }));
                return;
            }

            const history = chatHistories.get(sessionId) || [];
            let fullResponse = '';

            // --- Prepare content parts (unified for both models) ---
            const userHistoryParts: any[] = [];
            let imageBase64 = '';
            let mimeType = '';

            if (userMessage) {
                userHistoryParts.push({ text: userMessage });
            }

            if (imagePath) {
                try {
                    imageBase64 = fs.readFileSync(imagePath, { encoding: 'base64' });
                    mimeType = path.extname(imagePath) === '.png' ? 'image/png' : 'image/jpeg';
                    userHistoryParts.push({
                    inlineData: { data: imageBase64, mimeType }
                });
                } catch (error) {
                    console.error('Error processing image:', error);
                    ws.send(JSON.stringify({ error: 'Failed to process the uploaded image.' }));
                    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath); // Clean up on error
                    return;
                }
            }

            try {
                // 🚀 ATTEMPT 1: GOOGLE GEMINI
                console.log(`Attempting to generate response with Gemini for session: ${sessionId}`);
                const chat = geminiModel.startChat({ history });
                const result = await chat.sendMessageStream(userHistoryParts);

                for await (const chunk of result.stream) {
                    const chunkText = chunk.text();
                    fullResponse += chunkText;
                    ws.send(JSON.stringify({ reply: chunkText }));
                }

            } catch (geminiError) {
                // 🔄 FALLBACK: OPENAI
                console.error('Gemini API failed. Falling back to OpenAI.', geminiModel.message);
                ws.send(JSON.stringify({ status: 'Gemini failed. Falling back to OpenAI...' }));

                 // 1. Convert Gemini history to OpenAI format
                const openAIHistory = history.map((item: any) => ({
                    role: item.role === 'model' ? 'assistant' : 'user',
                    content: item.parts.map((part: any) => {
                        if (part.text) {
                            return { type: 'text', text: part.text };
                        }
                        if (part.inlineData) {
                            return {
                                type: 'image_url',
                                image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` }
                            };
                        }
                        return null;
                    }).filter(Boolean)
                }));

                 // 2. Construct the current user message for OpenAI
                const currentUserContent: any[] = [];

                if (userMessage) {
                    currentUserContent.push({ type: 'text', text: userMessage });
                }

                if (imagePath && imageBase64) {
                    currentUserContent.push({
                        type: 'image_url',
                        image_url: { url: `data:${mimeType};base64,${imageBase64}` }
                    });
                }
                const messages: any[] = [
                    ...openAIHistory,
                    { role: 'user', content: currentUserContent }
                ];

                // 3. Call OpenAI API and stream the response
                const stream = await openai.chat.completions.create({
                    model: openAIModelName,
                    messages: messages,
                    stream: true,
                });

                for await (const chunk of stream) {
                    const chunkText = chunk.choices[0]?.delta?.content || '';
                    if (chunkText) {
                        fullResponse += chunkText;
                        ws.send(JSON.stringify({ reply: chunkText }));
                    }
                }
            }

            // --- UNIFIED HISTORY AND CLEANUP ---
            // 1. Update history in the unified (Gemini) format
            history.push({ role: 'user', parts: userHistoryParts });
            history.push({ role: 'model', parts: [{ text: fullResponse }] });
            chatHistories.set(sessionId, history);

            // 2. Clean up the uploaded file now that we are done with it
            if (imagePath && fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
            // 3. Notify the client that the stream has ended
            ws.send(JSON.stringify({ endOfStream: true }));

            } catch (error) {
                console.error('An unexpected error occurred:', error);
                ws.send(JSON.stringify({ error: 'Failed to process your request due to an internal error.' }));
            }
        });

        ws.on('close', () => {
        console.log('Client disconnected');
    });
});

server.listen(port, () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});