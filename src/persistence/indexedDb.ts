import {
  CURRENT_WORKSPACE_ID,
  DB_NAME,
  DB_VERSION,
  PRESETS_STORE,
  SCHEMA_VERSION,
  WORKSPACE_STORE,
} from '../constants';
import { cloneSettings, isValidPersistedSettings, normalizeSettings, validatePresetName } from '../domain/validation';
import type { PresetRecord, RenderSettings, WorkspaceRecord } from '../types';

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function isSupportedSchemaVersion(value: unknown): boolean {
  return value === 1 || value === SCHEMA_VERSION;
}

function normalizePresetRecord(record: unknown): PresetRecord | null {
  if (!record || typeof record !== 'object') return null;
  const candidate = record as Partial<PresetRecord> & { schemaVersion?: unknown };
  if (!isSupportedSchemaVersion(candidate.schemaVersion)
    || typeof candidate.id !== 'string'
    || typeof candidate.name !== 'string'
    || candidate.builtIn !== false
    || typeof candidate.createdAt !== 'number' || !Number.isFinite(candidate.createdAt)
    || typeof candidate.updatedAt !== 'number' || !Number.isFinite(candidate.updatedAt)) return null;
  const { id, name, createdAt, updatedAt } = candidate;
  const nameValidation = validatePresetName(name);
  if (!nameValidation.valid) return null;
  if (candidate.schemaVersion === SCHEMA_VERSION && !isValidPersistedSettings(candidate)) return null;
  const settings = normalizeSettings(candidate);
  return {
    ...settings,
    id,
    name: nameValidation.name,
    builtIn: false,
    createdAt,
    updatedAt,
  };
}

export function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('IndexedDB is unavailable'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(WORKSPACE_STORE)) {
        database.createObjectStore(WORKSPACE_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(PRESETS_STORE)) {
        const store = database.createObjectStore(PRESETS_STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
  });
}

export class IndexedDbRepository {
  constructor(private readonly databasePromise: Promise<IDBDatabase> = openDatabase()) {}

  async loadCurrent(): Promise<RenderSettings | null> {
    const database = await this.databasePromise;
    const transaction = database.transaction(WORKSPACE_STORE, 'readonly');
    const request = transaction.objectStore(WORKSPACE_STORE).get(CURRENT_WORKSPACE_ID);
    const record = await requestToPromise<WorkspaceRecord | undefined>(request);
    await transactionToPromise(transaction);
    if (!record || !isSupportedSchemaVersion(record.schemaVersion)) return null;
    if (record.schemaVersion === SCHEMA_VERSION && !isValidPersistedSettings(record.settings)) return null;
    return normalizeSettings(record.settings);
  }

  async saveCurrent(settings: RenderSettings): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(WORKSPACE_STORE, 'readwrite');
    transaction.objectStore(WORKSPACE_STORE).put({
      id: CURRENT_WORKSPACE_ID,
      schemaVersion: SCHEMA_VERSION,
      settings: cloneSettings(settings),
      updatedAt: Date.now(),
    } satisfies WorkspaceRecord);
    await transactionToPromise(transaction);
  }

  async listPresets(): Promise<PresetRecord[]> {
    const database = await this.databasePromise;
    const transaction = database.transaction(PRESETS_STORE, 'readonly');
    const request = transaction.objectStore(PRESETS_STORE).getAll();
    const records = await requestToPromise<unknown[]>(request);
    await transactionToPromise(transaction);
    return records
      .map(normalizePresetRecord)
      .filter((record): record is PresetRecord => record !== null)
      .sort((left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id));
  }

  async createPreset(record: PresetRecord): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(PRESETS_STORE, 'readwrite');
    const store = transaction.objectStore(PRESETS_STORE);
    const count = await requestToPromise<number>(store.count());
    if (count >= 100) throw new Error('Preset limit reached');
    store.add({ ...record, builtIn: false, schemaVersion: SCHEMA_VERSION });
    await transactionToPromise(transaction);
  }

  async updatePreset(record: PresetRecord): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(PRESETS_STORE, 'readwrite');
    transaction.objectStore(PRESETS_STORE).put({ ...record, builtIn: false, schemaVersion: SCHEMA_VERSION });
    await transactionToPromise(transaction);
  }

  async deletePreset(id: string): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(PRESETS_STORE, 'readwrite');
    transaction.objectStore(PRESETS_STORE).delete(id);
    await transactionToPromise(transaction);
  }
}
