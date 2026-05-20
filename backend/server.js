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

// Estado por sesión
const sessions = {};

// Sesiones activas (códigos que tienen app iOS conectada)
const activeSessions = new Set();

app.get('/health', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));
app.get('/', (req, res) => res.send('WikiMentalism Server OK'));

// Endpoint para verificar si una sesión está activa
app.get('/session/:code', (req, res) => {
  const code = req.params.code;
  res.json({ active: activeSessions.has(code) });
});

io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);
  let joinedRoom = null;
  let isHost     = false; // true = app iOS, false = frontend

  // Unirse a sala como HOST (app iOS del mago)
  socket.on('join-room-host', (sessionCode) => {
    socket.join(sessionCode);
    joinedRoom = sessionCode;
    isHost     = true;
    activeSessions.add(sessionCode);
    console.log(`[HOST] Sala activa: ${sessionCode}`);

    if (!sessions[sessionCode]) {
      sessions[sessionCode] = { article: null, selectedText: null, lastLink: null };
    }

    // Notificar al frontend si ya estaba esperando
    io.to(sessionCode).emit('session-activated', { active: true });
  });

  // Unirse a sala como ESPECTADOR (frontend web)
  socket.on('join-room', (sessionCode) => {
    socket.join(sessionCode);
    joinedRoom = sessionCode;
    isHost     = false;

    // Verificar si la sesión está activa (el mago está conectado)
    const isActive = activeSessions.has(sessionCode);
    socket.emit('session-status', { active: isActive });

    if (isActive && sessions[sessionCode]) {
      socket.emit('state-sync', { lastState: sessions[sessionCode] });
    }

    console.log(`[ESPECTADOR] Sala: ${sessionCode} — Activa: ${isActive}`);
  });

  // Verificar estado de sesión
  socket.on('check-session', (sessionCode) => {
    socket.emit('session-status', { active: activeSessions.has(sessionCode) });
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
    // Si era el host, marcar sesión como inactiva
    if (isHost && joinedRoom) {
      activeSessions.delete(joinedRoom);
      io.to(joinedRoom).emit('session-status', { active: false });
      console.log(`[HOST] Desconectado — Sala inactiva: ${joinedRoom}`);
    }
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
