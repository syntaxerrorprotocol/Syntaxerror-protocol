import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createPostResponse } from '@solana/actions';
import { Redis } from '@upstash/redis';
import nacl from 'tweetnacl';

// Initialize Upstash Redis with REST credentials
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const WALLET_COOLDOWN = 60; // 1 minute anti-spam

export default async function handler(req, res) {
    // 1. MANDATORY HEADERS FOR BLINKS & CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Action-Version, X-Blockchain-Ids');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Action-Version', '1');
    // Supporting both mainnet aliases for maximum client compatibility
    res.setHeader('X-Blockchain-Ids', 'solana:mainnet-beta,solana:mainnet');

    // 2. PREFLIGHT HANDLER (Stops Dial.to CORS Errors)
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    try {
        const url = new URL(req.url, `https://${req.headers.host}`);
        const size = url.searchParams.get('size');

        // --- GET: DYNAMIC INVENTORY & UI ---
        if (req.method === 'GET') {
            const remaining = await redis.scard('available_serials');
            
            return res.status(200).json({
                // Updated to your self-hosted Vercel path
                icon: "https://syntaxerror-protocol.vercel.app/ghost.png",
                title: `GHOST_PROTOCOL [${remaining}/900]`,
                description: "SECURE_TRANSACTION_INITIALIZED. CHOOSE_SIZE.",
                label: "MINT_GHOST",
                links: {
                    actions: [{
                        label: `INITIALIZE_PURCHASE ($3,000)`,
                        href: "/api/genesis?size={size}",
                        parameters: [{
                            name: "size",
                            label: "SELECT_SIZE",
                            type: "select",
                            options: [
                                { label: "US 8", value: "US8" },
                                { label: "US 9", value: "US9" },
                                { label: "US 10", value: "US10" },
                                { label: "US 11", value: "US11" },
                                { label: "US 12", value: "US12" }
                            ]
                        }]
                    }]
                }
            });
        }

        // --- POST: SECURE PURCHASE & ATOMIC DRAW ---
        if (req.method === 'POST') {
            const { account, signature, message } = req.body;

            // Cryptographic Verification
            if (!account || !signature || message !== "GENESIS_GHOST_PROTOCOL_PURCHASE") {
                return res.status(401).json({ error: "AUTH_FAILED" });
            }
            const pubKey = new PublicKey(account).toBytes();
            const msgBytes = new TextEncoder().encode(message);
            const sigBytes = Buffer.from(signature, 'base64');
            if (!nacl.sign.detached.verify(msgBytes, sigBytes, pubKey)) {
                return res.status(401).json({ error: "INVALID_SIGNATURE" });
            }

            // Anti-Sniper Check
            if (await redis.get(`cooldown:${account}`)) {
                return res.status(429).json({ error: "COOLDOWN_ACTIVE" });
            }

            // Atomic Draw from the 900 Pool
            const assignedSerial = await redis.spop('available_serials');
            if (!assignedSerial) return res.status(400).json({ error: "SOLD_OUT" });

            // SOL Price Conversion
            const priceRes = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
            const solPrice = parseFloat((await priceRes.json()).price);
            const totalSOL = 3000 / solPrice;

            const connection = new Connection(process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com");
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: new PublicKey(account),
                    toPubkey: new PublicKey(process.env.TREASURY_WALLET),
                    lamports: Math.floor(totalSOL * 0.7 * LAMPORTS_PER_SOL),
                }),
                SystemProgram.transfer({
                    fromPubkey: new PublicKey(account),
                    toPubkey: new PublicKey(process.env.OPS_WALLET),
                    lamports: Math.floor(totalSOL * 0.3 * LAMPORTS_PER_SOL)
                })
            );
            transaction.feePayer = new PublicKey(account);
            transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

            // Finalize Ledger & Cooldown
            await redis.set(`cooldown:${account}`, "1", { ex: WALLET_COOLDOWN });
            await redis.hset(`assigned:${assignedSerial}`, { wallet: account, size: size, timestamp: Date.now() });

            return res.status(200).json(await createPostResponse({
                fields: { 
                    transaction, 
                    message: `SUCCESS. SERIAL: ${assignedSerial}. SIZE: ${size}.` 
                },
            }));
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "SYSTEM_FAILURE" });
    }
}

