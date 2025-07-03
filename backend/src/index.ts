import express, { Express, Request, Response, RequestHandler } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
const cors = require('cors');
import multer from 'multer';
import fs from 'fs';
import path from 'path';
// const http = require('http');

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
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

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

app.post('/upload', upload.single('image'), (req: Request, res: Response): void => {
    if (!req.file) {
        res.status(400).send('No file uploaded.');
        return;
    }
    res.json({ filePath: req.file.path });
});

/**
 * @route   POST /api/chat
 * @desc    Handle chat messages and return AI response
 * @access  Public
 */



app.get('/', (req: Request, res: Response) => {
  res.send('Hello from Express + TypeScript Server');
});

const server = http.createServer(app);

const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  console.log('Client connected');

  const url = new URL(req.url!, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('sessionId');

  // If no sessionId is provided, close the connection.
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
      const { message: userMessage, imagePath  } = JSON.parse(message);

      if (!userMessage) {
        ws.send(JSON.stringify({ error: 'Message is required.' }));
        return;
      }

      // 1. Get or initialize the chat history for this session.
      const history = chatHistories.get(sessionId) || [];

      // 2. Start a chat session with the existing history.
      const chat = model.startChat({ history });

      const promptParts = [];
        if (userMessage) {
            promptParts.push({ text: userMessage });
        }
      let imageParts: any[] = [];

      if (imagePath) {
                try {
                    const imageBase64 = fs.readFileSync(imagePath, { encoding: 'base64' });
                    const mimeType = path.extname(imagePath) === '.png' ? 'image/png' : 'image/jpeg';
                    imageParts.push({
                        inlineData: {
                            data: imageBase64,
                            mimeType
                        }
                    });
                    // Clean up the uploaded file after reading it
                    fs.unlinkSync(imagePath);
                } catch (error) {
                    console.error('Error processing image:', error);
                    ws.send(JSON.stringify({ error: 'Failed to process the uploaded image.' }));
                    return;
                }
            }

      // 3. Send the new message and get a streaming response.
      // const result = await chat.sendMessageStream(userMessage);
      const result = await chat.sendMessageStream([...promptParts, ...imageParts]);

      // ✨ START: CODE TO BE CHANGED ✨
      // const result = await model.generateContentStream(userMessage);
      let fullResponse = '';
      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        fullResponse += chunkText;
        ws.send(JSON.stringify({ reply: chunkText }));
      }
      // ✨ END: CODE TO BE CHANGED ✨

      const userHistoryParts = [...promptParts, ...imageParts];
      history.push({ role: 'user', parts: userHistoryParts });
      history.push({ role: 'model', parts: [{ text: fullResponse }] });

      // history.push({ role: 'user', parts: [{ text: userMessage }] });
      // history.push({ role: 'model', parts: [{ text: fullResponse }] });

      // 5. Save the updated history back to our store.
      chatHistories.set(sessionId, history);
      
      // Notify the client that the stream has ended
      ws.send(JSON.stringify({ endOfStream: true }));

    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({ error: 'Failed to process message.' }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});



server.listen(port, () => {
  console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});