import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createPostResponse } from '@solana/actions';
import Redis from 'ioredis';
import nacl from 'tweetnacl';

const redis = new Redis(process.env.REDIS_URL);

// --- 🛡️ ANTI-SNIPER CONFIG ---
const WALLET_COOLDOWN = 30; 
const MAX_PURCHASES_PER_WALLET = 1;
const RATE_LIMIT_WINDOW = 10;
const MAX_REQUESTS_PER_IP = 5;

// --- 👟 SIZE & RARITY CONFIG ---
const SIZE_CONFIG = {
  M6: { priceMultiplier: 1.0, rarity: "COMMON" }, M7: { priceMultiplier: 1.0, rarity: "COMMON" },
  M8: { priceMultiplier: 1.0, rarity: "COMMON" }, M9: { priceMultiplier: 1.0, rarity: "COMMON" },
  M10: { priceMultiplier: 1.0, rarity: "COMMON" }, M11: { priceMultiplier: 1.1, rarity: "UNCOMMON" },
  M12: { priceMultiplier: 1.2, rarity: "RARE" }, M13: { priceMultiplier: 1.4, rarity: "LEGENDARY" },
  W5: { priceMultiplier: 1.0, rarity: "COMMON" }, W6: { priceMultiplier: 1.0, rarity: "COMMON" },
  W7: { priceMultiplier: 1.0, rarity: "COMMON" }, W8: { priceMultiplier: 1.0, rarity: "COMMON" },
  W9: { priceMultiplier: 1.1, rarity: "UNCOMMON" }, W10: { priceMultiplier: 1.2, rarity: "RARE" },
  W11: { priceMultiplier: 1.4, rarity: "LEGENDARY" },
};

// --- 🔐 SIGNATURE VERIFICATION ---
function verifySignature(account, signature, message) {
  try {
    const publicKey = new PublicKey(account).toBytes();
    const msgBytes = new TextEncoder().encode(message);
    const sigBytes = Buffer.from(signature, 'base64');
    return nacl.sign.detached.verify(msgBytes, sigBytes, publicKey);
  } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Action-Version', '1');
  res.setHeader('X-Blockchain-Ids', 'solana:mainnet');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const size = url.searchParams.get('size');

    // --- GET: DYNAMIC INVENTORY FETCH ---
    if (req.method === 'GET') {
      const entries = await Promise.all(Object.keys(SIZE_CONFIG).map(async (s) => ({ size: s, stock: parseInt(await redis.get(`stock:${s}`) || 0) })));
      const options = entries.filter(e => e.stock > 0).map(e => ({
        label: `${e.size.startsWith("M") ? "US Men" : "US Women"} ${e.size.slice(1)} (${e.stock} LEFT)`,
        value: e.size,
      }));

      return res.status(200).json({
        icon: "https://raw.githubusercontent.com/syntaxerrorprotocol/Syntaxerror-protocol/main/assets/ghost-render.png",
        title: "GENESIS_GHOST_PROTOCOL",
        description: "SECURE_MINT_INITIALIZED. SELECT_SIZE.",
        label: "MINT_GHOST",
        links: { actions: [{ label: "INITIALIZE PURCHASE", href: "/api/genesis?size={size}", parameters: [{ name: "size", label: "SIZE", type: "select", options }] }] }
      });
    }

    // --- POST: SECURE TRANSACTION ---
    if (req.method === 'POST') {
      const { account, signature, message } = req.body;
      const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || "unknown";

      // 1. Signature Check
      if (!account || !signature || message !== "GENESIS_GHOST_PROTOCOL_PURCHASE" || !verifySignature(account, signature, message)) {
        return res.status(401).json({ error: "INVALID_SIGNATURE" });
      }

      // 2. IP Rate Limit
      if (await redis.incr(`rate:${ip}`) > MAX_REQUESTS_PER_IP) return res.status(429).json({ error: "RATE_LIMITED" });
      await redis.expire(`rate:${ip}`, RATE_LIMIT_WINDOW);

      // 3. Wallet Cooldown & Replay Protection
      if (await redis.get(`cooldown:${account}`)) return res.status(429).json({ error: "COOLDOWN_ACTIVE" });
      await redis.set(`cooldown:${account}`, "1", "EX", WALLET_COOLDOWN);

      // 4. Purchase Limit
      const pCount = await redis.incr(`purchases:${account}`);
      if (pCount === 1) await redis.expire(`purchases:${account}`, 86400);
      if (pCount > MAX_PURCHASES_PER_WALLET) return res.status(403).json({ error: "PURCHASE_LIMIT_REACHED" });

      // 5. Inventory & Pricing
      if (!SIZE_CONFIG[size]) return res.status(400).json({ error: "INVALID_SIZE" });
      if (await redis.decr(`stock:${size}`) < 0) {
          await redis.incr(`stock:${size}`); // Revert
          return res.status(400).json({ error: "SOLD_OUT" });
      }

      const priceRes = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
      const solPrice = parseFloat((await priceRes.json()).price);
      const totalSOL = (3000 * SIZE_CONFIG[size].priceMultiplier) / solPrice;

      const connection = new Connection(process.env.SOLANA_RPC);
      const transaction = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: new PublicKey(account), toPubkey: new PublicKey(process.env.TREASURY_WALLET), lamports: Math.floor(totalSOL * 0.7 * LAMPORTS_PER_SOL) }),
        SystemProgram.transfer({ fromPubkey: new PublicKey(account), toPubkey: new PublicKey(process.env.OPS_WALLET), lamports: Math.floor(totalSOL * 0.3 * LAMPORTS_PER_SOL) })
      );

      transaction.feePayer = new PublicKey(account);
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      return res.status(200).json(await createPostResponse({
        fields: { transaction, message: `CONFIRMED: ${size} | ${SIZE_CONFIG[size].rarity}` },
      }));
    }
  } catch (err) { return res.status(500).json({ error: "INTERNAL_ERROR" }); }
}

