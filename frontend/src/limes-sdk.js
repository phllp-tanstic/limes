/**
 * Limes SDK — minimal integration helper for dApps
 * Any spender contract can request a capped permission from a user's wallet.
 *
 * Usage:
 *   import { requestPermission } from './limes-sdk.js'
 *   const permissionId = await requestPermission(signer, { spender, token, cap, expiryDays })
 *   // Store permissionId, then call LimesVault.pull(permissionId, amount) from your spender contract
 */

import { ethers } from 'ethers'

const LIMES_VAULT_ADDRESS = '0xD7E3ac3340528B67C444920488f69627693E76e5'

const LIMES_VAULT_ABI = [
  'function grantPermission(address spender, address token, uint256 cap, uint256 period, uint256 expiry) external returns (bytes32)',
  'function revoke(bytes32 id) external',
  'function remainingAllowance(bytes32 id) view returns (uint256)',
  'function isActive(bytes32 id) view returns (bool)',
  'event PermissionGranted(bytes32 indexed id, address indexed owner, address indexed spender, address token, uint256 cap, uint256 period, uint256 expiry)',
]

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]

/**
 * Request a bounded permission from the user.
 * @param {ethers.Signer} signer - Connected wallet signer
 * @param {object} params
 * @param {string} params.spender - Your contract address that will call pull()
 * @param {string} params.token - ERC-20 token address
 * @param {bigint} params.cap - Maximum amount in token's smallest unit (wei)
 * @param {number} params.expiryDays - Days until the permission expires
 * @param {number} [params.period=0] - Recurring reset period in seconds (0 = one-shot)
 * @returns {Promise<string>} permissionId - Pass this to your spender contract's pull() call
 */
export async function requestPermission(signer, { spender, token, cap, expiryDays, period = 0 }) {
  if (!ethers.isAddress(spender)) throw new Error('Invalid spender address')
  if (!ethers.isAddress(token)) throw new Error('Invalid token address')
  if (!cap || cap <= 0n) throw new Error('Cap must be greater than 0')
  if (!expiryDays || expiryDays <= 0) throw new Error('Expiry must be greater than 0')

  const vault = new ethers.Contract(LIMES_VAULT_ADDRESS, LIMES_VAULT_ABI, signer)
  const erc20 = new ethers.Contract(token, ERC20_ABI, signer)
  const userAddress = await signer.getAddress()

  // Ensure LimesVault is approved to move the token on the user's behalf
  const allowance = await erc20.allowance(userAddress, LIMES_VAULT_ADDRESS)
  if (allowance < cap) {
    const approveTx = await erc20.approve(LIMES_VAULT_ADDRESS, ethers.MaxUint256)
    await approveTx.wait()
  }

  const expiryTimestamp = Math.floor(Date.now() / 1000) + expiryDays * 24 * 60 * 60

  const tx = await vault.grantPermission(spender, token, cap, period, expiryTimestamp)
  const receipt = await tx.wait()

  const event = receipt.logs
    .map((l) => { try { return vault.interface.parseLog(l) } catch { return null } })
    .find((e) => e && e.name === 'PermissionGranted')

  if (!event) throw new Error('PermissionGranted event not found in receipt')

  return event.args.id
}

/**
 * Revoke an existing permission.
 * @param {ethers.Signer} signer
 * @param {string} permissionId
 */
export async function revokePermission(signer, permissionId) {
  const vault = new ethers.Contract(LIMES_VAULT_ADDRESS, LIMES_VAULT_ABI, signer)
  const tx = await vault.revoke(permissionId)
  await tx.wait()
}

/**
 * Check remaining allowance for a permission.
 * @param {ethers.Provider} provider
 * @param {string} permissionId
 * @returns {Promise<bigint>}
 */
export async function remainingAllowance(provider, permissionId) {
  const vault = new ethers.Contract(LIMES_VAULT_ADDRESS, LIMES_VAULT_ABI, provider)
  return vault.remainingAllowance(permissionId)
}