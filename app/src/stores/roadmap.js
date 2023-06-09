import { browser } from '$app/environment'

import { utils } from 'ethers'

import { proxied } from 'svelte-proxied-store'

import { defaultEvmStores as evm, signer, chainId } from 'svelte-ethers-store'

import blockchain from '$lib/blockchain.js'
import ipfs from '$lib/ipfs.js'

const createStore = () => {
  const lock = {}
  let roadmapAddresses = []
  let userRoadmapAddresses = []

  const roadmapKey = ($chainId) =>
    `roadfund:manager:${$chainId || evm.$chainId}`

  const userKey = ($chainId, $signerAddress) =>
    `roadfund:user:${$chainId || evm.$chainId}:${
      $signerAddress || evm.$signerAddress
    }`

  const watch = (address) => {
    console.log('watching', address)
    evm.$provider.on({ address }, blockchain.handleRougeEvent(address))
  }

  const addRoadmap = (address) => {
    if (roadmapAddresses.includes(address)) return
    console.log('add roadmap address', address)
    roadmapAddresses = [...roadmapAddresses, address]
    localStorage.setItem(roadmapKey(), JSON.stringify(roadmapAddresses))
    watch(address)
    assign({ roadmapAddresses })
    emit()
  }

  const rmRoadmap = (address) => {
    if (!roadmapAddresses.includes(address)) return
    // console.log('rm roadmap', address)
    roadmapAddresses = [...roadmapAddresses.filter((a) => a !== address)]
    localStorage.setItem(roadmapKey(), JSON.stringify(roadmapAddresses))
    //unwatch(address)
    assign({ roadmapAddresses })
    emit()
  }

  const isBookmarked = (address) => userRoadmapAddresses.includes(address)

  // change to bookmark
  const addUserRoadmap = (address) => {
    if (userRoadmapAddresses.includes(address)) return
    console.log('add bearer address', address)
    userRoadmapAddresses = [...userRoadmapAddresses, address]
    localStorage.setItem(userKey(), JSON.stringify(userRoadmapAddresses))
    watch(address)
    assign({ userRoadmapAddresses })
    emit()
  }

  const rmUserRoadmap = (address) => {
    if (!userRoadmapAddresses.includes(address)) return
    console.log('rm bearer roadmap', address)
    userRoadmapAddresses = [
      ...userRoadmapAddresses.filter((a) => a !== address)
    ]
    localStorage.setItem(userKey(), JSON.stringify(userRoadmapAddresses))
    //unwatch(address)
    assign({ userRoadmapAddresses })
    emit()
  }

  const getOnchainState = async (address) => {
    if (!evm.$provider) return

    const roadfund = blockchain.roadfund(evm.$chainId)

    const {
      creator,
      uri,
      channels,
      penaltiesRecipient,
      open,
      names,
      featureURI,
      challenge,
      claimedAt,
      claimedThreshold
    } = await roadfund.getInfos(address)

    const meta = await ipfs.getJSON(uri)

    console.log('DEBUG meta', meta)

    const features = channels.map(({ amount, totalAcquired }, i) => ({
      nr: i + 1,
      amount,
      pledges: parseInt(totalAcquired),
      open: open[i],
      name: names[i],
      featureURI: featureURI[i],
      challenge: parseInt(challenge[i]),
      contestedPercent:
        parseInt(claimedAt[i]) && parseInt(totalAcquired)
          ? (parseInt(totalAcquired) - parseInt(claimedThreshold[i])) /
            parseInt(totalAcquired)
          : 0,
      claimedAt: parseInt(claimedAt[i]),
      challengeUntil: parseInt(claimedAt[i]) + parseInt(challenge[i]),
      claimedThreshold: parseInt(claimedThreshold[i]),
      challengingPledge: parseInt(claimedAt[i])
        ? parseInt(totalAcquired) - parseInt(claimedThreshold[i])
        : 0
    }))

    console.log(`*** DEBUG *** data for ${address}`, {
      uri,
      creator,
      penaltiesRecipient,
      features
    })

    assign({
      [address]: {
        uri,
        ...meta,
        creator,
        penaltiesRecipient,
        features,
        _chainId: evm.$chainId,
        _address: address,
        _loaded: true
      }
    })
    emit()

    // // auto discovery some logs ?
    // const instance = blockchain.rouge(address)
    // const events = await instance.queryFilter(
    //   instance.filters.UpdateAuthorization(),
    //   0
    // )
    // // for now it's only  "0xea99d7f1"  only
    // for (const { args: { selector account, channelId, grant } } of events) {
    //   if (selector !== '0xea99d7f1') continue
    //   console.log('***** DEBUG *** creator *', e)
    // }
    // assign({
    //   [address]: {
    //     uri,
    //     features,
    //     _chainId: evm.$chainId,
    //     _address: address,
    //     _loaded: true
    //   }
    // })
    // emit()
  }

  const refresh = async (address) => {
    if (!browser || lock[address] || !utils.isAddress(address)) return
    lock[address] = true
    try {
      await getOnchainState(address)
    } catch (e) {
      console.log('[roadmap store]', { address, e })
    }
    lock[address] = false
  }

  const {
    // delete: deleteProperty,
    assign,
    subscribe,
    emit,
    deleteAll
  } = proxied({
    get: function (target, key) {
      // XXX optimise pattern matching for speed ?
      if (key === 'roadmapAddresses') return target[key] || []
      if (key === 'userRoadmapAddresses') return target[key] || []
      if (!target[key]) refresh(key)
      return target[key] || {}
    }
  })

  const clean = async () => {
    localStorage.setItem(roadmapKey(), JSON.stringify([]))
    deleteAll()
    emit()
  }

  const purge = async () => {
    console.log('roadmap store purge')
    deleteAll()
    emit()
  }

  chainId.subscribe(($chainId) => {
    if (!$chainId || !browser) return
    // TODO unwatch ...
    roadmapAddresses = JSON.parse(
      localStorage.getItem(roadmapKey($chainId)) || '[]'
    )
    roadmapAddresses.forEach((address) => watch(address))
    assign({
      roadmapAddresses
    })
    emit()
  })

  signer.subscribe(async ($signer) => {
    if (!$signer || !browser) return
    const account = await $signer.getAddress()
    const { chainId } = await $signer.provider.getNetwork()
    userRoadmapAddresses = JSON.parse(
      localStorage.getItem(userKey(chainId, account)) || '[]'
    )
    userRoadmapAddresses.forEach((address) => watch(address))
    assign({
      userRoadmapAddresses
    })
    emit()
  })

  return {
    refresh,
    purge,
    clean,
    addRoadmap,
    rmRoadmap,
    isBookmarked,
    addUserRoadmap,
    rmUserRoadmap,
    subscribe
  }
}

const store = createStore()

export default store
