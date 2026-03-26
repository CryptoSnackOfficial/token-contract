# CryptoSnack Token

A comprehensive token and vesting solution built on BNB Smart Chain (BSC) with advanced features including tax management, blacklisting, whitelisting, and token vesting capabilities.

## Features

### Token Contract (`CryptoSnackToken`)

- **Tax System**
  - Configurable buying and selling taxes (up to 25%)
  - Tax exemption through whitelisting
  - Dedicated tax collection wallet
  - Ability to enable/disable taxes globally

- **Access Control**
  - Blacklist system to restrict malicious addresses
  - Whitelist system for tax exemptions
  - Account freezing for security measures
  - Token recovery from frozen accounts

- **Security Features**
  - Pausable transfers
  - Reentrancy protection
  - Controlled burn mechanism
  - Multi-transfer functionality with batch limits

- **DEX Integration**
  - Configurable DEX address management
  - Automatic tax application for DEX transactions

### Vesting Contract (`CryptoSnackVesting`)

- **Multiple Schedules per Beneficiary**
  - Each wallet can hold any number of independent vesting schedules simultaneously
  - Each schedule has its own token amount, start time, cliff, duration, and revocability
  - Fully-released schedules are automatically removed from storage (no manual cleanup required)

- **Vesting Schedules**
  - Customizable cliff and vesting duration (both expressed as second intervals from `startTime`)
  - Revocable/non-revocable schedules per grant
  - Token release tracking per schedule
  - Linear vesting from `startTime` once `cliff` is passed

- **Release**
  - `release()` aggregates all currently releasable tokens across every active schedule and performs a single token transfer — no need to call per schedule

- **Revocation**
  - `revokeSchedule(beneficiary, index)` targets a single schedule by its current array index
  - `revokeAll(beneficiary)` revokes every revocable schedule in one call, skipping non-revocable ones
  - On revoke: earned-but-unreleased tokens go to the beneficiary; unvested remainder is refunded to the owner

- **Security**
  - Protected against reentrancy
  - Owner-only administrative functions
  - Built-in schedule validation

#### Important: token amounts use base units (decimals)

All token amounts passed into / returned from the vesting contract are denominated in the token's smallest unit ("base units"), **not** in human-readable token units.

- For an 18-decimal ERC-20 token, **1 token = 10^18 base units**.
- `createVestingSchedule(..., amount, ...)` expects `amount` in base units.
  - Example: to vest **500 tokens** (18 decimals), pass `500 * 10^18` i.e. `500000000000000000000`.
- `getReleasableAmount(address)` and `getVestingSchedules(address)` return base units as well.

If you pass `500` as the amount for an 18-decimal token, that represents `0.000000000000000500` tokens.

## Deployment

