import { createAppKit } from '@reown/appkit'
import { EthersAdapter } from '@reown/appkit-adapter-ethers'
import { BrowserProvider } from 'ethers'
import { ethers } from 'ethers'
import { createIcons, icons } from 'lucide'

// Initialize lucide icons
createIcons({ icons })

// ── Config ────────────────────────────────────────────────────────────────────

const PROJECT_ID = 'c59f6cbcdb8d1a96be7f04912a6ea1fd'

const monadTestnet = {
  id: 10143,
  caipNetworkId: 'eip155:10143',
  chainNamespace: 'eip155',
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.monad.xyz'] },
  },
  blockExplorers: {
    default: { name: 'MonadExplorer', url: 'https://testnet.monadexplorer.com' },
  },
}

const metadata = {
  name: 'Limes',
  description: 'Bounded Token Approvals on Monad',
  url: 'https://limes-monad.vercel.app',
  icons: [],
}

const ethersAdapter = new EthersAdapter()

const modal = createAppKit({
  adapters: [ethersAdapter],
  networks: [monadTestnet],
  metadata,
  projectId: PROJECT_ID,
  features: {
    analytics: false,
    email: false,
    socials: [],
  },
  themeMode: 'light',
})

const CONFIG = {
  addresses: {
    mockUSD: '0xf5cebCa6b269183A3976136E52752E6AC4ee5Fae',
    limesVault: '0xD7E3ac3340528B67C444920488f69627693E76e5',
    limesSubscription: '0x18032362b1b1F30bF39850668915a1f14A2A04D2',
  },
}

const ABIS = {
  mockUSD: [
    'function mint(address to, uint256 amount) external',
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
  ],
  limesVault: [
    'function grantPermission(address spender, address token, uint256 cap, uint256 period, uint256 expiry) external returns (bytes32)',
    'function revoke(bytes32 id) external',
    'function remainingAllowance(bytes32 id) view returns (uint256)',
    'function isActive(bytes32 id) view returns (bool)',
    'function paused() view returns (bool)',
    'function protocolFeeBps() view returns (uint256)',
    'function getOwnerPermissions(address owner) view returns (bytes32[])',
    'function permissions(bytes32 id) view returns (address owner, address spender, address token, uint256 cap, uint256 period, uint256 spent, uint256 periodStart, uint256 expiry, bool revoked)',
    'event PermissionGranted(bytes32 indexed id, address indexed owner, address indexed spender, address token, uint256 cap, uint256 period, uint256 expiry)',
  ],
  limesSubscription: [
    'function subscribe(bytes32 permissionId) external',
    'function hasAccess(address subscriber) view returns (bool)',
    'function withdraw(address token) external',
  ],
}

const KNOWN_TOKENS = [
  { symbol: 'mUSD', address: '0xf5cebCa6b269183A3976136E52752E6AC4ee5Fae', decimals: 18 },
  { symbol: 'WMON', address: '0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541', decimals: 18 },
  { symbol: 'WETH', address: '0xB5a30b0FDc5EA94A52fDc42e3E9760Cb8449Fb37', decimals: 18 },
  { symbol: 'USDC', address: '0xf817257fed379853cDe0fa4F97AB987181B1E5Ea', decimals: 6 },
  { symbol: 'USDT', address: '0x88b8E2161DEDC77EF4ab7585569D2415a1C1055D', decimals: 6 },
]

const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'
const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[] returnData)',
]
const ERC20_SCANNER_ABI = [
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'function allowance(address owner, address spender) view returns (uint256)',
]
const ERC20_APPROVE_ABI = ['function approve(address spender, uint256 amount) external returns (bool)']
const UNLIMITED_THRESHOLD = ethers.MaxUint256 / 2n

// ── State ─────────────────────────────────────────────────────────────────────

let provider, signer, userAddress
let token, vault, sub
let currentPermissionId = null

// ── Helpers ───────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id)

function setStatus(text) { $('demoStatus').textContent = text }

function setButton(label, disabled) {
  $('demoActionLabel').textContent = label
  $('demoActionBtn').disabled = !!disabled
}

