import {uniq} from '@welshman/lib'
import {matchFilters, unionFilters, isSignedEvent, hasValidSignature} from '@welshman/util'
import type {Filter, TrustedEvent} from '@welshman/util'
import {Pool} from "./Pool"
import {Executor} from "./Executor"
import {Relays} from "./target/Relays"
import type {Subscription} from "./Subscribe"

export const defaultPool = new Pool()

export const defaultGetExecutor = (relays: string[]) =>
  new Executor(new Relays(relays.map((relay: string) => NetworkContext.pool.get(relay))))

const defaultOnEvent = (url: string, event: TrustedEvent) => null

const defaultOnAuth = (url: string, challenge: string) => null

const defaultOnOk = (url: string, id: string, ok: boolean, message: string) => null

const defaultIsDeleted = (url: string, event: TrustedEvent) => false

const defaultHasValidSignature = (url: string, event: TrustedEvent) => isSignedEvent(event) && hasValidSignature(event)

const defaultMatchFilters = (url: string, filters: Filter[], event: TrustedEvent) => matchFilters(filters, event)

export function* defaultOptimizeSubscriptions(subs: Subscription[]) {
  for (const relay of uniq(subs.flatMap(sub => sub.request.relays || []))) {
    const relaySubs = subs.filter(sub => sub.request.relays.includes(relay))
    const filters = unionFilters(relaySubs.flatMap(sub => sub.request.filters))

    yield {relays: [relay], filters}
  }
}

export const NetworkContext = {
  pool: defaultPool,
  getExecutor: defaultGetExecutor,
  onEvent: defaultOnEvent,
  onAuth: defaultOnAuth,
  onOk: defaultOnOk,
  isDeleted: defaultIsDeleted,
  hasValidSignature: defaultHasValidSignature,
  matchFilters: defaultMatchFilters,
  optimizeSubscriptions: defaultOptimizeSubscriptions,
}
