import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { ACTIONS_CORS_HEADERS, createPostResponse } from '@solana/actions';
import whitelist from '../whitelist.json';

export default async function handler(req, res) {
    // 1. Enable CORS for Solana Wallets
    if (req.method === 'OPTIONS') {
        return res.status(200).set(ACTIONS_CORS_HEADERS).end();
    }

    try {
        const { account } = req.body;
        const url = new URL(req.url, `https://${req.headers.host}`);
        const size = url.searchParams.get("size");

        // 2. The Gatekeeper: Whitelist Check
        // Ensures only the scraped 900-1000 wallets can interact
        if (req.method === 'POST' && !whitelist.includes(account)) {
            return res.status(403).json({
                icon: "https://raw.githubusercontent.com/syntaxerrorprotocol/Syntaxerror-protocol/main/assets/access-denied.png",
                title: "SYSTEM_ERROR",
                description: "WALLET_NOT_AUTHORIZED. ACCESS_DENIED.",
                label: "TERMINATED",
                disabled: true
            });
        }

        // 3. GET Request: The Interface (What the user sees in Phantom/Solflare)
        if (req.method === 'GET') {
            return res.status(200).set(ACTIONS_CORS_HEADERS).json({
                icon: "https://raw.githubusercontent.com/syntaxerrorprotocol/Syntaxerror-protocol/main/assets/ghost-render.png",
                title: "GENESIS_GHOST_PROTOCOL",
                description: "CHOSEN_STATUS: ACTIVE. SELECT_SIZE_TO_INITIALIZE_MINT.",
                label: "MINT_GHOST",
                links: {
                    actions: [
                        {
                            label: "INITIALIZE_PURCHASE ($3,000 SOL)",
                            href: "/api/genesis?size={size}",
                            parameters: [
                                {
                                    name: "size",
                                    label: "SELECT_INTERNATIONAL_SIZE",
                                    type: "select",
                                    options: [
                                        { label: "US 7 / UK 6 / EU 40", value: "US7" },
                                        { label: "US 8 / UK 7 / EU 41", value: "US8" },
                                        { label: "US 8.5 / UK 7.5 / EU 42", value: "US8.5" },
                                        { label: "US 9 / UK 8 / EU 42.5", value: "US9" },
                                        { label: "US 9.5 / UK 8.5 / EU 43", value: "US9.5" },
                                        { label: "US 10 / UK 9 / EU 44", value: "US10" },
                                        { label: "US 10.5 / UK 9.5 / EU 44.5", value: "US10.5" },
                                        { label: "US 11 / UK 10 / EU 45", value: "US11" },
                                        { label: "US 12 / UK 11 / EU 46", value: "US12" },
                                        { label: "US 13 / UK 12 / EU 47", value: "US13" }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            });
        }

        // 4. POST Request: The $3,000 Split Logic
        const connection = new Connection(process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com");
        const buyer = new PublicKey(account);
        const treasury = new PublicKey(process.env.TREASURY_WALLET);
        const ops = new PublicKey(process.env.OPS_WALLET);

        // Fetch Live Price to ensure exactly $3,000 USD
        const priceRes = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
        const priceData = await priceRes.json();
        const solPrice = parseFloat(priceData.price);
        const totalSOL = 3000 / solPrice; 

        // Calculate 70/30 Split in Lamports
        const treasuryAmount = Math.floor(totalSOL * 0.7 * LAMPORTS_PER_SOL);
        const opsAmount = Math.floor(totalSOL * 0.3 * LAMPORTS_PER_SOL);

        // Build the Multi-Instruction Transaction
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: buyer,
                toPubkey: treasury,
                lamports: treasuryAmount,
            }),
            SystemProgram.transfer({
                fromPubkey: buyer,
                toPubkey: ops,
                lamports: opsAmount,
            })
        );

        transaction.feePayer = buyer;
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        const payload = await createPostResponse({
            fields: { 
                transaction, 
                message: `PURCHASE_CONFIRMED: SIZE_${size}. SERIAL_GENERATING...` 
            },
        });

        res.status(200).set(ACTIONS_CORS_HEADERS).json(payload);

    } catch (err) {
        console.error(err);
        res.status(500).set(ACTIONS_CORS_HEADERS).json({ error: "INTERNAL_SYSTEM_ERROR" });
    }
}

