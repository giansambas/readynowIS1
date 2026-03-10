import express from "express";
import { createServer as createViteServer } from "vite";
import session from "express-session";
import { neon } from "@neondatabase/serverless";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sql = neon(process.env.DATABASE_URL!);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(session({
    secret: process.env.SESSION_SECRET || "readynow-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: { 
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }));

  // --- Auth Routes ---

  app.post("/api/auth/register", async (req, res) => {
    const { username, password } = req.body;
    try {
      const result = await sql`
        INSERT INTO users (username, password) 
        VALUES (${username}, ${password}) 
        RETURNING id, username
      `;
      const user = result[0];
      (req.session as any).user = user;
      res.json(user);
    } catch (err: any) {
      if (err.code === '23505') { // Postgres unique constraint violation
        res.status(400).json({ error: "Username already exists" });
      } else {
        console.error(err);
        res.status(500).json({ error: "Registration failed" });
      }
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body;
    try {
      const result = await sql`
        SELECT id, username FROM users 
        WHERE username = ${username} AND password = ${password}
      `;
      const user = result[0];
      if (user) {
        (req.session as any).user = user;
        res.json(user);
      } else {
        res.status(401).json({ error: "Invalid credentials" });
      }
    } catch (err) {
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    res.json({ user: (req.session as any).user || null });
  });

  // --- Report Routes ---

  app.get("/api/report", async (req, res) => {
    try {
      const reports = await sql`
        SELECT r.*, u.username 
        FROM reports r 
        LEFT JOIN users u ON r.user_id = u.id 
        WHERE r.created_at >= NOW() - INTERVAL '24 hours'
        ORDER BY r.created_at DESC
      `;
      res.json(reports);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch reports" });
    }
  });

  app.post("/api/report", async (req, res) => {
    const user = (req.session as any).user;
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { location, disaster, description } = req.body;
    try {
      await sql`
        INSERT INTO reports (user_id, location, disaster, description) 
        VALUES (${user.id}, ${location}, ${disaster}, ${description})
      `;
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to save report" });
    }
  });

  // --- Vite / Static ---

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
