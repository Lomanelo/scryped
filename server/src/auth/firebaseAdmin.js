import admin from "firebase-admin";

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  console.warn("[firebase] Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY. Auth/Firestore disabled.");
}

let app = null;
let db = null;

if (projectId && clientEmail && privateKey) {
  try {
    app = admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey })
    });
    db = admin.firestore();
    console.log("[firebase] Admin SDK initialized");
  } catch (err) {
    console.error("[firebase] Failed to initialize:", err.message);
  }
}

export function isFirebaseEnabled() {
  return !!db;
}

export async function verifyToken(idToken) {
  if (!app) throw new Error("Firebase not configured");
  return admin.auth().verifyIdToken(idToken);
}

export async function getUser(uid) {
  if (!db) return null;
  const doc = await db.collection("users").doc(uid).get();
  if (!doc.exists) return null;
  return { uid, ...doc.data() };
}

export async function createUser(uid, data) {
  if (!db) return null;
  const userData = {
    email: data.email || "",
    displayName: data.displayName || "",
    walletAddress: data.walletAddress || "",
    balanceSol: 0,
    depositedSol: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };
  await db.collection("users").doc(uid).set(userData);
  return { uid, ...userData, balanceSol: 0, depositedSol: 0 };
}

export async function getOrCreateUser(uid, data) {
  let user = await getUser(uid);
  if (!user) {
    user = await createUser(uid, data);
  }
  return user;
}

export async function getUserBalance(uid) {
  const user = await getUser(uid);
  if (!user) return { balanceSol: 0, depositedSol: 0, walletAddress: "" };
  return { balanceSol: user.balanceSol || 0, depositedSol: user.depositedSol || 0, walletAddress: user.walletAddress || "" };
}

export async function creditUserSol(uid, amountSol) {
  if (!db) return;
  await db.collection("users").doc(uid).update({
    balanceSol: admin.firestore.FieldValue.increment(amountSol),
    depositedSol: admin.firestore.FieldValue.increment(amountSol)
  });
}

export async function debitUserSol(uid, amountSol) {
  if (!db) return false;
  const ref = db.collection("users").doc(uid);
  return db.runTransaction(async (t) => {
    const doc = await t.get(ref);
    if (!doc.exists) return false;
    const current = doc.data().balanceSol || 0;
    if (current < amountSol - 0.000001) return false;
    t.update(ref, { balanceSol: current - amountSol });
    return true;
  });
}

export async function setUserWallet(uid, walletAddress) {
  if (!db) return;
  await db.collection("users").doc(uid).update({ walletAddress });
}

export async function creditUserPayoutSol(uid, amountSol) {
  if (!db) return;
  await db.collection("users").doc(uid).update({
    balanceSol: admin.firestore.FieldValue.increment(amountSol)
  });
}

export async function recordHouseFee(feeUsd, playerUid) {
  if (!db) return;
  await db.collection("house_earnings").add({
    amount: feeUsd,
    playerUid,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });
  const houseRef = db.collection("meta").doc("house");
  await houseRef.set(
    { totalEarnings: admin.firestore.FieldValue.increment(feeUsd) },
    { merge: true }
  );
}

export async function isSignatureProcessed(signature) {
  if (!db) return false;
  const doc = await db.collection("processed_signatures").doc(signature).get();
  return doc.exists;
}

export async function markSignatureProcessed(signature, uid, lamports) {
  if (!db) return;
  await db.collection("processed_signatures").doc(signature).set({
    uid,
    lamports,
    processedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

export async function setUserBalance(uid, amountSol) {
  if (!db) return;
  await db.collection("users").doc(uid).update({ balanceSol: amountSol });
}

export { admin, db };
