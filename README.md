TinyPay: Real-World Crypto Payments, Unplugged
TinyPay enables seamless cryptocurrency payments in real-world scenarios—even without internet access. We bridge the gap between digital assets and everyday commerce.
Our platform transforms crypto into a cash-like experience by eliminating the need for constant connectivity. At its core, TinyPay uses a secure One-Time Password (OTP) system on the Aptos blockchain to ensure transactions are fast, reliable, and trustless.

🚀 Live Demo & Links
ResourceLink
🎬 Video Demo & SlidesView on Google Slides
🍎 TestFlight (Payer App)Download TinyPay
🛒 TestFlight (Merchant App)Download TinyPayCheckout

✨ Key Innovations
True Offline Payments: A hash-chain OTP system lets users generate secure, single-use payment codes offline, enabling transactions anywhere.
On-Chain Security with Aptos: Funds are secured in a non-custodial smart contract. The contract validates OTPs, processes payments, and supports both Precommit and Paymaster models.
Multi-Currency Support: Built on the Aptos Fungible Asset (FA) standard, TinyPay supports APT, USDC, and any FA-compatible token.
Simple UX: Two lightweight Swift apps—TinyPay (payer) and TinyPayCheckout (merchant)—deliver an intuitive, minimal payment experience.

🏛️ System Architecture
TinyPay is built on a four-part architecture designed for simplicity and security:
Payer App (TinyPay): iOS app where users deposit assets into the contract and generate offline OTPs.
Merchant App (TinyPayCheckout): iOS app for merchants to input sale amounts and collect OTPs.
Backend Server (TinyPayServer): Golang service that validates merchant requests and submits transactions to the Aptos contract.
Aptos Smart Contract (tinypay.move): Manages funds, validates OTP chains, and executes asset transfers.


⛓️ Deep Dive: The Aptos Contract
The tinypay.move contract guarantees offline payments are securely reconciled on-chain.
Core Mechanics:
UserAccount: Stores user balances and the current tail hash (the latest link in their payment hash chain).
OTP Validation: A payment is valid if sha256(OTP) == current_tail_hash.
Hash Chain Advancement: After a valid payment, the contract updates the tail to the OTP, ensuring one-time use.
complete_payment Function: Handles OTP verification, balance checks, fund transfer, and hash chain updates.
public entry fun complete_payment(
    caller: &signer,
    otp: vector<u8>,
    payer: address,
    recipient: address,
    amount: u64,
    ...
) acquires UserAccount, TinyPayState {
    let user_account = borrow_global_mut<UserAccount>(payer);
    let otp_hash_bytes = hash::sha2_256(otp);
    assert!(bytes_to_hex_ascii(otp_hash_bytes) == user_account.tail, E_INVALID_OPT);

    assert!(get_balance(payer) >= amount, E_INSUFFICIENT_BALANCE);

    // Transfer funds...

    user_account.tail = otp; // Advance hash chain
}
This creates a trustless, non-custodial way to settle offline transactions securely.

🗺️ Future Roadmap
DeFi Integration: Enable yield generation on deposited funds.
Merchant Services: Add accounting and data-sync integrations.
Hardware Suite: Build branded QR scanners and POS terminals.
Fiat On-Ramp: Connect with fiat exchanges for seamless top-ups.

👨‍💻 The Team
Harold
Togo
Lucian
Keith