function resetPostGrantButtons() {
  const subscribeBtn = $('subscribeBtn')
  subscribeBtn.disabled = false
  subscribeBtn.textContent = 'Subscribe now'
  subscribeBtn.classList.remove('opacity-50', 'cursor-not-allowed')
  $('revokeBtn').disabled = false
}

function updateExposure() {
  const cap = Number($('capInput').value || 0)
  $('exposureDisplay').textContent = '$' + cap.toFixed(2)
}

function scannerShow(id) {
  ['scannerConnect', 'scannerLoading', 'scannerClean', 'scannerResults'].forEach((el) => {
    $(el) && $(el).classList.add('hidden')
  })
  $(id) && $(id).classList.remove('hidden')
}

// ── Wallet connection via AppKit ───────────────────────────────────────────────

async function initFromAppKit() {
  try {
    const walletProvider = modal.getWalletProvider()
    if (!walletProvider) return false

    provider = new BrowserProvider(walletProvider)
    signer = await provider.getSigner()
    userAddress = await signer.getAddress()

    token = new ethers.Contract(CONFIG.addresses.mockUSD, ABIS.mockUSD, signer)
    vault = new ethers.Contract(CONFIG.addresses.limesVault, ABIS.limesVault, signer)
    sub = new ethers.Contract(CONFIG.addresses.limesSubscription, ABIS.limesSubscription, signer)

    const short = userAddress.slice(0, 6) + '\u2026' + userAddress.slice(-4)
    $('connectWalletLabel').textContent = short
    $('subAddressDisplay').textContent =
      CONFIG.addresses.limesSubscription.slice(0, 6) + '\u2026' + CONFIG.addresses.limesSubscription.slice(-4)

    setStatus('Wallet connected. Ready to create a bounded approval.')
    await loadPermissions()
    await runScanner()
    return true
  } catch (err) {
    console.error('initFromAppKit error:', err)
    return false
  }
}

// Subscribe to AppKit connection state changes
modal.subscribeEvents(async (event) => {
  if (event.data.event === 'MODAL_CLOSE' || event.data.event === 'CONNECT_SUCCESS') {
    await initFromAppKit()
  }
})

async function connectWallet() {
  await modal.open()
}

// ── Core demo flow ─────────────────────────────────────────────────────────────

async function loadPermissions() {
  if (!signer || !vault) return

  const ids = await vault.getOwnerPermissions(userAddress)
  const panel = $('permissionsPanel')
  const list = $('permissionsList')
  const summary = $('permissionsSummary')

  panel.classList.remove('hidden')
  list.innerHTML = ''
  $('refreshPermissionsBtn').classList.remove('hidden')

  if (ids.length === 0) {
    summary.textContent = 'No permissions granted yet'
    return
  }

  let activeCount = 0
  let revokedCount = 0

  for (const id of ids) {
    const p = await vault.permissions(id)
    const active = await vault.isActive(id)
    const remaining = await vault.remainingAllowance(id)

    if (p.revoked) revokedCount++
    else if (active) activeCount++

    const expiry = new Date(Number(p.expiry) * 1000)
    const expiryStr = expiry.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    const capFormatted = Number(ethers.formatEther(p.cap)).toFixed(2)
    const remainingFormatted = Number(ethers.formatEther(remaining)).toFixed(2)
    const spenderShort = p.spender.slice(0, 6) + '\u2026' + p.spender.slice(-4)

    const statusBg = p.revoked
      ? 'bg-[#FAECE7] text-[#993C1D]'
      : active
        ? 'bg-[#E4EEDB] text-[#3D592B]'
        : 'bg-[#F0EBE1] text-[#687464]'

    const statusLabel = p.revoked ? 'Revoked' : active ? 'Active' : 'Expired'

    const row = document.createElement('div')
    row.className = 'grid gap-4 px-6 py-5 md:grid-cols-[auto_1fr_auto] md:items-center'
    row.innerHTML = `
      <span class="rounded-full px-3 py-1.5 text-xs ${statusBg} w-fit">${statusLabel}</span>
      <div class="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4 text-xs">
        <div><p class="uppercase tracking-wider text-[#687464] mb-1">Spender</p><p class="text-[#162512]">${spenderShort}</p></div>
        <div><p class="uppercase tracking-wider text-[#687464] mb-1">Cap</p><p class="text-[#162512]">${capFormatted} mUSD</p></div>
        <div><p class="uppercase tracking-wider text-[#687464] mb-1">Remaining</p><p class="text-[#162512]">${remainingFormatted} mUSD</p></div>
        <div><p class="uppercase tracking-wider text-[#687464] mb-1">Expires</p><p class="text-[#162512]">${expiryStr}</p></div>
      </div>
      ${active ? `<button type="button" data-id="${id}" class="revoke-history-btn rounded-lg border border-[#162512]/20 px-4 py-2 text-xs text-[#162512] transition-colors hover:bg-[#162512] hover:text-[#CFE8AE] w-fit">Revoke</button>` : '<div></div>'}
    `
    list.appendChild(row)
  }

  summary.textContent = `${activeCount} active \u00b7 ${revokedCount} revoked \u00b7 ${ids.length} total`

  list.querySelectorAll('.revoke-history-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id')
      try {
        btn.disabled = true
        btn.textContent = 'Revoking\u2026'
        const tx = await vault.revoke(id)
        await tx.wait()
        if (currentPermissionId === id) {
          currentPermissionId = null
          $('postGrantActions').classList.add('hidden')
          $('postGrantActions').classList.remove('flex')
          setButton('Create bounded approval', false)
          $('demoActionBtn').disabled = false
          $('demoActionBtn').classList.remove('opacity-40', 'cursor-not-allowed')
        }
        await loadPermissions()
      } catch (err) {
        btn.disabled = false
        btn.textContent = 'Revoke'
        setStatus('Revoke failed: ' + (err.shortMessage || err.message))
      }
    })
  })
}

