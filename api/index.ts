import express from "express";
import session from "express-session";
import { neon } from "@neondatabase/serverless";

const app = express();
app.use(express.json());

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.warn("DATABASE_URL is not defined. Database features will fail.");
}
const sql = neon(databaseUrl || "");

app.use(session({
  secret: process.env.SESSION_SECRET || "readynow-secret-key",
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: true, 
    sameSite: 'none',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

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
    if (err.code === '23505') {
      res.status(400).json({ error: "Username already exists" });
    } else {
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
  if (!user) return res.status(401).json({ error: "Unauthorized" });
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

export default app;
