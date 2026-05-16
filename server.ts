import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_FILE = path.join(__dirname, 'db.json');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

async function readDB() {
  const data = await fs.readFile(DB_FILE, 'utf-8');
  return JSON.parse(data);
}

async function writeDB(data: any) {
  await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Auth Middleware
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  };

  // --- API Routes ---

  // Auth
  app.post('/api/register', async (req, res) => {
    const { name, email, password, role } = req.body;
    const db = await readDB();
    if (db.users.find((u: any) => u.email === email)) {
      return res.status(400).json({ error: 'User already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = { id: Date.now().toString(), name, email, password: hashedPassword, role };
    db.users.push(newUser);
    await writeDB(db);
    res.status(201).json({ message: 'User registered' });
  });

  app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const db = await readDB();
    const user = db.users.find((u: any) => u.email === email);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET);
    res.json({ token, user: { id: user.id, name: user.name, role: user.role, email: user.email } });
  });

  app.get('/api/users', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    const db = await readDB();
    res.json(db.users.map(({ password, ...u }: any) => u));
  });

  // Products
  app.get('/api/products', async (req, res) => {
    const db = await readDB();
    const { search } = req.query;
    let products = db.products;
    if (search) {
      products = products.filter((p: any) => 
        p.title.toLowerCase().includes((search as string).toLowerCase()) ||
        p.SKU.toLowerCase().includes((search as string).toLowerCase())
      );
    }
    res.json(products);
  });

  app.post('/api/products', authenticateToken, async (req, res) => {
    const db = await readDB();
    const newProduct = { ...req.body, id: Date.now().toString() };
    db.products.push(newProduct);
    await writeDB(db);
    res.status(201).json(newProduct);
  });

  app.put('/api/products/:id', authenticateToken, async (req, res) => {
    const db = await readDB();
    const index = db.products.findIndex((p: any) => p.id === req.params.id);
    if (index === -1) return res.sendStatus(404);
    db.products[index] = { ...db.products[index], ...req.body };
    await writeDB(db);
    res.json(db.products[index]);
  });

  app.delete('/api/products/:id', authenticateToken, async (req, res) => {
    const db = await readDB();
    db.products = db.products.filter((p: any) => p.id !== req.params.id);
    await writeDB(db);
    res.sendStatus(204);
  });

  // Sales Orders
  app.get('/api/sales-orders', authenticateToken, async (req, res) => {
    const db = await readDB();
    res.json(db.salesOrders);
  });

  app.post('/api/sales-orders', async (req, res) => {
    const db = await readDB();
    const newOrder = { 
      ...req.body, 
      id: `SO-${Date.now()}`, 
      createdAt: new Date().toISOString() 
    };
    db.salesOrders.push(newOrder);
    
    // Create Invoice if completed
    if (newOrder.status === 'completed') {
       db.invoices.push({
         id: `INV-${Date.now()}`,
         orderId: newOrder.id,
         amount: newOrder.totalPrice,
         createdAt: new Date().toISOString()
       });
    }

    await writeDB(db);
    res.status(201).json(newOrder);
  });

  // Dashboard Stats
  app.get('/api/dashboard-stats', authenticateToken, async (req, res) => {
    const db = await readDB();
    const totalSales = db.salesOrders.reduce((acc: number, o: any) => acc + (o.totalPrice || 0), 0);
    const lowStockCount = db.products.filter((p: any) => p.stock <= p.reorderLevel).length;
    const orderCount = db.salesOrders.length;
    const userCount = db.users.length;

    res.json({
      totalSales,
      lowStockCount,
      orderCount,
      userCount,
      recentOrders: db.salesOrders.slice(-5).reverse(),
      inventoryStats: db.products.slice(0, 5)
    });
  });

  // --- Vite Integration ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