Fill `.env` file
(specify [private key](https://support.metamask.io/managing-my-wallet/secret-recovery-phrase-and-private-keys/how-to-export-an-accounts-private-key/)):

```dotenv
PRIVATE_KEY=
BSCSCAN_API_KEY=

TOKEN_NAME="CryptoSnack 2.0"
TOKEN_SYMBOL=SNACK
INITIAL_SUPPLY=10000000000
SELLING_TAX=250
BUYING_TAX=250
# Once published, insert token address here for verifying and vesting contract
TOKEN_ADDRESS=
```

Run script:

```bash
npx hardhat run scripts/deploy-token.ts --network bsc
```

Edit `.env` file to include `TOKEN_ADDRESS` value.

Run script:

```bash
npx hardhat run scripts/deploy-vesting.ts --network bsc
```

## Contract Verification

Edit `.env` file to include `TOKEN_ADDRESS` value.

Run script:

```bash
npx hardhat run scripts/verify-token.ts --network bsc
```

## DEX Management

To take fees for swapping on DEX, the DEX wallet should be added to the list.

Example (for [pancakeswap](https://docs.pancakeswap.finance/developers/smart-contracts)):

```bash
# router v2
setDex("0x10ED43C718714eb63d5aA57B78B54704E256024E", true);

# router v3
setDex("0x13f4EA83D0bd40E75C8222255bc855a974568Dd4", true);

# stableswap
setDex("0xC6665d98Efd81f47B03801187eB46cbC63F328B0", true)
```

## Contract Functions

### Token Contract Functions

#### Tax Management
- `setSellingTax(uint16)`: Set selling tax rate (max 25%). Only used if `taxEnabled` is true
- `setBuyingTax(uint16)`: Set buying tax rate (max 25%). Only used if `taxEnabled` is true
- `setTaxEnabled(bool)`: Enable/disable tax collection (manual)
- `setTaxWallet(address)`: Set tax collection wallet
- `getTaxWallet()`: Get current tax wallet address
- `getBuyingTax()`: Get current buying tax rate
- `getSellingTax()`: Get current selling tax rate
- `isTaxEnabled()`: Check if tax collection is enabled

#### Access Control
- `setBlacklist(address, bool)`: Add/remove address from blacklist
- `setWhitelist(address, bool)`: Add/remove address from whitelist
- `isBlacklisted(address)`: Check if address is blacklisted
- `isWhitelisted(address)`: Check if address is whitelisted
- `freezeAccount(address)`: Freeze account for 24 hours
- `isFrozen(address)`: Check if account is frozen
- `getFreezeTime(address)`: Get account freeze expiration time

#### Token Operations
- `burn(uint256)`: Burn tokens (owner or enabled)
- `burnFrom(address, uint256)`: Burn tokens from address
- `setBurnEnabled(bool)`: Enable/disable burning
- `pause()`: Pause all token transfers
- `unpause()`: Resume token transfers
- `multiTransferEqual(address[], uint256)`: Transfer equal amounts to multiple addresses

#### Recovery Functions
- `recoverStolenTokens(address, address, uint256)`: Recover tokens from frozen account
- `reclaimToken(IERC20)`: Recover other tokens sent to contract
- `reclaimBNB()`: Recover BNB sent to contract

### Vesting Contract Functions

#### `createVestingSchedule` — parameter guide

```
createVestingSchedule(
    address beneficiary,    // wallet that will receive the tokens
    uint256 amount,         // token amount in base units (see note above)
    uint256 startTime,      // Unix timestamp (seconds) when linear vesting begins
    uint256 cliffDuration,  // seconds after startTime before ANY tokens can be claimed
    uint256 vestingDuration,// total vesting length in seconds (measured from startTime)
    bool    revocable       // true = owner can revoke this schedule later
)
```

**Key points:**
- `startTime` must be a Unix timestamp **in the future** (≥ `block.timestamp`) and no more than 365 days from now.
- `cliffDuration` and `vestingDuration` are **durations in seconds**, not timestamps. They are added to `startTime` internally:
  - cliff expires at `startTime + cliffDuration`
  - vesting ends at `startTime + vestingDuration`
- `cliffDuration` must be ≤ `vestingDuration` (cliff cannot outlast the vesting period).
- `vestingDuration` cannot exceed 10 years.
- A wallet can have **multiple independent schedules** — calling `createVestingSchedule` for the same beneficiary again simply appends a new schedule.
- The contract must already hold enough tokens: `contractBalance ≥ amount + totalAllocated`.

**Example — 12-month cliff, 36-month total vest, starting in 1 hour:**

```solidity
uint256 start        = block.timestamp + 1 hours;
uint256 cliffSecs    = 365 days;         // 1 year cliff
uint256 durationSecs = 3 * 365 days;     // 3 year total vest
uint256 amount       = 500_000 * 1e18;   // 500,000 tokens (18 decimals)

createVestingSchedule(
    0xBeneficiary,
    amount,
    start,
    cliffSecs,
    durationSecs,
    true   // revocable
);
```

After the cliff passes, the beneficiary accrues tokens linearly. At `startTime + 365 days` they can claim ~33 % of the grant; at `startTime + 3*365 days` they can claim 100 %.

#### Schedule Management

- `createVestingSchedule(address beneficiary, uint256 amount, uint256 startTime, uint256 cliffDuration, uint256 vestingDuration, bool revocable)`: Create a new vesting schedule and append it to the beneficiary's list. Emits `VestingScheduleCreated(beneficiary, scheduleIndex, amount, startTime, cliff, duration)`.
- `release()`: Claim all currently releasable tokens across **every** active schedule for `msg.sender` in a single transfer. Fully-vested schedules are automatically deleted. Reverts with `NothingToRelease` if nothing is available yet.
- `revokeSchedule(address beneficiary, uint256 scheduleIndex)`: Revoke a specific schedule by its current index (owner only). Transfers earned-but-unreleased tokens to the beneficiary and refunds the unvested remainder to the owner. The schedule is then deleted.
- `revokeAll(address beneficiary)`: Revoke every **revocable** schedule for the beneficiary in one call (owner only). Non-revocable schedules are silently skipped. Reverts with `NoRevocableSchedules` if none qualify.

> **Index stability note:** indices can change after any deletion (swap-and-pop). Always call `getVestingSchedules(beneficiary)` first to read the current index of the schedule you want to revoke.

#### View Functions

- `getVestingSchedules(address beneficiary)`: Returns the full array of `VestingSchedule` structs currently active for the beneficiary. Each struct contains:
  - `totalAmount` — total tokens allocated (base units)
  - `startTime` — Unix timestamp when linear vesting starts
  - `cliff` — Unix timestamp before which nothing can be claimed (`startTime + cliffDuration`)
  - `duration` — total vesting length in seconds
  - `releasedAmount` — tokens already transferred to the beneficiary
  - `revocable` — whether the owner can revoke this schedule
  - `revoked` — always `false` for active schedules (revoked schedules are deleted, not kept)
- `getVestingScheduleCount(address beneficiary)`: Returns the number of active schedules for the beneficiary.
- `getReleasableAmount(address beneficiary)`: Returns the **aggregate** token amount the beneficiary can claim right now across all their schedules (base units).
- `getReleasableAmount(address beneficiary, uint256 scheduleIndex)`: Returns the releasable amount for a specific schedule by index.
- `getTotalAllocated()`: Returns total tokens currently locked across all beneficiaries (base units).
- `getToken()`: Returns the ERC-20 token address used by this vesting contract.

## Constants

### Token Contract
- `TAX_PRECISION`: 10000 (2 decimal precision for tax)
- `MAX_TAX`: 2500 (25.00% maximum tax)
- `MAX_BATCH_SIZE`: 200 (maximum addresses for batch transfer)

### Vesting Contract
- `MAX_START_OFFSET_TIME`: 365 days (maximum allowed delay between now and `startTime`)
- `MAX_VESTING_TIME`: 10 years (maximum value for `vestingDuration`)

## Run Tests

```bash
npx hardhat test
```

## Security Considerations

1. Owner privileges should be managed through a secure multi-sig wallet
2. Tax wallet should be a secure address
3. Blacklist and whitelist functions should be used with caution
4. Vesting schedules cannot be modified once created — only revoked (if marked `revocable`) or claimed via `release()`
5. Schedule indices are **not stable**: deleting a schedule via `release()` (auto-cleanup when fully vested) or `revokeSchedule()` / `revokeAll()` may change the indices of remaining schedules. Always query `getVestingSchedules(beneficiary)` immediately before calling `revokeSchedule` to obtain the current index.

## License

MIT