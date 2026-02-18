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

export async function verifyDeposit(connection, signature, expectedLamports, houseWallet) {
  try {
    const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx || !tx.meta) return { valid: false, reason: "Transaction not found" };
    if (tx.meta.err) return { valid: false, reason: "Transaction failed" };

    const postBalances = tx.meta.postBalances;
    const preBalances = tx.meta.preBalances;
    const accounts = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;

    const houseIndex = accounts.findIndex((k) => k.toBase58() === houseWallet);
    if (houseIndex === -1) return { valid: false, reason: "House wallet not in transaction" };

    const received = postBalances[houseIndex] - preBalances[houseIndex];
    if (received < expectedLamports * 0.99) {
      return { valid: false, reason: `Insufficient amount: got ${received}, expected ${expectedLamports}` };
    }

    return { valid: true, lamports: received };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}
