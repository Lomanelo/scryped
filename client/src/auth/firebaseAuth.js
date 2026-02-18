let firebaseApp = null;
let firebaseAuth = null;
let currentUser = null;
let initialized = false;

export async function initFirebase(config) {
  if (initialized) return;
  if (!config?.apiKey || !config?.projectId) {
    console.warn("[firebase-auth] No config provided, auth disabled");
    return;
  }

  const firebase = await import("https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js");
  const auth = await import("https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js");

  firebaseApp = firebase.initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId
  });

  firebaseAuth = auth.getAuth(firebaseApp);
  initialized = true;

  auth.onAuthStateChanged(firebaseAuth, (user) => {
    currentUser = user;
  });
}

export async function signInWithGoogle() {
  if (!firebaseAuth) throw new Error("Firebase not initialized");

  const auth = await import("https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js");
  const provider = new auth.GoogleAuthProvider();
  const result = await auth.signInWithPopup(firebaseAuth, provider);
  currentUser = result.user;
  const idToken = await result.user.getIdToken();
  return { idToken, user: result.user };
}

export async function getIdToken() {
  if (!currentUser) return null;
  return currentUser.getIdToken(true);
}

export async function signOut() {
  if (!firebaseAuth) return;
  const auth = await import("https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js");
  await auth.signOut(firebaseAuth);
  currentUser = null;
}

export function getCurrentUser() {
  return currentUser;
}

export function isInitialized() {
  return initialized;
}

export async function waitForAuthReady() {
  if (!firebaseAuth) return null;
  const auth = await import("https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js");
  return new Promise((resolve) => {
    const unsub = auth.onAuthStateChanged(firebaseAuth, (user) => {
      unsub();
      currentUser = user;
      resolve(user);
    });
  });
}
