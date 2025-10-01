# TinyPay: Real-World Crypto Payments, Unplugged

TinyPay enables seamless cryptocurrency payments in real-world scenarios—even without internet access. We bridge the gap between digital assets and everyday commerce. Our platform transforms crypto into a cash-like experience by eliminating the need for constant connectivity. At its core, TinyPay uses a secure One-Time Password (OTP) system on the **Celo blockchain** to ensure transactions are fast, reliable, and trustless.

**The core idea is that Celo is fast and cheap, so it can be used as a settlement layer for payments made with other EVM-compatible assets.**

## 🚀 Live Demo & Links

| Resource                | Link                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| contract on Celo Mainnet| [0x141d0b9621ee775ddcfa21549767e21b4ff3b740](https://explorer.celo.org/mainnet/address/0x141d0b9621ee775ddcfa21549767e21b4ff3b740) |
| 🍎 TestFlight (Payer App) | [Download TinyPay](https://testflight.apple.com/join/XEAU8ffD)                          |
| 🛒 TestFlight (Merchant App)| [Download TinyPayCheckout]( https://testflight.apple.com/join/1c9uyk2r)               |

## ✨ Key Innovations

- **True Offline Payments**: A hash-chain OTP system lets users generate secure, single-use payment codes offline, enabling transactions anywhere.
- **On-Chain Security with Celo**: Funds are secured in a non-custodial smart contract on the Celo blockchain. The contract validates OTPs, processes payments, and supports both Precommit and Paymaster models.
- **Multi-Currency Support**: TinyPay supports any EVM-compatible token, with **Celo serving as the fast and low-cost settlement layer**. This allows users to pay with a variety of assets, which are then settled on the Celo network.
- **Simple UX**: Two lightweight Swift apps—TinyPay (payer) and TinyPayCheckout (merchant)—deliver an intuitive, minimal payment experience.

## 🏛️ System Architecture

TinyPay is built on a four-part architecture designed for simplicity and security:

1.  **Payer App (TinyPay)**: iOS app where users deposit assets into the contract and generate offline OTPs.
2.  **Merchant App (TinyPayCheckout)**: iOS app for merchants to input sale amounts and collect OTPs.
3.  **Backend Server (TinyPayServer)**: Golang service that validates merchant requests and submits transactions to the Celo contract.
4.  **Celo Smart Contract (TinyPay.sol)**: Manages funds, validates OTP chains, and executes asset transfers.

## ⛓️ Deep Dive: The Celo Contract

The `TinyPay.sol` contract guarantees offline payments are securely reconciled on-chain.

### Core Mechanics:

- **UserAccount**: Stores user balances and the current tail hash (the latest link in their payment hash chain).
- **OTP Validation**: A payment is valid if `sha256(OTP) == current_tail_hash`.
- **Hash Chain Advancement**: After a valid payment, the contract updates the tail to the OTP, ensuring one-time use.
- **`complete_payment` Function**: Handles OTP verification, balance checks, fund transfer, and hash chain updates.

```solidity
function completePayment(
    address token,
    bytes calldata opt,
    address payer,
    address payable recipient,
    uint256 amount,
    bytes32 commitHash
) public returns (bool) {
    // ...
}
```

This creates a trustless, non-custodial way to settle offline transactions securely.

## 🗺️ Future Roadmap

- **DeFi Integration**: Enable yield generation on deposited funds.
- **Merchant Services**: Add accounting and data-sync integrations.
- **Hardware Suite**: Build branded QR scanners and POS terminals.
- **Fiat On-Ramp**: Connect with fiat exchanges for seamless top-ups.

## 👨‍💻 The Team

- Harold
- Togo
- Lucian
- Keith
