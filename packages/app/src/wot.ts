import {throttle} from 'throttle-debounce'
import {derived, writable} from 'svelte/store'
import {addToMapKey, inc, dec} from '@welshman/lib'
import {getListValues} from '@welshman/util'
import {throttled, withGetter} from '@welshman/store'
import {pubkey} from './session'
import {follows, getFollows, followsByPubkey} from './follows'
import {mutes, getMutes} from './mutes'

export const followersByPubkey = withGetter(
  derived(
    throttled(1000, follows),
    lists => {
      const $followersByPubkey = new Map<string, Set<string>>()

      for (const list of lists) {
        for (const pubkey of getListValues("p", list)) {
          addToMapKey($followersByPubkey, pubkey, list.event.pubkey)
        }
      }

      return $followersByPubkey
    }
  )
)

export const mutersByPubkey = withGetter(
  derived(
    throttled(1000, mutes),
    lists => {
      const $mutersByPubkey = new Map<string, Set<string>>()

      for (const list of lists) {
        for (const pubkey of getListValues("p", list)) {
          addToMapKey($mutersByPubkey, pubkey, list.event.pubkey)
        }
      }

      return $mutersByPubkey
    }
  )
)

export const getFollowers = (pubkey: string) =>
  Array.from(followersByPubkey.get().get(pubkey) || [])

export const getMuters = (pubkey: string) =>
  Array.from(mutersByPubkey.get().get(pubkey) || [])

export const getFollowsWhoFollow = (pubkey: string, target: string) =>
  getFollows(pubkey).filter(other => getFollows(other).includes(target))

export const getFollowsWhoMute = (pubkey: string, target: string) =>
  getFollows(pubkey).filter(other => getMutes(other).includes(target))

export const wotGraph = withGetter(writable(new Map<string, number>()))

const buildGraph = throttle(1000, () => {
  const $pubkey = pubkey.get()
  const $graph = new Map<string, number>()
  const $follows = $pubkey ? getFollows($pubkey) : followsByPubkey.get().keys()

  for (const follow of $follows) {
    for (const pubkey of getFollows(follow)) {
      $graph.set(pubkey, inc($graph.get(pubkey)))
    }

    for (const pubkey of getMutes(follow)) {
      $graph.set(pubkey, dec($graph.get(pubkey)))
    }
  }

  wotGraph.set($graph)
})

pubkey.subscribe(buildGraph)
follows.subscribe(buildGraph)
mutes.subscribe(buildGraph)

export const getWotScore = (pubkey: string, target: string) => {
  const follows = pubkey ? getFollowsWhoFollow(pubkey, target) : getFollowers(target)
  const mutes = pubkey ? getFollowsWhoMute(pubkey, target) : getMuters(target)

  return follows.length - mutes.length
}

export const getUserWotScore = (pubkey: string) => wotGraph.get().get(pubkey) || 0