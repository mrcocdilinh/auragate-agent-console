import type { AgentState } from "./types";

const DB_NAME = "auragate-agent-vault";
const STORE_NAME = "crypto";
const KEY_ID = "device-key";
const STORAGE_KEY = "auragate-agent-vault:v1";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getDeviceKey(): Promise<CryptoKey> {
  const db = await openDb();
  const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(KEY_ID);
    request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
    request.onerror = () => reject(request.error);
  });
  if (existing) return existing;

  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(key, KEY_ID);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  return key;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function hasSavedVault(): boolean {
  return typeof window !== "undefined" && Boolean(localStorage.getItem(STORAGE_KEY));
}

export async function saveAgentVault(agents: AgentState[]): Promise<void> {
  const key = await getDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(agents));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ iv: toBase64(iv), data: toBase64(new Uint8Array(ciphertext)) }));
}

export async function loadAgentVault(): Promise<AgentState[] | null> {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return null;
  const payload = JSON.parse(saved) as { iv: string; data: string };
  const key = await getDeviceKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(payload.iv) },
    key,
    fromBase64(payload.data),
  );
  const agents = JSON.parse(new TextDecoder().decode(plaintext)) as AgentState[];
  return Array.isArray(agents) ? agents : null;
}

export function clearAgentVault(): void {
  localStorage.removeItem(STORAGE_KEY);
}