async function runDemoFlow() {
  try {
    setButton('Working\u2026', true)

    if (!signer) {
      setStatus('Opening wallet connection\u2026')
      await modal.open()
      setButton('Create bounded approval', false)
      return
    }

    const existingIds = await vault.getOwnerPermissions(userAddress)
    for (const existingId of existingIds) {
      const active = await vault.isActive(existingId)
      const p = await vault.permissions(existingId)
      if (active && p.spender.toLowerCase() === CONFIG.addresses.limesSubscription.toLowerCase()) {
        currentPermissionId = existingId
        setStatus('You already have an active permission. Subscribe or revoke it first.')
        setButton('Approval created \u2713', true)
        $('demoActionBtn').classList.add('opacity-40', 'cursor-not-allowed')
        resetPostGrantButtons()
        $('postGrantActions').classList.remove('hidden')
        $('postGrantActions').classList.add('flex')
        return
      }
    }

    const capValue = $('capInput').value || '250'
    const expiryDays = Number($('expiryInput').value || '30')
    const capWei = ethers.parseEther(capValue)
    const expiryTimestamp = Math.floor(Date.now() / 1000) + expiryDays * 24 * 60 * 60

    const balance = await token.balanceOf(userAddress)
    if (balance < capWei) {
      setStatus('Minting test mUSD\u2026')
      const mintTx = await token.mint(userAddress, capWei * 2n)
      await mintTx.wait()
    }

    const allowance = await token.allowance(userAddress, CONFIG.addresses.limesVault)
    if (allowance < capWei) {
      setStatus('Approving Limes (one-time)\u2026')
      const approveTx = await token.approve(CONFIG.addresses.limesVault, ethers.MaxUint256)
      await approveTx.wait()
    }

    setStatus('Granting capped permission\u2026')
    const grantTx = await vault.grantPermission(
      CONFIG.addresses.limesSubscription,
      CONFIG.addresses.mockUSD,
      capWei,
      0,
      expiryTimestamp
    )
    const receipt = await grantTx.wait()
    const event = receipt.logs
      .map((l) => { try { return vault.interface.parseLog(l) } catch { return null } })
      .find((e) => e && e.name === 'PermissionGranted')
    currentPermissionId = event.args.id

    setStatus('Permission granted \u2014 capped at ' + capValue + ' mUSD, expires in ' + expiryDays + ' days.')
    setButton('Approval created \u2713', true)
    $('demoActionBtn').classList.add('opacity-40', 'cursor-not-allowed')
    resetPostGrantButtons()
    $('postGrantActions').classList.remove('hidden')
    $('postGrantActions').classList.add('flex')
    await loadPermissions()

  } catch (err) {
    console.error(err)
    setStatus('Something went wrong: ' + (err.shortMessage || err.message || 'see console'))
    setButton('Create bounded approval', false)
  }
}

