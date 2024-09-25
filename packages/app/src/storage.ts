import {openDB, deleteDB} from "idb"
import type {IDBPDatabase} from "idb"
import {throttle} from "throttle-debounce"
import {writable} from "svelte/store"
import type {Unsubscriber, Writable} from "svelte/store"
import {indexBy, equals, fromPairs} from "@welshman/lib"
import type {TrustedEvent, Repository} from "@welshman/util"
import type {Tracker} from "@welshman/net"
import {withGetter, adapter, throttled, custom} from "@welshman/store"

export type IndexedDbAdapterOptions = {
  migrate?: (items: any[]) => any[]
}

export type IndexedDbAdapter = {
  keyPath: string
  store: Writable<any[]>
  options?: IndexedDbAdapterOptions
}

export let db: IDBPDatabase

export const dead = withGetter(writable(false))

export const subs: Unsubscriber[] = []

export const getAll = async (name: string) => {
  const tx = db.transaction(name, "readwrite")
  const store = tx.objectStore(name)
  const result = await store.getAll()

  await tx.done

  return result
}

export const bulkPut = async (name: string, data: any[]) => {
  const tx = db.transaction(name, "readwrite")
  const store = tx.objectStore(name)

  await Promise.all(data.map(item => store.put(item)))
  await tx.done
}

export const bulkDelete = async (name: string, ids: string[]) => {
  const tx = db.transaction(name, "readwrite")
  const store = tx.objectStore(name)

  await Promise.all(ids.map(id => store.delete(id)))
  await tx.done
}

export const initIndexedDbAdapter = async (name: string, adapter: IndexedDbAdapter) => {
  let prevRecords = await getAll(name)

  if (adapter.options?.migrate) {
    prevRecords = adapter.options.migrate(prevRecords)
  }

  adapter.store.set(prevRecords)

  adapter.store.subscribe(
    async (currentRecords: any[]) => {
      if (dead.get()) {
        return
      }

      const currentIds = new Set(currentRecords.map(item => item[adapter.keyPath]))
      const removedRecords = prevRecords.filter(r => !currentIds.has(r[adapter.keyPath]))

      const prevRecordsById = indexBy(item => item[adapter.keyPath], prevRecords)
      const updatedRecords = currentRecords.filter(r => !equals(r, prevRecordsById.get(r[adapter.keyPath])))

      prevRecords = currentRecords

      if (updatedRecords.length > 0) {
        await bulkPut(name, updatedRecords)
      }

      if (removedRecords.length > 0) {
        await bulkDelete(
          name,
          removedRecords.map(item => item[adapter.keyPath]),
        )
      }
    },
  )
}

export const initStorage = async (name: string, version: number, adapters: Record<string, IndexedDbAdapter>) => {
  if (!window.indexedDB) return

  window.addEventListener("beforeunload", () => closeStorage())

  if (db) {
    throw new Error("Db initialized multiple times")
  }

  db = await openDB(name, version, {
    upgrade(db: IDBPDatabase) {
      const names = Object.keys(adapters)

      for (const name of db.objectStoreNames) {
        if (!names.includes(name)) {
          db.deleteObjectStore(name)
        }
      }

      for (const [name, {keyPath}] of Object.entries(adapters)) {
        try {
          db.createObjectStore(name, {keyPath})
        } catch (e) {
          console.warn(e)
        }
      }
    },
  })

  await Promise.all(
    Object.entries(adapters).map(([name, config]) => initIndexedDbAdapter(name, config)),
  )
}

export const closeStorage = async () => {
  dead.set(true)
  subs.forEach(unsub => unsub())
  await db?.close()
}

export const clearStorage = async () => {
  await closeStorage()
  await deleteDB(db.name)
}

export type StorageAdapterOptions = IndexedDbAdapterOptions & {
  throttle?: number
}

export const storageAdapters = {
  fromObjectStore: <T>(store: Writable<Record<string, T>>, options: StorageAdapterOptions = {}) => ({
    options,
    keyPath: "key",
    store: adapter({
      store: throttled(options.throttle || 0, store),
      forward: ($data: Record<string, T>) =>
        Object.entries($data).map(([key, value]) => ({key, value})),
      backward: (data: {key: string, value: T}[]) =>
        fromPairs(data.map(({key, value}) => [key, value])),
    }),
  }),
  fromMapStore: <T>(store: Writable<Map<string, T>>, options: StorageAdapterOptions = {}) => ({
    options,
    keyPath: "key",
    store: adapter({
      store: throttled(options.throttle || 0, store),
      forward: ($data: Map<string, T>) =>
        Array.from($data.entries()).map(([key, value]) => ({key, value})),
      backward: (data: {key: string, value: T}[]) =>
        new Map(data.map(({key, value}) => [key, value])),
    }),
  }),
  fromTracker: (tracker: Tracker, options: StorageAdapterOptions = {}) => ({
    options,
    keyPath: 'key',
    store: custom(setter => {
      let onUpdate = () =>
        setter(
          Array.from(tracker.data.entries())
            .map(([key, urls]) => ({key, value: Array.from(urls)}))
        )

      if (options.throttle) {
        onUpdate = throttle(options.throttle, onUpdate)
      }

      onUpdate()
      tracker.on('update', onUpdate)

      return () => tracker.off('update', onUpdate)
    }, {
      set: (data: {key: string, value: string[]}[]) =>
        tracker.load(new Map(data.map(({key, value}) => [key, new Set(value)]))),
    }),
  }),
  fromRepository: (repository: Repository, options: StorageAdapterOptions = {}) => ({
    options,
    keyPath: 'id',
    store: custom(setter => {
      let onUpdate = () => setter(repository.dump())

      if (options.throttle) {
        onUpdate = throttle(options.throttle, onUpdate)
      }

      onUpdate()
      repository.on('update', onUpdate)

      return () => repository.off('update', onUpdate)
    }, {
      set: (events: TrustedEvent[]) => repository.load(events),
    }),
  }),
}