# **Limes - Bounded Token Approvals**

Every approval you sign is a blank check right now. Limes turns it into a boundary you actually control.

*Built on Monad · BuildAnything Spark Hackathon*


## Executive Summary
**Limes** (pronounced **LEE-mess**) is a non-custodial permission gateway for ERC-20 token approvals, built on Monad. It replaces the default model of unlimited, indefinite token approvals with permissions that are capped, time-bound, and instantly revocable. Limes also identifies existing high-risk approvals, allowing users to remove unnecessary permissions before they become an attack vector.

The name is derived from the *limes*, the fortified frontier system of the Roman Empire. Rather than serving as a wall, the *limes* was a network of monitored checkpoints that controlled movement across a defined boundary. Limes applies the same principle to token approvals by placing an enforceable permission boundary between users and the applications they authorize.

The problem it addresses is widespread and costly. Forgotten or over-permissioned ERC-20 approvals remain one of the leading causes of wallet drains across the EVM ecosystem. In many cases, users are not compromised through failures of the blockchain itself, but through permissions granted months earlier to applications that are later exploited or become malicious.

Existing tools such as Revoke.cash help users revoke approvals after they already exist. Limes introduces a preventive approach. It is an EVM-native permission layer that enforces approval boundaries entirely on-chain, works with any standard wallet, and prevents excessive permissions from being granted in the first place.


## Problem Statement

### The ERC-20 Approval Trap

Every interaction with a DeFi application begins with an `approve()` transaction. Before a DEX, lending protocol, or yield aggregator can spend a user's tokens, the user must authorize the contract through the ERC-20 approval mechanism.

In practice, almost every application requests `type(uint256).max`, granting unlimited spending authority with no expiration.

This behavior exists because:

- Requiring users to approve every transaction creates significant UX friction.
- The ERC-20 `approve()` standard has no native support for spending limits or expiration.
- Applications have little incentive to request narrower permissions than they need.

As a result, active wallets accumulate dozens of unlimited, long-lived approvals across the ecosystem. Most users have little visibility into which contracts retain spending authority, when those permissions were granted, or how much risk they represent. Every additional approval expands the wallet's attack surface.

### Why Existing Solutions Fall Short

| Solution | What it does | Limitation |
|----------|--------------|------------|
| Revoke.cash | Audits and revokes existing approvals | Reactive. Users must discover and remove risky approvals after they already exist. |
| Etherscan Approval Checker | Displays current token approvals | Read-only. It provides visibility but does not prevent excessive approvals or help users understand their risk. |
| Safe Allowance Module | Supports capped approvals for Safe multisig wallets | Requires a Safe Smart Account and is not applicable to the vast majority of users with standard EOA wallets. |
| ERC-7710 / ERC-7715 | Introduces wallet-level permission standards | Requires ERC-4337 Smart Accounts and wallet support, making it unavailable to most wallet users today. |

### The Gap Limes Fills

Limes addresses the approval problem at both the prevention and remediation layers.

**Prevention**

Every approval created through Limes includes an enforced spending cap, a mandatory expiration, and contextual guidance informed by the user's own spending history. Users grant only the permissions they intend, rather than unlimited access by default.

**Remediation**

Limes continuously helps users reduce existing exposure by scanning for dangerous unlimited approvals across commonly used ERC-20 tokens. Risky permissions can be revoked with a single action, with revocations batched through Multicall3 for efficient execution.


## Solution Overview

### Architecture

Limes is deployed on the Monad Testnet as a two-contract system with a frontend approval dashboard. Together, these components introduce an enforceable permission layer for ERC-20 approvals without requiring wallet modifications, smart accounts, or changes to existing token contracts.

