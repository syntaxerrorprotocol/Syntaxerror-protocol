import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createPostResponse } from '@solana/actions';
import whitelist from '../whitelist.json';

export default async function handler(req, res) {
    // Basic Metadata Headers
    res.setHeader('X-Action-Version', '1');
    res.setHeader('X-Blockchain-Ids', 'solana:mainnet');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const url = new URL(req.url, `https://${req.headers.host}`);
        const size = url.searchParams.get("size");

        if (req.method === 'GET') {
            return res.status(200).json({
                icon: "https://raw.githubusercontent.com/syntaxerrorprotocol/Syntaxerror-protocol/main/assets/ghost-render.png",
                title: "GENESIS_GHOST_PROTOCOL",
                description: "CHOSEN_STATUS: ACTIVE. SELECT_SIZE.",
                label: "MINT_GHOST",
                links: {
                    actions: [
                        {
                            label: "INITIALIZE_PURCHASE ($3,000 SOL)",
                            href: "/api/genesis?size={size}",
                            parameters: [
                                {
                                    name: "size",
                                    label: "SELECT_SIZE",
                                    type: "select",
                                    options: [
                                        { label: "US 9", value: "US9" },
                                        { label: "US 10", value: "US10" },
                                        { label: "US 11", value: "US11" }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            });
        }

        if (req.method === 'POST') {
            const { account } = req.body;
            if (!account || !whitelist.includes(account)) {
                return res.status(403).json({ title: "UNAUTHORIZED", message: "ACCESS_DENIED" });
            }

            const connection = new Connection(process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com");
            const priceRes = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
            const priceData = await priceRes.json();
            const totalSOL = 3000 / parseFloat(priceData.price);

            const transaction = new Transaction().add(
                SystemProgram.transfer({ fromPubkey: new PublicKey(account), toPubkey: new PublicKey(process.env.TREASURY_WALLET), lamports: Math.floor(totalSOL * 0.7 * LAMPORTS_PER_SOL) }),
                SystemProgram.transfer({ fromPubkey: new PublicKey(account), toPubkey: new PublicKey(process.env.OPS_WALLET), lamports: Math.floor(totalSOL * 0.3 * LAMPORTS_PER_SOL) })
            );

            transaction.feePayer = new PublicKey(account);
            transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

            const payload = await createPostResponse({
                fields: { transaction, message: `PURCHASE_CONFIRMED: SIZE_${size}` },
            });
            return res.status(200).json(payload);
        }
    } catch (err) {
        return res.status(500).json({ error: "INTERNAL_ERROR" });
    }
}

