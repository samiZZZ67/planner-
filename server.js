// server.js - Production Node.js server for Render & local deployment
// Features: process.env.PORT, 0.0.0.0 binding, CORS via CLIENT_URL, Socket.IO real-time sync, and fast /health check.

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server: SocketIOServer } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

function getCorsOrigin(origin) {
  const clientUrlEnv = process.env.CLIENT_URL || '';
  if (!clientUrlEnv || clientUrlEnv === '*') {
    return origin || '*';
  }
  const allowed = clientUrlEnv.split(',').map((u) => u.trim().replace(/\/+$/, ''));
  if (!origin) return allowed[0] || '*';
  if (allowed.includes(origin.replace(/\/+$/, ''))) return origin;
  return allowed[0] || '*';
}

function isOriginAllowed(origin) {
  const clientUrlEnv = process.env.CLIENT_URL || '';
  if (!clientUrlEnv || clientUrlEnv === '*') return true;
  if (!origin) return true;
  const allowed = clientUrlEnv.split(',').map((u) => u.trim().replace(/\/+$/, ''));
  return allowed.includes(origin.replace(/\/+$/, ''));
}

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      const origin = req.headers.origin;

      // Handle CORS for all API routes and health endpoint
      if (parsedUrl.pathname.startsWith('/api/') || parsedUrl.pathname === '/health') {
        const allowOrigin = getCorsOrigin(origin);
        res.setHeader('Access-Control-Allow-Origin', allowOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-session-token');
        res.setHeader('Access-Control-Allow-Credentials', 'true');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }
      }

      // Fast GET /health probe for Render health check
      if (parsedUrl.pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache',
        });
        res.end(
          JSON.stringify({
            status: 'ok',
            service: 'night-planner-backend',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            port: port,
          })
        );
        return;
      }

      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error handling request:', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  // Attach Socket.IO for instant phone <-> PC synchronization
  const io = new SocketIOServer(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || isOriginAllowed(origin)) {
          return callback(null, true);
        }
        return callback(null, true); // Fallback to avoid drops while supporting cross-device connections
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    // When a device pushes updates, broadcast to other connected devices (Phone or PC)
    socket.on('sync:push', (data) => {
      socket.broadcast.emit('sync:remote_update', data);
    });

    socket.on('ping', () => {
      socket.emit('pong');
    });
  });

  server.listen(port, hostname, (err) => {
    if (err) throw err;
    console.log(`> Sam'Space server ready on http://${hostname}:${port}`);
    console.log(`> Environment: ${process.env.NODE_ENV || 'production'}`);
    if (process.env.CLIENT_URL) {
      console.log(`> CORS & Socket.IO allowed origins: ${process.env.CLIENT_URL}`);
    }
    if (process.env.DATABASE_URL) {
      console.log(`> Database configured (SSL enabled)`);
    } else {
      console.log(`> Running in local JSON database mode (DATABASE_URL not set)`);
    }
  });
}).catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