```mermaid
flowchart LR
    U[User Wallet (EOA)]

    subgraph Limes
        V[LimesVault.sol]
        R[PermissionRegistry]
    end

    T[ERC-20 Token]
    D[dApp]
    S[Frontend Scanner]
    M[Multicall3]
    P[Protocol Treasury]

    U -->|One-time approve(type(uint256).max)| V
    D -->|Create permission<br/>cap + expiry| R
    R -->|Store permission| V

    V -->|Validate cap, expiry and revocation| T
    T -->|transferFrom| D
    T -->|Protocol fee| P

    S -->|eth_getLogs Approval events| U
    S -->|Batch allowance reads| M
    M -->|Single RPC response| S

    U -->|Revoke permission| R
```

### Components

#### LimesVault.sol

The vault is the execution layer for token transfers. Users grant a single ERC-20 approval to the vault, after which every spend is validated against the permission rules recorded in the registry. 

`LimesVault` is the core permission gateway. It is entirely non-custodial and never holds user funds. Its sole responsibility is to enforce permission rules before executing `transferFrom()` calls.

Key properties include:

- Every permission requires a spending cap and expiration, with optional recurring periods for budget-based permissions.
- `revoke()` remains callable even when the contract is paused, ensuring users always retain an immediate kill switch.
- For Demo: A hardcoded `MAX_FEE_BPS = 500` caps protocol fees at **5%**, regardless of owner privileges or future configuration changes.
- Built on OpenZeppelin's `Ownable` and `Pausable` contracts for operational safety. During an incident, new permissions and token pulls can be paused while revocations remain fully functional.
- Uses `ReentrancyGuard` to protect all external state-changing functions.

#### LimesSubscription.sol

`LimesSubscription` is a reference integration that demonstrates how applications can integrate with Limes for recurring payments.

It provides a complete end-to-end subscription flow while guaranteeing that an application can never spend more than the user explicitly authorized or continue charging after the permission expires.

The reference implementation includes:

- Protection against duplicate charges from repeated `subscribe()` calls.
- Support for resubscription once a previous permission has expired or been revoked.
- Treasury settlement through `withdraw()`, where collected fees can only be transferred to the immutable treasury address defined at deployment.

#### MockUSD.sol

`MockUSD` is a freely mintable ERC-20 token used exclusively for demonstrations on Monad Testnet.

It allows judges, developers, and beta users to exercise the complete permission flow without relying on external faucets or third-party test tokens.

#### Frontend

The frontend is implemented as a single HTML and JavaScript application using **ethers.js v6**.

It requires no build system or framework, making the entire interface easy to inspect, audit, and run locally.

Features include:

- Wallet connection with automatic switching to Monad Testnet.
- A contextual approval interface with configurable spending caps, expiration periods, and live dollar exposure estimates.
- A complete permission lifecycle covering **Grant → Subscribe → Revoke → Resubscribe**.
- A permission history view powered by `getOwnerPermissions()`, displaying every permission together with its current status.
- An approval scanner that:
  - indexes `Approval` event logs for supported tokens,
  - batches all `allowance()` queries through `Multicall3` in a single RPC request, and
  - identifies active and unlimited approvals with one-click revocation.


### End-to-End User Journey

hdhjkvcjedfnljkkdfnknfgknedsfgkniowqwfknkewfk

### What Makes Limes Different

Limes introduces several architectural decisions that distinguish it from existing approval management tools and wallet permission systems.

#### 1. Prevention Instead of Cleanup

Most approval management tools are reactive. They help users discover and revoke permissions only after those approvals have already been granted.

Limes moves protection to the point where the permission is created. Every approval is defined with an explicit spending cap and expiration before it becomes valid, preventing unlimited permissions from existing in the first place.

#### 2. Non-Custodial by Design

Limes never takes custody of user assets.

`LimesVault` does not hold balances or act as an intermediary wallet. Tokens remain in the user's own address at all times. The vault's only responsibility is to enforce permission rules before executing `transferFrom()` calls authorized through a standard ERC-20 approval.

Because the approval itself remains under the user's control, it can be revoked at any time.

#### 3. Efficient Approval Scanning with Multicall3

The approval scanner is built for efficiency.

Instead of issuing separate `allowance()` RPC requests for every token and spender combination, Limes batches all reads into a single `aggregate3` call through the canonical `Multicall3` contract on Monad.

