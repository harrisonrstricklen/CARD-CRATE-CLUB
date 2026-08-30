// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDpx0EZyq2CdDru3UBDGlpA2qcUiqt0ed8",
  authDomain: "cardcrate-club.firebaseapp.com",
  projectId: "cardcrate-club",
  storageBucket: "cardcrate-club.firebasestorage.app",
  messagingSenderId: "261800955788",
  appId: "1:261800955788:web:3f07f4c60886b26d05d0a9",
  measurementId: "G-5B8J0LWGKE"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);