async function handleSubscribe() {
  if (!currentPermissionId) return
  try {
    $('subscribeBtn').disabled = true
    setStatus('Confirm the transaction in your wallet\u2026')
    const tx = await sub.subscribe(currentPermissionId)
    setStatus('Submitted \u2014 waiting for confirmation on Monad\u2026')
    const receipt = await tx.wait()
    if (receipt.status !== 1) throw new Error('Transaction reverted.')
    const remaining = await vault.remainingAllowance(currentPermissionId)
    setStatus('Subscribed \u2713 Remaining allowance: ' + ethers.formatEther(remaining) + ' mUSD.')
    $('subscribeBtn').textContent = 'Subscribed \u2713'
    $('subscribeBtn').classList.add('opacity-50', 'cursor-not-allowed')
    await loadPermissions()
  } catch (err) {
    console.error(err)
    setStatus('Subscribe failed: ' + (err.shortMessage || err.reason || err.message))
    $('subscribeBtn').disabled = false
  }
}

async function handleRevoke() {
  if (!currentPermissionId) return
  try {
    $('revokeBtn').disabled = true
    setStatus('Revoking permission\u2026')
    const tx = await vault.revoke(currentPermissionId)
    await tx.wait()
    currentPermissionId = null
    $('postGrantActions').classList.add('hidden')
    $('postGrantActions').classList.remove('flex')
    $('demoActionBtn').disabled = false
    $('demoActionBtn').classList.remove('opacity-40', 'cursor-not-allowed')
    setButton('Create bounded approval', false)
    setStatus('Revoked. Create a new bounded approval to resubscribe.')
    await loadPermissions()
  } catch (err) {
    setStatus('Revoke failed: ' + (err.shortMessage || err.message))
    $('revokeBtn').disabled = false
  }
}

// ── Scanner ────────────────────────────────────────────────────────────────────

