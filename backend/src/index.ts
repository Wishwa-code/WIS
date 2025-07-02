import express, { Express, Request, Response, RequestHandler } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
const cors = require('cors');
// const http = require('http');

// Load environment variables from .env file
dotenv.config();


const app: Express = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is not set in the environment variables.');
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

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

  ws.on('message', async (message: string) => {
    try {
      const { message: userMessage } = JSON.parse(message);

      if (!userMessage) {
        ws.send(JSON.stringify({ error: 'Message is required.' }));
        return;
      }

      // ✨ START: CODE TO BE CHANGED ✨
      const result = await model.generateContentStream(userMessage);

      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        ws.send(JSON.stringify({ reply: chunkText }));
      }
      // ✨ END: CODE TO BE CHANGED ✨
      
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