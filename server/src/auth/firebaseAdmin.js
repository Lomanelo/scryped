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
  app = admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey })
  });
  db = admin.firestore();
  console.log("[firebase] Admin SDK initialized");
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
    balance: 0,
    deposited: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };
  await db.collection("users").doc(uid).set(userData);
  return { uid, ...userData, balance: 0, deposited: 0 };
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
  if (!user) return { balance: 0, deposited: 0, walletAddress: "" };
  return { balance: user.balance || 0, deposited: user.deposited || 0, walletAddress: user.walletAddress || "" };
}

export async function creditUserBalance(uid, amountUsd) {
  if (!db) return;
  await db.collection("users").doc(uid).update({
    balance: admin.firestore.FieldValue.increment(amountUsd),
    deposited: admin.firestore.FieldValue.increment(amountUsd)
  });
}

export async function debitUserBalance(uid, amountUsd) {
  if (!db) return false;
  const ref = db.collection("users").doc(uid);
  return db.runTransaction(async (t) => {
    const doc = await t.get(ref);
    if (!doc.exists) return false;
    const current = doc.data().balance || 0;
    if (current < amountUsd) return false;
    t.update(ref, { balance: current - amountUsd });
    return true;
  });
}

export async function setUserWallet(uid, walletAddress) {
  if (!db) return;
  await db.collection("users").doc(uid).update({ walletAddress });
}

export async function creditUserPayout(uid, amountUsd) {
  if (!db) return;
  await db.collection("users").doc(uid).update({
    balance: admin.firestore.FieldValue.increment(amountUsd)
  });
}

export { admin, db };