This significantly reduces network overhead while demonstrating a practical integration with Monad infrastructure.

#### 4. User Protection Remains Available During Emergencies

Operational safety and user safety are treated independently.

If a critical vulnerability is discovered, protocol administrators can pause new permissions and token pulls to prevent further impact. However, `revoke()` intentionally bypasses the pause mechanism, ensuring users always retain the ability to invalidate their own permissions.

The protocol pause protects the system. The revoke function protects the user.


## Technology Stack

| Technology | Role | Why It Was Chosen |
|------------|------|-------------------|
| **Solidity 0.8.24** | Smart contract development | Latest stable compiler with built-in overflow protection, custom errors, and a mature tooling ecosystem. |
| **Monad Testnet** (Chain ID **10143**) | Deployment target | Monad's sub-second finality and low transaction costs make per-permission enforcement economically practical. Validating spending limits on every token pull would be prohibitively expensive on Ethereum mainnet. |
| **OpenZeppelin Contracts v5** | Security primitives (`ReentrancyGuard`, `Ownable`, `Pausable`, `IERC20`) | Industry-standard, extensively audited implementations that eliminate the need to reimplement fundamental security components. |
| **Hardhat 2.22** | Development, testing, deployment, and verification | Mature Ethereum development framework with reliable debugging, deployment workflows, and native Sourcify support. |
| **Sourcify** | Contract verification | Official verification path for Monad through `sourcify-api-monad.blockvision.org`, providing full source verification and transparent on-chain inspection. |
| **Multicall3** (`0xcA11...CA11`) | Batched `allowance()` reads | Canonical Monad deployment used to aggregate multiple allowance queries into a single `aggregate3` call, reducing RPC overhead while demonstrating a practical integration with Monad infrastructure. |
| **ethers.js v6** | Frontend blockchain interaction | Widely adopted Ethereum library with native support for Monad's EVM-compatible RPC interface. |
| **Tailwind CSS (CDN)** | Frontend styling | Enables a lightweight, build-free frontend distributed as a single static HTML file. |
| **Chai + Hardhat Network Helpers** | Testing framework | Powers a comprehensive suite of **21 passing tests** covering the security guarantees, permission lifecycle, and expected contract behavior. |


## Architecture

### System Architecture Overview

┌─────────────────────────────────────────────────────────────┐
│                        USER WALLET (EOA)                     │
└────────────────────────────┬────────────────────────────────┘
                             │ one-time ERC-20 approve()
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                       LimesVault.sol                         │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Permission {                                         │    │
│  │   owner, spender, token                             │    │
│  │   cap, period, spent, periodStart                   │    │
│  │   expiry, revoked                                   │    │
│  │ }                                                   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  grantPermission() · revoke() · pull() · remainingAllowance()│
│  pause() [owner] · setProtocolFeeBps() [owner, max 5%]      │
└──────────────┬──────────────────────────────────────────────┘
               │ pull(id, amount) — after cap/expiry/revoke check
               ▼
┌──────────────────────────┐     ┌──────────────────────────┐
│   LimesSubscription.sol  │     │     Any dApp Spender      │
│   (reference integration)│     │   (integrates same API)   │
└──────────────────────────┘     └──────────────────────────┘
               │ PRICE=5 mUSD, CYCLE=30 days
               ▼
┌─────────────────────────────────────────────────────────────┐
│                       ERC-20 Token                           │
│              transferFrom(owner → spender, netAmount)        │
│              transferFrom(owner → treasury, fee)             │
└─────────────────────────────────────────────────────────────┘

### Approval Scanner Flow

Frontend
  │
  ├── For each of 5 known tokens:
  │     eth_getLogs(Approval, owner=userAddress)   [5 RPC calls]
  │     → collect unique spenders
  │
  └── Multicall3.aggregate3([
        allowance(owner, spender) × N pairs        [1 RPC call]
      ])
        → filter non-zero
        → render with Unlimited / Active badge
        → wire Revoke button → approve(spender, 0)


