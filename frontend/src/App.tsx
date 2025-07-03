// src/App.tsx
import { useState, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import reactLogo from '/react.svg'
import viteLogo from '/vite.svg'
import './App.css'

type Message = {
    text: string;
    sender: "user" | "ai";
    
};

// ✨ --- Theme Type --- ✨
type Theme = 'light' | 'dark';

function App() {
    const [messages, setMessages] = useState<Message[]>([
        { text: "Hello! How can I help you today?", sender: "ai" }
    ]);
    const [inputValue, setInputValue] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const chatAreaRef = useRef<HTMLDivElement>(null);
    const ws = useRef<WebSocket | null>(null);

    const sessionId = useRef<string>(crypto.randomUUID());
    const [theme, setTheme] = useState<Theme>(() => {
        const savedTheme = localStorage.getItem('theme') as Theme | null;
        if (savedTheme) {
            return savedTheme;
        }
        // Set theme based on user's system preference
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    });

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);


    // Auto-scroll to the bottom of the chat
    useEffect(() => {
        if (chatAreaRef.current) {
            chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
        }
    }, [messages]);

    // Effect for WebSocket cleanup on component unmount
    useEffect(() => {
        return () => {
            ws.current?.close();
        };
    }, []);

    // ✨ --- THIS IS THE CORRECTED FUNCTION --- ✨
    const handleSendMessage = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const userMessage = inputValue.trim();
        if (!userMessage) return;

        setInputValue("");
        setIsLoading(true);

        // ✅ FIX: Add user message and AI placeholder in ONE atomic state update.
        const newUserMessage: Message = { text: userMessage, sender: "user" };
        const aiPlaceholder: Message = { text: "", sender: "ai" };
        setMessages(prev => [...prev, newUserMessage, aiPlaceholder]);

        // --- Start of WebSocket Integration ---
        ws.current = new WebSocket(`ws://localhost:5000?sessionId=${sessionId.current}`);

        ws.current.onopen = () => {
            console.log('Connected to WebSocket server');
            // We no longer set state here. Just send the message.
            ws.current?.send(JSON.stringify({ message: userMessage }));
        };

        ws.current.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.reply) {
                // Use flushSync to force immediate re-renders for each token.
                flushSync(() => {
                    setMessages(prev => {
                        const newMessages = [...prev];
                        // Append the new chunk to the last AI message
                        console.log("model reply",data);
                        newMessages[newMessages.length - 1].text += data.reply;
                        return newMessages;
                    });
                });
            }

            if (data.endOfStream) {
                console.log('Stream ended.');
                setIsLoading(false);
                ws.current?.close();
            }

            if (data.error) {
                console.error('Server error:', data.error);
                // Update the placeholder with an error message for a better UX
                 setMessages(prev => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1].text = `Sorry, an error occurred: ${data.error}`;
                    return newMessages;
                });
                setIsLoading(false);
            }
        };

        ws.current.onclose = () => {
            console.log('Disconnected from WebSocket server');
            setIsLoading(false);
        };

        ws.current.onerror = (error) => {
            console.error('WebSocket error:', error);
             // Update the placeholder with an error message
            setMessages(prev => {
                const newMessages = [...prev];
                const lastMessage = newMessages[newMessages.length - 1];
                if (lastMessage && lastMessage.sender === 'ai') {
                    lastMessage.text = "Sorry, I'm having trouble connecting. Please try again.";
                }
                return newMessages;
            });
            setIsLoading(false);
        };
    };

    // ✨ --- Function to toggle theme --- ✨
    const toggleTheme = () => {
        setTheme(prevTheme => (prevTheme === 'light' ? 'dark' : 'light'));
    };

    return (
        <>
            <div className="chat-container">
                <button onClick={toggleTheme} className="theme-toggle-button">
                    {theme === 'light' ? '🌙' : '☀️'}
                </button>
                <div className="chat-header">AI Chatbot Assistant</div>
                <div className="chat-area" ref={chatAreaRef}>
                    {messages.map((msg, index) => (
                        // Render the message bubble even if it's an empty AI message
                        // The loading indicator will show alongside it.
                        <div key={index} className={`message ${msg.sender}`}>
                            {msg.text}
                        </div>
                    ))}
                    {/* The loading indicator is now simpler and more reliable */}
                    {isLoading && <div className="message loading">AI is typing...</div>}
                </div>
                <form className="input-form" onSubmit={handleSendMessage}>
                    <input
                        type="text"
                        className="input-field"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder="Type a message..."
                        disabled={isLoading}
                    />
                    <button type="submit" className="send-button" disabled={isLoading}>Send</button>
                </form>
            </div>
        </>
    );
}

export default App;