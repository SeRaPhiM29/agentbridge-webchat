// webchat/firebase-config.js
//
// Use Firebase Console > Project Settings > General > Your apps > Web app config.
// Do NOT use your service account/private admin key here.

/*****************************************************************************************************
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAbqzDyOa_qv0FCg-sxnmYYNAIgmSmQQco",
  authDomain: "agentbridge-6e4a8.firebaseapp.com",
  databaseURL: "https://agentbridge-6e4a8-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "agentbridge-6e4a8",
  storageBucket: "agentbridge-6e4a8.firebasestorage.app",
  messagingSenderId: "160049425240",
  appId: "1:160049425240:web:b3c414475f7f9ed165132d"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
*******************************************************************************************************/

window.AGENTBRIDGE_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAbqzDyOa_qv0FCg-sxnmYYNAIgmSmQQco",
  authDomain: "agentbridge-6e4a8.firebaseapp.com",
  databaseURL: "https://agentbridge-6e4a8-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "agentbridge-6e4a8",
  storageBucket: "agentbridge-6e4a8.firebasestorage.app",
  messagingSenderId: "160049425240",
  appId: "1:160049425240:web:b3c414475f7f9ed165132d"
};

// Firebase database paths used by AgentBridge Core v1.
window.AGENTBRIDGE_PATHS = {
  inboxLatest: "agentBridge/inbox/latest",
  outboxLatest: "agentBridge/outbox/latest",
  history: "agentBridge/history",
  activeSession: "agentBridge/activeSession"
};

// Web chat identity.
// This becomes the sender field seen by AgentBridge.
window.AGENTBRIDGE_WEBCHAT = {
  sender: "Mobile-WebChat",
  clientType: "webchat",
  historyLimit: 100,
  DEBUG_MODE: true
};