## How It Works

### Step 1 - Connect Your Wallet

Connect your wallet to Limes. If you are not already on Monad Testnet, the application automatically prompts you to switch networks.

Once connected, the frontend immediately:

- retrieves your permission history from `LimesVault`,
- scans your wallet for existing ERC-20 approvals across supported tokens, and
- batches all `allowance()` queries into a single `Multicall3` request for efficient retrieval.

### Step 2 - Create a Bounded Approval

Specify a spending cap and an expiration period. For example, you might authorize **250 mUSD** for **30 days**.

As you adjust these values, the interface updates the **Maximum Dollar Exposure** estimate in real time. When ready, click **Create Bounded Approval**.

Behind the scenes, three transactions execute sequentially:

1. `MockUSD.mint()` mints test tokens if your balance is below the requested spending cap.
2. `MockUSD.approve(LimesVault, MaxUint256)` grants the vault its one-time ERC-20 approval. This approval is not repeated for future permissions.
3. `LimesVault.grantPermission(LimesSubscription, mUSD, cap, 0, expiry)` creates the bounded permission by recording its spending cap and expiration on-chain.

### Step 3 - Execute a Permissioned Payment

Click **Subscribe Now** to demonstrate permission enforcement.

This invokes `LimesSubscription.subscribe(permissionId)`, which internally calls:

```solidity
LimesVault.pull(id, 5e18)
```

Before transferring any tokens, the vault verifies that:

- the permission is still active,
- the spending cap has not been exceeded, and
- the permission has not expired.

Only after all checks succeed does the vault execute the underlying `transferFrom()` call. The subscription contract cannot spend more than the user explicitly authorized.

### Step 4 - Revoke the Permission

Click **Revoke Permission** to immediately invalidate the approval.

This submits a single transaction:

```solidity
LimesVault.revoke(id)
```

After the transaction is confirmed, any subsequent attempt to subscribe fails on-chain because the permission has been revoked.

The spending limit is enforced by the protocol itself rather than by frontend logic or application behavior.

### Step 5 - Scan Existing Approvals

The **Approval Scanner** analyzes ERC-20 approvals that were granted outside of Limes.

For every approval it discovers, the scanner displays:

- the token,
- the spender address, and
- whether the allowance is unlimited.

Selecting **Revoke** submits an `approve(spender, 0)` transaction directly to the underlying ERC-20 token contract, permanently resetting that allowance on-chain.

### Contract Addresses

The following contracts are deployed on **Monad Testnet** and verified through **Sourcify**.

| Contract | Address | Verification |
|----------|---------|--------------|
| **MockUSD** | `0xf5cebCa6b269183A3976136E52752E6AC4ee5Fae` | View on Sourcify |
| **LimesVault** | `0xD7E3ac3340528B67C444920488f69627693E76e5` | View on Sourcify |
| **LimesSubscription** | `0x18032362b1b1F30bF39850668915a1f14A2A04D2` | View on Sourcify |

All contracts are fully verified on Sourcify with source-bytecode full match.


## Test Suite

Limes includes a comprehensive test suite with **21 passing tests** across two test files. Every security guarantee and permission rule enforced by the contracts is verified through automated tests.

```bash
npx hardhat test
```

### LimesVault (12 Tests)

The `LimesVault` test suite verifies the protocol's core security model and permission enforcement.

- Deploys with the configured treasury and initial protocol fee while enforcing the maximum fee ceiling.
- Deducts the protocol fee during `pull()`, with the fee counted against the user's total spending cap.
- Rejects `grantPermission()` and `pull()` while the contract is paused, while ensuring `revoke()` remains available.
- Restricts administrative operations such as pausing, fee updates, and treasury changes to the contract owner.
- Creates permissions with the expected on-chain fields.
- Allows the authorized spender to transfer tokens within the approved spending cap.
- Rejects transfers that exceed the remaining spending limit.
- Rejects transfers initiated by unauthorized spenders.
- Rejects transfers after a permission has expired.
- Allows the permission owner to revoke access immediately, preventing all future transfers.
- Rejects revocation attempts from accounts other than the permission owner.
- Resets the available spending budget when a recurring permission enters a new billing period.

