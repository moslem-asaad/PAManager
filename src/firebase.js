import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence, createUserWithEmailAndPassword, getAuth,
  onAuthStateChanged, sendPasswordResetEmail, setPersistence,
  signInWithEmailAndPassword, signOut,
} from "firebase/auth";
import {
  collection, deleteDoc, doc, enableMultiTabIndexedDbPersistence,
  getDocs, getFirestore, initializeFirestore, onSnapshot, orderBy,
  persistentLocalCache, persistentMultipleTabManager, query, serverTimestamp,
  setDoc, updateDoc, writeBatch,
} from "firebase/firestore";
import { firebaseConfig } from "../firebase-config.js";

const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);

let db;
try {
  db = initializeFirestore(firebaseApp, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch {
  db = getFirestore(firebaseApp);
  enableMultiTabIndexedDbPersistence(db).catch(() => {});
}
export { db };

export const authApi = {
  observe: (callback) => onAuthStateChanged(auth, callback),
  register: async (email, password) => {
    await setPersistence(auth, browserLocalPersistence);
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "users", credential.user.uid), {
      email: credential.user.email, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }, { merge: true });
    return credential;
  },
  login: async (email, password) => {
    await setPersistence(auth, browserLocalPersistence);
    return signInWithEmailAndPassword(auth, email, password);
  },
  logout: () => signOut(auth),
  resetPassword: (email) => sendPasswordResetEmail(auth, email),
};

const userRef = (uid) => doc(db, "users", uid);
const yearsRef = (uid) => collection(userRef(uid), "years");
const yearRef = (uid, year) => doc(yearsRef(uid), String(year));
const monthsRef = (uid, year) => collection(yearRef(uid, year), "months");
const monthRef = (uid, year, month) => doc(monthsRef(uid, year), String(month));
const paymentsRef = (uid, year, month) => collection(monthRef(uid, year, month), "payments");
const paymentRef = (uid, year, month, paymentId) => doc(paymentsRef(uid, year, month), paymentId);

export const storeApi = {
  watchYears(uid, next, error) {
    return onSnapshot(query(yearsRef(uid), orderBy("year", "desc")), { includeMetadataChanges: true }, next, error);
  },
  watchMonth(uid, year, month, next, error) {
    const unsubMonth = onSnapshot(monthRef(uid, year, month), { includeMetadataChanges: true },
      (snap) => next({ type: "month", data: snap.exists() ? snap.data() : null, metadata: snap.metadata }), error);
    const unsubPayments = onSnapshot(query(paymentsRef(uid, year, month), orderBy("createdAt", "asc")), { includeMetadataChanges: true },
      (snap) => next({ type: "payments", data: snap.docs.map((entry) => ({ id: entry.id, ...entry.data() })), metadata: snap.metadata }), error);
    return () => { unsubMonth(); unsubPayments(); };
  },
  async createYear(uid, year) {
    const batch = writeBatch(db);
    batch.set(yearRef(uid, year), { year, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    for (let month = 0; month <= 12; month += 1) {
      batch.set(monthRef(uid, year, month), month === 0
        ? { monthNumber: 0, updatedAt: serverTimestamp() }
        : { monthNumber: month, walletValue: 0, expectedIncome: 0, updatedAt: serverTimestamp() });
    }
    await batch.commit();
  },
  async updateMonth(uid, year, month, fields) {
    await setDoc(monthRef(uid, year, month), { monthNumber: month, ...fields, updatedAt: serverTimestamp() }, { merge: true });
    await updateDoc(yearRef(uid, year), { updatedAt: serverTimestamp() });
  },
  async addPayment(uid, year, month, payment) {
    const ref = doc(paymentsRef(uid, year, month));
    await setDoc(ref, { ...payment, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return ref.id;
  },
  updatePayment(uid, year, month, id, fields) {
    return updateDoc(paymentRef(uid, year, month, id), { ...fields, updatedAt: serverTimestamp() });
  },
  deletePayment(uid, year, month, id) { return deleteDoc(paymentRef(uid, year, month, id)); },
  async deleteYear(uid, year) {
    for (let month = 0; month <= 12; month += 1) {
      const payments = await getDocs(paymentsRef(uid, year, month));
      for (let offset = 0; offset < payments.docs.length; offset += 400) {
        const batch = writeBatch(db);
        payments.docs.slice(offset, offset + 400).forEach((entry) => batch.delete(entry.ref));
        await batch.commit();
      }
      await deleteDoc(monthRef(uid, year, month));
    }
    await deleteDoc(yearRef(uid, year));
  },
  async exportAll(uid) {
    const yearSnaps = await getDocs(query(yearsRef(uid), orderBy("year", "asc")));
    const years = [];
    for (const yearSnap of yearSnaps.docs) {
      const months = [];
      const monthSnaps = await getDocs(query(monthsRef(uid, yearSnap.id), orderBy("monthNumber", "asc")));
      for (const monthSnap of monthSnaps.docs) {
        const paymentSnaps = await getDocs(query(paymentsRef(uid, yearSnap.id, monthSnap.id), orderBy("createdAt", "asc")));
        const clean = monthSnap.data();
        months.push({ monthNumber: clean.monthNumber, walletValue: clean.walletValue ?? 0, expectedIncome: clean.expectedIncome ?? 0,
          payments: paymentSnaps.docs.map((p) => ({ id: p.id, recipient: p.data().recipient, amount: p.data().amount, paid: p.data().paid })) });
      }
      years.push({ year: Number(yearSnap.id), months });
    }
    return { format: "hisabati-backup", version: 1, exportedAt: new Date().toISOString(), years };
  },
  async importAll(uid, backup, mode, progress = () => {}) {
    if (mode === "replace") {
      const existing = await getDocs(yearsRef(uid));
      for (const entry of existing.docs) await this.deleteYear(uid, entry.id);
    }
    let completed = 0;
    const total = backup.years.reduce((sum, year) => sum + year.months.reduce((n, month) => n + 1 + month.payments.length, 0), 0);
    for (const year of backup.years) {
      await setDoc(yearRef(uid, year.year), { year: year.year, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
      for (const month of year.months) {
        await setDoc(monthRef(uid, year.year, month.monthNumber), {
          monthNumber: month.monthNumber, ...(month.monthNumber ? { walletValue: Number(month.walletValue), expectedIncome: Number(month.expectedIncome) } : {}), updatedAt: serverTimestamp(),
        }, { merge: true });
        completed += 1; progress(completed, total);
        for (let offset = 0; offset < month.payments.length; offset += 400) {
          const batch = writeBatch(db);
          month.payments.slice(offset, offset + 400).forEach((payment) => {
            const ref = payment.id ? paymentRef(uid, year.year, month.monthNumber, payment.id) : doc(paymentsRef(uid, year.year, month.monthNumber));
            batch.set(ref, { recipient: payment.recipient.trim(), amount: Number(payment.amount), paid: payment.paid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: mode === "merge" });
          });
          await batch.commit(); completed += Math.min(400, month.payments.length - offset); progress(completed, total);
        }
      }
    }
  },
  async deleteAll(uid) {
    const existing = await getDocs(yearsRef(uid));
    for (const entry of existing.docs) await this.deleteYear(uid, entry.id);
  },
};