async function runScanner() {
  if (!signer) {
    await modal.open()
    return
  }

  scannerShow('scannerLoading')

  try {
    const multicall = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider)
    const allowanceIface = new ethers.Interface([
      'function allowance(address owner, address spender) view returns (uint256)',
    ])

    const tokenSpenders = []

    for (const t of KNOWN_TOKENS) {
      try {
        const tokenContract = new ethers.Contract(t.address, ERC20_SCANNER_ABI, provider)
        const filter = tokenContract.filters.Approval(userAddress)
        const logs = await tokenContract.queryFilter(filter, 0, 'latest')
        const seen = new Set()
        for (const log of logs) {
          const spender = log.args.spender.toLowerCase()
          if (!seen.has(spender)) {
            seen.add(spender)
            if (spender !== CONFIG.addresses.limesVault.toLowerCase()) {
              tokenSpenders.push({ token: t, spender: log.args.spender })
            }
          }
        }
      } catch (err) {
        console.warn('Scanner: skipped', t.symbol, err.message)
      }
    }

    if (tokenSpenders.length === 0) { scannerShow('scannerClean'); return }

    const calls = tokenSpenders.map(({ token, spender }) => ({
      target: token.address,
      allowFailure: true,
      callData: allowanceIface.encodeFunctionData('allowance', [userAddress, spender]),
    }))

    const results = await multicall.aggregate3(calls)
    const dangerous = []

    for (let i = 0; i < results.length; i++) {
      const { success, returnData } = results[i]
      if (!success || returnData === '0x') continue
      const [allowance] = allowanceIface.decodeFunctionResult('allowance', returnData)
      if (allowance === 0n) continue
      const { token, spender } = tokenSpenders[i]
      dangerous.push({ token, spender, allowance, isUnlimited: allowance >= UNLIMITED_THRESHOLD })
    }

    if (dangerous.length === 0) { scannerShow('scannerClean'); return }

    const list = $('scannerList')
    list.innerHTML = ''

    for (const item of dangerous) {
      const allowanceDisplay = item.isUnlimited
        ? 'Unlimited'
        : Number(ethers.formatUnits(item.allowance, item.token.decimals)).toFixed(2)
      const riskBadge = item.isUnlimited ? 'bg-[#FAECE7] text-[#993C1D]' : 'bg-[#FEF9EC] text-[#92400E]'
      const riskLabel = item.isUnlimited ? 'Unlimited' : 'Active'
      const spenderShort = item.spender.slice(0, 6) + '\u2026' + item.spender.slice(-4)

      const row = document.createElement('div')
      row.className = 'grid gap-4 px-6 py-5 md:grid-cols-[auto_1fr_auto] md:items-center'
      row.innerHTML = `
        <span class="rounded-full px-3 py-1.5 text-xs ${riskBadge} w-fit">${riskLabel}</span>
        <div class="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3 text-xs">
          <div><p class="uppercase tracking-wider text-[#687464] mb-1">Token</p><p class="font-medium text-[#162512]">${item.token.symbol}</p></div>
          <div><p class="uppercase tracking-wider text-[#687464] mb-1">Approved to</p><p class="text-[#162512]">${spenderShort}</p></div>
          <div><p class="uppercase tracking-wider text-[#687464] mb-1">Allowance</p><p class="font-medium text-[#162512]">${allowanceDisplay} ${item.token.symbol}</p></div>
        </div>
        <button type="button" data-token="${item.token.address}" data-spender="${item.spender}"
          class="revoke-scan-btn rounded-lg border border-[#162512]/20 px-4 py-2 text-xs text-[#162512] transition-colors hover:bg-[#162512] hover:text-[#CFE8AE] w-fit whitespace-nowrap">
          Revoke
        </button>
      `
      list.appendChild(row)
    }

    const unlimitedCount = dangerous.filter((d) => d.isUnlimited).length
    $('scannerSummary').textContent = `${dangerous.length} active approval${dangerous.length !== 1 ? 's' : ''} found \u2014 ${unlimitedCount} unlimited`
    scannerShow('scannerResults')

    list.querySelectorAll('.revoke-scan-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tokenAddress = btn.getAttribute('data-token')
        const spender = btn.getAttribute('data-spender')
        const row = btn.closest('div.grid')
        try {
          btn.disabled = true
          btn.textContent = 'Revoking\u2026'
          const tokenContract = new ethers.Contract(tokenAddress, ERC20_APPROVE_ABI, signer)
          const tx = await tokenContract.approve(spender, 0)
          await tx.wait()
          row.remove()
          const remaining = list.querySelectorAll('.revoke-scan-btn').length
          if (remaining === 0) scannerShow('scannerClean')
          else $('scannerSummary').textContent = `${remaining} active approval${remaining !== 1 ? 's' : ''} remaining`
        } catch (err) {
          btn.disabled = false
          btn.textContent = 'Revoke'
          console.error('Revoke failed:', err)
        }
      })
    })

  } catch (err) {
    console.error('Scanner error:', err)
    scannerShow('scannerConnect')
  }
}

// ── Event listeners ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  $('capInput').addEventListener('input', updateExposure)
  $('connectWalletBtn').addEventListener('click', connectWallet)
  $('demoActionBtn').addEventListener('click', runDemoFlow)
  $('subscribeBtn').addEventListener('click', handleSubscribe)
  $('revokeBtn').addEventListener('click', handleRevoke)
  $('scanBtn').addEventListener('click', runScanner)
  $('rescanBtn').addEventListener('click', runScanner)
  $('rescanCleanBtn').addEventListener('click', runScanner)

  $('permissionsToggleBtn').addEventListener('click', (e) => {
    if (e.target.id === 'refreshPermissionsBtn' || e.target.closest('#refreshPermissionsBtn')) return
    const dropdown = $('permissionsDropdown')
    const chevron = $('permissionsChevron')
    const isOpen = !dropdown.classList.contains('hidden')
    dropdown.classList.toggle('hidden', isOpen)
    chevron.style.transform = isOpen ? '' : 'rotate(180deg)'
  })

  $('refreshPermissionsBtn').addEventListener('click', (e) => {
    e.stopPropagation()
    loadPermissions()
  })
})