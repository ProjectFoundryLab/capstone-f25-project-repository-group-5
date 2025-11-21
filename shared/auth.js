// shared/auth.js is for the user to be displayed on each page
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCCv10iytVHPyRSB4dAotE2UBCRqr2sJ-8",
  authDomain: "sqldatabasetest-473020.firebaseapp.com",
  projectId: "sqldatabasetest-473020",
  storageBucket: "sqldatabasetest-473020.appspot.com",
  messagingSenderId: "725327609427",
  appId: "1:725327609427:web:989af1506e170afc0650a6",
  measurementId: "G-WCZ3JSGH71"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const db = getFirestore(app);

// Make this function available to all pages
export function loadUserProfile() {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = "../index.html";
        return;
      }

      const userRef = doc(db, "users", user.uid);
      const snap = await getDoc(userRef);

      if (!snap.exists()) {
        reject("No profile");
        return;
      }

      resolve(snap.data());
    });
  });
}

export function logout() {
  return signOut(auth).then(() => {
    window.location.href = "../index.html";
  });
}
