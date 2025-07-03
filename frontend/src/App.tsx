// src/App.tsx
import { useState, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import './App.css'
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Message = {
    text: string;
    sender: "user" | "ai";
    image?: string;
};

type Theme = 'light' | 'dark';


function App() {
    const [messages, setMessages] = useState<Message[]>([
        { text: "Hello! How can I help you today?", sender: "ai" }
    ]);
    const [inputValue, setInputValue] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [isWsConnected, setIsWsConnected] = useState(false);
    const [imagePreview, setImagePreview] = useState<string | null>(null); 

    const ws = useRef<WebSocket | null>(null);
    const chatAreaRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const sessionId = useRef<string>(crypto.randomUUID());

    const [theme, setTheme] = useState<Theme>(() => {
        const savedTheme = localStorage.getItem('theme') as Theme | null;
        if (savedTheme) {
            return savedTheme;
        }
        // Set theme based on user's system preference
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    });


     // Changing theme when value changes
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

    useEffect(() => {
        const connect = () => {
            // Don't try to connect if we already have a connection that is opening or open.
            if (ws.current && (ws.current.readyState === WebSocket.CONNECTING || ws.current.readyState === WebSocket.OPEN)) {
                console.log("WebSocket is already connecting or open.");
                return;
            }

            console.log("Attempting to connect to WebSocket...");
            const socket = new WebSocket(`ws://localhost:5000?sessionId=${sessionId.current}`);
            ws.current = socket;

            socket.onopen = () => {
                console.log('✅ Connected to WebSocket server');
                setIsWsConnected(true);
            };

            socket.onmessage = (event) => {
                const data = JSON.parse(event.data);

                if (data.reply) {
                    flushSync(() => {
                        setMessages(prev => {
                            const newMessages = [...prev];
                            const lastMessage = newMessages[newMessages.length - 1];
                            if (lastMessage && lastMessage.sender === 'ai') {
                                lastMessage.text += data.reply;
                            }
                            return newMessages;
                        });
                    });
                }

                if (data.endOfStream) {
                    console.log('Stream ended.');
                    setIsLoading(false);
                }

                if (data.error) {
                    console.error('Server error:', data.error);
                    setMessages(prev => {
                        const newMessages = [...prev];
                        newMessages[newMessages.length - 1].text = `Sorry, an error occurred: ${data.error}`;
                        return newMessages;
                    });
                    setIsLoading(false);
                }
            };

            socket.onclose = () => {
                console.log('❌ Disconnected from WebSocket server. Attempting to reconnect...');
                setIsWsConnected(false);
                // Simple reconnection logic: try to reconnect after 3 seconds.
                setTimeout(() => {
                    // The cleanup function will set ws.current to null if the component unmounts.
                    // This check prevents reconnection attempts on a dismounted component.
                    if (ws.current) { 
                        connect();
                    }
                }, 3000);
            };

            socket.onerror = (error) => {
                console.error('WebSocket error:', error);
                setMessages(prev => {
                    const newMessages = [...prev];
                    const lastMessage = newMessages[newMessages.length - 1];
                    if (lastMessage && lastMessage.sender === 'ai') {
                        lastMessage.text = "Sorry, I'm having trouble connecting. Please try again.";
                    }
                    return newMessages;
                });
                setIsLoading(false);
                // When an error occurs, the 'onclose' event will usually follow,
                // which will trigger the reconnection logic.
                socket.close();
            };
        };

        connect();

        // Cleanup function runs when the component unmounts.
        return () => {
            console.log("Cleaning up WebSocket connection.");
            const socket = ws.current;
            ws.current = null; // This prevents the reconnect logic in onclose from running.
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.close();
            }
        };
    }, []);

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setImageFile(file);
            setImagePreview(URL.createObjectURL(file));
        }
    };

    const handleSendMessage = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const userMessage = inputValue.trim();

        // Don't send if there's no message or if we're already waiting for a response.
        if (!userMessage && !imageFile) return;
        
        // Check if the WebSocket is ready.
        if (!isWsConnected || !ws.current || ws.current.readyState !== WebSocket.OPEN) {
            // Show an error message to the user.
            setMessages(prev => [...prev, { text: "I'm not connected right now. Please wait while I try to reconnect...", sender: 'ai' }]);
            return;
        }

        setIsLoading(true);
        setInputValue("");

        let imagePath = null;
        if (imageFile) {
            const formData = new FormData();
            formData.append('image', imageFile);
            try {
                const response = await fetch('http://localhost:5000/upload', {
                    method: 'POST',
                    body: formData,
                });
                const data = await response.json();
                imagePath = data.filePath;
            } catch (error) {
                console.error('Error uploading image:', error);
                setMessages(prev => [...prev, { text: "Sorry, I couldn't upload your image. Please try again.", sender: 'ai' }]);
                setIsLoading(false);
                return;
            }
        }

        //creating message history for the models
        // Add user message and AI placeholder to the chat.
        const newUserMessage: Message = { text: userMessage, sender: "user", image: imagePreview ?? undefined };
        const aiPlaceholder: Message = { text: "", sender: "ai" };
        setMessages(prev => [...prev, newUserMessage, aiPlaceholder]);

        // Reset image states
        setImageFile(null);
        setImagePreview(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }

        // Send the message over the persistent WebSocket connection.
        ws.current.send(JSON.stringify({ message: userMessage, imagePath }));
    };


    // ✨ --- function to call theme change --- ✨
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
                            {msg.image && <img src={msg.image} alt="User upload" className="message-image" />}
                            {msg.sender === 'ai' ? (
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {msg.text}
                                </ReactMarkdown>
                            ) : (
                                msg.text
                            )}
                        </div>
                    ))}
                    {/* The loading indicator to show while response is being generated */}
                    {isLoading && <div className="message loading">Just a second</div>}
                </div>
                {imagePreview && (
                    <div className="image-preview-container">
                        <img src={imagePreview} alt="Preview" className="image-preview" />
                        <button onClick={() => {
                            setImageFile(null);
                            setImagePreview(null);
                            if (fileInputRef.current) {
                                fileInputRef.current.value = "";
                            }
                        }} className="remove-image-button">
                            &times;
                        </button>
                    </div>
                )}
                <form className="input-form" onSubmit={handleSendMessage}>
                    <input
                        type="file"
                        accept="image/png, image/jpeg"
                        onChange={handleImageChange}
                        style={{ display: 'none' }}
                        ref={fileInputRef}
                    />
                    <button type="button" className="attach-button" onClick={() => fileInputRef.current?.click()}>
                        📎
                    </button>
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