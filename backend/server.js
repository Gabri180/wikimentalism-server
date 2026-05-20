'use strict';
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');

const PORT = process.env.PORT || 3000;

const app    = express();
const server = http.createServer(app);

app.use(cors({ origin: '*' }));
app.use(express.json());

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});

// Estado por sesión: { [sessionCode]: { article, selectedText, lastLink, updatedAt } }
const sessions = {};

app.get('/health', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));
app.get('/', (req, res) => res.send('WikiMentalism Server OK'));

io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  // Unirse a una sala con código de sesión único
  socket.on('join-room', (sessionCode) => {
    socket.join(sessionCode);
    console.log(`Socket ${socket.id} entró a sala: ${sessionCode}`);

    // Si hay estado previo, enviarlo al nuevo cliente
    if (sessions[sessionCode]) {
      socket.emit('state-sync', { lastState: sessions[sessionCode] });
    } else {
      sessions[sessionCode] = { article: null, selectedText: null, lastLink: null };
    }
  });

  socket.on('article-loaded', (data) => {
    const { room, article, url, timestamp } = data;
    if (!room) return;
    if (!sessions[room]) sessions[room] = {};
    sessions[room].article   = article;
    sessions[room].updatedAt = Date.now();
    io.to(room).emit('article-loaded', { type: 'article-loaded', article, url, timestamp });
    console.log(`[${room}] Artículo: ${article}`);
  });

  socket.on('text-selected', (data) => {
    const { room, selectedText, article, timestamp } = data;
    if (!room) return;
    if (!sessions[room]) sessions[room] = {};
    sessions[room].selectedText = selectedText;
    sessions[room].updatedAt    = Date.now();
    io.to(room).emit('text-selected', { type: 'text-selected', selectedText, article, timestamp });
    console.log(`[${room}] Seleccionado: ${selectedText}`);
  });

  socket.on('link-clicked', (data) => {
    const { room, linkText, targetArticle, timestamp } = data;
    if (!room) return;
    if (!sessions[room]) sessions[room] = {};
    sessions[room].lastLink  = targetArticle;
    sessions[room].updatedAt = Date.now();
    io.to(room).emit('link-clicked', { type: 'link-clicked', linkText, targetArticle, timestamp });
  });

  socket.on('heartbeat', (data) => {
    const { room } = data;
    if (!room) return;
    io.to(room).emit('heartbeat', data);
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

// Limpiar sesiones inactivas cada hora
setInterval(() => {
  const now = Date.now();
  Object.keys(sessions).forEach(code => {
    if (sessions[code].updatedAt && now - sessions[code].updatedAt > 3600000) {
      delete sessions[code];
      console.log(`Sesión eliminada: ${code}`);
    }
  });
}, 3600000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('WikiMentalism Server ONLINE - Puerto:', PORT);
});