### LimesSubscription (9 Tests)

The `LimesSubscription` test suite validates the reference recurring payment integration built on top of Limes.

- Successfully creates a subscription and charges the first billing cycle for exactly `PRICE`.
- Rejects attempts to charge the next billing cycle before it becomes due.
- Processes subsequent billing cycles when eligible while continuing to enforce the original spending cap.
- Rejects charges after the user's approved budget has been exhausted.
- Rejects charges after the user revokes the underlying permission during an active subscription.
- Rejects duplicate `subscribe()` calls while an active permission already exists.
- Allows users to create a new subscription immediately after revoking the previous permission.
- Allows any caller to execute `withdraw()`, transferring the full contract balance to the immutable treasury address.
- Rejects `withdraw()` when no funds are available for withdrawal.


## Setup & Local Development

### Prerequisites

Before getting started, ensure you have:

- Node.js **18** or later
- MetaMask or another EVM-compatible wallet
- A Monad Testnet wallet funded with testnet MON (available from the official Monad faucet)

### Clone the Repository

```bash
git clone https://github.com/phllp-tanstic/limes-protocol
cd limes-protocol
npm install
```

### Configure the Environment

Copy the example environment file and provide your credentials.

```bash
cp .env.example .env
```

Update `.env` with:

```text
PRIVATE_KEY=<your_private_key>
MONAD_TESTNET_RPC=<your_rpc_endpoint>
```

### Compile and Run the Test Suite

Compile the contracts:

```bash
npx hardhat compile
```

Run the full test suite:

```bash
npx hardhat test
```

### Deploy to Monad Testnet

Deploy all contracts:

```bash
npx hardhat run scripts/deploy.js --network monadTestnet
```

### Verify Contracts

Verify each deployed contract through Sourcify:

```bash
npx hardhat verify --network monadTestnet <MOCK_USD_ADDRESS>

npx hardhat verify --network monadTestnet \
  <VAULT_ADDRESS> \
  <OWNER> \
  <TREASURY> \
  0

npx hardhat verify --network monadTestnet \
  <SUBSCRIPTION_ADDRESS> \
  <VAULT_ADDRESS> \
  <TREASURY>
```

### Run the Frontend

Navigate to the frontend directory and serve the application locally.

```bash
cd ../limes-frontend
npx serve .
```
The application will be available at:

```text
http://localhost:3000
```


## Roadmap

### Near Term

#### Dynamic Risk Engine

Integrate on-chain security intelligence from providers such as Blockaid, GoPlus, or Forta to continuously evaluate approved spenders.

Beyond displaying existing approvals, Limes will identify approvals that become risky over time by monitoring signals including:

- contract upgrades,
- ownership transfers,
- significant TVL declines, and
- confirmed security incidents.

This allows users to react to changing protocol risk, even when the original approval was granted safely.

#### Automatic Quarantine

Introduce an oracle-driven emergency response system for compromised protocols.

When a trusted security oracle confirms that a protocol has been exploited, every `LimesVault` permission associated with that spender can be automatically quarantined. Quarantined permissions cannot execute transfers until the user explicitly reviews or permanently revokes them.

The underlying architecture already supports this model through the existing pause mechanism and permission controls. The remaining component is a trusted external security feed.

#### Smart Approval Recommendations

Recommend spending limits based on each user's historical on-chain activity.

Instead of requesting unlimited approvals, Limes will analyze previous interactions with a protocol and suggest an appropriate cap.

For example:

> You've spent approximately **$180** with this protocol over the last **30 days**. Consider approving **$250** instead of an unlimited allowance.

These recommendations can be generated entirely from on-chain transaction history without relying on third-party user data.

#### Persistent Wallet Dashboard

Expand the current demonstration interface into a comprehensive permission management platform.

