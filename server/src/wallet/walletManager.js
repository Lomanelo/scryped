import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

const HOUSE_FEE = 0.15;
const ENTRY_FEE_USD = 1.0;
const SOL_PRICE_CACHE_MS = 60_000;

let cachedSolPrice = null;
let lastPriceFetch = 0;

const playerBalances = new Map();

export function getHouseFee() { return HOUSE_FEE; }
export function getEntryFeeUsd() { return ENTRY_FEE_USD; }

export async function getSolPrice() {
  const now = Date.now();
  if (cachedSolPrice && now - lastPriceFetch < SOL_PRICE_CACHE_MS) {
    return cachedSolPrice;
  }
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    const data = await res.json();
    cachedSolPrice = data.solana.usd;
    lastPriceFetch = now;
    return cachedSolPrice;
  } catch {
    return cachedSolPrice || 150;
  }
}

export async function getEntryFeeSol() {
  const price = await getSolPrice();
  return ENTRY_FEE_USD / price;
}

export function getPlayerBalance(walletAddress) {
  return playerBalances.get(walletAddress) || { deposited: 0, balance: 0, walletAddress };
}

export function setPlayerBalance(walletAddress, balance) {
  const existing = playerBalances.get(walletAddress) || { deposited: 0, balance: 0, walletAddress };
  existing.balance = balance;
  playerBalances.set(walletAddress, existing);
}

export function creditPlayer(walletAddress, amountUsd) {
  const existing = playerBalances.get(walletAddress) || { deposited: 0, balance: 0, walletAddress };
  existing.balance += amountUsd;
  existing.deposited += amountUsd;
  playerBalances.set(walletAddress, existing);
}

export function debitPlayer(walletAddress, amountUsd) {
  const existing = playerBalances.get(walletAddress) || { deposited: 0, balance: 0, walletAddress };
  if (existing.balance < amountUsd) return false;
  existing.balance -= amountUsd;
  playerBalances.set(walletAddress, existing);
  return true;
}

export function calculateCashout(inGameBalance) {
  const fee = inGameBalance * HOUSE_FEE;
  const payout = inGameBalance - fee;
  return { payout, fee, feePercent: HOUSE_FEE * 100 };
}

const processedSignatures = new Set();

function resolveKey(k) {
  if (typeof k === "string") return k;
  if (typeof k?.toBase58 === "function") return k.toBase58();
  if (k?.toString) return k.toString();
  return String(k);
}

function getAllAccountKeys(tx) {
  const msg = tx.transaction.message;
  const staticKeys = msg.staticAccountKeys || msg.accountKeys || [];
  const keys = staticKeys.map(resolveKey);

  if (tx.meta?.loadedAddresses) {
    const w = tx.meta.loadedAddresses.writable || [];
    const r = tx.meta.loadedAddresses.readonly || [];
    for (const k of [...w, ...r]) keys.push(resolveKey(k));
  }
  return keys;
}

function findHouseDeposit(tx, houseWallet) {
  const hw = houseWallet.trim();
  const keys = getAllAccountKeys(tx);

  console.log(`[deposit-verify] Looking for house wallet: "${hw}"`);
  console.log(`[deposit-verify] Transaction has ${keys.length} accounts`);

  for (let i = 0; i < keys.length; i++) {
    const diff = tx.meta.postBalances[i] - tx.meta.preBalances[i];
    if (keys[i] === hw) {
      console.log(`[deposit-verify] House wallet found at index ${i}, balance diff: ${diff}`);
      if (diff > 0) return diff;
    }
    if (diff > 0) {
      console.log(`[deposit-verify] Account ${i} (${keys[i].slice(0,8)}...) gained ${diff} lamports`);
    }
  }

  let bestReceived = 0;
  for (let i = 0; i < keys.length; i++) {
    const diff = tx.meta.postBalances[i] - tx.meta.preBalances[i];
    if (diff > bestReceived && keys[i] !== "11111111111111111111111111111111") {
      bestReceived = diff;
      const acct = keys[i];
      if (acct.startsWith(hw.slice(0, 4)) && acct.endsWith(hw.slice(-4))) {
        console.log(`[deposit-verify] Partial match at index ${i}: ${acct}, diff: ${diff}`);
        return diff;
      }
    }
  }

  const innerIxs = tx.meta?.innerInstructions || [];
  for (const group of innerIxs) {
    for (const ix of group.instructions || []) {
      if (ix.parsed?.type === "transfer" && ix.parsed?.info?.destination === hw) {
        console.log(`[deposit-verify] Found in inner instructions: ${ix.parsed.info.lamports} lamports`);
        return ix.parsed.info.lamports;
      }
    }
  }

  console.log(`[deposit-verify] No positive balance change found for house wallet`);
  console.log(`[deposit-verify] All keys: ${JSON.stringify(keys)}`);
  console.log(`[deposit-verify] All diffs: ${JSON.stringify(keys.map((_, i) => tx.meta.postBalances[i] - tx.meta.preBalances[i]))}`);
  return 0;
}

export async function scanDepositsFrom(connection, senderAddress, houseWallet) {
  const deposits = [];
  try {
    const senderPubkey = new PublicKey(senderAddress);
    const sigs = await connection.getSignaturesForAddress(senderPubkey, { limit: 10 }, "confirmed");

    for (const sigInfo of sigs) {
      if (processedSignatures.has(sigInfo.signature)) continue;
      if (sigInfo.err) continue;

      try {
        const tx = await connection.getTransaction(sigInfo.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        if (!tx || !tx.meta || tx.meta.err) continue;

        const received = findHouseDeposit(tx, houseWallet);
        if (received > 0) {
          processedSignatures.add(sigInfo.signature);
          deposits.push({ signature: sigInfo.signature, lamports: received });
        }
      } catch {}
    }
  } catch {}
  return deposits;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function verifyDeposit(connection, signature, expectedLamports, houseWallet) {
  const MAX_RETRIES = 8;
  const RETRY_DELAY_MS = 3000;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });

      if (!tx || !tx.meta) {
        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        return { valid: false, reason: "Transaction not found after waiting. It may still be processing -- try refreshing your balance in a minute." };
      }

      if (tx.meta.err) return { valid: false, reason: "Transaction failed on-chain" };

      const received = findHouseDeposit(tx, houseWallet);

      if (received <= 0) {
        const keys = getAllAccountKeys(tx);
        const houseFound = keys.includes(houseWallet.trim());
        if (!houseFound) {
          return { valid: false, reason: `House wallet not in transaction. Expected: ${houseWallet.trim().slice(0,8)}...${houseWallet.trim().slice(-4)}. Keys in tx: ${keys.map(k => k.slice(0,8)).join(", ")}` };
        }
        const houseIdx = keys.indexOf(houseWallet.trim());
        const diff = tx.meta.postBalances[houseIdx] - tx.meta.preBalances[houseIdx];
        return { valid: false, reason: `House wallet balance change: ${diff} lamports. Check HOUSE_WALLET env var is set to the RECEIVING address.` };
      }

      if (received < expectedLamports * 0.90) {
        return { valid: false, reason: `Amount too low: received ${(received / LAMPORTS_PER_SOL).toFixed(6)} SOL, expected ~${(expectedLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL` };
      }

      processedSignatures.add(signature);
      return { valid: true, lamports: received };
    } catch (err) {
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      return { valid: false, reason: err.message };
    }
  }

  return { valid: false, reason: "Verification timed out. Try refreshing your balance." };
}
