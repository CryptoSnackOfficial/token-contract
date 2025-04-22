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

- **Vesting Schedules**
  - Customizable cliff and vesting duration
  - Revocable/non-revocable schedules
  - Token release tracking
  - Multiple beneficiary support

- **Security**
  - Protected against reentrancy
  - Owner-only administrative functions
  - Built-in schedule validation

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

#### Schedule Management
- `createVestingSchedule(address, uint256, uint256, uint256, uint256, bool)`: Create new vesting schedule
- `release()`: Release available tokens to beneficiary
- `revoke(address)`: Revoke vesting schedule (if revocable)

#### View Functions
- `getVestingSchedule(address)`: Get vesting schedule details
- `getReleasableAmount(address)`: Get releasable token amount
- `getTotalAllocated()`: Get total allocated tokens
- `getToken()`: Get vesting token address

## Constants

### Token Contract
- `TAX_PRECISION`: 10000 (2 decimal precision for tax)
- `MAX_TAX`: 2500 (25.00% maximum tax)
- `MAX_BATCH_SIZE`: 200 (maximum addresses for batch transfer)

### Vesting Contract
- `MAX_START_OFFSET_TIME`: 365 days (maximum delay for schedule start)
- `MAX_VESTING_TIME`: 10 years (maximum vesting duration)

## Run Tests

```bash
npx hardhat test
```

## Security Considerations

1. Owner privileges should be managed through a secure multi-sig wallet
2. Tax wallet should be a secure address
3. Blacklist and whitelist functions should be used with caution
4. Vesting schedules cannot be modified once created

## License

MIT