Planned capabilities include:

- multi-wallet support,
- complete permission history,
- spending analytics,
- expiration countdowns,
- dormant permission detection, and
- batch approval management.

---

### Medium Term

#### Team and DAO Policies

Introduce **PolicyGuard**, an organizational policy layer built on top of Limes.

Organizations will be able to define approval policies across treasury wallets, including:

- prohibiting unlimited approvals,
- enforcing maximum spending caps,
- requiring expiration periods, and
- standardizing approval policies across teams.

This targets DAOs, crypto funds, and companies managing on-chain treasury operations while establishing Limes' enterprise offering.

#### Mainnet Deployment

Deploy Limes to production following a professional security audit.

The protocol architecture has been intentionally designed with a small attack surface and minimal contract complexity to simplify auditing and strengthen security before mainnet release.

### Full Token Coverage

The current approval scanner indexes a limited set of ERC-20 tokens on Monad Testnet.

Production deployments will replace this with a dedicated indexing service that continuously tracks `Approval` events across the entire network, enabling discovery and monitoring of approvals for any supported ERC-20 contract.



## Commercialization

Limes is designed around a tiered product model that serves both individual users and organizations.

| Tier | Features |
|------|----------|
| **Free** | Permission management, approval scanner, and on-chain revocation tools. |
| **Pro** | Real-time notifications when new unlimited approvals are detected, plus periodic reports highlighting dormant or high-risk permissions. |
| **Business** | Organization-wide approval policies, team dashboards, administrative controls, and a **Limes Verified** integration program for applications that commit to requesting bounded permissions instead of unlimited approvals. |

The **Limes Verified** designation creates a trust signal for users while encouraging applications to adopt safer approval practices, reinforcing a network effect between users and protocol integrations.


## Built With

| Technology | Version | Purpose |
|------------|---------|---------|
| ⛓️ **Monad** | Testnet (Chain ID **10143**) | Layer 1 deployment target. Monad's sub-second finality and low transaction costs make per-permission enforcement economically practical. |
| 📜 **Solidity** | 0.8.24 | Smart contract development. |
| 🔨 **Hardhat** | 2.22 | Contract compilation, testing, deployment, and verification. |
| 🛡️ **OpenZeppelin Contracts** | 5.x | Security primitives including `ReentrancyGuard`, `Ownable`, and `Pausable`. |
| 📦 **Multicall3** | Canonical deployment | Batched `allowance()` queries used by the approval scanner. |
| ✅ **Sourcify** | Monad integration | Full source contract verification. |
| 🌐 **ethers.js** | 6.x | Frontend interaction with deployed contracts. |
| 🎨 **Tailwind CSS** | CDN | Frontend styling without a build step. |
| 🧪 **Chai** | Latest | Smart contract test assertions. |



## Conclusion

Most wallet drains do not begin with a compromised blockchain. They begin with a permission that was granted months earlier, forgotten over time, and left with unlimited spending authority.

Limes changes that model by making bounded permissions the default. Users grant a single approval to the vault, while every subsequent permission is constrained by explicit spending limits and expiration. Existing approvals are continuously surfaced, allowing unnecessary or dangerous permissions to be revoked before they become an attack vector.

Monad makes this architecture practical. Enforcing spending limits requires an on-chain permission check for every token transfer. On networks with high transaction costs, this model becomes prohibitively expensive for everyday activity. Monad's low fees and sub-second finality make continuous permission enforcement economically viable.

The protocol is non-custodial, fully verified, and backed by comprehensive automated tests. Its architecture prioritizes a small audit surface, an immutable protocol fee ceiling, emergency controls that preserve user revocation rights, and a clear path toward organizational policy management without redesigning the core protocol.

Limes is the foundation of a permission infrastructure layer for the EVM, bringing enforceable boundaries to ERC-20 approvals without requiring new wallet standards or changes to existing token contracts.

---

*Built for the BuildAnything Spark Hackathon** • *Deployed on Monad Testnet*





