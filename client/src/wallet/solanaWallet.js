export function createWalletManager() {
  let provider = null;
  let publicKey = null;
  let connected = false;

  function getProvider() {
    if (window.solana?.isPhantom) return window.solana;
    if (window.solflare?.isSolflare) return window.solflare;
    if (window.backpack) return window.backpack;
    return null;
  }

  async function connect() {
    provider = getProvider();
    if (!provider) {
      throw new Error("No Solana wallet found. Install Phantom, Solflare, or Backpack.");
    }
    const resp = await provider.connect();
    publicKey = resp.publicKey.toString();
    connected = true;
    return publicKey;
  }

  async function disconnect() {
    if (provider) {
      try { await provider.disconnect(); } catch {}
    }
    publicKey = null;
    connected = false;
  }

  async function sendSol(toAddress, amountSol) {
    if (!provider || !connected) throw new Error("Wallet not connected");

    const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = await import("https://esm.sh/@solana/web3.js@1.95.8");
    const connection = new Connection("https://api.mainnet-beta.solana.com");

    const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(publicKey),
        toPubkey: new PublicKey(toAddress),
        lamports
      })
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = new PublicKey(publicKey);

    const signed = await provider.signTransaction(transaction);
    const signature = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(signature, "confirmed");

    return signature;
  }

  return {
    connect,
    disconnect,
    sendSol,
    isConnected: () => connected,
    getPublicKey: () => publicKey,
    hasWallet: () => !!getProvider()
  };
}
